import { test, expect, Page } from "@playwright/test";

type Unit = { id: string; propertyId: string; label: string; status: string; version: number };
const home = "hint-home", garden = "hint-garden", preferredId = "home-unit-051";
const units: Unit[] = Array.from({ length: 51 }, (_, index) => ({ id: `home-unit-${String(index + 1).padStart(3, "0")}`, propertyId: home, label: `Fictional Home Unit ${String(index + 1).padStart(3, "0")}`, status: "active", version: 7 }));
const gardenUnits: Unit[] = [1, 2].map(index => ({ id: `garden-unit-${index}`, propertyId: garden, label: `Fictional Garden Unit ${index}`, status: "active", version: 2 }));
const markers = { prospectId: "fictional-origin", prospectQ: "Original inquiry", prospectProperty: home, prospectStage: "approved", prospectDue: "today", prospectCursor: "original-cursor" };
const setupPath = (hint?: string) => `/company/leases?${new URLSearchParams({ new: "lease", propertyId: home, ...(hint ? { unitId: hint } : {}), ...markers })}`;

async function fixture(page: Page) {
  const state = {
    company: "hint-company", membershipVersion: 1, metadata: undefined as Unit | undefined, metadataStatus: 200,
    holdMetadata: false, releases: [] as (() => void)[], directoryReads: [] as URL[], unitReads: [] as URL[],
    holdUnitPages: false, unitReleases: [] as (() => void)[], pageSnapshot: null as Unit[] | null, emptyUnits: false,
    loseResponse: false, posts: [] as any[], records: [] as any[],
  };
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({
      user: { id: "hint-manager", name: "Fictional manager", email: "manager@test.invalid", emailVerified: true, status: "active", platformRole: null },
      membership: { companyId: state.company, version: state.membershipVersion, role: "manager", status: "active", company: { id: state.company, name: "Fictional leasing company", status: "active" } },
      permissions: ["property.read", "lease.manage", "resident.assignment.manage"], csrfToken: "fixture", destination: "/company/leases",
      companyFeatures: { properties: "enabled", leasing: "enabled", finances: "disabled", documents: "disabled", inspections: "disabled", agreements: "disabled", resident_portal: "disabled", notifications: "disabled" },
    });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/telemetry") return json({ accepted: true });
    if (path === "/api/company/properties") return json(state.company === "hint-company" ? [{ id: home, name: "Fictional Home" }, { id: garden, name: "Fictional Garden" }] : [{ id: "other-home", name: "Other company home" }]);
    if (/\/api\/company\/properties\/[^/]+\/residents$/.test(path)) return json([{ userId: "resident-one", membership: { user: { name: "Fictional resident one", email: "one@test.invalid" } } }, { userId: "resident-two", membership: { user: { name: "Fictional resident two", email: "two@test.invalid" } } }]);
    if (/\/api\/company\/properties\/[^/]+\/units$/.test(path)) {
      state.unitReads.push(url);
      if (state.company !== "hint-company") return json({ error: "Property unavailable in this company." }, 404);
      const propertyId = path.split("/")[4], choices = propertyId === home ? units : gardenUnits;
      const pageUnits = state.emptyUnits ? [] : state.pageSnapshot || (url.searchParams.has("cursor") ? choices.slice(50) : choices.slice(0, 50));
      const nextCursor = !state.emptyUnits && !state.pageSnapshot && !url.searchParams.has("cursor") && choices.length > 50 ? choices[49].id : null;
      if (state.holdUnitPages) await new Promise<void>(resolve => state.unitReleases.push(resolve));
      return json({ items: pageUnits, nextCursor });
    }
    if (/\/api\/company\/properties\/[^/]+$/.test(path)) return json({ id: path.split("/").pop(), name: "Fictional Home" });
    if (path === "/api/company/leases") {
      if (request.method() === "POST") {
        expect(request.headers()["x-csrf-token"]).toBe("fixture");
        const body = request.postDataJSON(); state.posts.push(body);
        let record = state.records.find(row => row.submissionKey === body.submissionKey);
        if (!record) {
          record = { ...body, id: "hint-saved-lease", startsOn: body.startsOn + "T00:00:00Z", endsOn: body.endsOn ? body.endsOn + "T00:00:00Z" : null, rentCents: Math.round(Number(body.monthlyRent) * 100), currency: "USD", version: 1, unit: { label: units.find(unit => unit.id === body.unitId)?.label || "Fictional unit" }, property: { name: "Fictional Home" }, resident: { name: "Fictional resident one", email: "one@test.invalid" }, renewals: [] };
          state.records.push(record);
        }
        if (state.loseResponse) { state.loseResponse = false; return route.abort("failed"); }
        return json(record);
      }
      state.directoryReads.push(url);
      const requested = url.searchParams.get("unitId"), scope = state.company;
      const metadata = state.metadata || [...units, ...gardenUnits].find(unit => unit.id === requested);
      const snapshot = metadata ? { ...metadata } : null, status = state.metadataStatus;
      if (state.holdMetadata && requested) await new Promise<void>(resolve => state.releases.push(resolve));
      if (requested && (status !== 200 || !snapshot || scope !== "hint-company")) return json({ error: "Suggested unit source is unavailable." }, status === 200 ? 404 : status);
      return json({ items: state.records, nextCursor: null, ...(requested ? { unit: snapshot } : {}) });
    }
    if (/\/api\/company\/leases\/[^/]+\/participants$/.test(path)) return json({ lease: state.records[0], items: [], candidates: [] });
    if (/\/api\/company\/leases\/[^/]+$/.test(path)) return state.records[0] ? json(state.records[0]) : json({ error: "Lease unavailable." }, 404);
    return json([]);
  });
  return { state, release() { state.holdMetadata = false; for (const release of state.releases.splice(0)) release(); }, releaseUnits() { state.holdUnitPages = false; for (const release of state.unitReleases.splice(0)) release(); } };
}
const dialog = (page: Page) => page.getByRole("region", { name: "Record a lease", exact: true });
const activeDraft = (page: Page) => dialog(page).locator(".lease-property-draft:not([hidden])");
const picker = (page: Page) => activeDraft(page).getByRole("combobox", { name: "Unit for new lease", exact: true });
async function terms(page: Page, rent = "1234.56") {
  await activeDraft(page).getByRole("combobox", { name: "Primary resident", exact: true }).selectOption("resident-one");
  await activeDraft(page).getByLabel("New lease start date", { exact: true }).fill("2026-11-01");
  await activeDraft(page).getByLabel("New lease monthly rent (USD)", { exact: true }).fill(rent);
}

