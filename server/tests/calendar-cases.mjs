import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { newFixturePage } from "./browser-fixture.mjs";
export async function calendarCases(t, admin, call, app) {
  const base = "/api/company/work-calendar",
    filter = "month=2026-10&propertyId=calendar-home";
  const ok = async (...args) => {
    const r = await call(...args);
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  await admin.query(
    `INSERT INTO "Property" (id,name,address,city,state,zip,"companyId","updatedAt") VALUES ('calendar-home','Fictional Calendar Home','street','city','state','zip','a',NOW())`,
  );
  for (let i = 0; i < 28; i++)
    await ok("manager", "POST", "/api/company/maintenance", {
      propertyId: "calendar-home",
      title: `Fictional calendar request ${String(i).padStart(2, "0")}`,
      description: "Private source instructions not in calendar projection",
      priority: "normal",
      targetOn: "2026-10-18",
      submissionKey: randomUUID(),
    });
  for (const [title, targetOn, status] of [
    ["No date", null, "open"],
    ["Finished work", "2026-10-18", "resolved"],
    ["September boundary", "2026-09-30", "open"],
    ["November boundary", "2026-11-01", "open"],
  ]) {
    const row = await ok("manager", "POST", "/api/company/maintenance", {
      propertyId: "calendar-home",
      title,
      description: "Fictional only",
      priority: "normal",
      targetOn,
      submissionKey: randomUUID(),
    });
    if (status === "resolved")
      await ok("manager", "PATCH", `/api/company/maintenance/${row.id}`, {
        status,
      });
  }
  const payload = {
      propertyId: "calendar-home",
      unitId: null,
      title: "Fictional calendar schedule",
      description: "Private future instructions",
      category: "safety",
      priority: "high",
      cadence: "weekly",
      anchorOn: "2026-10-18",
      endOn: null,
      timezone: "America/New_York",
      submissionKey: randomUUID(),
    },
    created = await ok("manager", "POST", "/api/company/preventive", payload),
    planPath = "/api/company/preventive/" + created.planId;
  const paused = await ok("manager", "POST", "/api/company/preventive", {
    ...payload,
    title: "Paused calendar plan",
    submissionKey: randomUUID(),
  });
  await ok("manager", "PATCH", "/api/company/preventive/" + paused.planId, {
    title: "Paused calendar plan",
    description: payload.description,
    category: "safety",
    priority: "high",
    status: "paused",
    expectedVersion: 1,
    submissionKey: randomUUID(),
  });
  await t.test(
    "calendar combines next schedules and unresolved targets with complete month/day counts before paging",
    async () => {
      const first = await ok("manager", "GET", base + "?" + filter);
      assert.equal(first.monthTotal, 29);
      assert.equal(first.total, 29);
      assert.equal(first.items.length, 25);
      assert.equal(first.days.length, 1);
      assert.deepEqual(
        Object.fromEntries(
          ["total", "schedules", "requests"].map((k) => [k, first.days[0][k]]),
        ),
        { total: 29, schedules: 1, requests: 28 },
      );
      const second = await ok(
        "manager",
        "GET",
        base + "?" + filter + "&page=2",
      );
      assert.equal(second.items.length, 4);
      assert.equal(second.total, 29);
      assert.equal(
        new Set([...first.items, ...second.items].map((x) => x.kind + x.id))
          .size,
        29,
      );
      const empty = await ok(
        "manager",
        "GET",
        base + "?" + filter + "&day=2026-10-19",
      );
      assert.equal(empty.total, 0);
      assert.equal(empty.monthTotal, 29);
      assert.equal(empty.days[0].total, 29);
      assert.equal(
        (
          await ok(
            "manager",
            "GET",
            base + "?" + filter + "&day=2026-10-18&kind=schedule",
          )
        ).total,
        1,
      );
      assert.equal(
        (await ok("manager", "GET", base + "?" + filter + "&kind=request"))
          .total,
        28,
      );
      for (const item of [...first.items, ...second.items]) {
        assert.equal(item.propertyId, "calendar-home");
        assert.equal(item.propertyName, "Fictional Calendar Home");
        assert.equal(item.dueOn.slice(0, 10), "2026-10-18");
        assert.equal(item.unitLabel, null);
        for (const key of [
          "description",
          "reason",
          "submissionKey",
          "requesterId",
          "actorId",
          "notes",
        ])
          assert.ok(!Object.hasOwn(item, key), key);
      }
    },
  );
  await t.test(
    "foreign company, staff/resident/platform scope and revoked/suspended access are rejected",
    async () => {
      for (const actor of ["staff", "vendor-staff", "vendor-resident"])
        assert.equal(
          (await call(actor, "GET", base + "?" + filter)).statusCode,
          403,
        );
      assert.equal(
        (await call("foreign", "GET", base + "?" + filter)).statusCode,
        404,
      );
      assert.equal(
        (await ok("foreign", "GET", base + "?month=2026-10")).total,
        0,
      );
      await admin.query(
        `UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='manager'`,
      );
      try {
        assert.equal(
          (await call("manager", "GET", base + "?" + filter)).statusCode,
          403,
        );
      } finally {
        await admin.query(
          `UPDATE "CompanyMembership" SET status='active' WHERE "userId"='manager'`,
        );
      }
      await admin.query(`UPDATE "Company" SET status='suspended' WHERE id='a'`);
      try {
        assert.equal(
          (await call("manager", "GET", base + "?" + filter)).statusCode,
          403,
        );
      } finally {
        await admin.query(`UPDATE "Company" SET status='active' WHERE id='a'`);
      }
    },
  );
  await t.test(
    "calendar validates dates, bounded paging, exact month/day relation and property scope",
    async () => {
      for (const query of [
        "month=2026-13",
        "month=2026-1",
        "month=0000-01",
        "month=2026-10&day=2026-11-01",
        "month=2026-02&day=2026-02-30",
        "kind=alligator",
        "page=0",
        "page=1e2",
        "other=1",
      ])
        assert.equal(
          (await call("manager", "GET", base + "?" + query)).statusCode,
          400,
          query,
        );
      assert.equal(
        (
          await call(
            "manager",
            "GET",
            base + "?month=2026-10&propertyId=foreign-home",
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await ok(
            "manager",
            "GET",
            base + "?month=2026-09&propertyId=calendar-home",
          )
        ).total,
        1,
      );
      assert.equal(
        (
          await ok(
            "manager",
            "GET",
            base + "?month=2026-11&propertyId=calendar-home",
          )
        ).total,
        1,
      );
      assert.equal(
        (
          await ok(
            "manager",
            "GET",
            base + "?month=2099-02&propertyId=calendar-home",
          )
        ).total,
        0,
      );
    },
  );
  await t.test(
    "generation replaces its source occurrence exactly once; next repeat and skip use actual retained dates",
    async () => {
      const key = {
        outcome: "generated",
        dueOn: "2026-10-18",
        expectedVersion: 1,
        reason: null,
        submissionKey: randomUUID(),
      };
      const result = await ok(
        "manager",
        "POST",
        planPath + "/occurrences",
        key,
      );
      await ok("manager", "POST", planPath + "/occurrences", key);
      const day = await ok(
        "manager",
        "GET",
        base + "?" + filter + "&day=2026-10-18",
      );
      assert.equal(day.total, 29);
      assert.equal(day.days[0].requests, 29);
      assert.equal(day.days[0].schedules, 0);
      assert.equal(day.monthTotal, 30);
      const next = await ok(
        "manager",
        "GET",
        base + "?" + filter + "&day=2026-10-25",
      );
      assert.equal(next.total, 1);
      assert.equal(next.items[0].id, created.planId);
      await ok("manager", "POST", planPath + "/occurrences", {
        outcome: "skipped",
        dueOn: "2026-10-25",
        expectedVersion: 2,
        reason: "Fictional review reason",
        submissionKey: randomUUID(),
      });
      const after = await ok(
        "manager",
        "GET",
        base + "?" + filter + "&day=2026-10-25",
      );
      assert.equal(after.total, 0);
      assert.equal(after.monthTotal, 29);
      await ok(
        "manager",
        "PATCH",
        "/api/company/maintenance/" + result.requestId,
        { status: "resolved" },
      );
      assert.equal(
        (await ok("manager", "GET", base + "?" + filter + "&day=2026-10-18"))
          .total,
        28,
      );
    },
  );
  await t.test(
    "overdue labels use stored schedule timezone and ordinary request company timezone",
    async () => {
      const rows = await ok("manager", "GET", base + "?" + filter);
      const today = rows.today;
      for (const item of rows.items)
        assert.equal(item.overdue, item.dueOn.slice(0, 10) < today);
      const plan = await ok("manager", "GET", planPath);
      await admin.query(
        `UPDATE "Company" SET timezone='Pacific/Honolulu' WHERE id='a'`,
      );
      try {
        const view = await ok(
          "manager",
          "GET",
          base + "?month=2026-11&propertyId=calendar-home&kind=schedule",
        );
        assert.equal(view.items[0].timezone, plan.timezone);
      } finally {
        await admin.query(
          `UPDATE "Company" SET timezone='America/New_York' WHERE id='a'`,
        );
      }
    },
  );
  await t.test(
    "real browser opens dated work and returns with calendar filters; mobile layout uses real isolated data",
    { skip: !process.env.TEST_MAINTENANCE_BROWSER_URL },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await newFixturePage(browser, {
          viewport: { width: 390, height: 844 },
        });
        await page.route("**/api/**", async (route) => {
          const req = route.request(),
            url = new URL(req.url());
          if (url.pathname === "/api/telemetry")
            return route.fulfill({ json: { accepted: true } });
          const result = await app.inject({
            method: req.method(),
            url: url.pathname + url.search,
            headers: {
              ...req.headers(),
              origin: "https://app.test",
              cookie: "__Host-pf-session=token-manager",
            },
            ...(req.postData() ? { payload: req.postData() } : {}),
          });
          return route.fulfill({
            status: result.statusCode,
            contentType: "application/json",
            body: result.body,
          });
        });
        const origin = process.env.TEST_MAINTENANCE_BROWSER_URL;
        await page.goto(
          origin + "/company/work-calendar?" + filter + "&kind=request",
        );
        await expect(
          page.getByRole("heading", { name: "October 2026", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: /October 18, 2026, 28 items/ })
          .click();
        await expect(
          page.getByRole("status").filter({ hasText: "28 matching items" }),
        ).toBeVisible();
        await page
          .getByRole("link", {
            name: "Fictional calendar request 00",
            exact: true,
          })
          .click();
        await page
          .getByRole("link", { name: "Back to work calendar →", exact: true })
          .click();
        await expect(page).toHaveURL(/month=2026-10.*day=2026-10-18/);
        await expect(
          page.getByRole("combobox", { name: "Work type", exact: true }),
        ).toHaveValue("request");
        await expect(
          page.getByRole("status").filter({ hasText: "28 matching items" }),
        ).toBeVisible();
        await expect(
          page.getByRole("combobox", { name: "Filter property", exact: true }),
        ).toHaveValue("calendar-home");
        assert.equal(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          ),
          true,
        );
        await page.getByRole("heading",{name:"October 2026",exact:true}).scrollIntoViewIfNeeded();
        await page.screenshot({
          path: "/tmp/pf-work-calendar-local-mobile.png",
        });
        await page.setViewportSize({ width: 1440, height: 1050 });
        await page.screenshot({
          path: "/tmp/pf-work-calendar-local-desktop.png",
        });
      } finally {
        await browser.close();
      }
    },
  );
}
