import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, options: { role?: "owner" | "manager" | "staff"; readOnly?: boolean; finance?: boolean; portal?: boolean; support?: boolean } = {}) {
  const role = options.role || "owner";
  const state = {
    lease: { id: "move-in", propertyId: "home", unitId: "unit", residentId: "tenant-account", residentContactId: "tenant-contact", version: 1, status: "draft", startsOn: "2027-01-01", endsOn: "2027-12-31", rentCents: 123456, rentDueDay: 1, graceDays: 5, currency: "USD", property: { name: "Fictional Maple House" }, unit: { label: "Apartment 2" }, resident: { name: "Jordan Rivera", email: "jordan@test.invalid" }, overview: { householdCount: 0, pendingApprovals: 1, scheduleStatus: null as string | null, depositRecorded: true }, renewals: [] },
    requests: [] as string[], writes: [] as Record<string, unknown>[], leaseStatus: 200,
  };
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    state.requests.push(path);
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({ user: { id: role, email: `${role}@test.invalid`, status: "active", emailVerified: true }, membership: { companyId: "company", role, status: "active", version: 1, company: { id: "company", name: "Fictional Preview Company", status: "active" } }, permissions: ["property.read", ...(role === "staff" ? [] : ["lease.manage", ...(options.finance === false ? [] : ["finance.manage"]), ...(role === "owner" ? ["members.manage"] : [])])], companyFeatures: { properties: "enabled", leasing: options.readOnly ? "read_only" : "enabled", maintenance: "enabled", finances: options.finance === false ? "disabled" : "enabled", documents: "enabled", inspections: "enabled", agreements: "enabled", resident_portal: options.portal === false ? "disabled" : "enabled", notifications: "enabled", reports: "enabled" }, csrfToken: "fixture", ...(options.support ? { impersonation: { contextId: "fixture-support", actor: { id: "support-actor", name: "Fictional Support", email: "support@test.invalid" }, readOnly: true, expiresAt: "2099-01-01T00:00:00Z" } } : {}) });
    if (path === "/api/company/properties") return json([{ id: "home", name: "Fictional Maple House" }]);
    if (path === "/api/company/leases/move-in") {
      if (state.leaseStatus !== 200) return json({ error: "Lease access unavailable", code: "ACCESS_DENIED" }, state.leaseStatus);
      if (request.method() === "PATCH") {
        const body = request.postDataJSON(); state.writes.push(body);
        if (body.expectedVersion !== state.lease.version) return json({ error: "This lease changed. Review current terms." }, 409);
        state.lease.status = body.status; state.lease.version++;
      }
      return json(state.lease);
    }
    if (path.endsWith("/participants")) return json({ lease: state.lease, businessDate: "2026-10-26", items: [{ id: "primary", contactId: "tenant-contact", userId: "tenant-account", name: "Jordan Rivera", email: "jordan@test.invalid", role: "leaseholder", startsOn: state.lease.startsOn, endsOn: null, removedAt: null, version: 1 }], candidates: [] });
    if (path === "/api/company/rent") return json({ businessDate: "2026-10-26", generatedAt: "2026-10-26T12:00:00Z", accounts: [] });
    return json([]);
  });
  return state;
}

