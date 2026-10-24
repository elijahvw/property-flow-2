import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessError, COMPANY_ROLES, defaultDestination, requirePermission } from "./access.js";
import { assignmentId, opaqueUserId, serializable } from "./application.js";
import { boundedText, input, mutation, page, type Tx } from "./operational.js";
import { validSession } from "./sessions.js";

export const IMPERSONATION_MS = 30 * 60 * 1000;
const includeAccess = { membership: { include: { company: true } } } as const;
const directorySelect = {
  id: true, name: true, email: true,
  membership: { select: { companyId: true, role: true, company: { select: { id: true, name: true } } } },
} as const;
const supportSelect = {
  id: true, name: true, email: true, status: true, emailVerified: true,
  platformRole: true, updatedAt: true, _count: { select: { identities: true } },
} as const;
const clearImpersonation = {
  impersonatedUserId: null, impersonationExpiresAt: null, impersonationReason: null,
  impersonationCompanyId: null, impersonationMembershipVersion: null,
} as const;
const unavailable = () => new AccessError(403, "IMPERSONATION_UNAVAILABLE", "This user is unavailable for impersonation. Choose an active, verified company member.");
const contextChanged = () => new AccessError(409, "IMPERSONATION_CONTEXT_CHANGED", "Your session changed in another tab. Reload before continuing.");
const actorId = (request: FastifyRequest) => request.sessionActor?.id ?? request.principal!.id;

