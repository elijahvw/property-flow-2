import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const today = "2026-10-24";
  const property = { id: "fictional-home", name: "Fictional home" };
  const entries: any[] = [
    { unit: { id: "unit-z", label: "Occupied apartment" }, state: "occupied", currentLease: { id: "fictional-current-lease", startsOn: "2026-01-01", endsOn: "2026-12-31", status: "active" } },
    { unit: { id: "unit-y", label: "Unconfirmed apartment" }, state: "unconfirmed" },
    { unit: { id: "unit-x", label: "Ready apartment" }, state: "ready", availability: { version: 1, condition: "ready", availableOn: today, reason: "Fictional completed walkthrough", updatedAt: "2026-10-24T12:00:00Z" } },
    { unit: { id: "unit-w", label: "Future apartment" }, state: "future_occupancy", nextLease: { id: "fictional-future-lease", startsOn: "2026-11-01", endsOn: null, status: "active" } },
  ].map(row => ({ availability: null, readinessStale: false, currentLease: null, nextLease: null, latestLeaseEnd: null, ...row, unit: { ...row.unit, propertyId: property.id, status: "active", version: 1, marketRentCents: null, property } }));
  const writes: any[] = [], reads: URL[] = [], saved = new Map<string, unknown>(), history: any[] = [];
  let lose = false, conflict = false;
  await page.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status });
    if (path === "/api/bootstrap") return json({ user: { id: "fictional-manager", name: "Fictional manager", email: "manager@test.invalid", emailVerified: true, status: "active", platformRole: null }, membership: { companyId: "fictional-company", role: "manager", version: 1, status: "active", company: { id: "fictional-company", name: "Fictional company", status: "active" } }, permissions: ["property.read", "property.write", "lease.manage", "maintenance.manage"], csrfToken: "fixture", destination: "/company/availability" });
    if (path === "/api/account/guide") return json({ eligible: false });
    if (path === "/api/company/properties") return json([property]);
    if (path === "/api/company/availability") {
      reads.push(url);
      const found = entries.filter(entry => (!url.searchParams.get("propertyId") || entry.unit.propertyId === url.searchParams.get("propertyId")) && (!url.searchParams.get("q") || `${entry.unit.label} ${entry.unit.property.name}`.toLowerCase().includes(url.searchParams.get("q")!.toLowerCase())));
      const counts = Object.fromEntries(["occupied", "future_occupancy", "ready", "turnover", "unavailable", "unconfirmed", "archived"].map(state => [state, found.filter(entry => entry.state === state).length]));
      const filtered = found.filter(entry => !url.searchParams.get("status") || entry.state === url.searchParams.get("status"));
      const rows = filtered.filter(entry => !url.searchParams.get("cursor") || entry.unit.id < url.searchParams.get("cursor")!);
      return json({ planningDate: url.searchParams.get("asOf") || today, today, timezone: "America/New_York", definition: "Lease projections use current records; operational conditions reflect the latest review.", total: filtered.length, counts, items: rows.slice(0, 2), nextCursor: rows.length > 2 ? rows[1].unit.id : null });
    }
    if (path.endsWith("/availability/history")) return json({ items: history, nextCursor: null });
    if (req.method() === "PUT" && path.endsWith("/availability")) {
      const body = req.postDataJSON();
      expect(req.headers()["x-csrf-token"]).toBe("fixture");
      writes.push(body);
      if (saved.has(body.submissionKey)) return json(saved.get(body.submissionKey));
      const entry = entries.find(row => row.unit.id === path.split("/").at(-2));
      if (conflict) {
        entry.availability = { version: 1, condition: "turnover", availableOn: null, reason: "Fictional separate manager review", updatedAt: "2026-10-24T12:30:00Z" };
        entry.state = "turnover";
        return json({ code: "RECORD_CHANGED", error: "This readiness record changed. Discard this review and reopen it." }, 409);
      }
      entry.availability = { version: (entry.availability?.version || 0) + 1, condition: body.condition, availableOn: body.availableOn, reason: body.reason, updatedAt: "2026-10-24T13:00:00Z" };
      entry.state = body.condition;
      history.unshift({ id: `review-${history.length + 1}`, version: entry.availability.version, snapshot: entry.availability, reason: body.reason, createdAt: entry.availability.updatedAt });
      const response = { availability: entry.availability };
      saved.set(body.submissionKey, response);
      if (lose) { lose = false; return route.abort("failed"); }
      return json(response);
    }
    return json([]);
  });
  return { reads, writes, entries, history, lose: () => { lose = true; }, conflict: (value: boolean) => { conflict = value; } };
}

