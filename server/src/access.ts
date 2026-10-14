export const COMPANY_ROLES = ["owner", "manager", "staff", "resident"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];
export type Permission =
  | "platform.manage"
  | "property.read"
  | "property.write"
  | "company.manage"
  | "members.manage"
  | "resident.self"
  | "resident.assignment.manage"
  | "maintenance.manage";
export type Principal = {
  id: string;
  status: string;
  platformRole: string | null;
  membership: {
    companyId: string;
    role: string;
    status: string;
    company: { status: string };
  } | null;
};
const grants: Record<CompanyRole, Permission[]> = {
  owner: [
    "property.read",
    "property.write",
    "company.manage",
    "members.manage",
    "resident.assignment.manage",
    "maintenance.manage",
  ],
  manager: ["property.read", "property.write", "resident.assignment.manage", "maintenance.manage"],
  staff: ["property.read"],
  resident: ["resident.self"],
};
export function permissions(user: Principal): Permission[] {
  if (user.status !== "active") return [];
  const result: Permission[] =
    user.platformRole === "owner" ? ["platform.manage"] : [];
  const m = user.membership;
  if (
    m?.status === "active" &&
    m.company.status === "active" &&
    COMPANY_ROLES.includes(m.role as CompanyRole)
  ) {
    result.push(...grants[m.role as CompanyRole]);
  }
  return result;
}
export class AccessError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requirePermission(user: Principal, permission: Permission) {
  if (!permissions(user).includes(permission))
    throw new AccessError(
      403,
      "ACCESS_DENIED",
      "You do not have access to this action.",
    );
}
export function companyScope(
  user: Principal,
  permission: Permission,
  selected?: unknown,
): string {
  requirePermission(user, permission);
  const companyId = user.membership?.companyId;
  if (!companyId || (selected !== undefined && selected !== companyId)) {
    throw new AccessError(
      403,
      "COMPANY_ACCESS_DENIED",
      "You do not have access to this company.",
    );
  }
  return companyId;
}
export function safeReturnTo(value: unknown): string {
  // Do not allow authority URLs, backslashes, encoded separators or OAuth URLs.
  if (
    typeof value !== "string" ||
    !/^\/(?:platform|company|resident|account|access|invite|dashboard)(?:\/|$)/.test(
      value,
    ) ||
    /[\\%?#\s]/.test(value)
  )
    return "/dashboard";
  return value.slice(0, 512);
}
export function defaultDestination(user: Principal) {
  const p = permissions(user);
  return p.includes("platform.manage")
    ? "/platform/companies"
    : p.includes("property.read")
      ? "/company/properties"
      : p.includes("resident.self")
        ? "/resident"
        : "/access";
}
