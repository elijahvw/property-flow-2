import { test, expect, Page } from "@playwright/test";

type Message = { id: string; content: string; visibility: string; authorType: "team" | "requester"; author: string; createdAt: string };
async function fixture(page: Page, resident = true, readOnly = false) {
  const state = {
    replyPosts: [] as any[], status: "resolved", loseReplyResponse: false, failReply: false, denied: false,
    companyId: "fictional-company", requestVersion: 2, readOnly, support: false,
    denyReply: false, abortReplyBeforeSave: false, replyCompanies: [] as (string | undefined)[],
    messages: [
      { id: "team-private", content: "Fictional internal vendor estimate; never resident-visible.", visibility: "internal", authorType: "team", author: "Fictional manager", createdAt: "2026-10-24T12:00:00Z" },
      { id: "team-shared", content: "The fictional tap repair is complete. Please let us know if there is still a leak.", visibility: "resident", authorType: "team", author: "Fictional manager", createdAt: "2026-10-24T13:00:00Z" },
    ] as Message[],
  };
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({
      user: { id: resident ? "fictional-requester" : "fictional-manager", name: resident ? "Fictional requester" : "Fictional manager", email: "fictional@test.invalid", emailVerified: true, status: "active", platformRole: null },
      membership: { companyId: state.companyId, version: 1, role: resident ? "resident" : "manager", status: "active", company: { id: state.companyId, name: "Fictional Property Company", status: "active" } },
      permissions: resident ? ["resident.self"] : ["property.read", "maintenance.manage"],
      csrfToken: "fixture", destination: resident ? "/resident/maintenance" : "/company/maintenance",
      companyFeatures: { maintenance: state.readOnly ? "read_only" : "enabled", resident_portal: "enabled", properties: "enabled", documents: "disabled", finances: "disabled" },
      ...(state.support ? { impersonation: { contextId: "fictional-read-only-support", actor: { id: "fictional-support", name: "Fictional Support", email: "support@test.invalid" }, expiresAt: "2099-10-25T00:00:00Z", readOnly: true } } : {}),
    });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/telemetry") return json({ accepted: true });
    if (path.endsWith("/properties")) return json([{ id: "fictional-property", name: "Fictional Garden House" }]);
    if (path.endsWith("/updates")) {
      if (request.method() === "POST") {
        const payload = request.postDataJSON();
        expect(request.headers()["x-csrf-token"]).toBe("fixture");
        state.replyPosts.push(payload);
        state.replyCompanies.push(request.headers()["x-company-id"]);
        if (state.denyReply) return json({ code: "ACCESS_DENIED", error: "Request reply access is no longer available." }, 403);
        if (state.denied || state.companyId !== "fictional-company") return json({ error: "Request access is no longer available." }, 404);
        if (state.abortReplyBeforeSave) { state.abortReplyBeforeSave = false; return route.abort("failed"); }
        if (state.failReply) return json({ error: "The reply could not be saved. Try again." }, 503);
        let saved = state.messages.find(message => message.id === payload.submissionKey);
        if (!saved) { saved = { id: payload.submissionKey, content: payload.content, visibility: "resident", authorType: "requester", author: "Fictional requester", createdAt: "2026-10-24T14:00:00Z" }; state.messages.unshift(saved); }
        if (state.loseReplyResponse) { state.loseReplyResponse = false; return json({ error: "The saved reply response was interrupted. Retry the original details." }, 503); }
        return json({ id: saved.id, content: saved.content, visibility: "resident", author: "You", createdAt: saved.createdAt });
      }
      if (state.denied || state.companyId !== "fictional-company") return json({ error: "Request access is no longer available." }, 404);
      return json({ items: state.messages.filter(message => !resident || message.visibility === "resident").map(message => resident ? { id: message.id, content: message.content, visibility: message.visibility, author: message.authorType === "requester" ? "You" : "Property team", createdAt: message.createdAt } : message), nextCursor: null });
    }
    if (path === "/api/resident/maintenance/directory") return json({
      companyId:state.companyId,items:[{id:"fictional-request",propertyId:"fictional-property",unitId:null,unit:null,title:"Fictional kitchen tap repair",category:"plumbing",priority:"normal",status:state.status,targetOn:null,createdAt:"2026-10-23T12:00:00Z",property:{name:"Fictional Garden House"}}],
      total:1,statusCounts:{open:0,in_progress:0,resolved:1},pageSize:50,nextCursor:null,previousCursor:null,
    });
    if (/\/maintenance\/[^/]+$/.test(path)) {
      if (state.denied || state.companyId !== "fictional-company") return json({ error: "Request access is no longer available." }, 404);
      return json({ id: "fictional-request", propertyId: "fictional-property", unitId: null, unit: null, title: "Fictional kitchen tap repair", description: "The fictional kitchen tap has been repaired; use this isolated request to verify the conversation.", category: "plumbing", priority: "normal", status: state.status, version: state.requestVersion, targetOn: null, createdAt: "2026-10-23T12:00:00Z", updatedAt: "2026-10-24T13:00:00Z", property: { name: "Fictional Garden House" }, recordedBy: "Fictional requester", residentUpdatesAvailable: true, historyLimited: false, activity: [{ id: "created", action: "maintenance.created", createdAt: "2026-10-23T12:00:00Z" }, { id: "resolved", action: "maintenance.status.changed", from: "open", to: "resolved", createdAt: "2026-10-24T13:00:00Z" }] });
    }
    if (path.endsWith("/preventive")) return json(null);
    if (path.endsWith("/vendor")) return json({ vendor: null, history: { items: [], nextCursor: null } });
    if (path.endsWith("/documents")) return json({ items: [], scanningConfigured: false });
    if (/\/work-orders\//.test(path)) return json({ request: { id: "fictional-request", executionStatus: "unassigned", assigneeId: null }, history: { items: [], nextCursor: null }, assignees: [] });
    return json([]);
  });
  return state;
}

