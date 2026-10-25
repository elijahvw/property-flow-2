import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const state = { posts: 0, pending: false, abort: false, release: undefined as (() => void) | undefined };
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    const property = { id: "home", name: "Maple House", address: "1 Maple Street", city: "City", state: "PA", zip: "19100" };
    if (path === "/api/bootstrap") return json({
      user: { id: "owner", email: "owner@test.invalid", status: "active", emailVerified: true },
      membership: { companyId: "a", version: 1, role: "owner", status: "active", company: { name: "Fixture Properties", status: "active" } },
      permissions: ["property.read", "property.write", "lease.manage", "resident.assignment.manage"], csrfToken: "fixture",
    });
    if (path === "/api/company/properties") return json([property]);
    if (path === "/api/company/properties/home") return json(property);
    if (path.endsWith("/residents")) return json([{ userId: "tenant", membership: { user: { name: "Fixture Tenant", email: "tenant@test.invalid" } } }]);
    if (path.endsWith("/units")) return json({ items: [{ id: "unit", label: "Suite A", propertyId: "home", status: "active", version: 1 }], nextCursor: null });
    if (path === "/api/company/leases") {
      if (request.method() !== "POST") return json({ items: [], nextCursor: null });
      state.posts++;
      if (state.pending) await new Promise<void>(resolve => { state.release = resolve; });
      if (state.abort) return route.abort("failed");
      return json({ error: "Lease details changed. Review the lease before trying again." }, 409);
    }
    return json([]);
  });
  return state;
}
const helpLink = (page: Page) => page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Help", exact: true });
async function startLease(page: Page, url = "/company/leases?new=lease") {
  await page.goto(url);
  await page.getByLabel("New lease monthly rent (USD)").fill("1250.00");
}

test("canceling sidebar navigation preserves the draft; confirmed navigation discards without creating a lease", async ({ page }) => {
  const state = await fixture(page);
  await startLease(page);
  page.once("dialog", async dialog => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain("discard its unsaved changes");
    await dialog.dismiss();
  });
  await helpLink(page).click();
  await expect(page).toHaveURL(/\/company\/leases\?new=lease$/);
  await expect(page.getByLabel("New lease monthly rent (USD)")).toHaveValue("1250.00");
  page.once("dialog", dialog => dialog.accept());
  await helpLink(page).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole("heading", { name: "Help Center", exact: true })).toBeVisible();
  expect(state.posts).toBe(0);
});

test("prerequisite links and a same-path property scope change both protect unfinished setup", async ({ page }) => {
  await fixture(page);
  await startLease(page, "/company/leases?propertyId=home&new=lease");
  await page.getByText("Property setup options", { exact: true }).click();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("link", { name: "Manage units for this property", exact: true }).click();
  await expect(page.getByLabel("New lease monthly rent (USD)")).toHaveValue("1250.00");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Leases", exact: true }).click();
  await expect(page).toHaveURL(/propertyId=home&new=lease/);
  await expect(page.getByLabel("New lease monthly rent (USD)")).toHaveValue("1250.00");
});

test("browser Back retains the draft on its directory and later navigation still warns", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/leases?status=draft");
  await page.getByRole("button", { name: "Record a lease", exact: true }).click();
  await page.getByLabel("New lease monthly rent (USD)").fill("1250.00");
  await page.goBack();
  await expect(page).toHaveURL(/status=draft$/);
  page.once("dialog", dialog => dialog.dismiss());
  await helpLink(page).click();
  await expect(page).toHaveURL(/status=draft$/);
  await page.getByRole("button", { name: "Record a lease", exact: true }).click();
  await expect(page.getByLabel("New lease monthly rent (USD)")).toHaveValue("1250.00");
});

