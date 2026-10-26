import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError, requirePermission } from "./access.js";
import { assignmentId, serializable } from "./application.js";
import { date, scoped, type Tx } from "./operational.js";
import { FEATURE_CATALOG, routeFeatures } from "./company-features.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const USAGE_DEFINITION = "Successful API requests by feature area, including repeated requests and retries. Impersonation, administration and billing views are excluded. Tracking begins after activation; earlier activity is not backfilled. Activity counts do not determine monthly subscription charges.";

export function usageRange(query: Record<string, unknown>, now = new Date()) {
  if (Object.keys(query).some(key => key !== "from" && key !== "to"))
    throw new AccessError(400, "INVALID_INPUT", "Choose only usage start and end dates.");
  const today = now.toISOString().slice(0, 10);
  const from = query.from === undefined ? `${today.slice(0, 7)}-01` : query.from;
  const to = query.to === undefined ? today : query.to;
  const start = date(from, "usage start date"), end = date(to, "usage end date");
  if (start.getTime() > end.getTime() || end.getTime() - start.getTime() >= 366 * DAY_MS)
    throw new AccessError(400, "INVALID_INPUT", "Choose a usage period of 1 to 366 days, with the start before the end.");
  return { from: start, to: end };
}

async function usage(tx: Tx, companyId: string, range: ReturnType<typeof usageRange>) {
  await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
  const [activity, first, properties, activeUnits, activeLeases, activeMembers, documents] = await Promise.all([
    tx.companyFeatureUsage.groupBy({
      by: ["area"],
      where: { companyId, day: { gte: range.from, lte: range.to } },
      _sum: { successfulReads: true, successfulWrites: true },
    }),
    tx.companyFeatureUsage.findFirst({ where: { companyId }, orderBy: { day: "asc" }, select: { day: true } }),
    tx.property.count({ where: { companyId } }),
    tx.unit.count({ where: { companyId, status: "active" } }),
    tx.lease.count({ where: { companyId, status: "active" } }),
    tx.companyMembership.count({ where: { companyId, status: "active", user: { status: "active" } } }),
    tx.documentVersion.aggregate({ where: { companyId }, _count: { id: true }, _sum: { byteLength: true } }),
  ]);
  const totals = new Map(activity.map(row => [row.area, row._sum]));
  return {
    companyId,
    timezone: "UTC",
    from: range.from.toISOString().slice(0, 10),
    to: range.to.toISOString().slice(0, 10),
    areas: FEATURE_CATALOG.map(area => {
      const counts = totals.get(area.key);
      const successfulReads = counts?.successfulReads ?? 0, successfulWrites = counts?.successfulWrites ?? 0;
      return { key: area.key, label: area.label, successfulReads, successfulWrites, total: successfulReads + successfulWrites };
    }),
    resources: {
      properties, activeUnits, activeLeases, activeMembers,
      documentVersions: documents._count.id,
      documentBytes: documents._sum.byteLength ?? 0,
    },
    resourceDefinitions: {
      properties: "All retained properties.",
      activeUnits: "Units currently marked active; archived units are excluded.",
      activeLeases: "Leases currently marked active; drafts and ended leases are excluded.",
      activeMembers: "Active company memberships with active accounts, across all company roles.",
      documentVersions: "Every retained document version, including unscanned or historically rejected versions and versions of archived documents.",
      documentBytes: "Stored bytes across all retained document versions.",
    },
    trackingStartedAt: first?.day.toISOString() ?? null,
    definition: USAGE_DEFINITION,
  };
}

export function registerCompanyUsage(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
) {
  server.addHook("onResponse", async (request, reply) => {
    const actor = request.principal, membership = actor?.membership;
    if (request.impersonation || !actor || actor.status !== "active" || actor.emailVerified === false ||
        !membership || membership.status !== "active" || membership.company.status !== "active" ||
        reply.statusCode < 200 || reply.statusCode >= 400)
      return;
    const path = request.routeOptions.url ?? "";
    if (!path.startsWith("/api/") || path.startsWith("/api/platform/") || path.startsWith("/api/auth/") ||
        ["/api/bootstrap", "/api/telemetry", "/api/company/usage", "/api/company/subscription"].some(excluded => path === excluded || path.startsWith(`${excluded}/`)) ||
        path.startsWith("/api/company/billing"))
      return;
    const area = routeFeatures(path)[0];
    if (!area) return;
    const isRead = ["GET", "HEAD", "OPTIONS"].includes(request.method);
    const day = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    try {
      await db.companyFeatureUsage.upsert({
        where: { companyId_area_day: { companyId: membership.companyId, area, day } },
        create: { companyId: membership.companyId, area, day, successfulReads: isRead ? 1 : 0, successfulWrites: isRead ? 0 : 1 },
        update: isRead ? { successfulReads: { increment: 1 } } : { successfulWrites: { increment: 1 } },
      });
    } catch {
      // This is best-effort product analytics. An unavailable counter never
      // changes an already-completed business result or triggers a retry.
      request.log.warn({ code: "COMPANY_USAGE_RECORD_FAILED" }, "Company usage tracking is unavailable");
    }
  });

  const auth = { preValidation: authenticate };
  server.get<{ Params: { companyId: string }; Querystring: Record<string, unknown> }>(
    "/api/platform/companies/:companyId/usage", auth, request => {
      requirePermission(request.principal!, "platform.manage");
      const companyId = assignmentId(request.params.companyId), range = usageRange(request.query);
      return serializable(db, async tx => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${request.principal!.id} FOR SHARE`;
        const actor = await tx.user.findUnique({ where: { id: request.principal!.id }, include: { membership: { include: { company: true } } } });
        if (!actor) throw new AccessError(403, "ACCESS_DENIED", "Access is unavailable.");
        requirePermission(actor, "platform.manage");
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId} FOR SHARE`;
        const company = await tx.company.findUnique({ where: { id: companyId }, select: { id: true } });
        if (!company) throw new AccessError(404, "NOT_FOUND", "Company not found.");
        return usage(tx, company.id, range);
      });
    },
  );
  server.get<{ Querystring: Record<string, unknown> }>("/api/company/usage", auth, (request: FastifyRequest<{ Querystring: Record<string, unknown> }>) => {
    const range = usageRange(request.query);
    return scoped(db, request, "subscription.read", (tx, companyId) => usage(tx, companyId, range));
  });
}
