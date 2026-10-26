import { test, expect, Page } from "@playwright/test";

async function fixture(page: Page, workspace: "platform" | "company" = "platform") {
  const companies = Array.from({ length: 31 }, (_, index) => ({
    id: `company-${index + 1}`, name: `Fictional company ${String(index + 1).padStart(2, "0")}`,
    status: index === 29 ? "suspended" : "active", version: 1, timezone: "America/New_York",
    contactEmail: `company-${index + 1}@test.invalid`, memberships: [], _count: { memberships: index },
  }));
  const people = Array.from({ length: 31 }, (_, index) => ({
    id: `person-${index + 1}`, name: `Fictional person ${String(index + 1).padStart(2, "0")}`,
    email: `person-${index + 1}@test.invalid`, status: "active", emailVerified: index !== 29,
    platformRole: null, firstSignedInAt: null,
    membership: { userId: `person-${index + 1}`, companyId: "company-1", role: index % 2 ? "staff" : "manager", status: "active", version: 1, company: companies[0] },
  }));
  const state = { companies, people, checks: [] as string[], writes: 0, deletionRequests: [] as Record<string, unknown>[], loseDeleteResponse: false };
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({
      user: { id: "admin", email: "admin@test.invalid", status: "active", emailVerified: true, platformRole: workspace === "platform" ? "owner" : null },
      membership: workspace === "company" ? { companyId: "company-1", role: "owner", status: "active", version: 1, company: companies[0] } : null,
      permissions: workspace === "platform" ? ["platform.manage"] : ["members.manage", "property.read"], csrfToken: "fixture",
    });
    if (path === "/api/account/guide") return json({ eligible: false });
    if (path === "/api/platform/users/sync") {
      if (request.postDataJSON().email) state.checks.push(request.postDataJSON().email);
      return json({ nextPage: null, conflicts: [], limited: false });
    }
    if (path === "/api/platform/users") return json(state.people);
    if (path === "/api/platform/companies") return json(state.companies.filter(company => company.status !== "deleted"));
    if (path.endsWith("/subscription")) return json({ error: "Subscription service unavailable in this directory fixture." }, 503);
    if (/^\/api\/platform\/companies\/company-\d+$/.test(path)) {
      const company = companies.find(company => path.endsWith(`/${company.id}`))!;
      if (request.method() === "DELETE") {
        state.deletionRequests.push(request.postDataJSON());
        if (request.postDataJSON().confirmationName !== company.name) return json({ error: "Enter the exact company name to confirm deletion." }, 400);
        company.status = "deleted"; company.version = 2;
        if (state.loseDeleteResponse && state.deletionRequests.length === 1) return route.abort("failed");
      }
      return json(company);
    }
    if (path === "/api/company/members") return json(people.map(person => ({ ...person.membership, user: person })));
    if (path.endsWith("/activity")) return json({ items: [], total: 0, page: 1, pageSize: 25 });
    if (request.method() !== "GET") state.writes++;
    return json([]);
  });
  return state;
}

test("user directory bounds complete results and resets paging when filters change", async ({ page }) => {
  await fixture(page);
  await page.goto("/platform/users");
  const directory = page.getByRole("region", { name: "User directory", exact: true });
  await expect(directory.getByText("31 matching accounts", { exact: true })).toBeVisible();
  await expect(directory.getByRole("button", { name: "Manage", exact: true })).toHaveCount(25);
  await directory.getByRole("button", { name: "Next users", exact: true }).click();
  await expect(directory.getByRole("button", { name: "Manage", exact: true })).toHaveCount(6);
  await expect(directory.getByText("Fictional person 31", { exact: true })).toBeVisible();
  await page.getByLabel("Search users", { exact: true }).fill("Fictional person 01");
  await expect(directory.getByText("1 matching account", { exact: true })).toBeVisible();
  await expect(directory.getByRole("navigation", { name: "Users pages" })).toHaveCount(0);
  await expect(directory.getByText("Fictional person 01", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear user filters", exact: true }).click();
  await expect(directory.getByRole("button", { name: "Manage", exact: true })).toHaveCount(25);
});

test("exact-email lookup is distinct from local filtering and mobile user cards retain access facts", async ({ page }, info) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/platform/users");
  const search = page.getByLabel("Search users", { exact: true });
  await search.fill("person-30");
  await expect(page.getByRole("button", { name: "Check exact email", exact: true })).toBeDisabled();
  await expect(page.getByRole("row").filter({ hasText: "person-30@test.invalid" })).toContainText("Verification required");
  await search.fill("person-30@test.invalid");
  await page.getByRole("button", { name: "Check exact email", exact: true }).click();
  await expect.poll(() => state.checks).toEqual(["person-30@test.invalid"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("users-directory-mobile.png"), fullPage: true });
});

test("user management section navigation preserves independent unsaved values", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/platform/users");
  await page.getByRole("row").filter({ hasText: "person-1@test.invalid" }).getByRole("button", { name: "Manage", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Manage Fictional person 01", exact: true });
  await editor.getByLabel("Display name", { exact: true }).fill("Unfinished display name");
  const sections = editor.getByRole("navigation", { name: "Account management sections" });
  await sections.getByRole("button", { name: "Company access", exact: true }).click();
  await expect(editor.locator("#manage-user-access")).toBeFocused();
  await sections.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(editor.locator("#manage-user-activity details")).toHaveJSProperty("open", true);
  await sections.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(editor.getByLabel("Display name", { exact: true })).toHaveValue("Unfinished display name");
  expect(state.writes).toBe(0);
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "Close without saving changes?", exact: true })).toBeVisible();
});

