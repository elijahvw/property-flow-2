import { test, expect, Page } from "@playwright/test";

const rows = () => Array.from({ length: 123 }, (_, index) => ({
  id: `fictional-request-${index + 1}`, propertyId: "fictional-home", unitId: "fictional-unit", title: `Fictional repair ${String(index + 1).padStart(3, "0")}`,
  description: "Fictional isolated maintenance issue.", category: "plumbing", priority: "normal", status: ["open", "in_progress", "resolved"][index % 3], version: 1,
  createdAt: "2026-10-24T12:00:00Z", updatedAt: "2026-10-24T12:00:00Z", targetOn: "2026-10-25", property: { name: "Fictional Garden House" }, unit: { label: "Unit A" },
  executionStatus: "assigned", assigneeName: "Fictional teammate",
}));
async function fixture(page: Page, resident = false) {
  const state = {
    rows: rows(), calls: [] as URL[], companyId: "fictional-company", bootstrapCompanyId: "fictional-company", memberVersion: 1,
    fail: false, denied: false, stale: false, hold: false, release: null as (() => void) | null,
  };
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({
      user: { id: "fictional-member", name: "Fictional member", email: "member@test.invalid", emailVerified: true, status: "active", platformRole: null },
      membership: { companyId: state.bootstrapCompanyId, version: state.memberVersion, role: resident ? "resident" : "manager", status: "active", company: { id: state.bootstrapCompanyId, name: "Fictional Property Company", status: "active" } },
      permissions: resident ? ["resident.self"] : ["property.read", "maintenance.manage"], csrfToken: "fixture", destination: resident ? "/resident/maintenance" : "/company/maintenance",
      companyFeatures: { properties: "enabled", maintenance: "enabled", resident_portal: "enabled", documents: "disabled", finances: "disabled", notifications: "disabled" },
    });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/telemetry") return json({ accepted: true });
    if (path.endsWith("/properties")) return json([{ id: "fictional-home", name: "Fictional Garden House" }]);
    if (path === "/api/company/properties/fictional-home") return json({ id: "fictional-home", name: "Fictional Garden House" });
    if (path.endsWith("/maintenance/directory")) {
      state.calls.push(url);
      if (state.hold) await new Promise<void>(resolve => { state.release = resolve; });
      if (state.denied) return json({ error: "Your maintenance requests are no longer available." }, 404);
      if (state.fail) return json({ error: "The maintenance page is temporarily unavailable." }, 503);
      const cursor = url.searchParams.get("cursor"), before = url.searchParams.get("before");
      if ((cursor && !/^after-\d+$/.test(cursor)) || (before && !/^before-\d+$/.test(before)) || (cursor && before)) return json({ error: "The maintenance page link is invalid. Return to the first page.", code: "INVALID_DIRECTORY_CURSOR" }, 400);
      if (state.stale && (cursor || before)) return json({ error: "This maintenance page is no longer available. Return to the first page.", code: "DIRECTORY_CURSOR_UNAVAILABLE" }, 404);
      const status = url.searchParams.get("status"), q = url.searchParams.get("q")?.toLowerCase() || "", priority = url.searchParams.get("priority"), propertyId = url.searchParams.get("propertyId");
      const filtered = state.rows.filter(row => (!status || row.status === status || (status === "unresolved" && row.status !== "resolved")) && (!priority || row.priority === priority) && (!propertyId || row.propertyId === propertyId) && row.title.toLowerCase().includes(q));
      const start = cursor ? Number(cursor.slice(6)) : before ? Math.max(0, Number(before.slice(7)) - 50) : 0;
      const items = filtered.slice(start, start + 50).map(({ description, version, updatedAt, executionStatus, assigneeName, ...row }) => ({ ...row, ...(!resident ? { executionStatus, assigneeName } : {}) }));
      return json({ companyId: state.companyId, items, total: filtered.length, statusCounts: Object.fromEntries(["open", "in_progress", "resolved"].map(status => [status, filtered.filter(row => row.status === status).length])), pageSize: 50, nextCursor: start + 50 < filtered.length ? `after-${start + 50}` : null, previousCursor: start > 0 ? `before-${start}` : null });
    }
    if (path.endsWith("/updates")) return json({ items: [], nextCursor: null });
    if (path.endsWith("/preventive")) return json(null);
    if (path.endsWith("/vendor")) return json({ vendor: null, history: { items: [], nextCursor: null } });
    if (path.endsWith("/documents")) return json({ items: [], scanningConfigured: false });
    if (/\/work-orders\//.test(path)) return json({ request: { id: "fictional-request-51", executionStatus: "unassigned", assigneeId: null }, history: { items: [], nextCursor: null }, assignees: [] });
    if (/\/maintenance\/[^/]+$/.test(path)) {
      const row = state.rows.find(row => row.id === path.split("/").pop());
      return row ? json({ ...row, recordedBy: "Fictional manager", historyLimited: false, residentUpdatesAvailable: false, activity: [] }) : json({ error: "Request not found." }, 404);
    }
    return json([]);
  });
  return state;
}
const directory = (page: Page) => page.getByRole("region", { name: "Maintenance directory", exact: true });
const summary = (page: Page) => directory(page).getByRole("status").filter({ hasText: "matching requests" });

