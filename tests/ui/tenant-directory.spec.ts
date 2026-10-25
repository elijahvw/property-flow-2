import { test, expect, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { tenantDirectoryFixture, tenantRentalHistoryFixture } from "./tenant-directory-fixture";

const token = (offset: number) => Buffer.from(JSON.stringify({ offset })).toString("base64url");
const origin = { prospectId: "fictional-prospect", prospectQ: "pipeline search", prospectProperty: "pipeline-property", prospectStage: "approved", prospectDue: "today", prospectCursor: "pipeline-page" };
const association = (index: number, propertyId = "home") => ({
  leaseId: `fictional-lease-${index}`, propertyId, propertyName: propertyId === "home" ? "Fictional Maple House" : "Fictional Cedar House", unitLabel: `Apartment ${index}`,
  role: index % 2 ? "occupant" : "leaseholder", status: "former", startsOn: "2024-01-01", endsOn: "2024-08-31", blocksArchive: false,
});
const people = () => Array.from({ length: 123 }, (_, index) => ({
  kind: "contact", id: `fictional-contact-${index + 1}`, contactId: `fictional-contact-${index + 1}`, userId: `fictional-account-${index + 1}`,
  name: `Fictional Tenant ${String(index + 1).padStart(3, "0")}`, email: `tenant${index + 1}@test.invalid`, phone: null,
  status: "active", recordStatus: "active", portalState: "active", version: 1,
  user: { id: `fictional-account-${index + 1}`, name: `Fictional Tenant ${String(index + 1).padStart(3, "0")}`, email: `tenant${index + 1}@test.invalid`, status: "active", emailVerified: true },
  rentals: index === 0 ? Array.from({ length: 64 }, (_, rental) => association(rental + 1)) : [association(index + 100, index === 122 ? "cedar" : "home")],
}));
async function fixture(page: Page, options: { role?: string; leasing?: string; properties?: string; support?: boolean } = {}) {
  const state = {
    people: people(), calls: [] as URL[], writes: [] as string[], companyId: "fictional-company", bootstrapCompany: "fictional-company",
    fail: false, denied: false, stale: false, historyStale: false, historyFail: false, profileStatus: 200, financialStatus: 503, leaseStatus: 200,
    hold: false, release: null as (() => void) | null, alias: false,
  };
  await page.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status });
    if (!["GET", "HEAD"].includes(req.method()) && !path.includes("telemetry")) state.writes.push(path);
    if (path === "/api/bootstrap") return json({
      user: { id: "fictional-manager", name: "Fictional manager", email: "manager@test.invalid", status: "active", emailVerified: true, platformRole: null },
      membership: { companyId: state.bootstrapCompany, version: 1, role: options.role || "manager", status: "active", company: { id: state.bootstrapCompany, name: "Fictional Property Company", status: "active" } },
      permissions: !options.role || ["owner", "manager"].includes(options.role) ? ["resident.assignment.manage", "lease.manage", "property.read", "finance.manage"] : ["property.read"],
      companyFeatures: { properties: options.properties || "disabled", leasing: options.leasing || "enabled", finances: "disabled", documents: "disabled", maintenance: "disabled", inspections: "disabled", agreements: "disabled", notifications: "disabled", resident_portal: "disabled", reports: "disabled" },
      csrfToken: "fixture", destination: "/company/residents",
      impersonation: options.support ? { actor: { id: "fictional-support", name: "Fictional support", email: "support@test.invalid" }, contextId: "fictional-support", readOnly: true, expiresAt: "2099-10-24T20:00:00Z" } : null,
    });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/telemetry") return json({ accepted: true });
    if (path === "/api/company/resident-profiles/directory") {
      state.calls.push(url);
      if (state.hold) await new Promise<void>(resolve => { state.release = resolve; });
      if (state.denied) return json({ error: "Tenant access is no longer available." }, 403);
      if (state.fail) return json({ error: "The tenant page is temporarily unavailable." }, 503);
      const cursor = url.searchParams.get("cursor"), before = url.searchParams.get("before");
      if (state.stale && (cursor || before)) return json({ error: "This tenant page is no longer available.", code: "TENANT_CURSOR_UNAVAILABLE" }, 404);
      try { return json(tenantDirectoryFixture(state.people, url, { companyId: state.companyId })); }
      catch { return json({ error: "The tenant page link is invalid.", code: "INVALID_TENANT_CURSOR" }, 400); }
    }
    if (/\/rentals$/.test(path)) {
      state.calls.push(url);
      if (state.historyFail) return json({ error: "Rental history is temporarily unavailable." }, 503);
      if (state.historyStale && (url.searchParams.has("cursor") || url.searchParams.has("before"))) return json({ error: "This rental history page is no longer available.", code: "TENANT_CURSOR_UNAVAILABLE" }, 404);
      const person = state.people[0];
      return json(tenantRentalHistoryFixture(person, person.rentals, url, { companyId: state.companyId }));
    }
    if (/\/resident-(contacts|profiles)\/[^/]+\/workspace$/.test(path)) return json({ error: "Tenant financial information is temporarily unavailable." }, state.financialStatus);
    if (/\/resident-contacts\/[^/]+$/.test(path)) {
      if (state.profileStatus !== 200) return json({ error: "The invitation scope is too large. Rental history is available separately.", code: "INVITATION_SCOPE_TOO_LARGE" }, state.profileStatus);
      return json({ ...state.people[0], invitations: [], portal: null, activity: [], address: null, preferredName: null, user: state.people[0].user });
    }
    if (/\/resident-profiles\/[^/]+$/.test(path)) {
      if (state.alias) return json({ error: "The former company account is unavailable." }, 404);
      return json({ ...state.people[0], contactId: null, assignments: [], activity: [], contactName: state.people[0].name });
    }
    if (/\/leases\/[^/]+$/.test(path)) {
      if (state.leaseStatus !== 200) return json({ error: "This lease source is unavailable." }, state.leaseStatus);
      const rental = state.people[0].rentals.find(rental => rental.leaseId === path.split("/").pop()) || state.people[0].rentals[0];
      return json({ id: rental.leaseId, propertyId: rental.propertyId, unitId: "fictional-unit", residentId: state.people[0].userId, startsOn: rental.startsOn, endsOn: rental.endsOn, status: "ended", version: 1, rentCents: 100000, rentDueDay: 1, graceDays: 5, unit: { label: rental.unitLabel }, property: { name: rental.propertyName }, resident: state.people[0].user, renewals: [], overview: { householdCount: 1, financeAvailable: false } });
    }
    return json([]);
  });
  return state;
}

