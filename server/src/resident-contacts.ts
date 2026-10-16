import type { Tx } from "./operational.js";
import { AccessError } from "./access.js";

// A business contact is company-owned data, not a grant of portal access. This
// bridge only uses exact stored User IDs. Email/name matching is never linking.
export async function linkedResidentContact(tx: Tx, companyId: string, userId: string) {
  // Membership callers may be platform transactions or invitation acceptance;
  // always set the same local company context required by forced contact RLS.
  await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
  const existing = await tx.residentContact.findUnique({ where: { companyId_userId: { companyId, userId } } });
  if (existing) return existing;
  const member = await tx.companyMembership.findFirst({
    where: { companyId, userId, role: "resident" }, include: { user: true },
  });
  if (!member) throw new AccessError(409, "RESIDENT_CONTACT_UNAVAILABLE", "A resident membership in this company is required for the contact bridge.");
  return tx.residentContact.create({ data: {
    companyId, userId,
    name: Array.from(member.contactName?.trim() || member.user.name?.trim() || member.user.email.trim() || "Resident").slice(0, 200).join(""),
    email: member.user.email.length > 0 && member.user.email.length <= 254 ? member.user.email : null,
    phone: member.contactPhone,
    emergencyContactName: member.emergencyContactName,
    emergencyContactPhone: member.emergencyContactPhone,
    managementNotes: member.managementNotes,
  } });
}

export async function participantContact(tx: Tx, companyId: string, data: {
  userId: string | null; name: string; email: string | null; phone?: string | null;
}) {
  if (data.userId) {
    await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${data.userId} RETURNING id`;
    const existing = await tx.residentContact.findUnique({ where: { companyId_userId: { companyId, userId: data.userId } } });
    if (existing) return existing;
    const member = await tx.companyMembership.findFirst({ where: { companyId, userId: data.userId, role: "resident" }, select: { userId: true } });
    if (member) return linkedResidentContact(tx, companyId, data.userId);
    // A prior-version roster write during rollout may predate this mapping and
    // the account may since have transferred. Retain that lease's own snapshot;
    // never copy the account's new company's contact fields. New roster additions
    // independently enforce eligibility before calling this helper.
  }
  return tx.residentContact.create({ data: {
    companyId, userId: data.userId, name: data.name, email: data.email, phone: data.phone ?? null,
  } });
}
