import { test, expect, type Page } from "@playwright/test";

const leaseId = "move-lease", date = "2026-12-15", reason = "Tenant requested this future date. Keep the exact move-out reason.";
const oldReason = "An earlier reviewed plan must stay unchanged.";
function preview(endsOn: string, explanation: string) {
  return { kind: "plan_end", endsOn, reason: explanation, ready: true, readyOn: "2026-10-25", blockers: [], businessDate: "2026-10-25", oldFinal: { calculation: { periodOn: "2026-12-01", fromOn: "2026-12-01", throughOn: endsOn, throughExclusiveOn: "2026-12-16", days: 15, daysInMonth: 31, monthlyCents: 100000, calculatedCents: 48387, partial: true, rounding: "Nearest cent, half up" }, recordedCharge: null, scheduledAmountCents: 0 }, oldBilling: null, pauseBilling: false, newTerm: null, balances: { outstandingCents: "0", creditCents: "0" }, deposit: null, sourceHash: "a".repeat(64) };
}
async function fixture(page: Page) {
  const lease = { id: leaseId, propertyId: "home", unitId: "unit", residentId: "tenant", status: "active", version: 7, startsOn: "2026-09-01", endsOn: null, rentCents: 100000, rentDueDay: 1, graceDays: 0, paymentInstructions: null, property: { name: "Fictional Maple House" }, unit: { label: "Suite A" }, resident: { name: "Fictional Tenant", email: "tenant@test.invalid" }, renewals: [] };
  const snapshot = { basis: "Current fictional source records.", lease, financial: { current: { outstandingCents: "0", creditCents: "0", paidCents: "0", chargedCents: "0" }, items: [], allocations: [] }, deposit: null, schedules: [] };
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  const state = { transitionStatus: 200, holdTransition: false, transitionReads: 0, version: 1, finance: true, telemetry: 0, writes: [] as { path: string; body: any }[], release };
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({ user: { id: "owner", name: "Fictional owner", email: "owner@test.invalid", status: "active", emailVerified: true }, membership: { companyId: "a", version: state.version, role: "owner", status: "active", company: { id: "a", name: "Fictional company", status: "active" } }, permissions: ["property.read", "lease.manage", ...(state.finance ? ["finance.manage"] : [])], csrfToken: "fixture" });
    if (path === "/api/telemetry" && request.method() === "POST") {
      expect(request.headers()["x-csrf-token"]).toBe("fixture");
      state.telemetry++;
      return route.fulfill({ status: 204, body: "" });
    }
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === `/api/company/leases/${leaseId}`) return json(lease);
    if (path === `/api/company/leases/${leaseId}/settlement` && request.method() === "GET") return json({ businessDate: "2026-10-25", lease, settlement: null, latest: null, revisions: [], nextBeforeVersion: null, sourceChanged: false, current: snapshot, activeBillingCount: 0 });
    if (path === `/api/company/leases/${leaseId}/transition` && request.method() === "GET") {
      state.transitionReads++;
      if (state.holdTransition) await pending;
      if (state.transitionStatus !== 200) return json({ error: "Lease change sources are temporarily unavailable.", code: state.transitionStatus === 403 ? "ACCESS_DENIED" : "TEMPORARY_FAILURE" }, state.transitionStatus);
      return json({ lease, successor: null, current: { rentCents: 100000 }, businessDate: "2026-10-25", balances: { outstandingCents: "0", creditCents: "0" }, deposit: null, history: [] });
    }
    if (request.method() !== "GET") {
      const body = request.postDataJSON(); state.writes.push({ path, body });
      if (path.endsWith("/transition/preview")) return json(preview(body.endsOn, body.reason));
      return json({ error: "This fixture must not commit a settlement or lease change." }, 400);
    }
    if (path === "/api/company/leases") return json({ items: [], nextCursor: null });
    return json([]);
  });
  return state;
}
async function handoff(page: Page) {
  await page.goto(`/company/leases/${leaseId}?section=settlement`);
  await page.getByRole("button", { name: "Prepare settlement", exact: true }).click();
  const source = page.getByRole("dialog", { name: "Prepare move-out settlement", exact: true });
  await source.getByLabel("Move-out date", { exact: true }).fill(date);
  await source.getByRole("textbox", { name: "Reason shown to the tenant", exact: true }).fill(reason);
  await source.getByRole("button", { name: "Review planned move-out", exact: true }).click();
  await expect(source).not.toBeVisible();
}
const notice = (page: Page) => page.getByRole("region", { name: "Retained move-out plan", exact: true });
const help = (page: Page) => page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name: "Help", exact: true });
async function cancelLeave(page: Page) {
  let asked = false;
  page.once("dialog", async dialog => { asked = true; expect(dialog.message()).toContain("discard its unsaved changes"); await dialog.dismiss(); });
  if (!await page.getByRole("navigation", { name: "Main navigation", exact: true }).isVisible())
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  await help(page).click();
  await expect.poll(() => asked).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/company/leases/${leaseId}`));
}

test("a failed destination read retains and guards the exact plan until retry acknowledges its editor", async ({ page }) => {
  const state = await fixture(page); state.transitionStatus = 503;
  await handoff(page);
  await expect(page.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(notice(page)).toContainText(reason);
  await expect(notice(page)).toContainText("December 15, 2026");
  await cancelLeave(page);
  expect(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  expect(state.writes).toHaveLength(0);
  state.transitionStatus = 200;
  await notice(page).getByRole("button", { name: "Retry lease review", exact: true }).click();
  const target = page.getByRole("dialog", { name: "Lease dates & rent", exact: true });
  await expect(target.getByLabel("Current lease end date", { exact: true })).toHaveValue(date);
  await expect(target.getByRole("textbox", { name: "Reason for the lease change", exact: true })).toHaveValue(reason);
  await expect(notice(page)).toHaveCount(0);
  await target.getByRole("button", { name: "Close", exact: true }).click();
  const warning = target.getByRole("alertdialog", { name: "Close without saving changes?", exact: true });
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "Keep editing", exact: true }).click();
  await target.getByRole("button", { name: "Review changes", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Review end date", exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({ path: `/api/company/leases/${leaseId}/transition/preview`, body: { kind: "plan_end", endsOn: date, reason, expectedLeaseVersion: 7 } });
});

test("a delayed handoff can return to guarded move-out details without a late read stealing ownership", async ({ page }) => {
  const state = await fixture(page); state.holdTransition = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await handoff(page);
  await expect(notice(page)).toContainText(reason);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await cancelLeave(page);
  await notice(page).getByRole("button", { name: "Return to move-out details", exact: true }).click();
  const source = page.getByRole("dialog", { name: "Prepare move-out settlement", exact: true });
  await expect(source.getByLabel("Move-out date", { exact: true })).toHaveValue(date);
  await expect(source.getByRole("textbox", { name: "Reason shown to the tenant", exact: true })).toHaveValue(reason);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await source.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  await expect(notice(page)).toHaveCount(0);
  const lateRead = page.waitForResponse(response => new URL(response.url()).pathname === `/api/company/leases/${leaseId}/transition`);
  state.release();
  await (await lateRead).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole("dialog", { name: "Lease dates & rent", exact: true })).toHaveCount(0);
  await expect(source.getByRole("textbox", { name: "Reason shown to the tenant", exact: true })).toHaveValue(reason);
  await source.getByRole("button", { name: "Close", exact: true }).click();
  await expect(source.getByRole("alertdialog", { name: "Close without saving changes?", exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
});

test("an existing submitted lease review wins and discarding only the pending handoff keeps its journal", async ({ page }) => {
  const state = await fixture(page);
  const existing = { attempted: true, body: { kind: "plan_end", endsOn: "2026-11-30", reason: oldReason, expectedLeaseVersion: 7, submissionKey: "existing-attempt" }, preview: preview("2026-11-30", oldReason) };
  await page.addInitScript(value => sessionStorage.setItem("pf:handoff:owner:a:move-lease", JSON.stringify(value)), existing);
  await handoff(page);
  await expect(page.getByText("Your future move-out date is waiting.", { exact: false })).toBeVisible();
  await expect(notice(page)).toContainText(reason);
  await cancelLeave(page);
  page.once("dialog", dialog => dialog.accept());
  await notice(page).getByRole("button", { name: "Discard retained move-out plan", exact: true }).click();
  await expect(notice(page)).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("pf:handoff:owner:a:move-lease")!))).toEqual(existing);
  await page.getByRole("button", { name: "Resume lease review", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Review end date", exact: true })).toContainText(oldReason);
  expect(state.writes).toHaveLength(0);
});

test("denied target access conceals pending values until authorized retry and authority changes remove private editors", async ({ page }) => {
  const state = await fixture(page); state.transitionStatus = 403;
  await handoff(page);
  await expect(notice(page)).toContainText("private move-out details are hidden");
  await expect(notice(page)).not.toContainText(reason);
  await cancelLeave(page);
  state.transitionStatus = 200;
  await notice(page).getByRole("button", { name: "Retry lease review", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("textbox", { name: "Reason for the lease change", exact: true })).toHaveValue(reason);
  state.finance = false; state.version++;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(notice(page)).toHaveCount(0);
  await expect(page.getByText(reason, { exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test("today stays in actual settlement without creating a lease-change handoff", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/company/leases/${leaseId}?section=settlement`);
  await page.getByRole("button", { name: "Prepare settlement", exact: true }).click();
  const source = page.getByRole("dialog", { name: "Prepare move-out settlement", exact: true });
  await source.getByLabel("Move-out date", { exact: true }).fill("2026-10-25");
  await source.getByRole("textbox", { name: "Reason shown to the tenant", exact: true }).fill("Actual move-out review.");
  await source.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(source.getByRole("heading", { name: "Forwarding details", exact: true })).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  expect(state.transitionReads).toBe(0);
  expect(state.writes).toHaveLength(0);
});
