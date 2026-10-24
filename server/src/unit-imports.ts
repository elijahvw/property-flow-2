import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { audit, boundedText, input, mutation, sameSubmission, scoped, submission, version, type Tx } from "./operational.js";
import { unitDetailKeys, unitDetails } from "./property-fields.js";
import { parseUnitCsv, UNIT_IMPORT_MAX_BYTES, type UnitImportSourceRow } from "./unit-import-csv.js";

type Detail = ReturnType<typeof unitDetails>;
type PreviewRow = UnitImportSourceRow & {
  propertyId: string | null; label: string | null; details: Detail | null;
  property: { id: string; name: string; version: number } | null;
  existingUnitId?: string; issues: { column: string; message: string }[];
};
type Preview = { rowCount: number; validCount: number; errorCount: number; rows: PreviewRow[] };
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const stale = () => new AccessError(409, "IMPORT_REVIEW_CHANGED", "A property or unit changed after this preview. Create a fresh preview and review it before importing; no units were created.");

async function validate(tx: Tx, companyId: string, sources: UnitImportSourceRow[]): Promise<Preview> {
  const rows: PreviewRow[] = sources.map(source => {
    const row: PreviewRow = { ...source, propertyId: null, label: null, details: null, property: null, issues: [] };
    const attempt = (column: string, run: () => void) => {
      try { run(); } catch (error) { if (!(error instanceof AccessError)) throw error; row.issues.push({ column, message: error.message }); }
    };
    attempt("propertyId", () => { row.propertyId = assignmentId(source.values.propertyId); });
    attempt("label", () => { row.label = boundedText(source.values.label, 80, "Unit name"); });
    for (const key of unitDetailKeys) attempt(key, () => { unitDetails({ [key]: source.values[key] || null }); });
    if (!row.issues.some(issue => unitDetailKeys.includes(issue.column))) row.details = unitDetails(source.values);
    return row;
  });
  const properties = await tx.property.findMany({ where: { companyId, id: { in: [...new Set(rows.flatMap(row => row.propertyId ? [row.propertyId] : []))] } }, select: { id: true, name: true, version: true } });
  const byId = new Map(properties.map(property => [property.id, property]));
  const candidates = rows.flatMap(row => row.propertyId && row.label ? [{ propertyId: row.propertyId, label: row.label }] : []);
  const units = candidates.length ? await tx.unit.findMany({ where: { companyId, OR: candidates }, select: { id: true, propertyId: true, label: true } }) : [];
  const existing = new Map(units.map(unit => [JSON.stringify([unit.propertyId, unit.label]), unit.id]));
  const seen = new Map<string, PreviewRow>();
  for (const row of rows) {
    row.property = row.propertyId ? byId.get(row.propertyId) ?? null : null;
    if (row.propertyId && !row.property) row.issues.push({ column: "propertyId", message: "This property is unavailable in your company. Use an ID from the property directory." });
    if (row.propertyId && row.label) {
      const key = JSON.stringify([row.propertyId, row.label]), prior = seen.get(key);
      if (prior) {
        row.issues.push({ column: "label", message: `This exact property/unit name is also used on line ${prior.row}.` });
        if (!prior.issues.some(issue => issue.message.startsWith("This exact property/unit name"))) prior.issues.push({ column: "label", message: `This exact property/unit name is also used on line ${row.row}.` });
      } else seen.set(key, row);
      const unitId = existing.get(key);
      if (unitId) { row.existingUnitId = unitId; row.issues.push({ column: "label", message: "A unit with this exact name already exists in this property, including archived units." }); }
    }
  }
  const validCount = rows.filter(row => !row.issues.length).length;
  return { rowCount: rows.length, validCount, errorCount: rows.length - validCount, rows };
}

