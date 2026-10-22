import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const lease = { id: "lease-a", propertyId: "home", startsOn: "2026-01-01", endsOn: "2026-12-31", property: { name: "Maple House" }, unit: { label: "Apartment 2" } };
  const state = {
    status: 200,
    accounts: [{ lease, summary: { overdueCents: "20501", dueTodayCents: "10025", upcomingCents: "30000", creditCents: "2515" } }],
    leases: [lease],
    requests: [] as string[],
  };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    state.requests.push(path);
    const json = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (path === "/api/bootstrap") return json({
      user: { id: "resident", name: "Jordan Rivera", email: "resident@test.invalid", status: "active", emailVerified: true },
      membership: { companyId: "company", role: "resident", status: "active", version: 1, company: { name: "Fictional Preview Company", status: "active" } },
      permissions: ["resident.self"], csrfToken: "fixture", destination: "/resident",
    });
    if (path === "/api/resident/properties") return json([{ id: "home", name: "Maple House", address: "14 Maple Lane" }]);
    if (path === "/api/resident/leases") return json(state.leases);
    if (path === "/api/resident/rent") return state.status === 200
      ? json({ businessDate: "2026-10-21", accounts: state.accounts })
      : json({ error: "Your rent records are temporarily unavailable." }, state.status);
    return json([]);
  });
  return state;
}

test("resident home shows exact shared lease amounts and opens their original financial records", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/resident");
  const summary = page.getByRole("region", { name: "Rental balance overview", exact: true });
  await expect(summary.getByRole("heading", { name: "Your rental balances", exact: true })).toBeVisible();
  await expect(summary).toContainText("October 21, 2026");
  const account = summary.getByRole("article", { name: "Maple House · Apartment 2", exact: true });
  await expect(account.locator("dl > div").filter({ has: page.locator("dt", { hasText: "Due now" }) })).toContainText("$305.26");
  await expect(account.locator("dl > div").filter({ has: page.locator("dt", { hasText: "Upcoming charges" }) })).toContainText("$300.00");
  await expect(account.locator("dl > div").filter({ has: page.locator("dt", { hasText: "Unapplied payment credit" }) })).toContainText("$25.15");
  await expect(summary).toContainText("shared lease balances");
  await expect(account.getByRole("link", { name: "Rent & payments for Apartment 2 →", exact: true })).toHaveAttribute("href", "/resident/rent?leaseId=lease-a");
  await expect(account.getByRole("link", { name: "Statement for Apartment 2 →", exact: true })).toHaveAttribute("href", "/resident/leases/lease-a/statement");
  const records = page.getByRole("navigation", { name: "Lease records for Apartment 2", exact: true });
  await expect(records.getByRole("link", { name: "Security deposit", exact: true })).toHaveAttribute("href", "/resident/deposits?leaseId=lease-a");
  await expect(records.getByRole("link", { name: "Statement", exact: true })).toHaveAttribute("href", "/resident/leases/lease-a/statement");
  // Focus/visibility refresh can request the same authorized source again.
  expect(state.requests.filter(path => path === "/api/resident/rent").length).toBeGreaterThan(0);
  expect(state.requests.some(path => path.startsWith("/api/company/"))).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("occupants see useful home services without financial totals or lease finance links", async ({ page }) => {
  const state = await fixture(page);
  state.accounts = [];
  state.leases = [];
  await page.goto("/resident");
  const summary = page.getByRole("region", { name: "Rental balance overview", exact: true });
  await expect(summary.getByRole("heading", { name: "Lease financial access", exact: true })).toBeVisible();
  await expect(summary).toContainText("approved leaseholders");
  await expect(summary.locator("dl")).toHaveCount(0);
  await expect(summary.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Resident services", exact: true }).getByRole("link", { name: "Maintenance requests", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: /Lease records for/ })).toHaveCount(0);
});

test("rent summary failures hide amounts while other resident services remain usable and retry recovers", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/resident");
  const summary = page.getByRole("region", { name: "Rental balance overview", exact: true });
  await expect(summary).toContainText("$305.26");
  state.status = 503;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(summary.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(summary.locator("dl")).toHaveCount(0);
  await expect(summary).not.toContainText("$0.00");
  const services = page.getByRole("navigation", { name: "Resident services", exact: true });
  await expect(services.getByRole("link", { name: "Maintenance requests", exact: true })).toHaveAttribute("href", "/resident/maintenance");
  await expect(services.getByRole("link", { name: "My profile", exact: true })).toBeVisible();
  state.status = 200;
  await summary.getByRole("button", { name: "Retry rent summary", exact: true }).click();
  await expect(summary).toContainText("$305.26");
  await expect(summary.getByRole("alert")).toHaveCount(0);
});
