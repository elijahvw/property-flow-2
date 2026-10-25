import { availableDocumentStatuses } from "./document-status.js";
import { publishNotification, type NotificationPublisher } from "./notification-events.js";
import type {
  FastifyInstance,
  FastifyRequest,
  preValidationHookHandler,
} from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import {
  audit,
  boundedText,
  choice,
  conflict,
  date,
  input,
  mutation,
  sameSubmission,
  scoped,
  submission,
  version,
  type Tx,
} from "./operational.js";

type Item = {
  key: string;
  area: string;
  item: string;
  condition: string;
  notes: string;
  evidenceVersionIds: string[];
};
type Snapshot = {
  kind: string;
  inspectedOn: string;
  status: string;
  items: Item[];
  baselineRevisionId: string | null;
};
const invalid = (message: string) =>
  new AccessError(400, "INVALID_INPUT", message);
const missing = () =>
  new AccessError(404, "NOT_FOUND", "Inspection not found at this lease.");
const identity = (i: Item) =>
  `${i.area.toLocaleLowerCase("en-US")}\0${i.item.toLocaleLowerCase("en-US")}`;
export function inspectionItems(value: unknown): Item[] {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw invalid("Record between 1 and 100 condition items.");
  const keys = new Set<string>(),
    names = new Set<string>();
  return value.map((raw) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Object.keys(raw).some(
        (k) =>
          ![
            "key",
            "area",
            "item",
            "condition",
            "notes",
            "evidenceVersionIds",
          ].includes(k),
      )
    )
      throw invalid("Review the condition item fields.");
    const key = boundedText(raw.key, 64, "Item key");
    if (!/^[a-zA-Z0-9-]+$/.test(key) || keys.has(key))
      throw invalid("Every condition item needs a unique key.");
    keys.add(key);
    if (
      typeof raw.notes !== "string" ||
      raw.notes.length > 1000 ||
      raw.notes.includes("\0")
    )
      throw invalid("Notes must be at most 1,000 characters.");
    if (
      !Array.isArray(raw.evidenceVersionIds) ||
      raw.evidenceVersionIds.length > 10
    )
      throw invalid("Link at most 10 originals per item.");
    const evidenceVersionIds = raw.evidenceVersionIds.map(assignmentId);
    if (new Set(evidenceVersionIds).size !== evidenceVersionIds.length)
      throw invalid("Link each original once per item.");
    const row = {
      key,
      area: boundedText(raw.area, 80, "Area").replace(/\s+/g, " "),
      item: boundedText(raw.item, 120, "Item").replace(/\s+/g, " "),
      condition: choice(
        raw.condition,
        ["not_checked", "good", "fair", "damaged", "not_applicable"],
        "condition",
      ),
      notes: raw.notes.trim(),
      evidenceVersionIds,
    };
    const name = identity(row);
    if (names.has(name))
      throw invalid(
        "Use distinct item names within each area so comparisons are unambiguous.",
      );
    names.add(name);
    return row;
  });
}
function ready(items: Item[]) {
  if (
    items.some(
      (i) =>
        i.condition === "not_checked" ||
        (i.condition === "damaged" && !i.notes),
    )
  )
    throw invalid(
      "Check every item and describe any damage before submitting for review.",
    );
}
const snapshot = (row: {
  kind: string;
  inspectedOn: Date;
  status: string;
  items: Prisma.JsonValue;
  baselineRevisionId: string | null;
}): Snapshot => ({
  kind: row.kind,
  inspectedOn: row.inspectedOn.toISOString().slice(0, 10),
  status: row.status,
  items: row.items as Item[],
  baselineRevisionId: row.baselineRevisionId,
});

