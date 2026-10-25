import { test, expect, BrowserContext, Locator, Page } from "@playwright/test";
import { tenantDirectoryFixture, tenantRentalHistoryFixture } from "./tenant-directory-fixture";

async function fixture(context: BrowserContext, platform = false) {
  const requests = { leases: [] as any[], tenants: [] as any[], accounts: [] as any[], emailRequests: 0 };
  const property = { id: "layout-home", name: "Fictional Garden House", address: "12 Fictional Street", city: "Philadelphia", state: "PA", zip: "19103", version: 1 };
  const unit = { id: "layout-unit", propertyId: property.id, label: "Garden apartment", status: "active", version: 1 };
  await context.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({ user: { id: "layout-user", name: "Fictional manager", email: "manager@test.invalid", emailVerified: true, status: "active", platformRole: platform ? "owner" : null }, membership: platform ? null : { companyId: "layout-company", version: 1, role: "owner", status: "active", company: { id: "layout-company", name: "Fictional company", status: "active" } }, permissions: platform ? ["platform.manage"] : ["property.read", "property.write", "lease.manage", "resident.assignment.manage", "members.manage", "finance.manage"], csrfToken: "fixture", destination: platform ? "/platform/users" : "/company/leases", impersonation: null });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/company/properties") return json([property]);
    if (path.endsWith("/units")) return json({ items: [unit], nextCursor: null });
    if (path.endsWith("/residents")) return json([{ userId: "layout-resident", membership: { user: { name: "Fictional tenant", email: "tenant@test.invalid" } } }]);
    if (path === "/api/company/resident-profiles/directory") return json(tenantDirectoryFixture([],request.url(),{companyId:"layout-company"}));
    if (path === "/api/company/resident-profiles/layout-resident/rentals") return json(tenantRentalHistoryFixture({userId:"layout-resident",status:"active",contactName:"Fictional tenant",user:{name:"Fictional tenant",email:"tenant@test.invalid",status:"active",emailVerified:true}},[],request.url(),{companyId:"layout-company"}));
    if (path === "/api/company/resident-profiles") return json([]);
    if (path === "/api/company/leases" && request.method() === "GET") return json({ items: [], nextCursor: null });
    if (path === "/api/company/leases" && request.method() === "POST") { requests.leases.push(request.postDataJSON()); return json({ error: "This unit changed. Review the current lease details.", code: "RECORD_CHANGED" }, 409); }
    if (path === "/api/company/resident-contacts" && request.method() === "POST") { requests.tenants.push(request.postDataJSON()); return json({ error: "Review the account details before saving this tenant.", code: "RECORD_CHANGED" }, 409); }
    if (path === "/api/platform/users") return json([]);
    if (path === "/api/platform/companies") return json([]);
    if (path === "/api/platform/users/sync") return json({ nextPage: null, limited: false, conflicts: [], created: 0 });
    if (path === "/api/platform/users/provision") { requests.accounts.push(request.postDataJSON()); return json({ error: "The account response was interrupted.", code: "REQUEST_FAILED" }, 503); }
    if (/verification|password|setup/.test(path)) requests.emailRequests++;
    return json([]);
  });
  return requests;
}