test("bounded maintenance pages show complete counts and copied previous/next URLs work with browser history", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/maintenance?cursor=after-50");
  await expect(directory(page).getByRole("row")).toHaveCount(51);
  await expect(summary(page)).toHaveText("123 matching requests · 41 Open · 41 In progress · 41 Resolved · 50 shown on this page");
  await expect(page.getByRole("link", { name: "Fictional repair 051", exact: true })).toBeVisible();
  const pager = page.getByRole("navigation", { name: "Maintenance request pages", exact: true });
  await pager.getByRole("button", { name: "Previous requests", exact: true }).click();
  await expect(page).toHaveURL(/before=before-50$/);
  await expect(page.getByRole("link", { name: "Fictional repair 001", exact: true })).toBeVisible();
  await expect(summary(page)).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/cursor=after-50$/);
  await expect(page.getByRole("link", { name: "Fictional repair 051", exact: true })).toBeVisible();
  await pager.getByRole("button", { name: "Next requests", exact: true }).click();
  await expect(page).toHaveURL(/cursor=after-100$/);
  await expect(directory(page).getByRole("row")).toHaveCount(24);
  await expect(summary(page)).toHaveText(/123 matching requests.*23 shown on this page/);
  await expect(summary(page)).toBeFocused();
  await expect(pager.getByRole("button", { name: "Next requests", exact: true })).toBeDisabled();
  expect(state.calls.at(-1)!.pathname).toBe("/api/company/maintenance/directory");
  await page.screenshot({ path: "/tmp/propertyflow-maintenance-directory-desktop-viewport.png", fullPage: false });
});

test("nested property request sources return to the exact page and all filters including copied newer-page cursors", async ({ page }) => {
  await fixture(page);
  await page.goto("/company/properties/fictional-home/maintenance?status=unresolved&priority=normal&before=before-100");
  await expect(summary(page)).toHaveText(/82 matching requests.*32 shown on this page/);
  await directory(page).getByRole("link", { name: "Manage request →", exact: true }).first().click();
  const source = new URL(page.url());
  expect(source.searchParams.get("propertyId")).toBe("fictional-home");
  expect(source.searchParams.get("nested")).toBe("true");
  expect(source.searchParams.get("before")).toBe("before-100");
  await page.getByRole("link", { name: "← Back to maintenance", exact: true }).click();
  await expect(page).toHaveURL(/\/company\/properties\/fictional-home\/maintenance\?status=unresolved&priority=normal&before=before-100$/);
  await expect(page.getByLabel("Filter status")).toHaveValue("unresolved");
  await expect(summary(page)).toHaveText(/82 matching requests/);
  await page.reload();
  await expect(page.getByRole("region", { name: "Property workspace" })).toContainText("Fictional Garden House");
  await expect(directory(page).getByRole("row")).toHaveCount(33);
});

