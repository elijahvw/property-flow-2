import type { FastifyRequest } from "fastify";
import type { PrismaClient, ResidentContact } from "@prisma/client";
import type { Permission } from "./access.js";
import { AccessError } from "./access.js";
import type { IdentityProvider, ProviderUser } from "./identity-provider.js";
import { audit, scoped, type Tx } from "./operational.js";

export type PreparedAccount = { issuer: string; user: ProviderUser };
export async function prepareAccount(provider: IdentityProvider | undefined, email: string | null, name: string, subject?: string): Promise<PreparedAccount> {
  if (!subject && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    throw new AccessError(422, "ACCOUNT_EMAIL_REQUIRED", "Every leaseholder and occupant needs a sign-in email. Add their email before continuing.");
  if (!provider) throw new AccessError(503, "IDENTITY_NOT_CONFIGURED", "Auth0 account setup is unavailable. No lease participant or invitation was added. Contact your administrator.");
  const user = subject ? await provider.get(subject) : await provider.create(email!.toLowerCase(), name);
  if (user.blocked || (!subject && user.email.toLowerCase() !== email!.toLowerCase()))
    throw new AccessError(409, "IDENTITY_CONFLICT", "The sign-in account is disabled or its email differs. Review the existing Auth0 account before continuing.");
  return { issuer: provider.issuer, user };
}

// Call only inside the final freshly authorized transaction. Provider requests
// happen before this transaction, so retries never hold DB locks across Auth0.
export async function saveAccount(tx: Tx, request: FastifyRequest, account: PreparedAccount, companyId: string, retainExistingAssignment = false) {
  const { issuer, user: remote } = account;
  const binding = await tx.identity.findUnique({ where: { issuer_subject: { issuer, subject: remote.user_id } } });
  const existing = await tx.user.findUnique({ where: { id: binding?.userId ?? remote.user_id }, include: { identities: true, membership: true } });
  if (existing && ((!binding && existing.identities.length) || existing.status !== "active" || (!retainExistingAssignment && existing.membership && (existing.membership.companyId !== companyId || existing.membership.role !== "resident" || existing.membership.status !== "active"))))
    throw new AccessError(409, "IDENTITY_CONFLICT", "This account has an existing access assignment that must be reviewed. No accounts or records were merged.");
  const collision = await tx.user.findFirst({ where: { email: { equals: remote.email, mode: "insensitive" }, ...(existing ? { id: { not: existing.id } } : {}) }, select: { id: true } });
  if (collision) throw new AccessError(409, "IDENTITY_EMAIL_CONFLICT", "This email is already represented by another identity. Review the existing account; accounts are never merged by email.");
  if (existing) {
    await tx.identity.upsert({ where: { issuer_subject: { issuer, subject: remote.user_id } }, update: {}, create: { issuer, subject: remote.user_id, userId: existing.id } });
    if(existing.email !== remote.email || existing.emailVerified !== remote.email_verified) await tx.user.update({where:{id:existing.id},data:{email:remote.email,emailVerified:remote.email_verified}});
    return existing.id;
  }
  const created = await tx.user.create({ data: { id: remote.user_id, email: remote.email, name: remote.name?.slice(0,200) || null, emailVerified: remote.email_verified, role: "unassigned", accessInitializedAt: new Date(), identities: { create: { issuer, subject: remote.user_id } } } });
  await audit(tx, request, companyId, created.id, "user.preprovisioned");
  return created.id;
}

export async function contactAccount(db: PrismaClient, request: FastifyRequest, permission: Permission, provider: IdentityProvider | undefined, id: string, expectedVersion?: number) {
  const before = await scoped(db, request, permission, async (tx, companyId) => {
    const contact = await tx.residentContact.findFirst({ where: { id, companyId, status: "active" } });
    if (!contact) throw new AccessError(404, "NOT_FOUND", "Tenant not found.");
    if (expectedVersion !== undefined && contact.version !== expectedVersion) throw new AccessError(409,"RECORD_CHANGED","The tenant changed. Refresh before continuing.");
    const userId = contact.userId;
    const identity = userId ? await tx.identity.findFirst({ where: { userId, issuer: provider?.issuer ?? "" } }) : null;
    if (userId && !identity) throw new AccessError(409,"IDENTITY_CONFLICT","This tenant's account has no matching Auth0 identity. Ask an administrator to review it.");
    return { contact, identity };
  });
  const prepared = await prepareAccount(provider, before.contact.email, before.contact.name, before.identity?.subject);
  return scoped(db, request, permission, async (tx, companyId) => {
    await tx.$queryRaw`UPDATE "ResidentContact" SET "updatedAt"="updatedAt" WHERE id=${id} AND "companyId"=${companyId} RETURNING id`;
    const current = await tx.residentContact.findFirst({ where: { id, companyId, status: "active" } });
    if (!current || current.version !== before.contact.version || current.email !== before.contact.email || (before.contact.userId && current.userId !== before.contact.userId))
      throw new AccessError(409,"RECORD_CHANGED","The tenant changed during account setup. Refresh and retry; no access was granted.");
    const accountId = await saveAccount(tx, request, prepared, companyId, current.userId !== null);
    if (current.userId && current.userId !== accountId) throw new AccessError(409,"IDENTITY_CONFLICT","The selected account changed during setup. Refresh and review it.");
    const duplicate = await tx.residentContact.findFirst({ where: { companyId, id: { not: id }, userId: accountId }, select: { id: true } });
    if (duplicate) throw new AccessError(409,"CONTACT_LINK_CONFLICT","This account already belongs to another tenant profile. Review the existing profile; records were not merged.");
    if (current.userId !== accountId) {
      await tx.residentContact.update({ where: { id }, data: { userId: accountId } });
      await audit(tx, request, companyId, id, "resident.account.prepared");
    }
    return accountId;
  });
}

export async function requireContactAccount(tx: Tx, contact: ResidentContact) {
  const accountId = contact.userId;
  if (!accountId || !await tx.identity.findFirst({ where: { userId: accountId }, select: { id: true } }))
    throw new AccessError(409,"ACCOUNT_REQUIRED","Prepare this tenant's Auth0 account before adding them to a lease. Open their profile and create a portal invitation.");
  return accountId;
}

export async function userAccount(db: PrismaClient, request: FastifyRequest, permission: Permission, provider: IdentityProvider | undefined, userId: string, retainedParticipant = false) {
  const data=await scoped(db,request,permission,async(tx,companyId)=>{
    const user=await tx.user.findFirst({where:{id:userId,...(!retainedParticipant?{membership:{companyId,role:"resident",status:"active"}}:{})},include:{identities:true}});
    const identity=user?.identities.find(i=>i.issuer===provider?.issuer);
    if(!user||user.status!=="active"||!identity)throw new AccessError(409,"IDENTITY_CONFLICT","Select a current resident with a matching Auth0 identity from Property Flow Users.");
    return {user,subject:identity.subject};
  });
  await prepareAccount(provider,data.user.email,data.user.name||data.user.email,data.subject);
}
