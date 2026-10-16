import { test, expect, type Page } from "@playwright/test";
async function fixture(
  page: Page,
  options: { signedIn?: boolean; loseSave?: boolean } = {},
) {
  const state = {
    contact: null as any,
    creates: [] as any[],
    invites: [] as any[],
    setup: 0,
    loseSave: !!options.loseSave,
  };
  const workspace = {
    businessDate: "2026-10-16",
    timezone: "America/New_York",
    leases: [],
    rent: {
      outstandingCents: "0",
      creditCents: "0",
      afterGraceCents: "0",
      upcomingCents: "0",
    },
    deposits: { heldCents: "0", outstandingCents: "0" },
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      p = new URL(req.url()).pathname,
      json = (value: unknown, status = 200) =>
        route.fulfill({ json: value, status });
    if (p === "/api/bootstrap")
      return options.signedIn === false
        ? json({ error: "Sign in" }, 401)
        : json({
            user: {
              id: "owner",
              name: "Olivia Owner",
              email: "owner@test.invalid",
              status: "active",
              emailVerified: true,
            },
            membership: {
              companyId: "a",
              version: 1,
              role: "owner",
              status: "active",
              company: { name: "FAP", status: "active" },
            },
            permissions: [
              "property.read",
              "property.write",
              "resident.assignment.manage",
              "members.manage",
              "lease.manage",
              "finance.manage",
            ],
            csrfToken: "fixture",
          });
    if (p === "/api/company/resident-profiles")
      return json(
        state.contact
          ? [
              {
                ...state.contact,
                contactId: state.contact.id,
                recordStatus: "active",
                portalState: "offline",
                user: null,
              },
            ]
          : [],
      );
    if (p === "/api/invitations") return json([]);
    if (p === "/api/company/resident-contacts" && req.method() === "POST") {
      const body = req.postDataJSON();
      state.creates.push(body);
      state.contact ??= {
        id: "jordan-profile",
        ...body,
        status: "active",
        version: 1,
        userId: null,
        portal: null,
        activity: [],
        invitations: [],
        leases: [],
      };
      if (state.loseSave) {
        state.loseSave = false;
        return route.abort("failed");
      }
      return json(state.contact);
    }
    if (p === "/api/company/resident-contacts/jordan-profile")
      return json(state.contact);
    if (p === "/api/company/resident-contacts/jordan-profile/workspace")
      return json(workspace);
    if (p === "/api/company/resident-contacts/jordan-profile/invitations") {
      state.invites.push(req.postDataJSON());
      return json({
        acceptanceUrl: "https://app.test/invite?contact=1#private-token",
        expiresAt: "2026-10-19",
      });
    }
    if (p === "/api/invitations/setup-account") {
      state.setup++;
      return json({ message: "Account setup emails requested." });
    }
    if (p === "/api/company/properties/home")
      return json({
        id: "home",
        version: 1,
        name: "Oak Place",
        address: "12 Oak Street",
        city: "Philadelphia",
        state: "PA",
        zip: "19103",
        countryCode: "US",
        propertyType: "multi_family",
        yearBuilt: 1985,
        parcelId: "LOT-16",
        notes: "Use the north entrance.",
      });
    return json([]);
  });
  return state;
}
test("save a tenant without login, retain a readable address and connect the next lease", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/company/residents");
  await page.getByRole("button", { name: "Add tenant", exact: true }).click();
  await page.getByLabel("Full name *", { exact: true }).fill("Jordan Rivera");
  await page
    .getByLabel("Contact email", { exact: true })
    .fill("jordan@test.invalid");
  await page.getByText("Mailing address · optional", { exact: true }).click();
  for (const [label, value] of [
    ["Address line 1", "12 Oak Street"],
    ["Address line 2", "Apt 4"],
    ["City", "Philadelphia"],
    ["State / region", "PA"],
    ["Postal code", "19103"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  const street = await page
      .getByLabel("Address line 1", { exact: true })
      .boundingBox(),
    city = await page.getByLabel("City", { exact: true }).boundingBox(),
    region = await page
      .getByLabel("State / region", { exact: true })
      .boundingBox();
  expect(street!.y).toBeLessThan(city!.y);
  expect(city!.y).toBe(region!.y);
  expect(street!.width).toBeGreaterThan(city!.width);
  await page.screenshot({
    path: "/tmp/propertyflow-tenant-form-desktop.png",
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "Review tenant", exact: true })
    .click();
  await page.getByRole("button", { name: "Save tenant", exact: true }).click();
  await expect(page).toHaveURL(/company\/tenants\/jordan-profile$/);
  await expect(
    page.getByRole("heading", { name: "Jordan Rivera", exact: true }),
  ).toBeVisible();
  expect(state.creates).toHaveLength(1);
  expect(state.invites).toHaveLength(0);
  await expect(page.locator(".tenant-status")).toHaveText("Not invited");
  await expect(
    page.getByRole("link", { name: "Record a lease for Jordan Rivera" }),
  ).toHaveAttribute(
    "href",
    "/company/leases?new=lease&contactId=jordan-profile",
  );
  await expect(page.locator(".postal-address > span")).toHaveText([
    "12 Oak Street",
    "Apt 4",
    "Philadelphia, PA 19103",
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/propertyflow-offline-profile-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Edit tenant details" }).click();
  await page.screenshot({
    path: "/tmp/propertyflow-tenant-form-mobile.png",
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () =>
        document.querySelector("dialog")!.scrollWidth <=
        document.querySelector("dialog")!.clientWidth,
    ),
  ).toBe(true);
});
test("invitation follows durable profile creation and requires an explicit owner review", async ({
  page,
}) => {
  const state = await fixture(page, { loseSave: true });
  await page.goto("/company/residents");
  await page
    .getByRole("button", { name: "Invite tenant", exact: true })
    .click();
  await page.getByLabel("Full name *", { exact: true }).fill("Jordan Rivera");
  await page
    .getByLabel("Contact email", { exact: true })
    .fill("jordan@test.invalid");
  await expect(page.getByLabel("Portal invitation")).toHaveValue("yes");
  await page
    .getByRole("button", { name: "Review tenant", exact: true })
    .click();
  await page.getByRole("button", { name: "Save tenant", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Save tenant", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Invite Jordan Rivera", exact: true }),
  ).toBeVisible();
  expect(state.creates[0]).toEqual(state.creates[1]);
  expect(state.creates[0]).not.toHaveProperty("invitePortal");
  expect(state.invites).toHaveLength(0);
  await page
    .getByRole("button", { name: "Create invitation link", exact: true })
    .click();
  expect(state.invites).toHaveLength(0);
  await page.getByRole("checkbox", { name: /I approve this person/ }).check();
  await page
    .getByRole("button", { name: "Create invitation link", exact: true })
    .click();
  await expect(page.getByLabel("Private invitation link")).toHaveValue(
    "https://app.test/invite?contact=1#private-token",
  );
  expect(state.invites).toEqual([{ expectedVersion: 1, approvals: [] }]);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "View tenant Jordan Rivera", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Invite tenant", exact: true })
    .click();
  await expect(page.getByLabel("Full name *", { exact: true })).toHaveValue("");
});
test("property address is one familiar block and edit fields follow postal reading order on desktop and mobile", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/company/properties/home");
  await expect(
    page.getByRole("heading", { name: "Oak Place", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Property location" })
      .locator(".postal-address > span"),
  ).toHaveText(["12 Oak Street", "Philadelphia, PA 19103", "US"]);
  await page.screenshot({
    path: "/tmp/propertyflow-property-details-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Edit property" }).click();
  await page.screenshot({
    path: "/tmp/propertyflow-property-form-desktop.png",
    fullPage: true,
  });
  const street = await page
      .getByLabel("Street address", { exact: true })
      .boundingBox(),
    city = await page.getByLabel("City", { exact: true }).boundingBox(),
    region = await page
      .getByLabel("State / region", { exact: true })
      .boundingBox(),
    zip = await page.getByLabel("Postal code", { exact: true }).boundingBox();
  expect(street!.y).toBeLessThan(city!.y);
  expect(city!.y).toBe(region!.y);
  expect(region!.y).toBe(zip!.y);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCity = await page
      .getByLabel("City", { exact: true })
      .boundingBox(),
    mobileState = await page
      .getByLabel("State / region", { exact: true })
      .boundingBox();
  expect(mobileCity!.y).toBeLessThan(mobileState!.y);
  await page.screenshot({
    path: "/tmp/propertyflow-property-form-mobile.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/propertyflow-property-details-mobile.png",
    fullPage: true,
  });
});
test("an invited tenant can start account setup before sign-in and the private token is removed from the URL", async ({
  page,
}) => {
  const state = await fixture(page, { signedIn: false });
  await page.goto("/invite?contact=1#setup-test-token");
  await expect(
    page.getByRole("heading", { name: "Welcome to your rental workspace" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/invite$/);
  await page
    .getByRole("button", { name: "Email me account setup links" })
    .click();
  await expect(page.getByText(/Account setup emails requested/)).toBeVisible();
  expect(state.setup).toBe(1);
  await page.screenshot({
    path: "/tmp/propertyflow-invitation-setup-desktop.png",
    fullPage: true,
  });
});

test("a lost accepted invitation recovers after reload without asking the owner for a new grant", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "resident",
          name: "Jordan Rivera",
          email: "new-verified-signin@test.invalid",
          status: "active",
          emailVerified: true,
        },
        membership: {
          companyId: "a",
          role: "resident",
          status: "active",
          version: 1,
          company: { name: "FAP", status: "active" },
        },
        permissions: ["resident.self"],
        csrfToken: "fixture",
        destination: "/resident",
      },
    }),
  );
  await page.route("**/api/invitations/preview", (route) =>
    route.fulfill({
      json: {
        company: "FAP",
        name: "Jordan Rivera",
        contact: true,
        accepted: true,
        leaseApprovals: [],
        leases: [],
      },
    }),
  );
  let acknowledgements = 0;
  await page.route("**/api/invitations/accept", (route) => {
    acknowledgements++;
    return route.fulfill({ json: { success: true } });
  });
  await page.goto("/invite?contact=1#accepted-token");
  await expect(
    page.getByRole("heading", { name: "Your profile is connected" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept tenant invitation" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Continue to resident portal" })
    .click();
  await expect(page).toHaveURL(/\/resident$/);
  expect(acknowledgements).toBe(1);
  expect(
    await page.evaluate(() => sessionStorage.getItem("pf-invitation")),
  ).toBeNull();
});
