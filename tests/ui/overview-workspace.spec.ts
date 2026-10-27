import { test, expect, Page } from "@playwright/test";

async function fixture(page: Page, role = "owner") {
  const state = { status: 200, hold: false, release: () => {}, requests: [] as string[], features: undefined as undefined | Record<string, string>, support: false, quiet: false };
  const properties = [
    { id: "maple", name: "Maple House", address: "12 Maple Street", city: "Atlanta", state: "GA", _count: { units: 4 } },
    { id: "garden", name: "Garden Apartments", address: "21 Garden Lane", city: "Atlanta", state: "GA", _count: { units: 8 } },
  ];
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    state.requests.push(path + url.search);
    if (path === "/api/bootstrap") return json({
      user: { id: role, name: "Fictional Operator", email: `${role}@test.invalid`, emailVerified: true, status: "active" },
      membership: { companyId: "fictional", version: 1, role, status: "active", company: { name: "Fictional Company", status: "active" } },
      permissions: role === "staff" ? ["property.read"] : ["property.read", "property.write", "lease.manage", "maintenance.manage", "finance.manage", "resident.assignment.manage", ...(role === "owner" ? ["members.manage"] : [])],
      destination: "/company/overview", csrfToken: "fixture", ...(state.features ? { companyFeatures: state.features } : {}), ...(state.support ? { impersonation: { contextId: "fixture-support", actor: { id: "support-actor", name: "Fictional Support", email: "support@test.invalid" }, readOnly: true, expiresAt: "2099-01-01T00:00:00Z" } } : {}),
    });
    if (path === "/api/company/properties") return json(properties);
    if (path === "/api/company/overview") {
      if (state.hold) await new Promise<void>(resolve => { state.release = resolve; });
      if (state.status !== 200) return json({ error: state.status === 403 ? "Access is no longer available." : "The overview is temporarily unavailable." }, state.status);
      const id = url.searchParams.get("propertyId");
      return json({
        company: { name: "Fictional Company", timezone: "America/New_York" }, property: id ? properties.find(p => p.id === id) : null,
        today: "2026-10-25", generatedAt: "2026-10-25T12:00:00Z", propertyCount: id ? 1 : 2,
        activeUnitCount: id === "maple" ? 4 : 12, properties: id ? properties.filter(p => p.id === id) : properties,
        ...(role === "staff" ? {} : {
          billingIssues: { count: state.quiet ? 0 : 1 }, ...(role === "owner" ? { residentApprovals: { pendingCount: state.quiet ? 0 : 2 } } : {}),
          rentCollections: { pastDueCents: "45000", afterGraceCents: state.quiet ? "0" : "30000", withinGraceCents: "15000", pastDueLeaseCount: 3, afterGraceLeaseCount: state.quiet ? 0 : 2 },
          maintenance: { openCount: state.quiet ? 0 : 8, highPriorityCount: state.quiet ? 0 : 1, reviewCount: state.quiet ? 0 : 2, overdueCount: state.quiet ? 0 : 3, latest: [] },
          leases: { inEffectCount: id === "maple" ? 3 : 9, draftCount: state.quiet ? 0 : 2, endingSoonCount: state.quiet ? 0 : 1, pastEndCount: state.quiet ? 0 : 1, withoutCurrentLease: id === "maple" ? 1 : 3, endingSoon: state.quiet ? [] : [{ id: "lease-one", propertyId: "maple", endsOn: "2026-11-01", property: { name: "Maple House" }, unit: { label: "Unit 1" } }] },
          cash: { dateFrom: "2026-10-01", dateTo: "2026-10-25", incomeCents: "450000", expenseCents: "30000", netCents: "420000" },
        }),
      });
    }
    return json([]);
  });
  return state;
}