async function lockUsers(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort())
    await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${id} RETURNING id`;
}
async function lockedSession(tx: Tx, request: FastifyRequest) {
  const tokenHash = request.appSession!.tokenHash;
  await tx.$queryRaw`UPDATE "Session" SET "tokenHash"="tokenHash" WHERE "tokenHash"=${tokenHash} RETURNING "tokenHash"`;
  const session = await tx.session.findUnique({ where: { tokenHash } });
  if (!session || !validSession(session) || session.userId !== actorId(request))
    throw new AccessError(401, "SIGN_IN_REQUIRED", "Sign in to continue.");
  if (session.impersonatedUserId !== request.appSession!.impersonatedUserId ||
      session.impersonationExpiresAt?.getTime() !== request.appSession!.impersonationExpiresAt?.getTime())
    throw contextChanged();
  return session;
}
function queryOf(request: FastifyRequest, allowed: string[]) {
  const query = request.query as Record<string, unknown>;
  if (Object.keys(query).some(key => !allowed.includes(key)))
    throw new AccessError(400, "INVALID_INPUT", "Choose valid directory filters.");
  const q = query.q === undefined || query.q === "" ? undefined : boundedText(query.q, 200, "Search");
  const cursor = query.cursor === undefined ? undefined : opaqueUserId(query.cursor);
  return { query, q, cursor };
}
function search(q?: string): Prisma.UserWhereInput {
  return q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { membership: { company: { name: { contains: q, mode: "insensitive" } } } }] } : {};
}
function supportRow(row: Prisma.UserGetPayload<{ select: typeof supportSelect }>) {
  const { _count, ...user } = row;
  return { ...user, hasIdentity: _count.identities > 0 };
}

export function registerImpersonation(
  server: FastifyInstance,
  db: PrismaClient,
  origin: string,
  authenticate: preValidationHookHandler,
) {
  const auth = { preValidation: authenticate };
  server.get("/api/impersonation/users", auth, async request => {
    requirePermission(request.principal!, "platform.impersonate");
    const { query, q, cursor } = queryOf(request, ["q", "role", "companyId", "cursor"]);
    if (query.role !== undefined && !COMPANY_ROLES.includes(query.role as any))
      throw new AccessError(400, "INVALID_ROLE", "Choose a company role.");
    const companyId = query.companyId === undefined ? undefined : assignmentId(query.companyId);
    return page(await db.user.findMany({
      where: {
        status: "active", emailVerified: true, platformRole: null,
        ...(cursor ? { id: { gt: cursor } } : {}), ...search(q),
        membership: { status: "active", role: (query.role as string | undefined) ?? { in: [...COMPANY_ROLES] }, companyId, company: { status: "active" } },
      },
      select: directorySelect, orderBy: { id: "asc" }, take: 51,
    }));
  });

  server.get("/api/platform/support-access", auth, async request => {
    requirePermission(request.principal!, "platform.manage");
    const { q, cursor } = queryOf(request, ["q", "cursor"]);
    const rows = await db.user.findMany({
      where: { ...(cursor ? { id: { gt: cursor } } : {}), ...search(q) },
      select: supportSelect, orderBy: { id: "asc" }, take: 51,
    });
    return page(rows.map(supportRow));
  });

  server.patch<{ Params: { userId: string } }>("/api/platform/users/:userId/support-access", auth, async request => {
    requirePermission(request.principal!, "platform.manage");
    mutation(request, origin);
    const targetId = opaqueUserId(request.params.userId);
    const body = input(request, ["enabled", "updatedAt"]);
    if (typeof body.enabled !== "boolean" || typeof body.updatedAt !== "string" || !Number.isFinite(Date.parse(body.updatedAt)))
      throw new AccessError(400, "INVALID_INPUT", "Choose support access and submit the current record version.");
    return serializable(db, async tx => {
      await lockUsers(tx, [actorId(request), targetId]);
      await lockedSession(tx, request);
      const actor = await tx.user.findUnique({ where: { id: actorId(request) }, include: includeAccess });
      if (!actor) throw new AccessError(403, "ACCESS_DENIED", "Access is unavailable.");
      requirePermission(actor, "platform.manage");
      const target = await tx.user.findUnique({ where: { id: targetId }, select: supportSelect });
      if (!target) throw new AccessError(404, "NOT_FOUND", "User not found.");
      if (target.platformRole === "owner" || target.id === actor.id)
        throw new AccessError(403, "OWNER_PROTECTED", "Platform owner access cannot be changed here.");
      if (target.updatedAt.toISOString() !== body.updatedAt)
        throw new AccessError(409, "RECORD_CHANGED", "This account changed. Reload before changing support access.");
      if (body.enabled && (target.status !== "active" || !target.emailVerified || !target._count.identities))
        throw new AccessError(409, "SUPPORT_UNAVAILABLE", "Support access requires an active, verified sign-in account.");
      if (target.platformRole !== null && target.platformRole !== "support")
        throw new AccessError(403, "ACCESS_DENIED", "This account's platform role cannot be changed here.");
      const next = body.enabled ? "support" : null;
      if (target.platformRole === next) return supportRow(target);
      const updated = await tx.user.update({ where: { id: targetId }, data: { platformRole: next }, select: supportSelect });
      if (!body.enabled) {
        const sessions = await tx.session.findMany({ where: { userId: targetId, impersonatedUserId: { not: null } } });
        for (const session of sessions) {
          await tx.auditEvent.create({ data: {
            actorId: targetId, companyId: session.impersonationCompanyId,
            targetId: session.impersonatedUserId, action: "impersonation.revoked", requestId: request.id,
            detail: { revokedBy: actor.id },
          } });
        }
        // Keep the selected identity visible until an explicit stop. Expiring
        // persisted contexts also prevents a later regrant from reviving them.
        await tx.session.updateMany({ where: { userId: targetId, impersonatedUserId: { not: null } }, data: { impersonationExpiresAt: new Date(0) } });
      }
      await tx.auditEvent.create({ data: {
        actorId: actor.id, targetId, action: body.enabled ? "platform.support.granted" : "platform.support.revoked", requestId: request.id,
      } });
      return supportRow(updated);
    });
  });

  server.post("/api/impersonation", auth, async request => {
    requirePermission(request.principal!, "platform.impersonate");
    mutation(request, origin);
    const body = input(request, ["userId", "reason"]);
    const targetId = opaqueUserId(body.userId);
    const reason = boundedText(body.reason, 200, "Support reason");
    return serializable(db, async tx => {
      await lockUsers(tx, [actorId(request), targetId]);
      const session = await lockedSession(tx, request);
      if (session.impersonatedUserId)
        throw new AccessError(409, "IMPERSONATION_ACTIVE", "End the current impersonation before starting another.");
      const actor = await tx.user.findUnique({ where: { id: session.userId }, include: includeAccess });
      if (!actor) throw new AccessError(403, "ACCESS_DENIED", "Access is unavailable.");
      requirePermission(actor, "platform.impersonate");
      const target = await tx.user.findUnique({ where: { id: targetId }, include: includeAccess });
      if (!target || target.id === actor.id || target.platformRole || target.status !== "active" || !target.emailVerified ||
          !target.membership || target.membership.status !== "active" || target.membership.company.status !== "active" ||
          !COMPANY_ROLES.includes(target.membership.role as any)) throw unavailable();
      // Freeze the selected company and grant version. A transfer or access edit
      // ends this support view rather than following the person to another scope.
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${target.membership.companyId} FOR SHARE`;
      const expiresAt = new Date(Math.min(Date.now() + IMPERSONATION_MS, session.expiresAt.getTime(), session.idleExpiresAt.getTime()));
      await tx.session.update({ where: { tokenHash: session.tokenHash }, data: {
        impersonatedUserId: target.id, impersonationExpiresAt: expiresAt, impersonationReason: reason,
        impersonationCompanyId: target.membership.companyId, impersonationMembershipVersion: target.membership.version,
      } });
      await tx.auditEvent.create({ data: {
        actorId: actor.id, targetId: target.id, companyId: target.membership.companyId,
        action: "impersonation.started", requestId: request.id,
        detail: { reason, role: target.membership.role, expiresAt: expiresAt.toISOString(), readOnly: true },
      } });
      return { destination: defaultDestination(target) };
    });
  });

  server.delete("/api/impersonation", auth, async request => {
    mutation(request, origin);
    return serializable(db, async tx => {
      await lockUsers(tx, [actorId(request)]);
      const session = await lockedSession(tx, request);
      if (session.impersonatedUserId) {
        await tx.session.update({ where: { tokenHash: session.tokenHash }, data: clearImpersonation });
        await tx.auditEvent.create({ data: {
          actorId: session.userId, targetId: session.impersonatedUserId, companyId: session.impersonationCompanyId,
          action: "impersonation.ended", requestId: request.id,
          detail: { reason: session.impersonationReason, expiresAt: session.impersonationExpiresAt?.toISOString() ?? null, readOnly: true },
        } });
      }
      return { destination: "/platform/impersonation" };
    });
  });
}
