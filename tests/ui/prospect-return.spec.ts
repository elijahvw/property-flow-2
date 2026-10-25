import { test, expect, Page } from "@playwright/test";
import { tenantDirectoryFixture, tenantRentalHistoryFixture } from "./tenant-directory-fixture";

const marker = { prospectId: "fictional-prospect", prospectQ: "Original pipeline", prospectProperty: "pipeline-property", prospectStage: "converted", prospectDue: "today", prospectCursor: "pipeline-cursor" };
const markerQuery = () => new URLSearchParams(marker);
const expectedReturn = () => new URLSearchParams({ q: marker.prospectQ, propertyId: marker.prospectProperty, stage: marker.prospectStage, due: marker.prospectDue, cursor: marker.prospectCursor, prospectId: marker.prospectId });
async function fixture(page: Page, options: { allowed?: boolean; leasing?: string; support?: boolean; availableContact?: boolean } = {}) {
  const allowed = options.allowed !== false;
  const reads: URL[] = [], writes: string[] = [];
  const prospect = { id: marker.prospectId, companyId: "fictional-company", propertyId: "actual-property", unitId: null, name: "Fictional prospect", email: "prospect@test.invalid", phone: null, source: "phone", desiredMoveIn: null, followUpOn: "2026-10-24", notes: "Fictional record", stage: "converted", version: 2, contactId: "fictional-contact", leaseId: "fictional-lease", createdAt: "2026-10-24T10:00:00Z", updatedAt: "2026-10-24T12:00:00Z", property: { id: "actual-property", name: "Actual source property" }, unit: null };
  const contact = { id: "fictional-contact", name: "Fictional tenant", preferredName: null, email: "tenant@test.invalid", phone: null, status: "active", version: 1, userId: "fictional-user", user: { id: "fictional-user", email: "tenant@test.invalid", emailVerified: true, firstSignedInAt: null }, portal: null, invitations: [], activity: [], address: {} };
  const contactWorkspace = { businessDate: "2026-10-24", timezone: "UTC", generatedAt: "2026-10-24T12:00:00Z", financeAvailable: false, rent: null, deposits: null, leases: [{ id: "fictional-lease", propertyId: "actual-property", startsOn: "2026-01-01", endsOn: "2026-12-31", status: "active", rentCents: 10000, rentDueDay: 1, graceDays: 0, property: { name: "Actual source property" }, unit: { label: "Fictional apartment" }, rent: null, deposit: null }] };
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (request.method() !== "GET" && path !== "/api/telemetry") writes.push(path);
    reads.push(url);
    if (path === "/api/bootstrap") return json({
      user: { id: "fictional-manager", name: "Fictional manager", email: "manager@test.invalid", emailVerified: true, status: "active", platformRole: null },
      membership: { companyId: "fictional-company", version: 1, role: "manager", status: "active", company: { id: "fictional-company", name: "Fictional Property Company", status: "active" } },
      permissions: ["property.read", "resident.assignment.manage", "finance.manage", ...(allowed ? ["lease.manage"] : [])], csrfToken: "fixture", destination: "/company/residents",
      companyFeatures: { properties: "enabled", leasing: options.leasing || "enabled", finances: "enabled", documents: "disabled", inspections: "disabled", agreements: "disabled", notifications: "disabled", resident_portal: "enabled" },
      impersonation: options.support ? { actor: { id: "fictional-support", name: "Fictional support", email: "support@test.invalid" }, readOnly: true, expiresAt: "2099-10-24T20:00:00Z", contextId: "fictional-support" } : null,
    });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/telemetry") return json({ accepted: true });
    if (path === "/api/company/properties") return json([{ id: "actual-property", name: "Actual source property" }]);
    if (path === "/api/company/prospects") return json({ items: [], total: 0, counts: {}, today: "2026-10-24", timezone: "UTC", nextCursor: null });
    if (path === `/api/company/prospects/${marker.prospectId}/acquisition`) return json({ companyId: "fictional-company", prospect: { ...prospect, status: "closed" }, followUps: [], applications: [], history: [], followUpTotal: 0, applicationTotal: 0, historyTotal: 0 });
    if (path.endsWith("/follow-ups") || path.endsWith("/acquisition-history")) return json({ items: [], total: 0, page: 1, pageSize: 25 });
    if (path === `/api/company/prospects/${marker.prospectId}`) return json({ prospect, history: { items: [{ id: "fictional-action", version: 1, action: "conversion.reopened", reason: "Fictional prior source review", snapshot: { previousContactId: "previous-contact", previousLeaseId: "previous-lease", stage: "review" }, createdAt: "2026-10-24T11:00:00Z" }], nextCursor: null } });
    if (path === "/api/company/resident-profiles/directory") return json(tenantDirectoryFixture([{...contact,contactId:contact.id,recordStatus:"active",portalState:"offline",rentals:[]}],request.url(),{companyId:"fictional-company"}));
    if (path === "/api/company/resident-profiles") return json([{ contactId: contact.id, userId: contact.userId, name: contact.name, email: contact.email, recordStatus: "active", portalState: "offline", rentals: [] }]);
    if (path === "/api/company/resident-profiles/legacy-user/rentals") return json(tenantRentalHistoryFixture({userId:"legacy-user",status:"active",contactName:contact.name,user:contact.user},[],request.url(),{companyId:"fictional-company"}));
    if (path === "/api/company/resident-contacts/fictional-contact/rentals") return options.availableContact?json(tenantRentalHistoryFixture(contact,contactWorkspace.leases,request.url(),{companyId:"fictional-company"})):json({error:"This fictional source is unavailable."},404);
    if (path === "/api/company/resident-profiles/legacy-user") return json({ contactId: contact.id, contactName: contact.name, user: { name: contact.name, email: contact.email }, assignments: [], activity: [] });
    if (path === "/api/company/resident-contacts/fictional-contact" && options.availableContact) return json(contact);
    if (path === "/api/company/resident-contacts/fictional-contact/workspace") return json(contactWorkspace);
    if (path === "/api/company/deposits") return json({ businessDate: "2026-10-24", accounts: [], summary: { requiredCents: "0", heldCents: "0", outstandingCents: "0", excessHeldCents: "0", pastDueCents: "0" } });
    return json({ error: "This fictional source is unavailable." }, 404);
  });
  return { reads, writes };
}
const back = (page: Page) => page.getByRole("link", { name: "← Back to prospect", exact: true });
function assertReturn(url: string) {
  const parsed = new URL(url);
  expect(parsed.pathname).toBe("/company/prospects");
  expect(Object.fromEntries(parsed.searchParams)).toEqual(Object.fromEntries(expectedReturn()));
}

