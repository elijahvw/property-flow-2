import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, options: { role?: "owner" | "manager"; listedUnit?: string } = {}) {
  const rows = [
    { unitId: "suite-a", unitLabel: "Suite A", propertyId: "maple", propertyName: "Maple House", unitStatus: "active", operationalStatus: "unreviewed", availableOn: null, notes: null, forRent: false, listedAt: null as string | null, version: 0, occupancy: "occupied", currentLease: { id: "lease-current", startsOn: "2026-01-01", endsOn: "2026-12-31" }, nextLease: null },
    { unitId: "suite-b", unitLabel: "Suite B", propertyId: "maple", propertyName: "Maple House", unitStatus: "active", operationalStatus: "turnover", availableOn: "2027-01-15", notes: "Cleaning scheduled", forRent: false, listedAt: null as string | null, version: 1, occupancy: "future", currentLease: null, nextLease: { id: "lease-next", startsOn: "2027-02-01", endsOn: null } },
    { unitId: "suite-c", unitLabel: "Suite C", propertyId: "maple", propertyName: "Maple House", unitStatus: "active", operationalStatus: "available", availableOn: null, notes: "Ready for the next move-in", forRent: false, listedAt: null as string | null, version: 2, occupancy: "vacant", currentLease: null, nextLease: null },
  ];
  for (const row of rows) if (row.unitId === options.listedUnit) Object.assign(row, { forRent: true, listedAt: "2026-10-20T12:00:00.000Z" });
  const state = { rows, role: options.role || "owner", loseResponse: false, keys: [] as string[], writes: [] as any[], listingWrites: [] as any[], committed: new Map<string, unknown>() };
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({
      user: { id: "owner", name: "Fixture Owner", email: "owner@test.invalid", emailVerified: true, status: "active" },
      membership: { companyId: "a", version: 1, role: state.role, status: "active", company: { name: "Fixture Company", status: "active" } },
      permissions: ["property.read", "lease.manage"], destination: "/company/vacancies", csrfToken: "fixture",
    });
    if (path === "/api/company/properties") return json([{ id: "maple", name: "Maple House" }]);
    if (path === "/api/company/vacancies") {
      const scope = rows.filter(row => (!url.searchParams.get("propertyId") || row.propertyId === url.searchParams.get("propertyId")) && (!url.searchParams.get("unitId") || row.unitId === url.searchParams.get("unitId")) && (!url.searchParams.get("q") || `${row.propertyName} ${row.unitLabel}`.toLowerCase().includes(url.searchParams.get("q")!.toLowerCase())));
      const summary = { ...Object.fromEntries(["vacant", "occupied", "future", "unreviewed", "available", "turnover", "unavailable"].map(status => [status, scope.filter(row => row.occupancy === status || row.operationalStatus === status).length])), forRent: scope.filter(row => row.forRent).length, notListed: scope.filter(row => !row.forRent).length };
      const matches = scope.filter(row => (!url.searchParams.get("operational") || url.searchParams.get("operational") === "all" || row.operationalStatus === url.searchParams.get("operational")) && (!url.searchParams.get("occupancy") || url.searchParams.get("occupancy") === "all" || row.occupancy === url.searchParams.get("occupancy")) && (!url.searchParams.get("listing") || url.searchParams.get("listing") === "all" || row.forRent === (url.searchParams.get("listing") === "for_rent")));
      const current = Number(url.searchParams.get("page") || 1);
      return json({ items: matches.slice(current - 1, current), total: matches.length, page: current, pageSize: 1, businessDate: "2026-10-22", summary });
    }
    if (/^\/api\/company\/units\/[^/]+\/(availability|rental-listing)$/.test(path)) {
      const body = request.postDataJSON();
      const listing = path.endsWith("/rental-listing");
      if (listing && state.role !== "owner") return json({ error: "Only a current company owner can change rental listings." }, 403);
      state.keys.push(body.submissionKey);
      const row = rows.find(item => path.includes(`/${item.unitId}/`))!;
      if (!state.committed.has(body.submissionKey)) {
        if (row.version !== body.expectedVersion) return json({ error: "This unit changed. Close without saving and reopen to review the latest details." }, 409);
        if (listing) {
          Object.assign(row, { forRent: body.forRent, listedAt: body.forRent ? "2026-10-22T12:00:00.000Z" : null, version: row.version + 1 });
          state.listingWrites.push(body);
        } else {
          Object.assign(row, { operationalStatus: body.status, availableOn: body.availableOn, notes: body.notes, version: row.version + 1 });
          state.writes.push(body);
        }
        state.committed.set(body.submissionKey, {});
      }
      if (state.loseResponse) { state.loseResponse = false; return route.abort("failed"); }
      return json(row);
    }
    return json([]);
  });
  return state;
}

