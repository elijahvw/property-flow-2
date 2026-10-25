import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, { stage = "inquiry", allowed = true } = {}) {
  const property = { id: "fictional-property", name: "Fictional property" }, unit = { id: "fictional-unit", label: "Fictional apartment" };
  const original = { id: "fictional-prospect", companyId: "fictional-company", propertyId: property.id, unitId: unit.id, name: "Fictional Avery", email: "avery@test.invalid", phone: null, source: "email", desiredMoveIn: "2026-11-01", followUpOn: "2026-10-24", notes: "Fictional inquiry notes", stage, version: 1, contactId: null, leaseId: null, createdAt: "2026-10-24T10:00:00Z", updatedAt: "2026-10-24T10:00:00Z", property, unit };
  const prospects: any[] = [original], history: any[] = [], writes: { path: string; body: any }[] = [], reads: URL[] = [];
  const contacts = [{ id: "fictional-contact", name: "Fictional Avery Account", email: "avery@test.invalid", version: 7 }, { id: "fictional-other-contact", name: "Fictional Another Account", email: "other@test.invalid", version: 3 }];
  const leases = [{ id: "fictional-lease", version: 4, propertyId: property.id, unitId: unit.id, startsOn: "2026-11-01", endsOn: "2027-10-31", status: "draft", unit }];
  const committed = new Map<string, unknown>();
  let loseConversion = false, forceStale = false;
  const append = (row: any, action: string, reason: string) => history.unshift({ id: `action-${history.length + 1}`, version: row.version, action, reason, snapshot: { ...row }, actorId: "fictional-manager", createdAt: row.updatedAt });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status });
    reads.push(url);
    if (path === "/api/bootstrap") return json({ user: { id: "fictional-manager", name: "Fictional manager", email: "manager@test.invalid", status: "active", emailVerified: true, platformRole: null }, membership: { companyId: "fictional-company", role: allowed ? "manager" : "staff", version: 1, status: "active", company: { id: "fictional-company", name: "Fictional company", status: "active" } }, permissions: allowed ? ["property.read", "property.write", "lease.manage"] : ["property.read"], destination: "/company/prospects", csrfToken: "fixture" });
    if (path === "/api/account/guide") return json({ eligible: false });
    if (path === "/api/company/properties") return json([property]);
    if (path === `/api/company/properties/${property.id}/units`) return json({ items: [{ ...unit, status: "active" }], nextCursor: null });
    if (path.endsWith("/conversion-options")) return json({ contacts: contacts.filter(contact => !url.searchParams.get("q") || `${contact.name} ${contact.email}`.toLowerCase().includes(url.searchParams.get("q")!.toLowerCase())), nextCursor: null, leases: url.searchParams.get("contactId") === contacts[0].id ? leases : [], nextLeaseCursor: null });
    if (path.endsWith("/history")) return json({ items: history, nextCursor: null });
    if (path === "/api/company/prospects" && request.method() === "GET") {
      const matching = prospects.filter(row => (!url.searchParams.get("propertyId") || row.propertyId === url.searchParams.get("propertyId")) && (!url.searchParams.get("q") || `${row.name} ${row.email || ""}`.toLowerCase().includes(url.searchParams.get("q")!.toLowerCase())) && (!url.searchParams.get("due") || !["declined", "withdrawn", "converted"].includes(row.stage)));
      const items = matching.filter(row => !url.searchParams.get("stage") || row.stage === url.searchParams.get("stage"));
      return json({ items, total: items.length, counts: Object.fromEntries(["inquiry", "tour", "application", "review", "approved", "declined", "withdrawn", "converted"].map(value => [value, matching.filter(row => row.stage === value).length])), nextCursor: null, today: "2026-10-24", timezone: "America/New_York" });
    }
    if (path.endsWith("/acquisition") && request.method() === "GET") { const row = prospects.find(row => row.id === path.split("/")[4]); return row ? json({ companyId: row.companyId, prospect: { ...row, status: ["declined", "withdrawn", "converted"].includes(row.stage) ? "closed" : "open" }, followUps: [], applications: [], history: [], followUpTotal: 0, applicationTotal: 0, historyTotal: 0 }) : json({ error: "Prospect not found." }, 404); }
    if ((path.endsWith("/follow-ups") || path.endsWith("/acquisition-history")) && request.method() === "GET") return json({ items: [], total: 0, page: Number(url.searchParams.get("page") || 1), pageSize: 25 });
    if (path.startsWith("/api/company/prospects/") && request.method() === "GET") {
      const row = prospects.find(row => row.id === path.split("/").at(-1));
      return row ? json({ prospect: row, history: { items: history.filter(action => action.snapshot.id === row.id), nextCursor: null } }) : json({ error: "Prospect not found." }, 404);
    }
    if (["POST", "PATCH"].includes(request.method()) && path.startsWith("/api/company/prospects")) {
      expect(request.headers()["x-csrf-token"]).toBe("fixture");
      const body = request.postDataJSON(); writes.push({ path, body });
      if (committed.has(body.submissionKey)) return json(committed.get(body.submissionKey));
      if (path === "/api/company/prospects") {
        const row = { ...original, ...body, id: "fictional-new-prospect", version: 1, stage: "inquiry", contactId: null, leaseId: null, property, unit: body.unitId ? unit : null };
        prospects.push(row); append(row, "created", body.reason); const response = { prospect: row }; committed.set(body.submissionKey, response); return json(response);
      }
      const row = prospects.find(row => row.id === path.split("/")[4]);
      if (!row) return json({ error: "Prospect not found." }, 404);
      if (forceStale && request.method() === "PATCH") { forceStale = false; row.version++; row.notes = "Fictional concurrent manager edit"; append(row, "updated", "Fictional separate review"); }
      if (body.expectedVersion !== row.version) return json({ error: "This prospect changed. Discard the review and reopen it.", code: "RECORD_CHANGED" }, 409);
      row.version++; row.updatedAt = "2026-10-24T12:00:00Z";
      if (path.endsWith("/reopen-conversion")) { row.stage = "review"; row.contactId = null; row.leaseId = null; append(row, "conversion_corrected", body.reason); }
      else if (path.endsWith("/convert")) { row.stage = "converted"; row.contactId = body.contactId; row.leaseId = body.leaseId; append(row, "converted", body.reason); }
      else if (path.endsWith("/stage")) { row.stage = body.stage; append(row, "stage", body.reason); }
      else { Object.assign(row, body); row.unit = body.unitId ? unit : null; append(row, "updated", body.reason); }
      const response = { prospect: { ...row } }; committed.set(body.submissionKey, response);
      if (loseConversion && path.endsWith("/convert")) { loseConversion = false; return route.abort("failed"); }
      return json(response);
    }
    return json([]);
  });
  return { prospects, history, writes, reads, contacts, leases, loseConversion: () => { loseConversion = true; }, stale: () => { forceStale = true; } };
}

