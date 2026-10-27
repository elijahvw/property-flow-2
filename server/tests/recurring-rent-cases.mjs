import { newFixturePage, launchFixtureBrowser } from "./browser-fixture.mjs";
import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { serializable } from "../dist/application.js";
import { generateRentOccurrence } from "../dist/rent-schedules.js";
import { billingSweep } from "../dist/rent-billing-worker.js";
import { companyDay } from "../dist/reports.js";
export async function recurringRentCases(t, admin, call, db) {
  const ok = (r) => {
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const today = companyDay("America/New_York"),
    first = today.slice(0, 7) + "-01",
    next = new Date(first + "T00:00:00Z");
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = next.toISOString().slice(0, 10);
  const shift = (n) => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  let lease, schedule, body, early, late;
  const base = "/api/company/rent";
  const get = async () =>
    ok(await call("owner", "GET", base + "?leaseId=" + lease.id)).accounts[0];
  const read = async () =>
    ok(await call("owner", "GET", `${base}/${lease.id}/schedule`));
  const worker = async (now = new Date()) =>
    serializable(db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id='a' FOR SHARE`;
      await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
      return generateRentOccurrence(
        tx,
        "a",
        schedule.id,
        { id: "test-worker", principal: { id: "system:rent-billing" } },
        now,
      );
    });
  await t.test(
    "reviewed schedule creation is strict, scoped, replayable and explicit about partial amounts",
    async () => {
      await admin.query(
        `INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES('billing-home','Billing House','street','city','state','zip','a',NOW());INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','billing-home','resident2')`,
      );
      const unit = ok(
        await call(
          "owner",
          "POST",
          "/api/company/properties/billing-home/units",
          { label: "Billing unit", submissionKey: randomUUID() },
        ),
      );
      lease = ok(
        await call("owner", "POST", "/api/company/leases", {
          propertyId: "billing-home",
          unitId: unit.id,
          residentId: "resident2",
          startsOn: first,
          endsOn: last,
          monthlyRent: "1000.00",
          rentDueDay: 31,
          graceDays: 2,
          paymentInstructions: null,
          status: "active",
          submissionKey: randomUUID(),
        }),
      );
      body = {
        firstPeriodOn: first,
        lastPeriodOn: last,
        firstDueOn: shift(-7),
        firstAmount: "500.00",
        lastAmount: "750.00",
        leadDays: 0,
        expectedVersion: lease.version,
        submissionKey: randomUUID(),
      };
      const preview = ok(
        await call(
          "manager",
          "POST",
          `${base}/${lease.id}/schedule-preview`,
          body,
        ),
      );
      assert.equal(preview.preview.length, 2);
      assert.equal(preview.preview[0].amountCents, 50000);
      assert.equal(preview.preview[0].dueOn.slice(0, 10), shift(-7));
      assert.equal(preview.preview[1].amountCents, 75000);
      assert.equal(preview.preview[1].action, "post");
      for (const user of ["staff", "resident", "platform", "foreign"])
        assert.ok(
          [403, 404].includes(
            (await call(user, "POST", `${base}/${lease.id}/schedules`, body))
              .statusCode,
          ),
        );
      for (const patch of [
        { firstPeriodOn: "2020-01-01" },
        { firstDueOn: false },
        { lastPeriodOn: 0 },
        { firstDueOn: "9999-12-31" },
        { leadDays: 29 },
        { leadDays: "0" },
        { firstAmount: "0" },
        { firstAmount: "1.001" },
        { lastPeriodOn: first, lastAmount: "499.00" },
        { companyId: "b" },
        { expectedVersion: 9 },
      ])
        assert.ok(
          [400, 409].includes(
            (
              await call("owner", "POST", `${base}/${lease.id}/schedules`, {
                ...body,
                ...patch,
              })
            ).statusCode,
          ),
        );
      schedule = ok(
        await call("owner", "POST", `${base}/${lease.id}/schedules`, body),
      );
      assert.equal(schedule.status, "active");
      assert.equal(schedule.graceDays, 2);
      assert.equal(schedule.submissionHash, undefined);
      assert.equal(
        ok(await call("owner", "POST", `${base}/${lease.id}/schedules`, body))
          .id,
        schedule.id,
      );
      assert.equal(
        (
          await call("owner", "POST", `${base}/${lease.id}/schedules`, {
            ...body,
            leadDays: 1,
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await call("owner", "POST", `${base}/${lease.id}/schedules`, {
            ...body,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "AuditEvent" WHERE action='rent.schedule.enabled' AND "targetId"=$1`,
            [schedule.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "pause and resume are fenced, retries are safe, and current authorization is enforced",
    async () => {
      const status = async (value, version = schedule.version) =>
        call("owner", "PATCH", `/api/company/rent-schedules/${schedule.id}`, {
          status: value,
          expectedVersion: version,
        });
      schedule = ok(await status("paused"));
      assert.equal((await worker()).outcome, "inactive");
      assert.equal(ok(await status("paused", 1)).version, schedule.version);
      assert.equal((await status("active", 1)).statusCode, 409);
      schedule = ok(await status("active"));
      for (const user of ["staff", "resident", "platform", "foreign"])
        assert.ok(
          [403, 404].includes(
            (
              await call(
                user,
                "POST",
                `/api/company/rent-schedules/${schedule.id}/run`,
                {},
              )
            ).statusCode,
          ),
        );
      assert.equal(
        (
          await call(
            "manager",
            "POST",
            `/api/company/rent-schedules/${schedule.id}/run`,
            {},
            { "x-csrf-token": "bad" },
          )
        ).statusCode,
        403,
      );
      await admin.query(`UPDATE "Company" SET status='suspended' WHERE id='a'`);
      assert.equal((await worker()).outcome, "inactive");
      await billingSweep(db);
      await admin.query(`UPDATE "Company" SET status='active' WHERE id='a'`);
      await admin.query(
        `UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='manager'`,
      );
      assert.equal(
        (
          await call(
            "manager",
            "POST",
            `/api/company/rent-schedules/${schedule.id}/run`,
            {},
          )
        ).statusCode,
        403,
      );
      await admin.query(
        `UPDATE "CompanyMembership" SET status='active' WHERE "userId"='manager'`,
      );
    },
  );
  await t.test(
    "concurrent worker and manual checks commit one charge, occurrence, allocation and audit",
    async () => {
      early = ok(
        await call("owner", "POST", `${base}/${lease.id}/payments`, {
          amount: "300.00",
          occurredOn: shift(-8),
          memo: null,
          submissionKey: randomUUID(),
        }),
      );
      const results = await Promise.all([
        worker(),
        call(
          "owner",
          "POST",
          `/api/company/rent-schedules/${schedule.id}/run`,
          {},
        ),
      ]);
      ok(results[1]);
      const row = await get();
      assert.equal(row.charges.length, 1);
      assert.equal(row.charges[0].amountCents, 50000);
      assert.equal(row.charges[0].scheduleId, schedule.id);
      assert.equal(row.charges[0].graceDays, 2);
      assert.equal(row.summary.outstandingCents, "20000");
      assert.equal(row.allocations.length, 1);
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "RentScheduleOccurrence" WHERE "leaseId"=$1`,
            [lease.id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "AuditEvent" WHERE action='rent.charge.scheduled' AND "targetId"=$1`,
            [row.charges[0].id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal((await worker()).outcome, "not_due");
      schedule = (await read()).schedule;
    },
  );
  await t.test(
    "late receipt remains paid late after catching up; void and corrected receipt use actual received dates",
    async () => {
      late = ok(
        await call("owner", "POST", `${base}/${lease.id}/payments`, {
          amount: "200.00",
          occurredOn: shift(-4),
          memo: "Private receipt note",
          submissionKey: randomUUID(),
        }),
      );
      let row = await get();
      assert.equal(row.charges[0].collectionStatus, "paid");
      assert.equal(row.charges[0].paidLate, true);
      assert.equal(row.charges[0].settledOn, shift(-4));
      assert.equal(row.charges[0].paidAfterGraceCents, "20000");
      assert.equal(row.summary.paidLateChargeCount, "1");
      assert.equal(row.summary.overdueCents, "0");
      const resident = ok(
        await call(
          "resident2",
          "GET",
          "/api/resident/rent?leaseId=" + lease.id,
        ),
      ).accounts[0];
      assert.equal(resident.charges[0].paidLate, true);
      assert.ok(resident.payments.every((p) => p.memo === undefined));
      ok(
        await call("owner", "POST", `/api/company/finances/${late.id}/void`, {
          reason: "Wrong received date",
          expectedVersion: 1,
        }),
      );
      row = await get();
      assert.equal(row.charges[0].paidLate, false);
      assert.equal(row.charges[0].settledOn, null);
      assert.equal(row.summary.outstandingCents, "20000");
      late = ok(
        await call("owner", "POST", `${base}/${lease.id}/payments`, {
          amount: "200.00",
          occurredOn: shift(-5),
          memo: null,
          submissionKey: randomUUID(),
        }),
      );
      row = await get();
      assert.equal(
        row.charges[0].paidLate,
        false,
        "last grace day remains on time even if entered later",
      );
      assert.equal(row.summary.paidAfterGraceCents, "0");
      assert.equal(row.charges[0].settledOn, shift(-5));
    },
  );
  await t.test(
    "open schedules protect lease financial terms, immutable grants and tenant boundaries",
    async () => {
      const terms = {
        startsOn: first,
        endsOn: last,
        monthlyRent: "1000.00",
        status: "active",
        expectedVersion: lease.version,
      };
      assert.equal(
        (
          await call("owner", "PATCH", "/api/company/leases/" + lease.id, {
            ...terms,
            monthlyRent: "1100.00",
          })
        ).json().code,
        "LEASE_SCHEDULE_CONFLICT",
      );
      lease = ok(
        await call("owner", "PATCH", "/api/company/leases/" + lease.id, {
          ...terms,
          paymentInstructions: "Mail checks to the office.",
        }),
      );
      assert.deepEqual(await db.rentSchedule.findMany(), []);
      assert.deepEqual(await db.rentScheduleOccurrence.findMany(), []);
      assert.equal(
        (await call("foreign", "GET", `${base}/${lease.id}/schedule`))
          .statusCode,
        404,
      );
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
          return tx.rentSchedule.update({
            where: { id: schedule.id },
            data: { amountCents: 1 },
          });
        }),
        /permission denied/i,
      );
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
          return tx.rentScheduleOccurrence.deleteMany({
            where: { leaseId: lease.id },
          });
        }),
        /permission denied/i,
      );
    },
  );
  await t.test(
    "audit outage rolls back automated money and cursor; retry catches up exactly once and completes",
    async () => {
      await admin.query(
        `CREATE FUNCTION reject_schedule_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='rent.charge.scheduled' THEN RAISE EXCEPTION 'test audit outage'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_schedule_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_schedule_audit()`,
      );
      const future = new Date(last + "T12:00:00Z");
      future.setUTCMonth(future.getUTCMonth() + 1);
      const errors = [];
      await billingSweep(
        db,
        {},
        { now: future, onError: (c) => errors.push(c) },
      );
      assert.ok(errors.includes("BILLING_RETRY_REQUIRED"));
      let row = await read();
      assert.equal(row.schedule.nextPeriodOn.slice(0, 10), last);
      assert.equal(row.history.length, 1);
      assert.equal(row.schedule.lastErrorCode, "BILLING_RETRY_REQUIRED");
      const accounts=await call('owner','GET','/api/company/rent');assert.equal(accounts.statusCode,200,accounts.body);assert.ok(accounts.json().accounts.some(account=>account.lease.id===lease.id&&account.billingIssue));
      const attention=await call('owner','GET','/api/company/overview');assert.ok(attention.json().billingIssues.count>=1);
      assert.equal((await get()).charges.length, 1);
      await admin.query(
        `DROP TRIGGER reject_schedule_audit ON "AuditEvent";DROP FUNCTION reject_schedule_audit()`,
      );
      await Promise.all([worker(future), worker(future)]);
      row = await read();
      assert.equal(row.history.length, 2);
      assert.equal(row.schedule.status, "completed");
      assert.equal(row.schedule.lastErrorCode, null);
      assert.equal((await get()).charges[1].amountCents, 75000);
    },
  );
  await t.test(
    "replacement schedules never recreate processed or deliberately voided months",
    async () => {
      const unit = ok(
        await call(
          "owner",
          "POST",
          "/api/company/properties/billing-home/units",
          { label: "Suppressed unit", submissionKey: randomUUID() },
        ),
      );
      const other = ok(
        await call("owner", "POST", "/api/company/leases", {
          propertyId: "billing-home",
          unitId: unit.id,
          residentId: "resident2",
          startsOn: first,
          endsOn: null,
          monthlyRent: "900.00",
          status: "active",
          submissionKey: randomUUID(),
        }),
      );
      const charge = ok(
        await call("owner", "POST", `${base}/${other.id}/charges`, {
          periodOn: first,
          dueOn: shift(-1),
          amount: "900.00",
          memo: null,
          expectedVersion: 1,
          submissionKey: randomUUID(),
        }),
      );
      ok(
        await call("owner", "POST", `${base}/charges/${charge.id}/void`, {
          reason: "Do not rebill this month",
          expectedVersion: 1,
        }),
      );
      const input = {
        firstPeriodOn: first,
        lastPeriodOn: null,
        firstDueOn: shift(-1),
        firstAmount: null,
        lastAmount: null,
        leadDays: 0,
        expectedVersion: 1,
        submissionKey: randomUUID(),
      };
      let row = ok(
        await call("owner", "POST", `${base}/${other.id}/schedules`, input),
      );
      assert.equal(
        ok(
          await call(
            "owner",
            "POST",
            `/api/company/rent-schedules/${row.id}/run`,
            {},
          ),
        ).outcome,
        "suppressed",
      );
      row = ok(
        await call("owner", "GET", `${base}/${other.id}/schedule`),
      ).schedule;
      row = ok(
        await call("owner", "PATCH", `/api/company/rent-schedules/${row.id}`, {
          status: "stopped",
          expectedVersion: row.version,
        }),
      );
      assert.equal(
        (
          await call(
            "owner",
            "PATCH",
            `/api/company/rent-schedules/${row.id}`,
            { status: "active", expectedVersion: row.version },
          )
        ).statusCode,
        409,
      );
      const replacement = ok(
        await call("owner", "POST", `${base}/${other.id}/schedules`, {
          ...input,
          submissionKey: randomUUID(),
        }),
      );
      ok(
        await call(
          "owner",
          "POST",
          `/api/company/rent-schedules/${replacement.id}/run`,
          {},
        ),
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1`,
            [other.id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "RentScheduleOccurrence" WHERE "leaseId"=$1`,
            [other.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );

  await t.test(
    "a corrected active charge wins over its voided predecessor in both preview and generation",
    async () => {
      const unit = ok(
        await call(
          "owner",
          "POST",
          "/api/company/properties/billing-home/units",
          { label: "Corrected billing", submissionKey: randomUUID() },
        ),
      );
      const record = ok(
        await call("owner", "POST", "/api/company/leases", {
          propertyId: "billing-home",
          unitId: unit.id,
          residentId: "resident2",
          startsOn: first,
          endsOn: null,
          monthlyRent: "900.00",
          status: "active",
          submissionKey: randomUUID(),
        }),
      );
      const data = {
        periodOn: first,
        dueOn: shift(-1),
        amount: "900.00",
        memo: null,
        expectedVersion: 1,
        submissionKey: randomUUID(),
      };
      const original = ok(
        await call("owner", "POST", `${base}/${record.id}/charges`, data),
      );
      ok(
        await call("owner", "POST", `${base}/charges/${original.id}/void`, {
          reason: "Correct amount",
          expectedVersion: 1,
        }),
      );
      const corrected = ok(
        await call("owner", "POST", `${base}/${record.id}/charges`, {
          ...data,
          amount: "850.00",
          submissionKey: randomUUID(),
        }),
      );
      const config = {
        firstPeriodOn: first,
        lastPeriodOn: null,
        firstDueOn: shift(-1),
        firstAmount: null,
        lastAmount: null,
        leadDays: 0,
        expectedVersion: 1,
        submissionKey: randomUUID(),
      };
      assert.equal(
        ok(
          await call(
            "owner",
            "POST",
            `${base}/${record.id}/schedule-preview`,
            config,
          ),
        ).preview[0].action,
        "existing",
      );
      const enabled = ok(
        await call("owner", "POST", `${base}/${record.id}/schedules`, config),
      );
      const run = ok(
        await call(
          "owner",
          "POST",
          `/api/company/rent-schedules/${enabled.id}/run`,
          {},
        ),
      );
      assert.equal(run.outcome, "existing");
      assert.equal(run.occurrence.chargeId, corrected.id);
      const statement = ok(await call("owner", "GET", `/api/company/statements/${record.id}`));
      assert.equal(statement.items.filter(item=>item.type==="charge").length,2);
      assert.equal(statement.period.chargedCents,"85000");
      assert.equal(statement.period.voidedCount,1);
      assert.equal(statement.current.outstandingCents,"85000");
      assert.equal(statement.items.find(item=>item.id===original.id).effectCents,"0");
      assert.equal(statement.items.find(item=>item.id===corrected.id).amountCents,"85000");
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1`,
            [record.id],
          )
        ).rows[0].n,
        2,
      );
    },
  );
  await t.test(
    "real browser activation with a lost committed response replays one reviewed schedule",
    { skip: !process.env.TEST_FINANCES_BROWSER_URL },
    async () => {
      const unit = ok(
        await call(
          "owner",
          "POST",
          "/api/company/properties/billing-home/units",
          { label: "Browser billing", submissionKey: randomUUID() },
        ),
      );
      const browserLease = ok(
        await call("owner", "POST", "/api/company/leases", {
          propertyId: "billing-home",
          unitId: unit.id,
          residentId: "resident2",
          startsOn: first,
          endsOn: null,
          monthlyRent: "200.00",
          status: "active",
          submissionKey: randomUUID(),
        }),
      );
      const browser = await launchFixtureBrowser({ headless: true });
      try {
        const page = await newFixturePage(browser);
        let lose = true;
        const keys = [];
        await page.route("**/api/**", async (route) => {
          const req = route.request(),
            u = new URL(req.url()),
            payload = req.postData() ? req.postDataJSON() : undefined;
          const response = await call(
            "owner",
            req.method(),
            u.pathname + u.search,
            payload,
          );
          if (
            req.method() === "POST" &&
            u.pathname === `${base}/${browserLease.id}/schedules`
          ) {
            assert.equal(response.statusCode, 200, response.body);
            keys.push(payload.submissionKey);
            if (lose) {
              lose = false;
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
          process.env.TEST_FINANCES_BROWSER_URL +
            "/company/rent?leaseId=" +
            browserLease.id,
        );
        await page
          .getByRole("button", { name: "Set up recurring rent", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Review schedule", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Enable recurring rent", exact: true })
          .click();
        await expect(page.getByRole("alert")).toBeVisible();
        await page.reload();
        await page
          .getByRole("button", { name: "Recover reviewed schedule" })
          .click();
        await page
          .getByRole("button", { name: "Retry enabling this schedule" })
          .click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        await expect(
          page.getByRole("button", { name: "Manage billing schedule" }),
        ).toBeVisible();
        assert.equal(keys.length, 2);
        assert.equal(keys[0], keys[1]);
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM "RentSchedule" WHERE "leaseId"=$1`,
              [browserLease.id],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM "AuditEvent" WHERE action='rent.schedule.enabled' AND detail->>'leaseId'=$1`,
              [browserLease.id],
            )
          ).rows[0].n,
          1,
        );
      } finally {
        await browser.close();
      }
    },
  );
}
