import { randomBytes } from "node:crypto";
import type { Invitation, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import { AccessError, COMPANY_ROLES, companyScope, permissions } from "./access.js";
import { assignmentId, serializable } from "./application.js";
import { prepareAccount, saveAccount } from "./resident-accounts.js";
import type { IdentityProvider } from "./identity-provider.js";
import { audit, boundedText, choice, input, mutation, sameSubmission, submission, version, type Tx } from "./operational.js";
import { digest } from "./sessions.js";
import { teamInvitationAuthority } from "./invitation-access.js";
import { previewContactInvitation } from "./contact-invitations.js";
import { previewLeaseInvitation } from "./lease-invitations.js";
import { InvitationEmailError, type InvitationMailer } from "./invitation-email.js";

const select = { id: true, companyId: true, email: true, role: true, participantRole: true, contactId: true, leaseId: true, expiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true, version: true, deliveryStatus: true, deliveryRequestedAt: true, deliveryUpdatedAt: true, company: { select: { name: true } } } as const;
export const invitationUrl = (origin: string, row: Pick<Invitation, "leaseId" | "contactId">, token: string) => `${origin}/invite${row.leaseId ? "?lease=1" : row.contactId ? "?contact=1" : ""}#${token}`;
const publicReplay = <T extends { submissionHash: string | null }>(row:T) => { const {submissionHash: _hash,...result}=row;return result; };
const invalid = () => new AccessError(403, "INVITATION_INVALID", "This invitation has expired or been replaced. Ask your company owner for a new invitation.");

async function admin<T>(db: PrismaClient, request: FastifyRequest, companyId: string | undefined, run: (tx: Tx, companyId: string | undefined) => Promise<T>) {
  return serializable(db, async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${request.principal!.id} FOR SHARE`;
    const actor = await tx.user.findUniqueOrThrow({ where: { id: request.principal!.id }, include: { membership: { include: { company: true } } } });
    if (actor.status !== request.principal!.status || actor.emailVerified !== request.principal!.emailVerified || actor.membership?.companyId !== request.principal!.membership?.companyId || JSON.stringify(permissions(actor)) !== JSON.stringify(permissions(request.principal!))) throw new AccessError(403,"ACCESS_CHANGED","Your access changed. Refresh to continue.");
    const platform = permissions(actor).includes("platform.manage");
    const scope = platform ? companyId : companyScope(actor, "members.manage", companyId || request.headers["x-company-id"]);
    if (scope) {
      if (request.method === "GET") await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${scope} FOR SHARE`;
      else await tx.$queryRaw`UPDATE "Company" SET "updatedAt"="updatedAt" WHERE id=${scope} RETURNING id`;
      const company = await tx.company.findUnique({ where: { id: scope } });
      if (!company || company.status !== "active") throw new AccessError(403, "COMPANY_ACCESS_DENIED", "This company is unavailable.");
      await tx.$queryRaw`SELECT set_config('app.company_id',${scope},true)`;
    } else if (!platform) throw new AccessError(403, "ACCESS_DENIED", "Access is unavailable.");
    return run(tx, scope);
  });
}

export async function invitationSource(tx: Tx, row: Invitation) {
  if (row.leaseId) return previewLeaseInvitation(tx, row);
  if (row.contactId) return previewContactInvitation(tx, row);
  return { company: (await teamInvitationAuthority(tx, row)).name, role: row.role };
}

