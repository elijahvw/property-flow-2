import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const property = { id: "home", name: "Fictional Maple House", address: "1 Fixture Street", city: "City", state: "PA", zip: "19100", version: 1 };
  const state = { propertyWrites: [] as unknown[], leaseWrites: [] as unknown[] };
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({ user: { id: "owner", email: "owner@test.invalid", status: "active", emailVerified: true }, membership: { companyId: "a", version: 1, role: "owner", status: "active", company: { id: "a", name: "Fictional form company", status: "active" } }, permissions: ["property.read", "property.write", "finance.manage", "lease.manage", "resident.assignment.manage"], csrfToken: "fixture" });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/company/properties") {
      if (request.method() === "POST") { state.propertyWrites.push(request.postDataJSON()); return json({ error: "Review this fictional property before saving.", code: "RECORD_CHANGED" }, 409); }
      return json([property]);
    }
    if (path === "/api/company/properties/home") return json(property);
    if (path.endsWith("/units")) return json({ items: [{ id: "unit", propertyId: "home", label: "First suite", status: "active", version: 1 }], nextCursor: null });
    if (path.endsWith("/residents")) return json([{ userId: "tenant", membership: { user: { name: "Fixture Tenant", email: "tenant@test.invalid" } } }]);
    if (path === "/api/company/leases") {
      if (request.method() === "POST") state.leaseWrites.push(request.postDataJSON());
      return json({ items: [], nextCursor: null });
    }
    if (path === "/api/company/finances") return json({ items: [], nextCursor: null, summary: { incomeCents: "0", expenseCents: "0", netCents: "0" } });
    if (path === "/api/company/reports/context") return json({ name: "Fictional form company", timezone: "UTC", today: "2026-10-25" });
    if (path === "/api/company/reports/cash") return json({ generatedAt: "2026-10-25T12:00:00Z", company: { name: "Fictional form company", timezone: "UTC" }, currency: "USD", kind: "cash", basis: "Saved records.", filters: { propertyId: null, propertyName: null, dateFrom: null, dateTo: null }, summary: { incomeCents: "0", expenseCents: "0", netCents: "0", includedCount: 0, voidedCount: 0 }, groups: [], items: [] });
    if (path === "/api/company/task-drafts") return json({ companyId: "a", items: [], hasMore: false });
    if (path === "/api/company/task-drafts/inspection-task") return json({ id: "inspection-task", companyId: "a", kind: "inspection", propertyId: "home", sourceId: "lease", title: "Move-in condition review", version: 1, actionKey: "fixture-action", values: {}, context: {}, sourceVersions: {}, savedAt: "2026-10-25T12:00:00Z", expiresAt: "2026-11-24T12:00:00Z", stale: false });
    if (path === "/api/company/leases/lease/inspections") return json({ error: "Inspection sources are temporarily unavailable." }, 503);
    return json([]);
  });
  return state;
}

test("long lease forms expose keyboard section navigation without losing entered terms", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/leases?new=lease");
  const editor = page.getByRole("region", { name: "Record a lease", exact: true });
  const navigation = editor.getByRole("navigation", { name: "Form sections", exact: true });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("button")).toHaveText(["1Rental and tenant", "2Lease dates and rent", "3Rent payment terms"]);
  await page.getByLabel("New lease monthly rent (USD)", { exact: true }).fill("1250.00");
  await navigation.getByRole("button", { name: "Rent payment terms", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(editor.getByRole("group", { name: "Rent payment terms", exact: true }).locator("legend")).toBeFocused();
  await expect(page.getByLabel("New lease monthly rent (USD)", { exact: true })).toHaveValue("1250.00");
  const actualRequired = await editor.locator("form input[required], form select[required], form textarea[required]").evaluateAll(fields => fields.filter(field => !field.matches(":disabled") && !(field as HTMLElement).closest("[hidden]") && (field as HTMLElement).getClientRects().length > 0).length);
  await expect(editor.locator(".form-requirements")).toContainText(`${actualRequired} required fields`);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await navigation.getByRole("button", { name: "Lease dates and rent", exact: true }).click();
  await expect(editor.getByRole("group", { name: "Lease dates and rent", exact: true }).locator("legend")).toBeFocused();
  expect(state.leaseWrites).toHaveLength(0);
});

