import { test, expect, Page } from "@playwright/test";

async function fixture(page: Page, role = "manager") {
  const state = {
    version: 1,
    name: "Jane Resident",
    phone: "",
    notes: "",
    fail: false,
    writes: 0,
    profileLoads: 0,
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    const json = (value: unknown, status = 200) =>
      route.fulfill({ json: value, status });
    if (path === "/api/bootstrap")
      return json({
        user: {
          id: role,
          name: "Alex Manager",
          email: "manager@test.invalid",
          status: "active",
          emailVerified: true,
        },
        membership: {
          companyId: "a",
          role,
          status: "active",
          version: 1,
          company: { id: "a", name: "Oak & Elm Properties", status: "active" },
        },
        permissions:
          role === "manager"
            ? ["property.read", "property.write", "resident.assignment.manage"]
            : role === "staff"
              ? ["property.read"]
              : ["resident.self"],
        destination: role === "resident" ? "/resident" : "/company/properties",
        csrfToken: "fixture",
      });
    if (path === "/api/company/properties")
      return json([
        {
          id: "home",
          name: "Maple House",
          address: "14 Maple Lane",
          city: "Charlotte",
          state: "NC",
          zip: "28202",
        },
      ]);
    if (path.startsWith("/api/company/resident-profiles")) {
      state.profileLoads++;
      if (req.method() === "PATCH") {
        state.writes++;
        expect(req.headers()["x-csrf-token"]).toBe("fixture");
        const body = req.postDataJSON();
        if (state.fail || body.expectedVersion !== state.version)
          return json(
            {
              code: "RECORD_CHANGED",
              error:
                "This record changed. Reload the list before editing again.",
            },
            409,
          );
        state.name = body.contactName;
        state.phone = body.contactPhone;
        state.notes = body.managementNotes;
        state.version++;
      }
      const profile = {
        userId: "resident",
        status: "active",
        version: state.version,
        contactName: state.name,
        contactPhone: state.phone,
        managementNotes: state.notes,
        emergencyContactName: null,
        emergencyContactPhone: null,
        user: {
          name: "Jane Resident",
          email: "jane@test.invalid",
          status: "active",
          emailVerified: true,
        },
      };
      return json(
        path.endsWith("resident-profiles")
          ? [profile]
          : {
              ...profile,
              assignments: [
                {
                  property: {
                    id: "home",
                    name: "Maple House",
                    address: "14 Maple Lane",
                  },
                },
              ],
              activity: [
                {
                  id: "e",
                  action: "membership.assigned",
                  createdAt: "2026-10-14T12:00:00Z",
                },
              ],
            },
      );
    }
    return json([]);
  });
  return state;
}
test("active manager on saved access URL lands in workspace; protected navigation stays role-scoped", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/access");
  await expect(page).toHaveURL(/\/company\/properties$/);
  await expect(
    page.getByRole("heading", { name: "Account access pending" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Tenants", exact: true }),
  ).toBeVisible();
  for (const name of ["Users", "Companies", "Team"])
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Maple House", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Find property").fill("absent");
  await expect(
    page.getByRole("link", { name: "Maple House", exact: true }),
  ).toHaveCount(0);
});
test("resident profile is a focused form with conflict recovery, assignments, activity and mobile layout", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/company/residents");
  const manage = page.getByRole("button", {
    name: "Manage resident",
    exact: true,
  });
  await manage.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Maple House" })).toBeVisible();
  await dialog.getByRole("button", { name: "Edit resident profile" }).click();
  await dialog.getByLabel("Contact phone", { exact: true }).fill("555-0123");
  await dialog.getByLabel("Internal management notes").fill("Call after 5 PM");
  state.version = 2;
  await dialog.getByRole("button", { name: "Save resident profile" }).click();
  await expect(dialog.getByRole("alert")).toContainText("record changed");
  await expect(dialog.getByLabel("Contact phone", { exact: true })).toHaveValue(
    "555-0123",
  );
  await dialog.getByRole("button", { name: "Discard edits" }).click();
  await dialog.getByRole("button", { name: "Edit resident profile" }).click();
  await dialog.getByLabel("Contact phone", { exact: true }).fill("555-0123");
  await dialog.getByLabel("Internal management notes").fill("Call after 5 PM");
  await dialog.getByRole("button", { name: "Save resident profile" }).click();
  await expect(dialog.getByText("555-0123", { exact: true })).toBeVisible();
  expect(state.version).toBe(3);
  expect(state.notes).toBe("Call after 5 PM");
  await dialog.getByText("Resident activity", { exact: true }).click();
  await expect(dialog.getByText("membership assigned")).toBeVisible();
  await page.screenshot({
    path: "/tmp/propertyflow-resident-profile-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/propertyflow-resident-profile-mobile.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(manage).toBeFocused();
});
test("staff and residents cannot mount or fetch management contact records", async ({
  page,
}) => {
  for (const role of ["staff", "resident"]) {
    await page.unroute("**/api/**");
    const state = await fixture(page, role);
    await page.goto("/company/residents");
    await expect(
      page.getByRole("heading", { name: "Access unavailable" }),
    ).toBeVisible();
    expect(state.profileLoads).toBe(0);
  }
});
test("property editor traps focus and keeps a dismissed draft without editing the directory", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/company/properties");
  await page.getByRole("button", { name: "Add property", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Property name", { exact: true }).fill("Draft house");
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Add property", exact: true }).click();
  await expect(dialog.getByLabel("Property name", { exact: true })).toHaveValue(
    "Draft house",
  );
  await page.screenshot({
    path: "/tmp/propertyflow-property-editor-desktop.png",
    fullPage: false,
  });
});
test("resident editor cannot be dismissed while a save is pending", async ({
  page,
}) => {
  await fixture(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    "**/api/company/resident-profiles/resident",
    async (route) => {
      if (route.request().method() === "PATCH") await gate;
      await route.fallback();
    },
  );
  try {
    await page.goto("/company/residents");
    await page.getByRole("button", { name: "Manage resident" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Edit resident profile" }).click();
    await dialog.getByLabel("Contact phone", { exact: true }).fill("555-0123");
    await dialog.getByRole("button", { name: "Save resident profile" }).click();
    await expect(
      dialog.getByRole("button", { name: "Saving…" }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Close", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog.getByText("555-0123", { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Close", exact: true }),
    ).toBeEnabled();
  } finally {
    release();
  }
});
