import { test, expect, BrowserContext } from "@playwright/test";

async function fixture(context: BrowserContext, resident = false) {
  const document = { id: "share-doc", title: "Fictional rental guide", version: 2, archivedAt: null };
  const versions = [{ id: "share-v2", number: 2, filename: "pending.txt", scanStatus: "pending", byteLength: 17, createdAt: "2026-10-24T12:00:00Z" }, { id: "share-v1", number: 1, filename: "guide.txt", scanStatus: "clean", byteLength: 17, createdAt: "2026-10-23T12:00:00Z" }];
  const recipient = { id: "share-resident", name: "Fictional resident", email: "resident@test.invalid" };
  const state = { grants: [] as any[], revokes: [] as any[], share: null as any, loseGrant: true, revoked: false, downloads: 0, receipts: [] as any[], receiptVersion: 1, receivedAt: null as string | null, loseReceipt: false, receiptFailure: "", readFailure: "", company: "a", documentsMode: "enabled", impersonating: false, additional: [] as any[] };
  const received = new Map<string, { body: unknown; receipt: { id: string; recordedAt: string } }>();
  const originals = () => [{ id: "share-grant", title: document.title, versionNumber: 1, filename: "guide.txt", mediaType: "text/plain", byteLength: 17, expiresOn: "2099-12-31", version: state.receiptVersion, receivedAt: state.receivedAt, sharedAt: "2026-10-24T12:00:00Z", lease: { id: "share-lease", property: { name: "Fictional property" }, unit: { label: "Fictional apartment" } } }, ...state.additional];
  await context.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({ user: { id: resident ? recipient.id : "owner", name: resident ? recipient.name : "Fictional owner", email: resident ? recipient.email : "owner@test.invalid", emailVerified: true, status: "active", platformRole: null }, membership: { companyId: state.company, role: resident ? "resident" : "owner", version: 1, status: "active", company: { id: state.company, name: "Fictional company", status: "active" } }, permissions: resident ? ["resident.self"] : ["property.read", "lease.manage", "company.manage"], companyFeatures: { properties: "enabled", leasing: "enabled", maintenance: "enabled", finances: "enabled", reports: "enabled", agreements: "enabled", inspections: "enabled", notifications: "enabled", resident_portal: "enabled", documents: state.documentsMode }, csrfToken: "fixture", destination: resident ? "/resident/documents" : "/company/leases/share-lease", impersonation: state.impersonating ? { actor: { id: "support-actor", email: "support@test.invalid" }, expiresAt: "2099-12-31T23:59:59Z", readOnly: true, contextId: "share-resident:2099-12-31T23:59:59Z" } : null });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/telemetry") return json({ accepted: true });
    if (path === "/api/company/leases/share-lease") return json({ id: "share-lease", propertyId: "home", unitId: "unit", residentId: recipient.id, startsOn: "2026-01-01", endsOn: "2099-12-31", status: "active", version: 1, rentCents: 100000, rentDueDay: 1, graceDays: 0, property: { name: "Fictional property" }, unit: { label: "Fictional apartment" }, resident: recipient, renewals: [], overview: { householdCount: 1 } });
    if (path === "/api/company/leases/share-lease/documents") return json({ items: [{ ...document, versions }], scanningConfigured: false });
    if (path.endsWith("/shares/share-grant/revoke")) { state.revokes.push(request.postDataJSON()); state.share = { ...state.share, version: 2, status: "revoked", revokedAt: "2026-10-24T13:00:00Z" }; return json({ share: state.share }); }
    if (path.endsWith("/shares")) {
      if (method === "POST") {
        const body = request.postDataJSON(); state.grants.push(body);
        state.share = { id: "share-grant", documentVersionId: body.documentVersionId, userId: body.userId, version: 1, expiresOn: body.expiresOn, reason: body.reason, revokedAt: null, receivedAt: null, createdAt: "2026-10-24T12:30:00Z", recipient, versionNumber: 1, filename: "guide.txt", status: "active" };
        if (state.loseGrant) { state.loseGrant = false; return route.abort("failed"); }
        return json({ share: state.share });
      }
      return json({ document, today: "2026-10-24", versions, eligibleResidents: [recipient], items: state.share ? [state.share] : [], total: state.share ? 1 : 0, nextCursor: null });
    }
    if (path === "/api/resident/documents") {
      if (state.readFailure) return json({ error: "Shared-document access is unavailable.", code: state.readFailure }, 403);
      const url = new URL(request.url()), search = (url.searchParams.get("q") || "").trim().toLowerCase(), cursor = url.searchParams.get("cursor");
      const all = state.revoked || state.company !== "a" ? [] : originals().filter(row => [row.title, row.lease.property.name, row.lease.unit.label].some(value => value.toLowerCase().includes(search))).sort((a, b) => b.id.localeCompare(a.id));
      const rows = all.filter(row => !cursor || row.id < cursor);
      return json({ companyId: state.company, items: rows.slice(0, 50), total: all.length, nextCursor: rows.length > 50 ? rows[49].id : null });
    }
    if (path === "/api/resident/documents/share-grant/download") { state.downloads++; return state.revoked ? json({ error: "Shared document not found." }, 404) : json({ filename: "guide.txt", mediaType: "text/plain", contentBase64: Buffer.from("Fictional original").toString("base64") }); }
    if (path === "/api/resident/documents/share-grant") return state.readFailure ? json({ error: "Shared-document access is unavailable.", code: state.readFailure }, 403) : state.revoked ? json({ error: "Shared document not found." }, 404) : json({ companyId: state.company, document: originals()[0] });
    if (path === "/api/resident/documents/share-grant/received") {
      const body = request.postDataJSON(); state.receipts.push({ body, company: request.headers()["x-company-id"] });
      if (state.receiptFailure) return json({ error: "Current access does not permit this confirmation.", code: state.receiptFailure }, 403);
      if (state.revoked) return json({ error: "Shared document not found." }, 404);
      const previous = received.get(body.submissionKey);
      if (previous) {
        expect(body).toEqual(previous.body);
        return json({ id: "share-grant", version: state.receiptVersion, receivedAt: state.receivedAt, receipt: previous.receipt });
      }
      if (body.expectedVersion !== state.receiptVersion) return json({ error: "This record changed. Review its current status.", code: "RECORD_CHANGED" }, 409);
      state.receivedAt = "2026-10-24T14:00:00Z"; state.receiptVersion++;
      const receipt = { id: "receipt-once", recordedAt: state.receivedAt }; received.set(body.submissionKey, { body, receipt });
      if (state.loseReceipt) { state.loseReceipt = false; return route.abort("failed"); }
      return json({ id: "share-grant", version: state.receiptVersion, receivedAt: state.receivedAt, receipt });
    }
    return json([]);
  });
  return state;
}

