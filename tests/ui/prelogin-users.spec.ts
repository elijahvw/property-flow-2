import { test, expect, Page } from "@playwright/test";
async function fixture(page: Page, { verified = true, platform = true } = {}) {
  const state = {
    verified,
    people: [] as any[],
    imports: 0,
    provisions: [] as any[],
    fail: false,
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
          id: platform ? "admin" : "u",
          email: "user@test.invalid",
          status: "active",
          emailVerified: state.verified,
          platformRole: platform ? "owner" : null,
        },
        membership: null,
        permissions: state.verified && platform ? ["platform.manage"] : [],
        destination: platform ? "/platform/users" : "/access",
        csrfToken: "fixture",
      });
    if (path === "/api/platform/users" && req.method() === "GET")
      return json(state.people);
    if (path === "/api/platform/companies")
      return json([{ id: "a", name: "Company A", status: "active" }]);
    if (path === "/api/platform/invitations") return json([]);
    if (path === "/api/platform/identity-users")
      return state.fail
        ? json({ error: "Identity service unavailable" }, 503)
        : json({
            users: [
              {
                user_id: "auth0|before",
                email: "before@test.invalid",
                email_verified: false,
                name: "Before Login",
              },
            ],
            nextPage: null,
          });
    if (req.method() !== "GET") {
      expect(req.headers()["x-csrf-token"]).toBe("fixture");
      if (path.endsWith("/import")) {
        state.imports++;
        state.people = [
          {
            id: "auth0|before",
            email: "before@test.invalid",
            name: "Before Login",
            emailVerified: false,
            firstSignedInAt: null,
            status: "active",
            platformRole: null,
            membership: null,
          },
        ];
        return json({ items: state.people });
      }
      if (path.endsWith("/provision")) {
        state.provisions.push(req.postDataJSON());
        return json({ id: "auth0|created" });
      }
      if (path.endsWith("/verification-status"))
        return json({ emailVerified: state.verified });
      if (path.endsWith("/verification"))
        return json({ message: "Verification email requested." });
      if (path.endsWith("/password-setup"))
        return json({ message: "Password setup email requested." });
      if (path.endsWith("/membership")) {
        state.people[0].membership = {
          companyId: "a",
          version: 1,
          role: req.postDataJSON().role,
          status: "active",
          company: { name: "Company A" },
        };
        return json(state.people[0].membership);
      }
    }
    return json([]);
  });
  return state;
}
test("admin adds imported identity and assigns company/owner without first sign-in", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/platform/users");
  await page
    .getByRole("button", {
      name: "Search or refresh Auth0 accounts",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Add all accounts on this page" })
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: "before@test.invalid" }),
  ).toContainText("Not verified");
  await expect(
    page.getByRole("row").filter({ hasText: "before@test.invalid" }),
  ).toContainText("Awaiting first sign-in");
  expect(state.imports).toBe(1);
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Company", exact: true })
    .selectOption("a");
  await page.getByLabel("Company role").selectOption("owner");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "before@test.invalid" }),
  ).toContainText("owner");
  await page
    .getByRole("button", { name: "Send verification email", exact: true })
    .click();
  await expect(
    page.getByText("Verification email requested.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send password setup email" }).click();
  await expect(
    page.getByText("Password setup email requested.", { exact: true }),
  ).toBeVisible();
});
test("directory failure is recoverable and unverified user sees reminder/profile without protected content", async ({
  page,
}) => {
  const state = await fixture(page);
  state.fail = true;
  await page.goto("/platform/users");
  await page
    .getByRole("button", {
      name: "Search or refresh Auth0 accounts",
      exact: true,
    })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Identity service unavailable",
  );
  state.fail = false;
  await page
    .getByRole("button", {
      name: "Search or refresh Auth0 accounts",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Add all accounts on this page" }),
  ).toBeVisible();
  await page.unroute("**/api/**");
  await fixture(page, { verified: false, platform: false });
  await page.goto("/company/finances");
  await expect(page.getByRole("alertdialog")).toContainText(
    "Verify your email",
  );
  await expect(
    page.getByRole("heading", { name: "Email verification required" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Manual finances" }),
  ).toHaveCount(0);
});
test("verification status refresh updates profile and dismisses persistent reminder", async ({
  page,
}) => {
  const state = await fixture(page, { verified: false, platform: false });
  await page.goto("/account");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(
    page.getByText(/user@test.invalid · Not verified/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "I verified my email — check status" })
    .click();
  await expect(page.getByText(/Your email is still unverified/)).toBeVisible();
  state.verified = true;
  await page
    .getByRole("button", { name: "I verified my email — check status" })
    .click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByText(/user@test.invalid · Verified/)).toBeVisible();
});
test("new-account retry keeps submission key; explicit new action resets", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/platform/users");
  await page.getByLabel("New user name").fill("New Person");
  await page.getByLabel("New user email").fill("new@test.invalid");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect.poll(() => state.provisions.length).toBe(2);
  expect(state.provisions[0].submissionKey).toBe(
    state.provisions[1].submissionKey,
  );
  await page.getByRole("button", { name: "Start another account" }).click();
  await expect(page.getByLabel("New user email")).toHaveValue("");
});
