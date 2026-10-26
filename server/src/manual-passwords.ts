import { createHash, createHmac, hkdfSync } from "node:crypto";
import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import type { ManualPasswordOperation, PrismaClient } from "@prisma/client";
import { AccessError, companyScope, requirePermission } from "./access.js";
import { opaqueUserId, serializable } from "./application.js";
import { input, mutation, sameSubmission, submission, type Tx } from "./operational.js";
import { IdentityProviderError, type IdentityProvider } from "./identity-provider.js";
import { assertDemoIdentityAvailable } from "./demo-identity-guard.js";
import { assertPasswordOperationAvailable } from "./manual-password-guard.js";

const include = { identities: true, membership: { include: { company: true } } } as const;
const failure = () => new AccessError(409, "PASSWORD_REVIEW_CHANGED", "The account or its access changed. Refresh the password review before continuing.");
const pending = () => new AccessError(409, "PASSWORD_OPERATION_IN_PROGRESS", "This password attempt needs completion or review. Check its status before starting another.");
const safe = (operation: { id: string; userId: string; status: string; leaseUntil: Date; createdAt: Date; completedAt: Date | null }) => ({ id: operation.id, userId: operation.userId, status: operation.status, reviewAfter: operation.leaseUntil, createdAt: operation.createdAt, completedAt: operation.completedAt });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function registerManualPasswords(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string, provider?: IdentityProvider, secret = process.env.AUTH0_WEB_CLIENT_SECRET || "") {
  const auth = { preValidation: authenticate };
  const protection = () => {
    if (!secret) throw new AccessError(503, "PASSWORD_CHANGE_UNAVAILABLE", "Administrative password protection is not configured.");
    return Buffer.from(hkdfSync("sha256", secret, "propertyflow", "manual-password-request-v1", 32));
  };
  const configured = () => {
    if (!provider?.setPassword) throw new AccessError(503, "PASSWORD_CHANGE_UNAVAILABLE", "The identity connection cannot set passwords. Contact the platform administrator.");
    return provider;
  };
  async function checked<T>(request: FastifyRequest, targetId: string, platform: boolean, run: (tx: Tx, context: Awaited<ReturnType<typeof resolve>>) => Promise<T>, recovery = false) {
    if (platform) requirePermission(request.principal!, "platform.manage");
    else companyScope(request.principal!, "members.manage", request.headers["x-company-id"]);
    return serializable(db, async tx => {
      for (const id of [...new Set([request.principal!.id, targetId])].sort()) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR UPDATE`;
      return run(tx, await resolve(tx, request, targetId, platform, recovery));
    });
  }
  async function resolve(tx: Tx, request: FastifyRequest, targetId: string, platform: boolean, recovery: boolean) {
    const actor = await tx.user.findUnique({ where: { id: request.principal!.id }, include });
    if (!actor) throw new AccessError(403, "ACCESS_DENIED", "Access is unavailable.");
    if (request.impersonation) throw new AccessError(403, "IMPERSONATION_READ_ONLY", "Return to your own account before setting a password.");
    const companyId = platform ? (requirePermission(actor, "platform.manage"), null) : companyScope(actor, "members.manage", request.headers["x-company-id"]);
    if (companyId) {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId} FOR SHARE`;
      const company = await tx.company.findUnique({ where: { id: companyId }, select: { status: true } });
      if (company?.status !== "active") throw new AccessError(403, "COMPANY_ACCESS_DENIED", "This company is no longer active.");
      await tx.$queryRaw`SELECT set_config('app.company_id',${companyId},true)`;
    }
    const target = await tx.user.findUnique({ where: { id: targetId }, include });
    if (!target || companyId && (target.platformRole || target.membership?.companyId !== companyId || target.membership.status !== "active"))
      throw new AccessError(404, "NOT_FOUND", "User not found in your permitted account scope.");
    if (!platform && target.status !== "active") throw new AccessError(409, "ACCOUNT_DISABLED", "This account is disabled. Review account status before setting a password.");
    const connection = provider?.setPassword ? provider : undefined;
    const identity = connection && target.identities.find(identity => identity.issuer === connection.issuer);
    const unavailableReason = target.status !== "active" ? "This account is disabled. Existing password attempts can still be reviewed; new password writes are unavailable." :
      !connection ? "The identity connection cannot set passwords. Existing attempts can still be reviewed without provider access." :
      !identity?.subject.startsWith("auth0|") ? "This account's exact email/password identity needs review. Existing attempts can still be reviewed." :
      !secret ? "Administrative password protection is not configured. Existing attempts can still be reviewed." : null;
    if (!recovery && unavailableReason) throw new AccessError(409, "PASSWORD_CHANGE_UNAVAILABLE", unavailableReason);
    const context = { userId: target.id, email: target.email, updatedAt: target.updatedAt.toISOString(), identityId: identity?.id ?? null, issuer: identity?.issuer ?? null, subject: identity?.subject ?? null,
      companyId, targetPlatformRole: target.platformRole, membership: target.membership && { companyId: target.membership.companyId, role: target.membership.role, status: target.membership.status, version: target.membership.version },
      actorCompany: actor.membership && { companyId: actor.membership.companyId, role: actor.membership.role, status: actor.membership.status, version: actor.membership.version }, actorPlatformRole: actor.platformRole };
    return { target, companyId, identity: identity!, canSetPassword: !unavailableReason, unavailableReason, contextHash: hash(context) };
  }
  async function finish(operation: ManualPasswordOperation, status: "applied" | "failed" | "uncertain", request: FastifyRequest, dispatched: boolean) {
    return serializable(db, async tx => {
      // Match access/release lock order. A released or terminal attempt never
      // becomes active again, even when an old provider response arrives late.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${operation.userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "ManualPasswordOperation" WHERE id=${operation.id} FOR UPDATE`;
      const current = await tx.manualPasswordOperation.findUniqueOrThrow({ where: { id: operation.id } });
      if (current.status !== "pending") return current.status === "applied" && status === "applied" ? current : null;
      const changed = await tx.manualPasswordOperation.updateMany({ where: { id: operation.id, status: "pending" }, data: { status, completedAt: new Date() } });
      if (!changed.count) return null;
      if (dispatched) {
        await tx.user.update({ where: { id: operation.userId }, data: { credentialChangedAt: new Date() } });
        await tx.session.deleteMany({ where: { OR: [{ userId: operation.userId }, { impersonatedUserId: operation.userId }] } });
      }
      await tx.auditEvent.create({ data: { actorId: operation.actorId, companyId: operation.companyId, targetId: operation.userId, action: status === "failed" ? "user.password_change.rejected" : "user.password_change." + status, requestId: request.id, detail: { operationId: operation.id } } });
      return tx.manualPasswordOperation.findUniqueOrThrow({ where: { id: operation.id } });
    });
  }

  for (const platform of [true, false]) {
    const base = platform ? "/api/platform/users/:userId/password" : "/api/company/users/:userId/password";
    server.get<{ Params: { userId: string } }>(base, auth, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const query = request.query as Record<string, unknown>;
      if (Object.keys(query).some(key => key !== "submissionKey")) throw new AccessError(400, "INVALID_INPUT", "Choose only the password attempt to review.");
      const key = query.submissionKey === undefined ? null : submission(query.submissionKey, null).submissionKey;
      return checked(request, opaqueUserId(request.params.userId), platform, async (tx, context) => {
        const operation = key ? await tx.manualPasswordOperation.findUnique({ where: { actorId_submissionKey: { actorId: request.principal!.id, submissionKey: key } } })
          : await tx.manualPasswordOperation.findFirst({ where: { userId: context.target.id, status: { in: ["pending", "uncertain"] } }, orderBy: { createdAt: "desc" } });
        if (operation && operation.userId !== context.target.id) throw new AccessError(404, "NOT_FOUND", "Password attempt not found.");
        return { userId: context.target.id, name: context.target.name, email: context.target.email, reviewHash: context.canSetPassword ? context.contextHash : null, canSetPassword: context.canSetPassword, unavailableReason: context.unavailableReason, operation: operation && safe(operation) };
      }, true);
    });
    server.post<{ Params: { userId: string } }>(base, { ...auth, bodyLimit: 4096, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
      mutation(request, origin); reply.header("Cache-Control", "no-store");
      const body = input(request, ["password", "confirmation", "reviewHash", "submissionKey"]), userId = opaqueUserId(request.params.userId);
      if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128 || body.password.includes("\0") || body.confirmation !== body.password)
        throw new AccessError(400, "INVALID_PASSWORD", "Enter matching passwords between 8 and 128 characters. The sign-in provider also applies its password policy.");
      if (typeof body.reviewHash !== "string" || !/^[a-f0-9]{64}$/.test(body.reviewHash)) throw failure();
      const password = body.password;
      const key = submission(body.submissionKey, null);
      // Keyed fingerprint is bound to this payload, actor, account and review.
      // A database reader cannot test candidate passwords without the app key.
      const fingerprint = createHmac("sha256", protection()).update(JSON.stringify([request.principal!.id, userId, body.reviewHash, password])).digest("hex");
      const operation = await checked(request, userId, platform, async (tx, context) => {
        const existing = await tx.manualPasswordOperation.findUnique({ where: { actorId_submissionKey: { actorId: request.principal!.id, submissionKey: key.submissionKey } } });
        if (existing) { sameSubmission(existing.submissionHash, fingerprint); return existing; }
        if (context.contextHash !== body.reviewHash) throw failure();
        await assertDemoIdentityAvailable(tx, userId);
        await assertPasswordOperationAvailable(tx, userId);
        const row = await tx.manualPasswordOperation.create({ data: { actorId: request.principal!.id, userId, companyId: context.companyId, issuer: context.identity.issuer, subject: context.identity.subject,
          submissionKey: key.submissionKey, submissionHash: fingerprint, contextHash: context.contextHash, leaseUntil: new Date(Date.now() + 60000) } });
        await tx.auditEvent.create({ data: { actorId: row.actorId, companyId: row.companyId, targetId: userId, action: "user.password_change.requested", requestId: request.id, detail: { operationId: row.id } } });
        return row;
      });
      if (operation.status === "applied") return { ...safe(operation), message: "Password set. Existing Property Flow sessions were revoked." };
      if (operation.status !== "pending") throw new AccessError(409, "PASSWORD_ATTEMPT_FINISHED", "This attempt already finished or needs review. Refresh its status; a new attempt requires a fresh review and password entry.");
      // Only the request which created the receipt owns provider execution.
      // A concurrent/replayed POST must never repeat a password write.
      const claimed = await checked(request, userId, platform, async (tx, context) => {
        const row = await tx.manualPasswordOperation.findUniqueOrThrow({ where: { id: operation.id } });
        if (row.status !== "pending" || row.startedAt || row.leaseUntil.getTime() <= Date.now()) throw pending();
        if (row.contextHash !== context.contextHash) throw failure();
        const updated = await tx.manualPasswordOperation.updateMany({ where: { id: row.id, status: "pending", startedAt: null }, data: { startedAt: new Date() } });
        if (!updated.count) throw pending();
        return context;
      });
      let dispatched = false;
      try {
        const remote = await configured().get(operation.subject);
        if (remote.user_id !== operation.subject || remote.email !== claimed.target.email || remote.blocked || !remote.identities?.some(identity => identity.provider === "auth0" && identity.connection === configured().databaseConnection))
          throw new AccessError(409, "PASSWORD_CHANGE_UNAVAILABLE", "Only the exact existing email/password sign-in account can be changed here. Its identity or provider requires review.");
        // Recheck authority and the frozen target immediately before provider write.
        await checked(request, userId, platform, async (tx, context) => {
          const current = await tx.manualPasswordOperation.findUniqueOrThrow({ where: { id: operation.id } });
          if (current.status !== "pending" || current.leaseUntil.getTime() <= Date.now()) throw pending();
          if (context.contextHash !== operation.contextHash) throw failure();
          // Commit dispatch authority and invalidate known-old demo sheets before
          // external work. Even a crashed or unconfirmed provider response must
          // not leave old Property Flow sessions or issued demo passwords trusted.
          await tx.user.update({ where: { id: userId }, data: { credentialChangedAt: new Date() } });
          await tx.session.deleteMany({ where: { OR: [{ userId }, { impersonatedUserId: userId }] } });
          await tx.auditEvent.create({ data: { actorId: operation.actorId, companyId: operation.companyId, targetId: userId, action: "user.password_change.dispatched", requestId: request.id, detail: { operationId: operation.id } } });
        });
        dispatched = true;
        await configured().setPassword!(operation.subject, password, { deadline: operation.leaseUntil.getTime() });
      } catch (error) {
        const rejected = !dispatched || error instanceof AccessError && !(error instanceof IdentityProviderError) && error.code !== "PASSWORD_RESULT_UNCERTAIN" || error instanceof IdentityProviderError && ["rate_limit", "authentication", "permission", "rejected"].includes(error.failure);
        const recorded = await finish(operation, rejected ? "failed" : "uncertain", request, dispatched);
        if (!recorded) throw new AccessError(409, "PASSWORD_ATTEMPT_FINISHED", "This attempt was already released or finished. Its late response did not replace a newer attempt.");
        if (rejected) {
          if (error instanceof AccessError) throw error;
          throw new AccessError(503, "PASSWORD_CHANGE_FAILED", "The password change could not be prepared. No password write was dispatched; refresh the review before trying again.");
        }
        throw new AccessError(503, "PASSWORD_RESULT_UNCERTAIN", "The provider result is unconfirmed. The password is cleared from this form. Check this attempt, then explicitly release it after its review time before making another change.");
      }
      try {
        const row = await finish(operation, "applied", request, true);
        if (!row) throw new AccessError(409, "PASSWORD_ATTEMPT_FINISHED", "This attempt was already released or finished. Its late response did not replace a newer attempt.");
        return { ...safe(row), message: "Password set. Existing Property Flow sessions were revoked." };
      } catch (error) {
        if (error instanceof AccessError && error.code === "PASSWORD_ATTEMPT_FINISHED") throw error;
        await finish(operation, "uncertain", request, true).catch(() => null);
        throw new AccessError(503, "PASSWORD_RESULT_UNCERTAIN", "The password provider accepted the change but its local receipt could not be confirmed. Keep this attempt for review; do not repeat it automatically.");
      }
    });
    server.post<{ Params: { userId: string } }>(base + "/release", auth, async (request, reply) => {
      mutation(request, origin); reply.header("Cache-Control", "no-store");
      const body = input(request, ["operationId", "confirmed"]), userId = opaqueUserId(request.params.userId);
      if (typeof body.operationId !== "string" || body.confirmed !== true) throw new AccessError(400, "INVALID_INPUT", "Review the unconfirmed attempt before releasing it.");
      return checked(request, userId, platform, async (tx, context) => {
        const operation = await tx.manualPasswordOperation.findUnique({ where: { id: body.operationId as string } });
        if (!operation || operation.userId !== userId || !platform && operation.companyId !== context.companyId) throw new AccessError(404, "NOT_FOUND", "Password attempt not found.");
        if (["applied", "failed", "abandoned"].includes(operation.status)) return safe(operation);
        if (operation.leaseUntil.getTime() > Date.now()) throw new AccessError(409, "PASSWORD_REVIEW_WAIT", "Wait until this attempt's review time before releasing it. Its provider request may still be running.");
        const row = await tx.manualPasswordOperation.update({ where: { id: operation.id }, data: { status: "abandoned", completedAt: new Date() } });
        await tx.auditEvent.create({ data: { actorId: request.principal!.id, companyId: operation.companyId, targetId: userId, action: "user.password_change.released", requestId: request.id, detail: { operationId: operation.id, previousStatus: operation.status } } });
        return safe(row);
      }, true);
    });
  }
}