export function registerInvitations(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string, provider?: IdentityProvider, mailer?: InvitationMailer) {
  const auth = { preValidation: authenticate };
  server.get("/api/invitations/delivery", auth, async request => {
    await admin(db, request, undefined, async () => {});
    return { emailAvailable: !!mailer };
  });
  server.post("/api/invitations", auth, async request => {
    mutation(request, origin);
    const body = input(request, ["companyId", "email", "name", "role", "submissionKey"]);
    const companyId = permissions(request.principal!).includes("platform.manage") ? assignmentId(body.companyId) : companyScope(request.principal!, "members.manage", request.headers["x-company-id"]);
    if (body.companyId !== undefined && body.companyId !== companyId) throw new AccessError(403,"COMPANY_ACCESS_DENIED","Choose your current company before inviting someone.");
    const role = choice(body.role, [...COMPANY_ROLES], "company role"), email = boundedText(body.email, 254, "Email").toLowerCase();
    const name = body.name ? boundedText(body.name, 200, "Name") : email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccessError(400, "INVALID_EMAIL", "Enter a valid email address.");
    if (role === "owner" && !permissions(request.principal!).includes("platform.manage")) throw new AccessError(403, "OWNER_PROTECTED", "Only the platform owner can invite a company owner.");
    // Older open clients can omit the key; pending deduplication still prevents duplicates.
    const key = body.submissionKey === undefined ? undefined : submission(body.submissionKey, { companyId, email, name, role });
    const replay = await admin(db, request, companyId, async tx => {
      if (!key) return null;
      const row = await tx.invitation.findFirst({ where: { companyId, createdBy: request.principal!.id, submissionKey: key.submissionKey }, select: { ...select, submissionHash: true } });
      if (row) sameSubmission(row.submissionHash!, key.submissionHash);
      return row;
    });
    if (replay) return { ...publicReplay(replay), acceptanceUrl: null, recovered: true };
    const account = await prepareAccount(provider, email, name);
    const token = randomBytes(32).toString("base64url");
    return admin(db, request, companyId, async tx => {
      const existing = key && await tx.invitation.findFirst({ where: { companyId, createdBy: request.principal!.id, submissionKey: key.submissionKey }, select: { ...select, submissionHash: true } });
      if (existing) { sameSubmission(existing.submissionHash!, key!.submissionHash); return { ...publicReplay(existing), acceptanceUrl: null, recovered: true }; }
      const accountId = await saveAccount(tx, request, account, companyId);
      if (await tx.companyMembership.findUnique({where:{userId:accountId},select:{userId:true}})) throw new AccessError(409,"ALREADY_ASSIGNED","This account already belongs to a company. Manage its existing access from the person’s record instead of creating another invitation.");
      if (await tx.invitation.findFirst({ where: { companyId, email, leaseId: null, contactId: null, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } })) throw new AccessError(409, "INVITATION_EXISTS", "An invitation is already pending. Use its Send or replace action in invitation history.");
      const row = await tx.invitation.create({ data: { companyId, accountId, email, role, tokenHash: digest(token), createdBy: request.principal!.id, expiresAt: new Date(Date.now() + 72 * 3600000), ...key }, select });
      await audit(tx, request, companyId, row.id, "invitation.created", { role });
      return { ...row, acceptanceUrl: invitationUrl(origin, { leaseId: null, contactId: null }, token) };
    });
  });

  server.get("/api/invitations", auth, async request => {
    const q = request.query as Record<string, string>;
    if (Object.keys(q).some(k => !["audience", "companyId", "page", "q", "status"].includes(k))) throw new AccessError(400, "INVALID_INPUT", "Unknown invitation filter.");
    if (q.audience !== undefined) choice(q.audience, ["team", "tenants"], "invitation audience");
    if (q.status) choice(q.status, ["pending", "accepted", "expired", "revoked"], "invitation status");
    const page = q.page === undefined ? 1 : Number(q.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new AccessError(400, "INVALID_INPUT", "Choose a valid page.");
    const selected = q.companyId ? assignmentId(q.companyId) : q.audience || !permissions(request.principal!).includes("platform.manage") ? companyScope(request.principal!, "members.manage", request.headers["x-company-id"]) : undefined;
    return admin(db, request, selected, async (tx, companyId) => {
      const now = new Date(), where = { companyId, ...(q.audience === "team" ? { role: { not: "resident" } } : q.audience === "tenants" ? { role: "resident" } : {}),
        ...(q.q ? { email: { contains: boundedText(q.q, 200, "Search"), mode: "insensitive" as const } } : {}),
        ...(q.status === "accepted" ? { acceptedAt: { not: null } } : q.status === "revoked" ? { acceptedAt: null, revokedAt: { not: null } } : q.status === "expired" ? { acceptedAt: null, revokedAt: null, expiresAt: { lte: now } } : q.status === "pending" ? { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } : {}) };
      const items = await tx.invitation.findMany({ where, select, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 25, take: q.page === undefined ? 100 : 25 });
      return q.page === undefined ? items : { items, total: await tx.invitation.count({ where }), page, pageSize: 25 };
    });
  });

  server.post<{ Params: { invitationId: string } }>("/api/invitations/:invitationId/revoke", auth, async request => {
    mutation(request, origin);
    const body = input(request, ["expectedVersion"]), id = assignmentId(request.params.invitationId);
    const initial = await db.invitation.findUnique({ where: { id }, select: { companyId: true } });
    if (!initial) throw new AccessError(404, "NOT_FOUND", "Invitation not found.");
    return admin(db, request, initial.companyId, async tx => {
      const row = await tx.invitation.findFirst({ where: { id, companyId: initial.companyId, acceptedAt: null } });
      if (!row) throw new AccessError(404, "NOT_FOUND", "Pending invitation not found.");
      if (row.revokedAt) return { success: true };
      if (body.expectedVersion !== undefined && version(body.expectedVersion) !== row.version) throw new AccessError(409, "RECORD_CHANGED", "This invitation changed. Refresh its status before revoking it.");
      await tx.invitation.update({ where: { id }, data: { revokedAt: new Date(), version: { increment: 1 } } });
      await audit(tx, request, row.companyId, id, "invitation.revoked");
      return { success: true };
    });
  });

  server.post<{ Params: { invitationId: string } }>("/api/invitations/:invitationId/replace", auth, async request => {
    mutation(request, origin);
    const b = input(request, ["expectedVersion", "submissionKey", "delivery"]), id = assignmentId(request.params.invitationId);
    const expectedVersion = version(b.expectedVersion), delivery = choice(b.delivery, ["link", "email"], "delivery method");
    if (delivery === "email" && !mailer) throw new AccessError(503, "INVITATION_EMAIL_UNAVAILABLE", "Invitation email is not configured. Create a private link to share, or contact your administrator.");
    const key = submission(b.submissionKey, { id, expectedVersion, delivery });
    const initial = await db.invitation.findUnique({ where: { id }, select: { companyId: true } });
    if (!initial) throw new AccessError(404, "NOT_FOUND", "Invitation not found.");
    const token = randomBytes(32).toString("base64url");
    const result = await admin(db, request, initial.companyId, async tx => {
      const replay = await tx.invitation.findFirst({ where: { companyId: initial.companyId, createdBy: request.principal!.id, submissionKey: key.submissionKey }, select: { ...select, submissionHash: true } });
      if (replay) { sameSubmission(replay.submissionHash!, key.submissionHash); return { row: replay, replay: true }; }
      const source = await tx.invitation.findFirst({ where: { id, companyId: initial.companyId, acceptedAt: null, revokedAt: null } });
      if (!source || source.version !== expectedVersion) throw new AccessError(409, "RECORD_CHANGED", "This invitation changed. Refresh its status before sending or replacing it.");
      if (source.role === "owner" && !permissions(request.principal!).includes("platform.manage")) throw new AccessError(403,"OWNER_PROTECTED","Only the platform owner can replace a company-owner invitation.");
      if (!source.accountId) throw new AccessError(409, "ACCOUNT_SETUP_REQUIRED", "Create a new invitation from the person's record so it uses their current sign-in account.");
      if (source.leaseId || source.contactId) await invitationSource(tx, source);
      const account = await tx.user.findUnique({ where: { id: source.accountId }, include: { membership: true } });
      if (!account || account.status !== "active" || account.email.toLowerCase() !== source.email || (!source.contactId && !source.leaseId && account.membership)) throw new AccessError(409, "IDENTITY_CONFLICT", "The person's account or access changed. Review their record before inviting them again.");
      if (delivery === "email" && await tx.invitation.findFirst({ where: { companyId: source.companyId, accountId: source.accountId, deliveryRequestedAt: { gt: new Date(Date.now() - 60000) } }, select: { id: true } })) throw new AccessError(429, "INVITATION_EMAIL_COOLDOWN", "Wait a minute before requesting another invitation email.");
      await tx.invitation.update({ where: { id }, data: { revokedAt: new Date(), version: { increment: 1 } } });
      const row = await tx.invitation.create({ data: { ...key, companyId: source.companyId, email: source.email, accountId: source.accountId, role: source.role, contactId: source.contactId, contactLeaseApprovals: source.contactLeaseApprovals ?? undefined, leaseId: source.leaseId, propertyId: source.propertyId, participantRole: source.participantRole, participantName: source.participantName, participantStartsOn: source.participantStartsOn, approvedAt: source.approvedAt, approvedBy: source.approvedBy, replacesId: id, createdBy: request.principal!.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 72 * 3600000), ...(delivery === "email" ? { deliveryStatus: "requesting", deliveryRequestedAt: new Date() } : {}) }, select });
      await audit(tx, request, row.companyId, row.id, "invitation.replaced", { delivery });
      return { row, replay: false };
    });
    if (result.replay) return { ...publicReplay(result.row as typeof result.row & {submissionHash:string|null}), acceptanceUrl: null, recovered: true };
    const acceptanceUrl = invitationUrl(origin, result.row, token);
    if (delivery === "link") return { ...result.row, acceptanceUrl };
    let outcome: "accepted" | "failed" | "unknown" = "unknown";
    try {
      await admin(db, request, initial.companyId, async tx => {
        const current = await tx.invitation.findUniqueOrThrow({ where: { id: result.row.id } });
        if (current.revokedAt || current.acceptedAt || current.tokenHash !== digest(token)) throw invalid();
        await invitationSource(tx, current);
      });
      await mailer!({ to: result.row.email, company: result.row.company.name, role: result.row.participantRole || result.row.role, acceptanceUrl, expiresAt: result.row.expiresAt });
      outcome = "accepted";
    } catch (error) { outcome = error instanceof InvitationEmailError ? error.outcome : error instanceof AccessError ? "failed" : "unknown"; }
    const row = await admin(db, request, initial.companyId, async tx => {
      const current = await tx.invitation.update({ where: { id: result.row.id }, data: { deliveryStatus: outcome, deliveryUpdatedAt: new Date(), version: { increment: 1 } }, select });
      await audit(tx, request, current.companyId, current.id, `invitation.email.${outcome}`);
      return current;
    });
    return { ...row, acceptanceUrl };
  });

  // A private link may reveal its purpose before sign-in, never a full profile.
  server.post("/api/invitations/entry", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async request => {
    if (request.headers.origin !== origin) throw invalid();
    const token = boundedText(input(request, ["token"]).token, 200, "Invitation link");
    return serializable(db, async tx => {
      const row = await tx.invitation.findUnique({ where: { tokenHash: digest(token) } });
      if (!row || row.revokedAt || (!row.acceptedAt && row.expiresAt <= new Date())) throw invalid();
      const company = await tx.company.findUnique({ where: { id: row.companyId } });
      if (!company || company.status !== "active") throw invalid();
      if (!row.acceptedAt) await invitationSource(tx, row);
      return { company: company.name, role: row.participantRole || row.role, kind: row.leaseId ? "lease" : row.contactId ? "contact" : "team", expiresAt: row.expiresAt, accepted: !!row.acceptedAt };
    });
  });
}
