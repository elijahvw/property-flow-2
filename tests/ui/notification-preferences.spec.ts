import { test, expect, Page } from "@playwright/test";

type Settings = { maintenanceEnabled: boolean; workEnabled: boolean; inspectionsEnabled: boolean; agreementsEnabled: boolean };
const defaults = (): Settings => ({ maintenanceEnabled: true, workEnabled: true, inspectionsEnabled: true, agreementsEnabled: true });
type Receipt = { appliedVersion: number; appliedSettings: Settings; changed: boolean; replayed: boolean };
async function fixture(page: Page, options: { readOnly?: boolean; support?: boolean; resident?: boolean } = {}) {
  const state = {
    settings: defaults(), version: 0, posts: [] as any[], inboxReads: 0, preferenceReads: 0,
    loseResponse: false, failPreferenceRead: false, feature: options.readOnly ? "read_only" : "enabled",
    membershipVersion: 1, holdSave: false, releaseSave: null as (() => void) | null,
    holdPreferenceRead: false, releasePreferenceRead: null as (() => void) | null,
    companyId: "fictional-company", bootstrapCompanyId: "fictional-company", loseBeforeCommit: false,
    portalFeature: "enabled",
    receipts: new Map<string, Receipt>(), history: [] as any[],
  };
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({
      user: { id: "fictional-member", name: "Fictional member", email: "member@test.invalid", emailVerified: true, status: "active", platformRole: null },
      membership: { companyId: state.bootstrapCompanyId, version: state.membershipVersion, role: options.resident ? "resident" : "manager", status: "active", company: { id: state.bootstrapCompanyId, name: "Fictional Property Company", status: "active" } },
      permissions: ["notification.read", options.resident ? "resident.self" : "property.read"], csrfToken: "fixture", destination: "/account/notifications",
      companyFeatures: { notifications: state.feature, resident_portal: state.portalFeature, properties: "enabled", leasing: "enabled", maintenance: "enabled" },
      impersonation: options.support ? { actor: { id: "fictional-support", name: "Fictional support", email: "support@test.invalid" }, expiresAt: "2099-10-24T20:00:00Z", readOnly: true, contextId: "fictional-support-context" } : null,
    });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/telemetry") return json({ accepted: true });
    if (path === "/api/account/notifications/summary") return json({ unread: 51 });
    if (path === "/api/account/notifications/preferences/history") return json({ companyId: state.companyId, items: state.history, nextCursor: null });
    if (path === "/api/account/notifications/preferences") {
      if (request.method() === "GET") {
        state.preferenceReads++;
        if (state.holdPreferenceRead) await new Promise<void>(resolve => { state.releasePreferenceRead = resolve; });
        if (state.failPreferenceRead) { state.failPreferenceRead = false; return json({ error: "The latest preferences could not be loaded." }, 503); }
        return json({ companyId: state.companyId, settings: state.settings, version: state.version });
      }
      const body = request.postDataJSON(); state.posts.push(body);
      expect(request.headers()["x-csrf-token"]).toBe("fixture");
      if (state.holdSave) await new Promise<void>(resolve => { state.releaseSave = resolve; });
      if (state.loseBeforeCommit) { state.loseBeforeCommit = false; return route.abort("failed"); }
      if (body.expectedCompanyId !== state.companyId) return json({ error: "Your company context changed. Reload your workspace before reviewing preferences.", code: "COMPANY_CONTEXT_CHANGED" }, 409);
      const previous = state.receipts.get(body.submissionKey);
      if (previous) return json({ companyId: state.companyId, settings: state.settings, version: state.version, receipt: { ...previous, replayed: true } });
      if (body.expectedVersion !== state.version) return json({ error: "This record changed. Reload it and review the latest version.", code: "RECORD_CHANGED" }, 409);
      const settings: Settings = { maintenanceEnabled: body.maintenanceEnabled, workEnabled: body.workEnabled, inspectionsEnabled: body.inspectionsEnabled, agreementsEnabled: body.agreementsEnabled };
      const changed = JSON.stringify(settings) !== JSON.stringify(state.settings);
      if (state.version === 0 || changed) state.version++;
      state.settings = settings;
      const receipt = { appliedVersion: state.version, appliedSettings: { ...settings }, changed, replayed: false };
      state.receipts.set(body.submissionKey, receipt);
      state.history.unshift({ id: `fictional-action-${state.history.length + 1}`, createdAt: "2026-10-24T16:00:00Z", appliedVersion: state.version, settings: { ...settings }, changed });
      if (state.loseResponse) { state.loseResponse = false; return json({ error: "The saved preference response was interrupted. Retry the original choices." }, 503); }
      return json({ companyId: state.companyId, settings: state.settings, version: state.version, receipt });
    }
    if (path === "/api/account/notifications") {
      state.inboxReads++;
      return json({
        items: Array.from({ length: 8 }, (_, index) => ({ id: `fictional-notice-${index}`, version: 1, title: "Work assigned to you", sourceTitle: `Fictional repair ${index + 1}`, property: "Fictional Garden House", unit: "Unit A", type: "work", readAt: null, createdAt: "2026-10-24T12:00:00Z" })),
        total: 51, unread: 51, page: Number(url.searchParams.get("page") || 1), pageSize: 25,
      });
    }
    return json([]);
  });
  return state;
}

