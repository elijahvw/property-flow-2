import { test, expect, type BrowserContext } from "@playwright/test";

const sourceCsv = "sourceId,propertyId,occurredOn,amount,category,memo\nexpense-001,fictional-property,2026-10-15,123.45,repairs,Fictional repair fixture\nexpense-002,fictional-property,2026-10-16,56.78,utilities,Fictional utility fixture";
async function fixture(context: BrowserContext, options: { invalid?: boolean; failPreview?: boolean; readOnly?: boolean } = {}) {
  const property = { id: "fictional-property", name: "Fictional property", address: "Fictional street", version: 1 };
  const rows = [
    { row: 2, values: { sourceId: "expense-001", propertyId: property.id, occurredOn: "2026-10-15", amount: "123.45", category: "repairs", memo: "Fictional repair fixture" }, sourceId: "expense-001", propertyId: property.id, occurredOn: "2026-10-15", amountCents: 12345, category: "repairs", memo: "Fictional repair fixture", property, ...(options.invalid ? { existingSource: { id: "existing-source", ledgerEntryId: "existing-ledger", propertyId: property.id, reference: "TX-900", voidedAt: "2026-10-18T12:00:00Z", samePayload: true } } : {}), issues: options.invalid ? [{ column: "sourceId", message: "This source ID was already imported. Its identity remains reserved even after correction." }] : [] },
    { row: 3, values: { sourceId: "expense-002", propertyId: property.id, occurredOn: "2026-10-16", amount: "56.78", category: "utilities", memo: "Fictional utility fixture" }, sourceId: "expense-002", propertyId: property.id, occurredOn: "2026-10-16", amountCents: 5678, category: "utilities", memo: "Fictional utility fixture", property, issues: [] },
  ];
  const groups = [{ propertyId: property.id, propertyName: property.name, category: "repairs", amountCents: "12345", count: 1 }, { propertyId: property.id, propertyName: property.name, category: "utilities", amountCents: "5678", count: 1 }];
  const batch = { id: "fictional-expense-import", companyId: "fictional-company", sourceNamespace: "fictional-bookkeeper", status: "preview", version: 1, fileName: "paid-expenses.csv", createdAt: "2026-10-24T12:00:00Z", committedAt: null as string | null, cancelledAt: null as string | null, preview: { rowCount: 2, validCount: options.invalid ? 1 : 2, errorCount: options.invalid ? 1 : 0, totalCents: options.invalid ? "5678" : "18023", totalsComplete: !options.invalid, groups: options.invalid ? groups.slice(1) : groups, rows }, result: null as null | { createdCount: number; totalCents: string; items: { row: number; sourceId: string; ledgerEntryId: string; reference: string; propertyId: string; amountCents: number }[] }, actions: [{ id: "preview-event", action: "preview", detail: { rowCount: 2 }, createdAt: "2026-10-24T12:00:00Z" }] };
  const state = { previews: [] as any[], commits: [] as any[], cancels: [] as any[], loseCommit: true, failPreview: !!options.failPreview, batch };
  await context.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({ user: { id: "fictional-manager", name: "Fictional manager", email: "manager@test.invalid", emailVerified: true, status: "active", platformRole: null }, membership: { companyId: batch.companyId, role: "manager", status: "active", version: 1, company: { id: batch.companyId, name: "Fictional company", status: "active" } }, permissions: ["property.read", "finance.manage"], destination: "/company/imports/expenses", csrfToken: "fixture", impersonation: null, ...(options.readOnly ? { companyFeatures: { properties: "enabled", leasing: "enabled", finances: "read_only" } } : {}) });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/company/properties") return json([property]);
    if (path === "/api/company/properties/fictional-property") return json(property);
    if (path === "/api/company/finances") return json({ items: [{ id: "created-ledger-1", reference: "TX-101", propertyId: property.id, property: { name: property.name }, occurredOn: "2026-10-15", amountCents: 12345, kind: "expense", category: "repairs", memo: "Fictional repair fixture", version: 1, voidedAt: null, voidReason: null, importedExpense: { batchId: batch.id, sourceNamespace: batch.sourceNamespace, sourceId: "expense-001", sourceRow: 2 } }], nextCursor: null, summary: { incomeCents: "0", expenseCents: "12345", netCents: "-12345" } });
    if (path === "/api/company/imports/expenses/preview") { state.previews.push(request.postDataJSON()); return state.failPreview ? json({ error: "Choose a stable lowercase source namespace. Your source rows were not posted." }, 400) : json(batch); }
    if (path === "/api/company/imports/expenses") return json({ items: state.previews.length ? [{ ...batch, rowCount: 2, errorCount: batch.preview.errorCount, totalCents: batch.preview.totalCents, createdCount: batch.result?.createdCount || null }] : [], total: state.previews.length ? 1 : 0, nextCursor: null });
    if (path === "/api/company/imports/expenses/fictional-expense-import") return json(batch);
    if (path === "/api/company/imports/expenses/fictional-expense-import/commit") {
      state.commits.push(request.postDataJSON()); batch.status = "committed"; batch.version = 2; batch.committedAt = "2026-10-24T12:05:00Z";
      batch.result = { createdCount: 2, totalCents: "18023", items: rows.map((row, index) => ({ row: row.row, sourceId: row.sourceId, ledgerEntryId: `created-ledger-${index + 1}`, reference: `TX-${index + 101}`, propertyId: property.id, amountCents: row.amountCents })) };
      if (state.loseCommit) { state.loseCommit = false; return route.abort("failed"); }
      return json(batch);
    }
    if (path === "/api/company/imports/expenses/fictional-expense-import/cancel") { state.cancels.push(request.postDataJSON()); batch.status = "cancelled"; batch.version = 2; batch.cancelledAt = "2026-10-24T12:05:00Z"; return json(batch); }
    return json([]);
  });
  return state;
}