test("property fields connect optional labels and hints to native controls and retain rejected input", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/properties");
  await page.getByRole("button", { name: "Add property", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add a property", exact: true });
  const country = editor.getByRole("textbox", { name: "Country code", exact: true });
  await expect(country).toHaveAccessibleDescription("Two-letter country code, for example US.");
  await expect(country).not.toHaveAttribute("required");
  await expect(editor.getByRole("group", { name: "Building details", exact: true })).toHaveAccessibleDescription(/Optional details help/);
  await country.fill("US");
  await editor.getByLabel("Property name", { exact: true }).fill("Fictional form property");
  await editor.getByLabel("Street address", { exact: true }).fill("2 Fixture Street");
  await editor.getByLabel("City", { exact: true }).fill("City");
  await editor.getByLabel("State / region", { exact: true }).fill("PA");
  await editor.getByLabel("Postal code", { exact: true }).fill("19100");
  await editor.getByRole("button", { name: "Create property", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Review this fictional property");
  await expect(editor.getByRole("alert")).toBeFocused();
  await expect(country).toHaveValue("US");
  expect(state.propertyWrites).toHaveLength(1);
  expect(state.propertyWrites[0]).toMatchObject({ name: "Fictional form property", address: "2 Fixture Street", city: "City", state: "PA", zip: "19100", countryCode: "US" });
});

test("filtering updates a view without claiming a record was saved", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/finances");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(page.locator(".workflow-form-query")).toBeVisible();
  await expect(page.locator(".workflow-form-query .form-action-status")).toHaveCount(0);
  await expect(page.locator(".success-toast")).toHaveCount(0);
});

test("report queries use query busy wording and retain their specific generated-state confirmation", async ({ page }) => {
  await fixture(page);
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/company/reports/cash*", async route => { await pending; return route.fallback(); });
  await page.goto("/company/reports");
  await page.getByRole("button", { name: "Generate report", exact: true }).click();
  await expect(page.getByRole("button", { name: "Updating…", exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole("status").filter({ hasText: "Report generated." })).toBeVisible();
  await expect(page.locator(".success-toast")).toHaveCount(0);
});

test("a saved inspection task has neutral page-editor context and a real return destination", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/drafts?draftId=inspection-task");
  const task = page.getByRole("region", { name: "Move-in condition review", exact: true });
  await expect(task.getByText("Task details", { exact: true })).toBeVisible();
  await expect(task.getByText("Lease setup", { exact: true })).toHaveCount(0);
  await task.getByRole("button", { name: "Back to saved drafts", exact: true }).click();
  await expect(page).toHaveURL(/\/company\/drafts$/);
});


test("required-field guidance follows native conditional fields without counting collapsed details", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/leases?new=lease");
  await page.getByRole("button", { name: "Add tenant for this lease", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add tenant for this lease", exact: true });
  const guidance = dialog.locator(".form-requirements");
  await expect(guidance).toBeVisible();
  const initial = Number((await guidance.innerText()).match(/^\d+/)![0]);
  await dialog.getByLabel("Full name *", { exact: true }).fill("Fictional form tenant");
  await dialog.getByLabel("Contact email", { exact: true }).fill("tenant-form@test.invalid");
  await dialog.getByText("Emergency contact · optional", { exact: true }).click();
  await dialog.getByLabel("Emergency contact phone", { exact: true }).fill("555-0123");
  await dialog.getByText("Emergency contact · optional", { exact: true }).click();
  await expect(guidance).toContainText(`${initial} required fields`);
  await dialog.getByRole("button", { name: "Review tenant", exact: true }).click();
  await expect(dialog.getByLabel("Emergency contact name", { exact: true })).toBeFocused();
  await expect(guidance).toContainText(`${initial + 1} required fields`);
});


test("required guidance and actions stay in place during a pending save and recover after rejection", async ({ page }) => {
  await fixture(page);
  let release = () => {}, rejectionStatus = 400;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/company/properties", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    await pending;
    return route.fulfill({ status: rejectionStatus, json: { error: "Review the fictional address before saving." } });
  });
  await page.goto("/company/properties");
  await page.getByRole("button", { name: "Add property", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add a property", exact: true });
  await editor.getByLabel("Property name", { exact: true }).fill("Fictional stable form");
  await editor.getByLabel("Street address", { exact: true }).fill("3 Fixture Street");
  await editor.getByLabel("City", { exact: true }).fill("City");
  await editor.getByLabel("State / region", { exact: true }).fill("PA");
  await editor.getByLabel("Postal code", { exact: true }).fill("19100");
  const guidance = editor.locator(".form-requirements"), actions = editor.locator(".form-actions");
  await expect(guidance).toContainText("5 required fields");
  const submit = editor.getByRole("button", { name: "Create property", exact: true });
  await submit.scrollIntoViewIfNeeded();
  const before = await editor.locator("form").evaluate(form => ({ height: form.getBoundingClientRect().height, actions: form.querySelector(".form-actions")!.getBoundingClientRect().top }));
  await submit.click();
  await expect(editor.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(guidance).toContainText("5 required fields");
  const during = await editor.locator("form").evaluate(form => ({ height: form.getBoundingClientRect().height, actions: form.querySelector(".form-actions")!.getBoundingClientRect().top }));
  expect(Math.abs(during.height - before.height)).toBeLessThan(1);
  expect(Math.abs(during.actions - before.actions)).toBeLessThan(1);
  await expect(actions).toBeVisible();
  release();
  await expect(editor.getByRole("alert")).toContainText("Review the fictional address");
  await expect(editor.getByLabel("Property name", { exact: true })).toBeEnabled();
  await expect(guidance).toContainText("5 required fields");
  const nativeRequired = await editor.locator("input[required], select[required], textarea[required]").evaluateAll(fields => fields.filter(field => (field as HTMLInputElement).willValidate).length);
  expect(nativeRequired).toBe(5);
  await expect(editor.getByLabel("Street address", { exact: true })).toHaveValue("3 Fixture Street");
  rejectionStatus = 503;
  await editor.getByRole("button", { name: "Create property", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("This request may already be saved.");
  await expect(editor.getByLabel("Property name", { exact: true })).toBeDisabled();
  await expect(guidance).toContainText("5 required fields");
});
