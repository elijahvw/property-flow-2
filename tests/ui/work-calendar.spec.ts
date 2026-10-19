import { test, expect, Page } from "@playwright/test";
async function fixture(page: Page, allowed = true) {
  const rows = Array.from({ length: 29 }, (_, i) => ({
    id: i === 28 ? "plan" : "request-" + i,
    kind: i === 28 ? "schedule" : "request",
    title:
      i === 28
        ? "Fictional filter replacement"
        : `Fictional repair ${String(i).padStart(2, "0")}`,
    dueOn: "2026-10-18T00:00:00.000Z",
    timezone: "America/New_York",
    overdue: false,
    priority: "normal",
    status: "open",
    propertyName: "Fictional Home",
    unitLabel: null,
  }));
  const state = { reads: [] as string[], fail: false };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      json = (body: unknown, status = 200) =>
        route.fulfill({ json: body, status });
    state.reads.push(path + url.search);
    if (path === "/api/bootstrap")
      return json({
        user: {
          id: "manager",
          name: "Fictional manager",
          email: "manager@test.invalid",
          status: "active",
          emailVerified: true,
        },
        membership: {
          companyId: "company",
          role: allowed ? "manager" : "staff",
          version: 1,
          status: "active",
          company: { name: "Fictional company", status: "active" },
        },
        permissions: allowed
          ? ["property.read", "maintenance.manage"]
          : ["property.read"],
        destination: "/company/maintenance",
        csrfToken: "fixture",
      });
    if (path === "/api/telemetry") return json({ accepted: true });
    if (path === "/api/account/guide") return json({ eligible: false });
    if (path === "/api/company/properties")
      return json([{ id: "home", name: "Fictional Home" }]);
    if (path === "/api/company/work-calendar") {
      if (state.fail)
        return json({ error: "Calendar temporarily unavailable." }, 503);
      const month = url.searchParams.get("month") || "2026-10",
        day = url.searchParams.get("day"),
        kind = url.searchParams.get("kind") || "all",
        page = Number(url.searchParams.get("page") || 1),
        all = rows.filter(
          (row) =>
            row.dueOn.slice(0, 7) === month &&
            (kind === "all" || row.kind === kind),
        ),
        filtered = all.filter((row) => !day || row.dueOn.slice(0, 10) === day);
      return json({
        month,
        day,
        today: "2026-10-18",
        timezone: "America/New_York",
        days: all.length
          ? [
              {
                dueOn: "2026-10-18",
                total: all.length,
                schedules: all.filter((x) => x.kind === "schedule").length,
                requests: all.filter((x) => x.kind === "request").length,
                overdue: 0,
              },
            ]
          : [],
        items: filtered.slice((page - 1) * 25, page * 25),
        total: filtered.length,
        monthTotal: all.length,
        page,
        pageSize: 25,
      });
    }
    if (path === "/api/company/preventive/plan")
      return json({
        id: "plan",
        title: rows[28].title,
        description: "Fictional instructions",
        propertyId: "home",
        unitId: null,
        category: "hvac",
        priority: "normal",
        cadence: "monthly",
        anchorOn: "2026-01-18",
        nextOn: "2026-10-18",
        endOn: null,
        timezone: "America/New_York",
        today: "2026-10-18",
        status: "active",
        version: 1,
        property: { name: "Fictional Home" },
        unit: null,
      });
    if (path.endsWith("/occurrences") || path.endsWith("/history"))
      return json({ items: [], total: 0, pageSize: 25 });
    return json([]);
  });
  return state;
}
test("calendar day counts are complete across pages and selection does not change month totals", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/company/work-calendar?month=2026-10");
  await expect(
    page.getByText("29 items this month", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /October 18, 2026, 29 items/ })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "29 matching items" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Next work items", exact: true })
    .click();
  await expect(
    page.getByRole("link", {
      name: "Fictional filter replacement",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("29 items this month", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: /October 19, 2026, 0 items/ }).click();
  await expect(
    page.getByText("No work matches this view.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("29 items this month", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show whole month", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "29 matching items" }),
  ).toBeVisible();
});
test("source links return to the exact calendar month, selected day and filters", async ({
  page,
}) => {
  await fixture(page);
  await page.goto(
    "/company/work-calendar?month=2026-10&propertyId=home&kind=schedule&day=2026-10-18",
  );
  await page
    .getByRole("link", { name: "Fictional filter replacement", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Fictional filter replacement",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Back to work calendar →", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Filter property", exact: true }),
  ).toHaveValue("home");
  await expect(
    page.getByRole("combobox", { name: "Work type", exact: true }),
  ).toHaveValue("schedule");
  await expect(
    page.getByRole("heading", { name: "October 18, 2026", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "1 matching item" }),
  ).toBeVisible();
});
test("month navigation clears stale selection and Today uses the company local day", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/company/work-calendar?month=2026-10&day=2026-10-18");
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "November 2026", exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/day=/);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "October 18, 2026", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Previous month", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "September 2026", exact: true }),
  ).toBeVisible();
});
test("calendar failure shows retry without fabricated empty counts", async ({
  page,
}) => {
  const s = await fixture(page);
  s.fail = true;
  await page.goto("/company/work-calendar");
  await expect(page.getByRole("alert")).toContainText(
    "Calendar temporarily unavailable",
  );
  await expect(
    page.getByText("No work matches this view.", { exact: true }),
  ).toHaveCount(0);
  s.fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "29 matching items" }),
  ).toBeVisible();
});
test("phone calendar dates, counts and agenda fit without horizontal overflow", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/work-calendar?month=2026-10");
  await expect(
    page.getByRole("table", { name: "October 2026 work dates", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /October 18, 2026, 29 items/ })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "29 matching items" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: /October 18, 2026, 29 items/ }),
  ).toHaveAttribute("aria-pressed", "true");
});
test("staff cannot request private calendar data through a direct route", async ({
  page,
}) => {
  const s = await fixture(page, false);
  await page.goto("/company/work-calendar");
  await expect(
    page.getByRole("heading", { name: "Access unavailable", exact: true }),
  ).toBeVisible();
  expect(
    s.reads.filter((x) => x.startsWith("/api/company/work-calendar")),
  ).toHaveLength(0);
});
