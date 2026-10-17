import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AccessError, companyScope } from "./access.js";
import { assignmentId } from "./application.js";
import { audit, boundedText, conflict, input, mutation, page, paging, sameSubmission, scoped, submission, version, type Tx } from "./operational.js";

const entrySelect = {
  id: true, reference: true, occurredOn: true, amountCents: true,
  currency: true, category: true, memo: true, version: true,
  voidedAt: true, voidReason: true,
} as const;
const costSelect = {
  id: true, version: true, createdAt: true, unlinkedAt: true, unlinkReason: true,
  entry: { select: entrySelect },
} as const;

export function registerMaintenanceCosts(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string) {
  const auth = { preValidation: authenticate };
  const run = <T>(request: FastifyRequest, action: (tx: Tx, companyId: string) => Promise<T>) => {
    companyScope(request.principal!, "maintenance.manage", request.headers["x-company-id"]);
    return scoped(db, request, "finance.manage", async (tx, companyId) => {
      const current = await tx.user.findUniqueOrThrow({ where: { id: request.principal!.id }, include: { membership: { include: { company: true } } } });
      companyScope(current, "maintenance.manage", companyId);
      return action(tx, companyId);
    });
  };
  const requestRecord = async (tx: Tx, companyId: string, id: string) => {
    const row = await tx.maintenanceRequest.findFirst({ where: { id, companyId }, select: { id: true, propertyId: true, title: true } });
    if (!row) throw new AccessError(404, "NOT_FOUND", "Maintenance request not found.");
    return row;
  };
  const base = "/api/company/maintenance/:requestId/costs";
  server.get<{ Params: { requestId: string }; Querystring: { cursor?: string } }>(base, auth, request => {
    const id = assignmentId(request.params.requestId), cursor = paging(request.query);
    return run(request, async (tx, companyId) => {
      await requestRecord(tx, companyId, id);
      const rows = await tx.maintenanceCost.findMany({
        where: { companyId, requestId: id, ...(cursor ? { id: { lt: cursor } } : {}) },
        select: costSelect, orderBy: { id: "desc" }, take: 51,
      });
      const [totals] = await tx.$queryRaw<{ paid: bigint; count: bigint }[]>(Prisma.sql`
        SELECT COALESCE(SUM(e."amountCents"),0)::bigint paid,COUNT(*)::bigint count
        FROM "MaintenanceCost" c JOIN "LedgerEntry" e ON e.id=c."entryId" AND e."companyId"=c."companyId" AND e."propertyId"=c."propertyId"
        WHERE c."companyId"=${companyId} AND c."requestId"=${id} AND c."unlinkedAt" IS NULL AND e."voidedAt" IS NULL`);
      return { ...page(rows), summary: { paidCents: String(totals.paid), paidCount: Number(totals.count) } };
    });
  });
  server.get<{ Params: { requestId: string }; Querystring: { cursor?: string; q?: string } }>(`${base}/candidates`, auth, request => {
    const id = assignmentId(request.params.requestId), q = request.query;
    if (Object.keys(q).some(key => !["cursor", "q"].includes(key)) || (q.q !== undefined && (typeof q.q !== "string" || q.q.length > 200 || q.q.includes("\0"))))
      throw new AccessError(400, "INVALID_INPUT", "Search must be at most 200 characters; choose only the available filters.");
    const cursor = q.cursor === undefined ? undefined : assignmentId(q.cursor), search = q.q?.trim();
    return run(request, async (tx, companyId) => {
      const row = await requestRecord(tx, companyId, id);
      return page(await tx.ledgerEntry.findMany({
        where: {
          companyId, propertyId: row.propertyId, kind: "expense", voidedAt: null,
          maintenanceCosts: { none: { companyId, unlinkedAt: null } },
          ...(cursor ? { id: { lt: cursor } } : {}),
          ...(search ? { OR: [{ reference: { contains: search, mode: "insensitive" as const } }, { memo: { contains: search, mode: "insensitive" as const } }] } : {}),
        }, select: entrySelect, orderBy: { id: "desc" }, take: 51,
      }));
    });
  });
  server.post<{ Params: { requestId: string } }>(base, auth, request => {
    mutation(request, origin);
    const id = assignmentId(request.params.requestId), b = input(request, ["entryId", "expectedEntryVersion", "submissionKey"]),
      entryId = assignmentId(b.entryId), expectedEntryVersion = version(b.expectedEntryVersion),
      key = submission(b.submissionKey, [id, entryId, expectedEntryVersion]);
    return run(request, async (tx, companyId) => {
      const row = await requestRecord(tx, companyId, id);
      const previous = await tx.maintenanceCost.findFirst({
        where: { companyId, createdById: request.principal!.id, submissionKey: key.submissionKey },
        select: { ...costSelect, submissionHash: true },
      });
      if (previous) {
        sameSubmission(previous.submissionHash, key.submissionHash);
        const { submissionHash: _hash, ...safe } = previous;
        return safe;
      }
      // Order linking against expense correction without changing its version or money.
      await tx.$queryRaw`UPDATE "LedgerEntry" SET version=version WHERE id=${entryId} AND "companyId"=${companyId} AND "propertyId"=${row.propertyId} RETURNING id`;
      const entry = await tx.ledgerEntry.findFirst({ where: { id: entryId, companyId, propertyId: row.propertyId }, select: { ...entrySelect, kind: true } });
      if (!entry) throw new AccessError(404, "NOT_FOUND", "Expense not found in this property.");
      if (entry.version !== expectedEntryVersion) throw conflict();
      if (entry.kind !== "expense" || entry.voidedAt) throw new AccessError(409, "EXPENSE_UNAVAILABLE", "Choose an unvoided paid expense.");
      if (await tx.maintenanceCost.findFirst({ where: { companyId, entryId, unlinkedAt: null }, select: { id: true } }))
        throw new AccessError(409, "EXPENSE_ALREADY_LINKED", "This expense is already linked to maintenance. Review its current request before linking it elsewhere.");
      const linked = await tx.maintenanceCost.create({ data: { companyId, propertyId: row.propertyId, requestId: id, entryId, createdById: request.principal!.id, ...key }, select: costSelect });
      await audit(tx, request, companyId, id, "maintenance.cost.linked", { linkId: linked.id, entryId });
      return linked;
    }).catch(error => {
      if (error?.code === "P2002") throw new AccessError(409, "EXPENSE_ALREADY_LINKED", "This expense was linked by another request. Refresh and review the current records.");
      throw error;
    });
  });
  server.post<{ Params: { requestId: string; costId: string } }>(`${base}/:costId/unlink`, auth, request => {
    mutation(request, origin);
    const id = assignmentId(request.params.requestId), costId = assignmentId(request.params.costId), b = input(request, ["expectedVersion", "reason"]),
      expectedVersion = version(b.expectedVersion), reason = boundedText(b.reason, 300, "Correction reason");
    return run(request, async (tx, companyId) => {
      await requestRecord(tx, companyId, id);
      const previous = await tx.maintenanceCost.findFirst({ where: { id: costId, requestId: id, companyId }, select: { ...costSelect, unlinkedById: true } });
      if (!previous) throw new AccessError(404, "NOT_FOUND", "Cost link not found.");
      if (previous.unlinkedAt) {
        if (previous.unlinkReason !== reason || previous.unlinkedById !== request.principal!.id) throw conflict();
        const { unlinkedById: _actor, ...safe } = previous;
        return safe;
      }
      if (previous.version !== expectedVersion) throw conflict();
      const result = await tx.maintenanceCost.updateMany({ where: { id: costId, requestId: id, companyId, version: expectedVersion, unlinkedAt: null }, data: { unlinkedAt: new Date(), unlinkedById: request.principal!.id, unlinkReason: reason, version: { increment: 1 } } });
      if (result.count !== 1) throw conflict();
      await audit(tx, request, companyId, id, "maintenance.cost.unlinked", { linkId: costId, entryId: previous.entry.id, reason });
      return tx.maintenanceCost.findFirstOrThrow({ where: { id: costId, companyId, requestId: id }, select: costSelect });
    });
  });
}