test("requester reply preserves an interrupted submission, stays resident-visible and does not reopen a resolved request", async ({ page }) => {
  const state = await fixture(page); state.loseReplyResponse = true;
  await page.goto("/resident/maintenance/fictional-request");
  const conversation = page.getByRole("region", { name: "Request conversation" });
  await expect(conversation.getByRole("heading", { name: "Updates and replies" })).toBeVisible();
  await expect(conversation).toContainText("it does not reopen the request");
  await expect(page.getByText("Fictional internal vendor estimate; never resident-visible.")).toHaveCount(0);
  await conversation.getByRole("button", { name: "Add reply", exact: true }).focus();
  await page.keyboard.press("Enter");
  let dialog = page.getByRole("dialog", { name: "Reply to your maintenance request", exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await expect(dialog.getByLabel("Update audience")).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "Reply text", exact: true }).fill("There is still a small fictional drip when the tap is off.");
  await dialog.getByRole("button", { name: "Post reply", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("response was interrupted");
  await expect(dialog.getByRole("alert")).toBeFocused();
  await expect(dialog.getByRole("textbox", { name: "Reply text" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Clear draft", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Close & keep recovery", exact: true }).click();
  await conversation.getByRole("button", { name: "Add reply", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Reply to your maintenance request", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Reply text" })).toHaveValue("There is still a small fictional drip when the tap is off.");
  await dialog.getByRole("button", { name: "Post reply", exact: true }).click();
  await expect(conversation.getByText("Reply recorded.", { exact: true })).toBeVisible();
  await expect(conversation.getByRole("button", { name: "Add reply", exact: true })).toBeFocused();
  expect(state.replyPosts).toHaveLength(2);
  expect(state.replyPosts[0]).toEqual(state.replyPosts[1]);
  expect(Object.keys(state.replyPosts[0]).sort()).toEqual(["content", "submissionKey"]);
  expect(state.messages.filter(message => message.content === state.replyPosts[0].content)).toHaveLength(1);
  expect(state.status).toBe("resolved");
  await expect(conversation.getByText("You", { exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/propertyflow-maintenance-replies-desktop.png", fullPage: true });
});

test("phone conversation shows own replies, retains failed input and clears inaccessible request details", async ({ page }) => {
  const state = await fixture(page);
  state.messages.unshift({ id: "own-reply", content: "Fictional requester update: the tap still drips overnight.", visibility: "resident", authorType: "requester", author: "Fictional requester", createdAt: "2026-10-24T14:00:00Z" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/resident/maintenance/fictional-request");
  const conversation = page.getByRole("region", { name: "Request conversation" });
  await expect(conversation.getByText("Your reply", { exact: true })).toBeVisible();
  await conversation.getByRole("button", { name: "Add reply", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Reply to your maintenance request", exact: true });
  await dialog.getByRole("textbox", { name: "Reply text" }).fill("Fictional extra location details to keep after failure.");
  state.failReply = true;
  await dialog.getByRole("button", { name: "Post reply", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("could not be saved");
  await expect(dialog.getByRole("textbox", { name: "Reply text" })).toHaveValue("Fictional extra location details to keep after failure.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/propertyflow-maintenance-replies-mobile.png", fullPage: true });
  const skipBounds = await page.getByRole("link", { name: "Skip to content", exact: true }).boundingBox();
  expect(skipBounds).not.toBeNull();
  expect(skipBounds!.y + skipBounds!.height).toBeLessThanOrEqual(0);
  expect(await dialog.evaluate(node => node.matches(":modal") && node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: "/tmp/propertyflow-maintenance-replies-mobile-viewport.png", fullPage: false });
  state.denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Maintenance request access unavailable", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Reply text" })).toHaveCount(0);
  await expect(page.getByText("Fictional requester update: the tap still drips overnight.")).toHaveCount(0);
});

test("management identifies requester replies without changing private-note defaults; read-only residents cannot compose", async ({ page }) => {
  const state = await fixture(page, false);
  state.messages.unshift({ id: "resident-reply", content: "Fictional requester says the repair needs another look.", visibility: "resident", authorType: "requester", author: "Fictional requester", createdAt: "2026-10-24T14:00:00Z" });
  await page.goto("/company/maintenance/fictional-request");
  await expect(page.getByText("Requester reply", { exact: true })).toBeVisible();
  await expect(page.getByText("Internal note", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add update", exact: true }).click();
  await expect(page.getByLabel("Update audience")).toHaveValue("internal");
  await expect(page.getByRole("dialog").getByText(/can create an in-app notification/)).toBeVisible();
  await page.screenshot({ path: "/tmp/propertyflow-maintenance-replies-manager.png", fullPage: true });
  await page.unroute("**/api/**");
  await fixture(page, true, true);
  await page.goto("/resident/maintenance/fictional-request");
  await expect(page.getByRole("button", { name: "Add reply", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Update request", exact: true })).toHaveCount(0);
});

test('an unsent requester reply protects browser navigation without posting its text',async({page})=>{
 const state=await fixture(page);
 await page.goto('/help');
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'My requests',exact:true}).click();
 await page.getByRole('link',{name:'Fictional kitchen tap repair',exact:true}).click();
 await page.getByRole('button',{name:'Add reply',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Reply to your maintenance request',exact:true});
 await dialog.getByRole('textbox',{name:'Reply text',exact:true}).fill('Unsent private fictional follow-up');
 page.once('dialog',confirmation=>{expect(confirmation.type()).toBe('confirm');expect(confirmation.message()).toContain('discard its unsaved changes');return confirmation.dismiss();});
 await page.goBack();
 await expect(page).toHaveURL(/resident\/maintenance\/fictional-request$/);
 await expect(dialog.getByRole('textbox',{name:'Reply text',exact:true})).toHaveValue('Unsent private fictional follow-up');
 expect(state.replyPosts).toHaveLength(0);
 page.once('dialog',confirmation=>confirmation.accept());
 await page.goBack();
 await expect(page).toHaveURL(/resident\/maintenance$/);expect(state.replyPosts).toHaveLength(0);
});

const replyJournal = (page: Page) => page.evaluate(() => sessionStorage.getItem('pf-maintenance-reply:fictional-requester:fictional-company:/api/resident/maintenance/fictional-request'));
const acceptReload = async (page: Page) => { page.once('dialog', confirmation => confirmation.accept()); await page.reload(); };

for (const first of ['detail', 'updates'] as const) test(`the first ${first} denial hides the entire private request while the other read is held`, async ({ page }) => {
  const state = await fixture(page); await page.goto('/resident/maintenance/fictional-request');
  await page.getByRole('button', { name: 'Add reply', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reply to your maintenance request', exact: true });
  const privateText = 'Original private reply retained across either denied-read order';
  await dialog.getByRole('textbox', { name: 'Reply text', exact: true }).fill(privateText);
  state.abortReplyBeforeSave = true; await dialog.getByRole('button', { name: 'Post reply', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible(); const originalJournal = await replyJournal(page); expect(originalJournal).not.toBeNull();
  const detailPath = '/api/resident/maintenance/fictional-request', firstPath = first === 'detail' ? detailPath : `${detailPath}/updates`;
  let release!: () => void, started!: () => void, held = false, released = false;
  const heldResponse = new Promise<void>(resolve => { release = () => { released = true; resolve(); }; });
  const heldStarted = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/resident/maintenance/fictional-request**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'GET' && state.denied && [detailPath, `${detailPath}/updates`].includes(path)) {
      if (path === firstPath) await heldStarted;
      else { held = true; started(); await heldResponse; }
    }
    return route.fallback();
  });
  state.denied = true;
  try {
    const firstDenied = page.waitForResponse(response => new URL(response.url()).pathname === firstPath && response.status() === 404);
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await firstDenied;
    await expect(page.getByRole('heading', { name: 'Maintenance request access unavailable', exact: true })).toBeVisible();
    await expect(page.getByText('Private request details and the reply review are hidden. Any original interrupted reply is kept for authorized recovery.', { exact: true })).toBeVisible();
    expect(held).toBe(true); expect(released).toBe(false);
    await expect(page.getByRole('textbox', { name: 'Reply text', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Request conversation' })).toHaveCount(0);
    await expect(page.getByText('The fictional kitchen tap has been repaired; use this isolated request to verify the conversation.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('The fictional tap repair is complete. Please let us know if there is still a leak.', { exact: true })).toHaveCount(0);
    await expect(page.getByText(privateText, { exact: true })).toHaveCount(0);
    expect(await replyJournal(page)).toBe(originalJournal); expect(state.replyPosts).toHaveLength(1);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

for (const width of [1440, 390]) test(`attempted requester reply reloads with its original text, company and key at ${width}px`, async ({ page }) => {
  const state = await fixture(page); await page.setViewportSize({ width, height: 900 }); await page.goto('/resident/maintenance/fictional-request');
  await page.getByRole('button', { name: 'Add reply', exact: true }).click(); let dialog = page.getByRole('dialog', { name: 'Reply to your maintenance request', exact: true });
  const originalText = 'Original fictional reply before the interrupted response.'; await dialog.getByRole('textbox', { name: 'Reply text', exact: true }).fill(originalText);
  expect(await replyJournal(page)).toBeNull(); state.loseReplyResponse = true; await dialog.getByRole('button', { name: 'Post reply', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('response was interrupted');
  const retained = await replyJournal(page); expect(retained).not.toBeNull(); const original = state.replyPosts[0]; state.requestVersion = 3; state.status = 'in_progress'; await acceptReload(page);
  dialog = page.getByRole('dialog', { name: 'Reply to your maintenance request', exact: true }); await expect(dialog.getByRole('textbox', { name: 'Reply text', exact: true })).toHaveValue(originalText); await expect(dialog.getByRole('textbox', { name: 'Reply text', exact: true })).toBeDisabled(); await expect(dialog).toContainText('request version 2'); expect(await replyJournal(page)).toBe(retained);
  await dialog.getByRole('button', { name: 'Post reply', exact: true }).click(); await expect(dialog).not.toBeVisible(); expect(state.replyPosts).toHaveLength(2); expect(state.replyPosts[1]).toEqual(original); expect(Object.keys(original).sort()).toEqual(['content', 'submissionKey']); expect(state.replyCompanies).toEqual(['fictional-company', 'fictional-company']); expect(state.messages.filter(message => message.content === originalText)).toHaveLength(1); expect(state.status).toBe('in_progress'); expect(await replyJournal(page)).toBeNull(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('an unknown requester reply remains exact through read-only recovery and authoritative write denial', async ({ page }) => {
  const state = await fixture(page); await page.goto('/resident/maintenance/fictional-request'); await page.getByRole('button', { name: 'Add reply', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Reply to your maintenance request', exact: true }); await dialog.getByRole('textbox', { name: 'Reply text', exact: true }).fill('Private original reply kept after a lost request'); state.abortReplyBeforeSave = true;
  await dialog.getByRole('button', { name: 'Post reply', exact: true }).click(); await expect(dialog.getByRole('alert')).toBeVisible(); const retained = await replyJournal(page); expect(retained).not.toBeNull(); state.readOnly = true; await acceptReload(page);
  dialog = page.getByRole('dialog', { name: 'Reply to your maintenance request', exact: true }); await expect(dialog.getByRole('button', { name: 'Post reply', exact: true })).toBeDisabled(); expect(await replyJournal(page)).toBe(retained); expect(state.replyPosts).toHaveLength(1);
  state.readOnly = false; await acceptReload(page); dialog = page.getByRole('dialog', { name: 'Reply to your maintenance request', exact: true }); state.denyReply = true; await dialog.getByRole('button', { name: 'Post reply', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Maintenance request access unavailable', exact: true })).toBeVisible(); await expect(page.getByRole('textbox', { name: 'Reply text', exact: true })).toHaveCount(0); await expect(page.getByText('The fictional kitchen tap has been repaired; use this isolated request to verify the conversation.', { exact: true })).toHaveCount(0); expect(await replyJournal(page)).toBe(retained); expect(state.messages.filter(message => message.authorType === 'requester')).toHaveLength(0);
  state.denyReply = false; await page.reload(); dialog = page.getByRole('dialog', { name: 'Reply to your maintenance request', exact: true }); await dialog.getByRole('button', { name: 'Post reply', exact: true }).click(); await expect(dialog).not.toBeVisible(); expect(state.replyPosts).toHaveLength(3); expect(state.replyPosts.every(body => JSON.stringify(body) === JSON.stringify(state.replyPosts[0]))).toBe(true); expect(state.messages.filter(message => message.authorType === 'requester')).toHaveLength(1); expect(await replyJournal(page)).toBeNull();
});

test('a different company or request cannot reveal or resubmit an original requester reply', async ({ page }) => {
  const state = await fixture(page); await page.goto('/resident/maintenance/fictional-request'); await page.getByRole('button', { name: 'Add reply', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Reply to your maintenance request', exact: true }); const privateText = 'Original company private attempted reply'; await dialog.getByRole('textbox', { name: 'Reply text', exact: true }).fill(privateText); state.abortReplyBeforeSave = true; await dialog.getByRole('button', { name: 'Post reply', exact: true }).click(); await expect(dialog.getByRole('alert')).toBeVisible(); const retained = await replyJournal(page);
  state.companyId = 'fictional-other-company'; await acceptReload(page); await expect(page.getByRole('textbox', { name: 'Reply text', exact: true })).toHaveCount(0); await expect(page.getByText(privateText, { exact: true })).toHaveCount(0); expect(await replyJournal(page)).toBe(retained); expect(state.replyPosts).toHaveLength(1);
  state.companyId = 'fictional-company'; await page.goto('/resident/maintenance/another-fictional-request'); await expect(page.getByRole('dialog', { name: 'Reply to your maintenance request', exact: true })).toHaveCount(0); await expect(page.getByText(privateText, { exact: true })).toHaveCount(0); expect(state.replyPosts).toHaveLength(1);
  await page.goto('/resident/maintenance/fictional-request'); dialog = page.getByRole('dialog', { name: 'Reply to your maintenance request', exact: true }); await expect(dialog.getByRole('textbox', { name: 'Reply text', exact: true })).toHaveValue(privateText); await dialog.getByRole('button', { name: 'Post reply', exact: true }).click(); await expect(dialog).not.toBeVisible(); expect(state.replyPosts[1]).toEqual(state.replyPosts[0]); expect(state.replyCompanies).toEqual(['fictional-company', 'fictional-company']); expect(await replyJournal(page)).toBeNull();
});

test('support viewing cannot post a recovered requester reply', async ({ page }) => {
  const state = await fixture(page); state.support = true;
  await page.addInitScript(() => sessionStorage.setItem('pf-maintenance-reply:fictional-requester:fictional-company:/api/resident/maintenance/fictional-request', JSON.stringify({ companyId: 'fictional-company', endpoint: '/api/resident/maintenance/fictional-request', propertyId: 'fictional-property', sourceVersion: 2, content: 'Private normal-session attempted reply', submissionKey: 'b45c794d-7351-49fd-a43c-656db767d984' })));
  await page.goto('/resident/maintenance/fictional-request'); await expect(page.getByRole('button', { name: 'Add reply', exact: true })).toBeDisabled(); await expect(page.getByRole('dialog', { name: 'Reply to your maintenance request', exact: true })).toHaveCount(0); await expect(page.getByText('Private normal-session attempted reply', { exact: true })).toHaveCount(0); expect(state.replyPosts).toHaveLength(0); expect(await replyJournal(page)).toContain('Private normal-session attempted reply');
});
