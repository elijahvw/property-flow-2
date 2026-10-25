import { test, expect, Page } from "@playwright/test";

async function fixture(page: Page, role = "manager") {
  const properties = [
    { id: "maple", name: "Maple House", address: "12 Maple Street", city: "Atlanta", state: "GA", zip: "30301", version: 1 },
    { id: "garden", name: "Garden Apartments", address: "21 Garden Lane", city: "Atlanta", state: "GA", zip: "30302", version: 1 },
  ];
  const state = { failSearch: false };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({
      user: { id: role, name: "Test Manager", email: `${role}@test.invalid`, emailVerified: true, status: "active" },
      membership: { companyId: "a", version: 1, role, status: "active", company: { id: "a", name: "Test Company", status: "active" } },
      permissions: role === "resident" ? ["resident.self"] : ["property.read", "property.write", "lease.manage", "finance.manage", "maintenance.manage"],
      destination: role === "resident" ? "/resident" : "/company/leases", csrfToken: "fixture",
    });
    if (path === "/api/company/properties") return state.failSearch ? json({ error: "Properties are temporarily unavailable." }, 503) : json(properties);
    if (/^\/api\/company\/properties\/[^/]+$/.test(path)) return json(properties.find(property => path.endsWith("/" + property.id)));
    if (path.endsWith("/units")) return json({ items: [], nextCursor: null });
    if (path === "/api/company/leases") return json({ items: [], nextCursor: null });
    if (path === "/api/company/rent" || path === "/api/resident/rent") return json({ businessDate: "2026-10-21", accounts: [] });
    return json([]);
  });
  return state;
}

test("property finder distinguishes the query from results and supports keyboard selection", async ({ page }, testInfo) => {
  await fixture(page);
  await page.goto("/company/leases");
  await expect(page.getByRole("button", { name: /Find a property/ })).toBeVisible();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Find a property" });
  const query = dialog.getByRole("searchbox", { name: "Search properties" });
  await expect(query).toBeFocused();
  await expect(dialog.getByRole("heading", { name: "Which property do you need?" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Maple House/ })).toHaveCount(0);
  await query.fill("lane");
  await expect(dialog.getByRole("status")).toHaveText("1 matching property");
  await expect(dialog.getByRole("link", { name: /Garden Apartments/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("property-finder-desktop.png") });
  await query.press("ArrowDown");
  await expect(dialog.getByRole("link", { name: /Garden Apartments/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/company\/properties\/garden$/);
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Garden Apartments", exact: true })).toBeFocused();
});

test("property finder has recoverable errors, clear empty states and a distinct portfolio destination", async ({ page }) => {
  const state = await fixture(page);
  state.failSearch = true;
  await page.goto("/company/leases");
  await page.getByRole("button", { name: /Find a property/ }).click();
  const dialog = page.getByRole("dialog", { name: "Find a property" });
  await expect(dialog.getByRole("alert")).toContainText("temporarily unavailable");
  state.failSearch = false;
  await dialog.getByRole("button", { name: "Try again" }).click();
  await dialog.getByRole("searchbox").fill("missing property");
  await expect(dialog.getByRole("heading", { name: "No properties found" })).toBeVisible();
  await dialog.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(dialog.getByRole("searchbox")).toBeFocused();
  await expect(dialog.getByRole("heading", { name: "Which property do you need?" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Browse all properties" })).toHaveAttribute("href", "/company/properties");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: /Find a property/ })).toBeFocused();
});

test("property subpages name the current task and keep the portfolio navigation selected", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/properties/maple/units");
  await expect(page).toHaveTitle("Units · Property Flow");
  const breadcrumb = page.locator(".topbar-location");
  await expect(breadcrumb).toContainText("Properties");
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText("Units");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.locator('[aria-current="page"]')).toHaveText("Properties");
  await page.getByRole("navigation", { name: "Property navigation" }).getByRole("link", { name: "Rent & payments" }).click();
  await expect(page).toHaveTitle("Rent & payments · Property Flow");
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText("Rent & payments");
  await expect(navigation.locator('[aria-current="page"]')).toHaveText("Properties");
});

test("resident pages select one destination and leave the rental home unselected", async ({ page }) => {
  await fixture(page, "resident");
  await page.goto("/resident/rent");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(navigation.locator('[aria-current="page"]')).toHaveText("Rent & payments");
  await expect(navigation.getByRole("link", { name: "My rental", exact: true })).not.toHaveAttribute("aria-current");
  await expect(page.getByRole("button", { name: /Find a property/ })).toHaveCount(0);
});

test("changing a list filter keeps keyboard focus on the filter", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/leases");
  const filter = page.getByLabel("Lease view", { exact: true });
  await filter.focus();
  await filter.selectOption("active");
  await expect(page).toHaveURL(/status=active/);
  await expect(filter).toBeFocused();
});

test("the property finder fits a narrow screen without horizontal scrolling", async ({ page }, testInfo) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/properties/maple/units");
  await page.getByRole("button", { name: /Find a property/ }).click();
  const dialog = page.getByRole("dialog", { name: "Find a property" });
  await dialog.getByRole("searchbox").fill("Garden");
  await expect(dialog.getByRole("link", { name: /Garden Apartments/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("property-finder-mobile.png") });
});

test("the property shortcut leaves an unfinished editor in place", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/properties/maple");
  await page.getByRole("button", { name: "Edit property", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit property", exact: true });
  await editor.getByRole("textbox").first().fill("Revised property name");
  await page.keyboard.press("Control+k");
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("textbox").first()).toHaveValue("Revised property name");
  await expect(page.getByRole("dialog", { name: "Find a property" })).toHaveCount(0);
});
