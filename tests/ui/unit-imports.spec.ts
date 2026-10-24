import { test, expect, BrowserContext } from "@playwright/test";

async function fixture(context: BrowserContext, invalid = false) {
  const property = { id: "fictional-property", name: "Fictional property", address: "Fictional street" };
  const row = { row: 2, values: { propertyId: property.id, label: "Fictional unit", notes: "Fictional import fixture" }, propertyId: property.id, label: "Fictional unit", property: { ...property, version: 1 }, issues: invalid ? [{ column: "label", message: "A unit with this exact name already exists in this property, including archived units." }] : [] };
  const batch = { id: "fictional-import", status: "preview", version: 1, fileName: "units.csv", createdAt: "2026-10-24T12:00:00Z", committedAt: null as string | null, cancelledAt: null, preview: { rowCount: 1, validCount: invalid ? 0 : 1, errorCount: invalid ? 1 : 0, rows: [row] }, result: null as null | { createdCount: number; items: { row: number; unitId: string; propertyId: string; label: string }[] }, actions: [{ id: "preview-action", action: "preview", detail: { rowCount: 1 }, createdAt: "2026-10-24T12:00:00Z" }] };
  const state = { previews: [] as any[], commits: [] as any[], loseCommit: true, batch };
  await context.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path === "/api/bootstrap") return json({ user: { id: "fictional-owner", email: "owner@test.invalid", emailVerified: true, status: "active", platformRole: null }, membership: { companyId: "fictional-company", role: "owner", status: "active", version: 1, company: { id: "fictional-company", name: "Fictional company", status: "active" } }, permissions: ["property.read", "property.write"], destination: "/company/imports/units", csrfToken: "fixture", impersonation: null });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/company/properties") return json([property]);
    if (path === "/api/company/imports/units/preview") { state.previews.push(request.postDataJSON()); return json(batch); }
    if (path === "/api/company/imports/units") return json({ items: state.previews.length ? [{ ...batch, rowCount: 1, errorCount: invalid ? 1 : 0, createdCount: batch.result?.createdCount ?? null }] : [], total: state.previews.length ? 1 : 0, nextCursor: null });
    if (path === "/api/company/imports/units/fictional-import/commit") {
      state.commits.push(request.postDataJSON());
      batch.status = "committed"; batch.version = 2; batch.committedAt = "2026-10-24T12:05:00Z";
      batch.result = { createdCount: 1, items: [{ row: 2, unitId: "created-unit", propertyId: property.id, label: "Fictional unit" }] };
      if (state.loseCommit) { state.loseCommit = false; return route.abort("failed"); }
      return json(batch);
    }
    if (path === "/api/company/imports/units/fictional-import") return json(batch);
    return json([]);
  });
  return state;
}

test("unit CSV preview and interrupted commit retain the exact retry and show created inventory sources", async ({ page, context }) => {
  const state = await fixture(context);
  await page.goto("/company/imports/units");
  await page.getByRole("button", { name: "New import preview", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create unit import preview", exact: true });
  await dialog.getByLabel("CSV contents", { exact: true }).fill("propertyId,label,notes\nfictional-property,Fictional unit,Fictional import fixture");
  await dialog.getByRole("button", { name: "Create preview", exact: true }).click();
  await expect(page).toHaveURL(/importId=fictional-import/);
  await expect(page.getByText("1 valid rows", { exact: true })).toBeVisible();
  expect(state.previews).toHaveLength(1);
  await page.getByRole("button", { name: "Import 1 units", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Confirm unit import", exact: true });
  await confirmation.getByRole("button", { name: "Confirm import", exact: true }).click();
  await expect(confirmation.getByText("This request may already be saved.", { exact: false })).toBeVisible();
  await confirmation.getByRole("button", { name: "Confirm import", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Created 1 active units" })).toBeVisible();
  expect(state.commits).toHaveLength(2);
  expect(state.commits[0]).toEqual(state.commits[1]);
  expect(state.commits[0].expectedVersion).toBe(1);
  await expect(page.getByRole("link", { name: "Fictional property", exact: true })).toHaveAttribute("href", /fictional-property\/units\?q=Fictional%20unit/);
});

test("invalid saved preview remains reviewable and cannot create partial inventory", async ({ page, context }) => {
  const state = await fixture(context, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/imports/units?importId=fictional-import");
  await expect(page.getByRole("button", { name: "Import 1 units", exact: true })).toBeDisabled();
  await expect(page.getByText("label: A unit with this exact name already exists", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Create a fresh preview", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Create unit import preview", exact: true })).toBeVisible();
  expect(state.commits).toEqual([]);
});