test("current and historical sources retain the original pipeline and offer one return link when unavailable", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/company/prospects?${expectedReturn()}`);
  await expect(back(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Open linked tenant", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tenant unavailable", exact: true })).toBeVisible();
  await expect(back(page)).toHaveCount(1);
  await page.screenshot({ path: "/tmp/propertyflow-prospect-return-desktop.png", fullPage: false });
  assertReturn(new URL((await back(page).getAttribute("href"))!, page.url()).href);
  expect(new URL(page.url()).searchParams.get("prospectProperty")).toBe("pipeline-property");
  await back(page).click(); assertReturn(page.url());
  await page.getByRole("link", { name: "Previous lease source", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lease unavailable", exact: true })).toBeVisible();
  await expect(back(page)).toHaveCount(1);
  await back(page).click(); assertReturn(page.url());
  expect(state.reads.some(url => url.pathname === "/api/company/leases/previous-lease")).toBe(true);
  expect(state.reads.some(url => url.pathname === "/api/company/resident-contacts/fictional-contact")).toBe(true);
  expect(state.reads.filter(url => /resident-contacts|\/leases\//.test(url.pathname)).every(url => !url.searchParams.has("prospectId"))).toBe(true);
  expect(state.writes).toHaveLength(0);
});

test("tenant filters, legacy redirects and tenant-to-lease sources preserve separate prospect filters", async ({ page }) => {
  const state = await fixture(page, { availableContact: true });
  await page.goto(`/company/residents?${markerQuery()}`);
  await page.getByRole("searchbox", { name: "Find tenant", exact: true }).fill("No matching tenant");
  await expect(page).toHaveURL(url => url.searchParams.get("q") === "No matching tenant" && url.searchParams.get("prospectQ") === marker.prospectQ);
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(page).toHaveURL(url => !url.searchParams.has("q") && url.searchParams.get("prospectQ") === marker.prospectQ);
  await page.goto(`/company/residents?residentId=legacy-user&${markerQuery()}`);
  await expect(page).toHaveURL(url => url.pathname === "/company/tenants/fictional-contact" && url.searchParams.get("prospectId") === marker.prospectId);
  await expect(back(page)).toHaveCount(1);
  await page.getByRole("link", { name: "Fictional apartment", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === "/company/leases/fictional-lease" && url.searchParams.get("prospectQ") === marker.prospectQ && url.searchParams.get("tenantId") === "fictional-contact");
  await back(page).click(); assertReturn(page.url());
  expect(state.writes).toHaveLength(0);
});

test("closing an unavailable deposit source preserves the return trail without a domain write", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/company/deposits?leaseId=missing-lease&${markerQuery()}`);
  const dialog = page.getByRole("dialog", { name: "Security deposit account", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("source is unavailable");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(url => !url.searchParams.has("leaseId") && url.searchParams.get("prospectQ") === marker.prospectQ);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/propertyflow-prospect-return-mobile.png", fullPage: false });
  await back(page).click(); assertReturn(page.url());
  expect(state.writes).toHaveLength(0);
});

