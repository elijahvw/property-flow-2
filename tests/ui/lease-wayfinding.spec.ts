import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, finances = true) {
  const lease = {
    id: "lease", propertyId: "home", unitId: "unit", residentId: "resident",
    version: 1, status: "active", startsOn: "2026-01-01", endsOn: "2026-12-31",
    rentCents: 120000, rentDueDay: 1, graceDays: 5,
    property: { name: "Maple House" }, unit: { label: "Apartment 2" },
    resident: { name: "Jordan Rivera", email: "jordan@test.invalid" }, renewals: [],
  };
  const requests: string[] = [];
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path === "/api/bootstrap") return json({
      user: { id: "manager", email: "manager@test.invalid", status: "active", emailVerified: true },
      membership: { companyId: "company", role: "manager", status: "active", version: 1,
        company: { id: "company", name: "Fictional Preview Company", status: "active" } },
      permissions: ["property.read", "lease.manage", ...(finances ? ["finance.manage"] : [])],
      csrfToken: "fixture",
    });
    if (path === "/api/company/leases/lease") return json(lease);
    if (path === "/api/company/properties") return json([{ id: "home", name: "Maple House" }]);
    if (path.endsWith("/participants")) return json({ lease, businessDate: "2026-10-21", items: [], candidates: [] });
    return json([]);
  });
  return requests;
}

test("lease sections explain task groups and retain source context through keyboard navigation and back", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/leases/lease?leaseListQ=Maple&leaseListStatus=active&noticeReturn=inbox&noticeStatus=unread&noticeType=agreements&noticePage=2");
  const navigation = page.getByRole("navigation", { name: "Lease sections", exact: true });
  for (const name of ["Lease details", "People & access", "Documents & condition", "Renewal & move-out"])
    await expect(navigation.getByRole("group", { name, exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
  const invitations = navigation.getByRole("button", { name: "Invitations & approvals", exact: true });
  await invitations.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Invitations & approvals", exact: true })).toBeVisible();
  await expect(invitations).toBeFocused();
  await expect(invitations).toHaveAttribute("aria-current", "page");
  const query = new URL(page.url()).searchParams;
  expect(query.get("leaseListQ")).toBe("Maple");
  expect(query.get("noticeStatus")).toBe("unread");
  expect(query.get("noticePage")).toBe("2");
  await page.goBack();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open rent & payments", exact: true }))
    .toHaveAttribute("href", /leaseId=lease.*leaseReturn=lease/);
  await expect(page.getByRole("link", { name: "← All leases", exact: true }))
    .toHaveAttribute("href", /status=active&q=Maple/);
});

test("mobile lease navigation groups sections without overflowing and respects finance permission", async ({ page }) => {
  const requests = await fixture(page, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/leases/lease?section=settlement");
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  const selector = page.getByRole("combobox", { name: "Lease section", exact: true });
  await expect(selector).toHaveValue("overview");
  expect(await selector.locator("optgroup").evaluateAll(groups => groups.map(group => group.getAttribute("label"))))
    .toEqual(["Lease details", "People & access", "Documents & condition", "Renewal & move-out"]);
  await expect(selector.locator('option[value="settlement"],option[value="proration"]')).toHaveCount(0);
  await selector.selectOption("household");
  await expect(page.getByRole("region", { name: "Leaseholders & occupants", exact: true })).toBeVisible();
  await page.reload();
  await expect(selector).toHaveValue("household");
  await expect(page.getByRole("link", { name: "Open rent & payments", exact: true })).toHaveCount(0);
  expect(requests.some(path => /settlement|proration|\/rent/.test(path))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