test("move-in keeps source context through household review, explicit activation and rent return", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/leases/move-in?onboarding=move-in&leaseListProperty=home&leaseListStatus=draft&prospectId=inquiry&prospectStage=approved&noticeReturn=inbox&noticeStatus=unread&noticePage=2");
  const guide = page.getByRole("region", { name: "Move-in setup", exact: true });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("Current household: 0. Future and former residents");
  await expect(guide.getByRole("button", { name: "Review draft & activate", exact: true })).toBeEnabled();
  expect(state.writes).toHaveLength(0);
  await guide.getByRole("button", { name: "Review household", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Leaseholders and occupants", exact: true })).toBeVisible();
  await expect(page).toHaveURL(url => url.searchParams.get("onboarding") === "move-in" && url.searchParams.get("noticePage") === "2" && url.searchParams.get("section") === "household");
  await page.reload();
  await page.getByRole("button", { name: "Continue move-in setup", exact: true }).click();
  await guide.getByRole("button", { name: "Review draft & activate", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review lease terms", exact: true });
  await expect(review.getByLabel("Lease monthly rent (USD)", { exact: true })).toHaveValue("1234.56");
  expect(state.writes).toHaveLength(0);
  await review.getByRole("button", { name: "Save lease terms", exact: true }).click();
  await expect(review).not.toBeVisible();
  await expect(guide).toContainText("Active lease record");
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({ expectedVersion: 1, status: "active" });
  await expect(guide).toContainText("No current recurring schedule");
  await expect(guide).toContainText("a record does not confirm money received");
  await guide.getByRole("link", { name: "Review rent setup", exact: true }).click();
  const back = page.getByRole("link", { name: "← Back to lease workspace", exact: true });
  await expect(back).toBeVisible();
  await back.click();
  await expect(guide).toBeVisible();
  await expect(page).toHaveURL(url => url.searchParams.get("onboarding") === "move-in" && url.searchParams.get("prospectId") === "inquiry" && url.searchParams.get("noticePage") === "2" && url.searchParams.get("leaseListProperty") === "home");
  await expect(page.getByRole("link", { name: "← All leases", exact: true })).toHaveAttribute("href", /propertyId=home.*status=draft/);
});

test("manager read-only move-in shows owner boundaries and omits disabled optional features", async ({ page }) => {
  const state = await fixture(page, { role: "manager", readOnly: true, finance: false, portal: false });
  await page.goto("/company/leases/move-in?onboarding=move-in");
  const guide = page.getByRole("region", { name: "Move-in setup", exact: true });
  await expect(guide).toContainText("An owner manages roster changes and approvals");
  await expect(guide).toContainText("Lease changes are read-only");
  await expect(guide.getByRole("button", { name: "Review draft & activate", exact: true })).toHaveCount(0);
  await expect(guide.getByRole("link", { name: "Review rent setup", exact: true })).toHaveCount(0);
  await expect(guide.locator("details")).toHaveCount(0);
  expect(state.requests.some(path => /rent|deposit|invitation/.test(path))).toBe(false);
  expect(state.writes).toHaveLength(0);
});

test("move-in handles unavailable lease reads without retaining its private guide", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/leases/move-in?onboarding=move-in");
  await expect(page.getByRole("region", { name: "Move-in setup", exact: true })).toBeVisible();
  state.leaseStatus = 403;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Lease unavailable", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Move-in setup", exact: true })).toHaveCount(0);
  await expect(page.getByText("Jordan Rivera", { exact: false })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test("move-in is usable by keyboard at 320px and keeps draft actions out of ended leases", async ({ page }, testInfo) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/company/leases/move-in?onboarding=move-in");
  const guide = page.getByRole("region", { name: "Move-in setup", exact: true });
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Review household", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/section=household/);
  await page.getByRole("button", { name: "Continue move-in setup", exact: true }).click();
  await expect(guide).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: testInfo.outputPath("move-in-mobile.png"), fullPage: true });
  state.lease.status = "ended";
  await page.reload();
  await expect(guide).toContainText("This lease has ended");
  await expect(guide.getByRole("button", { name: "Review draft & activate", exact: true })).toHaveCount(0);
  await expect(guide.locator("details")).toHaveCount(0);
});


test("support can review move-in without being offered activation or making writes", async ({ page }) => {
  const state = await fixture(page, { support: true });
  await page.goto("/company/leases/move-in?onboarding=move-in");
  await expect(page.getByRole("region", { name: "Impersonation session", exact: true })).toBeVisible();
  const guide = page.getByRole("region", { name: "Move-in setup", exact: true });
  await expect(guide).toContainText("Lease changes are read-only");
  await expect(guide.getByRole("button", { name: "Review draft & activate", exact: true })).toHaveCount(0);
  await guide.getByRole("button", { name: "Review household", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue move-in setup", exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
});

test("missing setup summaries stay unknown and a paused schedule keeps its actual state", async ({ page }, testInfo) => {
  const state = await fixture(page);
  state.lease.status = "active";
  const summary = state.lease.overview;
  Object.assign(state.lease, { overview: undefined });
  await page.goto("/company/leases/move-in?onboarding=move-in");
  const guide = page.getByRole("region", { name: "Move-in setup", exact: true });
  await expect(guide).toContainText("Review billing in rent setup");
  await expect(guide).toContainText("Review the deposit requirement and any receipts");
  await expect(guide).not.toContainText("No current recurring schedule");
  await expect(guide).not.toContainText("No deposit record");
  state.lease.overview = { ...summary, scheduleStatus: "paused" };
  await page.reload();
  await expect(guide).toContainText("Recurring schedule paused");
  await expect(guide).not.toContainText("No current recurring schedule");
  expect(state.writes).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("move-in-active-desktop.png"), fullPage: true });
});
