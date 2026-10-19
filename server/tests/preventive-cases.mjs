import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { newFixturePage } from "./browser-fixture.mjs";
export async function preventiveCases(t, admin, db, call, app) {
  const base = "/api/company/preventive",
    make = (extra = {}) => ({
      title: "Fictional safety check",
      description: "Review fictional equipment.",
      category: "safety",
      priority: "normal",
      propertyId: "home",
      unitId: null,
      cadence: "monthly",
      timezone: "America/New_York",
      anchorOn: "2026-01-31",
      endOn: null,
      submissionKey: randomUUID(),
      ...extra,
    });
  const ok = async (...args) => {
    const r = await call(...args);
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const original = make(),
    created = await ok("manager", "POST", base, original),
    id = created.planId,
    path = base + "/" + id;
  const current = () => ok("manager", "GET", path);
  const edit = async (extra = {}) => {
    const row = await current();
    return {
      title: row.title,
      description: row.description,
      category: row.category,
      priority: row.priority,
      status: row.status,
      expectedVersion: row.version,
      submissionKey: randomUUID(),
      ...extra,
    };
  };
  const occurrence = async (extra = {}) => {
    const row = await current();
    return {
      outcome: "generated",
      dueOn: row.nextOn.slice(0, 10),
      expectedVersion: row.version,
      reason: null,
      submissionKey: randomUUID(),
      ...extra,
    };
  };
  await t.test(
    "schedule input, company/property and exact retry boundaries",
    async () => {
      assert.equal((await ok("manager", "POST", base, original)).planId, id);
      assert.equal(
        (
          await call("manager", "POST", base, {
            ...original,
            title: "Different",
          })
        ).statusCode,
        409,
      );
      for (const extra of [
        { cadence: "hourly" },
        { anchorOn: "2026-02-30" },
        { endOn: "2026-01-30" },
        { propertyId: "foreign-home" },
        { unitId: "foreign-unit" },
        { companyId: "b" },
      ]) {
        const r = await call("manager", "POST", base, make(extra));
        assert.ok([400, 404].includes(r.statusCode), r.body);
      }
      assert.equal((await call("foreign", "GET", path)).statusCode, 404);
      assert.equal(
        (
          await call(
            "foreign",
            "POST",
            path + "/occurrences",
            await occurrence(),
          )
        ).statusCode,
        404,
      );
      assert.equal((await ok("foreign", "GET", base)).total, 0);
    },
  );
  await t.test(
    "all routes require current management scope and CSRF; platform authority grants none",
    async () => {
      for (const actor of ["staff", "vendor-staff", "vendor-resident"])
        for (const [method, url, payload] of [
          ["GET", base],
          ["GET", path],
          ["GET", path + "/history"],
          ["GET", path + "/occurrences"],
          ["POST", base, make()],
          ["PATCH", path, await edit()],
          ["POST", path + "/occurrences", await occurrence()],
        ])
          assert.equal(
            (await call(actor, method, url, payload)).statusCode,
            403,
          );
      assert.equal(
        (
          await call("manager", "POST", base, make(), {
            "x-csrf-token": "wrong",
          })
        ).statusCode,
        403,
      );
      await admin.query(
        `UPDATE "User" SET "platformRole"='owner' WHERE id='vendor-staff'`,
      );
      try {
        assert.equal((await call("vendor-staff", "GET", base)).statusCode, 403);
      } finally {
        await admin.query(
          `UPDATE "User" SET "platformRole"=NULL WHERE id='vendor-staff'`,
        );
      }
    },
  );
  let firstRequest;
  await t.test(
    "racing occurrence creation creates exactly one source-linked ordinary request",
    async () => {
      const payload = await occurrence(),
        results = await Promise.all([
          call("manager", "POST", path + "/occurrences", payload),
          call("manager", "POST", path + "/occurrences", payload),
          call("manager", "POST", path + "/occurrences", payload),
        ]);
      assert.equal(results[0].statusCode, 200, results[0].body);
      assert.equal(results[1].statusCode, 200, results[1].body);
      assert.equal(results[2].statusCode, 200, results[2].body);
      assert.equal(
        (
          await call("owner", "POST", path + "/occurrences", {
            ...payload,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        409,
      );
      const records = (
        await admin.query(
          'SELECT * FROM "PreventiveOccurrence" WHERE "planId"=$1',
          [id],
        )
      ).rows;
      assert.equal(records.length, 1);
      firstRequest = records[0].requestId;
      const source = await ok(
        "manager",
        "GET",
        `/api/company/maintenance/${firstRequest}/preventive`,
      );
      assert.equal(source.plan.id, id);
      assert.equal(source.dueOn.slice(0, 10), "2026-01-31");
      const work = await ok(
        "manager",
        "GET",
        `/api/company/maintenance/${firstRequest}`,
      );
      assert.equal(work.title, original.title);
      assert.equal(work.targetOn.slice(0, 10), "2026-01-31");
      assert.equal(work.residentUpdatesAvailable, false);
      assert.equal((await current()).nextOn.slice(0, 10), "2026-02-28");
      assert.equal(
        (await ok("manager", "POST", path + "/occurrences", payload)).requestId,
        firstRequest,
      );
      assert.equal(
        (
          await call("manager", "POST", path + "/occurrences", {
            ...payload,
            reason: "changed",
            outcome: "skipped",
          })
        ).statusCode,
        409,
      );
    },
  );
  await t.test(
    "different managers race one reviewed occurrence without duplicates or internal errors",
    async () => {
      const created = await ok(
          "manager",
          "POST",
          base,
          make({ title: "Different actors race" }),
        ),
        p = base + "/" + created.planId,
        payload = {
          outcome: "generated",
          dueOn: "2026-01-31",
          reason: null,
          expectedVersion: 1,
        };
      const results = await Promise.all(
        ["owner", "manager"].map((actor) =>
          call(actor, "POST", p + "/occurrences", {
            ...payload,
            submissionKey: randomUUID(),
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
      assert.equal((await ok("manager", "GET", p + "/occurrences")).total, 1);
    },
  );
  await t.test(
    "skip requires reason; retains history and original anchor; never silently catches up",
    async () => {
      assert.equal(
        (
          await call(
            "manager",
            "POST",
            path + "/occurrences",
            await occurrence({ outcome: "skipped", reason: " " }),
          )
        ).statusCode,
        400,
      );
      const payload = await occurrence({
        outcome: "skipped",
        reason: "Fictional equipment unavailable",
      });
      await ok("manager", "POST", path + "/occurrences", payload);
      await ok("manager", "POST", path + "/occurrences", payload);
      assert.equal((await current()).nextOn.slice(0, 10), "2026-03-31");
      const rows = await ok("manager", "GET", path + "/occurrences");
      assert.equal(rows.total, 2);
      assert.equal(rows.items[0].reason, payload.reason);
      assert.equal(rows.items[1].requestId, firstRequest);
    },
  );
  await t.test(
    "pause/resume and edits preserve missed dates, existing requests and stale-source protection",
    async () => {
      const stale = await occurrence(),
        before = await current();
      await ok(
        "manager",
        "PATCH",
        path,
        await edit({ status: "paused", title: "Future safety inspection" }),
      );
      assert.equal(
        (
          await call(
            "manager",
            "POST",
            path + "/occurrences",
            await occurrence(),
          )
        ).statusCode,
        409,
      );
      assert.equal((await current()).nextOn, before.nextOn);
      await ok("manager", "PATCH", path, await edit({ status: "active" }));
      assert.equal(
        (await call("manager", "POST", path + "/occurrences", stale))
          .statusCode,
        409,
      );
      assert.equal(
        (await ok("manager", "GET", `/api/company/maintenance/${firstRequest}`))
          .title,
        original.title,
      );
      const next = await ok(
        "manager",
        "POST",
        path + "/occurrences",
        await occurrence(),
      );
      assert.equal(
        (
          await ok(
            "manager",
            "GET",
            `/api/company/maintenance/${next.requestId}`,
          )
        ).title,
        "Future safety inspection",
      );
    },
  );
  await t.test(
    "unchanged edits use hidden retry receipts without version/history churn",
    async () => {
      const before = await current(),
        payload = await edit(),
        history = await ok("manager", "GET", path + "/history");
      await ok("manager", "PATCH", path, payload);
      assert.equal((await current()).version, before.version);
      assert.equal(
        (await ok("manager", "GET", path + "/history")).total,
        history.total,
      );
      await ok("manager", "PATCH", path, await edit({ priority: "high" }));
      await ok("manager", "PATCH", path, payload);
      assert.equal((await current()).priority, "high");
    },
  );
  await t.test(
    "last due date finishes cleanly and prohibits further generation",
    async () => {
      const result = await ok(
          "manager",
          "POST",
          base,
          make({ title: "Single occurrence", endOn: "2026-01-31" }),
        ),
        p = base + "/" + result.planId;
      const payload = {
        dueOn: "2026-01-31",
        outcome: "generated",
        reason: null,
        expectedVersion: 1,
        submissionKey: randomUUID(),
      };
      await ok("manager", "POST", p + "/occurrences", payload);
      assert.equal((await ok("manager", "GET", p)).nextOn, null);
      assert.equal(
        (
          await call("manager", "POST", p + "/occurrences", {
            ...payload,
            expectedVersion: 2,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        409,
      );
      assert.ok(
        (await ok("manager", "GET", base + "?due=finished")).items.some(
          (x) => x.id === result.planId,
        ),
      );
    },
  );
  await t.test(
    "directory filters complete totals before paging and uses stored timezone",
    async () => {
      for (let i = 0; i < 27; i++)
        await ok(
          "manager",
          "POST",
          base,
          make({
            title: `Pagination fixture ${String(i).padStart(2, "0")}`,
            anchorOn: "2099-01-31",
          }),
        );
      const first = await ok(
        "manager",
        "GET",
        base + "?q=Pagination&due=upcoming",
      );
      assert.equal(first.total, 27);
      assert.equal(first.items.length, 25);
      assert.equal(
        (await ok("manager", "GET", base + "?q=Pagination&due=upcoming&page=2"))
          .items.length,
        2,
      );
      assert.equal(
        (await ok("manager", "GET", base + "?q=Pagination&due=overdue")).total,
        0,
      );
      assert.equal(
        (await ok("manager", "GET", base + "?q=Pagination%20fixture%2026"))
          .total,
        1,
      );
      const timezone = (await current()).timezone;
      await admin.query(
        `UPDATE "Company" SET timezone='Pacific/Honolulu' WHERE id='a'`,
      );
      try {
        assert.equal((await current()).timezone, timezone);
        assert.equal(
          (await call("manager", "POST", base, make())).statusCode,
          409,
        );
      } finally {
        await admin.query(
          `UPDATE "Company" SET timezone='America/New_York' WHERE id='a'`,
        );
      }
      for (const query of [
        "page=0",
        "page=1e2",
        "status=unknown",
        "due=unknown",
        "extra=1",
      ])
        assert.equal(
          (await call("manager", "GET", base + "?" + query)).statusCode,
          400,
        );
    },
  );
  await t.test(
    "forced RLS, immutable history and composite source scope hold in PostgreSQL",
    async () => {
      for (const table of [
        "PreventivePlan",
        "PreventiveAction",
        "PreventiveOccurrence",
      ])
        assert.deepEqual(
          (
            await admin.query(
              "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=$1",
              [table],
            )
          ).rows[0],
          { relrowsecurity: true, relforcerowsecurity: true },
        );
      assert.deepEqual(await db.preventivePlan.findMany(), []);
      assert.deepEqual(await db.preventiveAction.findMany(), []);
      assert.deepEqual(await db.preventiveOccurrence.findMany(), []);
      await assert.rejects(
        admin.query(
          'UPDATE "PreventiveOccurrence" SET reason=reason WHERE "planId"=$1',
          [id],
        ),
        /immutable/,
      );
      await assert.rejects(
        admin.query('DELETE FROM "PreventiveAction" WHERE "planId"=$1', [id]),
        /immutable/,
      );
      await assert.rejects(
        admin.query(
          'UPDATE "PreventivePlan" SET "propertyId"=\'foreign-home\' WHERE id=$1',
          [id],
        ),
        /foreign key/i,
      );
    },
  );
  await t.test(
    "atomic audit failure rolls back new occurrence, request and next date together",
    async () => {
      await admin.query(
        `CREATE FUNCTION reject_preventive_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'preventive.%' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_preventive_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_preventive_audit()`,
      );
      try {
        const before = await current(),
          count = (
            await admin.query(
              'SELECT count(*)::int n FROM "MaintenanceRequest"',
            )
          ).rows[0].n;
        assert.equal(
          (
            await call(
              "manager",
              "POST",
              path + "/occurrences",
              await occurrence(),
            )
          ).statusCode,
          500,
        );
        assert.deepEqual(await current(), before);
        assert.equal(
          (
            await admin.query(
              'SELECT count(*)::int n FROM "MaintenanceRequest"',
            )
          ).rows[0].n,
          count,
        );
        assert.equal(
          (
            await call(
              "manager",
              "POST",
              base,
              make({ title: "Rollback fixture" }),
            )
          ).statusCode,
          500,
        );
        assert.equal(
          (await ok("manager", "GET", base + "?q=Rollback")).total,
          0,
        );
      } finally {
        await admin.query(
          'DROP TRIGGER reject_preventive_audit ON "AuditEvent"; DROP FUNCTION reject_preventive_audit()',
        );
      }
    },
  );
  await t.test(
    "fresh disabled membership and company suspension block reads and committed retries",
    async () => {
      await admin.query(
        `UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='manager'`,
      );
      try {
        assert.equal((await call("manager", "GET", path)).statusCode, 403);
        assert.equal(
          (await call("manager", "POST", base, original)).statusCode,
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
          (await call("manager", "POST", base, original)).statusCode,
          403,
        );
      } finally {
        await admin.query(`UPDATE "Company" SET status='active' WHERE id='a'`);
      }
    },
  );
  await t.test(
    "browser reviews one request after committed response loss using real isolated API",
    { skip: !process.env.TEST_MAINTENANCE_BROWSER_URL },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await newFixturePage(browser, {
          viewport: { width: 390, height: 844 },
        });
        let lose = true;
        const attempts = [];
        await page.route("**/api/**", async (route) => {
          const req = route.request(),
            url = new URL(req.url());
          if (url.pathname === "/api/telemetry")
            return route.fulfill({ json: { accepted: true } });
          const response = await app.inject({
            method: req.method(),
            url: url.pathname + url.search,
            headers: {
              ...req.headers(),
              origin: "https://app.test",
              cookie: "__Host-pf-session=token-manager",
            },
            ...(req.postData() ? { payload: req.postData() } : {}),
          });
          if (
            req.method() === "POST" &&
            url.pathname === path + "/occurrences"
          ) {
            attempts.push(req.postDataJSON());
            if (lose) {
              lose = false;
              assert.equal(response.statusCode, 200, response.body);
              return route.abort("failed");
            }
          }
          return route.fulfill({
            status: response.statusCode,
            contentType: "application/json",
            body: response.body,
          });
        });
        await page.goto(
          process.env.TEST_MAINTENANCE_BROWSER_URL +
            "/company/preventive/" +
            id,
        );
        await expect(
          page.getByRole("heading", {
            name: "Future safety inspection",
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Create next request", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await dialog
          .getByRole("button", {
            name: "Create maintenance request",
            exact: true,
          })
          .click();
        await expect(
          dialog.getByText("This request may already be saved.", {
            exact: false,
          }),
        ).toBeVisible();
        await dialog
          .getByRole("button", {
            name: "Create maintenance request",
            exact: true,
          })
          .click();
        await expect(dialog).not.toBeVisible();
        assert.equal(attempts.length, 2);
        assert.deepEqual(attempts[0], attempts[1]);
        await page
          .getByRole("button", { name: "Dismiss confirmation", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Next occurrence", exact: true })
          .scrollIntoViewIfNeeded();
        assert.equal(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          ),
          true,
        );
        await page.screenshot({ path: "/tmp/pf-preventive-local-mobile.png" });
        await page
          .getByRole("link", {
            name: "Open request to assign work →",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("heading", { name: "Scheduled source", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("link", { name: "Back to schedule →", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "Future safety inspection",
            exact: true,
          }),
        ).toBeVisible();
      } finally {
        await browser.close();
      }
    },
  );
}
