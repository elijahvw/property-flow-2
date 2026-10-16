export const leasePersonSelect = {
  residentContactId: true,
  resident: { select: { name: true, email: true } },
  residentContact: { select: { name: true, email: true } },
} as const;
export function leasePerson(row: {
  resident?: { name: string | null; email: string } | null;
  residentContact?: { name: string; email: string | null } | null;
}) {
  return row.residentContact
    ? { name: row.residentContact.name, email: row.residentContact.email ?? "" }
    : (row.resident ?? { name: "Tenant record unavailable", email: "" });
}
