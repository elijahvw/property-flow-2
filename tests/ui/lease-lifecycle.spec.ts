import { test, expect, type Page } from "@playwright/test";
async function fixture(page: Page) {
  const old = {
      id: "review",
      propertyId: "home",
      unitId: "unit",
      residentId: "tenant",
      status: "active",
      version: 11,
      startsOn: "2026-09-01",
      endsOn: "2026-10-15",
      rentCents: 150000,
      rentDueDay: 1,
      graceDays: 5,
      paymentInstructions: null,
      property: { name: "Maple House" },
      unit: { label: "Unit B" },
      resident: { name: "Test Tenant", email: "test@preview.invalid" },
      renewals: [{ id: "new", status: "draft", startsOn: "2026-10-16" }],
    },
    next = {
      ...old,
      id: "new",
      previousLeaseId: "review",
      status: "draft",
      version: 12,
      startsOn: "2026-10-16",
      endsOn: "2026-12-10",
      rentCents: 180000,
      graceDays: 3,
    },
    calculation = {
      policy: "actual_calendar_month",
      periodOn: "2026-10-01",
      fromOn: "2026-10-01",
      throughOn: "2026-10-15",
      throughExclusiveOn: "2026-10-16",
      days: 15,
      daysInMonth: 31,
      monthlyCents: 150000,
      calculatedCents: 72581,
      partial: true,
      rounding: "Nearest cent, half up",
    },
    state = { malformed: false, writes: [] as any[] };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      p = new URL(req.url()).pathname,
      json = (d: unknown, status = 200) => route.fulfill({ json: d, status });
    if (p === "/api/bootstrap")
      return json({
        user: {
          id: "owner",
          email: "owner@preview.invalid",
          status: "active",
          emailVerified: true,
        },
        membership: {
          companyId: "a",
          version: 1,
          role: "owner",
          status: "active",
          company: { name: "Local preview", status: "active" },
        },
        permissions: [
          "property.read",
          "lease.manage",
          "finance.manage",
          "members.manage",
        ],
        csrfToken: "fixture",
      });
    if (p === "/api/company/leases/review") return json(old);
    if (p === "/api/company/leases/review/transition")
      return json(
        state.malformed
          ? []
          : {
              lease: old,
              successor: next,
              current: { rentCents: 150000 },
              businessDate: "2026-10-16",
              balances: { outstandingCents: "0", creditCents: "0" },
              deposit: { heldCents: "150000" },
              history: [],
            },
      );
    if (p === "/api/company/leases/review/transition/preview") {
      const b = req.postDataJSON();
      state.writes.push(b);
      return json({
        kind: "renew",
        endsOn: "2026-10-15",
        reason: b.reason,
        ready: true,
        readyOn: "2026-10-16",
        blockers: [],
        businessDate: "2026-10-16",
        oldFinal: {
          calculation,
          recordedCharge: null,
          scheduledAmountCents: 150000,
        },
        oldBilling: { status: "active", action: "stop" },
        pauseBilling: false,
        newTerm: {
          lease: next,
          terms: { rentCents: 180000, rentDueDay: 1, graceDays: 3 },
          first: {
            ...calculation,
            fromOn: "2026-10-16",
            throughOn: "2026-10-31",
            throughExclusiveOn: "2026-11-01",
            days: 16,
            monthlyCents: 180000,
            calculatedCents: 92903,
          },
          last: null,
          firstDueOn: "2026-10-16",
          firstAmountCents: 92903,
          firstOverrideReason: null,
          billing: b.newBilling,
        },
        oldInstallments: [
          {
            periodOn: "2026-10-01",
            calculation,
            amountCents: 72581,
            dueOn: "2026-10-01",
            graceDays: 5,
            action: "post",
            chargeId: null,
            reference: null,
            amountOverride: false,
          },
        ],
        projectedBalances: { outstandingCents: "72581", creditCents: "0" },
        balances: { outstandingCents: "0", creditCents: "0" },
        deposit: { heldCents: "150000" },
        sourceHash: "a".repeat(64),
      });
    }
    return json([]);
  });
  return state;
}
test("renewal review preserves exact old grace and makes both proration amounts and billing choice readable", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/leases/review?section=renewal");
  await page
    .getByRole("button", { name: "Review lease change", exact: true })
    .click();
  await page
    .getByLabel("Future rent charges", { exact: true })
    .selectOption("recurring");
  await page
    .getByLabel("Reason for the lease change", { exact: true })
    .fill("Reviewed lease renewal");
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Lease dates", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("dialog").getByText("$929.03", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByText("How these amounts were calculated", { exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Due October 1, 2026 · 5 calendar days grace.", {
        exact: true,
      }),
  ).toBeVisible();
  expect(state.writes[0]).toMatchObject({
    expectedLeaseVersion: 11,
    expectedSuccessorVersion: 12,
    newBilling: "recurring",
    depositDisposition: "retain_old_ledger",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("unavailable handoff data fails with refresh guidance and keeps the rest of the lease usable", async ({
  page,
}) => {
  const state = await fixture(page);
  state.malformed = true;
  await page.goto("/company/leases/review?section=renewal");
  await expect(page.getByRole("alert")).toContainText(
    "This lease review is unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Review lease change", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Renewal draft", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Lease details", exact: true }),
  ).toBeVisible();
});