async function openPreferences(page: Page) {
  await page.getByRole("button", { name: "Notification preferences", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Notification preferences", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("four optional preference areas save without disturbing inbox filters, paging, scroll or existing notices", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/account/notifications?status=unread&type=work&page=2");
  await expect(page.getByRole("article")).toHaveCount(8);
  expect(state.posts).toHaveLength(0); expect(state.version).toBe(0);
  const inboxReads = state.inboxReads;
  await page.evaluate(() => window.scrollTo(0, 100));
  const scroll = await page.evaluate(() => window.scrollY);
  await page.getByRole("button", { name: "Notification preferences", exact: true }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Notification preferences", exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await expect(dialog.getByRole("checkbox")).toHaveCount(4);
  for (const checkbox of await dialog.getByRole("checkbox").all()) await expect(checkbox).toBeChecked();
  await expect(dialog).toContainText("Turning off notices does not remove assigned work or review responsibilities.");
  await dialog.getByRole("checkbox", { name: /^Maintenance/ }).uncheck();
  await dialog.getByRole("checkbox", { name: /^Assigned work/ }).uncheck();
  await page.screenshot({ path: "/tmp/propertyflow-notification-preferences-desktop-viewport.png", fullPage: false });
  state.holdSave = true; state.holdPreferenceRead = true;
  await dialog.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
  state.holdSave = false; state.releaseSave!();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Notification preferences saved." }).first()).toBeVisible();
  expect(state.posts[0]).toEqual({ maintenanceEnabled: false, workEnabled: false, inspectionsEnabled: true, agreementsEnabled: true, expectedCompanyId: "fictional-company", expectedVersion: 0, submissionKey: expect.any(String) });
  expect(state.inboxReads).toBe(inboxReads);
  expect(page.url()).toContain("status=unread&type=work&page=2");
  await expect(page.getByLabel("Read status")).toHaveValue("unread");
  await expect(page.getByLabel("Notification type")).toHaveValue("work");
  await expect(page.getByText("Page 2 of 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(8);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
  await expect(page.getByRole("button", { name: "Notification preferences", exact: true })).toBeFocused();
  const reopened = await openPreferences(page);
  await expect(reopened.getByRole("checkbox", { name: /^Maintenance/ })).not.toBeChecked();
  await expect(reopened.getByRole("checkbox", { name: /^Assigned work/ })).not.toBeChecked();
  state.holdPreferenceRead = false; state.releasePreferenceRead?.();
  await reopened.getByText("Preference history", { exact: true }).click();
  await expect(reopened.getByText("Version 1 · Preferences changed", { exact: true })).toBeVisible();
  await expect(reopened.getByText("Maintenance: Off · Assigned work: Off · Inspections: On · Agreements: On", { exact: true })).toBeVisible();
});

test("lost save response recovers the exact choices and key while preserving newer settings from another session", async ({ page }) => {
  const state = await fixture(page); state.loseResponse = true;
  await page.goto("/account/notifications?status=unread&type=work&page=2");
  let dialog = await openPreferences(page);
  await dialog.getByRole("checkbox", { name: /^Assigned work/ }).uncheck();
  await dialog.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("response was interrupted");
  await expect(dialog.getByRole("alert")).toBeFocused();
  await expect(dialog.getByRole("checkbox", { name: /^Assigned work/ })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Clear draft", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.getByRole("button", { name: "Close & keep recovery", exact: true }).click();
  await expect(page.getByText("Interrupted save kept for recovery on this page.", { exact: true })).toBeVisible();
  state.settings = { ...defaults(), maintenanceEnabled: false }; state.version = 2;
  dialog = await openPreferences(page);
  await expect(dialog.getByRole("checkbox", { name: /^Assigned work/ })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(page.getByText("Earlier save recovered. Newer saved preferences remain in effect.", { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(2); expect(state.posts[0]).toEqual(state.posts[1]);
  expect(state.receipts.size).toBe(1); expect(state.version).toBe(2);
  dialog = await openPreferences(page);
  await expect(dialog.getByRole("checkbox", { name: /^Assigned work/ })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /^Maintenance/ })).not.toBeChecked();
});

test("stale choices survive conflict and failed reload until an explicit saved-versus-proposed review creates a new save", async ({ page }) => {
  const state = await fixture(page); state.version = 3;
  await page.goto("/account/notifications");
  const dialog = await openPreferences(page);
  await dialog.getByRole("checkbox", { name: /^Maintenance/ }).uncheck();
  state.settings.workEnabled = false; state.version = 4;
  await dialog.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(dialog.getByRole("alert").first()).toContainText("record changed");
  await expect(dialog.getByRole("checkbox", { name: /^Maintenance/ })).not.toBeChecked();
  expect(state.posts).toHaveLength(1); expect(state.settings.maintenanceEnabled).toBe(true);
  state.failPreferenceRead = true;
  await dialog.getByRole("button", { name: "Review latest saved preferences", exact: true }).click();
  await expect(dialog.getByText("The latest preferences could not be loaded.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /^Maintenance/ })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Review latest saved preferences", exact: true }).click();
  const comparison = dialog.getByRole("region", { name: "Saved preferences and your choices" });
  await expect(comparison.getByRole("row", { name: "Maintenance On Off", exact: true })).toBeVisible();
  await expect(comparison.getByRole("row", { name: "Assigned work Off On", exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(1);
  await dialog.getByRole("button", { name: "Keep my choices for a new save", exact: true }).click();
  await dialog.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.posts).toHaveLength(2); expect(state.posts[1].expectedVersion).toBe(4);
  expect(state.posts[1].submissionKey).not.toBe(state.posts[0].submissionKey);
  expect(state.settings.maintenanceEnabled).toBe(false); expect(state.settings.workEnabled).toBe(true);
});

test("an uncommitted interrupted save can recover from a definite conflict without losing choices or silently replacing its key", async ({ page }) => {
  const state = await fixture(page); state.loseBeforeCommit = true;
  await page.goto("/account/notifications");
  const dialog = await openPreferences(page);
  await dialog.getByRole("checkbox", { name: /^Maintenance/ }).uncheck();
  await dialog.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: /^Maintenance/ })).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("may already be saved");
  expect(state.receipts.size).toBe(0);
  state.settings.workEnabled = false; state.version = 1;
  await dialog.getByRole("button", { name: "Save preferences", exact: true }).click();
  const conflict = dialog.getByRole("alert", { name: "Review changed preferences", exact: true });
  await expect(conflict).toContainText("This record changed");
  await expect(conflict).toBeFocused();
  await expect(dialog.getByRole("checkbox", { name: /^Maintenance/ })).toBeEnabled();
  await expect(dialog.getByRole("checkbox", { name: /^Maintenance/ })).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Review latest saved preferences", exact: true })).toBeEnabled();
  expect(state.posts).toHaveLength(2); expect(state.posts[0]).toEqual(state.posts[1]);
  await dialog.getByRole("button", { name: "Review latest saved preferences", exact: true }).click();
  await dialog.getByRole("button", { name: "Keep my choices for a new save", exact: true }).click();
  expect(state.posts).toHaveLength(2);
  await dialog.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.posts[2].submissionKey).not.toBe(state.posts[0].submissionKey);
  expect(state.posts[2].expectedVersion).toBe(1);
  expect(state.settings.maintenanceEnabled).toBe(false);
});

test("a company transfer between opening and saving blocks old-company choices until an explicit workspace reload", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/account/notifications");
  let dialog = await openPreferences(page);
  await dialog.getByRole("checkbox", { name: /^Assigned work/ }).uncheck();
  state.companyId = "fictional-company-b"; state.settings = defaults(); state.version = 0;
  await dialog.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(dialog.getByText(/Your company context changed\./).first()).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /^Assigned work/ })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /^Assigned work/ })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Save preferences", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Review latest saved preferences", exact: true })).toHaveCount(0);
  expect(state.posts[0].expectedCompanyId).toBe("fictional-company");
  expect(state.version).toBe(0); expect(state.settings).toEqual(defaults()); expect(state.receipts.size).toBe(0);
  state.bootstrapCompanyId = state.companyId; state.membershipVersion++;
  await dialog.getByRole("button", { name: "Reload workspace", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  dialog = await openPreferences(page);
  await expect(dialog.getByRole("checkbox", { name: /^Assigned work/ })).toBeChecked();
  expect(state.posts).toHaveLength(1);
});