test("owner reviews an exact original and leaseholder; interrupted sharing retries without changing the review", async ({ page, context }) => {
  const state = await fixture(context);
  await page.goto("/company/leases/share-lease?section=documents");
  await page.getByText("Leaseholder sharing & access history", { exact: true }).click();
  await page.getByRole("button", { name: "Share a cleared version", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share a lease document", exact: true });
  await dialog.getByRole("combobox", { name: "Cleared document version", exact: true }).selectOption("share-v1");
  await dialog.getByRole("combobox", { name: "Approved leaseholder", exact: true }).selectOption("share-resident");
  await expect(dialog.getByRole("option", { name: /pending.txt/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Review selected access", exact: true }).click();
  await expect(dialog.getByText("Version 1 · guide.txt", { exact: true })).toBeVisible();
  await dialog.getByLabel("Access through (company calendar date)", { exact: true }).fill("2099-12-31");
  await dialog.getByLabel("Sharing reason", { exact: true }).fill("Fictional leaseholder welcome guide review");
  await dialog.getByRole("button", { name: "Confirm document sharing", exact: true }).click();
  await expect(dialog.getByText("This request may already be saved.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm document sharing", exact: true }).click();
  const grantRow = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Fictional resident resident@test.invalid", exact: true }) });
  await expect(grantRow.getByRole("cell", { name: "Version 1 · guide.txt", exact: true })).toBeVisible();
  await expect(grantRow.getByRole("cell", { name: "Shared Receipt not confirmed for this grant", exact: true })).toBeVisible();
  expect(state.grants).toHaveLength(2); expect(state.grants[0]).toEqual(state.grants[1]);
  expect(state.grants[0]).toMatchObject({ documentVersionId: "share-v1", userId: "share-resident", expectedVersion: null, expectedDocumentVersion: 2 });
  await page.getByRole("button", { name: "Revoke access", exact: true }).click();
  const revoke = page.getByRole("dialog", { name: "Revoke document access", exact: true });
  await revoke.getByLabel("Reason for revocation", { exact: true }).fill("Fictional corrected access review");
  await revoke.getByRole("button", { name: "Confirm revocation", exact: true }).click();
  await expect(grantRow.getByRole("cell", { name: "Revoked Receipt not confirmed for this grant", exact: true })).toBeVisible(); expect(state.revokes).toHaveLength(1);
});

test("resident downloads the explicitly shared version and revoked access disappears on refresh", async ({ page, context }) => {
  const state = await fixture(context, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/resident/documents");
  await expect(page.getByRole("heading", { name: "Shared documents", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fictional rental guide", exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download version 1", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("guide.txt"); expect(state.downloads).toBe(1);
  state.revoked = true; await page.reload();
  await expect(page.getByRole("heading", { name: "No shared documents available", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download version 1", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

const receiptJournal = (page: import("@playwright/test").Page) => page.evaluate(() => {
  const key = Object.keys(sessionStorage).find(value => value.startsWith("pf:document-receipt:"));
  return key ? sessionStorage.getItem(key) : null;
});
async function openReceipt(page: import("@playwright/test").Page, recovering = false) {
  await page.getByRole("button", { name: recovering ? "Retry original confirmation" : "Confirm received", exact: true }).click();
  return page.getByRole("dialog", { name: "Confirm document receipt", exact: true });
}

test("an interrupted receipt survives reload with exact company, version and retry key on mobile", async ({ page, context }) => {
  const state = await fixture(context, true); state.loseReceipt = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/resident/documents");
  let dialog = await openReceipt(page);
  await expect(dialog.getByText(/does not sign, approve or change your lease/)).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm received", exact: true }).click();
  await expect(dialog.getByText("This request may already be saved.", { exact: false }).first()).toBeVisible();
  const original = await receiptJournal(page); expect(original).not.toBeNull();
  expect(JSON.parse(original!)).toMatchObject({ shareId: "share-grant", expectedVersion: 1, companyId: "a" });
  expect(original).not.toMatch(/Fictional|guide.txt|filename|title/);
  await page.screenshot({ path: "/tmp/propertyflow-document-receipt-recovery-mobile.png", fullPage: false });
  await dialog.getByRole("button", { name: "Close & keep recovery", exact: true }).click();
  await page.reload();
  dialog = await openReceipt(page, true);
  await dialog.getByRole("button", { name: "Retry original confirmation", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.receipts).toHaveLength(2); expect(state.receipts[1]).toEqual(state.receipts[0]); expect(state.receipts[0].company).toBe("a");
  expect(state.receiptVersion).toBe(2); expect(await receiptJournal(page)).toBeNull();
  await expect(page.getByText("Receipt confirmed for this access grant. This is not a signature.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm received", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("an earlier exact receipt replay does not confirm a later owner review of the same original", async ({ page, context }) => {
  const state = await fixture(context, true); state.loseReceipt = true;
  await page.goto("/resident/documents");
  let dialog = await openReceipt(page);
  await dialog.getByRole("button", { name: "Confirm received", exact: true }).click();
  await expect(dialog.getByText("This request may already be saved.", { exact: false }).first()).toBeVisible();
  const original = await receiptJournal(page);
  await dialog.getByRole("button", { name: "Close & keep recovery", exact: true }).click();
  state.receiptVersion++; state.receivedAt = null;
  await page.reload(); dialog = await openReceipt(page, true);
  await dialog.getByRole("button", { name: "Retry original confirmation", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Your earlier receipt was recorded. The current owner-reviewed access grant has not been confirmed.", { exact: true })).toBeVisible();
  expect(state.receipts[1]).toEqual(state.receipts[0]); expect(state.receivedAt).toBeNull(); expect(state.receiptVersion).toBe(3); expect(await receiptJournal(page)).toBeNull();
  dialog = await openReceipt(page);
  await dialog.getByRole("button", { name: "Confirm received", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.receipts[2].body.expectedVersion).toBe(3); expect(state.receipts[2].body.submissionKey).not.toBe(JSON.parse(original!).submissionKey); expect(state.receiptVersion).toBe(4);
});

test("pending receipts stay readable under write-only denial and hide immediately after authoritative access denial", async ({ page, context }) => {
  const state = await fixture(context, true); state.loseReceipt = true;
  await page.goto("/resident/documents");
  let dialog = await openReceipt(page);
  await dialog.getByRole("button", { name: "Confirm received", exact: true }).click();
  await expect(dialog.getByText("This request may already be saved.", { exact: false }).first()).toBeVisible();
  const original = await receiptJournal(page);
  state.documentsMode = "read_only"; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("button", { name: "Review interrupted confirmation", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Confirm document receipt", exact: true });
  await expect(dialog.getByRole("button", { name: "Retry original confirmation", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Check current receipt status", exact: true })).toBeEnabled(); expect(await receiptJournal(page)).toBe(original);
  state.documentsMode = "enabled"; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  dialog = await openReceipt(page, true);
  state.receiptFailure = "SUBSCRIPTION_READ_ONLY";
  await dialog.getByRole("button", { name: "Retry original confirmation", exact: true }).click();
  await expect(dialog).toBeVisible(); await expect(dialog.getByText("Fictional rental guide", { exact: true })).toBeVisible(); expect(await receiptJournal(page)).toBe(original);
  state.receiptFailure = "ACCESS_DENIED"; state.readFailure = "ACCESS_DENIED";
  await dialog.getByRole("button", { name: "Retry original confirmation", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.getByRole("heading", { name: "Fictional rental guide", exact: true })).toHaveCount(0); expect(await receiptJournal(page)).toBe(original);
  state.receiptFailure = ""; state.readFailure = "";
  await page.reload();
  const recovered = await openReceipt(page, true);
  await recovered.getByRole("button", { name: "Retry original confirmation", exact: true }).click();
  await expect(recovered).not.toBeVisible(); expect(state.receiptVersion).toBe(2); expect(state.receipts.every(entry => entry.company === "a")).toBe(true); expect(state.receipts.every(entry => JSON.stringify(entry.body) === JSON.stringify(state.receipts[0].body))).toBe(true);
});

test("current-status review stops only the local uncertain retry without another receipt write", async ({ page, context }) => {
  const state = await fixture(context, true); state.loseReceipt = true;
  await page.goto("/resident/documents");
  const dialog = await openReceipt(page);
  await dialog.getByRole("button", { name: "Confirm received", exact: true }).click();
  await expect(dialog.getByText("This request may already be saved.", { exact: false }).first()).toBeVisible();
  await dialog.getByRole("button", { name: "Check current receipt status", exact: true }).click();
  await expect(dialog.getByText(/Current receipt confirmed/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Use current receipt status", exact: true })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "I reviewed the current status. Stop retrying my earlier confirmation and keep the saved record as it is.", exact: true }).check();
  await dialog.getByRole("button", { name: "Use current receipt status", exact: true }).click();
  await expect(dialog).not.toBeVisible(); expect(state.receipts).toHaveLength(1); expect(await receiptJournal(page)).toBeNull();
  await expect(page.getByText("Current status kept. This cleared only the local interrupted confirmation; receipt history was not changed.", { exact: true })).toBeVisible();
});

test("shared-document search covers later pages, preserves its URL and does not bypass read-only or support controls", async ({ page, context }) => {
  const state = await fixture(context, true);
  for (let index = 0; index < 55; index++) state.additional.push({ id: `z-${String(index).padStart(3, "0")}`, title: `Other shared guide ${index}`, versionNumber: 1, filename: "other.txt", mediaType: "text/plain", byteLength: 10, expiresOn: "2099-12-31", version: 1, receivedAt: null, sharedAt: "2026-10-24T12:00:00Z", lease: { id: "share-lease", property: { name: "Other property" }, unit: { label: "Other apartment" } } });
  await page.goto("/resident/documents");
  await expect(page.getByText("56 shared originals currently available", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fictional rental guide", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Next documents", exact: true }).click();
  await expect(page).toHaveURL(/cursor=/);
  await page.getByRole("searchbox", { name: "Search shared documents", exact: true }).fill("Fictional rental guide");
  await expect(page.getByRole("heading", { name: "Fictional rental guide", exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/cursor=/); await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search shared documents", exact: true })).toHaveValue("Fictional rental guide");
  state.documentsMode = "read_only"; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Confirm received", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download version 1", exact: true })).toBeEnabled(); expect(state.receipts).toHaveLength(0);
  state.documentsMode = "enabled"; state.company = "b"; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Fictional rental guide", exact: true })).toHaveCount(0); expect(state.receipts).toHaveLength(0);
});

test("support can inspect a shared original without confirming receipt", async ({ page, context }) => {
  const state = await fixture(context, true); state.impersonating = true;
  await page.goto("/resident/documents");
  await expect(page.getByRole("heading", { name: "Fictional rental guide", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm received", exact: true })).toBeDisabled(); await expect(page.getByRole("button", { name: "Download version 1", exact: true })).toBeEnabled(); expect(state.receipts).toHaveLength(0);
});