test("a verified suggested unit beyond page one is selected once, while URL labels and rent stay advisory", async ({ page }) => {
  const fixtureData = await fixture(page), state = fixtureData.state;
  await page.goto(setupPath(preferredId) + "&unitLabel=Forged+label&monthlyRent=999999&readiness=ready");
  await expect(picker(page)).toHaveValue(preferredId);
  await expect(picker(page).getByRole("option", { name: "Fictional Home Unit 051", exact: true })).toHaveCount(1);
  await expect(dialog(page).getByText("Forged label", { exact: true })).toHaveCount(0);
  await expect(activeDraft(page).getByLabel("New lease monthly rent (USD)", { exact: true })).toHaveValue("");
  expect(state.unitReads[0].searchParams.has("cursor")).toBe(false); expect(state.posts).toHaveLength(0);
  await terms(page);
  await page.screenshot({ path: "/tmp/propertyflow-preferred-unit-desktop.png", fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/propertyflow-preferred-unit-mobile.png", fullPage: false });
  await activeDraft(page).getByRole("button", { name: "Next page", exact: true }).click();
  await expect(activeDraft(page).getByRole("button", { name: "First page", exact: true })).toBeVisible();
  await expect(picker(page)).toHaveValue(preferredId);
  await expect(picker(page).getByRole("option", { name: "Fictional Home Unit 051", exact: true })).toHaveCount(1);
  await expect(activeDraft(page).getByLabel("New lease monthly rent (USD)", { exact: true })).toHaveValue("1234.56");
  const rent = activeDraft(page).getByLabel("New lease monthly rent (USD)", { exact: true }); await rent.focus();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(rent).toBeFocused(); await expect(picker(page)).toHaveValue(preferredId);
});

for (const scenario of ["missing", "archived", "foreign", "wrong property"] as const) test(`an ${scenario} suggestion keeps a required manual unit choice`, async ({ page }) => {
  const fixtureData = await fixture(page), state = fixtureData.state;
  if (scenario === "archived") state.metadata = { ...units[50], status: "archived" };
  if (scenario === "foreign") state.metadataStatus = 404;
  if (scenario === "wrong property") state.metadata = { ...units[50], propertyId: garden };
  await page.goto(setupPath(scenario === "missing" ? "missing-unit" : preferredId));
  await expect(picker(page)).toHaveValue("");
  await expect(activeDraft(page).getByText("Suggested unit is unavailable for this property. Choose an active unit.", { exact: true })).toBeVisible();
  await expect(picker(page).locator(`option[value="${preferredId}"]`)).toHaveCount(0);
  await picker(page).selectOption("home-unit-002"); await expect(picker(page)).toHaveValue("home-unit-002");
  expect(state.posts).toHaveLength(0);
});

test("the ordinary no-hint lease setup retains its first active unit default", async ({ page }) => {
  const fixtureData = await fixture(page);
  await page.goto(setupPath());
  await expect(picker(page)).toHaveValue("home-unit-001");
  await expect(activeDraft(page).getByText("Checking suggested unit…", { exact: true })).toHaveCount(0);
  expect(fixtureData.state.posts).toHaveLength(0);
});

test("an older delayed units page cannot replace the verified hint label used in review", async ({ page }) => {
  const fixtureData = await fixture(page), state = fixtureData.state;
  state.metadata = { ...units[50], label: "Fictional current verified label", version: 7 };
  state.pageSnapshot = [...units.slice(0, 49), { ...units[50], label: "Fictional stale page label", version: 6 }];
  state.holdUnitPages = true;
  await page.goto(setupPath(preferredId));
  await expect(picker(page)).toHaveValue(preferredId);
  await expect(picker(page).getByRole("option", { name: "Fictional current verified label", exact: true })).toHaveCount(1);
  fixtureData.releaseUnits();
  await expect(picker(page).locator("option")).toHaveCount(51);
  await expect(picker(page).getByRole("option", { name: "Fictional stale page label", exact: true })).toHaveCount(0);
  await expect(picker(page).getByRole("option", { name: "Fictional current verified label", exact: true })).toHaveCount(1);
  await terms(page); await activeDraft(page).getByRole("button", { name: "Review lease", exact: true }).click();
  await expect(dialog(page).locator(".lease-review-summary")).toContainText("Fictional current verified label");
  expect(state.posts).toHaveLength(0);
});

test("a newer archived page row prevents delayed older active metadata from initializing the untouched hint", async ({ page }) => {
  const fixtureData = await fixture(page), state = fixtureData.state;
  state.holdMetadata = true; state.metadata = { ...units[50], status: "active", version: 7 };
  state.pageSnapshot = [...units.slice(0, 49), { ...units[50], label: "Fictional newly archived unit", status: "archived", version: 8 }];
  await page.goto(setupPath(preferredId)); await expect(picker(page)).toHaveValue("");
  fixtureData.release();
  await expect(activeDraft(page).getByText("Checking suggested unit…", { exact: true })).toHaveCount(0);
  await expect(picker(page)).toHaveValue("");
  await expect(picker(page).locator(`option[value="${preferredId}"]`)).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
});

test("late metadata never replaces a manually chosen unit or moves focus from edited terms", async ({ page }) => {
  const fixtureData = await fixture(page), state = fixtureData.state; state.holdMetadata = true;
  await page.goto(setupPath(preferredId));
  await expect(picker(page)).toHaveValue("");
  await expect(activeDraft(page).getByText("Checking suggested unit…", { exact: true })).toBeVisible();
  await picker(page).selectOption("home-unit-002"); await terms(page, "1500.00");
  const rent = activeDraft(page).getByLabel("New lease monthly rent (USD)", { exact: true }); await rent.focus();
  fixtureData.release();
  await expect(activeDraft(page).getByText("Checking suggested unit…", { exact: true })).toHaveCount(0);
  await expect(picker(page)).toHaveValue("home-unit-002"); await expect(rent).toHaveValue("1500.00"); await expect(rent).toBeFocused();
});

for (const edit of ["rent", "tenant"] as const) test(`late metadata does not initialize a unit after a manual ${edit} edit`, async ({ page }) => {
  const fixtureData = await fixture(page); fixtureData.state.holdMetadata = true;
  await page.goto(setupPath(preferredId)); await expect(picker(page)).toHaveValue("");
  if (edit === "rent") await activeDraft(page).getByLabel("New lease monthly rent (USD)", { exact: true }).fill("1777.00");
  else await activeDraft(page).getByRole("combobox", { name: "Primary resident", exact: true }).selectOption("resident-two");
  fixtureData.release();
  await expect(activeDraft(page).getByText("Checking suggested unit…", { exact: true })).toHaveCount(0);
  await expect(picker(page)).toHaveValue("");
  if (edit === "rent") await expect(activeDraft(page).getByLabel("New lease monthly rent (USD)", { exact: true })).toHaveValue("1777.00");
  else await expect(activeDraft(page).getByRole("combobox", { name: "Primary resident", exact: true })).toHaveValue("resident-two");
});

test("an existing review keeps its manually selected unit when exact metadata arrives later", async ({ page }) => {
  const fixtureData = await fixture(page); fixtureData.state.holdMetadata = true;
  await page.goto(setupPath(preferredId)); await picker(page).selectOption("home-unit-002"); await terms(page);
  await activeDraft(page).getByRole("button", { name: "Review lease", exact: true }).click();
  await expect(dialog(page).locator(".lease-review-summary")).toContainText("Fictional Home Unit 002");
  fixtureData.release();
  await expect(dialog(page).locator(".lease-review-summary")).toContainText("Fictional Home Unit 002");
  await dialog(page).getByRole("button", { name: "Back to lease details", exact: true }).click();
  await expect(picker(page)).toHaveValue("home-unit-002"); expect(fixtureData.state.posts).toHaveLength(0);
});

test("property switching preserves both manual drafts and prevents hidden-property initialization", async ({ page }) => {
  const fixtureData = await fixture(page); fixtureData.state.holdMetadata = true;
  await page.goto(setupPath(preferredId)); await picker(page).selectOption("home-unit-002"); await terms(page, "1800.00");
  await dialog(page).getByRole("combobox", { name: "Property for new lease", exact: true }).selectOption(garden);
  await expect(picker(page)).toHaveValue(""); await picker(page).selectOption("garden-unit-1"); await terms(page, "1900.00");
  fixtureData.release(); await expect(picker(page)).toHaveValue("garden-unit-1");
  await dialog(page).getByRole("combobox", { name: "Property for new lease", exact: true }).selectOption(home);
  await expect(picker(page)).toHaveValue("home-unit-002");
  await expect(activeDraft(page).getByLabel("New lease monthly rent (USD)", { exact: true })).toHaveValue("1800.00");
});

test("an untouched original property can initialize once when activated after a late metadata response", async ({ page }) => {
  const fixtureData = await fixture(page); fixtureData.state.holdMetadata = true;
  await page.goto(setupPath(preferredId)); await expect(picker(page)).toHaveValue("");
  await dialog(page).getByRole("combobox", { name: "Property for new lease", exact: true }).selectOption(garden);
  fixtureData.release(); await expect(picker(page)).toHaveValue("");
  await expect(activeDraft(page).getByText("Suggested unit is unavailable for this property. Choose an active unit.", { exact: true })).toBeVisible();
  await expect(dialog(page).locator('.lease-property-draft[hidden] select[name="unitId"]')).toHaveValue("");
  await dialog(page).getByRole("combobox", { name: "Property for new lease", exact: true }).selectOption(home);
  await expect(picker(page)).toHaveValue(preferredId);
});

test("a same-property URL hint change cannot reinitialize an already chosen intake", async ({ page }) => {
  await fixture(page); await page.goto(setupPath(preferredId)); await expect(picker(page)).toHaveValue(preferredId); await terms(page, "1666.00");
  await page.evaluate(() => { const url = new URL(location.href); url.searchParams.set("unitId", "home-unit-003"); history.pushState({ ...history.state, idx: (history.state?.idx || 0) + 1 }, "", url); window.dispatchEvent(new PopStateEvent("popstate", { state: history.state })); });
  await expect(page).toHaveURL(url => url.searchParams.get("unitId") === "home-unit-003");
  await expect(picker(page)).toHaveValue(preferredId);
  await expect(activeDraft(page).getByLabel("New lease monthly rent (USD)", { exact: true })).toHaveValue("1666.00");
});

test("a saved-response-loss journal dominates a different URL hint and recovers the identical reviewed payload and key", async ({ page }) => {
  const fixtureData = await fixture(page), state = fixtureData.state;
  await page.goto(setupPath(preferredId)); await expect(picker(page)).toHaveValue(preferredId); await picker(page).selectOption("home-unit-002"); await terms(page, "1444.00");
  await activeDraft(page).getByRole("button", { name: "Review lease", exact: true }).click(); state.loseResponse = true;
  await dialog(page).getByRole("button", { name: "Create lease record", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toBeVisible(); expect(state.records).toHaveLength(1);
  state.emptyUnits = true; state.metadataStatus = 404;
  await page.goto(setupPath("home-unit-003"));
  await expect(dialog(page).locator(".lease-review-summary")).toContainText("Fictional Home Unit 002");
  await page.screenshot({ path: "/tmp/propertyflow-preferred-unit-recovered-review-desktop.png", fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/propertyflow-preferred-unit-recovered-review-mobile.png", fullPage: false });
  await dialog(page).getByRole("button", { name: "Create lease record", exact: true }).click();
  await expect(dialog(page)).toHaveCount(0); expect(state.posts).toHaveLength(2); expect(state.posts[0]).toEqual(state.posts[1]);
  expect(state.posts[0].unitId).toBe("home-unit-002"); expect(state.posts[0].monthlyRent).toBe("1444.00"); expect(state.records).toHaveLength(1);
  await expect(page).toHaveURL(url => url.pathname === "/company/leases/hint-saved-lease" && url.searchParams.get("prospectId") === markers.prospectId && url.searchParams.get("onboarding") === "move-in");
});

test("a company refresh clears the earlier candidate and ignores its late metadata response", async ({ page }) => {
  const fixtureData = await fixture(page), state = fixtureData.state; state.holdMetadata = true;
  await page.goto(setupPath(preferredId)); await expect(picker(page)).toHaveValue("");
  state.company = "other-company"; state.membershipVersion++;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  fixtureData.release();
  await expect(dialog(page).getByRole("option", { name: "Other company home", exact: true })).toHaveCount(1);
  await expect(dialog(page).getByRole("option", { name: "Fictional Home Unit 051", exact: true })).toHaveCount(0);
  await expect(picker(page)).toHaveCount(0); expect(state.posts).toHaveLength(0);
});
