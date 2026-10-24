export type Capability =
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
export const routes: {
  path: string;
  title: string;
  permission?: Capability;
  section: string;
}[] = [
  { path: "/company/imports/expenses", title: "Import paid expenses", permission: "finance.manage", section: "Company" },
  { path: "/resident/documents", title: "My documents", permission: "resident.self", section: "Resident" },
  { path: "/company/prospects", title: "Prospects & applications", permission: "lease.manage", section: "Company" },
  { path: "/company/availability", title: "Availability & turnover", permission: "lease.manage", section: "Company" },
  { path: "/company/imports/units", title: "Import units", permission: "property.write", section: "Company" },
  { path: "/platform/plans", title: "Monthly plans", permission: "platform.manage", section: "Platform" },
  { path: "/company/subscription", title: "Plan & billing", permission: "subscription.read", section: "Company" },
  { path: "/platform/impersonation", title: "Impersonation", permission: "platform.impersonate", section: "Platform" },
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
    title: "Cash activity",
    permission: "finance.manage",
    section: "Company",
  },
  {
    path: "/company/leases",
    title: "Leases",
    permission: "lease.manage",
    section: "Company",
  },
  {path:"/company/documents",title:"Documents",permission:"maintenance.manage",section:"Company"},
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
  { path: "/account/notifications", title: "Notifications", permission: "notification.read", section: "Account" },
  { path: "/account", title: "My profile", section: "Account" },
  { path: "/help", title: "Help", section: "Account" },
];
export function visibleRoutes(permissions: readonly string[]) {
  return routes.filter(
    (route) => !route.permission || permissions.includes(route.permission),
  );
}
