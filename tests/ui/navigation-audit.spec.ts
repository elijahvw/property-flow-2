import { test, expect, Page } from "@playwright/test";

async function fixture(page: Page, role = "manager", companyFeatures?: Record<string, string>) {
  const properties = [
    { id: "maple", name: "Maple House", address: "12 Maple Street", city: "Atlanta", state: "GA", zip: "30301", version: 1 },
    { id: "garden", name: "Garden Apartments", address: "21 Garden Lane", city: "Atlanta", state: "GA", zip: "30302", version: 1 },
  ];
  const state = { failSearch: false, propertyReads: 0 };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({
      user: { id: role, name: "Test Manager", email: `${role}@test.invalid`, emailVerified: true, status: "active", ...(role === "platform" ? { platformRole: "owner" } : {}) },
      membership: role === "platform" ? null : { companyId: "a", version: 1, role, status: "active", company: { id: "a", name: "Test Company", status: "active" } },
      permissions: role === "resident" ? ["resident.self"] : role === "platform" ? ["platform.manage"] : ["property.read", "property.write", "lease.manage", "finance.manage", "maintenance.manage"],
      destination: role === "resident" ? "/resident" : role === "platform" ? "/platform/companies" : "/company/leases", csrfToken: "fixture", companyFeatures,
    });
    if (path === "/api/company/properties") { state.propertyReads++; return state.failSearch ? json({ error: "Properties are temporarily unavailable." }, 503) : json(properties); }
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
  await expect(page.getByRole("button", { name: /Search workspace/ })).toBeVisible();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search workspace" });
  const query = dialog.getByRole("searchbox", { name: "Search workspace" });
  await expect(query).toBeFocused();
  await expect(dialog.getByRole("heading", { name: "Suggested pages" })).toBeVisible();
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
  await page.getByRole("button", { name: /Search workspace/ }).click();
  const dialog = page.getByRole("dialog", { name: "Search workspace" });
  await dialog.getByRole("searchbox").fill("Garden");
  await expect(dialog.getByRole("alert")).toContainText("temporarily unavailable");
  state.failSearch = false;
  await dialog.getByRole("button", { name: "Try again" }).click();
  await dialog.getByRole("searchbox").fill("missing property");
  await expect(dialog.getByRole("heading", { name: "No properties found" })).toBeVisible();
  await dialog.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(dialog.getByRole("searchbox")).toBeFocused();
  await expect(dialog.getByRole("heading", { name: "Suggested pages" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Browse all properties" })).toHaveAttribute("href", "/company/properties");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: /Search workspace/ })).toBeFocused();
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
  await expect(page.getByRole("button", { name: /Search workspace/ })).toBeVisible();
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
  await page.getByRole("button", { name: /Search workspace/ }).click();
  const dialog = page.getByRole("dialog", { name: "Search workspace" });
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
  await expect(page.getByRole("dialog", { name: "Search workspace" })).toHaveCount(0);
});

test("the mobile menu keeps tasks ordered and dismisses with Escape back to its toggle", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/leases");
  const toggle = page.getByRole("button", { name: "Menu", exact: true });
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation).not.toBeVisible();
  await toggle.click();
  const drawer = page.getByRole("dialog", { name: "Workspace menu" });
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  expect(await page.locator(".workspace-main").evaluate(node => (node as HTMLElement).inert)).toBe(true);
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link").first()).toHaveText("Overview");
  await expect(navigation.getByRole("link", { name: "Prospects", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Applications", exact: true })).toHaveCount(1);
  await navigation.getByRole("link", { name: "Leases", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(navigation).not.toBeVisible();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(await page.locator(".workspace-main").evaluate(node => (node as HTMLElement).inert)).toBe(false);
});

test("workspace search finds task language and secondary workspaces while property reads fail", async ({ page }) => {
  const state = await fixture(page);
  state.failSearch = true;
  await page.goto("/company/leases");
  await page.getByRole("button", { name: /Search workspace/ }).click();
  const dialog = page.getByRole("dialog", { name: "Search workspace" });
  const query = dialog.getByRole("searchbox", { name: "Search workspace" });
  await query.fill("vendor");
  await expect(dialog.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(dialog.getByRole("link", { name: /Vendors/ })).toHaveAttribute("href", "/company/vendors");
  await query.fill("late");
  const rent = dialog.getByRole("link", { name: /Rent & payments/ });
  await expect(rent).toBeVisible();
  await query.press("ArrowDown");
  await expect(rent).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/company\/rent$/);
  await expect(dialog).not.toBeVisible();
});

test("resident and platform page search never request company property data", async ({ page }) => {
  const resident = await fixture(page, "resident");
  await page.goto("/resident/rent");
  await page.getByRole("button", { name: /Search workspace/ }).click();
  let dialog = page.getByRole("dialog", { name: "Search workspace" });
  await dialog.getByRole("searchbox").fill("rent");
  await expect(dialog.getByRole("link", { name: /Rent & payments/ })).toHaveAttribute("href", "/resident/rent");
  await expect(dialog.locator('a[href^="/company"], a[href^="/platform"]')).toHaveCount(0);
  await expect(dialog.getByRole("region", { name: "Property search results" })).toHaveCount(0);
  expect(resident.propertyReads).toBe(0);
  await page.unroute("**/api/**");
  const platform = await fixture(page, "platform");
  await page.goto("/platform/companies");
  await page.getByRole("button", { name: /Search workspace/ }).click();
  dialog = page.getByRole("dialog", { name: "Search workspace" });
  await dialog.getByRole("searchbox").fill("people");
  await expect(dialog.getByRole("link", { name: /Users/ })).toHaveAttribute("href", "/platform/users");
  await expect(dialog.locator('a[href^="/company"], a[href^="/resident"]')).toHaveCount(0);
  expect(platform.propertyReads).toBe(0);
});

test("workspace page search follows feature availability and marks read-only workspaces", async ({ page }) => {
  await fixture(page, "manager", { finances: "disabled", maintenance: "read_only" });
  await page.goto("/company/leases");
  await page.getByRole("button", { name: /Search workspace/ }).click();
  const dialog = page.getByRole("dialog", { name: "Search workspace" });
  await dialog.getByRole("searchbox").fill("rent");
  await expect(dialog.locator('a[href="/company/rent"]')).toHaveCount(0);
  await dialog.getByRole("searchbox").fill("vendor");
  await expect(dialog.getByRole("link", { name: /Vendors/ })).toContainText("Read only");
});

test("mobile drawer traps focus, preserves page position and hands off to workspace search", async ({ page }, testInfo) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/leases");
  const mainY = (await page.locator("#main").boundingBox())!.y;
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Workspace menu" });
  await expect(drawer).toBeVisible();
  expect((await page.locator("#main").boundingBox())!.y).toBe(mainY);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await drawer.getByRole("button", { name: "Sign out", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(drawer.getByRole("link", { name: "P Property Flow" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("button", { name: "Sign out", exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("workspace-menu-mobile.png") });
  await drawer.getByRole("button", { name: "Search workspace", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole("dialog", { name: "Search workspace" })).toBeVisible();
  expect(await page.locator(".workspace-main").evaluate(node => (node as HTMLElement).inert)).toBe(false);
});

test("short mobile screens can reach every drawer action without scrolling the workspace", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto("/company/leases");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Workspace menu" });
  const signOut = drawer.getByRole("button", { name: "Sign out", exact: true });
  await signOut.scrollIntoViewIfNeeded();
  await expect(signOut).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeFocused();
});

test("a failed sign-out closes the drawer so its recovery message remains available", async ({ page }) => {
  await fixture(page);
  let attempts = 0;
  await page.route("**/api/auth/logout", route => { attempts++; return route.fulfill({ status: 503, json: { error: "Sign-out is temporarily unavailable." } }); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/leases");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Workspace menu" });
  await drawer.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  const workspace = page.locator("#main");
  await expect(workspace.getByRole("alert")).toHaveCount(1);
  await expect(workspace.getByRole("alert")).toContainText("Unable to sign out");
  await expect(workspace.getByRole("heading", { name: "Lease records", exact: true })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "Unable to load your account", exact: true })).toHaveCount(0);
  await workspace.getByRole("button", { name: "Try signing out again", exact: true }).click();
  await expect.poll(() => attempts).toBe(2);
  await expect(workspace.getByRole("alert")).toHaveCount(1);
  await expect(workspace.getByRole("heading", { name: "Lease records", exact: true })).toBeVisible();
  await page.getByLabel("Lease view", { exact: true }).selectOption("active");
  await expect(page).toHaveURL(/status=active/);
  expect(await page.locator(".workspace-main").evaluate(node => (node as HTMLElement).inert)).toBe(false);
});

test("property subpage breadcrumbs fit mobile screens and keep find/help controls reachable", async ({ page }, testInfo) => {
  await fixture(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/company/properties/maple/rent");
  await expect(page.locator("#main h1")).toBeVisible();
  await expect(page.locator(".topbar-location")).toContainText("Rent & payments");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: /Search workspace/ })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("navigation-small-mobile.png") });
});


test("mobile drawer preserves flow while the account and lazy workspace finish restoring", async ({ page }) => {
  await fixture(page);
  let release = () => {};
  const restoring = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/bootstrap", async route => { await restoring; return route.fallback(); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/leases");
  await expect(page.getByText("Restoring your sign-in…", { exact: true })).toBeVisible();
  const mainY = (await page.locator("#main").boundingBox())!.y;
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Workspace menu", exact: true });
  await expect(drawer).toBeVisible();
  expect((await page.locator("#main").boundingBox())!.y).toBe(mainY);
  release();
  await expect(drawer.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await expect(page.locator("#main h1")).toHaveText("Lease records");
  expect((await page.locator("#main").boundingBox())!.y).toBe(mainY);
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  expect((await page.locator("#main").boundingBox())!.y).toBe(mainY);
});

test("failed account restoration remains blocking and a later denied session hides private work", async ({ page }) => {
  await fixture(page);
  let restoreStatus = 503;
  await page.route("**/api/bootstrap", route => restoreStatus ? route.fulfill({ status: restoreStatus, json: { error: "Account restoration unavailable." } }) : route.fallback());
  await page.goto("/company/leases");
  const workspace = page.locator("#main");
  await expect(workspace.getByRole("heading", { name: "Unable to load your account", exact: true })).toBeVisible();
  await expect(workspace.getByRole("alert")).toHaveCount(1);
  await expect(workspace.getByRole("heading", { name: "Lease records", exact: true })).toHaveCount(0);
  restoreStatus = 0;
  await workspace.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(workspace.getByRole("heading", { name: "Lease records", exact: true })).toBeVisible();
  restoreStatus = 401;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(workspace.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "Lease records", exact: true })).toHaveCount(0);
  // An initial bootstrap 401 must finish restoration too; it cannot leave the
  // provider waiting for a generation invalidated by its own expiry event.
  await page.reload();
  await expect(workspace.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible();
  await expect(workspace.getByText("Restoring your sign-in…", { exact: true })).toHaveCount(0);
});


test("an older successful account restore cannot undo a definitive protected-read expiry", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/leases");
  const workspace = page.locator("#main");
  await expect(workspace.getByRole("status").filter({ hasText: "0 leases on this page" })).toBeVisible();
  let release = () => {}, markStarted = () => {}, protectedReads = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  await page.route("**/api/bootstrap", async route => { markStarted(); await pending; return route.fallback(); });
  await page.route("**/api/company/leases?*", async route => {
    if (new URL(route.request().url()).searchParams.get("status") !== "active") return route.fallback();
    protectedReads++;
    if (protectedReads !== 1) return route.fallback();
    await started;
    return route.fulfill({ status: 401, json: { error: "This protected session expired." } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await started;
  // A filter read starts deterministically even when the visibility refresher
  // correctly throttles another focus event from the last 250ms.
  await page.getByLabel("Lease view", { exact: true }).selectOption("active");
  await expect(workspace.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible();
  const staleRestore = page.waitForResponse(response => new URL(response.url()).pathname === "/api/bootstrap" && response.status() === 200);
  release();
  await (await staleRestore).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(workspace.getByRole("heading", { name: "Sign in to continue", exact: true })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "Lease records", exact: true })).toHaveCount(0);
  expect(protectedReads).toBe(1);
});
