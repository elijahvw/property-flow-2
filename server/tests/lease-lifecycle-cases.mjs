import { newFixturePage } from "./browser-fixture.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { companyDay } from "../dist/reports.js";
import { calendarProration } from "../dist/proration-policy.js";
import { serializable } from "../dist/application.js";
import { generateRentOccurrence } from "../dist/rent-schedules.js";
export async function leaseLifecycleCases(t, admin, call, app, db) {
  const ok = (r) => {
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    },
    today = companyDay("America/New_York"),
    on = new Date(today),
    yesterday = new Date(+on - 86400000).toISOString().slice(0, 10),
    month = today.slice(0, 7) + "-01";
  const monthAt = (n) =>
    new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth() + n, 1))
      .toISOString()
      .slice(0, 10);
  const make = async (label, extra = {}) => {
    const unit = ok(
      await call("owner", "POST", "/api/company/properties/home/units", {
        label,
        submissionKey: randomUUID(),
      }),
    );
    return ok(
      await call("owner", "POST", "/api/company/leases", {
        propertyId: "home",
        unitId: unit.id,
        residentId: "resident",
        startsOn: monthAt(-1),
        endsOn: null,
        monthlyRent: "1500.00",
        rentDueDay: 1,
        graceDays: 5,
        paymentInstructions: null,
        status: "active",
        submissionKey: randomUUID(),
        ...extra,
      }),
    );
  };
  const read = async (l) =>
      ok(await call("owner", "GET", `/api/company/leases/${l.id}`)),
    rent = (l) => `/api/company/rent/${l.id}`,
    pro = (l) => `/api/company/leases/${l.id}/proration`,
    handoff = (l) => `/api/company/leases/${l.id}/transition`;
  const pb = async (l, period, patch = {}) => {
    const c = ok(await call("owner", "GET", pro(l) + "?periodOn=" + period));
    return {
      periodOn: period,
      fromOn: c.calculation.fromOn,
      throughOn: c.calculation.throughOn,
      policy: "actual_calendar_month",
      dueOn: c.dueOn.slice(0, 10),
      overrideAmount: null,
      overrideReason: null,
      reason: "Agreed included rental days",
      expectedLeaseVersion: c.lease.version,
      ...patch,
    };
  };
  const postProration = async (l, period, patch = {}) => {
    const b = await pb(l, period, patch),
      p = ok(await call("owner", "POST", pro(l) + "/preview", b)),
      payload = {
        ...b,
        sourceHash: p.sourceHash,
        submissionKey: randomUUID(),
        confirmed: true,
      };
    return {
      p,
      payload,
      row: ok(await call("owner", "POST", pro(l), payload)),
    };
  };
  const tb = async (l, kind = "plan_end", patch = {}) => {
    const d = ok(await call("owner", "GET", handoff(l)));
    return {
      kind,
      endsOn: yesterday,
      expectedLeaseVersion: d.lease.version,
      expectedSuccessorVersion: kind === "renew" ? d.successor.version : null,
      newBilling: kind === "renew" ? "recurring" : "none",
      firstDueOn: kind === "renew" ? today : null,
      firstAmount: null,
      firstOverrideReason: null,
      reason: "Reviewed connected handoff",
      depositDisposition: "retain_old_ledger",
      ...patch,
    };
  };
  const transition = async (l, b) => {
    const p = ok(await call("owner", "POST", handoff(l) + "/preview", b)),
      payload = {
        ...b,
        sourceHash: p.sourceHash,
        submissionKey: randomUUID(),
        confirmed: true,
      };
    return {
      p,
      payload,
      row: ok(await call("owner", "POST", handoff(l), payload)),
    };
  };
  const worker = (s, now = today) =>
    serializable(db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id='a' FOR SHARE`;
      await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
      return generateRentOccurrence(
        tx,
        "a",
        s.id,
        { id: "lifecycle-worker", principal: { id: "system:rent-billing" } },
        new Date(now + "T20:00:00Z"),
      );
    });
  let partial, prorated, old, next, schedule, plan, renewal;
  await t.test(
    "partial rent preserves accepted dates, exact cents and reasoned overrides; recurring posting recognizes it",
    async () => {
      partial = await make("Proration first month", {
        startsOn: month.slice(0, 8) + "10",
      });
      prorated = await postProration(partial, month, {
        overrideAmount: "999.99",
        overrideReason: "Agreed move-in concession",
      });
      assert.equal(prorated.row.snapshot.amountCents, 99999);
      assert.equal(
        prorated.row.snapshot.overrideReason,
        "Agreed move-in concession",
      );
      assert.equal(
        prorated.row.snapshot.days,
        new Date(Date.parse(monthAt(1)) - 86400000).getUTCDate() - 9,
      );
      assert.equal(
        ok(await call("owner", "POST", pro(partial), prorated.payload)).id,
        prorated.row.id,
      );
      assert.equal(
        (
          await call("owner", "POST", pro(partial), {
            ...prorated.payload,
            overrideAmount: "999.98",
          })
        ).statusCode,
        409,
      );
      const s = ok(
        await call("owner", "POST", rent(partial) + "/schedules", {
          firstPeriodOn: month,
          firstDueOn: month,
          leadDays: 0,
          expectedVersion: partial.version,
          submissionKey: randomUUID(),
        }),
      );
      assert.equal((await worker(s)).outcome, "existing");
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1 AND "voidedAt" IS NULL`,
            [partial.id],
          )
        ).rows[0].n,
        1,
      );
      const d = ok(
        await call(
          "resident",
          "GET",
          `/api/resident/leases/${partial.id}/proration`,
        ),
      );
      assert.equal(d[0].snapshot.amountCents, 99999);
      assert.equal(d[0].createdById, undefined);
      assert.equal(d[0].submissionKey, undefined);
    },
  );
  await t.test(
    "partial rent rejects role/company/date/policy forgery and stale source review; audit failure rolls back both records",
    async () => {
      const l = await make("Proration strict review", {
          startsOn: month.slice(0, 8) + "12",
        }),
        b = await pb(l, month),
        p = ok(await call("owner", "POST", pro(l) + "/preview", b));
      for (const u of ["staff", "resident", "platform", "foreign"])
        assert.ok(
          [403, 404].includes(
            (await call(u, "POST", pro(l) + "/preview", b)).statusCode,
          ),
        );
      for (const patch of [
        { fromOn: month },
        { throughOn: month },
        { policy: "thirty_day" },
        { overrideAmount: "12", overrideReason: null },
        { overrideAmount: "0" },
        { reason: "" },
        { companyId: "b" },
        { expectedLeaseVersion: 999 },
      ])
        assert.ok(
          [400, 409].includes(
            (
              await call("owner", "POST", pro(l) + "/preview", {
                ...b,
                ...patch,
              })
            ).statusCode,
          ),
        );
      assert.equal(
        (
          await call("owner", "POST", pro(l) + "/preview", b, {
            "x-csrf-token": "wrong",
          })
        ).statusCode,
        403,
      );
      ok(
        await call("owner", "PATCH", `/api/company/leases/${l.id}`, {
          startsOn: l.startsOn.slice(0, 10),
          endsOn: null,
          status: "active",
          monthlyRent: "1600",
          rentDueDay: 1,
          graceDays: 5,
          paymentInstructions: null,
          expectedVersion: l.version,
        }),
      );
      assert.equal(
        (
          await call("owner", "POST", pro(l), {
            ...b,
            sourceHash: p.sourceHash,
            submissionKey: randomUUID(),
            confirmed: true,
          })
        ).statusCode,
        409,
      );
      const fresh = await pb(l, month),
        review = ok(await call("owner", "POST", pro(l) + "/preview", fresh)),
        payload = {
          ...fresh,
          sourceHash: review.sourceHash,
          submissionKey: randomUUID(),
          confirmed: true,
        };
      await admin.query(
        `CREATE FUNCTION reject_proration_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='lease.proration.posted' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_proration_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_proration_audit()`,
      );
      try {
        assert.equal(
          (await call("owner", "POST", pro(l), payload)).statusCode,
          500,
        );
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1`,
              [l.id],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await admin.query(
          `DROP TRIGGER reject_proration_audit ON "AuditEvent"; DROP FUNCTION reject_proration_audit()`,
        );
      }
      ok(await call("owner", "POST", pro(l), payload));
    },
  );
  await t.test(
    "end-date planning is reviewed and pauses a schedule needing final-month proration without moving deposit funds",
    async () => {
      old = await make("Connected lifecycle old");
      ok(
        await call("owner", "POST", `/api/company/deposits/${old.id}`, {
          amount: "1500.00",
          dueOn: monthAt(-1),
          expectedLeaseVersion: old.version,
          submissionKey: randomUUID(),
        }),
      );
      ok(
        await call(
          "owner",
          "POST",
          `/api/company/deposits/${old.id}/receipts`,
          {
            amount: "1500.00",
            occurredOn: monthAt(-1),
            method: "bank_transfer",
            memo: null,
            paymentReference: null,
            expectedVersion: 1,
            expectedLeaseVersion: old.version,
            submissionKey: randomUUID(),
          },
        ),
      );
      schedule = ok(
        await call("owner", "POST", rent(old) + "/schedules", {
          firstPeriodOn: month,
          firstDueOn: month,
          leadDays: 0,
          expectedVersion: old.version,
          submissionKey: randomUUID(),
        }),
      );
      plan = await transition(old, await tb(old));
      assert.equal(plan.p.pauseBilling, true);
      assert.equal((await read(old)).status, "active");
      assert.equal((await read(old)).endsOn.slice(0, 10), yesterday);
      assert.equal((await worker(schedule)).outcome, "inactive");
      assert.equal(
        ok(await call("owner", "GET", `/api/company/deposits/${old.id}`))
          .account.summary.heldCents,
        "150000",
      );
      assert.equal(
        ok(await call("owner", "POST", handoff(old), plan.payload)).id,
        plan.row.id,
      );
      const p = await postProration(old, yesterday.slice(0, 7) + "-01");
      assert.equal(
        p.row.snapshot.amountCents,
        calendarProration(
          new Date(monthAt(-1)),
          new Date(yesterday),
          new Date(yesterday.slice(0, 7) + "-01"),
          150000,
        ).calculatedCents,
      );
      ok(
        await call("owner", "POST", rent(old) + "/payments", {
          occurredOn: yesterday,
          amount: "100.00",
          memo: null,
          submissionKey: randomUUID(),
        }),
      );
      const current = await read(old);
      next = ok(
        await call("owner", "POST", "/api/company/leases", {
          propertyId: "home",
          unitId: old.unitId,
          residentId: "resident",
          previousLeaseId: old.id,
          expectedPreviousVersion: current.version,
          startsOn: today,
          endsOn: monthAt(2).slice(0, 8) + "10",
          monthlyRent: "1800.00",
          rentDueDay: 1,
          graceDays: 3,
          paymentInstructions: null,
          status: "draft",
          submissionKey: randomUUID(),
        }),
      );
      assert.equal(
        (await call("resident", "GET", "/api/resident/rent?leaseId=" + next.id))
          .statusCode,
        404,
      );
    },
  );
  await t.test(
    "handoff source changes and audit errors cannot leave a half-ended lease, first charge or schedule",
    async () => {
      let b = await tb(old, "renew"),
        p = ok(await call("owner", "POST", handoff(old) + "/preview", b));
      assert.equal(p.ready, true);
      assert.equal(
        p.newTerm.firstAmountCents,
        calendarProration(
          new Date(today),
          new Date(next.endsOn),
          new Date(month),
          180000,
        ).calculatedCents,
      );
      ok(
        await call("owner", "POST", rent(old) + "/payments", {
          occurredOn: yesterday,
          amount: "1.00",
          memo: null,
          submissionKey: randomUUID(),
        }),
      );
      assert.equal(
        (
          await call("owner", "POST", handoff(old), {
            ...b,
            sourceHash: p.sourceHash,
            submissionKey: randomUUID(),
            confirmed: true,
          })
        ).statusCode,
        409,
      );
      assert.equal((await read(old)).status, "active");
      assert.equal((await read(next)).status, "draft");
      b = await tb(old, "renew");
      p = ok(await call("owner", "POST", handoff(old) + "/preview", b));
      const payload = {
        ...b,
        sourceHash: p.sourceHash,
        submissionKey: randomUUID(),
        confirmed: true,
      };
      await admin.query(
        `CREATE FUNCTION reject_handoff_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='lease.transition.saved' THEN RAISE EXCEPTION 'handoff audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_handoff_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_handoff_audit()`,
      );
      try {
        assert.equal(
          (await call("owner", "POST", handoff(old), payload)).statusCode,
          500,
        );
        assert.equal((await read(old)).status, "active");
        assert.equal((await read(next)).status, "draft");
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1`,
              [next.id],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM "RentSchedule" WHERE "leaseId"=$1`,
              [next.id],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await admin.query(
          `DROP TRIGGER reject_handoff_audit ON "AuditEvent";DROP FUNCTION reject_handoff_audit()`,
        );
      }
      const replies = await Promise.all([
        call("owner", "POST", handoff(old), payload),
        call("owner", "POST", handoff(old), payload),
      ]);
      renewal = { p, payload, row: ok(replies[0]) };
      assert.equal(ok(replies[1]).id, renewal.row.id);
    },
  );
  await t.test(
    "renewal atomically ends old billing, activates one successor and posts its first rent once while retaining old debt/deposit",
    async () => {
      assert.equal((await read(old)).status, "ended");
      assert.equal((await read(next)).status, "active");
      assert.equal(
        (
          await admin.query(`SELECT status FROM "RentSchedule" WHERE id=$1`, [
            schedule.id,
          ])
        ).rows[0].status,
        "stopped",
      );
      assert.equal((await worker(schedule)).outcome, "inactive");
      const charge = (
        await admin.query(`SELECT * FROM "RentCharge" WHERE "leaseId"=$1`, [
          next.id,
        ])
      ).rows;
      assert.equal(charge.length, 1);
      assert.equal(charge[0].amountCents, renewal.p.newTerm.firstAmountCents);
      const ns = (
        await admin.query(`SELECT * FROM "RentSchedule" WHERE "leaseId"=$1`, [
          next.id,
        ])
      ).rows;
      assert.equal(ns.length, 1);
      assert.equal(ns[0].status, "active");
      assert.equal((await worker(ns[0])).outcome, "existing");
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1`,
            [next.id],
          )
        ).rows[0].n,
        1,
      );
      const oldRent = ok(
        await call("owner", "GET", "/api/company/rent?leaseId=" + old.id),
      ).accounts[0];
      assert.ok(BigInt(oldRent.summary.outstandingCents) > 0n);
      assert.equal(
        ok(await call("owner", "GET", `/api/company/deposits/${old.id}`))
          .account.summary.heldCents,
        "150000",
      );
      assert.equal(
        ok(await call("owner", "GET", `/api/company/deposits/${next.id}`))
          .account,
        null,
      );
      const publicHistory = ok(
        await call(
          "resident",
          "GET",
          `/api/resident/leases/${old.id}/transition`,
        ),
      );
      assert.equal(publicHistory[0].kind, "renew");
      assert.equal(publicHistory[0].successorId, undefined);
      assert.equal(publicHistory[0].snapshot, undefined);
      assert.equal(publicHistory[0].createdById, undefined);
      await admin.query(
        `DELETE FROM "ResidentPropertyAssignment" WHERE "companyId"='a' AND "propertyId"='home' AND "userId"='resident'`,
      );
      try {
        assert.equal(
          (
            await call(
              "resident",
              "GET",
              `/api/resident/leases/${old.id}/transition`,
            )
          ).statusCode,
          404,
        );
      } finally {
        await admin.query(
          `INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','resident')`,
        );
      }
    },
  );
  await t.test(
    "future handoffs and forged disposition/roles cannot activate a draft or transfer funds early",
    async () => {
      const l = await make("Future handoff", { endsOn: monthAt(1) }),
        n = ok(
          await call("owner", "POST", "/api/company/leases", {
            propertyId: "home",
            unitId: l.unitId,
            residentId: "resident",
            previousLeaseId: l.id,
            expectedPreviousVersion: l.version,
            startsOn: monthAt(1).slice(0, 8) + "02",
            endsOn: null,
            monthlyRent: "1600.00",
            status: "draft",
            submissionKey: randomUUID(),
          }),
        );
      const b = await tb(l, "renew", { endsOn: monthAt(1) }),
        p = ok(await call("owner", "POST", handoff(l) + "/preview", b));
      assert.equal(p.ready, false);
      assert.ok(p.blockers.some((b) => b.includes("on or after")));
      assert.equal(
        (
          await call("owner", "POST", handoff(l), {
            ...b,
            sourceHash: p.sourceHash,
            submissionKey: randomUUID(),
            confirmed: true,
          })
        ).statusCode,
        409,
      );
      assert.equal((await read(n)).status, "draft");
      for (const u of ["staff", "resident", "platform", "foreign"])
        assert.ok(
          [403, 404].includes(
            (await call(u, "POST", handoff(l) + "/preview", b)).statusCode,
          ),
        );
      for (const patch of [
        { depositDisposition: "transfer" },
        { newBilling: "none" },
        { endsOn: monthAt(1).slice(0, 8) + "02" },
        { expectedSuccessorVersion: 999 },
        { companyId: "b" },
      ])
        assert.ok(
          [400, 409].includes(
            (
              await call("owner", "POST", handoff(l) + "/preview", {
                ...b,
                ...patch,
              })
            ).statusCode,
          ),
        );
      for (const table of ["LeaseProration", "LeaseTransition"]) {
        assert.deepEqual(
          await db[
            table === "LeaseProration" ? "leaseProration" : "leaseTransition"
          ].findMany(),
          [],
        );
        for (const permission of ["UPDATE", "DELETE"])
          assert.equal(
            (
              await admin.query(
                `SELECT has_table_privilege('propertyflow_runtime',$1,$2) allowed`,
                ['"' + table + '"', permission],
              )
            ).rows[0].allowed,
            false,
          );
      }
    },
  );
  await t.test(
    "ending retains a posted charge's saved amount and grace after later unversioned policy edits",
    async () => {
      const l = await make("Saved rent policy at ending"),
        charge = ok(
          await call("owner", "POST", rent(l) + "/charges", {
            periodOn: month,
            dueOn: month,
            amount: "1000.00",
            memo: null,
            expectedVersion: l.version,
            submissionKey: randomUUID(),
          }),
        );
      ok(
        await call("owner", "PATCH", `/api/company/leases/${l.id}`, {
          startsOn: l.startsOn.slice(0, 10),
          endsOn: null,
          status: "active",
          monthlyRent: "1500.00",
          rentDueDay: 1,
          graceDays: 1,
          paymentInstructions: null,
          expectedVersion: l.version,
        }),
      );
      const b = await tb(l, "end"),
        p = ok(await call("owner", "POST", handoff(l) + "/preview", b)),
        item = p.oldInstallments.find((i) => i.periodOn === month);
      assert.equal(item.action, "retain");
      assert.equal(item.amountCents, 100000);
      assert.equal(item.graceDays, 5);
      await transition(l, b);
      const saved = (
        await admin.query(
          `SELECT "amountCents","graceDays" FROM "RentCharge" WHERE id=$1`,
          [charge.id],
        )
      ).rows[0];
      assert.equal(saved.amountCents, 100000);
      assert.equal(saved.graceDays, 5);
    },
  );
  await t.test(
    "real browser proration review survives a lost commit and reload, with the same charge identity",
    { skip: !process.env.TEST_FINANCES_BROWSER_URL },
    async () => {
      const l = await make("Browser partial rent", {
          startsOn: month.slice(0, 8) + "09",
        }),
        browser = await chromium.launch({ headless: true });
      try {
        const page = await newFixturePage(browser, {
          viewport: { width: 1440, height: 1000 },
        });
        let lose = true;
        const keys = [];
        await page.route("**/api/**", async (route) => {
          const req = route.request(),
            u = new URL(req.url()),
            response = await app.inject({
              method: req.method(),
              url: u.pathname + u.search,
              headers: {
                ...req.headers(),
                origin: "https://app.test",
                cookie: "__Host-pf-session=token-owner",
              },
              ...(req.postData() ? { payload: req.postData() } : {}),
            });
          if (req.method() === "POST" && u.pathname === pro(l)) {
            keys.push(req.postDataJSON().submissionKey);
            assert.equal(response.statusCode, 200, response.body);
            if (lose) {
              lose = false;
              return route.abort("failed");
            }
          }
          await route.fulfill({
            status: response.statusCode,
            contentType: "application/json",
            body: response.body,
          });
        });
        await page.goto(
          process.env.TEST_FINANCES_BROWSER_URL +
            `/company/leases/${l.id}?section=proration`,
        );
        await page
          .getByRole("button", {
            name: "Review partial rent charge",
            exact: true,
          })
          .click();
        await page
          .getByLabel("Reason shown to the tenant", { exact: true })
          .fill("Reviewed browser partial rent");
        await page
          .getByRole("button", { name: "Preview partial rent", exact: true })
          .click();
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", {
            name: "Confirm partial rent charge",
            exact: true,
          })
          .click();
        await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
        await page.reload();
        await page
          .getByRole("button", {
            name: "Resume partial rent review",
            exact: true,
          })
          .click();
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", {
            name: "Confirm partial rent charge",
            exact: true,
          })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        assert.equal(keys.length, 2);
        assert.equal(keys[0], keys[1]);
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: "/tmp/propertyflow-proration-mobile.png",
          fullPage: true,
        });
      } finally {
        await browser.close();
      }
    },
  );
  await t.test(
    "real browser previews future blockers and safely retries a committed end with final rent across reload",
    { skip: !process.env.TEST_FINANCES_BROWSER_URL },
    async () => {
      const l = await make("Browser lease ending"),
        browser = await chromium.launch({ headless: true });
      try {
        const page = await newFixturePage(browser, {
          viewport: { width: 390, height: 844 },
        });
        let lose = true;
        const keys = [];
        await page.route("**/api/**", async (route) => {
          const req = route.request(),
            u = new URL(req.url()),
            response = await app.inject({
              method: req.method(),
              url: u.pathname + u.search,
              headers: {
                ...req.headers(),
                origin: "https://app.test",
                cookie: "__Host-pf-session=token-owner",
              },
              ...(req.postData() ? { payload: req.postData() } : {}),
            });
          if (req.method() === "POST" && u.pathname === handoff(l)) {
            keys.push(req.postDataJSON().submissionKey);
            assert.equal(response.statusCode, 200, response.body);
            if (lose) {
              lose = false;
              return route.abort("failed");
            }
          }
          await route.fulfill({
            status: response.statusCode,
            contentType: "application/json",
            body: response.body,
          });
        });
        await page.goto(
          process.env.TEST_FINANCES_BROWSER_URL +
            `/company/leases/${l.id}?section=renewal`,
        );
        await page
          .getByRole("button", {
            name: "Review lease change",
            exact: true,
          })
          .click();
        await page
          .getByLabel("Lease action", { exact: true })
          .selectOption("end");
        await page
          .getByLabel("Current lease end date", { exact: true })
          .fill(monthAt(1));
        await page
          .getByLabel("Reason for the lease change", { exact: true })
          .fill("Reviewed end and final rent");
        await page
          .getByRole("button", { name: "Review changes", exact: true })
          .click();
        await expect(
          page
            .getByRole("dialog")
            .getByText("Before you can save this lease ending", {
              exact: true,
            }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", {
            name: "End lease",
            exact: true,
          }),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "Edit details", exact: true })
          .click();
        await page
          .getByLabel("Current lease end date", { exact: true })
          .fill(yesterday);
        await page
          .getByRole("button", { name: "Review changes", exact: true })
          .click();
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", { name: "End lease", exact: true })
          .click();
        await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
        await page.reload();
        await page
          .getByRole("button", { name: "Resume lease review", exact: true })
          .click();
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", { name: "End lease", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        assert.equal(keys.length, 2);
        assert.equal(keys[0], keys[1]);
        assert.equal((await read(l)).status, "ended");
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1`,
              [l.id],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: "/tmp/propertyflow-handoff-mobile.png",
          fullPage: true,
        });
      } finally {
        await browser.close();
      }
    },
  );
  await t.test(
    "a billing worker racing a lease end cannot post unreviewed future months after a completed cutoff",
    async () => {
      const l = await make("End against worker"),
        s = ok(
          await call("owner", "POST", rent(l) + "/schedules", {
            firstPeriodOn: monthAt(1),
            firstDueOn: monthAt(1),
            leadDays: 0,
            expectedVersion: l.version,
            submissionKey: randomUUID(),
          }),
        ),
        b = await tb(l, "end"),
        p = ok(await call("owner", "POST", handoff(l) + "/preview", b));
      assert.equal(p.ready, true);
      const [posted, ended] = await Promise.all([
        worker(s, monthAt(2)),
        call("manager", "POST", handoff(l), {
          ...b,
          sourceHash: p.sourceHash,
          submissionKey: randomUUID(),
          confirmed: true,
        }),
      ]);
      assert.ok([200, 409].includes(ended.statusCode), ended.body);
      const current = await read(l),
        charges = (
          await admin.query(
            `SELECT "periodOn" FROM "RentCharge" WHERE "leaseId"=$1`,
            [l.id],
          )
        ).rows;
      if (current.status === "ended") {
        assert.equal(posted.outcome, "inactive");
        assert.ok(charges.every((c) => c.periodOn <= new Date(month)));
      } else {
        assert.equal(ended.statusCode, 409);
        assert.equal(posted.outcome, "posted");
        assert.ok(
          charges.some(
            (c) => c.periodOn.toISOString().slice(0, 10) === monthAt(1),
          ),
        );
      }
    },
  );
}