test("an initial preference response from another company cannot become an editable baseline under a stale workspace", async ({ page }) => {
  const state = await fixture(page); state.companyId = "fictional-company-b";
  await page.goto("/account/notifications");
  await expect(page.getByText(/Your company context changed\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Notification preferences", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
  state.bootstrapCompanyId = state.companyId; state.membershipVersion++;
  await page.getByRole("button", { name: "Reload workspace", exact: true }).click();
  const dialog = await openPreferences(page);
  for (const checkbox of await dialog.getByRole("checkbox").all()) await expect(checkbox).toBeChecked();
});

test("a latest-version review from another company never rebases old-company choices", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/account/notifications");
  const dialog = await openPreferences(page);
  await dialog.getByRole("checkbox", { name: /^Assigned work/ }).uncheck();
  state.version = 1;
  await dialog.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(dialog.getByRole("alert", { name: "Review changed preferences", exact: true })).toBeVisible();
  state.companyId = "fictional-company-b"; state.version = 0; state.settings = defaults();
  await dialog.getByRole("button", { name: "Review latest saved preferences", exact: true }).click();
  await expect(dialog.getByText(/Your company context changed\./)).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /^Assigned work/ })).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Save preferences", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Review latest saved preferences", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Keep my choices for a new save", exact: true })).toHaveCount(0);
  expect(state.posts).toHaveLength(1); expect(state.settings).toEqual(defaults());
});

