import { test, expect, BrowserContext } from "@playwright/test";

async function fixture(context: BrowserContext, resident = false) {
  const document = { id: "share-doc", title: "Fictional rental guide", version: 2, archivedAt: null };
  const versions = [{ id: "share-v2", number: 2, filename: "pending.txt", scanStatus: "pending", byteLength: 17, createdAt: "2026-10-24T12:00:00Z" }, { id: "share-v1", number: 1, filename: "guide.txt", scanStatus: "clean", byteLength: 17, createdAt: "2026-10-23T12:00:00Z" }];
  const recipient = { id: "share-resident", name: "Fictional resident", email: "resident@test.invalid" };
  const state = { grants: [] as any[], revokes: [] as any[], share: null as any, loseGrant: true, revoked: false, downloads: 0 };
  await context.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({ user: { id: resident ? recipient.id : "owner", name: resident ? recipient.name : "Fictional owner", email: resident ? recipient.email : "owner@test.invalid", emailVerified: true, status: "active", platformRole: null }, membership: { companyId: "a", role: resident ? "resident" : "owner", version: 1, status: "active", company: { id: "a", name: "Fictional company", status: "active" } }, permissions: resident ? ["resident.self"] : ["property.read", "lease.manage", "company.manage"], csrfToken: "fixture", destination: resident ? "/resident/documents" : "/company/leases/share-lease", impersonation: null });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/telemetry") return json({ accepted: true });
    if (path === "/api/company/leases/share-lease") return json({ id: "share-lease", propertyId: "home", unitId: "unit", residentId: recipient.id, startsOn: "2026-01-01", endsOn: "2099-12-31", status: "active", version: 1, rentCents: 100000, rentDueDay: 1, graceDays: 0, property: { name: "Fictional property" }, unit: { label: "Fictional apartment" }, resident: recipient, renewals: [], overview: { householdCount: 1 } });
    if (path === "/api/company/leases/share-lease/documents") return json({ items: [{ ...document, versions }], scanningConfigured: false });
    if (path.endsWith("/shares/share-grant/revoke")) { state.revokes.push(request.postDataJSON()); state.share = { ...state.share, version: 2, status: "revoked", revokedAt: "2026-10-24T13:00:00Z" }; return json({ share: state.share }); }
    if (path.endsWith("/shares")) {
      if (method === "POST") {
        const body = request.postDataJSON(); state.grants.push(body);
        state.share = { id: "share-grant", documentVersionId: body.documentVersionId, userId: body.userId, version: 1, expiresOn: body.expiresOn, reason: body.reason, revokedAt: null, createdAt: "2026-10-24T12:30:00Z", recipient, versionNumber: 1, filename: "guide.txt", status: "active" };
        if (state.loseGrant) { state.loseGrant = false; return route.abort("failed"); }
        return json({ share: state.share });
      }
      return json({ document, today: "2026-10-24", versions, eligibleResidents: [recipient], items: state.share ? [state.share] : [], total: state.share ? 1 : 0, nextCursor: null });
    }
    if (path === "/api/resident/documents") return json({ items: state.revoked ? [] : [{ id: "share-grant", title: document.title, versionNumber: 1, filename: "guide.txt", mediaType: "text/plain", byteLength: 17, expiresOn: "2099-12-31", lease: { id: "share-lease", property: { name: "Fictional property" }, unit: { label: "Fictional apartment" } } }], total: state.revoked ? 0 : 1, nextCursor: null });
    if (path === "/api/resident/documents/share-grant/download") { state.downloads++; return state.revoked ? json({ error: "Shared document not found." }, 404) : json({ filename: "guide.txt", mediaType: "text/plain", contentBase64: Buffer.from("Fictional original").toString("base64") }); }
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
  await expect(page.getByText("Shared", { exact: true })).toBeVisible();
  expect(state.grants).toHaveLength(2); expect(state.grants[0]).toEqual(state.grants[1]);
  expect(state.grants[0]).toMatchObject({ documentVersionId: "share-v1", userId: "share-resident", expectedVersion: null, expectedDocumentVersion: 2 });
  await page.getByRole("button", { name: "Revoke access", exact: true }).click();
  const revoke = page.getByRole("dialog", { name: "Revoke document access", exact: true });
  await revoke.getByLabel("Reason for revocation", { exact: true }).fill("Fictional corrected access review");
  await revoke.getByRole("button", { name: "Confirm revocation", exact: true }).click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible(); expect(state.revokes).toHaveLength(1);
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