test("company directory filters survive record navigation and copied links", async ({ page }, info) => {
  await fixture(page);
  await page.goto("/platform/companies?q=company+30&status=suspended");
  const directory = page.getByRole("region", { name: "Company directory", exact: true });
  await expect(directory.getByText("1 matching company", { exact: true })).toBeVisible();
  await directory.getByRole("link", { name: "Manage Fictional company 30", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fictional company 30", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "← Companies", exact: true }).click();
  await expect(page.getByLabel("Find company", { exact: true })).toHaveValue("company 30");
  await expect(page.getByRole("combobox", { name: "Filter company status", exact: true })).toHaveValue("suspended");
  await page.reload();
  await expect(directory.getByText("1 matching company", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear company filters", exact: true }).click();
  await expect(directory.getByRole("link", { name: /^Manage Fictional company/ })).toHaveCount(25);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("companies-directory-mobile.png"), fullPage: true });
});

test("team directory resets filters and removes unnecessary pagination on a small result", async ({ page }, info) => {
  await fixture(page, "company");
  await page.goto("/company/members");
  const directory = page.getByRole("region", { name: "Team directory", exact: true });
  await expect(directory.getByText("31 matching members", { exact: true })).toBeVisible();
  await directory.getByRole("button", { name: "Next team members", exact: true }).click();
  await page.getByRole("combobox", { name: "Team role", exact: true }).selectOption("staff");
  await expect(directory.getByText("15 matching members", { exact: true })).toBeVisible();
  await expect(directory.getByRole("navigation", { name: "Team pages" })).toHaveCount(0);
  await page.getByLabel("Find team member", { exact: true }).fill("person-2@test.invalid");
  await expect(directory.getByText("1 matching member", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear team filters", exact: true }).click();
  await expect(directory.getByText("31 matching members", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("team-directory-mobile.png"), fullPage: true });
});


test("company deletion confirms the exact record and returns to the filtered directory", async ({ page }, info) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/platform/companies/company-1?q=Fictional&status=active");
  await page.getByRole("button", { name: "Delete company", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete company", exact: true });
  await expect(dialog).toContainText("Retained history is not erased");
  await page.screenshot({path:info.outputPath("company-delete-phone.png"),fullPage:true});
  await dialog.getByRole("textbox", { name: "Company name confirmation", exact: true }).fill("Wrong company");
  await dialog.getByRole("button", { name: "Confirm company deletion", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter the exact company name");
  await dialog.getByRole("textbox", { name: "Company name confirmation", exact: true }).fill("Fictional company 01");
  await dialog.getByRole("button", { name: "Confirm company deletion", exact: true }).click();
  await expect(page).toHaveURL(/\/platform\/companies\?q=Fictional&status=active$/);
  await expect(page.getByRole("link", { name: "Manage Fictional company 01", exact: true })).toHaveCount(0);
  expect(state.deletionRequests).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/platform/companies/company-1");
  await expect(page.getByText("Deleted company — company access is blocked.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit company profile", exact: true })).toHaveCount(0);
});

test("interrupted company deletion retries the exact submitted version and key", async ({ page }) => {
  const state = await fixture(page); state.loseDeleteResponse = true;
  await page.goto("/platform/companies/company-2");
  await page.getByRole("button", { name: "Delete company", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete company", exact: true });
  await dialog.getByRole("textbox", { name: "Company name confirmation", exact: true }).fill("Fictional company 02");
  await dialog.getByRole("button", { name: "Confirm company deletion", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Company name confirmation", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("Retry with the original details");
  await dialog.getByRole("button", { name: "Close & keep recovery", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Resume company deletion", exact: true }).click();
  await expect(dialog.getByRole("textbox", { name: "Company name confirmation", exact: true })).toHaveValue("Fictional company 02");
  await expect(dialog.getByRole("textbox", { name: "Company name confirmation", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Confirm company deletion", exact: true }).click();
  await expect(page).toHaveURL(/\/platform\/companies$/);
  expect(state.deletionRequests).toHaveLength(2);
  expect(state.deletionRequests[1]).toEqual(state.deletionRequests[0]);
});
