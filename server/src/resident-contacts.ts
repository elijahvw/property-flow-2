import type { Tx } from "./operational.js";
import { AccessError } from "./access.js";

const profileKeys = ["contactName", "contactPhone", "emergencyContactName", "emergencyContactPhone", "managementNotes"] as const;
type CompatibilityProfile = Record<typeof profileKeys[number], string | null>;
export function residentCompatibilityProfile(member: Partial<CompatibilityProfile>): CompatibilityProfile {
  return Object.fromEntries(profileKeys.map(key => [key, member[key] ?? null])) as CompatibilityProfile;
}

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
    compatibilityProfile: residentCompatibilityProfile(member),
  } });
}

// Called under the target User write fence before compatibility fields can be
// cleared or their resident role changed. A private snapshot detects old-version
// profile writes during rollout without overwriting a separately curated contact
// simply because the login name/email or membership role/version changed.
export async function preserveResidentContactProfile(tx: Tx, companyId: string, userId: string) {
  await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
  const member = await tx.companyMembership.findFirst({ where: { companyId, userId }, include: { user: true } });
  if (!member) return;
  let contact = await tx.residentContact.findUnique({ where: { companyId_userId: { companyId, userId } } });
  if (!contact && member.role === "resident") contact = await linkedResidentContact(tx, companyId, userId);
  if (!contact) {
    const historical = await tx.lease.findFirst({ where: { companyId, OR: [{ residentId: userId }, { participants: { some: { companyId, userId } } }] }, select: { id: true } });
    if (!historical) return;
    contact = await participantContact(tx, companyId, { userId, name: Array.from(member.contactName?.trim() || member.user.name?.trim() || member.user.email).slice(0, 200).join(""), email: member.user.email.length <= 254 ? member.user.email : null, phone: member.contactPhone });
  }
  const snapshot = residentCompatibilityProfile(member);
  const baseline = contact.compatibilityProfile as Partial<CompatibilityProfile> | null;
  const changed = (key: keyof CompatibilityProfile) => !baseline || baseline[key] !== snapshot[key];
  if (!profileKeys.some(changed)) return;
  await tx.residentContact.update({ where: { id: contact.id }, data: {
    ...(changed("contactName") ? { name: Array.from(member.contactName?.trim() || member.user.name?.trim() || member.user.email.trim() || "Resident").slice(0, 200).join("") } : {}),
    ...(changed("contactPhone") ? { phone: member.contactPhone } : {}),
    ...(changed("emergencyContactName") ? { emergencyContactName: member.emergencyContactName } : {}),
    ...(changed("emergencyContactPhone") ? { emergencyContactPhone: member.emergencyContactPhone } : {}),
    ...(changed("managementNotes") ? { managementNotes: member.managementNotes } : {}),
    compatibilityProfile: snapshot,
    version: { increment: 1 },
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
