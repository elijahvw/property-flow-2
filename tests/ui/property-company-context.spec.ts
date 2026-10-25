import { test, expect, type Page } from "@playwright/test";

// Disposable same-origin UI fixture. The real server's companyScope enforces
// X-Company-ID; this fixture proves the editor sends and retains that intent.
async function fixture(page: Page) {
  const state = {
    company: "company-a", serverCompany: "company-a", loseNext: false,
    properties: { "company-a": [] as any[], "company-b": [] as any[] },
    attempts: [] as { company: string; body: any }[],
    hold: null as Promise<void> | null,
  };
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === "/api/bootstrap") return json({
      user: { id: "owner", name: "Test owner", email: "owner@test.invalid", emailVerified: true, status: "active" },
      membership: { companyId: state.company, version: 1, role: "owner", status: "active", company: { id: state.company, name: state.company, status: "active" } },
      permissions: ["property.read", "property.write"], csrfToken: "fixture", destination: "/company/properties",
    });
    if (path === "/api/company/properties") {
      if (request.method() === "GET") return json(state.properties[state.serverCompany as keyof typeof state.properties]);
      const company = request.headers()["x-company-id"], body = request.postDataJSON();
      state.attempts.push({ company, body });
      if (company !== state.serverCompany) return json({ error: "Company access is unavailable.", code: "COMPANY_ACCESS_DENIED" }, 403);
      const records = state.properties[company as keyof typeof state.properties];
      let row = records.find(item => item.submissionKey === body.submissionKey);
      if (!row) { row = { id: `${company}-${records.length + 1}`, ...body }; records.push(row); }
      if (state.loseNext) { state.loseNext = false; return route.abort("failed"); }
      if (state.hold) await state.hold;
      return json(row);
    }
    if (path === "/api/company/property-directory") return json({ today: "2026-10-24", items: [] });
    return json([]);
  });
  return state;
}

async function fillProperty(page: Page, name: string) {
  await page.getByRole("button", { name: "Add property", exact: true }).click();
  for (const [label, value] of [["Property name", name], ["Street address", "1 Main Street"], ["City", "City"], ["State / region", "CA"], ["Postal code", "90210"]])
    await page.getByLabel(label, { exact: true }).fill(value);
}

test("property create keeps its opening company and exact interrupted retry through a stale company denial", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/company/properties");
  await fillProperty(page, "Original company home");
  state.loseNext = true;
  await page.getByRole("button", { name: "Create property", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const original = state.attempts[0];
  expect(original.company).toBe("company-a");
  expect(state.properties["company-a"]).toHaveLength(1);
  state.serverCompany = "company-b"; // Cached bootstrap remains A.
  await page.getByRole("button", { name: "Create property", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Company access is unavailable");
  expect(state.attempts[1]).toEqual(original);
  expect(state.properties["company-b"]).toHaveLength(0);
  await expect(page.getByLabel("Property name", { exact: true })).toBeDisabled();
  state.serverCompany = "company-a";
  await page.getByRole("button", { name: "Create property", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add a property", exact: true })).not.toBeVisible();
  expect(state.attempts[2]).toEqual(original);
  expect(state.properties["company-a"]).toHaveLength(1);
  expect(state.properties["company-b"]).toHaveLength(0);
});

test("a late property acknowledgment cannot complete an editor after its company changed", async ({ page }) => {
  const state = await fixture(page);
  let release!: () => void;
  state.hold = new Promise(resolve => { release = resolve; });
  await page.goto("/company/properties");
  await fillProperty(page, "Private A draft");
  await page.getByRole("button", { name: "Create property", exact: true }).click();
  await expect.poll(() => state.attempts.length).toBe(1);
  state.company = state.serverCompany = "company-b";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("dialog", { name: "Add a property", exact: true })).toHaveCount(0);
  const returned = page.waitForResponse(response => new URL(response.url()).pathname === "/api/company/properties" && response.request().method() === "POST");
  state.hold = null; release(); await (await returned).finished();
  await fillProperty(page, "Company B home");
  await expect(page.getByLabel("Property name", { exact: true })).toHaveValue("Company B home");
  await page.getByRole("button", { name: "Create property", exact: true }).click();
  await expect(page.getByRole("link", { name: "Company B home", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Private A draft", exact: true })).toHaveCount(0);
  expect(state.properties["company-a"]).toHaveLength(1);
  expect(state.properties["company-b"]).toHaveLength(1);
  expect(state.attempts[1].company).toBe("company-b");
  expect(state.attempts[1].body.submissionKey).not.toBe(state.attempts[0].body.submissionKey);
});
