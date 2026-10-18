import type { Invitation } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { AccessError } from "./access.js";
import type { Tx } from "./operational.js";

export async function teamInvitationAuthority(tx: Tx, invitation: Invitation) {
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${invitation.companyId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${invitation.createdBy} FOR SHARE`;
  await tx.$queryRaw`SELECT "userId" FROM "CompanyMembership" WHERE "userId"=${invitation.createdBy} FOR SHARE`;
  const company = await tx.company.findUnique({ where: { id: invitation.companyId } });
  const inviter = await tx.user.findUnique({ where: { id: invitation.createdBy }, include: { membership: true } });
  const platform = inviter?.platformRole === "owner";
  const companyOwner = inviter?.membership?.companyId === invitation.companyId && inviter.membership.role === "owner" && inviter.membership.status === "active";
  if (!company || company.status !== "active" || !inviter || inviter.status !== "active" || !inviter.emailVerified ||
      !(platform || (companyOwner && invitation.role !== "owner"))) {
    throw new AccessError(403, "INVITATION_AUTHORITY_CHANGED", "This invitation is no longer authorized. Ask the current owner for a new invitation.");
  }
  return company;
}

export async function replayTeamAcceptance(tx: Tx, request: FastifyRequest, invitation: Invitation) {
  const user = request.principal!;
  const company = await tx.company.findUnique({ where: { id: invitation.companyId } });
  const membership = await tx.companyMembership.findUnique({ where: { userId: user.id } });
  if (!invitation.acceptedAt || invitation.revokedAt || !invitation.accountId || invitation.accountId !== user.id ||
      company?.status !== "active" || membership?.companyId !== invitation.companyId || membership.role !== invitation.role || membership.status !== "active") {
    throw new AccessError(403, "INVITATION_INVALID", "This invitation no longer matches your current access. Contact your company owner.");
  }
  // Acknowledgement only. An old invitation can never restore or alter access.
  return { company, membership };
}