test("availability distinguishes unconfirmed readiness from recorded occupancy and preserves filtered source context", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/availability");
  await expect(page.getByRole("heading", { name: "Availability & turnover", exact: true })).toBeVisible();
  await expect(page.getByText("4 matching units", { exact: true })).toBeVisible();
  const occupied = page.getByRole("row").filter({ hasText: "Occupied apartment" });
  await expect(occupied.getByText("Recorded occupied", { exact: true })).toBeVisible();
  await expect(occupied.getByText("Occupied", { exact: true })).toBeVisible();
  await expect(occupied.getByRole("link", { name: "Current recorded lease", exact: true })).toHaveAttribute("href", "/company/leases/fictional-current-lease");
  const unconfirmed = page.getByRole("row").filter({ hasText: "Unconfirmed apartment" });
  await expect(unconfirmed).toContainText("physical readiness is unconfirmed");
  await expect(unconfirmed.getByText("Not occupied", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next units", exact: true }).click();
  const ready = page.getByRole("row").filter({ hasText: "Ready apartment" });
  await expect(ready).toContainText("Vacant & ready");
  await expect(ready.getByText("Not occupied", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Future apartment" }).getByText("Not occupied", { exact: true })).toBeVisible();
  await expect(ready.getByRole("link", { name: "Unit lease history", exact: true })).toHaveAttribute("href", "/company/properties/fictional-home/leases?unitId=unit-x");
  await expect(page.getByRole("link", { name: "Upcoming recorded lease", exact: true })).toHaveAttribute("href", "/company/leases/fictional-future-lease");
  await page.getByRole("combobox", { name: "Availability state", exact: true }).selectOption("ready");
  await page.getByLabel("Planning date", { exact: true }).fill("2026-11-15");
  await page.getByRole("button", { name: "Apply availability filters", exact: true }).click();
  await expect(page).toHaveURL(/status=ready/);
  await expect(page.getByText("1 matching unit", { exact: true })).toBeVisible();
  expect(state.reads.at(-1)?.searchParams.get("cursor")).toBe(null);
  expect(state.reads.at(-1)?.searchParams.get("asOf")).toBe("2026-11-15");
  await expect(page.getByText("Planning date November 15, 2026", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("readiness reviews retry a committed response loss with the same source version and key", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/availability");
  await page.getByRole("button", { name: "Review Unconfirmed apartment readiness", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review unit readiness", exact: true });
  await dialog.getByLabel("Readiness confirmed on", { exact: true }).fill("2026-10-24");
  await dialog.getByLabel("Reason for this readiness review", { exact: true }).fill("Fictional walkthrough confirms the unit is ready.");
  state.lose();
  await dialog.getByRole("button", { name: "Save readiness review", exact: true }).click();
  await expect(dialog.getByText("This request may already be saved.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Save readiness review", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(state.writes[0]).toEqual(state.writes[1]);
  expect(state.writes[0].expectedVersion).toBe(null);
  expect(state.history).toHaveLength(1);
  await page.getByRole("button", { name: "Readiness history for Unconfirmed apartment", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Readiness history · Unconfirmed apartment", exact: true });
  await expect(history).toContainText("Revision 1 · Vacant & ready");
  await expect(history).toContainText("Fictional walkthrough confirms the unit is ready.");
});

test("changed readiness retains the failed draft until explicit discard reloads the source", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/availability");
  await page.getByRole("button", { name: "Review Unconfirmed apartment readiness", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review unit readiness", exact: true });
  await dialog.getByLabel("Reason for this readiness review", { exact: true }).fill("Fictional stale readiness review");
  state.conflict(true);
  await dialog.getByRole("button", { name: "Save readiness review", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("readiness record changed");
  await expect(dialog.getByLabel("Reason for this readiness review", { exact: true })).toHaveValue("Fictional stale readiness review");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.getByRole("button", { name: "Close without saving", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Unconfirmed apartment" })).toContainText("Fictional separate manager review");
  state.conflict(false);
  await page.getByRole("button", { name: "Review Unconfirmed apartment readiness", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Condition", exact: true }).selectOption("unconfirmed");
  await expect(dialog.getByLabel("Estimated available from (optional)", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("Reason for this readiness review", { exact: true }).fill("Clear the fictional readiness confirmation");
  await dialog.getByRole("button", { name: "Save readiness review", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.writes.at(-1).expectedVersion).toBe(1);
  expect(state.writes.at(-1).availableOn).toBe(null);
  expect(state.writes.at(-1).submissionKey).not.toBe(state.writes[0].submissionKey);
});