async function detail(tx: Tx, companyId: string, id: string) {
  const batch = await tx.unitImportBatch.findFirst({ where: { id, companyId }, select: {
    id: true, companyId: true, status: true, version: true, fileName: true, createdAt: true, committedAt: true, cancelledAt: true, preview: true, result: true,
  } });
  if (!batch) throw new AccessError(404, "NOT_FOUND", "Unit import not found.");
  const actions = await tx.unitImportAction.findMany({ where: { companyId, batchId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, action: true, detail: true, createdAt: true } });
  return { ...batch, actions };
}

export function registerUnitImports(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string) {
  const auth = { preValidation: authenticate }, base = "/api/company/imports/units";
  server.get<{ Querystring: { cursor?: string } }>(base, auth, request => {
    if (Object.keys(request.query).some(key => key !== "cursor")) throw new AccessError(400, "INVALID_INPUT", "Choose only the import page.");
    const cursor = request.query.cursor === undefined ? undefined : assignmentId(request.query.cursor);
    return scoped(db, request, "property.write", async (tx, companyId) => {
      const [rows, total] = await Promise.all([
        tx.unitImportBatch.findMany({ where: { companyId, ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: "desc" }, take: 51, select: { id: true, status: true, version: true, fileName: true, createdAt: true, committedAt: true, cancelledAt: true, preview: true, result: true } }),
        tx.unitImportBatch.count({ where: { companyId } }),
      ]);
      return { items: rows.slice(0, 50).map(({ preview, result, ...row }) => ({ ...row, rowCount: (preview as unknown as Preview).rowCount, errorCount: (preview as unknown as Preview).errorCount, createdCount: (result as { createdCount?: number } | null)?.createdCount ?? null })), total, nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  });
  server.post(base + "/preview", { ...auth, bodyLimit: UNIT_IMPORT_MAX_BYTES * 2 + 8192 }, request => {
    mutation(request, origin);
    const body = input(request, ["csv", "fileName", "submissionKey"]), sources = parseUnitCsv(body.csv);
    const fileName = boundedText(body.fileName, 200, "File name"), sourceHash = createHash("sha256").update(body.csv as string).digest("hex"), key = submission(body.submissionKey, { fileName, sourceHash });
    return scoped(db, request, "property.write", async (tx, companyId) => {
      const previous = await tx.unitImportBatch.findUnique({ where: { companyId_submissionKey: { companyId, submissionKey: key.submissionKey } } });
      if (previous) { sameSubmission(previous.submissionHash, key.submissionHash); return detail(tx, companyId, previous.id); }
      const used = await tx.unitImportAction.findUnique({ where: { companyId_submissionKey: { companyId, submissionKey: key.submissionKey } } });
      if (used) throw new AccessError(409, "SUBMISSION_MISMATCH", "This submission key already belongs to another import action.");
      const preview = await validate(tx, companyId, sources);
      const batch = await tx.unitImportBatch.create({ data: { companyId, fileName, sourceHash, sourceRows: json(sources), preview: json(preview), createdById: request.principal!.id, ...key } });
      await tx.unitImportAction.create({ data: { companyId, batchId: batch.id, action: "preview", detail: json({ rowCount: preview.rowCount, errorCount: preview.errorCount }), createdById: request.principal!.id, ...key } });
      await audit(tx, request, companyId, batch.id, "unit.import.previewed", { rowCount: preview.rowCount, errorCount: preview.errorCount });
      return detail(tx, companyId, batch.id);
    });
  });
  server.get<{ Params: { batchId: string } }>(base + "/:batchId", auth, request => scoped(db, request, "property.write", (tx, companyId) => detail(tx, companyId, assignmentId(request.params.batchId))));
  for (const action of ["commit", "cancel"] as const) server.post<{ Params: { batchId: string } }>(`${base}/:batchId/${action}`, auth, request => {
    mutation(request, origin);
    const batchId = assignmentId(request.params.batchId), body = input(request, action === "commit" ? ["expectedVersion", "submissionKey"] : ["expectedVersion", "reason", "submissionKey"]);
    const expectedVersion = version(body.expectedVersion), reason = action === "cancel" ? boundedText(body.reason, 500, "Cancellation reason") : null;
    const key = submission(body.submissionKey, { action, batchId, expectedVersion, reason });
    return scoped(db, request, "property.write", async (tx, companyId) => {
      const receipt = await tx.unitImportAction.findUnique({ where: { companyId_submissionKey: { companyId, submissionKey: key.submissionKey } } });
      if (receipt) { sameSubmission(receipt.submissionHash, key.submissionHash); if (receipt.batchId !== batchId) throw new AccessError(409, "SUBMISSION_MISMATCH", "This submission belongs to another import."); return detail(tx, companyId, batchId); }
      await tx.$queryRaw`UPDATE "UnitImportBatch" SET "updatedAt"="updatedAt" WHERE id=${batchId} AND "companyId"=${companyId} RETURNING id`;
      const batch = await tx.unitImportBatch.findFirst({ where: { id: batchId, companyId } });
      if (!batch) throw new AccessError(404, "NOT_FOUND", "Unit import not found.");
      if (batch.version !== expectedVersion) throw new AccessError(409, "RECORD_CHANGED", "This import changed. Reload its current state before reviewing again.");
      if (batch.status !== "preview") throw new AccessError(409, "IMPORT_FINALIZED", "This import has already been completed or cancelled. Its history is retained.");
      if (action === "cancel") {
        await tx.unitImportBatch.update({ where: { id: batchId, companyId }, data: { status: "cancelled", cancelledAt: new Date(), version: { increment: 1 } } });
        await tx.unitImportAction.create({ data: { companyId, batchId, action: "cancel", detail: json({ reason }), createdById: request.principal!.id, ...key } });
        await audit(tx, request, companyId, batchId, "unit.import.cancelled", { reason });
      } else {
        const original = batch.preview as unknown as Preview;
        if (original.errorCount) throw new AccessError(409, "IMPORT_INVALID", "Correct every row issue and create a fresh preview before importing. No units were created.");
        const ids = [...new Set(original.rows.map(row => row.propertyId!))].sort();
        for (const id of ids) await tx.$queryRaw`UPDATE "Property" SET "updatedAt"="updatedAt" WHERE id=${id} AND "companyId"=${companyId} RETURNING id`;
        const fresh = await validate(tx, companyId, batch.sourceRows as unknown as UnitImportSourceRow[]);
        if (fresh.errorCount || fresh.rows.some((row, index) => row.property?.version !== original.rows[index].property?.version)) throw stale();
        const created = await tx.unit.createManyAndReturn({ data: fresh.rows.map(row => ({ companyId, propertyId: row.propertyId!, label: row.label!, ...row.details!, createdById: request.principal!.id, submissionKey: randomUUID(), submissionHash: createHash("sha256").update(JSON.stringify({ batchId, row: row.row })).digest("hex") })), select: { id: true, propertyId: true, label: true } });
        const createdBySource = new Map(created.map(unit => [JSON.stringify([unit.propertyId, unit.label]), unit.id]));
        const items = fresh.rows.map(row => ({ row: row.row, unitId: createdBySource.get(JSON.stringify([row.propertyId, row.label]))!, propertyId: row.propertyId!, label: row.label! }));
        await tx.auditEvent.createMany({ data: items.map(item => ({ actorId: request.sessionActor?.id ?? request.principal!.id, companyId, targetId: item.unitId, action: "unit.created", requestId: request.id, detail: { propertyId: item.propertyId, importBatchId: batchId, sourceRow: item.row } })) });
        const result = { createdCount: items.length, items };
        await tx.unitImportBatch.update({ where: { id: batchId, companyId }, data: { status: "committed", committedAt: new Date(), version: { increment: 1 }, result: json(result) } });
        await tx.unitImportAction.create({ data: { companyId, batchId, action: "commit", detail: json(result), createdById: request.principal!.id, ...key } });
        await audit(tx, request, companyId, batchId, "unit.import.committed", { createdCount: items.length });
      }
      return detail(tx, companyId, batchId);
    }).catch(error => {
      if ((error as { code?: string }).code === "P2002") throw stale();
      throw error;
    });
  });
}
