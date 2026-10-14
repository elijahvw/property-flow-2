import { test, expect, Page } from "@playwright/test";
async function fixture(page: Page) {
  const state = {
    companies: [
      {
        id: "a",
        name: "FAP",
        status: "active",
        version: 1,
        timezone: "America/New_York",
        contactEmail: "contact@test.invalid",
        memberships: [],
        _count: { memberships: 0 },
      },
    ] as any[],
    keys: [] as string[],
    lose: false,
    patches: [] as any[],
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      json = (value: unknown, status = 200) =>
        route.fulfill({ json: value, status });
    if (path === "/api/bootstrap")
      return json({
        user: {
          id: "admin",
          email: "admin@test.invalid",
          emailVerified: true,
          status: "active",
          platformRole: "owner",
        },
        permissions: ["platform.manage"],
        membership: null,
        csrfToken: "fixture",
      });
    if (path === "/api/platform/companies" && req.method() === "GET")
      return json(state.companies);
    if (path === "/api/platform/companies" && req.method() === "POST") {
      expect(req.headers()["x-csrf-token"]).toBe("fixture");
      const b = req.postDataJSON();
      state.keys.push(b.submissionKey);
      let row = state.companies.find((c) => c.key === b.submissionKey);
      if (!row) {
        row = {
          ...b,
          id: "created",
          status: "active",
          version: 1,
          memberships: [],
          key: b.submissionKey,
        };
        state.companies.push(row);
      }
      if (state.lose) {
        state.lose = false;
        return route.abort("failed");
      }
      return json(row);
    }
    if (path.startsWith("/api/platform/companies/")) {
      const row = state.companies.find((c) => c.id === path.split("/").pop());
      if (req.method() === "PATCH") {
        const b = req.postDataJSON();
        state.patches.push(b);
        if (b.expectedVersion !== row.version)
          return json(
            {
              error:
                "This record changed. Reload the list before editing again.",
            },
            409,
          );
        Object.assign(row, b, { version: row.version + 1 });
      }
      return json(row);
    }
    if (path === "/api/platform/users/sync")
      return json({ conflicts: [], nextPage: null, limited: false });
    return json([]);
  });
  return state;
}
test("full company form survives lost response and opens owner setup without duplicating company", async ({
  page,
}) => {
  const state = await fixture(page);
  state.lose = true;
  await page.goto("/platform/companies");
  await expect(
    page.getByRole("button", { name: "Create company", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Add company", exact: true }).click();
  await page.getByLabel("Company name", { exact: true }).fill("Company B");
  await page.getByLabel("Legal business name").fill("Company B LLC");
  await page
    .getByLabel("Contact email", { exact: true })
    .fill("contact@example.test");
  await page.getByLabel("Address line 1").fill("1 Test St");
  await page.getByLabel("Country code").fill("US");
  await page.getByLabel("Internal platform notes").fill("Account setup notes");
  await page
    .getByRole("button", { name: "Create company", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Legal business name")).toHaveValue(
    "Company B LLC",
  );
  await page
    .getByRole("button", { name: "Create company", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Company B", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "People and owner setup" }),
  ).toBeVisible();
  expect(state.keys[0]).toBe(state.keys[1]);
  expect(state.companies.length).toBe(2);
  await expect(page.getByText("Company B LLC", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "/tmp/propertyflow-company-admin-preview.png",
    fullPage: true,
  });
});
test("profile edit conflict preserves draft and explicit reload fetches current version", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/platform/companies/a");
  await page.getByRole("button", { name: "Edit company profile" }).click();
  await page.getByLabel("Company name", { exact: true }).fill("FAP Edited");
  state.companies[0].version = 2;
  await page.getByRole("button", { name: "Save company profile" }).click();
  await expect(page.getByRole("alert").first()).toContainText("Reload");
  await expect(page.getByLabel("Company name", { exact: true })).toHaveValue(
    "FAP Edited",
  );
  await page.getByRole("button", { name: "Discard edits and reload" }).click();
  await page.getByRole("button", { name: "Edit company profile" }).click();
  await page.getByLabel("Company name", { exact: true }).fill("FAP Updated");
  await page.getByRole("button", { name: "Save company profile" }).click();
  await expect(
    page.getByRole("heading", { name: "FAP Updated", exact: true }),
  ).toBeVisible();
  expect(state.patches.at(-1).expectedVersion).toBe(2);
});
test("company-specific add person preserves context and offers verified-email invitations", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/platform/companies/a");
  await page.getByRole("link", { name: "Add existing person to FAP" }).click();
  await expect(page).toHaveURL(/companyId=a/);
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Invite by email" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Company role")).toBeVisible();
});

test("Companies automatically refreshes on tab return and in the foreground while preserving new-company input", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.clock.install();
  await page.goto("/platform/companies");
  await expect(
    page.getByRole("link", { name: "FAP", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reload companies" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Add company", exact: true }).click();
  await page
    .getByLabel("Company name", { exact: true })
    .fill("Unsaved company");
  state.companies.push({
    id: "other",
    name: "Other Company",
    status: "active",
    version: 1,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("link", { name: "Other Company", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Company name", { exact: true })).toHaveValue(
    "Unsaved company",
  );
  state.companies.push({
    id: "later",
    name: "Later Company",
    status: "active",
    version: 1,
  });
  await page.clock.fastForward(60000);
  await expect(
    page.getByRole("link", { name: "Later Company", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Company name", { exact: true })).toHaveValue(
    "Unsaved company",
  );
});
