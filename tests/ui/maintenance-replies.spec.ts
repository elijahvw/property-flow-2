import { test, expect, Page } from "@playwright/test";

type Message = { id: string; content: string; visibility: string; authorType: "team" | "requester"; author: string; createdAt: string };
async function fixture(page: Page, resident = true, readOnly = false) {
  const state = {
    replyPosts: [] as any[], status: "resolved", loseReplyResponse: false, failReply: false, denied: false,
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
      membership: { companyId: "fictional-company", version: 1, role: resident ? "resident" : "manager", status: "active", company: { id: "fictional-company", name: "Fictional Property Company", status: "active" } },
      permissions: resident ? ["resident.self"] : ["property.read", "maintenance.manage"],
      csrfToken: "fixture", destination: resident ? "/resident/maintenance" : "/company/maintenance",
      companyFeatures: { maintenance: readOnly ? "read_only" : "enabled", resident_portal: "enabled", properties: "enabled", documents: "disabled", finances: "disabled" },
    });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/telemetry") return json({ accepted: true });
    if (path.endsWith("/properties")) return json([{ id: "fictional-property", name: "Fictional Garden House" }]);
    if (path.endsWith("/updates")) {
      if (state.denied) return json({ error: "Request access is no longer available." }, 404);
      if (request.method() === "POST") {
        const payload = request.postDataJSON();
        expect(request.headers()["x-csrf-token"]).toBe("fixture");
        state.replyPosts.push(payload);
        if (state.failReply) return json({ error: "The reply could not be saved. Try again." }, 503);
        let saved = state.messages.find(message => message.id === payload.submissionKey);
        if (!saved) { saved = { id: payload.submissionKey, content: payload.content, visibility: "resident", authorType: "requester", author: "Fictional requester", createdAt: "2026-10-24T14:00:00Z" }; state.messages.unshift(saved); }
        if (state.loseReplyResponse) { state.loseReplyResponse = false; return json({ error: "The saved reply response was interrupted. Retry the original details." }, 503); }
        return json({ id: saved.id, content: saved.content, visibility: "resident", author: "You", createdAt: saved.createdAt });
      }
      return json({ items: state.messages.filter(message => !resident || message.visibility === "resident").map(message => resident ? { id: message.id, content: message.content, visibility: message.visibility, author: message.authorType === "requester" ? "You" : "Property team", createdAt: message.createdAt } : message), nextCursor: null });
    }
    if (/\/maintenance\/[^/]+$/.test(path)) {
      if (state.denied) return json({ error: "Request access is no longer available." }, 404);
      return json({ id: "fictional-request", propertyId: "fictional-property", unitId: null, unit: null, title: "Fictional kitchen tap repair", description: "The fictional kitchen tap has been repaired; use this isolated request to verify the conversation.", category: "plumbing", priority: "normal", status: state.status, version: 2, targetOn: null, createdAt: "2026-10-23T12:00:00Z", updatedAt: "2026-10-24T13:00:00Z", property: { name: "Fictional Garden House" }, recordedBy: "Fictional requester", residentUpdatesAvailable: true, historyLimited: false, activity: [{ id: "created", action: "maintenance.created", createdAt: "2026-10-23T12:00:00Z" }, { id: "resolved", action: "maintenance.status.changed", from: "open", to: "resolved", createdAt: "2026-10-24T13:00:00Z" }] });
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
  await expect(page.getByText("Request access is no longer available.", { exact: true }).first()).toBeVisible();
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
