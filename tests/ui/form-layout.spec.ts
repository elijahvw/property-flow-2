import { test, expect, BrowserContext } from "@playwright/test";

const company = { id: "layout-company", name: "Fictional Layout Company", status: "active", version: 1, timezone: "America/New_York", memberships: [] };
const catalog = [
  ["properties", "Properties and units", "Property records, units and company overview."],
  ["leasing", "Leasing and tenants", "Tenant records, leases and households."],
  ["maintenance", "Maintenance", "Requests, assigned work, vendors and calendar."],
  ["documents", "Private documents", "Permitted private uploads and downloads."],
  ["finances", "Rent and finances", "Rent, deposits and cash activity."],
  ["reports", "Reports", "Company financial reports and exports."],
  ["inspections", "Inspections", "Recorded lease condition and review."],
  ["agreements", "Agreement preparation", "Unsigned packages and version review."],
  ["notifications", "In-app notifications", "Source-linked company inboxes."],
  ["resident_portal", "Resident portal", "Authorized residents' assigned rental workspace."],
].map(([key, label, description]) => ({ key, label, description }));
const plan = { id: "layout-plan", name: "Fictional monthly plan", version: 1, monthlyPriceCents: 10000, currency: "USD", features: catalog.map(feature => feature.key), archivedAt: null, createdAt: "2026-10-24T12:00:00Z" };

async function fixture(context: BrowserContext) {
  const writes: unknown[] = [];
  await context.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({ user: { id: "layout-owner", name: "Fictional owner", email: "owner@test.invalid", emailVerified: true, status: "active", platformRole: "owner" }, membership: null, permissions: ["platform.manage"], destination: "/platform/companies", csrfToken: "fixture", impersonation: null });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/platform/plans") return json({ items: [plan], catalog });
    if (path === `/api/platform/companies/${company.id}`) return json(company);
    if (path.endsWith("/subscription") && request.method() === "GET") return json({ subscription: null, plans: [plan], catalog, effectiveFeatures: Object.fromEntries(catalog.map(feature => [feature.key, "enabled"])) });
    if (path.endsWith("/subscription") && request.method() === "PUT") { writes.push(request.postDataJSON()); return json({ error: "This account changed. Reopen the review to use its latest version." }, 409); }
    return json([]);
  });
  return writes;
}

test("subscription editor remains grouped, usable and recoverable at desktop and mobile sizes", async ({ page, context }) => {
  const writes = await fixture(context);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/platform/companies/${company.id}`);
  await page.getByRole("button", { name: "Manage subscription", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manage company subscription", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.screenshot({ path: `/tmp/propertyflow-ui-audit/${process.env.UI_AUDIT_PHASE || "after"}-subscription-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({ path: `/tmp/propertyflow-ui-audit/${process.env.UI_AUDIT_PHASE || "after"}-subscription-mobile.png` });
  const geometry = await dialog.evaluate(node => {
    const action = node.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const input = node.querySelector<HTMLInputElement>('input[name="billingEmail"]')!;
    return { scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, submit: action.getBoundingClientRect().toJSON(), input: input.getBoundingClientRect().toJSON(), viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  console.log(JSON.stringify({ phase: process.env.UI_AUDIT_PHASE || "after", geometry }));
  expect(geometry.overflow).toBe(false);
  if (process.env.UI_AUDIT_PHASE !== "before") {
    await expect(dialog.getByRole("combobox", { name: "Properties and units", exact: true })).toBeHidden();
    await dialog.locator("details.subscription-exceptions > summary").focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("combobox", { name: "Properties and units", exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("combobox", { name: "Properties and units", exact: true })).toBeHidden();
  }
  await dialog.getByLabel("Reason for this subscription change", { exact: true }).fill("Fictional layout review");
  await dialog.getByRole("button", { name: "Save subscription controls", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Reopen the review");
  if (process.env.UI_AUDIT_PHASE !== "before") {
    await expect(dialog.getByRole("alert")).toBeFocused();
    const errorBounds = await dialog.getByRole("alert").boundingBox();
    const headingBounds = await dialog.locator(".editor-heading").boundingBox();
    expect(errorBounds!.y).toBeGreaterThanOrEqual(headingBounds!.y + headingBounds!.height - 1);
    expect(errorBounds!.y + errorBounds!.height).toBeLessThanOrEqual(844);
    await dialog.screenshot({ path: "/tmp/propertyflow-ui-audit/after-subscription-mobile-error.png" });
  }
  await expect(dialog.getByLabel("Reason for this subscription change", { exact: true })).toHaveValue("Fictional layout review");
  expect(writes).toHaveLength(1);
  if (process.env.UI_AUDIT_PHASE !== "before") {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await dialog.getByRole("button", { name: "Save subscription controls", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeFocused();
    const desktopError = await dialog.getByRole("alert").boundingBox();
    const desktopHeading = await dialog.locator(".editor-heading").boundingBox();
    expect(desktopError!.y).toBeGreaterThanOrEqual(desktopHeading!.y + desktopHeading!.height - 1);
    expect(desktopError!.y + desktopError!.height).toBeLessThanOrEqual(1000);
    await dialog.screenshot({ path: "/tmp/propertyflow-ui-audit/after-subscription-desktop-error.png" });
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.getByRole("button", { name: "Save draft & close", exact: true }).click();
  await page.getByRole("button", { name: "Continue subscription draft", exact: true }).click();
  await expect(dialog.getByLabel("Reason for this subscription change", { exact: true })).toHaveValue("Fictional layout review");
});

test("monthly plan feature choices have readable labels and responsive control spacing", async ({ page, context }) => {
  await fixture(context);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/platform/plans");
  await page.getByRole("button", { name: "Publish monthly plan", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Publish monthly plan", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.screenshot({ path: `/tmp/propertyflow-ui-audit/${process.env.UI_AUDIT_PHASE || "after"}-plan-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({ path: `/tmp/propertyflow-ui-audit/${process.env.UI_AUDIT_PHASE || "after"}-plan-mobile.png` });
  console.log(JSON.stringify({ phase: process.env.UI_AUDIT_PHASE || "after", planGeometry: await dialog.evaluate(node => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, checkbox: node.querySelector('input[type="checkbox"]')!.getBoundingClientRect().toJSON(), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth })) }));
  if (process.env.UI_AUDIT_PHASE !== "before") {
    const box = await dialog.getByRole("checkbox", { name: /Properties and units/ }).boundingBox();
    expect(box!.width).toBeLessThanOrEqual(24);
    expect(box!.height).toBeLessThanOrEqual(24);
  }
  await dialog.getByRole("checkbox", { name: /Properties and units/ }).check();
  await expect(dialog.getByRole("checkbox", { name: /Properties and units/ })).toBeChecked();
});
