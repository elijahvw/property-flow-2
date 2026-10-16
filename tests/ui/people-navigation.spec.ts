import { test, expect, Page } from "@playwright/test";
async function fixture(page: Page, role = "owner") {
  const state = {
    writes: [] as any[],
    invites: [] as any[],
    tenantStatus: "active",
    version: 3,
  };
  const users = [
    {
      userId: "owner",
      role: "owner",
      user: {
        name: "Olivia Owner",
        email: "owner@test.invalid",
        status: "active",
      },
    },
    {
      userId: "manager",
      role: "manager",
      user: {
        name: "Maya Manager",
        email: "manager@test.invalid",
        status: "active",
      },
    },
    {
      userId: "resident",
      role: "resident",
      user: {
        name: "Taylor Tenant",
        email: "tenant@test.invalid",
        status: "active",
        emailVerified: true,
      },
    },
  ];
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      p = u.pathname,
      json = (v: unknown, status = 200) => route.fulfill({ json: v, status });
    if (p === "/api/bootstrap")
      return json({
        user: {
          id: role,
          email: role + "@test.invalid",
          emailVerified: true,
          status: "active",
        },
        membership: {
          companyId: "a",
          role,
          status: "active",
          version: 1,
          company: { name: "FAP", status: "active" },
        },
        permissions: [
          "property.read",
          "resident.assignment.manage",
          ...(role === "owner" ? ["members.manage"] : []),
        ],
        destination: "/company/residents",
        csrfToken: "fixture",
      });
    if (p === "/api/company/properties") return json([]);
    if (p === "/api/company/members")
      return json(
        users.map((m) => ({
          ...m,
          version: state.version,
          status: m.role === "resident" ? state.tenantStatus : "active",
        })),
      );
    const profile = {
      ...users[2],
      status: state.tenantStatus,
      version: state.version,
      contactName: null,
      contactPhone: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      managementNotes: null,
    };
    if (p === "/api/company/resident-profiles") return json([profile]);
    if (p === "/api/company/resident-profiles/resident")
      return json({
        ...profile,
        assignments: [
          {
            property: {
              id: "maple",
              name: "Maple House",
              address: "12 Maple Lane",
            },
          },
        ],
        activity: [],
      });
    if (p === "/api/company/members/resident") {
      const body = req.postDataJSON();
      state.writes.push(body);
      if (body.expectedVersion !== state.version)
        return json({ error: "This person changed; close and reopen." }, 409);
      state.tenantStatus = body.status;
      state.version++;
      return json({});
    }
    if (p === "/api/invitations") {
      if (req.method() === "POST") {
        const b = req.postDataJSON();
        state.invites.push(b);
        return json({ acceptanceUrl: "https://example.test/invite#fixture" });
      }
      return json([
        {
          id: "manager-invite",
          email: "staff-pending@test.invalid",
          role: "staff",
          expiresAt: "2099-01-01",
        },
        {
          id: "tenant-invite",
          email: "tenant-pending@test.invalid",
          role: "resident",
          expiresAt: "2099-01-01",
        },
      ]);
    }
    return json([]);
  });
  return state;
}
test("team and tenants have distinct people, roles, invitations and focused access forms", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/company/members");
  await expect(
    page.getByRole("heading", { name: "Team", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Maya Manager", { exact: true })).toBeVisible();
  await expect(page.getByText("Taylor Tenant", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("tenant-pending@test.invalid", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Invite team member", exact: true })
    .click();
  await expect(page.getByLabel("Company role").locator("option")).toHaveText([
    "Manager",
    "Staff",
  ]);
  await page
    .getByLabel("Email address", { exact: true })
    .fill("new-staff@test.invalid");
  await page.getByLabel("Company role").selectOption("staff");
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(page.getByLabel("Invitation acceptance link")).toBeVisible();
  expect(state.invites[0]).toEqual({
    email: "new-staff@test.invalid",
    role: "staff",
    companyId: "a",
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("link", { name: "Manage tenants", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tenants", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Taylor Tenant", { exact: true })).toBeVisible();
  await expect(page.getByText("Maya Manager", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("staff-pending@test.invalid", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Invite tenant", exact: true })
    .click();
  await expect(page.getByLabel("Portal invitation")).toHaveValue("yes");
  await expect(page.getByLabel("Company role")).toHaveCount(0);
  await expect(page.getByLabel("Full name *",{exact:true})).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("link", { name: /View tenant/ })
    .click();
  await expect(
    page.getByRole("link", { name: "Maple House", exact: true }),
  ).toHaveAttribute("href", "/company/properties/maple/residents");
  await page
    .getByRole("button", { name: "Edit tenant access", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Tenant access", exact: true })
    .selectOption("disabled");
  await page
    .getByRole("button", { name: "Save tenant access", exact: true })
    .click();
  await expect(
    page.getByText("Disabled company membership", { exact: true }),
  ).toBeVisible();
  expect(state.writes).toEqual([
    { role: "resident", status: "disabled", expectedVersion: 3 },
  ]);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("link", {name:"All tenants",exact:true}).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Tenants", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", {name:/View tenant/}).scrollIntoViewIfNeeded();
  await expect(page.getByRole("link", {name:/View tenant/})).toBeInViewport({ratio:1});
  await page.screenshot({
    path: "/tmp/pf-tenant-directory-mobile.png",
    fullPage: true,
  });
});
test("stale tenant access cannot silently overwrite another change and managers do not receive owner controls", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/company/residents");
  await page
    .getByRole("link", { name: /View tenant/ })
    .click();
  await page
    .getByRole("button", { name: "Edit tenant access", exact: true })
    .click();
  state.version++;
  await page
    .getByRole("button", { name: "Save tenant access", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("close and reopen");
  expect(state.tenantStatus).toBe("active");
  await page.unroute("**/api/**");
  await fixture(page, "manager");
  await page.goto("/company/residents");
  await expect(
    page.getByRole("button", { name: "Invite tenant", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Tenant invitations", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: /View tenant/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit tenant access", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Edit resident profile", exact: true }),
  ).toBeVisible();
  await page.goto("/company/members");
  await expect(
    page.getByRole("heading", { name: "Access unavailable" }),
  ).toBeVisible();
});