test("daily work separates urgent follow-up, approvals and future handoffs without losing property source context", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/overview?propertyId=maple");
  const scope = page.getByRole("region", { name: "Today scope", exact: true });
  await expect(scope.getByRole("combobox", { name: "Property", exact: true })).toHaveValue("maple");
  await expect(scope).toContainText("Tasks, totals and source links below follow this property.");
  const urgent = page.getByRole("group", { name: "Follow up now", exact: true });
  await expect(urgent.getByRole("link", { name: /Follow up rent past grace/ })).toHaveAttribute("href", "/company/properties/maple/rent?view=after_grace");
  await expect(urgent.getByRole("link", { name: /Follow up overdue maintenance/ })).toHaveAttribute("href", "/company/properties/maple/maintenance?due=overdue");
  await expect(urgent.getByRole("link", { name: /Leases ending within 30 days/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Review and approve", exact: true }).getByRole("link", { name: /Approve resident requests/ })).toHaveAttribute("href", "/company/properties/maple/leases?approvals=pending");
  const planning = page.getByRole("region", { name: "Plan ahead", exact: true });
  await expect(planning.getByRole("link", { name: /Finish draft leases/ })).toHaveAttribute("href", "/company/properties/maple/leases?status=draft");
  await planning.getByText("Upcoming lease endings · 1 shown", { exact: true }).click();
  const source = planning.getByRole("link", { name: /Maple House · Unit 1/ });
  await expect(source).toHaveAttribute("href", /leaseListProperty=maple/);
  await expect(source).toHaveAttribute("href", /leaseListAttention=ending_soon/);
  await scope.getByRole("button", { name: "Clear property filter", exact: true }).click();
  await expect(page).toHaveURL(/\/company\/overview$/);
  await expect(scope.getByRole("combobox")).toHaveValue("");
  await expect(page.getByRole("region", { name: "Portfolio snapshot", exact: true })).toContainText("12");
});

test("Today starts move-in in the selected property and offers saved work without inventing a scoped draft count", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/overview?propertyId=maple");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Start move-in/ })).toHaveAttribute("href", "/company/properties/maple/leases?new=lease");
  await expect(page.getByRole("link", { name: "Resume saved work", exact: true })).toHaveAttribute("href", "/company/drafts");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole("link", { name: "Resume saved work", exact: true }).focus();
  await expect(page.getByRole("link", { name: "Resume saved work", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("disabled leasing removes move-in and saved-work shortcuts", async ({ page }) => {
  const state = await fixture(page);
  state.features = Object.fromEntries(["properties", "leasing", "maintenance", "documents", "finances", "reports", "inspections", "agreements", "notifications", "resident_portal"].map(key => [key, key === "leasing" ? "disabled" : "enabled"]));
  await page.goto("/company/overview");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Start move-in/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Resume saved work", exact: true })).toHaveCount(0);
});

test("refresh keeps the last snapshot explicit through a temporary failure and removes it on authoritative denial", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/overview");
  const snapshot = page.getByRole("region", { name: "Portfolio snapshot", exact: true });
  await expect(snapshot).toContainText("12");
  state.hold = true;
  await page.getByRole("button", { name: "Refresh today", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("previous snapshot remains visible");
  await expect(snapshot).toContainText("12");
  state.status = 503; state.hold = false; state.release();
  await expect(page.getByRole("alert")).toContainText("Showing the last loaded snapshot");
  await expect(snapshot).toContainText("12");
  state.status = 200;
  await page.getByRole("alert").getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  state.status = 403;
  await page.getByRole("button", { name: "Refresh today", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Today unavailable", exact: true })).toBeVisible();
  await expect(snapshot).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toHaveCount(0);
});

test("staff gets a useful property workspace without management or financial projections on a narrow screen", async ({ page }, testInfo) => {
  const state = await fixture(page, "staff");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/company/overview");
  await expect(page.getByRole("heading", { name: "Browse the records shared with you", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse properties", exact: true })).toHaveAttribute("href", "/company/properties");
  for (const title of ["Needs attention", "Plan ahead", "Month to date", "Start a task"]) await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
  expect(state.requests.some(path => /finances|maintenance|leases|reports/.test(path))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("overview-staff-mobile.png"), fullPage: true });
});

test("manager daily work and source amounts stay readable on desktop and mobile", async ({ page }, testInfo) => {
  await fixture(page, "manager");
  await page.goto("/company/overview?propertyId=maple");
  await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toBeVisible();
  await expect(page.locator(".cash-summary")).toContainText("$4,200.00");
  await page.screenshot({ path: testInfo.outputPath("overview-manager-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: /Follow up rent past grace/ }).focus();
  await expect(page.getByRole("link", { name: /Follow up rent past grace/ })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("overview-manager-mobile.png"), fullPage: true });
});

test("read-only feature access keeps source views but removes unsupported creation shortcuts", async ({ page }) => {
  const state = await fixture(page);
  state.features = Object.fromEntries(["properties", "leasing", "maintenance", "documents", "finances", "reports", "inspections", "agreements", "notifications", "resident_portal"].map(key => [key, key === "leasing" ? "read_only" : "enabled"]));
  await page.goto("/company/overview");
  await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Finish draft leases/ })).toHaveAttribute("href", "/company/leases?status=draft");
  await expect(page.getByRole("link", { name: /Start move-in/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Record transaction/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Add property Create the property/ })).toHaveAttribute("href", "/company/properties?new=property");
});

test("a support session can inspect the workspace without creation shortcuts", async ({ page }) => {
  const state = await fixture(page);
  state.support = true;
  await page.goto("/company/overview");
  await expect(page.getByRole("region", { name: "Impersonation session", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Finish draft leases/ })).toHaveAttribute("href", "/company/leases?status=draft");
  await expect(page.getByRole("heading", { name: "Start a task", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Start move-in|Record transaction|Add property Create/ })).toHaveCount(0);
});

test("zero pending work stays calm without pretending recorded cash is a balance owed", async ({ page }) => {
  const state = await fixture(page);
  state.quiet = true;
  await page.goto("/company/overview");
  await expect(page.getByRole("heading", { name: "No urgent issues or approvals", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Follow up now", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Review and approve", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Plan ahead", exact: true })).toContainText("No upcoming lease endings or unfinished draft leases");
  await expect(page.locator(".cash-summary")).toContainText("$4,200.00");
  await expect(page.getByText("Received and paid cash; this does not calculate balances owed.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add your first property", exact: true })).toHaveCount(0);
});