test("manual inquiry progresses through reviewed stages while filters and explicit drafts retain context", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/prospects?propertyId=fictional-property&due=today");
  await expect(page.getByText("1 matching prospect", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Record inquiry", exact: true }).first().click();
  let dialog = page.getByRole("dialog", { name: "Record prospect inquiry", exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill("Fictional Morgan");
  await dialog.getByLabel("Email (email or phone required)", { exact: true }).fill("morgan@test.invalid");
  await dialog.getByLabel("Next follow-up (optional)", { exact: true }).fill("2026-10-24");
  await dialog.getByLabel("Management notes (optional)", { exact: true }).fill("Fictional tour discussion");
  await dialog.getByLabel("Reason for recording this inquiry", { exact: true }).fill("Record the fictional phone inquiry");
  await dialog.getByRole("button", { name: "Save as draft", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Continue inquiry draft", exact: true }).click();
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Fictional Morgan");
  await dialog.getByRole("button", { name: "Record inquiry", exact: true }).click();
  await expect(page).toHaveURL(/prospectId=fictional-new-prospect/);
  await expect(page.getByRole("heading", { name: "Fictional Morgan", exact: true })).toBeVisible();
  for (const stage of ["tour", "application", "review", "approved"]) {
    await page.getByRole("button", { name: "Review stage", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Review prospect stage", exact: true });
    await dialog.getByRole("combobox", { name: "New stage", exact: true }).selectOption(stage);
    await dialog.getByLabel("Decision or stage-change reason", { exact: true }).fill(`Fictional management review: ${stage}`);
    await dialog.getByRole("button", { name: "Save reviewed stage", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Review tenant & lease link", exact: true })).toBeVisible();
  await expect(page.getByText("Fictional management review: approved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "← Prospect list", exact: true }).click();
  await expect(page).toHaveURL(/propertyId=fictional-property&due=today$/);
  expect(state.writes.filter(write => write.path.endsWith("/stage"))).toHaveLength(4);
  expect(state.writes[0].body.unitId).toBe(null);
});

test("conversion requires reviewed existing sources, retries exact payload and corrects only the prospect link", async ({ page }) => {
  const state = await fixture(page, { stage: "approved" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/prospects?prospectId=fictional-prospect");
  await page.getByRole("button", { name: "Review tenant & lease link", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review tenant and lease handoff", exact: true });
  await expect(dialog.getByRole("combobox", { name: "Tenant account", exact: true })).toHaveValue("");
  await dialog.getByRole("combobox", { name: "Tenant account", exact: true }).selectOption("fictional-contact");
  await expect(dialog.getByRole("combobox", { name: "Existing lease", exact: true }).getByRole("option", { name: /Fictional apartment/ })).toHaveCount(1);
  await dialog.getByRole("combobox", { name: "Existing lease", exact: true }).selectOption("fictional-lease");
  await dialog.getByLabel("Reason for linking these existing records", { exact: true }).fill("Fictional reviewed exact-person and primary-lease match");
  await dialog.getByRole("button", { name: "Confirm tenant & lease link", exact: true }).click();
  expect(state.writes).toHaveLength(0);
  await dialog.getByRole("checkbox", { name: /I reviewed the sources and confirm/ }).check();
  state.loseConversion();
  await dialog.getByRole("button", { name: "Confirm tenant & lease link", exact: true }).click();
  await expect(dialog.getByText("This request may already be saved.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm tenant & lease link", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const conversionWrites = state.writes.filter(write => write.path.endsWith("/convert"));
  expect(conversionWrites).toHaveLength(2);
  expect(conversionWrites[0].body).toEqual(conversionWrites[1].body);
  expect(conversionWrites[0].body).toMatchObject({ expectedVersion: 1, expectedContactVersion: 7, expectedLeaseVersion: 4, confirmedMatch: true });
  await expect(page.getByRole("button", { name: "Edit prospect details", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open linked lease", exact: true })).toHaveAttribute("href", "/company/leases/fictional-lease?prospectId=fictional-prospect");
  await page.getByRole("button", { name: "Correct conversion link", exact: true }).click();
  const correction = page.getByRole("dialog", { name: "Correct prospect conversion link", exact: true });
  await correction.getByRole("checkbox", { name: /only the prospect link is being corrected/ }).check();
  await correction.getByLabel("Reason for correcting the conversion link", { exact: true }).fill("Fictional wrong-source correction");
  await correction.getByRole("button", { name: "Confirm conversion link correction", exact: true }).click();
  await expect(correction).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Review stage", exact: true })).toBeVisible();
  expect(state.prospects[0]).toMatchObject({ stage: "review", contactId: null, leaseId: null });
  expect(state.contacts[0].version).toBe(7); expect(state.leases[0].version).toBe(4);
  expect(state.writes.every(write => write.path.startsWith("/api/company/prospects"))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("stale prospect edits preserve their opening data until explicitly discarded and reopened", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/prospects?prospectId=fictional-prospect");
  await page.getByRole("button", { name: "Edit prospect details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit prospect details", exact: true });
  await dialog.getByRole("textbox", { name: "Management notes (optional)", exact: true }).fill("Fictional retained draft");
  await dialog.getByLabel("Reason for this update", { exact: true }).fill("Fictional follow-up correction");
  state.stale();
  await dialog.getByRole("button", { name: "Save prospect details", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("prospect changed");
  await expect(dialog.getByRole("textbox", { name: "Management notes (optional)", exact: true })).toHaveValue("Fictional retained draft");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.getByRole("button", { name: "Close without saving", exact: true }).click();
  await expect(page.getByText("Fictional concurrent manager edit", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit prospect details", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Management notes (optional)", exact: true })).toHaveValue("Fictional concurrent manager edit");
  await dialog.getByLabel("Reason for this update", { exact: true }).fill("Fictional fresh-source confirmation");
  await dialog.getByRole("button", { name: "Save prospect details", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.writes[0].body.expectedVersion).toBe(1);
  expect(state.writes[1].body.expectedVersion).toBe(2);
  expect(state.writes[0].body.submissionKey).not.toBe(state.writes[1].body.submissionKey);
});

test("company staff cannot open management prospect records", async ({ page }) => {
  const state = await fixture(page, { allowed: false });
  await page.goto("/company/prospects?prospectId=fictional-prospect");
  await expect(page.getByText("Your account does not currently have access to this page.", { exact: true })).toBeVisible();
  expect(state.reads.some(url => url.pathname.startsWith("/api/company/prospects"))).toBe(false);
});
