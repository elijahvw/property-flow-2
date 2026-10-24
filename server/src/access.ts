export const COMPANY_ROLES = ["owner", "manager", "staff", "resident"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];
export type Permission =
  | "notification.read"
  | "platform.manage"
  | "platform.impersonate"
  | "subscription.read"
  | "property.read"
  | "property.write"
  | "company.manage"
  | "members.manage"
  | "resident.self"
  | "resident.assignment.manage"
  | "maintenance.manage"
  | "maintenance.execute"
  | "lease.manage"
  | "finance.manage";
export type Principal = {
  id: string;
  status: string;
  emailVerified?: boolean;
  platformRole: string | null;
  membership: {
    companyId: string;
    role: string;
    status: string;
    company: { status: string };
    maintenanceExecution?: boolean;
  } | null;
};
const grants: Record<CompanyRole, Permission[]> = {
  owner: [
    "notification.read",
    "subscription.read",
    "property.read",
    "property.write",
    "company.manage",
    "members.manage",
    "resident.assignment.manage",
    "maintenance.manage",
    "lease.manage",
    "finance.manage",
  ],
  manager: ["notification.read", "property.read", "property.write", "resident.assignment.manage", "maintenance.manage", "lease.manage", "finance.manage"],
  staff: ["property.read", "notification.read"],
  resident: ["resident.self", "notification.read"],
};
export function permissions(user: Principal): Permission[] {
  if (user.status !== "active" || user.emailVerified === false) return [];
  const result: Permission[] =
    user.platformRole === "owner" ? ["platform.manage", "platform.impersonate"] : user.platformRole === "support" ? ["platform.impersonate"] : [];
  const m = user.membership;
  if (
    m?.status === "active" &&
    m.company.status === "active" &&
    COMPANY_ROLES.includes(m.role as CompanyRole)
  ) {
    result.push(...grants[m.role as CompanyRole]);
    if (m.role === "staff" && m.maintenanceExecution === true) result.push("maintenance.execute");
  }
  // A suspended company still needs its active owner to review SaaS invoices
  // and recover its subscription without opening property operations.
  if (m?.status === "active" && m.company.status !== "active" && m.role === "owner") result.push("subscription.read");
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
  if (typeof value !== "string" || value.length > 2048 || /[\\\s#]/.test(value) || !/^\/(?:platform|company|resident|account|access|invite|dashboard|help)(?:\/|\?|$)/.test(value)) return "/dashboard";
  try {
    const url = new URL(value, "https://internal.invalid");
    if (url.origin !== "https://internal.invalid") return "/dashboard";
    // Decode once and reject encoded separators/control characters, double
    // encoding and dot traversal rather than trusting URL normalization.
    if (url.pathname.split("/").some(segment => /[\\/%?#\s]/.test(decodeURIComponent(segment)) || [".",".."].includes(decodeURIComponent(segment))) || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(value.split("?")[0])) return "/dashboard";
    const allowed = new Set(["propertyId","unitId","leaseId","residentId","contactId","tenantId","tenantContact","tenantProperty","tenantAccess","tenantRental","tenantRecords","leaseReturn","section","status","access","rental","records","attention","approvals","view","age","kind","dateFrom","dateTo","statementFrom","new"]);
    for(const key of ["q","page","due","priority","workStatus","assignee","month","day","planId","vendorId","calendarMonth","calendarDay","calendarProperty","calendarKind","calendarPage"])allowed.add(key);
    for(const key of ["source","scan","library","documentId","inspectionId","library_q","library_source","library_status","library_scan","library_propertyId","library_page"])allowed.add(key);
    for(const key of ["agreementId","agreementQ","agreementStatus","agreementPage"])allowed.add(key);
    for(const key of ["noticeReturn","noticeStatus","noticeType","noticePage","type"])allowed.add(key);
    for(const key of ["subscriptionTab", "invoiceId"])allowed.add(key);
    for(const key of ["asOf", "compareFrom", "compareTo", "importId"])allowed.add(key);
    for(const key of ["prospectId", "stage"])allowed.add(key);
    for(const key of ["history", "historyFrom", "historyTo", "historyAsOf", "historyProperty", "historyCompareFrom", "historyCompareTo", "entryId"])allowed.add(key);
    const maintenanceReturn = /^\/(?:company|resident)\/maintenance(?:\/[^/]+)?$/.test(url.pathname) || /^\/company\/properties\/[^/]+\/maintenance(?:\/[^/]+)?$/.test(url.pathname);
    const prospectHandoff = /^\/company\/(?:residents(?:\/[^/]+)?|tenants\/[^/]+|leases(?:\/[^/]+(?:\/statement)?)?|rent|deposits)$/.test(url.pathname)
      || /^\/company\/properties\/[^/]+\/(?:residents|leases|rent|deposits)$/.test(url.pathname);
    const tenantDetail = /^\/company\/(?:residents|tenants)\/[^/]+$/.test(url.pathname);
    const tenantDirectory = url.pathname === "/company/residents" || tenantDetail;
    const tenantId = url.searchParams.get("tenantId");
    const tenantOrigin = prospectHandoff && !!tenantId && tenantId.length <= 200 && !/[\\\x00-\x1f\x7f]/.test(tenantId);
    const prospectId = url.searchParams.get("prospectId");
    const prospectOrigin = prospectHandoff && !!prospectId && prospectId.length <= 200 && !/[\\\x00-\x1f\x7f]/.test(prospectId);
    const query = new URLSearchParams();
    for (const [key,item] of url.searchParams) {
      const pageCursor = ((maintenanceReturn || tenantDirectory) && (key === "cursor" || key === "before"))
        || (tenantDetail && (key === "rentalCursor" || key === "rentalBefore"))
        || (tenantOrigin && ["tenantCursor", "tenantBefore", "tenantHistoryCursor", "tenantHistoryBefore"].includes(key));
      const tenantFilter = tenantOrigin && (key === "tenantQ" || key === "tenantSection" && item === "rentals");
      const nestedMaintenance = maintenanceReturn && key === "nested" && item === "true";
      const prospectPage = url.pathname === "/company/prospects" && key === "cursor";
      const prospectFilter = prospectOrigin && !!item && (
        ["prospectQ", "prospectProperty", "prospectCursor"].includes(key) ||
        key === "prospectStage" && ["inquiry", "tour", "application", "review", "approved", "declined", "withdrawn", "converted"].includes(item) ||
        key === "prospectDue" && ["overdue", "today", "upcoming"].includes(item)
      );
      const leaseOnboarding = /^\/company\/leases\/[^/]+$/.test(url.pathname) && key === "onboarding" && item === "household";
      if ((allowed.has(key) || pageCursor || tenantFilter || nestedMaintenance || prospectPage || prospectFilter || leaseOnboarding) && item.length <= (pageCursor ? 512 : 200) && !/[\\\x00-\x1f\x7f]/.test(item) && (!pageCursor || /^[A-Za-z0-9_-]+$/.test(item))) query.set(key,item);
    }
    return url.pathname + (query.size ? `?${query}` : "");
  } catch { return "/dashboard"; }
}
export function defaultDestination(user: Principal) {
  const p = permissions(user);
  return p.includes("platform.manage")
    ? "/platform/companies"
    : p.includes("platform.impersonate")
      ? "/platform/impersonation"
    : p.includes("property.read")
      ? "/company/overview"
      : p.includes("resident.self")
        ? "/resident"
        : p.includes("subscription.read")
          ? "/company/subscription"
        : "/access";
}

// The guide is derived from the same grants used by requirePermission().
// Keeping the two together prevents UI descriptions from inventing authority.
export function companyRoleGuide() {
  const labels: Record<CompanyRole,string>={owner:"Company owner",manager:"Manager",staff:"Staff",resident:"Resident"};
  return COMPANY_ROLES.map(role=>({role,label:labels[role],permissions:[...grants[role]]}));
}
