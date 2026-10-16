type PortalAccount = { status: string; portalState?:string; user: { status: string; emailVerified: boolean } | null };

export function tenantPortalState(person: PortalAccount) {
  if(person.portalState)return person.portalState;
  if(!person.user)return "offline";
  if (person.status !== "active" || person.user.status !== "active") return "disabled";
  return person.user.emailVerified ? "active" : "verification";
}
