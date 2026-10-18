export type Capability =
  | "platform.manage"
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
export const routes: {
  path: string;
  title: string;
  permission?: Capability;
  section: string;
}[] = [
  { path: "/company/work-orders", title: "Assigned work", permission: "maintenance.execute", section: "Company" },
  {
    path: "/platform/companies",
    title: "Companies",
    permission: "platform.manage",
    section: "Platform",
  },
  {
    path: "/platform/users",
    title: "Users",
    permission: "platform.manage",
    section: "Platform",
  },
  {
    path: "/platform/audit",
    title: "Activity",
    permission: "platform.manage",
    section: "Platform",
  },
  {
    path: "/company/overview",
    title: "Overview",
    permission: "property.read",
    section: "Company",
  },
  {
    path: "/company/properties",
    title: "Properties",
    permission: "property.read",
    section: "Company",
  },
  {
    path: "/company/residents",
    title: "Tenants",
    permission: "resident.assignment.manage",
    section: "Company",
  },
  {
    path: "/company/members",
    title: "Team",
    permission: "members.manage",
    section: "Company",
  },
  {
    path: "/company/settings",
    title: "Company settings",
    permission: "company.manage",
    section: "Company",
  },
  {
    path: "/resident",
    title: "My rental",
    permission: "resident.self",
    section: "Resident",
  },
  {
    path: "/company/rent",
    title: "Rent & balances",
    permission: "finance.manage",
    section: "Company",
  },
  {
    path: "/resident/rent",
    title: "My rent",
    permission: "resident.self",
    section: "Resident",
  },
  {path:"/company/deposits",title:"Deposits",permission:"finance.manage",section:"Company"},
  {path:"/resident/deposits",title:"My deposit",permission:"resident.self",section:"Resident"},
  {
    path: "/company/reports",
    title: "Reports",
    permission: "finance.manage",
    section: "Company",
  },
  {
    path: "/company/finances",
    title: "Finances",
    permission: "finance.manage",
    section: "Company",
  },
  {
    path: "/company/leases",
    title: "Leases",
    permission: "lease.manage",
    section: "Company",
  },
  {
    path: "/company/maintenance",
    title: "Maintenance",
    permission: "maintenance.manage",
    section: "Company",
  },
  {
    path: "/resident/maintenance",
    title: "My requests",
    permission: "resident.self",
    section: "Resident",
  },
  { path: "/account", title: "My profile", section: "Account" },
];
export function visibleRoutes(permissions: readonly string[]) {
  return routes.filter(
    (route) => !route.permission || permissions.includes(route.permission),
  );
}