test("phone preferences retain an explicitly saved draft and clear it when current access becomes read-only", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/account/notifications?status=unread&type=work&page=2");
  let dialog = await openPreferences(page);
  await dialog.getByRole("checkbox", { name: /^Agreements/ }).uncheck();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.getByRole("button", { name: "Save draft & close", exact: true }).click();
  await expect(page.getByText("Draft kept on this page.", { exact: true })).toBeVisible();
  dialog = await openPreferences(page);
  await expect(dialog.getByText("Saved draft · available only while this page stays open.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /^Agreements/ })).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/propertyflow-notification-preferences-mobile-viewport.png", fullPage: false });
  state.feature = "read_only";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog).toHaveCount(0);
  dialog = await openPreferences(page);
  await expect(dialog.getByText("Notification preferences are read-only under your current access settings.", { exact: true })).toBeVisible();
  for (const checkbox of await dialog.getByRole("checkbox").all()) await expect(checkbox).toBeDisabled();
  await expect(dialog.getByRole("checkbox", { name: /^Agreements/ })).toBeChecked();
  await expect(dialog.getByRole("button", { name: "Save preferences", exact: true })).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
});

test("support impersonation can inspect preferences without editing them", async ({ page }) => {
  const state = await fixture(page, { support: true });
  await page.goto("/account/notifications");
  const dialog = await openPreferences(page);
  for (const checkbox of await dialog.getByRole("checkbox").all()) await expect(checkbox).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Save preferences", exact: true })).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
});

test("resident portal read-only clears an earlier draft and leaves personal preferences view-only", async ({ page }) => {
  const state = await fixture(page, { resident: true });
  await page.goto("/account/notifications");
  let dialog = await openPreferences(page);
  await dialog.getByRole("checkbox", { name: /^Maintenance/ }).uncheck();
  state.portalFeature = "read_only";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog).toHaveCount(0);
  dialog = await openPreferences(page);
  await expect(dialog.getByRole("checkbox", { name: /^Maintenance/ })).toBeChecked();
  for (const checkbox of await dialog.getByRole("checkbox").all()) await expect(checkbox).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Save preferences", exact: true })).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
});
