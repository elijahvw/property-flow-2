import { test, expect, Page } from "@playwright/test";
async function fixture(page: Page, permission = true) {
  const state = {
    vendors: Array.from({ length: 27 }, (_, index) => ({
      id: `vendor-${index}`,
      name: `Fictional Vendor ${String(index).padStart(2, "0")}`,
      service: index === 26 ? "Plumbing" : "Electrical",
      contactName: "Fictional contact",
      email: "contact@test.invalid",
      phone: "555-0100",
      notes: "Private fixture notes",
      status: "active",
      version: 1,
    })),
    writes: [] as any[],
    reads: [] as string[],
    history: [
      {
        id: "event",
        action: "create",
        actorName: "Fictional manager",
        createdAt: "2026-10-18T12:00:00Z",
        requestId: null,
        snapshot: {
          after: { name: "Fictional Vendor 00", service: "Electrical" },
        },
      },
    ],
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      json = (value: unknown, status = 200) =>
        route.fulfill({ json: value, status });
    state.reads.push(path + url.search);
    if (path === "/api/bootstrap")
      return json({
        user: {
          id: "fictional-manager",
          name: "Fictional manager",
          email: "manager@test.invalid",
          status: "active",
          emailVerified: true,
        },
        membership: {
          companyId: "fictional-company",
          role: permission ? "manager" : "staff",
          version: 1,
          status: "active",
          company: { name: "Fictional company", status: "active" },
        },
        permissions: permission
          ? ["property.read", "maintenance.manage"]
          : ["property.read"],
        destination: "/company/maintenance",
        csrfToken: "fixture",
      });
    if (path === "/api/account/guide") return json({ eligible: false });
    if (path === "/api/telemetry") return json({ accepted: true });
    if (path.endsWith("/history"))
      return json({ items: state.history, nextCursor: null });
    if (path.endsWith("/requests"))
      return json({
        items: [
          {
            id: "request-1",
            title: "Fictional repair",
            status: "open",
            property: { name: "Fictional home" },
            unit: null,
          },
        ],
        total: 1,
        pageSize: 25,
      });
    if (path === "/api/company/vendors") {
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        state.writes.push(body);
        const row = { ...state.vendors[0], ...body, id: "created-vendor" };
        state.vendors.push(row);
        return json({ saved: true, vendorId: row.id });
      }
      const q = (url.searchParams.get("q") || "").toLowerCase(),
        status = url.searchParams.get("status") || "active",
        currentPage = Number(url.searchParams.get("page") || 1);
      const rows = state.vendors.filter(
        (v) =>
          (status === "all" || v.status === status) &&
          `${v.name} ${v.service} ${v.email}`.toLowerCase().includes(q),
      );
      return json({
        items: rows.slice((currentPage - 1) * 25, currentPage * 25),
        total: rows.length,
        page: currentPage,
        pageSize: 25,
      });
    }
    if (path.startsWith("/api/company/vendors/")) {
      const vendor = state.vendors.find((v) => v.id === path.split("/").pop());
      if (!vendor) return json({ error: "Vendor not found" }, 404);
      if (req.method() === "PATCH") {
        const body = req.postDataJSON();
        state.writes.push(body);
        if (body.expectedVersion !== vendor.version)
          return json(
            {
              error:
                "This record changed. Reload the list before editing again.",
            },
            409,
          );
        Object.assign(vendor, body, { version: vendor.version + 1 });
        return json({ saved: true, vendorId: vendor.id });
      }
      return json({ ...vendor });
    }
    return json([]);
  });
  return state;
}
test("vendor search filters the complete directory before paging and retains context after detail", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/company/vendors");
  await expect(
    page.getByText("27 matching vendors", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/pf-vendors-directory-desktop.png" });
  await page.getByRole("button", { name: "Next vendors", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Fictional Vendor 26", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search vendors", exact: true })
    .fill("Plumbing");
  await expect(
    page.getByText("1 matching vendor", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Fictional Vendor 26", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Fictional Vendor 26", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Fictional repair", exact: true }),
  ).toHaveAttribute(
    "href",
    "/company/maintenance/request-1?vendorId=vendor-26",
  );
  await page
    .getByRole("link", { name: "← Back to vendors", exact: true })
    .click();
  await expect(
    page.getByRole("searchbox", { name: "Search vendors", exact: true }),
  ).toHaveValue("Plumbing");
  await expect(
    page.getByText("1 matching vendor", { exact: true }),
  ).toBeVisible();
});
test("new vendor input is retained only by explicit page-only draft saving", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/company/vendors");
  await page.getByRole("button", { name: "Add vendor", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Vendor name", { exact: true })
    .fill("Explicit fictional draft");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Keep editing", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Save draft & close", exact: true })
    .click();
  await page.getByRole("button", { name: "Add vendor", exact: true }).click();
  await expect(dialog.getByLabel("Vendor name", { exact: true })).toHaveValue(
    "Explicit fictional draft",
  );
  await dialog
    .getByLabel("Vendor name", { exact: true })
    .fill("Explicit fictional draft changed");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Close without saving", exact: true })
    .click();
  await page.getByRole("button", { name: "Add vendor", exact: true }).click();
  await expect(dialog.getByLabel("Vendor name", { exact: true })).toHaveValue(
    "",
  );
  await dialog
    .getByLabel("Vendor name", { exact: true })
    .fill("Refresh discards fixture");
  await dialog
    .getByRole("button", { name: "Save as draft", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "Add vendor", exact: true }).click();
  await expect(dialog.getByLabel("Vendor name", { exact: true })).toHaveValue(
    "",
  );
  expect(state.writes).toHaveLength(0);
});
test("a stale vendor edit preserves original values and version until explicitly discarded", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/company/vendors/vendor-0");
  await page.getByRole("button", { name: "Edit vendor", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Phone (optional)", { exact: true }).fill("555-0199");
  state.vendors[0].version = 2;
  state.vendors[0].phone = "555-0188";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await dialog
    .getByRole("button", { name: "Save vendor changes", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("This record changed");
  await expect(
    dialog.getByLabel("Phone (optional)", { exact: true }),
  ).toHaveValue("555-0199");
  expect(state.writes[0].expectedVersion).toBe(1);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Close without saving", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "Edit vendor", exact: true }).click();
  await expect(
    dialog.getByLabel("Phone (optional)", { exact: true }),
  ).toHaveValue("555-0188");
  await dialog
    .getByRole("button", { name: "Save vendor changes", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(state.writes[1].expectedVersion).toBe(2);
});
test("archive and restore use the existing contact and preserve recorded history", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/company/vendors/vendor-0?requestId=request-1");
  await expect(
    page.getByRole("link", { name: "Back to request →", exact: true }),
  ).toHaveAttribute("href", "/company/maintenance/request-1");
  await page.getByRole("button", { name: "Edit vendor", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("archived");
  await page
    .getByRole("button", { name: "Save vendor changes", exact: true })
    .click();
  await expect(
    page.getByText("Archived · existing request links are retained", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "← Back to vendors", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Vendor status", exact: true })
    .selectOption("archived");
  await expect(
    page.getByText("1 matching vendor", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Fictional Vendor 00", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit vendor", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("active");
  await page
    .getByRole("button", { name: "Save vendor changes", exact: true })
    .click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await page.getByText("Vendor history", { exact: true }).click();
  await expect(page.getByText("Vendor added", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Fictional manager", { exact: false }).last(),
  ).toBeVisible();
  expect(state.vendors).toHaveLength(27);
  expect(state.writes.map((row) => row.expectedVersion)).toEqual([1, 2]);
});
test("vendor details and editor remain usable on a phone", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/vendors");
  await expect(
    page.getByText("27 matching vendors", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/pf-vendors-directory-mobile.png" });
  await page.goto("/company/vendors/vendor-0");
  await expect(
    page.getByRole("heading", { name: "Fictional Vendor 00", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit vendor", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Vendor name", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/pf-vendor-editor-mobile.png" });
});
test("staff cannot open the management vendor directory or detail", async ({
  page,
}) => {
  const state = await fixture(page, false);
  for (const url of ["/company/vendors", "/company/vendors/vendor-0"]) {
    await page.goto(url);
    await expect(
      page.getByRole("heading", { name: "Access unavailable", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit vendor", exact: true }),
    ).toHaveCount(0);
  }
  expect(
    state.reads.filter((path) => path.startsWith("/api/company/vendors")),
  ).toHaveLength(0);
});
