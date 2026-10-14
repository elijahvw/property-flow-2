export type Capability =
  | "platform.manage"
  | "property.read"
  | "property.write"
  | "company.manage"
  | "members.manage"
  | "resident.self"
  | "resident.assignment.manage"
  | "maintenance.manage"
  | "lease.manage"
  | "finance.manage";
export const routes: {
  path: string;
  title: string;
  permission?: Capability;
  section: string;
}[] = [
  {
    path: "/platform/companies",
    title: "Companies",
    permission: "platform.manage",
    section: "Platform",
  },
  {
    path: "/platform/users",
    title: "People & access",
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
    path: "/company/properties",
    title: "Properties",
    permission: "property.read",
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
  { path: "/company/finances", title: "Finances", permission: "finance.manage", section: "Company" },
  { path: "/company/leases", title: "Leases", permission: "lease.manage", section: "Company" },
  { path: "/company/maintenance", title: "Maintenance", permission: "maintenance.manage", section: "Company" },
  { path: "/resident/maintenance", title: "My requests", permission: "resident.self", section: "Resident" },
  { path: "/account", title: "My profile", section: "Account" },
];
export function visibleRoutes(permissions: readonly string[]) {
  return routes.filter(
    (route) => !route.permission || permissions.includes(route.permission),
  );
}