test("paid expense preview has grouped source review and retries a committed import with exact confirmations", async ({ page, context }) => {
  const state = await fixture(context);
  await page.goto("/company/imports/expenses");
  await page.getByRole("button", { name: "New expense preview", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Prepare paid expense preview", exact: true });
  await expect(preview.getByRole("group", { name: "1. Source identity", exact: true })).toBeVisible();
  await expect(preview.getByRole("group", { name: "2. Expense source rows", exact: true })).toBeVisible();
  await preview.getByLabel("Source namespace", { exact: true }).fill("fictional-bookkeeper");
  await preview.getByLabel("Expense CSV contents", { exact: true }).fill(sourceCsv);
  await preview.getByRole("button", { name: "Create expense preview", exact: true }).click();
  await expect(page).toHaveURL(/importId=fictional-expense-import/);
  await expect(page.getByText("2 valid rows", { exact: true })).toBeVisible();
  await expect(page.getByText("$180.23 USD", { exact: true })).toBeVisible();
  expect(state.previews[0].sourceNamespace).toBe("fictional-bookkeeper");
  await page.getByRole("button", { name: "Review 2 paid expenses", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Confirm paid expense import", exact: true });
  await expect(review.getByRole("group", { name: "Reviewed import", exact: true })).toContainText("$180.23");
  await review.getByLabel("I confirm these operating expenses were actually paid on the recorded dates.", { exact: true }).check();
  await review.getByLabel("I have checked that these expenses are not already recorded in Property Flow, including outside this import source.", { exact: true }).check();
  await review.getByRole("button", { name: "Import confirmed paid expenses", exact: true }).click();
  await expect(review.getByRole("alert")).toContainText("This request may already be saved");
  await expect(review.getByRole("alert")).toBeFocused();
  await expect(review.getByLabel("I confirm these operating expenses were actually paid on the recorded dates.", { exact: true })).toBeDisabled();
  await review.getByRole("button", { name: "Import confirmed paid expenses", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Imported 2 paid expenses totaling $180.23" })).toBeVisible();
  expect(state.commits).toHaveLength(2); expect(state.commits[0]).toEqual(state.commits[1]);
  expect(state.commits[0]).toMatchObject({ expectedVersion: 1, confirmedPaid: true, confirmedNotRecorded: true });
  await expect(page.getByRole("link", { name: "Open TX-101", exact: true })).toHaveAttribute("href", "/company/properties/fictional-property/finances?entryId=created-ledger-1");
  await page.getByRole("link", { name: "Open TX-101", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cash activity", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Imported expense source", exact: true })).toHaveAttribute("href", "/company/imports/expenses?importId=fictional-expense-import");
  await page.getByRole("link", { name: "Imported expense source", exact: true }).click();
  await expect(page).toHaveURL(/importId=fictional-expense-import/);
  await expect(page.getByRole("status").filter({ hasText: "Imported 2 paid expenses totaling $180.23" })).toBeVisible();
});

test("duplicate and voided expense sources stay reviewable on mobile without a partial import", async ({ page, context }) => {
  const state = await fixture(context, { invalid: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/imports/expenses?importId=fictional-expense-import");
  await expect(page.getByRole("button", { name: "Review 2 paid expenses", exact: true })).toBeDisabled();
  await expect(page.getByText("Validated subtotal", { exact: true })).toBeVisible();
  await expect(page.getByText("Voided source; identity remains reserved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "TX-900", exact: true })).toHaveAttribute("href", "/company/properties/fictional-property/finances?entryId=existing-ledger");
  await page.getByRole("button", { name: "Create a fresh expense preview", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Prepare paid expense preview", exact: true })).toBeVisible();
  expect(state.commits).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("preview validation focuses its error while retaining source details and expense text", async ({ page, context }) => {
  const state = await fixture(context, { failPreview: true });
  await page.goto("/company/imports/expenses");
  await page.getByRole("button", { name: "New expense preview", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Prepare paid expense preview", exact: true });
  await preview.getByLabel("Source namespace", { exact: true }).fill("fictional-bookkeeper");
  await preview.getByLabel("Expense CSV contents", { exact: true }).fill(sourceCsv);
  await preview.getByRole("button", { name: "Create expense preview", exact: true }).click();
  await expect(preview.getByRole("alert")).toContainText("Choose a stable lowercase source namespace");
  await expect(preview.getByRole("alert")).toBeFocused();
  await expect(preview.getByLabel("Source namespace", { exact: true })).toHaveValue("fictional-bookkeeper");
  await expect(preview.getByLabel("Expense CSV contents", { exact: true })).toHaveValue(sourceCsv);
  expect(state.commits).toEqual([]);
  state.failPreview = false;
  await preview.getByRole("button", { name: "Create expense preview", exact: true }).click();
  await expect(page).toHaveURL(/importId=fictional-expense-import/);
});