test("availability keeps lease coverage separate from readiness and reports complete counts across filtered pages", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/vacancies");
  const summary = page.getByRole("region", { name: "Availability summary" });
  await expect(summary.getByText("Vacant", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Unit availability results" }).getByRole("status")).toContainText("3 matching units");
  const card = page.locator(".availability-card");
  await expect(card).toContainText("Current lease");
  await expect(card).toContainText("Not reviewed");
  await expect(card).toContainText("No readiness review recorded");
  await expect(card.getByRole("link", { name: "Current lease", exact: true })).toHaveAttribute("href", "/company/leases/lease-current");
  await page.getByRole("combobox", { name: "Unit readiness", exact: true }).selectOption("turnover");
  await expect(page).toHaveURL(/operational=turnover/);
  await expect(card).toContainText("Suite B");
  await expect(card).toContainText("Upcoming lease");
  await expect(card).toContainText("January 15, 2027");
  await expect(summary.locator("dd")).toHaveText(["1", "1", "1", "0", "3", "1", "1", "1", "0"]);
  await expect(card.getByRole("link", { name: "Record inquiry", exact: true })).toHaveAttribute("href", /prospects\/new\?propertyId=maple&unitId=suite-b/);
  await page.getByRole("button", { name: "Filter by unit", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Choose a unit", exact: true });
  await picker.getByRole("searchbox", { name: "Find a unit", exact: true }).fill("Suite B");
  await picker.getByRole("button", { name: /Suite B/ }).click();
  await expect(page).toHaveURL(/unitId=suite-b/);
  await expect(page.getByText("Unit filter:", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/propertyflow-availability-mobile.png", fullPage: true });
});

test("an interrupted availability update retains its original version and retry identity after closing and reopening", async ({ page }) => {
  const state = await fixture(page);
  state.loseResponse = true;
  await page.goto("/company/vacancies");
  await page.getByRole("button", { name: /Update readiness for Maple House · Suite A/ }).click();
  const editor = page.getByRole("dialog", { name: "Update readiness · Suite A", exact: true });
  await editor.getByRole("combobox", { name: "Unit readiness", exact: true }).selectOption("turnover");
  await editor.getByRole("textbox", { name: "Management note (optional)", exact: true }).fill("Cleaning scheduled before the next move-in");
  await editor.getByRole("button", { name: "Save readiness", exact: true }).click();
  await expect(editor.getByText("This request may already be saved. Retry with the original details before starting another record.", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await editor.getByRole("button", { name: "Close & keep recovery", exact: true }).click();
  await page.getByRole("button", { name: /Update readiness for Maple House · Suite A/ }).click();
  await editor.getByRole("button", { name: "Save readiness", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.locator(".availability-card")).toContainText("Cleaning scheduled before the next move-in");
  expect(state.keys).toHaveLength(2);
  expect(state.keys[0]).toBe(state.keys[1]);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].expectedVersion).toBe(0);
});

test("a vacant ready unit remains unlisted until an owner explicitly lists it", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/vacancies?unitId=suite-c");
  const card = page.locator(".availability-card");
  await expect(card.locator(".occupancy-vacant")).toHaveText("Vacant");
  await expect(card.locator(".readiness-available")).toHaveText("Ready");
  await expect(card.locator(".listing-not-listed")).toHaveText("Not listed for rent");
  await expect(card.getByRole("button", { name: /List for rent for Maple House · Suite C/ })).toBeVisible();
  await page.getByRole("combobox", { name: "Rental listing", exact: true }).selectOption("for_rent");
  await expect(page).toHaveURL(/listing=for_rent/);
  await expect(page.getByRole("heading", { name: "No units match this view", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Availability summary" }).locator("dd")).toHaveText(["1", "0", "0", "0", "1", "0", "1", "0", "0"]);
  expect(state.listingWrites).toHaveLength(0);
  expect(state.rows[2].forRent).toBe(false);
});

test("an owner reviews listing an occupied unit and can remove it without changing lease coverage or readiness", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/vacancies");
  const card = page.locator(".availability-card");
  await card.getByRole("button", { name: /List for rent for Maple House · Suite A/ }).click();
  const editor = page.getByRole("dialog", { name: "List for rent · Suite A", exact: true });
  await expect(editor).toContainText("This does not publish a public advertisement.");
  await expect(editor).toContainText("Listing it for an upcoming vacancy does not end or change that lease.");
  await expect(editor.getByRole("link", { name: "Current lease", exact: true })).toHaveAttribute("href", "/company/leases/lease-current");
  await editor.getByRole("button", { name: "List for rent", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(card.locator(".listing-listed")).toHaveText("For rent");
  await expect(card).toContainText("No readiness review recorded");
  await expect(card.locator(".occupancy-occupied")).toHaveText("Occupied");
  await page.getByRole("combobox", { name: "Rental listing", exact: true }).selectOption("for_rent");
  await expect(page.getByRole("region", { name: "Unit availability results" }).getByRole("status")).toContainText("1 matching unit");
  await expect(page.getByRole("region", { name: "Availability summary" }).locator("dd")).toHaveText(["1", "1", "1", "1", "2", "1", "1", "1", "0"]);
  await card.getByRole("button", { name: /Remove from rental listings for Maple House · Suite A/ }).click();
  const remove = page.getByRole("dialog", { name: "Remove from rental listings · Suite A", exact: true });
  await remove.getByRole("button", { name: "Remove from rental listings", exact: true }).click();
  await expect(remove).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "No units match this view", exact: true })).toBeVisible();
  expect(state.listingWrites.map(write => [write.forRent, write.expectedVersion])).toEqual([[true, 0], [false, 1]]);
  expect(state.rows[0].currentLease?.id).toBe("lease-current");
  expect(state.rows[0].operationalStatus).toBe("unreviewed");
  expect(state.writes).toHaveLength(0);
});

test("an owner can explicitly list a unit with an upcoming lease after reviewing its source", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/vacancies?unitId=suite-b");
  await page.getByRole("button", { name: /List for rent for Maple House · Suite B/ }).click();
  const editor = page.getByRole("dialog", { name: "List for rent · Suite B", exact: true });
  await expect(editor).toContainText("This unit has an upcoming lease. Its dates remain in place.");
  await expect(editor.getByRole("link", { name: "Next lease", exact: true })).toHaveAttribute("href", "/company/leases/lease-next");
  await editor.getByRole("button", { name: "List for rent", exact: true }).click();
  await expect(page.locator(".availability-card .listing-listed")).toHaveText("For rent");
  expect(state.rows[1].nextLease?.id).toBe("lease-next");
  expect(state.rows[1].operationalStatus).toBe("turnover");
});

test("a manager sees rental listing status and filters while readiness changes preserve the owner's listing", async ({ page }) => {
  const state = await fixture(page, { role: "manager", listedUnit: "suite-c" });
  await page.goto("/company/vacancies?unitId=suite-c");
  const card = page.locator(".availability-card");
  await expect(card.locator(".listing-listed")).toHaveText("For rent");
  await expect(page.getByRole("button", { name: /^(List for rent|Remove from rental listings)/ })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Rental listing", exact: true }).selectOption("for_rent");
  await card.getByRole("button", { name: /Update readiness for Maple House · Suite C/ }).click();
  const editor = page.getByRole("dialog", { name: "Update readiness · Suite C", exact: true });
  await editor.getByRole("combobox", { name: "Unit readiness", exact: true }).selectOption("turnover");
  await editor.getByRole("button", { name: "Save readiness", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(card.locator(".listing-listed")).toHaveText("For rent");
  await expect(card.locator(".readiness-turnover")).toBeVisible();
  expect(state.listingWrites).toHaveLength(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).not.toHaveProperty("forRent");
  expect(state.rows[2].forRent).toBe(true);
});

test("a lost listing response retains the original request before a separate readiness update uses the new shared version", async ({ page }) => {
  const state = await fixture(page);
  state.loseResponse = true;
  await page.goto("/company/vacancies");
  await page.getByRole("button", { name: /List for rent for Maple House · Suite A/ }).click();
  const editor = page.getByRole("dialog", { name: "List for rent · Suite A", exact: true });
  await editor.getByRole("button", { name: "List for rent", exact: true }).click();
  await expect(editor.getByText("This request may already be saved. Retry with the original details before starting another record.", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await editor.getByRole("button", { name: "Close & keep recovery", exact: true }).click();
  await page.getByRole("button", { name: /Update readiness for Maple House · Suite A/ }).click();
  await expect(editor).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Update readiness · Suite A", exact: true })).toHaveCount(0);
  await editor.getByRole("button", { name: "List for rent", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.locator(".availability-card .listing-listed")).toHaveText("For rent");
  expect(state.keys).toHaveLength(2);
  expect(state.keys[0]).toBe(state.keys[1]);
  expect(state.listingWrites).toHaveLength(1);
  expect(state.listingWrites[0]).toEqual({ forRent: true, expectedVersion: 0, submissionKey: state.keys[0] });
  await page.getByRole("button", { name: /Update readiness for Maple House · Suite A/ }).click();
  const readiness = page.getByRole("dialog", { name: "Update readiness · Suite A", exact: true });
  await readiness.getByRole("combobox", { name: "Unit readiness", exact: true }).selectOption("available");
  await readiness.getByRole("button", { name: "Save readiness", exact: true }).click();
  await expect(readiness).not.toBeVisible();
  await expect(page.locator(".availability-card .listing-listed")).toHaveText("For rent");
  expect(state.writes[0].expectedVersion).toBe(1);
  expect(state.rows[0].forRent).toBe(true);
});

test("listing recovery reports the current state when another owner has since removed the listing", async ({ page }) => {
  const state = await fixture(page);
  state.loseResponse = true;
  await page.goto("/company/vacancies");
  await page.getByRole("button", { name: /List for rent for Maple House · Suite A/ }).click();
  const editor = page.getByRole("dialog", { name: "List for rent · Suite A", exact: true });
  await editor.getByRole("button", { name: "List for rent", exact: true }).click();
  await expect(editor.getByText("This request may already be saved. Retry with the original details before starting another record.", { exact: true })).toBeVisible();
  Object.assign(state.rows[0], { forRent: false, listedAt: null, version: 2 });
  await editor.getByRole("button", { name: "List for rent", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByText("Maple House · Suite A is currently not listed for rent. Your request was recovered, and a later saved update changed the listing. Review the current status before making another change.", { exact: true })).toBeVisible();
  await expect(page.locator(".availability-card .listing-not-listed")).toHaveText("Not listed for rent");
  expect(state.keys[0]).toBe(state.keys[1]);
  expect(state.listingWrites).toHaveLength(1);
  expect(state.rows[0].version).toBe(2);
  expect(state.rows[0].forRent).toBe(false);
});

test("a stale listing review requires closing and reviewing the refreshed unit instead of overwriting readiness", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/vacancies");
  await page.getByRole("button", { name: /List for rent for Maple House · Suite A/ }).click();
  const editor = page.getByRole("dialog", { name: "List for rent · Suite A", exact: true });
  Object.assign(state.rows[0], { operationalStatus: "turnover", notes: "Another manager scheduled cleaning", version: 1 });
  await editor.getByRole("button", { name: "List for rent", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("This unit changed.");
  await expect(editor.locator(".availability-listing-review")).toContainText("Not reviewed");
  expect(state.listingWrites).toHaveLength(0);
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await editor.getByRole("button", { name: "Close without saving", exact: true }).click();
  await expect(page.locator(".availability-card")).toContainText("Another manager scheduled cleaning");
  await page.getByRole("button", { name: /List for rent for Maple House · Suite A/ }).click();
  await expect(editor.locator(".availability-listing-review")).toContainText("Turnover in progress");
  await editor.getByRole("button", { name: "List for rent", exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(state.listingWrites[0].expectedVersion).toBe(1);
  expect(state.rows[0].operationalStatus).toBe("turnover");
  expect(state.rows[0].forRent).toBe(true);
});
