import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function fixture(page: Page, role = "owner") {
  const statement = {
    generatedAt: "2026-10-16T12:00:00Z",
    businessDate: "2026-10-16",
    company: { name: "Oak & Elm Properties", timezone: "America/New_York" },
    currency: "USD",
    lease: {
      id: "lease-a",
      propertyId: "home",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
      status: "active",
      property: {
        name: "Maple House",
        address: "14 Maple Lane",
        city: "Philadelphia",
        state: "PA",
        zip: "19106",
        countryCode: "US",
      },
      unit: { label: "Apartment 1" },
    },
    filters: { dateFrom: null, dateTo: null } as {
      dateFrom: string | null;
      dateTo: string | null;
    },
    basis:
      "Rent charges use their due date; receipts use the date received. Current record status at generation time, not historical as-of balances. Deposits are separate.",
    current: {
      outstandingCents: "75001",
      creditCents: "0",
      netCents: "75001",
      overdueCents: "75001",
      afterGraceCents: "75001",
      withinGraceCents: "0",
      dueTodayCents: "0",
      upcomingCents: "0",
      paidLateChargeCount: "1",
      paidAfterGraceCents: "100000",
    },
    period: {
      openingNetCents: "0",
      chargedCents: "200001",
      receivedCents: "125000",
      closingNetCents: "75001",
      laterNetCents: "0",
      currentNetCents: "75001",
      recordCount: 4,
      voidedCount: 0,
    },
    items: [
      {
        type: "charge",
        id: "charge-sep",
        reference: "RC-101",
        date: "2026-09-01",
        periodOn: "2026-09-01",
        amountCents: "100000",
        appliedCents: "100000",
        remainingCents: "0",
        status: "paid_late",
        graceThrough: "2026-09-06",
        settledOn: "2026-09-08",
        voidedAt: null,
        createdAt: "2026-09-01T12:00:00Z",
        scheduleId: "schedule-a",
        effectCents: "100000",
        runningNetCents: "100000",
      },
      {
        type: "receipt",
        id: "receipt-sep",
        reference: "TX-201",
        date: "2026-09-08",
        periodOn: null,
        amountCents: "100000",
        appliedCents: "100000",
        remainingCents: "0",
        status: "fully_applied",
        graceThrough: null,
        settledOn: null,
        voidedAt: null,
        createdAt: "2026-09-08T12:00:00Z",
        scheduleId: null,
        effectCents: "-100000",
        runningNetCents: "0",
      },
      {
        type: "charge",
        id: "charge-oct",
        reference: "RC-102",
        date: "2026-10-01",
        periodOn: "2026-10-01",
        amountCents: "100001",
        appliedCents: "25000",
        remainingCents: "75001",
        status: "past_grace",
        graceThrough: "2026-10-06",
        settledOn: null,
        voidedAt: null,
        createdAt: "2026-10-01T12:00:00Z",
        scheduleId: "schedule-a",
        effectCents: "100001",
        runningNetCents: "100001",
      },
      {
        type: "receipt",
        id: "receipt-oct",
        reference: "TX-202",
        date: "2026-10-10",
        periodOn: null,
        amountCents: "25000",
        appliedCents: "25000",
        remainingCents: "0",
        status: "fully_applied",
        graceThrough: null,
        settledOn: null,
        voidedAt: null,
        createdAt: "2026-10-10T12:00:00Z",
        scheduleId: null,
        effectCents: "-25000",
        runningNetCents: "75001",
      },
    ],
    allocations: [
      {
        id: "allocation-a",
        amountCents: "25000",
        createdAt: "2026-10-10T12:00:00Z",
        chargeId: "charge-oct",
        chargeReference: "RC-102",
        chargeDate: "2026-10-01",
        receiptId: "receipt-oct",
        receiptReference: "TX-202",
        receiptDate: "2026-10-10",
        active: true,
      },
    ],
    deposit: {
      id: "deposit-a",
      reference: "DA-101",
      dueOn: "2026-01-01",
      requiredCents: "150000",
      heldCents: "75050",
      outstandingCents: "74950",
      excessHeldCents: "0",
      pastDueCents: "74950",
    },
  };
  const state = { statement, status: 200, requests: [] as string[] };
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    state.requests.push(u.pathname + u.search);
    if (u.pathname === "/api/bootstrap")
      return route.fulfill({
        json: {
          user: {
            id: role,
            email: `${role}@test.invalid`,
            status: "active",
            emailVerified: true,
          },
          membership: {
            companyId: "a",
            role,
            status: "active",
            version: 1,
            company: { name: "Oak & Elm Properties", status: "active" },
          },
          permissions:
            role === "resident"
              ? ["resident.self"]
              : role === "staff"
                ? ["property.read"]
                : [
                    "property.read",
                    "lease.manage",
                    "finance.manage",
                    "resident.assignment.manage",
                  ],
          csrfToken: "fixture",
        },
      });
    if (/\/statements\//.test(u.pathname)) {
      if (state.status !== 200)
        return route.fulfill({
          status: state.status,
          json: { error: "Statement access unavailable" },
        });
      statement.filters = {
        dateFrom: u.searchParams.get("dateFrom"),
        dateTo: u.searchParams.get("dateTo"),
      };
      return route.fulfill({ json: statement });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}

test("statement presents grouped address, current balances, activity and allocation details", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    "/company/leases/lease-a/statement?statementFrom=lease&tenantId=tenant-a&tenantQ=Jordan",
  );
  await expect(
    page.getByRole("heading", { name: "Tenant statement", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Current lease balances" }),
  ).toContainText("$750.01");
  await expect(
    page.getByRole("region", { name: "Current lease balances" }),
  ).toContainText("$750.50");
  await expect(page.locator("address")).toHaveText(
    "14 Maple LanePhiladelphia, PA 19106US",
  );
  await expect(page.getByRole("table").first()).toContainText(
    "September 8, 2026",
  );
  await expect(page.getByRole("table").first()).toContainText("Paid late");
  await expect(page.getByRole("table").first()).toContainText("Past grace");
  await page.locator(".statement-allocations summary").click();
  await expect(
    page.getByRole("table", { name: "Receipt-to-charge allocation details" }),
  ).toContainText("TX-202");
  await expect(
    page.getByRole("link", { name: "Back to lease workspace" }),
  ).toHaveAttribute(
    "href",
    "/company/leases/lease-a?tenantId=tenant-a&tenantQ=Jordan",
  );
  await expect(
    page.getByRole("link", { name: "Back to tenant", exact: false }),
  ).toHaveAttribute("href", "/company/residents/tenant-a?q=Jordan");
  await page.screenshot({
    path: "/tmp/propertyflow-statement-desktop.png",
    fullPage: true,
  });
});

test("month-name date filters apply together, persist on refresh and retain return context", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto(
    "/company/leases/lease-a/statement?propertyId=home&leaseReturn=lease-a&tenantId=tenant-a",
  );
  await page
    .getByLabel("Statement from date", { exact: true })
    .fill("2026-10-01");
  await page
    .getByLabel("Statement through date", { exact: true })
    .fill("2026-10-31");
  await expect(page.locator(".statement-date-fields")).toContainText(
    "October 1, 2026",
  );
  await expect(
    page.getByRole("button", { name: "Download statement CSV" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Apply dates" }).click();
  await expect(
    page.getByRole("button", { name: "Download statement CSV" }),
  ).toBeEnabled();
  expect(
    state.requests.some((url) =>
      url.includes("dateFrom=2026-10-01&dateTo=2026-10-31"),
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByLabel("Statement from date", { exact: true }),
  ).toHaveValue("2026-10-01");
  await expect(
    page.getByRole("link", { name: "Back to rent ledger" }),
  ).toHaveAttribute(
    "href",
    "/company/properties/home/rent?tenantId=tenant-a&leaseId=lease-a&leaseReturn=lease-a",
  );
  await page.getByRole("button", { name: "All activity", exact: true }).click();
  await expect(
    page.getByLabel("Statement from date", { exact: true }),
  ).toHaveValue("");
  await expect(page).not.toHaveURL(/dateFrom=/);
});

test("CSV exports complete source and allocation IDs, numeric cents and safe text across UI pages", async ({
  page,
}) => {
  const state = await fixture(page);
  state.statement.lease.property.name = "=Maple, House";
  const row = state.statement.items[0];
  state.statement.items = Array.from({ length: 27 }, (_, i) => ({
    ...row,
    id: `charge-${i}`,
    reference: `RC-${i}`,
    amountCents: "101",
    effectCents: "101",
    appliedCents: "0",
    remainingCents: "101",
    status: "past_grace",
    runningNetCents: String((i + 1) * 101),
  }));
  Object.assign(state.statement.period, {
    chargedCents: "2727",
    receivedCents: "0",
    closingNetCents: "2727",
    currentNetCents: "2727",
    recordCount: 27,
  });
  Object.assign(state.statement.current, {
    outstandingCents: "2727",
    netCents: "2727",
  });
  await page.goto("/company/leases/lease-a/statement");
  await expect(page.getByRole("table").first().locator("tbody tr")).toHaveCount(
    25,
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download statement CSV" }).click();
  const file = await download;
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv).toContain('"\'=Maple, House"');
  expect(csv).toContain('"RC-26","charge-26"');
  expect(csv).toContain('"Period charges USD",27.27');
  expect(csv).toContain('"allocation-a","TX-202","receipt-oct"');
  expect(csv).not.toMatch(/memo|paymentReference|PRIVATE/);
  await page.getByRole("button", { name: "Next activity" }).click();
  await expect(page.getByRole("table").first().locator("tbody tr")).toHaveCount(
    2,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(page.getByRole("table").first().locator("tbody tr")).toHaveCount(
    27,
  );
  await expect(page.locator(".statement-allocations")).toHaveAttribute(
    "open",
    "",
  );
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await expect(page.getByRole("table").first()).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.getByRole("table").first().locator("tbody tr")).toHaveCount(
    2,
  );
});

test("empty periods remain understandable and failed refreshes clear totals and export", async ({
  page,
}) => {
  const state = await fixture(page);
  state.statement.items = [];
  state.statement.allocations = [];
  state.statement.period.recordCount = 0;
  await page.goto("/company/leases/lease-a/statement");
  await expect(
    page.getByRole("heading", { name: "No rent activity in this period" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Current lease balances" }),
  ).toContainText("$750.01");
  state.status = 403;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Statement unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "Tenant statement document" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Download statement CSV" }),
  ).toHaveCount(0);
  state.status = 200;
  await page.getByRole("button", { name: "Try statement again" }).click();
  await expect(
    page.getByRole("article", { name: "Tenant statement document" }),
  ).toBeVisible();
});

test("resident statement uses their API and returns to their rent without management navigation", async ({
  page,
}) => {
  const state = await fixture(page, "resident");
  await page.goto("/resident/leases/lease-a/statement?tenantId=other");
  await expect(
    page.getByRole("article", { name: "Tenant statement document" }),
  ).toBeVisible();
  expect(
    state.requests.some((url) =>
      url.startsWith("/api/resident/statements/lease-a"),
    ),
  ).toBe(true);
  expect(state.requests.some((url) => url.startsWith("/api/company/"))).toBe(
    false,
  );
  await expect(
    page.getByRole("link", { name: "Back to rent ledger" }),
  ).toHaveAttribute("href", "/resident/rent?tenantId=other&leaseId=lease-a");
  await expect(
    page.getByRole("link", { name: "Back to tenant", exact: false }),
  ).toHaveCount(0);
});

test("mobile statement keeps forms readable and contains wide activity tables", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/leases/lease-a/statement");
  await expect(
    page.getByRole("article", { name: "Tenant statement document" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const boxes = await page
    .locator(".statement-date-fields label")
    .evaluateAll((labels) =>
      labels.map((label) => {
        const rect = label.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width };
      }),
    );
  expect(boxes[0].width).toBeGreaterThan(250);
  expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
  await page.screenshot({
    path: "/tmp/propertyflow-statement-mobile.png",
    fullPage: true,
  });
});

test("staff direct statement URL is denied before requesting financial data", async ({
  page,
}) => {
  const state = await fixture(page, "staff");
  await page.goto("/company/leases/lease-a/statement");
  await expect(
    page.getByRole("heading", { name: "Access unavailable" }),
  ).toBeVisible();
  expect(state.requests.some((url) => url.includes("/statements/"))).toBe(
    false,
  );
});
