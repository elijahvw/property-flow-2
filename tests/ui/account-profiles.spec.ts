import { test, expect, type Page } from "@playwright/test";
async function fixture(page: Page, role: string | null, platform = false) {
  const p = {
    name: "Alex Owner",
    email: "alex@test.invalid",
    emailVerified: true,
    version: 1,
    nameVersion: "2026-10-16T12:00:00Z",
    companyId: role ? "a" : null,
    contactVersion: role === "resident" ? 1 : null,
    sharedWithManagement: role === "resident",
    contactEmail: "contact@test.invalid",
    details: {
      preferredName: "Alex",
      phone: "555-0100",
      addressLine1: "12 Oak Street",
      city: "Philadelphia",
      region: "PA",
      postalCode: "19103",
      country: "US",
    },
    updatedAt: "2026-10-16T12:00:00Z",
    assignments:
      role === "resident"
        ? [
            {
              id: "lease",
              startsOn: "2026-10-01",
              endsOn: null,
              property: { name: "Maple House", address: "1 Maple Street" },
              unit: { label: "Apartment 1" },
            },
          ]
        : [],
  };
  const state = { p, patches: [] as any[], fail: false };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      json = (value: unknown, status = 200) =>
        route.fulfill({ json: value, status });
    if (path === "/api/bootstrap")
      return json({
        user: {
          id: "alex",
          name: p.name,
          email: p.email,
          emailVerified: true,
          status: "active",
          platformRole: role && !platform ? null : "owner",
        },
        membership: role
          ? {
              companyId: "a",
              version: 1,
              role,
              status: "active",
              company: { id: "a", name: "Oak & Elm", status: "active" },
            }
          : null,
        permissions:
          role === "owner"
            ? [
                "company.manage",
                "members.manage",
                "property.read",
                ...(platform ? ["platform.manage"] : []),
              ]
            : role === "resident"
              ? ["resident.self"]
              : role
                ? ["property.read"]
                : ["platform.manage"],
        csrfToken: "fixture",
      });
    if (path === "/api/platform/companies") return json([]);
    if (path === "/api/account") {
      if (req.method() === "PATCH") {
        state.patches.push(req.postDataJSON());
        return json({ saved: true, version: 2 });
      }
      return state.fail
        ? json({ error: "Profile temporarily unavailable" }, 503)
        : json(p);
    }
    return json({});
  });
  return state;
}
for (const role of ["owner", "manager", "staff", "resident", null])
  test(`${role || "platform owner"} profile explains the correct ownership context`, async ({
    page,
  }) => {
    await fixture(page, role);
    await page.goto("/account");
    await expect(
      page.getByRole("heading", { name: "My profile", exact: true }),
    ).toBeVisible();
    const label =
      role === "resident"
        ? "Home & access"
        : role
          ? "Company & access"
          : "Account access";
    await page.getByRole("button", { name: label, exact: true }).click();
    if (role === "owner") {
      await expect(
        page.getByText(
          "You manage this company’s details, team and properties.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Manage company details", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Your property team manages assignments and access.", {
          exact: true,
        }),
      ).toHaveCount(0);
    }
    if (role === "resident") {
      await expect(
        page.getByText("Maple House · Apartment 1", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /Edit/ })).toHaveCount(0);
      await expect(
        page.locator('[name="unitId"],[name="propertyId"],[name="role"]'),
      ).toHaveCount(0);
    }
    if (!role)
      await expect(
        page.getByRole("link", {
          name: "Open platform administration →",
          exact: true,
        }),
      ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
test("focused profile forms retain other sections and display only the changed field in review", async ({
  page,
}) => {
  const state = await fixture(page, "resident");
  await page.goto("/account");
  await page.getByRole("button", { name: "Contact", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit contact details", exact: true })
    .click();
  await expect(
    page.getByLabel("Display name", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByLabel("Street address", { exact: true }),
  ).not.toBeVisible();
  await page.getByLabel("Primary phone", { exact: true }).fill("555-0200");
  await page
    .getByRole("button", { name: "Review profile changes", exact: true })
    .click();
  const review = page.locator(".profile-review");
  await expect(review).toContainText("555-0200");
  await expect(review).not.toContainText("Street address");
  await page
    .getByRole("button", { name: "Save my profile", exact: true })
    .click();
  expect(state.patches[0]).toMatchObject({
    phone: "555-0200",
    addressLine1: "12 Oak Street",
    name: "Alex Owner",
    expectedVersion: 1,
  });
});
test("profile facts stay below the heading and edit controls at normal and phone widths", async ({
  page,
}) => {
  await fixture(page, "owner");
  await page.goto("/account");
  for (const width of [1380, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const h = await page
        .locator(".account-content-card > .section-heading")
        .boundingBox(),
      facts = await page
        .locator(".account-content-card .profile-facts")
        .boundingBox();
    expect(facts!.y).toBeGreaterThan(h!.y + h!.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("a dual platform/company owner sees the authority for the current workspace", async ({
  page,
}) => {
  await fixture(page, "owner", true);
  await page.goto("/account");
  await expect(page.locator(".workspace-label")).toHaveText("Oak & Elm");
  await expect(page.locator(".sidebar-footer")).toContainText("Company owner");
  await page
    .getByRole("button", { name: "Company & access", exact: true })
    .click();
  await expect(
    page.getByText("Platform owner · Company owner", { exact: true }),
  ).toBeVisible();
  await page.goto("/platform/companies");
  await expect(page.locator(".workspace-label")).toHaveText(
    "Platform workspace",
  );
  await expect(page.locator(".sidebar-footer")).toContainText("Platform owner");
});


test('profile review is page-only until submitted and explicit saving does not write browser storage',async({page})=>{
 const state=await fixture(page,'resident');await page.goto('/account');await page.getByRole('button',{name:'Contact',exact:true}).click();
 await page.getByRole('button',{name:'Edit contact details',exact:true}).click();await page.getByLabel('Primary phone',{exact:true}).fill('555-9999');
 await page.getByRole('button',{name:'Review profile changes',exact:true}).click();await expect(page.getByRole('heading',{name:'Review profile changes',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('pf:profile')))).toEqual([]);
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Save draft & close',exact:true}).click();
 expect(state.patches).toHaveLength(0);await page.reload();await page.getByRole('button',{name:'Contact',exact:true}).click();await page.getByRole('button',{name:'Edit contact details',exact:true}).click();
 await expect(page.getByLabel('Primary phone',{exact:true})).toHaveValue('555-0100');expect(state.patches).toHaveLength(0);
});