for (const options of [
  { label: "normal management", allowed: true, leasing: "enabled", support: false, visible: true },
  { label: "read-only leasing", allowed: true, leasing: "read_only", support: false, visible: true },
  { label: "support impersonation", allowed: true, leasing: "enabled", support: true, visible: true },
  { label: "missing lease permission", allowed: false, leasing: "enabled", support: false, visible: false },
  { label: "disabled leasing", allowed: true, leasing: "disabled", support: false, visible: false },
]) test(`prospect return visibility follows current ${options.label}`, async ({ page }) => {
  const sourcePath = "/api/company/resident-contacts/missing-contact";
  const network: { event: string; path: string; elapsedMs: number; status?: number; error?: string }[] = [];
  const started = Date.now();
  let sourceStatus: number | undefined, complete = false;
  const record = (event: string, url: string, detail: { status?: number; error?: string } = {}) => {
    const path = new URL(url).pathname;
    if (network.length < 24 && (path === "/api/bootstrap" || path.startsWith(sourcePath))) network.push({ event, path, elapsedMs: Date.now() - started, ...detail });
  };
  page.on("request", request => record("request", request.url()));
  page.on("response", response => {
    record("response", response.url(), { status: response.status() });
    if (new URL(response.url()).pathname === sourcePath && response.request().method() === "GET") sourceStatus = response.status();
  });
  page.on("requestfailed", request => record("requestfailed", request.url(), { error: request.failure()?.errorText.slice(0, 300) }));
  const state = await fixture(page, options);
  try {
    await page.goto(`/company/tenants/missing-contact?${markerQuery()}`);
    // Confirm the scoped source response before checking its rendered state.
    // Disabled leasing has no permitted source read and renders its boundary.
    if (options.leasing !== "disabled") await expect.poll(() => sourceStatus, { timeout: 5000, message: "The current tenant source returns its unavailable response" }).toBe(404);
    await expect(page.getByRole("heading", { name: options.leasing === "disabled" ? "Feature unavailable" : "Tenant unavailable", exact: true })).toBeVisible();
    await expect(back(page)).toHaveCount(options.visible ? 1 : 0);
    expect(state.writes).toHaveLength(0);
    complete = true;
  } finally {
    if (!complete) await test.info().attach("prospect-return-source-readiness", { body: JSON.stringify({ case: options.label, sourceStatus: sourceStatus ?? "not received", network, fixtureReads: state.reads.slice(-24).map(url => url.pathname) }, null, 2), contentType: "application/json" });
  }
});
