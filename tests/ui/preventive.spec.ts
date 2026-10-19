import { test, expect, Page } from "@playwright/test";
async function fixture(page: Page, allowed = true) {
  const row = {
    id: "plan-1",
    title: "Fictional safety check",
    description: "Review fictional equipment.",
    propertyId: "home",
    unitId: null,
    category: "safety",
    priority: "normal",
    cadence: "monthly",
    anchorOn: "2026-01-31",
    endOn: null,
    nextOn: "2026-02-28",
    timezone: "America/New_York",
    today: "2026-10-18",
    status: "active",
    version: 1,
    property: { name: "Fictional home" },
    unit: null,
  };
  const writes: any[] = [],
    reads: string[] = [];
  let lose = false;
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    reads.push(path + url.search);
    const json = (body: unknown, status = 200) =>
      route.fulfill({ json: body, status });
    if (path === "/api/bootstrap")
      return json({
        user: {
          id: "manager",
          email: "manager@test.invalid",
          status: "active",
          emailVerified: true,
        },
        membership: {
          companyId: "fictional-company",
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
    if (path === "/api/account/guide") return json({ eligible: false });
    if (path === "/api/telemetry") return json({ accepted: true });
    if (path === "/api/company/properties")
      return json([{ id: "home", name: "Fictional home" }]);
    if (path.endsWith("/units")) return json({ items: [], nextCursor: null });
    if (path === "/api/company/preventive" && req.method() === "GET")
      return json({
        items: [{ ...row }],
        total: 1,
        pageSize: 25,
        timezone: "America/New_York",
      });
    if (
      req.method() === "GET" &&
      (path.endsWith("/history") || path.endsWith("/occurrences"))
    )
      return json({ items: [], total: 0, pageSize: 25 });
    if (req.method() === "GET" && path === "/api/company/preventive/plan-1")
      return json({ ...row });
    if (req.method() !== "GET") {
      const body = req.postDataJSON();
      writes.push({ path, body });
      if (body.expectedVersion && body.expectedVersion !== row.version)
        return json(
          { error: "This record changed. Reload before editing." },
          409,
        );
      if (path.endsWith("/occurrences")) {
        if (lose) {
          lose = false;
          return route.abort("failed");
        }
        row.version++;
        row.nextOn = "2026-03-31";
        return json({
          planId: row.id,
          requestId: body.outcome === "generated" ? "request-1" : null,
        });
      }
      if (path === "/api/company/preventive") {
        Object.assign(row, body);
        return json({ planId: row.id });
      }
      Object.assign(row, body, { version: row.version + 1 });
      return json({ planId: row.id });
    }
    return json([]);
  });
  return {
    row,
    writes,
    reads,
    lose: () => {
      lose = true;
    },
  };
}
test("create schedule validates and connects to its detail without silently generating work", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.goto("/company/preventive");
  await page.getByRole("button", { name: "Add schedule", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Property", { exact: true }).selectOption("home");
  await d.getByLabel("Title", { exact: true }).fill("Fictional safety check");
  await d
    .getByLabel("Instructions", { exact: true })
    .fill("Review fictional equipment.");
  await d.getByLabel("First due date", { exact: true }).fill("2026-01-31");
  await d.getByRole("button", { name: "Create schedule", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Fictional safety check", exact: true }),
  ).toBeVisible();
  expect(s.writes).toHaveLength(1);
  expect(s.writes[0].body.unitId).toBe(null);
  expect(s.writes[0].body.anchorOn).toBe("2026-01-31");
  await expect(
    page.getByText("America/New_York", { exact: false }).first(),
  ).toBeVisible();
});
test("explicit page-only schedule draft can be resumed or discarded", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.goto("/company/preventive");
  await page.getByRole("button", { name: "Add schedule", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Title", { exact: true }).fill("Explicit draft");
  await d.getByRole("button", { name: "Close", exact: true }).click();
  await d
    .getByRole("button", { name: "Save draft & close", exact: true })
    .click();
  await page.getByRole("button", { name: "Add schedule", exact: true }).click();
  await expect(d.getByLabel("Title", { exact: true })).toHaveValue(
    "Explicit draft",
  );
  await d.getByLabel("Title", { exact: true }).fill("Changed");
  await d.getByRole("button", { name: "Close", exact: true }).click();
  await d
    .getByRole("button", { name: "Close without saving", exact: true })
    .click();
  await page.getByRole("button", { name: "Add schedule", exact: true }).click();
  await expect(d.getByLabel("Title", { exact: true })).toHaveValue("");
  expect(s.writes).toHaveLength(0);
});
test("pause is a reviewed versioned edit and retains the next due date", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.goto("/company/preventive/plan-1");
  await page
    .getByRole("button", { name: "Edit schedule", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Schedule status", { exact: true }).selectOption("paused");
  await d
    .getByRole("button", { name: "Save schedule changes", exact: true })
    .click();
  await expect(
    page.getByText(
      "Paused. Edit this schedule to resume at the retained due date.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create next request", exact: true }),
  ).toHaveCount(0);
  expect(s.row.nextOn).toBe("2026-02-28");
  expect(s.writes[0].body.expectedVersion).toBe(1);
});
test("stale occurrence review preserves the reviewed date and surfaces conflict", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.goto("/company/preventive/plan-1");
  await page
    .getByRole("button", { name: "Skip occurrence", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByLabel("Reason for skipping", { exact: true })
    .fill("Fictional reason");
  s.row.version = 2;
  s.row.nextOn = "2026-03-31";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await d.getByRole("button", { name: "Confirm skip", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("This record changed");
  expect(s.writes[0].body.dueOn).toBe("2026-02-28");
  expect(s.writes[0].body.expectedVersion).toBe(1);
  await expect(
    d.getByLabel("Reason for skipping", { exact: true }),
  ).toHaveValue("Fictional reason");
});
test("request and skip drafts remain separate and interrupted request retries keep the exact payload", async ({
  page,
}) => {
  const s = await fixture(page);
  await page.goto("/company/preventive/plan-1");
  await page
    .getByRole("button", { name: "Skip occurrence", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByLabel("Reason for skipping", { exact: true })
    .fill("Separate saved reason");
  await d.getByRole("button", { name: "Save as draft", exact: true }).click();
  await page
    .getByRole("button", { name: "Create next request", exact: true })
    .click();
  await expect(
    d.getByRole("heading", { name: "Review next request", exact: true }),
  ).toBeVisible();
  s.lose();
  await d
    .getByRole("button", { name: "Create maintenance request", exact: true })
    .click();
  await expect(
    d.getByText("This request may already be saved.", { exact: false }),
  ).toBeVisible();
  await d
    .getByRole("button", { name: "Create maintenance request", exact: true })
    .click();
  await expect(d).not.toBeVisible();
  expect(s.writes).toHaveLength(2);
  expect(s.writes[0].body).toEqual(s.writes[1].body);
  await page
    .getByRole("button", { name: "Skip occurrence", exact: true })
    .click();
  await expect(
    d.getByLabel("Reason for skipping", { exact: true }),
  ).toHaveValue("Separate saved reason");
});
test("mobile schedules have usable controls and staff are denied before private requests", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/preventive");
  await expect(
    page.getByRole("link", { name: "Fictional safety check", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "Fictional safety check", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit schedule", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Instructions", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
test("staff cannot open management schedules or detail", async ({ page }) => {
  const s = await fixture(page, false);
  for (const path of ["/company/preventive", "/company/preventive/plan-1"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Access unavailable", exact: true }),
    ).toBeVisible();
  }
  expect(
    s.reads.filter((x) => x.startsWith("/api/company/preventive")),
  ).toHaveLength(0);
});
