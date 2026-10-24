import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function fixture(page: Page) {
  const state = { fail: false, queries: [] as URLSearchParams[] };
  const company = { id: "fictional-company", name: "Fictional company", status: "active" };
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({ user: { id: "fictional-manager", name: "Fictional manager", email: "manager@test.invalid", emailVerified: true, status: "active", platformRole: null }, membership: { companyId: company.id, version: 1, role: "manager", status: "active", company }, permissions: ["property.read", "finance.manage"], csrfToken: "fixture", destination: "/company/reports", impersonation: null });
    if (path === "/api/company/reports/context") return json({ name: company.name, timezone: "America/New_York", today: "2026-10-24" });
    if (path === "/api/company/properties") return json([{ id: "fictional-home", name: "Current fictional home" }]);
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/company/reports/historical-cash") {
      state.queries.push(url.searchParams);
      if (state.fail) return json({ error: "Historical sources temporarily unavailable." }, 503);
      const summary = { incomeCents: "15001", expenseCents: "3000", rentRefundCents: "0", depositReceivedCents: "0", depositRefundCents: "0", netCents: "12001", cashMovementCents: "12001", includedCount: 51, voidedCount: 0 };
      const period = {
        dateFrom: url.searchParams.get("dateFrom"), dateTo: url.searchParams.get("dateTo"), summary, groups: [],
        items: Array.from({ length: 51 }, (_, index) => ({ id: `source-${index + 1}`, reference: `TX-${index + 1}`, propertyId: "fictional-home", property: { name: "Current fictional home" }, occurredOn: "2026-01-05", recordedAt: "2026-01-05T12:00:00Z", kind: index === 50 ? "expense" : "income", category: index === 50 ? "repairs" : "other", currency: "USD", amountCents: index === 50 ? "3000" : index === 0 ? "10101" : "100", memo: index === 0 ? "=Unsafe spreadsheet expression" : null, included: true, voidedAt: null, voidReason: null, movement: null, depositReceipt: null })),
      };
      const comparison = url.searchParams.has("compareFrom") ? { ...period, dateFrom: url.searchParams.get("compareFrom"), dateTo: url.searchParams.get("compareTo"), items: [{ ...period.items[0], id: "comparison-source", reference: "TX-900", occurredOn: "2025-12-20", recordedAt: "2025-12-20T12:00:00Z", amountCents: "5000" }], summary: { ...summary, incomeCents: "5000", expenseCents: "0", netCents: "5000", cashMovementCents: "5000", includedCount: 1 } } : null;
      return json({ kind: "historical_cash", generatedAt: "2026-10-24T12:00:00Z", knowledgeCutoffExclusive: "2026-02-01T05:00:00Z", company: { name: company.name, timezone: "America/New_York" }, currency: "USD", basis: "Creation and correction timestamps determine the recorded state. Current labels do not reconstruct historical lease balances.", filters: { propertyId: url.searchParams.get("propertyId"), propertyName: "Current fictional home", dateFrom: period.dateFrom, dateTo: period.dateTo, asOf: url.searchParams.get("asOf"), compareFrom: comparison?.dateFrom || null, compareTo: comparison?.dateTo || null }, primary: period, comparison, delta: comparison ? { incomeCents: "10001", expenseCents: "3000", rentRefundCents: "0", depositReceivedCents: "0", depositRefundCents: "0", netCents: "7001", cashMovementCents: "7001" } : null });
    }
    return json([]);
  });
  return state;
}

test("historical cash captures period comparisons and exports every source from the generated snapshot", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/reports");
  await page.getByText("Historical cash and period comparisons", { exact: true }).click();
  await page.getByLabel("Historical report property", { exact: true }).selectOption("fictional-home");
  await page.getByLabel("Cash business start", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Cash business through", { exact: true }).fill("2026-01-31");
  await page.getByLabel("Recorded by company date", { exact: true }).fill("2026-01-31");
  await page.getByLabel("Compare another business period using the same recording cutoff").check();
  await page.getByLabel("Comparison start", { exact: true }).fill("2025-12-01");
  await page.getByLabel("Comparison through", { exact: true }).fill("2025-12-31");
  await page.getByRole("button", { name: "Generate historical cash report", exact: true }).click();
  const report = page.getByRole("region", { name: "Generated historical cash report", exact: true });
  await expect(report).toContainText("$70.01");
  expect(state.queries[0].get("compareFrom")).toBe("2025-12-01");
  await expect(page).toHaveURL(/historyAsOf=2026-01-31/);
  await expect(report.getByRole("link", { name: "TX-1", exact: true })).toHaveAttribute("href", "/company/properties/fictional-home/finances?entryId=source-1");
  await report.getByRole("button", { name: "Next primary sources", exact: true }).click();
  await expect(report.getByRole("link", { name: "TX-51", exact: true })).toBeVisible();
  await page.getByLabel("Recorded by company date", { exact: true }).fill("2026-02-28");
  const download = page.waitForEvent("download");
  await report.getByRole("button", { name: "Download historical CSV", exact: true }).click();
  const saved = await download, csv = await readFile((await saved.path())!, "utf8");
  expect(saved.suggestedFilename()).toContain("recorded-2026-01-31");
  expect(csv).toContain("TX-1"); expect(csv).toContain("TX-51");
  expect(csv).toContain("'=Unsafe spreadsheet expression");
  expect(csv).toContain("70.01"); expect(csv).toContain("2026-02-01T05:00:00Z");
});

test("historical cash errors preserve dates and copied filter URLs reopen the correct report form on mobile", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/reports?history=cash&historyFrom=2026-01-01&historyTo=2026-01-31&historyAsOf=2026-01-31&historyProperty=fictional-home");
  await expect(page.getByLabel("Recorded by company date", { exact: true })).toHaveValue("2026-01-31");
  state.fail = true;
  await page.getByRole("button", { name: "Generate historical cash report", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Historical sources temporarily unavailable");
  await expect(page.getByLabel("Cash business start", { exact: true })).toHaveValue("2026-01-01");
  await expect(page.getByLabel("Historical report property", { exact: true })).toHaveValue("fictional-home");
  state.fail = false;
  await page.getByRole("button", { name: "Generate historical cash report", exact: true }).click();
  await expect(page.getByRole("region", { name: "Generated historical cash report", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
