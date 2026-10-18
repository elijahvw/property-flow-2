import { teamInvitationAuthority } from "./invitation-access.js";
import { contactAccount } from "./resident-accounts.js";
import { residentCompatibilityProfile } from "./resident-contacts.js";
import { previewLeaseInvitation } from "./lease-invitations.js";
import { randomBytes } from "node:crypto";
import type {
  FastifyInstance,
  FastifyRequest,
  preValidationHookHandler,
} from "fastify";
import type { Invitation, PrismaClient } from "@prisma/client";
import type { IdentityProvider } from "./identity-provider.js";
import { AccessError } from "./access.js";
import { assignmentId, serializable } from "./application.js";
import {
  audit,
  conflict,
  input,
  mutation,
  scoped,
  version,
  submission,
  sameSubmission,
  type Tx,
} from "./operational.js";
import { companyDay } from "./reports.js";
import { digest } from "./sessions.js";

export async function validContactInvitation(tx: Tx, invitation: Invitation) {
  await tx.$queryRaw`SELECT set_config('app.company_id',${invitation.companyId},true)`;
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${invitation.companyId} FOR SHARE`;
  const approvingOwner = invitation.leaseId
    ? invitation.approvedBy
    : invitation.createdBy;
  if (!approvingOwner || (invitation.leaseId && !invitation.approvedAt))
    throw new AccessError(
      403,
      "INVITATION_INVALID",
      "This invitation is not approved.",
    );
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${approvingOwner} FOR SHARE`;
  const company = await tx.company.findUnique({
    where: { id: invitation.companyId },
    select: { name: true, status: true, timezone: true },
  });
  const owner = await tx.user.findUnique({
    where: { id: approvingOwner },
    include: { membership: true },
  });
  if (
    !company ||
    company.status !== "active" ||
    !owner ||
    owner.status !== "active" ||
    !owner.emailVerified ||
    owner.membership?.companyId !== invitation.companyId ||
    owner.membership.role !== "owner" ||
    owner.membership.status !== "active"
  )
    throw new AccessError(
      403,
      "INVITATION_INVALID",
      "This invitation is no longer available.",
    );
  const contact = await tx.residentContact.findFirst({
    where: {
      id: invitation.contactId!,
      companyId: invitation.companyId,
      status: "active",
    },
  });
  if (!contact || (invitation.accountId ? contact.userId !== invitation.accountId : contact.email?.toLowerCase() !== invitation.email))
    throw new AccessError(
      403,
      "INVITATION_INVALID",
      "This tenant invitation is unavailable.",
    );
  return { contact, company };
}
// Accepted tokens only acknowledge an existing binding. Later contact edits,
// archive or approving-owner changes cannot turn a lost response into a new grant.
export async function replayContactAcceptance(
  tx: Tx,
  request: FastifyRequest,
  invitation: Invitation,
) {
  await tx.$queryRaw`SELECT set_config('app.company_id',${invitation.companyId},true)`;
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${invitation.companyId} FOR SHARE`;
  const company = await tx.company.findFirst({
    where: { id: invitation.companyId, status: "active" },
    select: { name: true },
  });
  const contact = await tx.residentContact.findFirst({
    where: {
      id: invitation.contactId!,
      companyId: invitation.companyId,
      userId: request.principal!.id,
    },
    select: { id: true, name: true },
  });
  const membership = await tx.companyMembership.findUnique({
    where: { userId: request.principal!.id },
  });
  if (
    !invitation.acceptedAt ||
    invitation.revokedAt ||
    !company ||
    !contact ||
    membership?.companyId !== invitation.companyId ||
    membership.status !== "active" ||
    membership.role !== "resident"
  )
    throw new AccessError(
      403,
      "INVITATION_INVALID",
      "This invitation is no longer available for your account.",
    );
  return { company, contact };
}
export async function previewContactInvitation(tx: Tx, invitation: Invitation) {
  const { contact, company } = await validContactInvitation(tx, invitation);
  const today = new Date(companyDay(company.timezone) + "T00:00:00Z");
  const approvals = (invitation.contactLeaseApprovals ?? []) as {
    id: string;
    role: string;
    version: number;
    leaseVersion: number;
  }[];
  const participants = await tx.leaseParticipant.findMany({
    where: {
      companyId: invitation.companyId,
      contactId: contact.id,
      id: { in: approvals.map((p) => p.id) },
    },
    select: {
      id: true,
      role: true,
      version: true,
      removedAt: true,
      startsOn: true,
      endsOn: true,
      lease: {
        select: {
          version: true,
          status: true,
          startsOn: true,
          endsOn: true,
          property: { select: { name: true } },
          unit: { select: { label: true } },
        },
      },
    },
  });
  if (
    !invitation.acceptedAt &&
    (participants.length !== approvals.length ||
      approvals.some((a) => {
        const p = participants.find((p) => p.id === a.id);
        return (
          !p ||
          p.removedAt ||
          p.version !== a.version ||
          p.role !== a.role ||
          p.lease.version !== a.leaseVersion ||
          p.lease.status === "ended" ||
          (p.endsOn && p.endsOn < today) ||
          (p.lease.endsOn && p.lease.endsOn < today)
        );
      }))
  )
    throw new AccessError(
      409,
      "INVITATION_CHANGED",
      "The household changed. Ask the owner for a newly reviewed invitation.",
    );
  return {
    company: company.name,
    name: contact.name,
    contact: true,
    leaseApprovals: approvals.map((p) => ({ role: p.role })),
    leases: participants.map((p) => ({
      property: p.lease.property.name,
      unit: p.lease.unit.label,
      role: p.role,
      startsOn: p.startsOn,
      endsOn: p.endsOn,
      leaseStartsOn: p.lease.startsOn,
      leaseEndsOn: p.lease.endsOn,
    })),
  };
}
export async function acceptContactInvitation(
  tx: Tx,
  request: FastifyRequest,
  invitation: Invitation,
) {
  const user = request.principal!;
  await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${user.id} RETURNING id`;
  const { contact } = await validContactInvitation(tx, invitation);
  await tx.$queryRaw`UPDATE "ResidentContact" SET "updatedAt"="updatedAt" WHERE id=${contact.id} AND "companyId"=${invitation.companyId} RETURNING id`;
  const current = await tx.residentContact.findFirstOrThrow({
    where: { id: contact.id, companyId: invitation.companyId },
  });
  if (current.userId && current.userId !== user.id)
    throw new AccessError(
      409,
      "CONTACT_ALREADY_LINKED",
      "This profile is already linked to a different account. Ask the owner to review it.",
    );
  const existing = await tx.residentContact.findFirst({
    where: {
      companyId: invitation.companyId,
      userId: user.id,
      id: { not: contact.id },
    },
    select: { id: true },
  });
  if (existing)
    throw new AccessError(
      409,
      "CONTACT_LINK_CONFLICT",
      "Your account already has another tenant profile in this company. The owner must review the records; profiles and balances are never merged automatically.",
    );
  const membership = await tx.companyMembership.findUnique({
    where: { userId: user.id },
  });
  if (
    membership &&
    (membership.companyId !== invitation.companyId ||
      membership.role !== "resident" ||
      membership.status !== "active")
  )
    throw new AccessError(
      409,
      "ALREADY_ASSIGNED",
      "Your current company assignment cannot be changed by an invitation.",
    );
  if (!membership)
    await tx.companyMembership.create({
      data: {
        userId: user.id,
        companyId: invitation.companyId,
        role: "resident",
        contactName: current.name,
        contactPhone: current.phone,
        emergencyContactName: current.emergencyContactName,
        emergencyContactPhone: current.emergencyContactPhone,
        managementNotes: current.managementNotes,
      },
    });
  const approvals = (invitation.contactLeaseApprovals ?? []) as {
    id: string;
    leaseId: string;
    role: string;
    version: number;
    leaseVersion: number;
  }[];
  for (const approval of approvals) {
    await tx.$queryRaw`UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=${approval.leaseId} AND "companyId"=${invitation.companyId} RETURNING id`;
    const participant = await tx.leaseParticipant.findFirst({
      where: {
        id: approval.id,
        contactId: contact.id,
        companyId: invitation.companyId,
        leaseId: approval.leaseId,
      },
      include: { lease: true },
    });
    const company = await tx.company.findUniqueOrThrow({
        where: { id: invitation.companyId },
        select: { timezone: true },
      }),
      today = companyDay(company.timezone);
    if (
      !participant ||
      participant.version !== approval.version ||
      participant.lease.version !== approval.leaseVersion ||
      participant.removedAt ||
      participant.role !== approval.role ||
      participant.lease.status === "ended" ||
      (participant.endsOn &&
        participant.endsOn.toISOString().slice(0, 10) < today) ||
      (participant.lease.endsOn &&
        participant.lease.endsOn.toISOString().slice(0, 10) < today)
    )
      throw new AccessError(
        409,
        "INVITATION_CHANGED",
        "The household changed after this invitation. Ask the owner for a newly reviewed link.",
      );
    if (
      (participant.userId && participant.userId !== user.id) ||
      (await tx.leaseParticipant.findFirst({
        where: {
          companyId: invitation.companyId,
          leaseId: approval.leaseId,
          userId: user.id,
          id: { not: participant.id },
        },
        select: { id: true },
      }))
    )
      throw new AccessError(
        409,
        "CONTACT_LINK_CONFLICT",
        "This account is already represented by another household record. Ask the owner to review the records.",
      );
    await tx.residentPropertyAssignment.upsert({
      where: {
        propertyId_userId: {
          propertyId: participant.propertyId,
          userId: user.id,
        },
      },
      create: {
        companyId: invitation.companyId,
        propertyId: participant.propertyId,
        userId: user.id,
      },
      update: {},
    });
    await tx.leaseParticipant.update({
      where: { id: participant.id },
      data: {
        userId: user.id,
        portalApproved: true,
        version: { increment: 1 },
      },
    });
    if (participant.lease.residentContactId === contact.id)
      await tx.lease.update({
        where: { id: participant.leaseId },
        data: { residentId: user.id },
      });
  }
  const currentMembership = await tx.companyMembership.findUniqueOrThrow({
    where: { userId: user.id },
  });
  await tx.residentContact.update({
    where: { id: contact.id },
    data: {
      userId: user.id,
      compatibilityProfile: residentCompatibilityProfile(currentMembership),
      version: { increment: 1 },
    },
  });
  await audit(
    tx,
    request,
    invitation.companyId,
    contact.id,
    "resident.portal.linked",
    { invitationId: invitation.id },
  );
}
export function registerContactInvitations(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
  provider?: IdentityProvider,
) {
  const auth = { preValidation: authenticate };
  server.post<{ Params: { contactId: string } }>(
    "/api/company/resident-contacts/:contactId/invitations",
    auth,
    async (request) => {
      mutation(request, origin);
      const body = input(request, ["expectedVersion", "approvals", "submissionKey"]),
        expectedVersion = version(body.expectedVersion);
      const id = assignmentId(request.params.contactId),
        token = randomBytes(32).toString("base64url");
      const key = body.submissionKey === undefined ? undefined : submission(body.submissionKey,{id,expectedVersion,approvals:body.approvals});
      if(key){const replay=await scoped(db,request,"members.manage",async(tx,companyId)=>{
        const row=await tx.invitation.findFirst({where:{companyId,createdBy:request.principal!.id,submissionKey:key.submissionKey}});
        if(row)sameSubmission(row.submissionHash!,key.submissionHash);return row;
      });if(replay)return {id:replay.id,version:replay.version,expiresAt:replay.expiresAt,acceptanceUrl:null,recovered:true,deliveryStatus:replay.deliveryStatus};}
      const accountId = await contactAccount(db, request, "members.manage", provider, id, expectedVersion);
      return scoped(db, request, "members.manage", async (tx, companyId) => {
        await tx.$queryRaw`UPDATE "ResidentContact" SET "updatedAt"="updatedAt" WHERE id=${id} AND "companyId"=${companyId} RETURNING id`;
        if(key){const replay=await tx.invitation.findFirst({where:{companyId,createdBy:request.principal!.id,submissionKey:key.submissionKey}});if(replay){sameSubmission(replay.submissionHash!,key.submissionHash);return {id:replay.id,version:replay.version,expiresAt:replay.expiresAt,acceptanceUrl:null,recovered:true,deliveryStatus:replay.deliveryStatus};}}
        const contact = await tx.residentContact.findFirst({
          where: { id, companyId, status: "active" },
        });
        if (!contact)
          throw new AccessError(404, "NOT_FOUND", "Tenant not found.");
        if (contact.version !== expectedVersion) throw conflict();
        if (!contact.email && !contact.userId)
          throw new AccessError(
            400,
            "EMAIL_REQUIRED",
            "Add a contact email before inviting this tenant.",
          );
        // Replacing a lost/expired link revokes every older contact link, so an
        // earlier message cannot silently remain usable after an owner's review.
        await tx.invitation.updateMany({
          where: {
            companyId,
            contactId: id,
            acceptedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
        const company = await tx.company.findUniqueOrThrow({
            where: { id: companyId },
            select: { timezone: true },
          }),
          today = new Date(companyDay(company.timezone) + "T00:00:00Z");
        const participants = await tx.leaseParticipant.findMany({
          where: {
            companyId,
            contactId: id,
            removedAt: null,
            OR: [{ endsOn: null }, { endsOn: { gte: today } }],
            lease: {
              status: { in: ["active", "draft"] },
              OR: [{ endsOn: null }, { endsOn: { gte: today } }],
            },
          },
          select: {
            id: true,
            leaseId: true,
            role: true,
            version: true,
            lease: { select: { version: true } },
          },
          take: 101,
          orderBy: { leaseId: "asc" },
        });
        if (participants.length > 100)
          throw new AccessError(
            422,
            "INVITATION_SCOPE_TOO_LARGE",
            "Too many leases to review in one portal invitation.",
          );
        const contactLeaseApprovals = participants.map((p) => ({
          id: p.id,
          leaseId: p.leaseId,
          role: p.role,
          version: p.version,
          leaseVersion: p.lease.version,
        }));
        if (
          JSON.stringify(body.approvals) !==
          JSON.stringify(contactLeaseApprovals)
        )
          throw new AccessError(
            409,
            "INVITATION_CHANGED",
            "The household changed. Refresh the tenant and review portal access again.",
          );
        const targetAccount = await tx.user.findUniqueOrThrow({where:{id:accountId},select:{email:true}});
        const row = await tx.invitation.create({
          data: {
            companyId,
            contactId: id,
            accountId,
            contactLeaseApprovals,
            ...key,
            email: targetAccount.email.toLowerCase(),
            role: "resident",
            createdBy: request.principal!.id,
            tokenHash: digest(token),
            expiresAt: new Date(Date.now() + 72 * 3600000),
          },
        });
        await audit(tx, request, companyId, id, "resident.invitation.created", {
          invitationId: row.id,
        });
        return {
          id: row.id,
          acceptanceUrl: `${origin}/invite?contact=1#${token}`,
          expiresAt: row.expiresAt,
          version: row.version,
        };
      });
    },
  );
  // Setup only sends email for an already prepared exact Auth0 identity.
  // Account creation belongs to the authorized inviter, never password reset.
  server.post(
    "/api/invitations/setup-account",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request) => {
      if (request.headers.origin !== origin)
        throw new AccessError(
          403,
          "ORIGIN_INVALID",
          "Open the invitation from this application.",
        );
      const b = input(request, ["token"]);
      if (typeof b.token !== "string" || b.token.length > 200)
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "A valid invitation link is required.",
        );
      const check = () =>
        serializable(db, async (tx) => {
          const invitation = await tx.invitation.findUnique({
            where: { tokenHash: digest(b.token as string) },
          });
          if (
            !invitation ||
            invitation.acceptedAt ||
            invitation.revokedAt ||
            invitation.expiresAt.getTime() <= Date.now()
          )
            throw new AccessError(
              403,
              "INVITATION_INVALID",
              "This invitation is expired or unavailable.",
            );
          if (!invitation.contactId && !invitation.leaseId) {
            await teamInvitationAuthority(tx, invitation);
            return {invitation, contact: null};
          }
          if (invitation.leaseId) {
            const preview = await previewLeaseInvitation(tx, invitation);
            if (!invitation.contactId)
              return { invitation, contact: { name: preview.name! } };
          }
          const { contact } = await validContactInvitation(tx, invitation);
          if (!invitation.leaseId)
            await previewContactInvitation(tx, invitation);
          return { invitation, contact };
        });
      const { invitation } = await check();
      if (!provider)
        throw new AccessError(
          503,
          "IDENTITY_NOT_CONFIGURED",
          "Account setup is unavailable. Ask the owner for assistance.",
        );
      if (!invitation.accountId) throw new AccessError(409,"ACCOUNT_SETUP_REQUIRED","Ask the inviter to replace this older invitation from Property Flow so it is bound to your sign-in account.");
      const identity = await db.identity.findFirst({where:{userId:invitation.accountId,issuer:provider.issuer}});
      if (!identity) throw new AccessError(409,"IDENTITY_CONFLICT","This invitation needs account review by the platform administrator.");
      const user = await provider.get(identity.subject);
      if (user.email.toLowerCase() !== invitation.email) throw new AccessError(409,"EMAIL_CHANGED","The account email changed. Ask the inviter for a new invitation.");
      await check();
      await serializable(db, async tx => {
        await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${invitation.accountId} RETURNING id`;
        const account = await tx.user.findUniqueOrThrow({where:{id:invitation.accountId!}});
        if (account.status !== "active") throw new AccessError(403,"ACCOUNT_DISABLED","This account is disabled.");
        if (account.passwordSetupSentAt && Date.now()-account.passwordSetupSentAt.getTime()<60000) throw new AccessError(429,"SETUP_COOLDOWN","Wait a minute before requesting another setup email.");
        await tx.user.update({where:{id:account.id},data:{passwordSetupSentAt:new Date()}});
      });
      if (user.blocked)
        throw new AccessError(
          403,
          "ACCOUNT_DISABLED",
          "This account is disabled. Ask the owner for assistance.",
        );
      const passwordAccount=user.identities?.some(i=>i.provider === "auth0" && i.connection === provider.databaseConnection);
      if(passwordAccount)await provider.setup(user.email);
      else if(!user.email_verified)await provider.verify(user.user_id);
      return {
        message: passwordAccount
          ? "Password setup email requested. Choose your password using that link, then sign in to Property Flow. Completing password setup also verifies your email address."
          : user.email_verified ? "Your account is ready. Sign in with your existing sign-in provider. No password setup is needed." : "Verification email requested. Verify your email, then sign in with your existing sign-in provider.",
      };
    },
  );
}