test("nonempty tenant views expose removable filters and reset without losing the prospect return", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/company/residents?${new URLSearchParams({ ...origin, q: "Fictional Tenant", propertyId: "home", rental: "former", access: "active", cursor: token(50) })}`);
  await expect(summary(page)).toHaveText(/122 tenants/);
  const active = page.getByLabel("Active filters", { exact: true });
  await expect(active.getByRole("button")).toHaveCount(4);
  await active.getByRole("button", { name: "Remove Portal: Active", exact: true }).click();
  await expect(page).toHaveURL(url => !url.searchParams.has("access") && !url.searchParams.has("cursor") && url.searchParams.get("propertyId") === "home" && url.searchParams.get("prospectId") === origin.prospectId);
  await expect(page.locator(".directory-view-summary")).toBeFocused();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(summary(page)).toHaveText("123 tenants · 50 shown on this page");
  const search = new URL(page.url()).searchParams;
  for (const key of ["q", "propertyId", "rental", "access", "cursor", "before"]) expect(search.has(key)).toBe(false);
  for (const [key, value] of Object.entries(origin)) expect(search.get(key)).toBe(value);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.writes).toHaveLength(0);
});
const directory = (page: Page) => page.getByRole("region", { name: "Tenant directory", exact: true });
const summary = (page: Page) => directory(page).locator(".directory-count");
const history = (page: Page) => page.getByRole("region", { name: "Rental history", exact: true });

test("copied bounded tenant pages have complete totals and global properties with leasing-only access", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/company/residents?cursor=${token(50)}`);
  await expect(directory(page).getByRole("row")).toHaveCount(51);
  await expect(summary(page)).toHaveText("123 tenants · 50 shown on this page");
  await expect(page.getByRole("link", { name: "Fictional Tenant 051", exact: true })).toBeVisible();
  await expect(page.getByLabel("Property", { exact: true }).getByRole("option", { name: "Fictional Cedar House" })).toHaveCount(1);
  const pager = page.getByRole("navigation", { name: "Tenant directory pages", exact: true });
  await pager.getByRole("button", { name: "Previous tenants", exact: true }).click();
  await expect(page).toHaveURL(url => url.searchParams.get("before") === token(50) && !url.searchParams.has("cursor"));
  await expect(page.getByRole("link", { name: "Fictional Tenant 001", exact: true })).toBeVisible();
  await expect(summary(page)).toBeFocused();
  await page.goBack();
  await expect(page.getByRole("link", { name: "Fictional Tenant 051", exact: true })).toBeVisible();
  await pager.getByRole("button", { name: "Next tenants", exact: true }).click();
  await expect(summary(page)).toHaveText("123 tenants · 23 shown on this page");
  await expect(pager.getByRole("button", { name: "Next tenants", exact: true })).toBeDisabled();
  expect(state.calls.filter(url => url.pathname === "/api/company/properties")).toHaveLength(0);
  expect(state.writes).toHaveLength(0);
  await page.screenshot({ path: "/tmp/propertyflow-tenant-directory-desktop-viewport.png" });
});

