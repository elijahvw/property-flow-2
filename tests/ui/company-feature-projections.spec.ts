import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const lease = {
    id: "fictional-lease", propertyId: "fictional-home", unitId: "fictional-unit", residentId: "fictional-resident",
    startsOn: "2026-01-01", endsOn: "2026-12-31", status: "active", version: 1,
    rentCents: 100000, rentDueDay: 1, graceDays: 5, property: { name: "Fictional house" }, unit: { label: "Fictional apartment" },
    resident: { name: "Fictional tenant", email: "fictional@test.invalid" }, renewals: [],
    overview: { householdCount: 1, financeAvailable: false },
  };
  const requests: string[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === "/api/bootstrap") return json({
      user: { id: "fictional-owner", name: "Fictional owner", email: "owner@test.invalid", emailVerified: true, status: "active", platformRole: null },
      membership: { companyId: "fictional-company", role: "owner", status: "active", version: 1, company: { id: "fictional-company", name: "Fictional company", status: "active" } },
      permissions: ["property.read", "resident.assignment.manage", "lease.manage", "finance.manage", "members.manage"],
      csrfToken: "fixture", destination: "/company/overview",
      companyFeatures: { properties: "enabled", leasing: "enabled", finances: "disabled", documents: "disabled", inspections: "disabled", agreements: "disabled", notifications: "disabled", resident_portal: "disabled", reports: "disabled", maintenance: "enabled" },
    });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/company/resident-profiles/fictional-resident") return json({
      userId: "fictional-resident", contactId: null, role: "resident", status: "active", version: 1,
      contactName: "Fictional tenant", user: { id: "fictional-resident", name: "Fictional tenant", email: "fictional@test.invalid", emailVerified: true, status: "active" },
      assignments: [], activity: [],
    });
    if (path === "/api/company/resident-profiles/fictional-resident/workspace") return json({
      businessDate: "2026-10-24", timezone: "America/New_York", generatedAt: "2026-10-24T12:00:00Z",
      financeAvailable: false, rent: null, deposits: null, leases: [{ ...lease, rent: null, deposit: null }],
    });
    if (path === "/api/company/resident-profiles/fictional-resident/rentals") return json({
      companyId: "fictional-company", today: "2026-10-24", timezone: "America/New_York",
      person: { kind: "resident", id: "fictional-resident", contactId: null, userId: "fictional-resident", name: "Fictional tenant", recordStatus: "active", portalState: "active" },
      items: [{ leaseId: lease.id, propertyId: lease.propertyId, propertyName: lease.property.name, unitLabel: lease.unit.label, role: "leaseholder", status: "current", startsOn: lease.startsOn, endsOn: lease.endsOn, blocksArchive: true }],
      total: 1, pageSize: 50, nextCursor: null, previousCursor: null,
    });
    if (path === "/api/company/leases/fictional-lease") return json(lease);
    if (path === "/api/company/properties") return json([{ id: "fictional-home", name: "Fictional house" }]);
    return json([]);
  });
  return requests;
}

test("disabled finance keeps tenant lease history without financial balances or actions", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/residents/fictional-resident");
  await expect(page.getByRole("heading", { name: "Fictional tenant", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Financial access unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lease history", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tenant balance overview" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Fictional apartment", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open rent ledger|View statement|Open deposit details/ })).toHaveCount(0);
  await expect(page.getByText("$0.00", { exact: true })).toHaveCount(0);
});

test("disabled nested lease areas show an explanation without mounting their queries or false finance states", async ({ page }) => {
  const requests = await fixture(page);
  await page.goto("/company/leases/fictional-lease?section=documents");
  await expect(page.getByRole("heading", { name: "Fictional house · Fictional apartment", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "The requested lease area is unavailable" })).toBeVisible();
  for (const name of ["Documents", "Inspections", "Agreements", "Terms & changes", "Partial rent", "Invitations & approvals", "Move-out & settlement"])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Rent & billing", exact: true })).toHaveCount(0);
  await expect(page.getByText("Manual billing", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No deposit recorded", { exact: true })).toHaveCount(0);
  expect(requests.filter(path => /\/documents(?:\/|$)|\/inspections(?:\/|$)|\/agreements(?:\/|$)/.test(path))).toEqual([]);
});
