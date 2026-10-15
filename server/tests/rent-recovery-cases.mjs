import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { companyDay } from "../dist/reports.js";
export async function rentRecoveryCases(t, admin, call, db) {
  const ok = (r) => {
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    },
    today = companyDay("America/New_York"),
    month = today.slice(0, 7) + "-01";
  let lease, schedule, original, occurrence, review, payment, reposted;
  const body = () => ({
    occurrenceId: occurrence.id,
    expectedLeaseVersion: review.expectedLeaseVersion,
    expectedScheduleVersion: review.expectedScheduleVersion,
    reason: "Restore a test charge",
    submissionKey: randomUUID(),
  });
  const get = async () =>
    ok(await call("owner", "GET", `/api/company/rent/${lease.id}/schedule`));
  await t.test(
    "voiding an already-retained month leaves automation alone and explains the exact next posting date",
    async () => {
      await admin.query(
        `INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES('recovery-home','Recovery House','street','city','state','zip','a',NOW());INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','recovery-home','resident2')`,
      );
      const unit = ok(
        await call(
          "owner",
          "POST",
          "/api/company/properties/recovery-home/units",
          { label: "Recovery unit", submissionKey: randomUUID() },
        ),
      );
      lease = ok(
        await call("owner", "POST", "/api/company/leases", {
          propertyId: "recovery-home",
          unitId: unit.id,
          residentId: "resident2",
          startsOn: month,
          endsOn: null,
          monthlyRent: "1000.00",
          status: "active",
          rentDueDay: 31,
          graceDays: 5,
          submissionKey: randomUUID(),
        }),
      );
      original = ok(
        await call("owner", "POST", `/api/company/rent/${lease.id}/charges`, {
          periodOn: month,
          dueOn: today,
          amount: "900.00",
          memo: null,
          expectedVersion: 1,
          submissionKey: randomUUID(),
        }),
      );
      assert.match(original.reference, /^RC-\d+$/);
      schedule = ok(
        await call("owner", "POST", `/api/company/rent/${lease.id}/schedules`, {
          firstPeriodOn: month,
          lastPeriodOn: null,
          firstDueOn: today,
          firstAmount: null,
          lastAmount: null,
          leadDays: 0,
          expectedVersion: 1,
          submissionKey: randomUUID(),
        }),
      );
      assert.equal(
        ok(
          await call(
            "owner",
            "POST",
            `/api/company/rent-schedules/${schedule.id}/run`,
            {},
          ),
        ).outcome,
        "existing",
      );
      ok(
        await call(
          "owner",
          "POST",
          `/api/company/rent/charges/${original.id}/void`,
          { reason: "Testing recurring replacement", expectedVersion: 1 },
        ),
      );
      const next = ok(
        await call(
          "owner",
          "POST",
          `/api/company/rent-schedules/${schedule.id}/run`,
          {},
        ),
      );
      assert.equal(next.outcome, "not_due");
      assert.equal(next.previousInstallment.periodOn.slice(0, 10), month);
      assert.equal(next.previousInstallment.voided, true);
      assert.equal(next.businessDate, today);
      assert.ok(next.postOn.slice(0, 10) > today);
      const info = await get();
      occurrence = info.history[0];
      assert.equal(occurrence.charge.id, original.id);
      assert.equal(occurrence.currentCharge, null);
      review = ok(
        await call(
          "owner",
          "POST",
          `/api/company/rent-schedules/${schedule.id}/repost-preview`,
          { occurrenceId: occurrence.id },
        ),
      );
      assert.equal(review.amountCents, 100000);
      assert.equal(review.graceDays, 5);
      assert.equal(review.periodOn.slice(0, 10), month);
    },
  );
  await t.test(
    "repost preview, authority, CSRF and version checks remain current",
    async () => {
      for (const user of ["staff", "resident", "platform", "foreign"])
        assert.ok(
          [403, 404].includes(
            (
              await call(
                user,
                "POST",
                `/api/company/rent-schedules/${schedule.id}/repost-preview`,
                { occurrenceId: occurrence.id },
              )
            ).statusCode,
          ),
        );
      for (const patch of [
        { expectedLeaseVersion: 99 },
        { expectedScheduleVersion: 99 },
        { reason: "" },
        { reason: "x".repeat(301) },
        { companyId: "b" },
      ])
        assert.ok(
          [400, 409].includes(
            (
              await call(
                "owner",
                "POST",
                `/api/company/rent-schedules/${schedule.id}/reposts`,
                { ...body(), ...patch },
              )
            ).statusCode,
          ),
        );
      assert.equal(
        (
          await call(
            "owner",
            "POST",
            `/api/company/rent-schedules/${schedule.id}/reposts`,
            body(),
            { "x-csrf-token": "bad" },
          )
        ).statusCode,
        403,
      );
    },
  );
  await t.test(
    "audit failure leaves the original void and occurrence untouched and creates no replacement",
    async () => {
      await admin.query(
        `CREATE FUNCTION reject_repost_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='rent.schedule.reposted' THEN RAISE EXCEPTION 'test audit outage'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_repost_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_repost_audit()`,
      );
      assert.equal(
        (
          await call(
            "owner",
            "POST",
            `/api/company/rent-schedules/${schedule.id}/reposts`,
            body(),
          )
        ).statusCode,
        500,
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1`,
            [lease.id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal((await get()).history[0].charge.id, original.id);
      await admin.query(
        `DROP TRIGGER reject_repost_audit ON "AuditEvent";DROP FUNCTION reject_repost_audit()`,
      );
    },
  );
  await t.test(
    "concurrent retries repost once using saved terms, allocate credit once and preserve history/cursor",
    async () => {
      payment = ok(
        await call("owner", "POST", `/api/company/rent/${lease.id}/payments`, {
          amount: "100.00",
          occurredOn: today,
          memo: "Internal receipt",
          submissionKey: randomUUID(),
        }),
      );
      assert.match(payment.reference, /^TX-\d+$/);
      const before = await get(),
        payload = body(),
        results = await Promise.all([
          call(
            "owner",
            "POST",
            `/api/company/rent-schedules/${schedule.id}/reposts`,
            payload,
          ),
          call(
            "owner",
            "POST",
            `/api/company/rent-schedules/${schedule.id}/reposts`,
            payload,
          ),
        ]);
      reposted = ok(results[0]);
      assert.equal(ok(results[1]).id, reposted.id);
      assert.notEqual(reposted.reference, original.reference);
      assert.equal(reposted.amountCents, 100000);
      assert.equal(reposted.graceDays, 5);
      assert.equal(
        ok(
          await call(
            "owner",
            "POST",
            `/api/company/rent-schedules/${schedule.id}/run`,
            {},
          ),
        ).previousInstallment.voided,
        false,
      );
      const after = await get();
      assert.equal(after.schedule.nextPeriodOn, before.schedule.nextPeriodOn);
      assert.equal(after.history.length, 1);
      assert.equal(after.history[0].charge.id, original.id);
      assert.equal(after.history[0].currentCharge.id, reposted.id);
      const account = ok(
        await call("owner", "GET", "/api/company/rent?leaseId=" + lease.id),
      ).accounts[0];
      assert.equal(account.summary.outstandingCents, "90000");
      assert.equal(account.allocations.length, 1);
      assert.equal(
        (
          await call(
            "owner",
            "POST",
            `/api/company/rent-schedules/${schedule.id}/reposts`,
            body(),
          )
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "AuditEvent" WHERE action='rent.schedule.reposted' AND "targetId"=$1`,
            [reposted.id],
          )
        ).rows[0].n,
        1,
      );
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
          return tx.rentCharge.update({
            where: { id: reposted.id },
            data: { reference: "RC-fake" },
          });
        }),
        /permission denied/i,
      );
    },
  );
  await t.test(
    "platform audit resolves directory actors, automated billing and company names without widening access",
    async () => {
      const events = ok(
        await call(
          "platform",
          "GET",
          "/api/platform/audit?targetId=" + reposted.id,
        ),
      );
      assert.ok(
        events.some(
          (e) => e.actorLabel === "owner@test.invalid" && e.companyName === "a",
        ),
      );
      assert.ok(events.every((e) => typeof e.actorId === "string"));
      await admin.query(
        `INSERT INTO "AuditEvent"(id,"actorId","companyId",action,"requestId") VALUES('system-billing-label','system:rent-billing','a','rent.schedule.processed','test')`,
      );
      assert.ok(
        ok(await call("platform", "GET", "/api/platform/audit")).some(
          (e) => e.actorLabel === "Automatic rent billing",
        ),
      );
      for (const user of ["owner", "staff", "resident"])
        assert.equal(
          (await call(user, "GET", "/api/platform/audit")).statusCode,
          403,
        );
    },
  );
  await t.test(
    "real browser lost-response repost recovers after reload with one charge and audit",
    { skip: !process.env.TEST_FINANCES_BROWSER_URL },
    async () => {
      ok(
        await call(
          "owner",
          "POST",
          `/api/company/finances/${payment.id}/void`,
          { expectedVersion: 1, reason: "Clear test receipt" },
        ),
      );
      ok(
        await call(
          "owner",
          "POST",
          `/api/company/rent/charges/${reposted.id}/void`,
          { expectedVersion: 1, reason: "Test recovery retry" },
        ),
      );
      // Historical recovery must still use A after a new schedule B is current.
      const old = (await get()).schedule;
      ok(
        await call("owner", "PATCH", `/api/company/rent-schedules/${old.id}`, {
          status: "stopped",
          expectedVersion: old.version,
        }),
      );
      const replacement = ok(
        await call("owner", "POST", `/api/company/rent/${lease.id}/schedules`, {
          firstPeriodOn: old.nextPeriodOn.slice(0, 10),
          lastPeriodOn: null,
          firstDueOn: null,
          firstAmount: null,
          lastAmount: null,
          leadDays: 0,
          expectedVersion: lease.version,
          submissionKey: randomUUID(),
        }),
      );
      assert.notEqual(replacement.id, old.id);
      const replaced = await get();
      assert.equal(replaced.schedule.id, replacement.id);
      assert.equal(replaced.history[0].scheduleId, old.id);
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        let lose = true;
        const keys = [];
        await page.route("**/api/**", async (route) => {
          const req = route.request(),
            u = new URL(req.url()),
            payload = req.postData() ? req.postDataJSON() : undefined,
            response = await call(
              "owner",
              req.method(),
              u.pathname + u.search,
              payload,
            );
          if (u.pathname.endsWith("/reposts")) {
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
            lease.id,
        );
        await page
          .getByText("Posting history · latest page", { exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Review repost for " + new Intl.DateTimeFormat("en-US", {month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(month)),
            exact: true,
          })
          .click();
        await page
          .getByLabel("Reason for reposting")
          .fill("Browser recovery test");
        await page
          .getByRole("button", { name: "Repost installment", exact: true })
          .click();
        await expect(page.getByRole("alert")).toBeVisible();
        await page.reload();
        await page
          .getByRole("button", { name: "Recover pending repost" })
          .click();
        await page.getByRole("button", { name: "Retry this repost" }).click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        const final = await get();
        assert.equal(final.schedule.id, replacement.id);
        assert.equal(final.schedule.nextPeriodOn, replacement.nextPeriodOn);
        assert.equal(final.history[0].scheduleId, old.id);
        assert.equal(final.history[0].currentCharge.id !== reposted.id, true);
        assert.equal(keys.length, 2);
        assert.equal(keys[0], keys[1]);
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM "AuditEvent" WHERE action='rent.schedule.reposted' AND detail->>'reason'='Browser recovery test'`,
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