test("all filter edits clear both tenant cursors while debounced search preserves prospect context and typing focus", async ({ page }) => {
  const state = await fixture(page);
  await page.clock.install({ time: new Date("2026-10-24T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-24T12:00:01Z"));
  await page.goto(`/company/residents?${new URLSearchParams({ ...origin, cursor: token(50) })}`);
  await expect(summary(page)).toHaveText(/123 tenants/);
  const input = page.getByRole("searchbox", { name: "Find tenant", exact: true });
  await input.fill("Fictional Tenant 0");
  await expect(page).toHaveURL(url => url.searchParams.get("q") === "Fictional Tenant 0" && !url.searchParams.has("cursor") && !url.searchParams.has("before") && url.searchParams.get("prospectCursor") === origin.prospectCursor);
  await expect(page.getByText("Updating search…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next tenants", exact: true })).toBeDisabled();
  expect(state.calls.at(-1)!.searchParams.get("q")).toBeNull();
  await page.clock.runFor(250);
  await expect(summary(page)).toHaveText("99 tenants · 50 shown on this page");
  await expect(input).toBeFocused();
  for (const [label, value] of [["Property", "home"], ["Rental relationship", "former"], ["Portal access", "active"], ["Tenant records", "archived"]]) {
    await page.getByLabel(label, { exact: true }).selectOption(value);
    await expect(page).toHaveURL(url => !url.searchParams.has("cursor") && !url.searchParams.has("before") && url.searchParams.get("prospectCursor") === origin.prospectCursor);
  }
  await expect(page.getByRole("heading", { name: "No matching tenants", exact: true })).toBeVisible();
});

test("stale copied tenant pages retain selected filters and recover global choices without silently changing page", async ({ page }) => {
  const state = await fixture(page); state.stale = true;
  await page.goto(`/company/residents?propertyId=home&rental=former&cursor=${token(50)}`);
  await expect(directory(page).getByRole("alert")).toContainText("no longer available");
  await expect(page.getByLabel("Property", { exact: true })).toHaveValue("home");
  await expect(page.getByLabel("Property", { exact: true }).getByRole("option", { name: "Fictional Cedar House" })).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("cursor")).toBe(token(50));
  await expect(summary(page)).toHaveText("Tenant count unavailable");
  await expect(directory(page).getByRole("row")).toHaveCount(0);
  await page.getByRole("button", { name: "Return to first tenant page", exact: true }).click();
  await expect(page).toHaveURL(url => url.searchParams.get("propertyId") === "home" && url.searchParams.get("rental") === "former" && !url.searchParams.has("cursor"));
  await expect(summary(page)).toHaveText("122 tenants · 50 shown on this page");
  await expect(summary(page)).toBeFocused();
  state.stale = false;
  await page.getByRole("button", { name: "Next tenants", exact: true }).click();
  await expect(summary(page)).toHaveText(/122 tenants/);
});

