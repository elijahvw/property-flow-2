export type Capability =
  | "notification.read"
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
    title: "Rent & payments",
    permission: "finance.manage",
    section: "Company",
  },
  {
    path: "/resident/rent",
    title: "Rent & payments",
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
  { path: "/company/vacancies", title: "Availability", permission: "lease.manage", section: "Company" },
  { path: "/company/applications", title: "Applications", permission: "lease.manage", section: "Company" },
  { path: "/company/drafts", title: "Saved drafts", permission: "lease.manage", section: "Company" },
  { path: "/resident/documents", title: "Documents", permission: "resident.self", section: "Resident" },
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


// A page's location is separate from its portfolio navigation item. For
// example, a property's rent screen stays inside Properties while naming the
// actual task in the breadcrumb and browser title.
export function pageContext(pathname: string, search = "") {
  if (/^\/company\/(?:leases|properties\/[^/]+\/leases)$/.test(pathname) && new URLSearchParams(search).get("new") === "lease") {
    const directory = new URLSearchParams(search);
    directory.delete("new");
    return { title: "Record a lease", parent: { path: pathname + (directory.size ? `?${directory}` : ""), title: "Leases" } };
  }
  const propertyPage = pathname.match(/^\/company\/properties\/[^/]+(?:\/([^/]+))?$/);
  if (propertyPage) {
    const titles: Record<string, string> = {
      units: "Units", residents: "Tenant access", leases: "Leases",
      maintenance: "Maintenance", rent: "Rent & payments", finances: "Cash activity",
      reports: "Reports", deposits: "Deposits",
    };
    return { title: titles[propertyPage[1]] || "Property details", parent: routes.find(route => route.path === "/company/properties") };
  }
  const details: [RegExp, string, string][] = [
    [/^\/company\/applications\/prospects\/new$/, "Add an inquiry", "/company/applications"],
    [/^\/company\/applications\/prospects\/[^/]+\/edit$/, "Edit inquiry", "/company/applications"],
    [/^\/company\/applications\/prospects\/[^/]+$/, "Inquiry details", "/company/applications"],
    [/^\/company\/applications\/new$/, "Start an application", "/company/applications"],
    [/^\/company\/applications\/[^/]+\/edit$/, "Edit application notes", "/company/applications"],
    [/^\/company\/applications\/[^/]+\/convert$/, "Create a draft lease", "/company/applications"],
    [/^\/company\/applications\/[^/]+$/, "Application details", "/company/applications"],

    [/^\/company\/leases\/[^/]+\/statement$/, "Lease statement", "/company/leases"],
    [/^\/company\/leases\/[^/]+$/, "Lease details", "/company/leases"],
    [/^\/company\/(?:residents|tenants)\/[^/]+$/, "Tenant details", "/company/residents"],
    [/^\/company\/maintenance\/[^/]+$/, "Maintenance request", "/company/maintenance"],
    [/^\/company\/work-orders\/[^/]+$/, "Assigned request", "/company/work-orders"],
    [/^\/platform\/companies\/[^/]+$/, "Company details", "/platform/companies"],
    [/^\/resident\/maintenance\/[^/]+$/, "Maintenance request", "/resident/maintenance"],
    [/^\/resident\/leases\/[^/]+\/statement$/, "Lease statement", "/resident/rent"],
    [/^\/resident\/leases\/[^/]+\/terms$/, "Lease terms", "/resident"],
    [/^\/resident\/leases\/[^/]+\/settlement$/, "Move-out settlement", "/resident"],
    [/^\/company\/vendors(?:\/[^/]+)?$/, "Vendors", "/company/maintenance"],
    [/^\/company\/preventive(?:\/[^/]+)?$/, "Preventive maintenance", "/company/maintenance"],
    [/^\/company\/work-calendar$/, "Work calendar", "/company/maintenance"],
  ];
  for (const [pattern, title, parent] of details)
    if (pattern.test(pathname)) return { title, parent: routes.find(route => route.path === parent) };
  const route = routes.find(route => route.path === pathname) ||
    (pathname.startsWith("/help/") ? routes.find(route => route.path === "/help") : undefined);
  return { title: route?.title || "Workspace", parent: undefined };
}

export function navigationActive(path: string, pathname: string) {
  if (path === "/account") return path === pathname;
  if (path === "/resident") return path === pathname || /^\/resident\/leases\/[^/]+\/(terms|settlement)$/.test(pathname);
  if (path === "/resident/rent" && /^\/resident\/leases\/[^/]+\/statement$/.test(pathname)) return true;
  if (path === "/company/maintenance" && /^\/company\/(vendors|preventive|work-calendar)(?:\/|$)/.test(pathname)) return true;
  if (path === "/company/residents" && pathname.startsWith("/company/tenants/")) return true;
  return pathname === path || pathname.startsWith(path + "/");
}