export function registerInspections(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
  publish: NotificationPublisher = publishNotification,
) {
  const auth = { preValidation: authenticate },
    base = "/api/company/leases/:leaseId/inspections";
  type Params = { leaseId: string; inspectionId: string };
  const run = <T>(
    request: FastifyRequest,
    work: (tx: Tx, companyId: string) => Promise<T>,
  ) => scoped(db, request, "lease.manage", work);
  const source = async (tx: Tx, companyId: string, id: string) => {
    const row = await tx.lease.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!row) throw new AccessError(404, "NOT_FOUND", "Lease not found.");
  };
  const record = async (tx: Tx, companyId: string, p: Params) => {
    const row = await tx.leaseInspection.findFirst({
      where: { id: p.inspectionId, leaseId: p.leaseId, companyId },
    });
    if (!row) throw missing();
    return row;
  };
  const baseline = async (
    tx: Tx,
    companyId: string,
    leaseId: string,
    revisionId: string | null,
    kind: string,
    inspectedOn: Date,
  ) => {
    if (!revisionId) return null;
    const row = await tx.inspectionRevision.findFirst({
      where: { id: revisionId, companyId, leaseId, action: "complete" },
      select: { id: true, snapshot: true, version: true, inspectionId: true },
    });
    const s = row?.snapshot as Snapshot | undefined;
    if (
      kind !== "move_out" ||
      !s ||
      s.kind !== "move_in" ||
      s.status !== "completed" ||
      s.inspectedOn > inspectedOn.toISOString().slice(0, 10)
    )
      throw invalid(
        "Choose a reviewed move-in inspection from this lease dated on or before move-out.",
      );
    return row;
  };
  const evidence = async (
    tx: Tx,
    companyId: string,
    leaseId: string,
    items: Item[],
  ) => {
    const ids = [...new Set(items.flatMap((i) => i.evidenceVersionIds))];
    if (!ids.length) return;
    const count = await tx.documentVersion.count({
      where: {
        id: { in: ids },
        companyId,
        scanStatus: { in: availableDocumentStatuses },
        document: { companyId, leaseId },
      },
    });
    if (count !== ids.length)
      throw invalid(
        "Evidence must be an available exact document version retained at this lease. Upload it in Documents first.",
      );
  };
  const replay = async (
    tx: Tx,
    companyId: string,
    request: FastifyRequest,
    key: ReturnType<typeof submission>,
  ) => {
    const previous = await tx.inspectionRevision.findFirst({
      where: {
        companyId,
        actorId: request.principal!.id,
        submissionKey: key.submissionKey,
      },
      select: { inspectionId: true, submissionHash: true, version: true },
    });
    if (!previous) return null;
    sameSubmission(previous.submissionHash, key.submissionHash);
    return {
      saved: true,
      inspectionId: previous.inspectionId,
      version: previous.version,
      recovered: true,
    };
  };
  const retain = async (
    tx: Tx,
    companyId: string,
    request: FastifyRequest,
    row: Awaited<ReturnType<typeof record>>,
    action: string,
    reason: string | null,
    key: ReturnType<typeof submission>,
  ) => {
    const s = snapshot(row);
    const revision = await tx.inspectionRevision.create({
      data: {
        companyId,
        leaseId: row.leaseId,
        inspectionId: row.id,
        version: row.version,
        action,
        reason,
        snapshot: s as unknown as Prisma.InputJsonValue,
        actorId: request.principal!.id,
        ...key,
      },
    });
    const links = s.items.flatMap((i) =>
      i.evidenceVersionIds.map((versionId) => ({
        companyId,
        revisionId: revision.id,
        itemKey: i.key,
        versionId,
      })),
    );
    if (links.length) await tx.inspectionEvidence.createMany({ data: links });
    await audit(tx, request, companyId, row.id, `inspection.${action}`, {
      leaseId: row.leaseId,
      version: row.version,
      revisionId: revision.id,
    });
    if (action === "submit") await publish(tx, { companyId, actorId: request.principal!.id, kind: "inspection.review", sourceId: row.id, eventKey: revision.id });
    return { saved: true, inspectionId: row.id, version: row.version };
  };
  const params = (p: Params) => ({
    leaseId: assignmentId(p.leaseId),
    inspectionId: assignmentId(p.inspectionId),
  });
  const cleanQuery = (request: FastifyRequest) => {
    if (Object.keys(request.query as object).length)
      throw invalid("Unknown inspection filter.");
  };
  server.get<{ Params: Params }>(base, auth, (request) => {
    cleanQuery(request);
    const leaseId = assignmentId(request.params.leaseId);
    return run(request, async (tx, companyId) => {
      await source(tx, companyId, leaseId);
      const rows = await tx.leaseInspection.findMany({
        where: { companyId, leaseId },
        select: {
          id: true,
          kind: true,
          inspectedOn: true,
          status: true,
          version: true,
          createdAt: true,
          revisions: {
            where: { companyId, leaseId, action: "complete" },
            select: { id: true, version: true, snapshot: true },
            orderBy: { version: "desc" },
            take: 1,
          },
        },
        orderBy: [
          { inspectedOn: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        take: 201,
      });
      if (rows.length > 200)
        throw new AccessError(
          409,
          "INSPECTION_LIMIT",
          "This lease exceeds its 200 inspection limit. Ask your administrator to review retention.",
        );
      const items = rows.map(({ revisions, ...row }) => row);
      return {
        items,
        baselines: rows
          .filter((r) => r.kind === "move_in")
          .flatMap((row) =>
            row.revisions.map((r) => ({
              id: r.id,
              inspectionId: row.id,
              version: r.version,
              inspectedOn: (r.snapshot as unknown as Snapshot).inspectedOn,
            })),
          ),
      };
    });
  });
  server.get<{ Params: Params; Querystring: { beforeVersion?: string } }>(
    `${base}/:inspectionId`,
    auth,
    (request) => {
      const p = params(request.params),
        q = request.query;
      if (
        Object.keys(q).some((k) => k !== "beforeVersion") ||
        (q.beforeVersion !== undefined &&
          !/^[1-9]\d{0,8}$/.test(q.beforeVersion))
      )
        throw invalid("Choose a valid history page.");
      return run(request, async (tx, companyId) => {
        await source(tx, companyId, p.leaseId);
        const row = await record(tx, companyId, p);
        const revisions = await tx.inspectionRevision.findMany({
          where: {
            companyId,
            leaseId: p.leaseId,
            inspectionId: row.id,
            ...(q.beforeVersion
              ? { version: { lt: Number(q.beforeVersion) } }
              : {}),
          },
          select: {
            id: true,
            version: true,
            action: true,
            reason: true,
            snapshot: true,
            createdAt: true,
            actorId: true,
          },
          orderBy: { version: "desc" },
          take: 26,
        });
        const ids = [...new Set(revisions.map((r) => r.actorId))],
          people = await tx.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          });
        const items = row.items as Item[];
        const baselineRow = await baseline(
          tx,
          companyId,
          p.leaseId,
          row.baselineRevisionId,
          row.kind,
          row.inspectedOn,
        );
        const baselineItems =
          (baselineRow?.snapshot as unknown as Snapshot | undefined)?.items ||
          [];
        const evidenceIds = [
          ...new Set(
            [
              ...items,
              ...baselineItems,
              ...revisions.flatMap(
                (r) => (r.snapshot as unknown as Snapshot).items,
              ),
            ].flatMap((i) => i.evidenceVersionIds),
          ),
        ];
        const originals = await tx.documentVersion.findMany({
          where: {
            id: { in: evidenceIds },
            companyId,
            document: { companyId, leaseId: p.leaseId },
          },
          select: {
            id: true,
            documentId: true,
            number: true,
            filename: true,
            scanStatus: true,
            document: { select: { title: true, archivedAt: true } },
          },
        });
        const comparison = items.map((item) => ({
          itemKey: item.key,
          before:
            baselineItems.find((i) => identity(i) === identity(item)) || null,
          after: item,
        }));
        return {
          inspection: row,
          baseline: baselineRow,
          comparison,
          baselineOnly: baselineItems.filter(
            (i) => !items.some((current) => identity(current) === identity(i)),
          ),
          originals,
          revisions: revisions.slice(0, 25).map(({ actorId, ...r }) => ({
            ...r,
            actorName:
              people.find((p) => p.id === actorId)?.name || "Recorded teammate",
          })),
          nextBeforeVersion:
            revisions.length > 25 ? revisions[24].version : null,
        };
      });
    },
  );
  server.post<{ Params: Params }>(base, auth, (request) => {
    mutation(request, origin);
    cleanQuery(request);
    const leaseId = assignmentId(request.params.leaseId),
      b = input(request, [
        "kind",
        "inspectedOn",
        "items",
        "baselineRevisionId",
        "submissionKey",
      ]);
    const kind = choice(b.kind, ["move_in", "move_out"], "inspection type"),
      inspectedOn = date(b.inspectedOn, "inspection date"),
      items = inspectionItems(b.items),
      baselineRevisionId =
        b.baselineRevisionId == null
          ? null
          : assignmentId(b.baselineRevisionId);
    const key = submission(b.submissionKey, [
      "create",
      leaseId,
      kind,
      inspectedOn.toISOString(),
      items,
      baselineRevisionId,
    ]);
    return run(request, async (tx, companyId) => {
      await source(tx, companyId, leaseId);
      const prior = await replay(tx, companyId, request, key);
      if (prior) return prior;
      if (
        (await tx.leaseInspection.count({ where: { companyId, leaseId } })) >=
        200
      )
        throw new AccessError(
          409,
          "INSPECTION_LIMIT",
          "This lease already has 200 retained inspections.",
        );
      await baseline(
        tx,
        companyId,
        leaseId,
        baselineRevisionId,
        kind,
        inspectedOn,
      );
      await evidence(tx, companyId, leaseId, items);
      const row = await tx.leaseInspection.create({
        data: {
          companyId,
          leaseId,
          kind,
          inspectedOn,
          items,
          baselineRevisionId,
        },
      });
      return retain(tx, companyId, request, row, "create", null, key);
    });
  });
  server.post<{ Params: Params }>(`${base}/:inspectionId`, auth, (request) => {
    mutation(request, origin);
    cleanQuery(request);
    const p = params(request.params),
      b = input(request, [
        "action",
        "inspectedOn",
        "items",
        "baselineRevisionId",
        "reason",
        "expectedVersion",
        "submissionKey",
      ]);
    const action = choice(
        b.action,
        ["edit", "submit", "complete", "reopen"],
        "inspection action",
      ),
      expectedVersion = version(b.expectedVersion);
    const reason =
      action === "complete" || action === "reopen"
        ? boundedText(b.reason, 1000, "Review reason")
        : null;
    if (
      action !== "edit" &&
      ["inspectedOn", "items", "baselineRevisionId"].some((k) =>
        Object.hasOwn(b, k),
      )
    )
      throw invalid(
        "Review actions use the saved inspection without replacing its observations.",
      );
    if (
      action !== "complete" &&
      action !== "reopen" &&
      Object.hasOwn(b, "reason")
    )
      throw invalid("Reason is only used for completion or reopening.");
    const edits =
      action === "edit"
        ? {
            inspectedOn: date(b.inspectedOn, "inspection date"),
            items: inspectionItems(b.items),
            baselineRevisionId:
              b.baselineRevisionId == null
                ? null
                : assignmentId(b.baselineRevisionId),
          }
        : null;
    const key = submission(b.submissionKey, [
      action,
      p,
      expectedVersion,
      reason,
      edits,
    ]);
    return run(request, async (tx, companyId) => {
      await source(tx, companyId, p.leaseId);
      let row = await record(tx, companyId, p);
      const prior = await replay(tx, companyId, request, key);
      if (prior) return prior;
      if (row.version !== expectedVersion) throw conflict();
      if (
        ((action === "edit" || action === "submit") &&
          row.status !== "in_progress") ||
        (action === "complete" && row.status !== "awaiting_review") ||
        (action === "reopen" && row.status === "in_progress")
      )
        throw new AccessError(
          409,
          "INSPECTION_STATE",
          "This action is unavailable for the inspection's current state. Reload and review it.",
        );
      if (edits) {
        await baseline(
          tx,
          companyId,
          p.leaseId,
          edits.baselineRevisionId,
          row.kind,
          edits.inspectedOn,
        );
        await evidence(tx, companyId, p.leaseId, edits.items);
      }
      if (action === "submit" || action === "complete") {
        const items = inspectionItems(row.items);
        ready(items);
        await evidence(tx, companyId, p.leaseId, items);
      }
      const status =
        action === "submit"
          ? "awaiting_review"
          : action === "complete"
            ? "completed"
            : "in_progress";
      await tx.leaseInspection
        .updateMany({
          where: {
            id: row.id,
            leaseId: p.leaseId,
            companyId,
            version: expectedVersion,
          },
          data: { ...(edits || {}), status, version: { increment: 1 } },
        })
        .then((r) => {
          if (!r.count) throw conflict();
        });
      row = await record(tx, companyId, p);
      return retain(tx, companyId, request, row, action, reason, key);
    });
  });
}
