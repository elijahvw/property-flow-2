import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { parseCsvObjects, CSV_MAX_BYTES, type CsvSourceRow } from "./csv.js";
import { audit, boundedText, cents, choice, date, input, mutation, sameSubmission, scoped, submission, version, type Tx } from "./operational.js";
import { companyDay } from "./reports.js";

export const EXPENSE_IMPORT_COLUMNS = ["sourceId", "propertyId", "occurredOn", "amount", "category", "memo"] as const;
export const EXPENSE_CATEGORIES = ["repairs", "utilities", "insurance", "property_tax", "other"];
const isoDay = (value: Date) => value.toISOString().slice(0, 10);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export function expenseSourceNamespace(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(value)) throw new AccessError(400, "INVALID_SOURCE_NAMESPACE", "Use a stable source namespace of 1–100 lowercase letters, digits, dots, underscores or hyphens. Reuse it for later files from the same source.");
  return value;
}
export function expenseSourceId(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 200 || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) throw new AccessError(400, "INVALID_SOURCE_ID", "A source ID is required, at most 200 characters without surrounding spaces or control characters. Copy the exact stable ID from your source records.");
  return value;
}
export function parseExpenseCsv(value: unknown) {
  return parseCsvObjects(value, EXPENSE_IMPORT_COLUMNS, EXPENSE_IMPORT_COLUMNS.slice(0, 5), "paid expense");
}
type PreviewRow = CsvSourceRow & {
  sourceId: string | null; propertyId: string | null; occurredOn: string | null; amountCents: number | null;
  category: string | null; memo: string | null; sourceHash: string | null;
  property: { id: string; name: string; version: number } | null;
  existingSource?: { id: string; ledgerEntryId: string; propertyId: string; reference: string; voidedAt: string | null; samePayload: boolean };
  issues: { column: string; message: string }[];
};
type Preview = {
  rowCount: number; validCount: number; errorCount: number; totalCents: string; totalsComplete: boolean;
  groups: { propertyId: string; propertyName: string; category: string; amountCents: string; count: number }[];
  rows: PreviewRow[];
};
async function validate(tx: Tx, companyId: string, namespace: string, sources: CsvSourceRow[]): Promise<Preview> {
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } }), today = companyDay(company.timezone);
  const rows: PreviewRow[] = sources.map(source => {
    const row: PreviewRow = { ...source, sourceId: null, propertyId: null, occurredOn: null, amountCents: null, category: null, memo: null, sourceHash: null, property: null, issues: [] };
    const attempt = (column: string, run: () => void) => { try { run(); } catch (error) { if (!(error instanceof AccessError)) throw error; row.issues.push({ column, message: error.message }); } };
    attempt("sourceId", () => { row.sourceId = expenseSourceId(source.values.sourceId); });
    attempt("propertyId", () => { row.propertyId = assignmentId(source.values.propertyId); });
    attempt("occurredOn", () => { row.occurredOn = isoDay(date(source.values.occurredOn, "actual paid expense date")); if (row.occurredOn > today) throw new AccessError(400, "FUTURE_EXPENSE", "The actual paid date cannot be in the future in the company's timezone."); });
    attempt("amount", () => { row.amountCents = cents(source.values.amount); if (row.amountCents <= 0) throw new AccessError(400, "INVALID_AMOUNT", "Record a positive USD amount actually paid, up to 1,000,000.00."); });
    attempt("category", () => { row.category = choice(source.values.category, EXPENSE_CATEGORIES, "paid operating-expense category"); });
    attempt("memo", () => { row.memo = source.values.memo === undefined || source.values.memo === "" ? null : boundedText(source.values.memo, 500, "Expense memo"); });
    if (!row.issues.length) row.sourceHash = hash({ propertyId: row.propertyId, occurredOn: row.occurredOn, amountCents: row.amountCents, category: row.category, memo: row.memo });
    return row;
  });
  const [properties, imported] = await Promise.all([
    tx.property.findMany({ where: { companyId, id: { in: [...new Set(rows.flatMap(row => row.propertyId ? [row.propertyId] : []))] } }, select: { id: true, name: true, version: true } }),
    tx.importedExpenseSource.findMany({ where: { companyId, sourceNamespace: namespace, sourceId: { in: [...new Set(rows.flatMap(row => row.sourceId ? [row.sourceId] : []))] } }, select: { id: true, sourceId: true, sourceHash: true, ledgerEntryId: true, propertyId: true, ledgerEntry: { select: { reference: true, voidedAt: true } } } }),
  ]);
  const propertiesById = new Map(properties.map(property => [property.id, property])), oldBySource = new Map(imported.map(source => [source.sourceId, source]));
  const seen = new Map<string, PreviewRow>();
  for (const row of rows) {
    row.property = row.propertyId ? propertiesById.get(row.propertyId) ?? null : null;
    if (row.propertyId && !row.property) row.issues.push({ column: "propertyId", message: "This property is unavailable in your company. Use an exact ID from your property directory." });
    if (!row.sourceId) continue;
    const prior = seen.get(row.sourceId);
    if (prior) {
      row.issues.push({ column: "sourceId", message: `This exact source ID also appears on line ${prior.row}. Every row must have its own stable source ID.` });
      prior.issues.push({ column: "sourceId", message: `This exact source ID also appears on line ${row.row}.` });
    } else seen.set(row.sourceId, row);
    const old = oldBySource.get(row.sourceId);
    if (old) {
      row.existingSource = { id: old.id, ledgerEntryId: old.ledgerEntryId, propertyId: old.propertyId, reference: old.ledgerEntry.reference, voidedAt: old.ledgerEntry.voidedAt?.toISOString() ?? null, samePayload: old.sourceHash === row.sourceHash };
      row.issues.push({ column: "sourceId", message: old.sourceHash === row.sourceHash ? "This source ID was already imported. Follow its cash record; it cannot be imported again, including after a correction." : "This source ID was already imported with different expense details. Review and correct its actual cash record rather than importing changed money under the same ID." });
    }
  }
  let total = 0n;
  const groups = new Map<string, { propertyId: string; propertyName: string; category: string; amount: bigint; count: number }>();
  const valid = rows.filter(row => !row.issues.length);
  for (const row of valid) {
    const amount = BigInt(row.amountCents!), key = JSON.stringify([row.propertyId, row.category]), group = groups.get(key) ?? { propertyId: row.propertyId!, propertyName: row.property!.name, category: row.category!, amount: 0n, count: 0 };
    total += amount; group.amount += amount; group.count++; groups.set(key, group);
  }
  return { rowCount: rows.length, validCount: valid.length, errorCount: rows.length - valid.length, totalCents: String(total), totalsComplete: valid.length === rows.length, rows, groups: [...groups.values()].sort((a, b) => a.propertyId.localeCompare(b.propertyId) || a.category.localeCompare(b.category)).map(({ amount, ...group }) => ({ ...group, amountCents: String(amount) })) };
}
async function detail(tx: Tx, companyId: string, id: string) {
  const batch = await tx.expenseImportBatch.findFirst({ where: { companyId, id }, select: { id: true, companyId: true, sourceNamespace: true, fileName: true, status: true, version: true, preview: true, result: true, createdAt: true, committedAt: true, cancelledAt: true } });
  if (!batch) throw new AccessError(404, "NOT_FOUND", "Expense import not found.");
  const actions = await tx.expenseImportAction.findMany({ where: { companyId, batchId: id }, select: { id: true, action: true, detail: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const stored = batch.preview as unknown as Preview;
  return { ...batch, preview: { ...stored, rows: stored.rows.map(({ sourceHash: _, ...row }) => row) }, actions };
}
const stale = () => new AccessError(409, "EXPENSE_IMPORT_REVIEW_CHANGED", "An expense source or property changed after this preview. No expenses were created. Create a fresh preview to review current source links and totals.");

export function registerExpenseImports(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string) {
  const auth = { preValidation: authenticate }, base = "/api/company/imports/expenses";
  server.get<{ Querystring: Record<string, unknown> }>(base, auth, request => {
    if (Object.keys(request.query).some(key => key !== "cursor")) throw new AccessError(400, "INVALID_INPUT", "Choose only the expense-import page.");
    const cursor = request.query.cursor === undefined ? undefined : assignmentId(request.query.cursor);
    return scoped(db, request, "finance.manage", async (tx, companyId) => {
      const [rows, total] = await Promise.all([tx.expenseImportBatch.findMany({ where: { companyId, ...(cursor ? { id: { lt: cursor } } : {}) }, select: { id: true, sourceNamespace: true, fileName: true, status: true, version: true, preview: true, result: true, createdAt: true, committedAt: true, cancelledAt: true }, orderBy: { id: "desc" }, take: 51 }), tx.expenseImportBatch.count({ where: { companyId } })]);
      return { items: rows.slice(0, 50).map(({ preview, result, ...row }) => ({ ...row, rowCount: (preview as unknown as Preview).rowCount, errorCount: (preview as unknown as Preview).errorCount, totalCents: (preview as unknown as Preview).totalCents, createdCount: (result as { createdCount?: number } | null)?.createdCount ?? null })), total, nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  });
  server.post(base + "/preview", { ...auth, bodyLimit: CSV_MAX_BYTES * 2 + 8192 }, request => {
    mutation(request, origin);
    const body = input(request, ["sourceNamespace", "fileName", "csv", "submissionKey"]), sourceNamespace = expenseSourceNamespace(body.sourceNamespace), fileName = boundedText(body.fileName, 200, "File name"), sources = parseExpenseCsv(body.csv);
    const sourceHash = createHash("sha256").update(body.csv as string).digest("hex"), key = submission(body.submissionKey, { sourceNamespace, fileName, sourceHash });
    return scoped(db, request, "finance.manage", async (tx, companyId) => {
      const old = await tx.expenseImportBatch.findUnique({ where: { companyId_submissionKey: { companyId, submissionKey: key.submissionKey } } });
      if (old) { sameSubmission(old.submissionHash, key.submissionHash); return detail(tx, companyId, old.id); }
      if (await tx.expenseImportAction.findUnique({ where: { companyId_submissionKey: { companyId, submissionKey: key.submissionKey } } })) throw new AccessError(409, "SUBMISSION_MISMATCH", "This submission key already belongs to another import action.");
      const preview = await validate(tx, companyId, sourceNamespace, sources);
      const batch = await tx.expenseImportBatch.create({ data: { companyId, sourceNamespace, fileName, sourceHash, sourceRows: json(sources), preview: json(preview), createdById: request.principal!.id, ...key } });
      await tx.expenseImportAction.create({ data: { companyId, batchId: batch.id, action: "preview", detail: json({ rowCount: preview.rowCount, errorCount: preview.errorCount, totalCents: preview.totalCents }), createdById: request.principal!.id, ...key } });
      await audit(tx, request, companyId, batch.id, "expense.import.previewed", { rowCount: preview.rowCount, errorCount: preview.errorCount });
      return detail(tx, companyId, batch.id);
    });
  });
  server.get<{ Params: { batchId: string } }>(base + "/:batchId", auth, request => scoped(db, request, "finance.manage", (tx, companyId) => detail(tx, companyId, assignmentId(request.params.batchId))));
  for (const action of ["commit", "cancel"] as const) server.post<{ Params: { batchId: string } }>(`${base}/:batchId/${action}`, auth, request => {
    mutation(request, origin);
    const body = input(request, action === "commit" ? ["expectedVersion", "confirmedPaid", "confirmedNotRecorded", "submissionKey"] : ["expectedVersion", "reason", "submissionKey"]), batchId = assignmentId(request.params.batchId), expectedVersion = version(body.expectedVersion);
    if (action === "commit" && (body.confirmedPaid !== true || body.confirmedNotRecorded !== true)) throw new AccessError(400, "EXPENSE_CONFIRMATION_REQUIRED", "Confirm that every expense was actually paid and has not already been recorded in Property Flow.");
    const reason = action === "cancel" ? boundedText(body.reason, 500, "Cancellation reason") : null;
    const key = submission(body.submissionKey, { action, batchId, expectedVersion, reason, ...(action === "commit" ? { confirmedPaid: true, confirmedNotRecorded: true } : {}) });
    return scoped(db, request, "finance.manage", async (tx, companyId) => {
      const receipt = await tx.expenseImportAction.findUnique({ where: { companyId_submissionKey: { companyId, submissionKey: key.submissionKey } } });
      if (receipt) { sameSubmission(receipt.submissionHash, key.submissionHash); if (receipt.batchId !== batchId) throw new AccessError(409, "SUBMISSION_MISMATCH", "This submission belongs to another import."); return detail(tx, companyId, batchId); }
      await tx.$queryRaw`UPDATE "ExpenseImportBatch" SET "updatedAt"="updatedAt" WHERE id=${batchId} AND "companyId"=${companyId} RETURNING id`;
      const batch = await tx.expenseImportBatch.findFirst({ where: { id: batchId, companyId } });
      if (!batch) throw new AccessError(404, "NOT_FOUND", "Expense import not found.");
      if (batch.version !== expectedVersion) throw new AccessError(409, "RECORD_CHANGED", "This expense import changed. Reload its state before reviewing again.");
      if (batch.status !== "preview") throw new AccessError(409, "IMPORT_FINALIZED", "This expense import has already been completed or cancelled. Its source history is retained.");
      if (action === "cancel") {
        await tx.expenseImportBatch.update({ where: { id: batchId, companyId }, data: { status: "cancelled", cancelledAt: new Date(), version: { increment: 1 } } });
        await tx.expenseImportAction.create({ data: { companyId, batchId, action, detail: json({ reason }), createdById: request.principal!.id, ...key } });
        await audit(tx, request, companyId, batchId, "expense.import.cancelled", { reason });
      } else {
        const original = batch.preview as unknown as Preview;
        if (original.errorCount) throw new AccessError(409, "EXPENSE_IMPORT_INVALID", "Correct every row issue and create a fresh preview before importing. No expenses were created.");
        // Serialize distinct batches in the same source namespace before the
        // fresh dedupe check, then keep property names/versions under review.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}), hashtext(${batch.sourceNamespace}))::text`;
        for (const id of [...new Set(original.rows.map(row => row.propertyId!))].sort()) await tx.$queryRaw`UPDATE "Property" SET "updatedAt"="updatedAt" WHERE id=${id} AND "companyId"=${companyId} RETURNING id`;
        const fresh = await validate(tx, companyId, batch.sourceNamespace, batch.sourceRows as unknown as CsvSourceRow[]);
        if (fresh.errorCount || fresh.rows.some((row, index) => row.sourceHash !== original.rows[index].sourceHash || row.property?.version !== original.rows[index].property?.version)) throw stale();
        const prepared = fresh.rows.map(row => ({ row, ledgerEntryId: randomUUID() }));
        const cash = await tx.ledgerEntry.createManyAndReturn({ data: prepared.map(({ row, ledgerEntryId }) => ({ id: ledgerEntryId, companyId, propertyId: row.propertyId!, createdById: request.principal!.id, occurredOn: date(row.occurredOn!, "paid date"), amountCents: row.amountCents!, kind: "expense", category: row.category!, currency: "USD", memo: row.memo, submissionKey: randomUUID(), submissionHash: row.sourceHash! })), select: { id: true, reference: true } });
        const references = new Map(cash.map(entry => [entry.id, entry.reference]));
        await tx.importedExpenseSource.createMany({ data: prepared.map(({ row, ledgerEntryId }) => ({ companyId, propertyId: row.propertyId!, sourceNamespace: batch.sourceNamespace, sourceId: row.sourceId!, sourceHash: row.sourceHash!, ledgerEntryId, batchId, sourceRow: row.row })) });
        const items = prepared.map(({ row, ledgerEntryId }) => ({ row: row.row, sourceId: row.sourceId!, ledgerEntryId, reference: references.get(ledgerEntryId)!, propertyId: row.propertyId!, amountCents: row.amountCents! }));
        await tx.auditEvent.createMany({ data: items.map(item => ({ actorId: request.principal!.id, companyId, targetId: item.ledgerEntryId, action: "finance.created", requestId: request.id, detail: { propertyId: item.propertyId, kind: "expense", importBatchId: batchId, sourceRow: item.row } })) });
        const result = { createdCount: items.length, totalCents: fresh.totalCents, items };
        await tx.expenseImportBatch.update({ where: { id: batchId, companyId }, data: { status: "committed", committedAt: new Date(), version: { increment: 1 }, result: json(result) } });
        await tx.expenseImportAction.create({ data: { companyId, batchId, action, detail: json(result), createdById: request.principal!.id, ...key } });
        await audit(tx, request, companyId, batchId, "expense.import.committed", { createdCount: items.length, totalCents: fresh.totalCents });
      }
      return detail(tx, companyId, batchId);
    }).catch(error => { if ((error as { code?: string }).code === "P2002") throw stale(); throw error; });
  });
}