test("a pending submission blocks navigation until its outcome is available", async ({ page }) => {
  const state = await fixture(page);
  state.pending = true;
  await startLease(page);
  await page.getByLabel("New lease start date").fill("2026-11-01");
  await page.getByRole("button", { name: "Review lease", exact: true }).click();
  await page.getByRole("button", { name: "Create lease record", exact: true }).click();
  await expect.poll(() => state.posts).toBe(1);
  await helpLink(page).click();
  await expect(page.getByRole("status").filter({hasText:"Finishing the current request"})).toBeVisible();
  await expect(page).toHaveURL(/new=lease/);
  state.release?.();
  await expect(page.getByRole("alert").filter({ hasText: "Lease details changed" })).toBeVisible();
  // The failed queued Help navigation is settled. A fresh destination must
  // protect the retained review instead of inheriting that older wait flag.
  let confirmations = 0;
  page.once("dialog", async dialog => {
    confirmations++;
    expect(dialog.message()).toContain("discard its unsaved changes");
    await dialog.dismiss();
  });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Properties", exact: true }).click();
  await expect.poll(() => confirmations).toBe(1);
  await expect(page).toHaveURL(/new=lease/);
  await expect(page.getByRole("alert").filter({ hasText: "Lease details changed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create lease record", exact: true })).toBeEnabled();
});

test("an interrupted request explains recovery before leaving", async ({ page }) => {
  const state = await fixture(page);
  state.abort = true;
  await startLease(page);
  await page.getByLabel("New lease start date").fill("2026-11-01");
  await page.getByRole("button", { name: "Review lease", exact: true }).click();
  await page.getByRole("button", { name: "Create lease record", exact: true }).click();
  await expect(page.getByText("This request may already be saved. Retry with the original details before starting another record.", { exact: true })).toBeVisible();
  page.once("dialog", async dialog => {
    expect(dialog.message()).toContain("request still needs recovery");
    expect(dialog.message()).toContain("may already be saved");
    await dialog.dismiss();
  });
  await helpLink(page).click();
  await expect(page).toHaveURL(/new=lease/);
  expect(state.posts).toBe(1);
});

test("canceling a property-search destination keeps both the search and unfinished lease", async ({ page }) => {
  await fixture(page);
  await startLease(page);
  await page.getByRole("button", { name: /Search workspace/ }).click();
  const finder = page.getByRole("dialog", { name: "Search workspace", exact: true });
  await finder.getByRole("searchbox", { name: "Search workspace" }).fill("Maple");
  page.once("dialog", dialog => dialog.dismiss());
  await finder.getByRole("link", { name: /Maple House/ }).click();
  await expect(finder).toBeVisible();
  await expect(page).toHaveURL(/new=lease/);
  await page.keyboard.press("Escape");
  await expect(finder).not.toBeVisible();
  await expect(page.getByLabel("New lease monthly rent (USD)")).toHaveValue("1250.00");
});

test("browser Back and Forward across routes protect a page task",async({page})=>{
 await fixture(page);await page.goto('/help');await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Leases',exact:true}).click();
 await page.getByRole('button',{name:'Record a lease',exact:true}).click();await page.getByLabel('New lease monthly rent (USD)').fill('1850.00');
 await page.goBack();await expect(page).toHaveURL(/company\/leases$/);
 page.once('dialog',dialog=>dialog.dismiss());await page.goBack();await expect(page).toHaveURL(/company\/leases$/);
 await page.goForward();await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('1850.00');
});
test("a native editor also protects browser Back across routes",async({page})=>{
 await fixture(page);await page.goto('/help');await page.getByRole('button',{name:/Search workspace/}).click();await page.getByRole('dialog',{name:'Search workspace',exact:true}).getByRole('searchbox',{name:'Search workspace'}).fill('Maple');await page.getByRole('dialog',{name:'Search workspace',exact:true}).getByRole('link',{name:/Maple House/}).click();
 await page.getByRole('navigation',{name:'Property navigation'}).getByRole('link',{name:'Units',exact:true}).click();
 await page.getByRole('button',{name:'Add a unit',exact:true}).click();await page.getByLabel('Unit name',{exact:true}).fill('Unfinished native task');
 page.once('dialog',dialog=>dialog.dismiss());await page.goBack();await expect(page.getByRole('dialog',{name:'Add a unit',exact:true})).toBeVisible();await expect(page.getByLabel('Unit name',{exact:true})).toHaveValue('Unfinished native task');
});
test("programmatic filter navigation cannot discard a retained task",async({page})=>{
 await fixture(page);await page.goto('/company/leases?unitId=unit');await page.getByRole('button',{name:'Record a lease',exact:true}).click();await page.getByLabel('New lease monthly rent (USD)').fill('1900.00');await page.goBack();
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Show all units',exact:true}).click();await expect(page).toHaveURL(/unitId=unit/);
 await page.getByRole('button',{name:'Record a lease',exact:true}).click();await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('1900.00');
});
