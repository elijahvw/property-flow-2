import { newFixturePage, launchFixtureBrowser } from "./browser-fixture.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { companyDay } from "../dist/reports.js";
import { serializable } from "../dist/application.js";
import { generateRentOccurrence } from "../dist/rent-schedules.js";
import {
  termsAt,
  termInstallment,
  currentLeaseTerms,
} from "../dist/lease-term-policy.js";
export async function leaseTermCases(t, admin, call, app, db) {
  const ok = (r) => {
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    },
    today = companyDay("America/New_York"),
    month = today.slice(0, 7) + "-01";
  const shift = (n) => {
    const d = new Date(month);
    d.setUTCMonth(d.getUTCMonth() + n);
    return d.toISOString().slice(0, 10);
  };
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
        startsOn: month,
        endsOn: null,
        monthlyRent: "1500.00",
        rentDueDay: 1,
        graceDays: 5,
        paymentInstructions: "Original agreed instructions",
        status: "active",
        submissionKey: randomUUID(),
        ...extra,
      }),
    );
  };
  const root = (l) => `/api/company/leases/${l.id}/terms`,
    rent = (l) => `/api/company/rent/${l.id}`,
    read = async (l) => ok(await call("owner", "GET", root(l))),
    body = async (l, patch = {}) => ({
      effectiveOn: shift(1),
      monthlyRent: "1650.25",
      rentDueDay: 31,
      graceDays: 3,
      paymentInstructions: "New agreed instructions",
      reason: "Agreed future lease terms",
      expectedLeaseVersion: (await read(l)).lease.version,
      ...patch,
    });
  const commit = async (l, b) => {
    const p = ok(await call("owner", "POST", root(l) + "/preview", b));
    const payload = {
      ...b,
      sourceHash: p.sourceHash,
      submissionKey: randomUUID(),
      confirmed: true,
    };
    return {
      p,
      payload,
      row: ok(await call("owner", "POST", root(l), payload)),
    };
  };
  const worker = (l, s, on) =>
    serializable(db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id='a' FOR SHARE`;
      await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
      return generateRentOccurrence(
        tx,
        "a",
        s.id,
        { id: "term-worker", principal: { id: "system:rent-billing" } },
        new Date(on + "T20:00:00Z"),
      );
    });
  let lease, saved, posted;
  await t.test(
    "complete future preview, strict dates, scoped roles and no posted-money changes",
    async () => {
      lease = await make("Future terms");
      posted = ok(
        await call("owner", "POST", rent(lease) + "/charges", {
          periodOn: month,
          dueOn: month,
          amount: "1500.00",
          memo: null,
          expectedVersion: lease.version,
          submissionKey: randomUUID(),
        }),
      );
      ok(
        await call("owner", "POST", rent(lease) + "/payments", {
          occurredOn: month,
          amount: "600.00",
          memo: null,
          submissionKey: randomUUID(),
        }),
      );
      const before = (
        await admin.query(
          `SELECT to_jsonb(c) row FROM "RentCharge" c WHERE id=$1`,
          [posted.id],
        )
      ).rows[0].row;
      const b = await body(lease),
        preview = ok(
          await call("manager", "POST", root(lease) + "/preview", b),
        );
      assert.equal(preview.installments.length, 12);
      assert.equal(preview.continues, true);
      assert.equal(preview.before.rentCents, 150000);
      assert.equal(preview.after.rentCents, 165025);
      assert.equal(
        preview.installments[0].after.dueOn.slice(0, 10),
        new Date(Date.parse(shift(2)) - 86400000).toISOString().slice(0, 10),
      );
      for (const user of ["staff", "resident", "platform", "foreign"])
        assert.ok(
          [403, 404].includes(
            (await call(user, "POST", root(lease) + "/preview", b)).statusCode,
          ),
        );
      for (const patch of [
        { effectiveOn: month },
        { effectiveOn: shift(1).slice(0, 8) + "02" },
        { effectiveOn: "2026-02-30" },
        { monthlyRent: "0" },
        { monthlyRent: "1.001" },
        { reason: "" },
        { rentDueDay: 32 },
        { graceDays: 31 },
        { companyId: "b" },
        { expectedLeaseVersion: 999 },
      ])
        assert.ok(
          [400, 409].includes(
            (
              await call("owner", "POST", root(lease) + "/preview", {
                ...b,
                ...patch,
              })
            ).statusCode,
          ),
        );
      assert.equal(
        (
          await call("owner", "POST", root(lease) + "/preview", b, {
            "x-csrf-token": "wrong",
          })
        ).statusCode,
        403,
      );
      saved = await commit(lease, b);
      assert.equal((await read(lease)).lease.version, lease.version + 1);
      assert.equal((await read(lease)).current.rentCents, 150000);
      assert.equal((await read(lease)).pending.id, saved.row.id);
      assert.deepEqual(
        (
          await admin.query(
            `SELECT to_jsonb(c) row FROM "RentCharge" c WHERE id=$1`,
            [posted.id],
          )
        ).rows[0].row,
        before,
      );
      assert.equal(
        ok(await call("owner", "POST", root(lease), saved.payload)).id,
        saved.row.id,
      );
      assert.equal(
        (
          await call("owner", "POST", root(lease), {
            ...saved.payload,
            reason: "different",
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await call(
            "owner",
            "POST",
            root(lease) + "/preview",
            await body(lease),
          )
        ).statusCode,
        409,
      );
      const account = ok(
        await call("owner", "GET", "/api/company/rent?leaseId=" + lease.id),
      ).accounts[0];
      assert.equal(account.lease.rentCents, 150000);
      assert.equal(account.lease.hasTermHistory, true);
      assert.equal(account.summary.outstandingCents, "90000");
      const next = ok(
        await call("owner", "GET", rent(lease) + "/terms?periodOn=" + shift(1)),
      );
      assert.equal(next.rentCents, 165025);
      assert.equal(next.graceDays, 3);
      assert.equal(next.rentDueDay, 31);
    },
  );
  await t.test(
    "immutable history, baseline guard, tenant-safe visibility and current authority on retries",
    async () => {
      const data = ok(
        await call("resident", "GET", `/api/resident/leases/${lease.id}/terms`),
      );
      assert.equal(data.pending.id, saved.row.id);
      assert.equal(data.sourceHash, undefined);
      assert.equal(data.changes[0].createdById, undefined);
      assert.equal(data.changes[0].submissionKey, undefined);
      assert.deepEqual(await db.leaseTermChange.findMany(), []);
      for (const table of ["LeaseTermChange", "LeaseTermCancellation"])
        for (const privilege of ["UPDATE", "DELETE"])
          assert.equal(
            (
              await admin.query(
                `SELECT has_table_privilege('propertyflow_runtime',$1,$2) allowed`,
                ['"' + table + '"', privilege],
              )
            ).rows[0].allowed,
            false,
          );
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
          return tx.lease.update({
            where: { id: lease.id },
            data: { rentCents: 2 },
          });
        }),
        /baseline is immutable/i,
      );
      const d = ok(
        await call("owner", "GET", "/api/company/leases/" + lease.id),
      );
      assert.equal(d.hasTermHistory, true);
      assert.equal(d.overview.householdCount, 1);
      assert.equal(d.overview.pendingApprovals, 0);
      assert.equal(
        (
          await call("owner", "PATCH", "/api/company/leases/" + lease.id, {
            startsOn: month,
            endsOn: null,
            status: "active",
            monthlyRent: "1900",
            rentDueDay: 1,
            graceDays: 5,
            paymentInstructions: "Original agreed instructions",
            expectedVersion: d.version,
          })
        ).statusCode,
        409,
      );
      await admin.query(
        `UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='owner' AND "companyId"='a'`,
      );
      try {
        assert.equal(
          (await call("owner", "POST", root(lease), saved.payload)).statusCode,
          403,
        );
      } finally {
        await admin.query(
          `UPDATE "CompanyMembership" SET status='active' WHERE "userId"='owner' AND "companyId"='a'`,
        );
      }
      const rows = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
        const raw = await tx.lease.findUniqueOrThrow({
          where: { id: lease.id },
        });
        return currentLeaseTerms(tx, "a", [raw], shift(1));
      });
      assert.equal(rows[0].rentCents, 165025);
      assert.equal(rows[0].rentDueDay, 31);
    },
  );
  await t.test(
    "cancellation is a separate reviewed replayable event; stale source previews fail closed",
    async () => {
      const b = {
        reason: "Agreement withdrawn before taking effect",
        expectedLeaseVersion: (await read(lease)).lease.version,
      };
      const preview = ok(
        await call(
          "owner",
          "POST",
          root(lease) + `/${saved.row.id}/cancel-preview`,
          b,
        ),
      );
      assert.equal(preview.before.rentCents, 165025);
      assert.equal(preview.after.rentCents, 150000);
      assert.equal(preview.installments[0].after.amountCents, 150000);
      const payload = {
        ...b,
        sourceHash: preview.sourceHash,
        confirmed: true,
        submissionKey: randomUUID(),
      };
      const cancellation = ok(
        await call(
          "owner",
          "POST",
          root(lease) + `/${saved.row.id}/cancel`,
          payload,
        ),
      );
      assert.equal(
        ok(
          await call(
            "owner",
            "POST",
            root(lease) + `/${saved.row.id}/cancel`,
            payload,
          ),
        ).id,
        cancellation.id,
      );
      let d = await read(lease);
      assert.equal(d.pending, null);
      assert.equal(d.changes[0].status, "cancelled");
      assert.equal(d.changes[0].cancellation.reason, b.reason);
      const change = await body(lease),
        p = ok(await call("owner", "POST", root(lease) + "/preview", change));
      ok(
        await call("owner", "POST", rent(lease) + "/schedules", {
          firstPeriodOn: shift(1),
          firstDueOn: shift(1),
          leadDays: 0,
          expectedVersion: change.expectedLeaseVersion,
          submissionKey: randomUUID(),
        }),
      );
      assert.equal(
        (
          await call("owner", "POST", root(lease), {
            ...change,
            sourceHash: p.sourceHash,
            confirmed: true,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        409,
      );
      saved = await commit(lease, await body(lease));
      d = await read(lease);
      assert.equal(d.changes.length, 2);
      assert.equal(d.pending.id, saved.row.id);
    },
  );
  await t.test(
    "worker uses per-month terms and immutable charge snapshots; posted future history blocks cancellation and repricing",
    async () => {
      const schedule = (
        await admin.query(
          `SELECT id FROM "RentSchedule" WHERE "leaseId"=$1 AND status='active'`,
          [lease.id],
        )
      ).rows[0];
      await worker(lease, schedule, shift(2));
      const charges = (
        await admin.query(
          `SELECT * FROM "RentCharge" WHERE "leaseId"=$1 ORDER BY "periodOn"`,
          [lease.id],
        )
      ).rows;
      const future = charges.find(
        (c) => c.periodOn.toISOString().slice(0, 10) === shift(1),
      );
      assert.equal(future.amountCents, 165025);
      assert.equal(future.graceDays, 3);
      assert.equal(future.termChangeId, saved.row.id);
      assert.equal(
        future.termsSnapshot.paymentInstructions,
        "New agreed instructions",
      );
      assert.equal(future.termsSnapshot.rentCents, 165025);
      assert.equal(charges[0].termChangeId, null);
      assert.equal(charges[0].amountCents, 150000);
      assert.equal(
        (
          await call(
            "owner",
            "POST",
            root(lease) + `/${saved.row.id}/cancel-preview`,
            {
              reason: "Too late",
              expectedLeaseVersion: (await read(lease)).lease.version,
            },
          )
        ).statusCode,
        409,
      );
      ok(
        await call(
          "owner",
          "POST",
          `/api/company/rent/charges/${future.id}/void`,
          { expectedVersion: future.version, reason: "Recorded in error" },
        ),
      );
      assert.equal(
        (
          await call(
            "owner",
            "POST",
            root(lease) + `/${saved.row.id}/cancel-preview`,
            {
              reason: "Still recorded history",
              expectedLeaseVersion: (await read(lease)).lease.version,
            },
          )
        ).statusCode,
        409,
      );
      assert.equal(
        (await read(lease)).earliestEffectiveOn.slice(0, 10),
        shift(2),
      );
    },
  );
  await t.test(
    "finite previews preserve explicit partial amounts and first due dates, without starting or resuming billing",
    async () => {
      const l = await make("Partial future lease", {
        startsOn: shift(1),
        endsOn: shift(3),
      });
      const s = ok(
        await call("owner", "POST", rent(l) + "/schedules", {
          firstPeriodOn: shift(1),
          lastPeriodOn: shift(3),
          firstDueOn: shift(1),
          firstAmount: "500.00",
          lastAmount: "750.00",
          leadDays: 0,
          expectedVersion: l.version,
          submissionKey: randomUUID(),
        }),
      );
      const b = await body(l),
        p = ok(await call("owner", "POST", root(l) + "/preview", b));
      assert.equal(p.continues, false);
      assert.equal(p.installments.length, 3);
      assert.equal(p.installments[0].after.amountCents, 50000);
      assert.equal(p.installments[0].after.dueOn.slice(0, 10), shift(1));
      assert.equal(p.installments[0].amountOverride, true);
      assert.equal(p.installments[0].dueOverride, true);
      assert.equal(p.installments[1].after.amountCents, 165025);
      assert.equal(p.installments[2].after.amountCents, 75000);
      await commit(l, b);
      await worker(l, s, shift(2));
      const c = (
        await admin.query(
          `SELECT "amountCents","termsSnapshot" FROM "RentCharge" WHERE "leaseId"=$1`,
          [l.id],
        )
      ).rows[0];
      assert.equal(c.amountCents, 50000);
      assert.equal(c.termsSnapshot.rentCents, 165025);
      assert.equal(c.termsSnapshot.chargedCents, 50000);
      const manual = await make("Manual upcoming", {
        startsOn: shift(2).slice(0, 8) + "15",
      });
      assert.equal(
        (await read(manual)).earliestEffectiveOn.slice(0, 10),
        shift(3),
      );
      const m = await commit(
        manual,
        await body(manual, { effectiveOn: shift(3) }),
      );
      assert.equal(m.p.schedule, null);
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "RentSchedule" WHERE "leaseId"=$1`,
            [manual.id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "concurrent writers keep one future change; audit failures roll back lease version and event identity",
    async () => {
      const l = await make("Terms concurrency"),
        b = await body(l),
        p = ok(await call("owner", "POST", root(l) + "/preview", b)),
        payload = {
          ...b,
          sourceHash: p.sourceHash,
          confirmed: true,
          submissionKey: randomUUID(),
        };
      const replies = await Promise.all([
        call("owner", "POST", root(l), payload),
        call("owner", "POST", root(l), payload),
      ]);
      assert.equal(ok(replies[0]).id, ok(replies[1]).id);
      assert.equal((await read(l)).changes.length, 1);
      const l2 = await make("Terms audit rollback"),
        b2 = await body(l2),
        p2 = ok(await call("owner", "POST", root(l2) + "/preview", b2)),
        payload2 = {
          ...b2,
          sourceHash: p2.sourceHash,
          confirmed: true,
          submissionKey: randomUUID(),
        };
      await admin.query(
        `CREATE FUNCTION reject_term_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'lease.terms.%' THEN RAISE EXCEPTION 'term audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_term_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_term_audit()`,
      );
      try {
        assert.equal(
          (await call("owner", "POST", root(l2), payload2)).statusCode,
          500,
        );
        assert.equal((await read(l2)).lease.version, l2.version);
        assert.equal((await read(l2)).changes.length, 0);
      } finally {
        await admin.query(
          `DROP TRIGGER reject_term_audit ON "AuditEvent";DROP FUNCTION reject_term_audit()`,
        );
      }
      ok(await call("owner", "POST", root(l2), payload2));
    },
  );
  await t.test(
    "paused billing remains paused and cancellation races are fenced against posting",
    async () => {
      const l = await make("Paused future billing"),
        schedule = ok(
          await call("owner", "POST", rent(l) + "/schedules", {
            firstPeriodOn: shift(1),
            firstDueOn: shift(1),
            leadDays: 0,
            expectedVersion: l.version,
            submissionKey: randomUUID(),
          }),
        );
      ok(
        await call(
          "owner",
          "PATCH",
          `/api/company/rent-schedules/${schedule.id}`,
          { status: "paused", expectedVersion: schedule.version },
        ),
      );
      const change = await commit(l, await body(l));
      assert.equal(change.p.schedule.status, "paused");
      assert.equal(change.p.installments[0].action, "paused");
      assert.equal((await worker(l, schedule, shift(2))).outcome, "inactive");
      const c = {
          reason: "Cancel before effective month",
          expectedLeaseVersion: (await read(l)).lease.version,
        },
        cp = ok(
          await call(
            "owner",
            "POST",
            root(l) + `/${change.row.id}/cancel-preview`,
            c,
          ),
        );
      const cancelled = ok(
        await call("owner", "POST", root(l) + `/${change.row.id}/cancel`, {
          ...c,
          sourceHash: cp.sourceHash,
          confirmed: true,
          submissionKey: randomUUID(),
        }),
      );
      assert.ok(cancelled.id);
      assert.equal(
        (
          await admin.query(`SELECT status FROM "RentSchedule" WHERE id=$1`, [
            schedule.id,
          ])
        ).rows[0].status,
        "paused",
      );
      const raced = await make("Cancellation posting race"),
        rs = ok(
          await call("owner", "POST", rent(raced) + "/schedules", {
            firstPeriodOn: shift(1),
            firstDueOn: shift(1),
            leadDays: 0,
            expectedVersion: raced.version,
            submissionKey: randomUUID(),
          }),
        ),
        rc = await commit(raced, await body(raced));
      const cb = {
          reason: "Race cancellation",
          expectedLeaseVersion: (await read(raced)).lease.version,
        },
        rp = ok(
          await call(
            "owner",
            "POST",
            root(raced) + `/${rc.row.id}/cancel-preview`,
            cb,
          ),
        );
      const [posted, cancel] = await Promise.all([
        worker(raced, rs, shift(2)),
        call("manager", "POST", root(raced) + `/${rc.row.id}/cancel`, {
          ...cb,
          sourceHash: rp.sourceHash,
          confirmed: true,
          submissionKey: randomUUID(),
        }),
      ]);
      assert.equal(posted.outcome, "posted");
      assert.ok([200, 409].includes(cancel.statusCode), cancel.body);
      const final = await read(raced),
        charge = (
          await admin.query(
            `SELECT "amountCents","termChangeId" FROM "RentCharge" WHERE "leaseId"=$1`,
            [raced.id],
          )
        ).rows[0],
        isCancelled = !!final.changes[0].cancellation;
      assert.equal(charge.amountCents, isCancelled ? 150000 : 165025);
      assert.equal(charge.termChangeId, isCancelled ? null : rc.row.id);
    },
  );
  await t.test(
    "independent owner and manager submissions cannot create overlapping future changes",
    async () => {
      const l = await make("Overlapping term requests"),
        b = await body(l),
        p = ok(await call("owner", "POST", root(l) + "/preview", b));
      const replies = await Promise.all([
        call("owner", "POST", root(l), {
          ...b,
          sourceHash: p.sourceHash,
          confirmed: true,
          submissionKey: randomUUID(),
        }),
        call("manager", "POST", root(l), {
          ...b,
          sourceHash: p.sourceHash,
          confirmed: true,
          submissionKey: randomUUID(),
        }),
      ]);
      assert.deepEqual(replies.map((r) => r.statusCode).sort(), [200, 409]);
      assert.equal((await read(l)).changes.length, 1);
    },
  );
  await t.test(
    "effective resolver clamps short months and skips cancelled history",
    () => {
      const base = {
          rentCents: 150000,
          rentDueDay: 1,
          graceDays: 5,
          paymentInstructions: null,
        },
        change = {
          id: "change",
          effectiveOn: new Date("2027-02-01"),
          rentCents: 165025,
          rentDueDay: 31,
          graceDays: 3,
          paymentInstructions: "Updated",
          cancellation: null,
        };
      assert.equal(
        termsAt(base, [change], new Date("2027-01-01")).rentCents,
        150000,
      );
      assert.equal(
        termsAt(base, [change], new Date("2027-02-01")).rentCents,
        165025,
      );
      assert.equal(
        termsAt(
          base,
          [{ ...change, cancellation: { id: "cancel" } }],
          new Date("2027-02-01"),
        ).rentCents,
        150000,
      );
      const item = termInstallment(
        {
          amountCents: 150000,
          dueDay: 1,
          graceDays: 5,
          firstPeriodOn: new Date("2027-01-01"),
          lastPeriodOn: null,
          firstDueOn: null,
          firstAmountCents: null,
          lastAmountCents: null,
          leadDays: 2,
        },
        [change],
        new Date("2027-02-01"),
      );
      assert.equal(item.dueOn.toISOString().slice(0, 10), "2027-02-28");
      assert.equal(item.postOn.toISOString().slice(0, 10), "2027-02-26");
    },
  );
  await t.test(
    "real browser retains a committed term review across reload and safely retries one identity",
    { skip: !process.env.TEST_FINANCES_BROWSER_URL },
    async () => {
      const l = await make("Browser future terms");
      const browser = await launchFixtureBrowser({ headless: true });
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
          if (req.method() === "POST" && u.pathname === root(l)) {
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
          process.env.TEST_FINANCES_BROWSER_URL + `/company/leases/${l.id}`,
        );
        await expect(
          page.getByRole("heading", { name: "Lease details", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("Work through the lease in order.", { exact: false }),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "Terms & changes", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Schedule a term change", exact: true })
          .click();
        await page
          .getByLabel("Reason shown to the tenant", { exact: true })
          .fill("Browser reviewed terms");
        await page
          .getByRole("button", { name: "Continue to new terms", exact: true })
          .click();
        await page
          .getByLabel("New monthly rent (USD)", { exact: true })
          .fill("1700.00");
        await page
          .getByRole("button", { name: "Review future terms", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "Affected installments",
            exact: true,
          }),
        ).toBeVisible();
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", { name: "Confirm term change", exact: true })
          .click();
        await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
        await page.reload();
        await page
          .getByRole("button", { name: "Resume terms review", exact: true })
          .click();
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", { name: "Confirm term change", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        assert.equal(keys.length, 2);
        assert.equal(keys[0], keys[1]);
        assert.equal((await read(l)).changes.length, 1);
        await page.goto(
          process.env.TEST_FINANCES_BROWSER_URL +
            `/company/rent?leaseId=${l.id}`,
        );
        await page
          .getByRole("button", { name: "Post monthly rent", exact: true })
          .click();
        await page
          .getByLabel("Rent month", { exact: true })
          .fill(shift(1).slice(0, 7));
        await expect(
          page.getByLabel("Charge amount (USD)", { exact: true }),
        ).toHaveValue("1700.00");
        await page
          .getByLabel("Charge amount (USD)", { exact: true })
          .fill("850.00");
        await page
          .getByLabel("Rent month", { exact: true })
          .fill(month.slice(0, 7));
        await expect(
          page.getByLabel("Charge amount (USD)", { exact: true }),
        ).toHaveValue("1500.00");
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Close", exact: true })
          .click();
        const discard = page.getByRole("button", { name: "Close without saving", exact: true });
        if (await discard.isVisible()) await discard.click();
        await page.goto(
          process.env.TEST_FINANCES_BROWSER_URL +
            `/company/leases/${l.id}?section=terms`,
        );
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: "/tmp/propertyflow-future-terms-mobile.png",
          fullPage: true,
        });
      } finally {
        await browser.close();
      }
    },
  );
}