test("same-page refresh keeps typing focus, hides failed counts and recovers without losing global choices", async ({ page }) => {
  const state = await fixture(page);
  await page.clock.install();
  await page.goto(`/company/residents?cursor=${token(50)}`);
  await expect(summary(page)).toHaveText(/123 tenants/);
  const input = page.getByRole("searchbox", { name: "Find tenant", exact: true });
  await input.focus(); state.hold = true; state.fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Refreshing tenants…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next tenants", exact: true })).toBeDisabled();
  await expect(input).toBeFocused();
  await expect.poll(() => !!state.release).toBe(true);
  state.hold = false; state.release!();
  await expect(directory(page).getByRole("alert")).toContainText("temporarily unavailable");
  await expect(summary(page)).toHaveText("Tenant count unavailable");
  await expect(directory(page).getByRole("row")).toHaveCount(0);
  await expect(page.getByLabel("Property", { exact: true }).getByRole("option", { name: "Fictional Cedar House" })).toHaveCount(1);
  await expect(input).toBeFocused();
  state.fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(summary(page)).toHaveText(/123 tenants/);
  state.denied = true;
  await page.clock.runFor(251);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(directory(page).getByRole("alert")).toContainText("no longer available");
  await expect(page.getByLabel("Property", { exact: true }).getByRole("option", { name: "Fictional Cedar House" })).toHaveCount(0);
  await expect(directory(page).getByRole("row")).toHaveCount(0);
});

