import { test, expect, Page } from "@playwright/test";
async function fixture(page: Page, role = "owner") {
  const summary = {
    chargedCents: "150000",
    paidCents: "0",
    outstandingCents: "150000",
    overdueCents: "150000",
    afterGraceCents: "100000",
    withinGraceCents: "50000",
    dueTodayCents: "0",
    upcomingCents: "0",
    creditCents: "0",
    netCents: "150000",
    age1To30Cents: "50000",
    age31To60Cents: "100000",
    age61To90Cents: "0",
    age91PlusCents: "0",
  };
  const lease = {
    id: "lease-a",
    propertyId: "home",
    unitId: "unit-a",
    residentId: "resident",
    property: { name: "Maple House" },
    unit: { label: "Apartment 1" },
    resident: { name: "Jordan Resident", email: "jordan@test.invalid" },
    startsOn: "2025-01-01",
    endsOn: null,
    rentCents: 100000,
    currency: "USD",
    status: "active",
    version: 1,
    rentDueDay: 31,
    graceDays: 5,
    paymentInstructions: "Bring checks to the office.",
  };
  const account = {
    lease,
    summary,
    charges: [
      {
        id: "charge-old",
        periodOn: "2026-09-01",
        dueOn: "2026-09-01",
        amountCents: 100000,
        appliedCents: "0",
        remainingCents: "100000",
        version: 1,
        voidedAt: null,
        memo: null,
        graceDays: 0,
        graceThrough: "2026-09-01",
        afterGraceOn: "2026-09-02",
        daysPastDue: 44,
        collectionStatus: "past_grace",
      },
      {
        id: "charge-new",
        periodOn: "2026-10-01",
        dueOn: "2026-10-10",
        amountCents: 50000,
        appliedCents: "0",
        remainingCents: "50000",
        version: 1,
        voidedAt: null,
        memo: null,
        graceDays: 5,
        graceThrough: "2026-10-15",
        afterGraceOn: "2026-10-16",
        daysPastDue: 5,
        collectionStatus: "within_grace",
      },
    ],
    payments: [],
    allocations: [],
  };
  const state = {
    lease,
    accounts: [account] as any[],
    posts: [] as any[],
    patches: [] as any[],
    lose: false,
    capped: false,
    requests: [] as string[],
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      p = u.pathname,
      json = (v: unknown, status = 200) => route.fulfill({ json: v, status });
    state.requests.push(p + u.search);
    if (/^\/api\/(company|resident)\/deposits\/[^/]+$/.test(p) && req.method() === "GET") return json({businessDate:"2026-10-15",lease:{id:p.split("/").pop(),propertyId:"home",version:1,status:"active",startsOn:"2025-01-01",property:{name:"Maple House"},unit:{label:"Apartment 1"}},account:null});
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
        items: [{ id: "unit-a", label: "Apartment 1", status: "active" }],
        nextCursor: null,
      });
    if (p === "/api/company/properties/home/residents")
      return json([
        { userId: "resident", membership: { user: lease.resident } },
      ]);
    if (p === "/api/company/leases") {
      if (req.method() === "POST") {
        const b = req.postDataJSON();
        state.posts.push(b);
        return json({ ...lease, ...b, id: "new-lease", rentCents: 100000 });
      }
      return json({ items: [lease], nextCursor: null });
    }
    if (req.method() === "GET" && /^\/api\/company\/leases\/[^/]+(?:\/participants)?$/.test(p)) {
      return p.endsWith('/participants') ? json({lease,items:[],candidates:[]}) : json(lease);
    }
    if (p === "/api/company/leases/lease-a" && req.method() === "PATCH") {
      const b = req.postDataJSON();
      state.patches.push(b);
      Object.assign(lease, b, { version: lease.version + 1 });
      return json(lease);
    }
    if (p.startsWith("/api/company/rent/lease-a/") && req.method() === "POST") {
      state.posts.push(req.postDataJSON());
      if (state.lose) {
        state.lose = false;
        return route.abort("failed");
      }
      return json({ id: "new-charge" });
    }
    if (
      p === "/api/company/rent" &&
      state.capped &&
      !u.searchParams.has("propertyId")
    )
      return json(
        { error: "RECORD_LIMIT", message: "Narrow this view to a property." },
        409,
      );
    if (p === "/api/company/rent" || p === "/api/resident/rent")
      return json({
        businessDate: "2026-10-15",
        generatedAt: "2026-10-15T12:00:00Z",
        accounts: u.searchParams.has("leaseId") ? [account] : state.accounts,
      });
    if (p === "/api/company/overview")
      return json({
        company: { name: "FAP", timezone: "America/New_York" },
        today: "2026-10-15",
        generatedAt: "2026-10-15T12:00:00Z",
        property: null,
        propertyCount: 1,
        activeUnitCount: 1,
        properties: [{ id: "home", name: "Maple House", _count: { units: 1 } }],
        rentCollections: {
          pastDueCents: "150000",
          afterGraceCents: "100000",
          withinGraceCents: "50000",
          pastDueLeaseCount: 1,
          afterGraceLeaseCount: 1,
        },
      });
    return json([]);
  });
  return state;
}
test("lease create and edit use complete payment terms, preserve clear instructions, and show concrete grace dates", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/company/leases?propertyId=home&new=lease");
  await page.getByLabel("New lease start date").fill("2026-10-01");
  await page.getByLabel("New lease monthly rent (USD)").fill("1000.00");
  await page.getByLabel("New lease rent due day").selectOption("31");
  await page
    .getByLabel("New lease grace period (days after due date)")
    .fill("5");
  await page
    .getByLabel(
      "New lease payment instructions shared with resident (optional)",
    )
    .fill("Pay at the office.");
  await expect(
    page.getByText(/Example: November rent due November 30, 2026/),
  ).toContainText("past grace from December 6, 2026");
  await page.getByRole("button",{name:"Review lease",exact:true}).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Create lease record", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: "/tmp/pf-lease-payment-terms-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create lease record", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.posts[0]).toMatchObject({
    rentDueDay: 31,
    graceDays: 5,
    paymentInstructions: "Pay at the office.",
  });
  await expect(page).toHaveURL(/\/company\/leases\/new-lease\?onboarding=household/);
  await page.getByRole('link',{name:'← All leases',exact:true}).click();
  await page.getByText("More actions",{exact:true}).first().click();
  await page.getByRole("button", { name: "Edit lease", exact: true }).click();
  await expect(
    page.getByLabel("Lease Apartment 1 grace period (days after due date)"),
  ).toHaveValue("5");
  await page
    .getByLabel("Lease Apartment 1 grace period (days after due date)")
    .fill("10");
  await page
    .getByLabel(
      "Lease Apartment 1 payment instructions shared with resident (optional)",
    )
    .fill("");
  await page
    .getByRole("button", { name: "Save lease Apartment 1", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.patches[0]).toMatchObject({
    graceDays: 10,
    paymentInstructions: null,
    expectedVersion: 1,
  });
});
test("charge preview uses clamped due day and preserves the reviewed grace policy after a lost response and refresh", async ({
  page,
}) => {
  const state = await fixture(page);
  state.lose = true;
  await page.goto("/company/rent?leaseId=lease-a");
  await page
    .getByRole("button", { name: "Post monthly rent", exact: true })
    .click();
  await page.getByLabel("Rent month", { exact: true }).fill("2027-02");
  await expect(page.getByLabel("Due date")).toHaveValue("2027-02-28");
  await expect(page.getByText(/Grace through March 5, 2027/)).toBeVisible();
  await page.getByLabel("Due date").fill("2027-02-20");
  await expect(page.getByText(/Grace through February 25, 2027/)).toBeVisible();
  await page
    .getByRole("button", { name: "Post rent charge", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  state.lease.graceDays = 20;
  state.lease.version = 2;
  await page.reload();
  await page
    .getByRole("button", { name: "Post monthly rent", exact: true })
    .click();
  await expect(page.getByText(/This charge saves 5 grace days/)).toBeVisible();
  await page
    .getByRole("button", { name: "Post rent charge", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.posts[0]).toEqual(state.posts[1]);
  expect(state.posts[0].reviewedPolicy).toBeUndefined();
  expect(state.posts[0].expectedVersion).toBe(1);
});
test("dashboard collections drilldown, account filters, charge grace statuses and aging exports stay connected", async ({
  page,
}) => {
  const state = await fixture(page);
  state.accounts.push({
    ...state.accounts[0],
    lease: {
      ...state.lease,
      id: "within-only",
      unit: { label: "Apartment 2" },
    },
    summary: {
      ...state.accounts[0].summary,
      afterGraceCents: "0",
      withinGraceCents: "50000",
      outstandingCents: "50000",
      overdueCents: "50000",
      age1To30Cents: "50000",
      age31To60Cents: "0",
    },
  });
  await page.goto("/company/overview");
  await page.getByRole("link", { name: /Follow up rent past grace/ }).click();
  await expect(page).toHaveURL(/view=after_grace/);
  await expect(page.getByLabel("Balance view")).toHaveValue("after_grace");
  await expect(page.getByRole("link", { name: "Open ledger →" })).toHaveCount(
    1,
  );
  await expect(
    page.getByRole("region", { name: "Past-due aging" }),
  ).toContainText("$1,000.00");
  await page.getByLabel("Balance view").selectOption("within_grace");
  await expect(page.getByRole("link", { name: "Open ledger →" })).toHaveCount(
    2,
  );
  await page.getByLabel("Past-due age").selectOption("age31To60Cents");
  await expect(page.getByRole("link", { name: "Open ledger →" })).toHaveCount(
    1,
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download balances CSV" }).click();
  const stream = await (await downloading).createReadStream();
  let csv = "";
  for await (const part of stream!) csv += part.toString();
  expect(csv).toContain("Past grace USD");
  expect(csv).toContain("Age 31–60 USD");
  expect(csv).toContain("1000.00");
  await page.getByRole("link", { name: "Open ledger →" }).click();
  await expect(page.getByText("within grace", { exact: true })).toBeVisible();
  await expect(page.getByText("past grace", { exact: true })).toBeVisible();
  await expect(page.getByText(/through October 15, 2026/)).toBeVisible();
  await page.screenshot({
    path: "/tmp/pf-collections-ledger-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/pf-collections-ledger-mobile.png",
    fullPage: true,
  });
});
test("resident sees shared payment terms and saved charge grace without management controls", async ({
  page,
}) => {
  await fixture(page, "resident");
  await page.goto("/resident/rent?leaseId=lease-a");
  await expect(page.getByText("Bring checks to the office.")).toBeVisible();
  await expect(
    page.getByText("Due day 31 · 5 calendar days of grace after due date"),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Past-due aging" }),
  ).toContainText("$1,000.00");
  await expect(
    page.getByRole("button", { name: "Post monthly rent", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/through October 15, 2026/)).toBeVisible();
});

test("a capped initial rent query retains independent property scope and recovers without fabricating balances", async ({
  page,
}) => {
  const state = await fixture(page);
  state.capped = true;
  await page.goto("/company/rent?view=after_grace");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Rent balance summary" }),
  ).not.toBeVisible();
  await page.getByRole("combobox", { name: "Rent property", exact: true }).selectOption("home");
  await expect(page).toHaveURL(/propertyId=home/);
  await expect(page.getByRole("alert")).not.toBeVisible();
  await expect(
    page.getByRole("region", { name: "Rent balance summary" }),
  ).toContainText("$1,000.00");
  expect(state.requests).toContain("/api/company/rent?propertyId=home");
});
