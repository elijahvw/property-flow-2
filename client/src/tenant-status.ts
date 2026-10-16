type PortalAccount = { status: string; user: { status: string; emailVerified: boolean } };

export function tenantPortalState(person: PortalAccount) {
  if (person.status !== "active" || person.user.status !== "active") return "disabled";
  return person.user.emailVerified ? "active" : "verification";
}
