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
  { path: "/company/applications", title: "Applications", permission: "lease.manage", section: "Company" },
  { path: "/company/drafts", title: "Saved drafts", permission: "lease.manage", section: "Company" },
  { path: "/company/imports/expenses", title: "Import paid expenses", permission: "finance.manage", section: "Company" },
  { path: "/resident/documents", title: "My documents", permission: "resident.self", section: "Resident" },
  { path: "/company/prospects", title: "Prospects", permission: "lease.manage", section: "Company" },
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

// Keep workflow placement and order explicit. Route registration order and words
// in a URL must never decide where a task appears in the menu.
export const navigationSections = [
  { title: "Workspace", paths: ["/company/overview", "/company/properties", "/company/residents", "/resident"] },
  { title: "Operations", paths: ["/company/availability", "/company/prospects", "/company/applications", "/company/leases", "/company/maintenance", "/company/work-orders", "/company/documents", "/company/drafts", "/resident/maintenance", "/resident/documents"] },
  { title: "Finance", paths: ["/company/rent", "/company/deposits", "/company/finances", "/company/reports", "/company/imports/expenses", "/resident/rent", "/resident/deposits"] },
  { title: "Administration", paths: ["/platform/companies", "/platform/users", "/platform/plans", "/platform/audit", "/platform/impersonation", "/company/members", "/company/settings", "/company/subscription", "/company/imports/units"] },
  { title: "Account", paths: ["/account/notifications", "/account", "/help"] },
] as const;

export function groupedNavigation(permissions: readonly string[]) {
  const visible = new Map(visibleRoutes(permissions).map(route => [route.path, route]));
  return navigationSections.map(section => ({
    title: section.title,
    routes: section.paths.flatMap(path => {
      const route = visible.get(path);
      return route ? [route] : [];
    }),
  }));
}

export type WorkspaceDestination = { path: string; title: string; group: string; keywords: string };

const taskKeywords: Record<string, string> = {
  "/company/overview": "dashboard today priorities portfolio",
  "/company/properties": "property portfolio buildings homes units addresses",
  "/company/residents": "tenants residents people contacts household access",
  "/company/leases": "tenancy rental agreements renewals household",
  "/company/availability": "vacant vacancy turnover readiness listings",
  "/company/prospects": "inquiries leads tours follow ups",
  "/company/applications": "applicants application review screening draft lease",
  "/company/maintenance": "repairs requests work management queue",
  "/company/work-orders": "assigned repairs staff jobs maintenance",
  "/company/rent": "balances receipts payment collection arrears late billing money",
  "/company/deposits": "security deposit held funds refund money",
  "/company/finances": "transactions income expense ledger cash money",
  "/company/reports": "reporting cash statements exports money",
  "/company/drafts": "unfinished saved tasks continue resume",
  "/company/members": "team staff people permissions roles invitations access",
  "/company/settings": "company business address preferences roles",
  "/company/subscription": "subscription invoices usage company billing",
  "/platform/users": "people accounts identity access permissions",
  "/platform/companies": "companies customer organizations demo",
  "/platform/audit": "history events activity",
  "/platform/impersonation": "support read only testing view user",
  "/account/notifications": "inbox alerts updates notices",
  "/account": "personal profile contact preferences password account",
  "/resident": "home household lease terms rental",
  "/resident/maintenance": "repairs maintenance requests help",
  "/resident/rent": "balance statement rent receipts payments money",
  "/resident/deposits": "security deposit held refund money",
  "/resident/documents": "files lease documents originals",
  "/help": "guidance how to help instructions",
};

// Search also exposes existing secondary workspaces without adding competing
// primary navigation items or granting authority through a search result.
export function workspaceDestinations(permissions: readonly string[]): WorkspaceDestination[] {
  const primary = groupedNavigation(permissions).flatMap(section => section.routes.map(route => ({
    path: route.path, title: route.title, group: section.title, keywords: taskKeywords[route.path] || "",
  })));
  const secondary = permissions.includes("maintenance.manage") ? [
    { path: "/company/vendors", title: "Vendors", group: "Maintenance", keywords: "contractors service contacts repair suppliers" },
    { path: "/company/preventive", title: "Preventive maintenance", group: "Maintenance", keywords: "scheduled recurring plans service tasks" },
    { path: "/company/work-calendar", title: "Work calendar", group: "Maintenance", keywords: "schedule calendar due dates work plans" },
  ] : [];
  return [...primary, ...secondary];
}

export function matchingWorkspaceDestinations(destinations: readonly WorkspaceDestination[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = destinations.filter(destination => terms.every(term =>
    `${destination.title} ${destination.group} ${destination.keywords}`.toLocaleLowerCase().includes(term),
  ));
  if (terms.length) {
    const phrase = query.trim().toLocaleLowerCase();
    const rank = (destination: WorkspaceDestination) => {
      const title = destination.title.toLocaleLowerCase();
      return title === phrase ? 0 : title.startsWith(phrase) ? 1 : title.includes(phrase) ? 2 : 3;
    };
    return matches.sort((a, b) => rank(a) - rank(b));
  }
  const common = ["/company/overview", "/company/properties", "/company/residents", "/company/leases", "/company/maintenance", "/company/rent", "/company/work-orders", "/resident", "/resident/maintenance", "/resident/rent", "/platform/companies", "/platform/users", "/account/notifications", "/company/drafts", "/account", "/help"];
  const rank = (path: string) => common.indexOf(path) < 0 ? common.length : common.indexOf(path);
  return matches.sort((a, b) => rank(a.path) - rank(b.path));
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
  if (pathname === "/company/prospects" && new URLSearchParams(search).get("prospectId")) {
    const directory = new URLSearchParams(search); directory.delete("prospectId");
    return { title: "Prospect details", parent: { path: pathname + (directory.size ? `?${directory}` : ""), title: "Prospects" } };
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
