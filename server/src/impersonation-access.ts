import { COMPANY_ROLES, permissions, type Principal } from "./access.js";

type Target = Principal & { membership: (NonNullable<Principal["membership"]> & { version: number }) | null };

// A platform owner may inspect any recorded account, including its denied
// access state. Delegated support never acquires that broader authority.
export function canViewTarget(actor: Principal, target: Principal | null): boolean {
  if (!target || !permissions(actor).includes("platform.impersonate")) return false;
  if (actor.platformRole === "owner") return true;
  return !target.platformRole && target.status === "active" && target.emailVerified === true &&
    target.membership?.status === "active" && target.membership.company.status === "active" &&
    COMPANY_ROLES.includes(target.membership.role as typeof COMPANY_ROLES[number]);
}

export function sameImpersonationMembership(target: Target, companyId: string | null, version: number | null) {
  return (target.membership?.companyId ?? null) === companyId && (target.membership?.version ?? null) === version;
}
