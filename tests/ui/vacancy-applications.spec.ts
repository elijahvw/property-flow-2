import { test, expect, type Page } from "@playwright/test";

test.describe.configure({ timeout: 60000 });

type Row = Record<string, any>;
async function fixture(page: Page, role = "owner") {
  const property = { id: "home", name: "Maple House", address: "12 Maple Street" };
  const unit = { id: "unit-a", label: "Apartment A" };
  const prospect: Row = { id: "inquiry-one", propertyId: property.id, unitId: unit.id, name: "Jordan Applicant", email: "jordan@test.invalid", phone: "555-0101", desiredMoveIn: "2027-02-01", notes: "Interested in a February move.", status: "open", version: 1, createdAt: "2026-10-22T12:00:00Z", updatedAt: "2026-10-22T12:00:00Z", property, unit };
  const vacancy = { unitId: unit.id, unitLabel: unit.label, propertyId: property.id, propertyName: property.name, unitStatus: "active", operationalStatus: "unreviewed", availableOn: null, notes: "", version: 0, occupancy: "vacant", currentLease: null, nextLease: null };
  const state = { prospects: [prospect], applications: [] as Row[], followups: [] as Row[], events: [] as Row[], writes: [] as { path: string; body: Row }[], replay: new Map<string, any>(), loseConversion: false, conversionFailure: false, reads: [] as string[] };
  const decorate = (row: Row) => ({ ...row, property, unit, prospect: { id: row.prospectId, name: state.prospects.find(item => item.id === row.prospectId)?.name, email: state.prospects.find(item => item.id === row.prospectId)?.email } });
  const event = (entityId: string, action: string, version: number, reason?: string) => state.events.unshift({ id: `event-${state.events.length}`, entityId, action, actorName: "Fixture Owner", version, createdAt: "2026-10-22T13:00:00Z", reason: reason || null });
  const list = (items: any[], query: URLSearchParams) => { const current = Number(query.get("page")) || 1; return { items: items.slice((current - 1) * 25, current * 25), total: items.length, page: current, pageSize: 25 }; };
  await page.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, query = url.searchParams;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({ user: { id: role, name: "Fixture Owner", email: `${role}@test.invalid`, status: "active", emailVerified: true }, membership: { companyId: "a", role, status: "active", version: 1, company: { id: "a", name: "Fictional Leasing Company", status: "active" } }, permissions: ["property.read", ...(["owner", "manager"].includes(role) ? ["lease.manage", "resident.assignment.manage", "property.write"] : role === "resident" ? ["resident.self"] : [])], csrfToken: "fixture", destination: "/company/applications" });
    if (req.method() === "GET") state.reads.push(path + url.search);
    if (path === "/api/company/properties") return json([property]);
    if (path === "/api/company/vacancies") return json({ ...list([vacancy], query), businessDate: "2026-10-22", summary: { vacant: 1, occupied: 0, future: 0, unreviewed: 1, available: 0, turnover: 0, unavailable: 0 } });
    if (path === "/api/company/prospects") {
      if (req.method() === "GET") return json(list(state.prospects.filter(item => (!query.get("status") || query.get("status") === "all" || item.status === query.get("status")) && (!query.get("q") || `${item.name} ${item.email}`.toLowerCase().includes(query.get("q")!.toLowerCase()))), query));
      const body = req.postDataJSON(); state.writes.push({ path, body });
      if (state.replay.has(body.submissionKey)) return json(state.replay.get(body.submissionKey));
      const row = { ...prospect, ...body, id: `inquiry-${state.prospects.length + 1}`, status: "open", version: 1 }; delete row.submissionKey;
      state.prospects.push(row); state.replay.set(body.submissionKey, row); event(row.id, "created", 1); return json(row);
    }
    const prospectMatch = path.match(/^\/api\/company\/prospects\/([^/]+)(?:\/(history|follow-ups)(?:\/([^/]+))?)?$/);
    if (prospectMatch) {
      const [, id, sub, followupId] = prospectMatch, row = state.prospects.find(item => item.id === id);
      if (!row) return json({ error: "Inquiry not found." }, 404);
      if (sub === "history") return json(list(state.events.filter(item => item.entityId === id), query));
      if (sub === "follow-ups") {
        if (req.method() === "GET") return json(list(state.followups.filter(item => item.prospectId === id && (!query.get("status") || query.get("status") === "all" || item.status === query.get("status"))), query));
        const body = req.postDataJSON(); state.writes.push({ path, body });
        if (state.replay.has(body.submissionKey)) return json(state.replay.get(body.submissionKey));
        let followup = followupId ? state.followups.find(item => item.id === followupId) : null;
        if (followup) { if (followup.version !== body.expectedVersion) return json({ error: "This follow-up changed." }, 409); Object.assign(followup, body, { version: followup.version + 1 }); }
        else { followup = { ...body, id: `tour-${state.followups.length + 1}`, prospectId: id, status: "open", version: 1 }; state.followups.push(followup); }
        state.replay.set(body.submissionKey, followup); event(id, followupId ? "edited" : "created", followup.version); return json(followup);
      }
      if (req.method() === "PATCH") { const body = req.postDataJSON(); state.writes.push({ path, body }); if (body.expectedVersion !== row.version) return json({ error: "This inquiry changed." }, 409); Object.assign(row, body, { version: row.version + 1 }); event(id, "edited", row.version); return json(row); }
      const applications = state.applications.filter(item => item.prospectId === id).map(decorate), followUps = state.followups.filter(item => item.prospectId === id), history = state.events.filter(item => item.entityId === id);
      return json({ prospect: row, followUps, followUpTotal: followUps.length, applications, applicationTotal: applications.length, history, historyTotal: history.length });
    }
    if (path === "/api/company/applications") {
      if (req.method() === "GET") return json(list(state.applications.filter(item => (!query.get("status") || item.status === query.get("status")) && (!query.get("prospectId") || item.prospectId === query.get("prospectId"))).map(decorate), query));
      const body = req.postDataJSON(); state.writes.push({ path, body });
      if (state.replay.has(body.submissionKey)) return json(state.replay.get(body.submissionKey));
      const row = { id: `application-${state.applications.length + 1}`, propertyId: property.id, ...body, status: "draft", version: 1, contactId: null, leaseId: null, createdAt: "2026-10-22T12:00:00Z", updatedAt: "2026-10-22T12:00:00Z" }; delete row.submissionKey;
      state.applications.push(row); event(row.id, "created", 1); state.replay.set(body.submissionKey, decorate(row)); return json(decorate(row));
    }
    const applicationMatch = path.match(/^\/api\/company\/applications\/([^/]+)(?:\/(actions|convert|conversion-candidates|history))?$/);
    if (applicationMatch) {
      const [, id, sub] = applicationMatch, row = state.applications.find(item => item.id === id);
      if (!row) return json({ error: "Application not found." }, 404);
      if (sub === "history") return json(list(state.events.filter(item => item.entityId === id), query));
      if (sub === "conversion-candidates") return json(list([{ id: "tenant-existing", name: "Jordan Applicant", email: prospect.email, userId: "existing-account", version: 7, status: "active" }], query));
      if (req.method() === "GET") return json({ application: decorate(row), prospect: state.prospects.find(item => item.id === row.prospectId), history: state.events.filter(item => item.entityId === id), historyTotal: state.events.filter(item => item.entityId === id).length });
      const body = req.postDataJSON(); state.writes.push({ path, body });
      if (state.replay.has(body.submissionKey)) return json(state.replay.get(body.submissionKey));
      if (body.expectedVersion !== row.version) return json({ error: "This application changed. Refresh and review it again." }, 409);
      if (sub === "actions") { const next: Record<string, string> = { submit: "submitted", review: "in_review", approve: "approved", reject: "rejected", withdraw: "withdrawn", reopen: row.status === "withdrawn" ? "draft" : "in_review" }; row.status = next[body.action]; row.version++; event(id, body.action, row.version, body.reason); state.replay.set(body.submissionKey, decorate(row)); return json(decorate(row)); }
      if (sub === "convert") {
        if (state.conversionFailure) return json({ error: "Account preparation is unavailable. Try again after sign-in services are configured." }, 503);
        row.contactId = body.contactId || "tenant-prepared"; row.leaseId = "lease-prepared"; row.version++; event(id, "converted", row.version);
        const result = { application: decorate(row), contactId: row.contactId, leaseId: row.leaseId, leaseHref: "/company/leases/lease-prepared?onboarding=household", contactHref: `/company/tenants/${row.contactId}` }; state.replay.set(body.submissionKey, result);
        if (state.loseConversion) { state.loseConversion = false; return route.abort("failed"); }
        return json(result);
      }
      Object.assign(row, { notes: body.notes, version: row.version + 1 }); event(id, "edited", row.version); return json(decorate(row));
    }
    return json([]);
  });
  return state;
}
function seedApplication(state: Awaited<ReturnType<typeof fixture>>, status = "draft") {
  const row = { id: "application-seeded", propertyId: "home", unitId: "unit-a", prospectId: "inquiry-one", notes: "Ready for review.", status, version: 1, contactId: null, leaseId: null, createdAt: "2026-10-22T12:00:00Z", updatedAt: "2026-10-22T12:00:00Z" }; state.applications.push(row); return row;
}
async function decision(page: Page, name: string, reason: string) {
  await page.getByRole("button", { name, exact: true }).click();
  const dialog = page.getByRole("dialog", { name, exact: true });
  await dialog.getByLabel("Reason for this action").fill(reason);
  await dialog.getByRole("button", { name, exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
}

test("recorded inquiry connects a tour and its completed follow-up without creating an account", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/applications/prospects/new?propertyId=home&unitId=unit-a");
  await page.getByLabel("Full name", { exact: true }).fill("Morgan Inquiry");
  await page.getByLabel("Email address", { exact: true }).fill("morgan@test.invalid");
  await page.getByRole("button", { name: "Review inquiry", exact: true }).click();
  await page.getByRole("button", { name: "Save inquiry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Morgan Inquiry", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add follow-up", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Add follow-up", exact: true });
  await dialog.getByLabel("Title", { exact: true }).fill("Walk through Apartment A");
  await dialog.getByLabel("Follow-up date", { exact: true }).fill("2026-11-01");
  await dialog.getByRole("button", { name: "Add follow-up", exact: true }).click();
  await expect(page.getByText("Walk through Apartment A", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Update follow-up", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Update follow-up", exact: true });
  await dialog.getByRole("combobox", { name: "Status", exact: true }).selectOption("completed");
  await dialog.getByRole("button", { name: "Save follow-up", exact: true }).click();
  await expect(page.getByText(/Tour · November 1, 2026 · Completed/)).toBeVisible();
  expect(state.writes.some(item => /account|tenant|lease/.test(item.path))).toBe(false);
  expect(state.writes[0].body).toMatchObject({ propertyId: "home", unitId: "unit-a", name: "Morgan Inquiry" });
  expect(state.writes[0].body).not.toHaveProperty("status");
});

test("application moves through review and recovers one linked lease conversion after a lost response", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/applications/new?prospectId=inquiry-one&unitId=unit-a");
  await page.getByRole("button", { name: "Review application", exact: true }).click();
  await page.getByRole("button", { name: "Save application draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Jordan Applicant", exact: true })).toBeVisible();
  await decision(page, "Submit application", "Applicant confirmed their details.");
  await decision(page, "Start review", "Management review has started.");
  await decision(page, "Approve application", "Approved after management review.");
  await page.getByRole("link", { name: "Prepare lease draft", exact: true }).click();
  await page.getByLabel("Monthly rent (USD)", { exact: true }).fill("1450.00");
  await page.getByLabel("Rent due day", { exact: true }).fill("31");
  await page.getByRole("radio", { name: "Choose an existing tenant profile", exact: true }).check();
  await page.getByRole("button", { name: /Jordan Applicant.*jordan@test.invalid/ }).click();
  await page.getByRole("button", { name: "Review lease preparation", exact: true }).click();
  await page.getByRole("checkbox", { name: /I reviewed the applicant/ }).check();
  state.loseConversion = true;
  await page.getByRole("button", { name: "Prepare linked lease draft", exact: true }).click();
  await expect(page.getByText("This request may already be saved. Retry with the original details before starting another record.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Prepare linked lease draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lease draft prepared", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open lease draft", exact: true })).toHaveAttribute("href", "/company/leases/lease-prepared?onboarding=household");
  await expect(page.getByRole("link", { name: "Open tenant record", exact: true })).toHaveAttribute("href", "/company/tenants/tenant-existing");
  const conversions = state.writes.filter(item => item.path.endsWith("/convert"));
  expect(conversions).toHaveLength(2);
  expect(conversions[0].body).toEqual(conversions[1].body);
  expect(conversions[0].body).toMatchObject({ expectedVersion: 4, contactId: "tenant-existing", expectedContactVersion: 7, monthlyRent: "1450.00", rentDueDay: 31 });
  expect(state.applications).toHaveLength(1);
  expect(state.events.filter(item => item.action === "converted")).toHaveLength(1);
});

test("declined and withdrawn applications retain decisions and offer the correct reopening step", async ({ page }) => {
  const state = await fixture(page), application = seedApplication(state, "in_review");
  await page.goto(`/company/applications/${application.id}`);
  await decision(page, "Decline application", "The proposed dates do not match this unit.");
  await expect(page.getByRole("link", { name: "Prepare lease draft", exact: true })).toHaveCount(0);
  await decision(page, "Reopen application", "Applicant supplied revised dates.");
  await decision(page, "Withdraw application", "Applicant chose a different property.");
  await decision(page, "Reopen application", "Applicant asked to start again.");
  await expect(page.getByRole("button", { name: "Submit application", exact: true })).toBeVisible();
  expect(application.status).toBe("draft");
  expect(application.version).toBe(5);
});

for (const role of ["staff", "resident"]) test(`${role} cannot enter management availability or application workflows`, async ({ page }) => {
  const state = await fixture(page, role);
  await page.goto("/company/applications/new");
  await expect(page.getByRole("heading", { name: "Access unavailable", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Applications", exact: true })).toHaveCount(0);
  await page.goto("/company/vacancies");
  await expect(page.getByRole("heading", { name: "Access unavailable", exact: true })).toBeVisible();
  expect(state.reads.some(path => /\/api\/company\/(applications|prospects|vacancies)/.test(path))).toBe(false);
});

test("inquiry forms and source-linked application details fit a narrow screen", async ({ page }) => {
  const state = await fixture(page), application = seedApplication(state, "approved");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/company/applications/${application.id}`);
  await expect(page.getByRole("heading", { name: "Jordan Applicant", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/propertyflow-application-mobile.png", fullPage: true });
  await page.getByRole("link", { name: "Prepare lease draft", exact: true }).click();
  await expect(page.getByLabel("Monthly rent (USD)", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