async function capture(page: Page, dialog: Locator, name: string) {
  const phase = process.env.UI_AUDIT_PHASE || "after";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await dialog.screenshot({ path: `/tmp/propertyflow-ui-audit/${phase}-${name}-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({ path: `/tmp/propertyflow-ui-audit/${phase}-${name}-mobile.png` });
  const geometry = await dialog.evaluate(node => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, headings: Array.from(node.querySelectorAll("legend")).map(node => node.textContent) }));
  console.log(JSON.stringify({ phase, name, geometry }));
  expect(geometry.overflow).toBe(false);
}

test("lease setup layout preserves reviewed terms and the source identity after rejection", async ({ page, context }) => {
  const requests = await fixture(context);
  await page.goto("/company/leases");
  await page.getByRole("button", { name: "Record a lease", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Record a lease", exact: true });
  await expect(dialog.getByLabel("Unit for new lease")).toBeVisible();
  await capture(page, dialog, "lease-setup");
  if (process.env.UI_AUDIT_PHASE !== "before") {
    await expect(dialog.getByRole("group", { name: "Rental and tenant", exact: true })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Manage residents", exact: true })).toBeHidden();
    await dialog.getByText("Property setup options", { exact: true }).click();
    await expect(dialog.getByRole("link", { name: "Manage residents", exact: true })).toBeVisible();
    await expect(dialog.getByText("How due dates and grace are applied", { exact: true })).toBeVisible();
  }
  await dialog.getByLabel("New lease start date", { exact: true }).fill("2026-11-01");
  await dialog.getByLabel("New lease monthly rent (USD)", { exact: true }).fill("1234.56");
  await dialog.getByRole("button", { name: "Review lease", exact: true }).click();
  await expect(dialog.getByText("$1234.56 USD", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Create lease record", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeFocused();
  await dialog.getByRole("button", { name: "Back to lease details", exact: true }).click();
  await expect(dialog.getByLabel("New lease monthly rent (USD)", { exact: true })).toHaveValue("1234.56");
  await expect(dialog.getByLabel("Unit for new lease")).toHaveValue("layout-unit");
  expect(requests.leases[0]).toMatchObject({ propertyId: "layout-home", unitId: "layout-unit", residentId: "layout-resident", monthlyRent: "1234.56", rentDueDay: 1, graceDays: 0, status: "draft" });
});

test("tenant setup remains account-first and preserves contact details through review and rejection", async ({ page, context }) => {
  const requests = await fixture(context);
  await page.goto("/company/residents");
  await page.getByRole("button", { name: "Add tenant", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add tenant", exact: true });
  await expect(dialog.getByLabel("Full name *", { exact: true })).toBeVisible();
  await capture(page, dialog, "tenant-setup");
  if (process.env.UI_AUDIT_PHASE !== "before") {
    await expect(dialog.getByLabel("Contact email", { exact: true })).toHaveAttribute("required", "");
    await page.setViewportSize({ width: 1440, height: 1000 });
    const name = await dialog.getByLabel("Full name *", { exact: true }).boundingBox();
    const email = await dialog.getByLabel("Contact email", { exact: true }).boundingBox();
    expect(name!.y).toBe(email!.y);
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await dialog.getByLabel("Full name *", { exact: true }).fill("Fictional Jordan Rivera");
  await dialog.getByLabel("Contact email", { exact: true }).fill("jordan@test.invalid");
  await dialog.getByRole("button", { name: "Review tenant", exact: true }).click();
  await dialog.getByRole("button", { name: "Save tenant", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeFocused();
  await dialog.getByRole("button", { name: "Back to contact details", exact: true }).click();
  await expect(dialog.getByLabel("Full name *", { exact: true })).toHaveValue("Fictional Jordan Rivera");
  await expect(dialog.getByLabel("Contact email", { exact: true })).toHaveValue("jordan@test.invalid");
  expect(requests.tenants[0]).toMatchObject({ name: "Fictional Jordan Rivera", email: "jordan@test.invalid" });
  expect(requests.tenants[0]).not.toHaveProperty("invitePortal");
  expect(requests.emailRequests).toBe(0);
});

test("account setup layout retains exact identity details after an interrupted request", async ({ page, context }) => {
  const requests = await fixture(context, true);
  await page.goto("/platform/users");
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add user", exact: true });
  await capture(page, dialog, "account-setup");
  if (process.env.UI_AUDIT_PHASE !== "before") {
    await expect(dialog.getByRole("group", { name: "Account details", exact: true })).toBeVisible();
    await expect(dialog.getByText("Review company access", { exact: true })).toBeHidden();
    await dialog.getByText("After creating the account", { exact: true }).click();
    await expect(dialog.getByText("Review company access", { exact: true })).toBeVisible();
    await dialog.getByText("After creating the account", { exact: true }).click();
  }
  await dialog.getByLabel("New user name", { exact: true }).fill("Fictional Robin");
  await dialog.getByLabel("New user email", { exact: true }).fill("robin@test.invalid");
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeFocused();
  await expect(dialog.getByLabel("New user email", { exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  expect(requests.accounts).toHaveLength(2);
  expect(requests.accounts[1]).toEqual(requests.accounts[0]);
  expect(requests.emailRequests).toBe(0);
});
