import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
async function fixture(page: Page, role = "owner") {
  const summary = {
    chargedCents: "100000",
    paidCents: "100000",
    outstandingCents: "0",
    overdueCents: "0",
    afterGraceCents: "0",
    withinGraceCents: "0",
    dueTodayCents: "0",
    upcomingCents: "0",
    creditCents: "0",
    netCents: "0",
    age1To30Cents: "0",
    age31To60Cents: "0",
    age61To90Cents: "0",
    age91PlusCents: "0",
    paidAfterGraceCents: "50000",
    paidLateChargeCount: "1",
  };
  const lease = {
    id: "lease-a",
    propertyId: "home",
    property: { name: "Maple House" },
    unit: { label: "Apartment 1" },
    resident:
      role === "resident"
        ? undefined
        : { name: "Jordan Resident", email: "resident@test.invalid" },
    startsOn: "2026-10-01",
    endsOn: "2027-02-28",
    status: "active",
    rentCents: 100000,
    rentDueDay: 31,
    graceDays: 5,
    paymentInstructions: "Mail checks to the office.",
    version: 1,
  };
  const charge = {
    id: "charge-a",
    periodOn: "2026-09-01",
    dueOn: "2026-09-01",
    graceDays: 5,
    graceThrough: "2026-09-06",
    afterGraceOn: "2026-09-07",
    daysPastDue: 0,
    amountCents: 100000,
    appliedCents: "100000",
    remainingCents: "0",
    collectionStatus: "paid",
    paidLate: true,
    settledOn: "2026-09-10",
    paidAfterGraceCents: "50000",
    version: 1,
    voidedAt: null,
  };
  const preview = [
    {
      periodOn: "2026-10-01",
      postOn: "2026-10-28",
      dueOn: "2026-10-31",
      amountCents: 50000,
      action: "post",
    },
    {
      periodOn: "2026-11-01",
      postOn: "2026-11-27",
      dueOn: "2026-11-30",
      amountCents: 100000,
      action: "post",
    },
    {
      periodOn: "2026-12-01",
      postOn: "2026-12-28",
      dueOn: "2026-12-31",
      amountCents: 100000,
      action: "existing",
    },
  ];
  const state = {
    schedule: null as any,
    lose: false,
    posts: [] as any[],
    patchStatus: 200,
    scheduleStatus: 200,
    requests: [] as string[],
    preview,
    lease,
    summary,
    charge,
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      p = u.pathname,
      json = (v: unknown, status = 200) => route.fulfill({ json: v, status });
    state.requests.push(req.method() + " " + p);
    if (p === "/api/bootstrap")
      return json({
        user: {
          id: role,
          email: role + "@test.invalid",
          status: "active",
          emailVerified: true,
        },
        membership: {
          companyId: "a",
          version: 1,
          role,
          status: "active",
          company: { name: "FAP", status: "active" },
        },
        permissions:
          role === "resident"
            ? ["resident.self"]
            : ["property.read", "finance.manage", "lease.manage"],
        csrfToken: "fixture",
      });
    if (p === "/api/company/properties")
      return json([{ id: "home", name: "Maple House" }]);
    if (p === "/api/company/properties/home")
      return json({ id: "home", name: "Maple House" });
    if (p === "/api/company/rent" || p === "/api/resident/rent")
      return json({
        businessDate: "2026-10-15",
        generatedAt: "2026-10-15T12:00:00Z",
        accounts: [
          { lease, summary, charges: [charge], payments: [], allocations: [] },
        ],
      });
    if (p === "/api/company/rent/lease-a/schedule")
      return state.scheduleStatus === 200
        ? json({
            schedule: state.schedule,
            preview: state.schedule ? preview : [],
            history: [],
            nextCursor: null,
          })
        : json({ error: "Schedule unavailable" }, 503);
    if (p === "/api/company/rent/lease-a/schedule-preview")
      return json({
        businessDate: "2026-10-15",
        preview,
        config: {
          firstPeriodOn: "2026-10-01",
          lastPeriodOn: "2027-02-01",
          amountCents: 100000,
          dueDay: 31,
          graceDays: 5,
          leadDays: 3,
          firstAmountCents: 50000,
          lastAmountCents: null,
          firstDueOn: null,
        },
      });
    if (p === "/api/company/rent/lease-a/schedules") {
      expect(req.headers()["x-csrf-token"]).toBe("fixture");
      const body = req.postDataJSON();
      expect(typeof body).toBe("object");
      state.posts.push(body);
      state.schedule = {
        id: "schedule-a",
        status: "active",
        version: 1,
        firstPeriodOn: body.firstPeriodOn,
        lastPeriodOn: body.lastPeriodOn,
        nextPeriodOn: body.firstPeriodOn,
        amountCents: 100000,
        firstAmountCents: 50000,
        lastAmountCents: null,
        firstDueOn: body.firstDueOn,
        dueDay: 31,
        graceDays: 5,
        leadDays: 3,
        lastCheckedAt: null,
        lastErrorCode: null,
      };
      if (state.lose) {
        state.lose = false;
        return route.abort("failed");
      }
      return json(state.schedule);
    }
    if (
      p === "/api/company/rent-schedules/schedule-a" &&
      req.method() === "PATCH"
    ) {
      if (state.patchStatus !== 200)
        return json(
          {
            error: "This record changed. Reload the list before editing again.",
          },
          409,
        );
      state.schedule = {
        ...state.schedule,
        status: req.postDataJSON().status,
        version: state.schedule.version + 1,
      };
      return json(state.schedule);
    }
    if (p === "/api/company/rent-schedules/schedule-a/run")
      return json({ outcome: "not_due" });
    return json([]);
  });
  return state;
}
async function review(page: Page) {
  await page
    .getByRole("button", { name: "Set up recurring rent", exact: true })
    .click();
  await expect(page.getByText("Step 1 of 2", { exact: false })).toBeVisible();
  await page.getByLabel("Post days before due", { exact: true }).fill("3");
  await page
    .getByLabel("First partial amount (USD, optional)", { exact: true })
    .fill("500.00");
  await page
    .getByRole("button", { name: "Review schedule", exact: true })
    .click();
  await expect(page.getByText("Step 2 of 2", { exact: false })).toBeVisible();
}
test("billing is opt in and reviewed before activation; date preview and mobile primary action stay usable", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/company/rent?leaseId=lease-a");
  await expect(
    page.getByText("Manual billing. No automatic rent charges are enabled."),
  ).toBeVisible();
  await review(page);
  expect(state.posts).toHaveLength(0);
  await expect(page.getByText(/First amount \$500.00; final amount \$1,000.00/)).toBeVisible();
  await expect(
    page.getByText("Post 2026-11-27 · due 2026-11-30"),
  ).toBeVisible();
  await expect(page.getByText("Already posted — no duplicate")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Enable recurring rent", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Enable recurring rent", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/pf-recurring-review-mobile.png" });
  await page
    .getByRole("button", { name: "Enable recurring rent", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Manage billing schedule" }),
  ).toBeVisible();
  expect(state.posts[0]).toMatchObject({
    firstPeriodOn: "2026-10-01",
    lastPeriodOn: "2027-02-01",
    firstAmount: "500.00",
    lastAmount: null,
    leadDays: 3,
    expectedVersion: 1,
  });
});
test("lost activation response survives reload and replays original review even when the schedule already exists", async ({
  page,
}) => {
  const state = await fixture(page);
  state.lose = true;
  await page.goto("/company/rent?leaseId=lease-a");
  await review(page);
  await page
    .getByRole("button", { name: "Enable recurring rent", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Recover reviewed schedule" }).click();
  await expect(
    page.getByText("An earlier attempt may have succeeded.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Retry enabling this schedule" })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0]).toEqual(state.posts[1]);
  await expect(
    page.getByRole("button", { name: "Recover reviewed schedule" }),
  ).not.toBeVisible();
});
test("schedule state conflicts preserve the form and provide an explicit current-status recovery", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/company/rent?leaseId=lease-a");
  await review(page);
  await page
    .getByRole("button", { name: "Enable recurring rent", exact: true })
    .click();
  await page.getByRole("button", { name: "Manage billing schedule" }).click();
  await page.getByLabel("Billing status").selectOption("paused");
  state.patchStatus = 409;
  await page.getByRole("button", { name: "Save billing status" }).click();
  await expect(page.getByRole("alert")).toContainText("record changed");
  await expect(page.getByLabel("Billing status")).toHaveValue("paused");
  await page
    .getByRole("button", { name: "Close and load current status" })
    .click();
  state.patchStatus = 200;
  await page.getByRole("button", { name: "Manage billing schedule" }).click();
  await page.getByLabel("Billing status").selectOption("paused");
  await page.getByRole("button", { name: "Save billing status" }).click();
  await expect(
    page.getByRole("region", { name: "Recurring rent" }),
  ).toContainText("Paused. Resuming catches up");
  await expect(
    page.getByRole("button", { name: "Check next installment" }),
  ).not.toBeVisible();
});
test("a caught-up account retains paid-late history for manager and CSV", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/company/rent?leaseId=lease-a");
  await expect(
    page.getByText("Up to date — no past-due rent", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("paid late", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Paid 2026-09-10", { exact: false }),
  ).toBeVisible();
  await page.screenshot({path:"/tmp/pf-recurring-ledger-desktop.png",fullPage:true});
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ledger CSV" }).click();
  const csv = readFileSync((await (await download).path())!, "utf8");
  expect(csv).toContain("Paid late");
  expect(csv).toContain("2026-09-10");
  expect(csv).toContain("500.00");
  await page.goto("/company/rent?view=paid_late");
  await expect(
    page.getByRole("combobox", { name: "Balance view" }),
  ).toHaveValue("paid_late");
  await expect(
    page.getByText("1 charge paid late", { exact: true }),
  ).toBeVisible();
});
test("resident gets current standing plus late history without manager billing controls", async ({
  page,
}) => {
  const state = await fixture(page, "resident");
  await page.goto("/resident/rent?leaseId=lease-a");
  await expect(
    page.getByText("Up to date — no past-due rent", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("paid late", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Set up recurring rent" }),
  ).not.toBeVisible();
  expect(state.requests.some((p) => p.includes("/schedule"))).toBe(false);
});
test("billing load error keeps existing ledger visible and permits recovery", async ({
  page,
}) => {
  const state = await fixture(page);
  state.scheduleStatus = 503;
  await page.goto("/company/rent?leaseId=lease-a");
  await expect(page.getByRole("alert")).toContainText("Schedule unavailable");
  await expect(page.getByText("paid late", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Set up recurring rent" }),
  ).not.toBeVisible();
  state.scheduleStatus = 200;
  await page.getByRole("button", { name: "Retry billing schedule" }).click();
  await expect(
    page.getByRole("button", { name: "Set up recurring rent" }),
  ).toBeVisible();
});