test("directory previews lead to complete independent rental history despite contact and finance failures", async ({ page }) => {
  const state = await fixture(page); state.profileStatus = 422;
  await page.goto("/company/residents");
  const row = directory(page).getByRole("row").filter({ hasText: "Fictional Tenant 001" });
  await expect(row.locator(".tenant-rental-association")).toHaveCount(3);
  await expect(row).toContainText("64 recorded rentals · 3 shown");
  await row.getByRole("link", { name: "View all rentals", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tenant unavailable", exact: true })).toBeVisible();
  await expect(history(page).getByRole("status")).toHaveText("64 recorded rentals · 50 shown on this page");
  await expect(history(page)).toContainText("Former · Occupant");
  await expect(history(page)).toContainText("January 1, 2024 – August 31, 2024");
  await history(page).getByRole("button", { name: "Next rentals", exact: true }).click();
  await expect(history(page).getByRole("status")).toHaveText("64 recorded rentals · 14 shown on this page");
  await expect(history(page).getByRole("status")).toBeFocused();
  await page.reload();
  await expect(history(page).getByRole("status")).toHaveText("64 recorded rentals · 14 shown on this page");
  state.profileStatus = 200;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Balances and leases unavailable", exact: true })).toBeVisible();
  await expect(history(page).getByRole("status")).toHaveText("64 recorded rentals · 14 shown on this page");
  expect(state.writes).toHaveLength(0);
  await history(page).evaluate(element => element.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: "/tmp/propertyflow-tenant-rental-history-desktop-viewport.png" });
});

test("legacy exact account aliases return canonically through a lease with independent page and prospect contexts", async ({ page }) => {
  const state = await fixture(page, { properties: "enabled" }); state.alias = true;
  const context = { q: "Fictional", access: "active", propertyId: "home", rental: "former", before: token(100), section: "rentals", rentalCursor: token(50), ...origin };
  await page.goto(`/company/residents/fictional-old-account?${new URLSearchParams(context)}`);
  await expect(page.getByRole("heading", { name: "Tenant unavailable", exact: true })).toBeVisible();
  await expect(history(page).getByRole("status")).toHaveText(/14 shown on this page/);
  await history(page).getByRole("link", { name: "Fictional Maple House · Apartment 51", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fictional Maple House · Apartment 51", exact: true })).toBeVisible();
  const lease = new URL(page.url());
  expect(lease.searchParams.get("tenantId")).toBe("fictional-contact-1");
  expect(lease.searchParams.get("tenantContact")).toBe("true");
  expect(lease.searchParams.get("tenantBefore")).toBe(token(100));
  expect(lease.searchParams.get("tenantHistoryCursor")).toBe(token(50));
  expect(lease.searchParams.get("prospectCursor")).toBe(origin.prospectCursor);
  await page.getByRole("button", { name: "Renewal", exact: true }).click();
  await page.getByRole("link", { name: "← Back to tenant", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === "/company/tenants/fictional-contact-1" && Object.entries(context).every(([key, value]) => url.searchParams.get(key) === value));
  await expect(history(page).getByRole("status")).toHaveText(/14 shown on this page/);
  await page.getByRole("link", { name: "← All tenants", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === "/company/residents" && url.searchParams.get("before") === token(100) && url.searchParams.get("q") === "Fictional" && !url.searchParams.has("rentalCursor") && !url.searchParams.has("section") && url.searchParams.get("prospectCursor") === origin.prospectCursor);
  await expect(summary(page)).toHaveText("122 tenants · 50 shown on this page");
});

test("unavailable lease sources and stale rental history recover without losing the directory return", async ({ page }) => {
  const state = await fixture(page); state.leaseStatus = 404;
  await page.goto(`/company/tenants/fictional-contact-1?q=Fictional&cursor=${token(50)}&section=rentals&rentalCursor=${token(50)}`);
  await expect(history(page).getByRole("status")).toHaveText(/14 shown on this page/);
  await history(page).getByRole("link", { name: "Fictional Maple House · Apartment 51", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lease unavailable", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "← Back to tenant", exact: true }).click();
  state.historyStale = true;
  await page.reload();
  await expect(history(page).getByRole("alert")).toContainText("no longer available");
  await expect(history(page).getByRole("link")).toHaveCount(0);
  await history(page).getByRole("button", { name: "First page of rental history", exact: true }).click();
  await expect(page).toHaveURL(url => !url.searchParams.has("rentalCursor") && url.searchParams.get("cursor") === token(50));
  await expect(history(page).getByRole("status")).toHaveText(/50 shown on this page/);
  await expect(history(page).getByRole("status")).toBeFocused();
});

test("company mismatch blocks directory and rental data until workspace reload", async ({ page }) => {
  const state = await fixture(page); state.companyId = "new-company";
  await page.goto("/company/residents");
  await expect(directory(page).getByRole("alert")).toContainText("workspace changed");
  await expect(directory(page).getByRole("row")).toHaveCount(0);
  await expect(summary(page)).toHaveText("Tenant count unavailable");
  state.bootstrapCompany = "new-company";
  await page.getByRole("button", { name: "Reload workspace", exact: true }).click();
  await expect(summary(page)).toHaveText(/123 tenants/);
  state.companyId = "third-company";
  await page.goto("/company/tenants/fictional-contact-1?section=rentals");
  await expect(history(page).getByRole("alert")).toContainText("workspace changed");
  await expect(history(page).getByRole("link")).toHaveCount(0);
});

for (const options of [{ leasing: "read_only" }, { support: true }]) test(`rental history is usable in ${options.support ? "support preview" : "read-only leasing"} without writes`, async ({ page }) => {
  const state = await fixture(page, options);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/tenants/fictional-contact-1?section=rentals");
  await expect(history(page).getByRole("status")).toHaveText(/64 recorded rentals/);
  await history(page).getByRole("button", { name: "Next rentals", exact: true }).click();
  await expect(history(page).getByRole("status")).toHaveText(/14 shown on this page/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.writes).toHaveLength(0);
  if (!options.support) {
    await page.screenshot({ path: "/tmp/propertyflow-tenant-rental-history-mobile-focused-viewport.png" });
    await history(page).evaluate(element => element.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: "/tmp/propertyflow-tenant-rental-history-mobile-viewport.png" });
    await page.goto(`/company/residents?cursor=${token(50)}`);
    await expect(summary(page)).toHaveText(/123 tenants/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "/tmp/propertyflow-tenant-directory-mobile-viewport.png" });
  }
});

for (const options of [{ role: "staff" }, { leasing: "disabled" }]) test(`tenant directory and history do not mount for ${options.role || "disabled leasing"}`, async ({ page }) => {
  const state = await fixture(page, options);
  await page.goto("/company/tenants/fictional-contact-1?section=rentals");
  await expect(history(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: options.role ? "Access unavailable" : "Feature unavailable", exact: true })).toBeVisible();
  expect(state.calls).toHaveLength(0);
});
