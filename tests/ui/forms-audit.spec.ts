import { test, expect, type Page } from "@playwright/test";
import type { TaskDraft } from "../../client/src/components/TaskDraft";

async function fixture(page: Page) {
  const state = { drafts: [] as TaskDraft[], leasePosts: 0 };
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    const property = { id: "home", name: "Maple House", address: "1 Maple Street", city: "City", state: "PA", zip: "19100", version: 1 };
    if (path === "/api/bootstrap") return json({
      user: { id: "owner", email: "owner@test.invalid", status: "active", emailVerified: true },
      membership: { companyId: "a", version: 1, role: "owner", status: "active", company: { name: "Fixture Properties", status: "active" } },
      permissions: ["property.read", "property.write", "lease.manage", "resident.assignment.manage"], csrfToken: "fixture",
    });
    if (path === "/api/company/properties") return json([property]);
    if (path === "/api/company/properties/home") return json(property);
    if (path.endsWith("/residents")) return json([{ userId: "tenant", membership: { user: { name: "Fixture Tenant", email: "tenant@test.invalid" } } }]);
    if (path.endsWith("/units")) return json({ items: [{ id: "unit", label: "Suite A", propertyId: "home", status: "active", version: 1 }], nextCursor: null });
    if (path === "/api/company/task-drafts") {
      if (request.method() === "GET") return json({ items: state.drafts, hasMore: false });
      const body = request.postDataJSON();
      const draft: TaskDraft = {
        id: "saved-task", kind: body.kind, propertyId: body.propertyId, sourceId: body.sourceId ?? null,
        version: 1, actionKey: "b6dac7c4-83bf-49f7-9c34-26bf4c043103", values: body.values, context: body.context,
        sourceVersions: { property: { id: "home", version: 1 }, unit: { id: "unit", version: 1 }, account: { id: "tenant", version: 1 } },
        title: "New lease · Maple House", savedAt: "2026-10-22T14:00:00Z", expiresAt: "2026-11-21T14:00:00Z", stale: false,
      };
      state.drafts.push(draft);
      return json({ ...draft, href: "/company/drafts?draftId=saved-task" });
    }
    if (path === "/api/company/leases") {
      if (request.method() === "POST") {
        state.leasePosts++;
        return json({ error: "Lease details changed. Review the lease before trying again." }, 409);
      }
      return json({ items: [], nextCursor: null });
    }
    return json([]);
  });
  return state;
}

test("lease setup uses a page, keeps directory filters, and retains edits after browser Back", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/leases?status=draft&q=Maple");
  await page.getByRole("button", { name: "Record a lease", exact: true }).click();
  const editor = page.getByRole("region", { name: "Record a lease", exact: true });
  await expect(editor).toBeVisible();
  await expect(page).toHaveURL(/new=lease/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Record a lease", exact: true })).toBeFocused();
  await page.getByLabel("New lease monthly rent (USD)").fill("1250.00");
  await page.goBack();
  await expect(page.getByLabel("Lease view", { exact: true })).toHaveValue("draft");
  await expect(page.getByLabel("Find lease", { exact: true })).toHaveValue("Maple");
  await page.getByRole("button", { name: "Record a lease", exact: true }).click();
  await expect(page.getByLabel("New lease monthly rent (USD)")).toHaveValue("1250.00");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const instructions = await page.getByLabel("New lease payment instructions shared with resident (optional)").boundingBox();
  const review = await page.getByRole("button", { name: "Review lease", exact: true }).boundingBox();
  expect(review!.y).toBeGreaterThan(instructions!.y + instructions!.height);
  await page.screenshot({ path: "/tmp/propertyflow-lease-page-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Back to leases", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Close without saving changes?", exact: true });
  await expect(confirmation).toBeVisible();
  expect(await confirmation.evaluate(node => node.matches(":modal"))).toBe(true);
  await expect(confirmation.getByRole("button", { name: "Keep editing", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await confirmation.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await confirmation.getByRole("button", { name: "Save draft & close", exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(state.drafts).toHaveLength(1);
  expect(state.drafts[0]).toMatchObject({
    kind: "lease_create", propertyId: "home", sourceId: null,
    values: { monthlyRent: "1250.00" },
    context: { leaseListStatus: "draft", leaseListQ: "Maple" },
  });
  expect(state.leasePosts).toBe(0);
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
});

test("lease save errors receive focus and keep the reviewed details", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/leases?new=lease");
  await page.getByLabel("New lease start date").fill("2026-11-01");
  await page.getByLabel("New lease monthly rent (USD)").fill("1250.00");
  await page.getByRole("button", { name: "Review lease", exact: true }).click();
  await page.getByRole("button", { name: "Create lease record", exact: true }).click();
  const error = page.getByRole("alert").filter({ hasText: "Lease details changed" });
  await expect(error).toBeFocused();
  await page.getByRole("button", { name: "Back to lease details", exact: true }).click();
  await expect(page.getByLabel("New lease monthly rent (USD)")).toHaveValue("1250.00");
});

test("optional tenant details expand when browser validation needs a hidden field", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/leases?new=lease");
  await page.getByRole("button", { name: "Add tenant for this lease", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add tenant for this lease", exact: true });
  await expect(dialog.getByLabel("Emergency contact phone", { exact: true })).not.toBeVisible();
  await dialog.getByLabel("Full name *", { exact: true }).fill("Jordan Fixture");
  await dialog.getByLabel("Contact email", { exact: true }).fill("jordan@test.invalid");
  await dialog.getByText("Emergency contact · optional", { exact: true }).click();
  await dialog.getByLabel("Emergency contact phone", { exact: true }).fill("555-0123");
  await dialog.getByText("Emergency contact · optional", { exact: true }).click();
  await dialog.getByRole("button", { name: "Review tenant", exact: true }).click();
  await expect(dialog.getByLabel("Emergency contact name", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Emergency contact name", { exact: true })).toBeFocused();
  await dialog.getByLabel("Emergency contact name", { exact: true }).fill("Emergency Fixture");
  await dialog.getByRole("button", { name: "Review tenant", exact: true }).click();
  await expect(dialog.getByText("Emergency Fixture · 555-0123", { exact: true })).toBeVisible();
});

test("reverting a native field change closes an unchanged editor without a discard warning", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/properties/home/units");
  await page.getByRole("button", { name: "Edit unit Suite A", exact: true }).click();
  const name = page.getByLabel("Name for Suite A", { exact: true });
  await name.fill("Temporary name");
  await name.fill("Suite A");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});