test("filter edits reset both cursors and debounce cannot page with an unsettled request or assignee search", async ({ page }) => {
  const state = await fixture(page);
  await page.clock.install({ time: new Date("2026-10-24T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-24T12:00:01Z"));
  await page.goto("/company/maintenance?cursor=after-50");
  await expect(summary(page)).toHaveText(/123 matching requests/);
  const input = page.getByRole("searchbox", { name: "Find request", exact: true });
  await input.fill("Fictional repair 0");
  await expect(page).toHaveURL(url => url.searchParams.get("q") === "Fictional repair 0" && !url.searchParams.has("cursor") && !url.searchParams.has("before"));
  await expect(page.getByText("Updating search…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next requests", exact: true })).toBeDisabled();
  expect(state.calls.at(-1)!.searchParams.get("q")).toBeNull();
  await page.clock.runFor(250);
  await expect.poll(() => state.calls.at(-1)!.searchParams.get("q")).toBe("Fictional repair 0");
  await expect(summary(page)).toHaveText(/99 matching requests/);
  await expect(input).toBeFocused();
  await page.getByRole("button", { name: "Next requests", exact: true }).click();
  await expect(page).toHaveURL(url => url.searchParams.get("cursor") === "after-50" && url.searchParams.get("q") === "Fictional repair 0");
  await expect(summary(page)).toHaveText(/49 shown on this page/);
  await page.getByRole("searchbox", { name: "Assignee", exact: true }).fill("Fictional teammate");
  await expect(page).toHaveURL(url => url.searchParams.get("assignee") === "Fictional teammate" && !url.searchParams.has("cursor") && !url.searchParams.has("before"));
  await expect(page.getByText("Updating search…", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next requests", exact: true })).toBeDisabled();
  expect(state.calls.at(-1)!.searchParams.get("assignee")).toBeNull();
  await page.clock.runFor(250);
  await expect.poll(() => state.calls.at(-1)!.searchParams.get("assignee")).toBe("Fictional teammate");
  await expect(page.getByRole("searchbox", { name: "Assignee", exact: true })).toBeFocused();
  await page.getByLabel("Filter status").selectOption("open");
  await expect(summary(page)).toHaveText("33 matching requests · 33 Open · 0 In progress · 0 Resolved · 33 shown on this page");
});

test("same-page refresh preserves focus and rows while pending; failure re-enables paging and retry recovers", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/maintenance?cursor=after-50");
  await expect(summary(page)).toBeVisible();
  const input = page.getByRole("searchbox", { name: "Find request", exact: true });
  await input.focus(); state.hold = true; state.fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Refreshing maintenance…", { exact: true })).toBeVisible();
  await expect(directory(page).getByRole("row")).toHaveCount(51);
  await expect(page.getByRole("button", { name: "Next requests", exact: true })).toBeDisabled();
  await expect(input).toBeFocused();
  await expect.poll(() => !!state.release).toBe(true);
  state.hold = false; state.release!();
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByRole("button", { name: "Next requests", exact: true })).toBeEnabled();
  await expect(input).toBeFocused();
  state.fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(summary(page)).toHaveText(/123 matching requests/);
});

test("invalid and stale page links recover explicitly to the first page while keeping property and status filters", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/properties/fictional-home/maintenance?status=unresolved&cursor=broken-token");
  await expect(page.getByRole("alert")).toContainText("page link is invalid");
  await page.getByRole("button", { name: "Return to first page", exact: true }).click();
  await expect(page).toHaveURL(/\/fictional-home\/maintenance\?status=unresolved$/);
  await expect(summary(page)).toHaveText(/82 matching requests/);
  await page.getByRole("button", { name: "Next requests", exact: true }).click();
  await expect(summary(page)).toHaveText(/32 shown on this page/);
  state.stale = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("no longer available");
  await expect(page.getByRole("link", { name: "Fictional repair 076", exact: true })).toHaveCount(0);
  await expect(summary(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Return to first page", exact: true }).click();
  await expect(summary(page)).toHaveText(/82 matching requests/);
  await expect(page.getByLabel("Filter status")).toHaveValue("unresolved");
});

test("phone resident paging keeps requester controls and removes the page after request access is revoked", async ({ page }) => {
  const state = await fixture(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/resident/maintenance?cursor=after-100");
  await expect(summary(page)).toHaveText(/123 matching requests.*23 shown on this page/);
  await expect(page.getByLabel("Filter assigned work")).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Assignee", exact: true })).toHaveCount(0);
  await expect(page.getByText("Assigned to Fictional teammate", { exact: true })).toHaveCount(0);
  const pager = page.getByRole("navigation", { name: "Maintenance request pages", exact: true });
  await pager.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/propertyflow-maintenance-directory-mobile-viewport.png", fullPage: false });
  state.denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("no longer available");
  await expect(directory(page).getByRole("row")).toHaveCount(0);
  await expect(summary(page)).toHaveCount(0);
});

test("a directory response from another company hides rows and totals until the workspace is explicitly reloaded", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/maintenance");
  await expect(summary(page)).toHaveText(/123 matching requests/);
  state.companyId = "fictional-company-b";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert")).toContainText("company workspace changed");
  await expect(directory(page).getByRole("row")).toHaveCount(0);
  await expect(summary(page)).toHaveCount(0);
  state.bootstrapCompanyId = state.companyId; state.memberVersion++;
  await page.getByRole("button", { name: "Reload workspace", exact: true }).click();
  await expect(summary(page)).toHaveText(/123 matching requests/);
});
