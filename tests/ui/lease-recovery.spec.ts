import { test, expect, Page } from "@playwright/test";
const actorId = "auth0|123456789012345678901234",
  companyId = "company-123456789012345678901234";
async function fixture(page: Page, platform = false) {
  const parent = {
    id: "lease-parent-12345678901234567890",
    unitId: "unit-1",
    propertyId: "home",
    residentId: "resident-12345678901234567890",
    startsOn: "2026-10-01",
    endsOn: "2026-12-31",
    rentCents: 100000,
    currency: "USD",
    status: "active",
    version: 1,
    rentDueDay: 1,
    graceDays: 5,
    paymentInstructions: "Pay at the office.",
    previousLeaseId: null,
    renewals: [] as any[],
    unit: { label: "Apartment 1" },
    property: { name: "Maple House" },
    resident: { name: "Jordan Resident", email: "jordan@test.invalid" },
  };
  const original = {
    id: "charge-original-12345678901234567890",
    reference: "RC-41",
    periodOn: "2026-10-01",
    dueOn: "2026-10-01",
    amountCents: 100000,
    graceDays: 5,
    graceThrough: "2026-10-06",
    afterGraceOn: "2026-10-07",
    version: 2,
    voidedAt: "2026-10-15T12:00:00Z",
    voidReason: "Test",
    appliedCents: "0",
    remainingCents: "0",
    collectionStatus: "voided",
    daysPastDue: 0,
  };
  const schedule = {
    id: "schedule-a",
    status: "active",
    version: 2,
    firstPeriodOn: "2026-10-01",
    lastPeriodOn: "2026-12-01",
    nextPeriodOn: "2026-11-01",
    amountCents: 100000,
    firstAmountCents: null,
    lastAmountCents: null,
    firstDueOn: null,
    dueDay: 1,
    graceDays: 5,
    leadDays: 0,
    lastCheckedAt: "2026-10-15T12:00:00Z",
    lastErrorCode: null,
  };
  const history = {
    id: "occurrence-a",
    scheduleId: "schedule-a",
    periodOn: "2026-10-01",
    outcome: "existing",
    createdAt: "2026-10-15T11:00:00Z",
    charge: original,
    currentCharge: null as any,
  };
  const state = {
    rows: [parent] as any[],
    leasePosts: [] as any[],
    reposts: [] as any[],
    loseLease: false,
    loseRepost: false,
    current: null as any,
    parent,
    schedule,
    history,
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      p = u.pathname,
      json = (v: unknown, status = 200) => route.fulfill({ json: v, status });
    if (/^\/api\/(company|resident)\/deposits\/[^/]+$/.test(p) && req.method() === "GET") return json({businessDate:"2026-10-15",lease:{id:p.split("/").pop(),propertyId:"home",version:1,status:"active",startsOn:"2025-01-01",property:{name:"Maple House"},unit:{label:"Apartment 1"}},account:null});
    if (p === "/api/bootstrap")
      return json({
        user: {
          id: actorId,
          name: "Elijah Ward",
          email: "elijah@test.invalid",
          status: "active",
          emailVerified: true,
          platformRole: platform ? "owner" : null,
        },
        membership: platform
          ? null
          : {
              companyId,
              version: 1,
              role: "owner",
              status: "active",
              company: { name: "FAP", status: "active" },
            },
        permissions: platform
          ? ["platform.manage"]
          : [
              "property.read",
              "property.write",
              "lease.manage",
              "finance.manage",
            ],
        csrfToken: "fixture",
      });
    if (p === "/api/company/properties")
      return json([{ id: "home", name: "Maple House" }]);
    if (p === "/api/company/properties/home")
      return json({ id: "home", name: "Maple House" });
    if (p === "/api/company/properties/home/units")
      return json({
        items: [
          { id: "unit-1", label: "Apartment 1", status: "active" },
          { id: "unit-2", label: "Apartment 2", status: "active" },
        ],
        nextCursor: null,
      });
    if (p === "/api/company/properties/home/residents")
      return json([
        { userId: parent.residentId, membership: { user: parent.resident } },
      ]);
    if (p === "/api/company/leases") {
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        state.leasePosts.push(body);
        let row = state.rows.find(
          (r) => r.submissionKey === body.submissionKey,
        );
        if (!row) {
          row = {
            ...parent,
            ...body,
            id: "new-lease-" + state.rows.length,
            rentCents: Math.round(Number(body.monthlyRent) * 100),
            previousLease: body.previousLeaseId
              ? { id: parent.id, endsOn: parent.endsOn, status: parent.status }
              : null,
            renewals: [],
          };
          state.rows.push(row);
          if (body.previousLeaseId)
            parent.renewals = [
              { id: row.id, status: "draft", startsOn: row.startsOn },
            ];
        }
        if (state.loseLease) {
          state.loseLease = false;
          return route.abort("failed");
        }
        return json(row);
      }
      return json({
        items: state.rows.filter(
          (r) =>
            !u.searchParams.get("status") ||
            r.status === u.searchParams.get("status"),
        ),
        nextCursor: null,
      });
    }
    if (p === "/api/company/rent")
      return json({
        businessDate: "2026-10-15",
        generatedAt: "2026-10-15T12:00:00Z",
        accounts: [
          {
            lease: parent,
            summary: {
              chargedCents: state.current ? "100000" : "0",
              paidCents: "0",
              outstandingCents: state.current ? "100000" : "0",
              overdueCents: state.current ? "100000" : "0",
              afterGraceCents: state.current ? "100000" : "0",
              withinGraceCents: "0",
              dueTodayCents: "0",
              upcomingCents: "0",
              creditCents: "0",
              netCents: state.current ? "100000" : "0",
              age1To30Cents: state.current ? "100000" : "0",
              age31To60Cents: "0",
              age61To90Cents: "0",
              age91PlusCents: "0",
            },
            charges: [
              original,
              ...(state.current
                ? [
                    {
                      ...original,
                      ...state.current,
                      voidedAt: null,
                      voidReason: null,
                      remainingCents: "100000",
                      version: 1,
                    },
                  ]
                : []),
            ],
            payments: [],
            allocations: [],
          },
        ],
      });
    if (p === `/api/company/rent/${parent.id}/schedule`)
      return json({
        schedule,
        preview: [
          {
            periodOn: "2026-11-01",
            postOn: "2026-11-01",
            dueOn: "2026-11-01",
            amountCents: 100000,
            action: "post",
          },
        ],
        history: [history],
        nextCursor: null,
      });
    if (p === "/api/company/rent-schedules/schedule-a/run")
      return json({
        outcome: "not_due",
        periodOn: "2026-11-01",
        postOn: "2026-11-01",
        dueOn: "2026-11-01",
        businessDate: "2026-10-15",
        previousInstallment: { periodOn: "2026-10-01", voided: true },
      });
    if (p === "/api/company/rent-schedules/schedule-a/repost-preview")
      return json({
        scheduleId: "schedule-a",
        occurrenceId: "occurrence-a",
        leaseId: parent.id,
        expectedLeaseVersion: 1,
        expectedScheduleVersion: 2,
        periodOn: "2026-10-01",
        postOn: "2026-10-01",
        dueOn: "2026-10-01",
        amountCents: 100000,
        graceDays: 5,
        businessDate: "2026-10-15",
      });
    if (p === "/api/company/rent-schedules/schedule-a/reposts") {
      const body = req.postDataJSON();
      state.reposts.push(body);
      state.current = {
        id: "charge-replacement-12345678901234567890",
        reference: "RC-42",
        amountCents: 100000,
        dueOn: "2026-10-01",
      };
      history.currentCharge = state.current;
      if (state.loseRepost) {
        state.loseRepost = false;
        return route.abort("failed");
      }
      return json(state.current);
    }
    if (p === "/api/company/finances")
      return json({
        items: [
          {
            id: "transaction-12345678901234567890",
            reference: "TX-76",
            property: { name: "Maple House" },
            propertyId: "home",
            occurredOn: "2026-10-15",
            kind: "income",
            category: "rent",
            amountCents: 100000,
            memo: null,
            version: 1,
            voidedAt: null,
          },
        ],
        nextCursor: null,
        summary: {
          incomeCents: "100000",
          expenseCents: "0",
          netCents: "100000",
        },
      });
    if (p === "/api/platform/audit")
      return json([
        {
          id: "audit-1",
          action: "user.profile.updated",
          actorId,
          actorLabel: "Elijah Ward",
          actor: { name: "Elijah Ward", email: "elijah@test.invalid" },
          companyId,
          companyName: "FAP",
          targetId: parent.residentId,
          createdAt: "2026-10-15T12:00:00Z",
        },
        {
          id: "audit-2",
          action: "rent.schedule.processed",
          actorId: "system:rent-billing",
          actorLabel: "Automatic rent billing",
          actor: null,
          companyId,
          companyName: "FAP",
          targetId: "schedule-a",
          createdAt: "2026-10-15T11:00:00Z",
        },
      ]);
    return json([]);
  });
  return state;
}
test("October retained then voided is explained separately from next November; reviewed repost survives response loss", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/company/rent?leaseId=" + state.parent.id);
  await page
    .getByRole("button", { name: "Check next installment", exact: true })
    .click();
  await expect(
    page.getByText(/Next installment 2026-11 posts 2026-11-01/),
  ).toContainText("2026-10 was already processed");
  expect(state.reposts).toHaveLength(0);
  await page
    .getByText("Posting history · latest page", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review repost for 2026-10", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("$1,000.00");
  await page.getByLabel("Reason for reposting").fill("Restore October test");
  state.loseRepost = true;
  await page
    .getByRole("button", { name: "Repost installment", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Recover pending repost" }).click();
  await page.getByRole("button", { name: "Retry this repost" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.reposts).toHaveLength(2);
  expect(state.reposts[0]).toEqual(state.reposts[1]);
  await expect(page.getByText("RC-42", { exact: true })).toBeVisible();
  await page
    .getByText("Posting history · latest page", { exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Review repost for 2026-10" }),
  ).not.toBeVisible();
});
test("voided history uses its original stopped schedule when a newer schedule is current", async ({
  page,
}) => {
  const state = await fixture(page);
  state.schedule.id = "schedule-b";
  state.schedule.amountCents = 200000;
  await page.goto("/company/rent?leaseId=" + state.parent.id);
  await page
    .getByText("Posting history · latest page", { exact: true })
    .click();
  const preview = page.waitForRequest(
    (r) =>
      new URL(r.url()).pathname ===
      "/api/company/rent-schedules/schedule-a/repost-preview",
  );
  await page
    .getByRole("button", { name: "Review repost for 2026-10", exact: true })
    .click();
  await preview;
  await expect(page.getByRole("dialog")).toContainText("$1,000.00");
  await page
    .getByLabel("Reason for reposting")
    .fill("Recover older schedule's month");
  await page
    .getByRole("button", { name: "Repost installment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.reposts).toHaveLength(1);
  expect(state.schedule.id).toBe("schedule-b");
  expect(state.history.scheduleId).toBe("schedule-a");
});

test("transaction references and audit names replace default internal IDs while details retain traceability", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/company/rent?leaseId=lease-parent-12345678901234567890");
  await expect(page.getByText("RC-41", { exact: true })).toBeVisible();
  await expect(
    page.getByText("charge-original-12345678901234567890", { exact: true }),
  ).not.toBeVisible();
  await page.getByText("Charge details", { exact: true }).click();
  await expect(
    page.getByText("charge-original-12345678901234567890", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Copy internal ID", exact: true }),
  ).toBeVisible();
  await page.goto("/company/finances");
  await expect(page.getByText("TX-76", { exact: true })).toBeVisible();
  await expect(
    page.getByText("transaction-12345678901234567890", { exact: true }),
  ).not.toBeVisible();
  await fixture(page, true);
  await page.goto("/platform/audit");
  await expect(
    page.getByRole("cell", { name: "Elijah Ward", exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Automatic rent billing", exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell").filter({ hasText: "FAP" }).first(),
  ).toBeVisible();
  await expect(page.getByText(actorId, { exact: true })).not.toBeVisible();
  await page.getByText("Actor details", { exact: true }).first().click();
  await expect(page.getByText(actorId, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Copy internal ID", exact: true }).first(),
  ).toBeVisible();
});
test("lease review retains editable details and recovers a lost save after reload without a second record", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/company/leases");
  await page
    .getByRole("button", { name: "Record a lease", exact: true })
    .click();
  await page.getByLabel("Property for new lease").selectOption("home");
  await page.getByLabel("Unit for new lease").selectOption("unit-2");
  await page.getByLabel("New lease start date").fill("2027-01-01");
  await page.getByLabel("New lease monthly rent (USD)").fill("1200.00");
  await page.getByRole("button", { name: "Review lease", exact: true }).click();
  expect(state.leasePosts).toHaveLength(0);
  await expect(page.getByRole("dialog")).toContainText(
    "Maple House · Apartment 2",
  );
  await page.getByRole("button", { name: "Back to lease details" }).click();
  await expect(page.getByLabel("New lease monthly rent (USD)")).toHaveValue(
    "1200.00",
  );
  await page.getByRole("button", { name: "Review lease", exact: true }).click();
  state.loseLease = true;
  await page
    .getByRole("button", { name: "Create lease record", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Resume lease review · Maple House" })
    .click();
  await page
    .getByRole("button", { name: "Create lease record", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.leasePosts[0]).toEqual(state.leasePosts[1]);
  expect(state.rows).toHaveLength(2);
});
test("renewal review carries forward context, stays a draft and preserves retry identity across reload", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/company/leases");
  await page
    .getByRole("button", { name: "Prepare renewal", exact: true })
    .click();
  await expect(
    page.getByLabel("Renewal start date", { exact: true }),
  ).toHaveValue("2027-01-01");
  await page.getByLabel("Renewal monthly rent (USD)").fill("1100.00");
  await page.getByLabel("Renewal end date", { exact: true }).fill("2027-12-31");
  await page
    .getByRole("button", { name: "Review renewal", exact: true })
    .click();
  expect(state.leasePosts).toHaveLength(0);
  await expect(page.getByRole("dialog")).toContainText(
    "End the previous lease before activating",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Create renewal draft" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Create renewal draft" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/pf-renewal-review-mobile.png" });
  state.loseLease = true;
  await page.getByRole("button", { name: "Create renewal draft" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Resume renewal review" }).click();
  await page.getByRole("button", { name: "Create renewal draft" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.leasePosts[0]).toEqual(state.leasePosts[1]);
  expect(state.leasePosts[0]).toMatchObject({
    previousLeaseId: state.parent.id,
    expectedPreviousVersion: 1,
    status: "draft",
    monthlyRent: "1100.00",
  });
  expect(state.parent.rentCents).toBe(100000);
  expect(state.rows).toHaveLength(2);
  await expect(
    page.getByText("Renewal · previous term ended 2026-12-31"),
  ).toBeVisible();
});
