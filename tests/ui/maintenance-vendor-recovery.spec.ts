import { test, expect, Page } from "@playwright/test";

async function fixture(page: Page) {
  const vendor = (id: string) => ({ id, name: `Fictional vendor ${id}`, service: "Plumbing", contactName: "Fixture contact", email: "contact@test.invalid", phone: "555-0100", status: "active", version: 1 });
  const state = { failSource: false, failChoices: false, loseResponse: false, posts: [] as any[], sourceReads: 0, choiceReads: 0 };
  await page.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({ user: { id: "fixture-user", name: "Fixture manager", email: "manager@test.invalid", status: "active", emailVerified: true }, membership: { companyId: "fixture-company", role: "manager", version: 1, status: "active", company: { name: "Fictional company", status: "active" } }, permissions: ["property.read", "maintenance.manage"], csrfToken: "fixture" });
    if (path === "/api/account/guide") return json({ eligible: false });
    if (path === "/api/telemetry") return json({ accepted: true });
    if (path.endsWith("/preventive")) return json(null);
    if (path.endsWith("/updates") || path.endsWith("/history")) return json({ items: [], nextCursor: null });
    if (path === "/api/company/properties/home") return json({ id: "home", name: "Fictional house" });
    if (path === "/api/company/maintenance/request") return json({ id: "request", propertyId: "home", unitId: null, unit: null, title: "Fictional tap repair", description: "Tap needs repair.", category: "plumbing", status: "in_progress", priority: "normal", version: 1, targetOn: null, createdAt: "2026-10-16T12:00:00Z", updatedAt: "2026-10-16T12:00:00Z", property: { name: "Fictional house" }, activity: [], historyLimited: false, recordedBy: "Fixture manager", residentUpdatesAvailable: false });
    if (path === "/api/company/maintenance/request/vendor") {
      if (req.method() === "POST") {
        state.posts.push(req.postDataJSON());
        if (state.loseResponse) { state.loseResponse = false; return route.abort("failed"); }
        return json({ id: "link", version: 2, vendor: vendor("two") });
      }
      state.sourceReads++;
      return state.failSource ? json({ error: "Vendor link temporarily unavailable" }, 503) : json({ id: "link", version: 1, vendor: vendor("one") });
    }
    if (path === "/api/company/vendors") {
      state.choiceReads++;
      return state.failChoices ? json({ error: "Vendor choices temporarily unavailable" }, 503) : json({ items: [vendor("one"), vendor("two")], total: 2, pageSize: 25 });
    }
    return json([]);
  });
  return state;
}

test("vendor editor preserves its selection and blocks stale-source saves until refresh succeeds", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/maintenance/request");
  await page.getByRole("button", { name: "Change vendor contact", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose vendor contact", exact: true });
  await dialog.getByRole("button", { name: "Use Fictional vendor two", exact: true }).click();
  state.failSource = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog.getByRole("button", { name: "Refresh current vendor link", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save vendor link", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText("Selected: Fictional vendor two");
  expect(state.posts).toHaveLength(0);
  state.failSource = false;
  await dialog.getByRole("button", { name: "Refresh current vendor link", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save vendor link", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Save vendor link", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toMatchObject({ vendorId: "two", vendorVersion: 1, expectedVersion: 1 });
});

test("vendor picker freezes an interrupted submission and replays the original selected source", async ({ page }) => {
  const state = await fixture(page); state.loseResponse = true;
  await page.goto("/company/maintenance/request");
  await page.getByRole("button", { name: "Change vendor contact", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose vendor contact", exact: true });
  await dialog.getByRole("button", { name: "Use Fictional vendor two", exact: true }).click();
  await dialog.getByRole("button", { name: "Save vendor link", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("This request may already be saved");
  await expect(dialog.getByRole("button", { name: "Use Fictional vendor one", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("searchbox", { name: "Find an active vendor", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Save vendor link", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0]).toEqual(state.posts[1]);
});

test("failed vendor choices retain the reviewed selection and block saves until the directory recovers", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/maintenance/request");
  await page.getByRole("button", { name: "Change vendor contact", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose vendor contact", exact: true });
  await dialog.getByRole("button", { name: "Use Fictional vendor two", exact: true }).click();
  state.failChoices = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog.getByRole("button", { name: "Refresh vendor choices", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save vendor link", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText("Selected: Fictional vendor two");
  expect(state.posts).toHaveLength(0);
  state.failChoices = false;
  await dialog.getByRole("button", { name: "Refresh vendor choices", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save vendor link", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Save vendor link", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0]).toMatchObject({ vendorId: "two", vendorVersion: 1, expectedVersion: 1 });
});
