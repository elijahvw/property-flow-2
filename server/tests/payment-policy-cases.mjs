import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { companyDay } from "../dist/reports.js";
export async function paymentPolicyCases(t, admin, call, db) {
  const today = companyDay("America/New_York"),
    year = Number(today.slice(0, 4)) - 1,
    shift = (n) => {
      const d = new Date(today + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
  const ok = (r) => {
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const root = "/api/company/rent";
  let lease,
    payment,
    initial,
    charges = [];
  const terms = (extra = {}) => ({
    startsOn: `${year}-01-01`,
    endsOn: null,
    monthlyRent: "1000.00",
    status: "active",
    expectedVersion: lease.version,
    ...extra,
  });
  const read = async () =>
    ok(await call("owner", "GET", root + "?leaseId=" + lease.id)).accounts[0];
  await t.test(
    "lease payment terms validate, replay durably and are shared only with authorized residents",
    async () => {
      await admin.query(
        `INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES('policy-home','Policy House','street','city','state','zip','a',NOW())`,
      );
      await admin.query(
        `INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','policy-home','resident2')`,
      );
      const unit = ok(
        await call(
          "owner",
          "POST",
          "/api/company/properties/policy-home/units",
          { label: "Policy unit", submissionKey: randomUUID() },
        ),
      );
      const body = {
        propertyId: "policy-home",
        unitId: unit.id,
        residentId: "resident2",
        startsOn: `${year}-01-01`,
        endsOn: null,
        monthlyRent: "1000.00",
        status: "active",
        rentDueDay: 31,
        graceDays: 5,
        paymentInstructions: "Pay by check at the office.",
        submissionKey: randomUUID(),
      };
      lease = ok(await call("owner", "POST", "/api/company/leases", body));
      assert.equal(lease.rentDueDay, 31);
      assert.equal(lease.graceDays, 5);
      assert.equal(
        ok(await call("owner", "POST", "/api/company/leases", body)).id,
        lease.id,
      );
      assert.equal(
        (
          await call("owner", "POST", "/api/company/leases", {
            ...body,
            graceDays: 6,
          })
        ).statusCode,
        409,
      );
      for (const patch of [
        { rentDueDay: 0 },
        { rentDueDay: 32 },
        { rentDueDay: "1" },
        { graceDays: -1 },
        { graceDays: 31 },
        { graceDays: 1.5 },
        { paymentInstructions: "x".repeat(1001) },
      ])
        assert.equal(
          (
            await call("owner", "POST", "/api/company/leases", {
              ...body,
              ...patch,
              submissionKey: randomUUID(),
            })
          ).statusCode,
          400,
        );
      const own = ok(
        await call(
          "resident2",
          "GET",
          "/api/resident/rent?leaseId=" + lease.id,
        ),
      ).accounts[0];
      assert.equal(own.lease.paymentInstructions, body.paymentInstructions);
      assert.equal(own.lease.graceDays, 5);
      assert.equal(
        (
          await call(
            "resident",
            "GET",
            "/api/resident/rent?leaseId=" + lease.id,
          )
        ).statusCode,
        404,
      );
    },
  );
  await t.test(
    "complete aging separates upcoming, due today, within grace and past grace at date boundaries",
    async () => {
      for (const [i, offset, amount] of [
        [1, 0, "100.00"],
        [2, -1, "200.00"],
        [3, -6, "300.00"],
        [4, -31, "400.00"],
        [5, -61, "500.00"],
        [6, -91, "600.00"],
        [7, 1, "700.00"],
      ]) {
        const body = {
          periodOn: `${year}-${String(i).padStart(2, "0")}-01`,
          dueOn: shift(offset),
          amount,
          memo: null,
          expectedVersion: 1,
          submissionKey: randomUUID(),
        };
        const charge = ok(
          await call("owner", "POST", `${root}/${lease.id}/charges`, body),
        );
        assert.equal(charge.graceDays, 5);
        charges.push({ body, ...charge });
      }
      initial = await read();
      assert.equal(initial.summary.outstandingCents, "280000");
      assert.equal(initial.summary.overdueCents, "200000");
      assert.equal(initial.summary.afterGraceCents, "180000");
      assert.equal(initial.summary.withinGraceCents, "20000");
      assert.equal(initial.summary.dueTodayCents, "10000");
      assert.equal(initial.summary.upcomingCents, "70000");
      for (const [key, value] of Object.entries({
        age1To30Cents: "50000",
        age31To60Cents: "40000",
        age61To90Cents: "50000",
        age91PlusCents: "60000",
      }))
        assert.equal(initial.summary[key], value);
      assert.deepEqual(
        initial.charges.map((c) => c.collectionStatus),
        [
          "past_grace",
          "past_grace",
          "past_grace",
          "past_grace",
          "within_grace",
          "due_today",
          "upcoming",
        ],
      );
      const within = initial.charges.find((c) => c.amountCents === 20000);
      assert.equal(within.graceThrough, shift(4));
      assert.equal(within.afterGraceOn, shift(5));
    },
  );
  await t.test(
    "dashboard sums match the full account ledger; staff and foreign companies cannot see collections",
    async () => {
      const d = ok(
        await call(
          "owner",
          "GET",
          "/api/company/overview?propertyId=policy-home",
        ),
      ).rentCollections;
      assert.deepEqual(d, {
        pastDueCents: initial.summary.overdueCents,
        afterGraceCents: initial.summary.afterGraceCents,
        withinGraceCents: initial.summary.withinGraceCents,
        pastDueLeaseCount: 1,
        afterGraceLeaseCount: 1,
      });
      assert.ok(
        !(
          "rentCollections" in
          ok(
            await call(
              "staff",
              "GET",
              "/api/company/overview?propertyId=policy-home",
            ),
          )
        ),
      );
      assert.equal(
        (
          await call(
            "foreign",
            "GET",
            "/api/company/overview?propertyId=policy-home",
          )
        ).statusCode,
        404,
      );
    },
  );
  await t.test(
    "partial receipt and audited void recalculate remaining aging without altering due dates or grace",
    async () => {
      payment = ok(
        await call("owner", "POST", `${root}/${lease.id}/payments`, {
          occurredOn: today,
          amount: "150.00",
          memo: "Private collection note",
          submissionKey: randomUUID(),
        }),
      );
      let row = await read();
      assert.equal(row.summary.age91PlusCents, "45000");
      assert.equal(row.summary.afterGraceCents, "165000");
      assert.equal(row.summary.withinGraceCents, "20000");
      ok(
        await call(
          "owner",
          "POST",
          `/api/company/finances/${payment.id}/void`,
          { expectedVersion: 1, reason: "Wrong receipt" },
        ),
      );
      row = await read();
      assert.deepEqual(row.summary, initial.summary);
      const resident = ok(
        await call(
          "resident2",
          "GET",
          "/api/resident/rent?leaseId=" + lease.id,
        ),
      ).accounts[0];
      assert.equal(resident.summary.afterGraceCents, "180000");
      assert.ok(!("memo" in resident.payments[0]));
    },
  );
  await t.test(
    "policy edits affect only new charges; old clients preserve settings and legacy replay fingerprints",
    async () => {
      lease = ok(
        await call(
          "owner",
          "PATCH",
          "/api/company/leases/" + lease.id,
          terms({ graceDays: 10, rentDueDay: 15 }),
        ),
      );
      let row = await read();
      assert.ok(row.charges.every((c) => c.graceDays === 5));
      assert.equal(row.lease.graceDays, 10);
      const old = ok(
        await call(
          "owner",
          "POST",
          `${root}/${lease.id}/charges`,
          charges[0].body,
        ),
      );
      assert.equal(old.id, charges[0].id);
      assert.equal(old.graceDays, 5);
      const next = ok(
        await call("owner", "POST", `${root}/${lease.id}/charges`, {
          periodOn: `${year}-08-01`,
          dueOn: shift(-7),
          amount: "800.00",
          memo: null,
          expectedVersion: lease.version,
          submissionKey: randomUUID(),
        }),
      );
      assert.equal(next.graceDays, 10);
      row = await read();
      assert.equal(
        row.charges.find((c) => c.id === next.id).collectionStatus,
        "within_grace",
      );
      lease = ok(
        await call(
          "owner",
          "PATCH",
          "/api/company/leases/" + lease.id,
          terms(),
        ),
      );
      assert.equal(lease.graceDays, 10);
      assert.equal(lease.rentDueDay, 15);
      assert.equal(lease.paymentInstructions, "Pay by check at the office.");
      lease = ok(
        await call(
          "owner",
          "PATCH",
          "/api/company/leases/" + lease.id,
          terms({ paymentInstructions: null }),
        ),
      );
      assert.equal(lease.paymentInstructions, null);
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
          return tx.rentCharge.update({
            where: { id: charges[0].id },
            data: { graceDays: 30 },
          });
        }),
        /permission denied/i,
      );
      const audit = (
        await admin.query(
          `SELECT detail FROM "AuditEvent" WHERE "targetId"=$1 AND action='lease.updated' ORDER BY "createdAt" DESC LIMIT 1`,
          [lease.id],
        )
      ).rows[0].detail;
      assert.ok(audit.paymentPolicy);
      assert.equal(audit.paymentPolicy.instructionsChanged, true);
    },
  );
  await t.test(
    "an audit outage rolls back lease policy and version changes",
    async () => {
      await admin.query(
        `CREATE FUNCTION reject_policy_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='lease.updated' THEN RAISE EXCEPTION 'policy audit unavailable'; END IF; RETURN NEW; END$$; CREATE TRIGGER reject_policy_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_policy_audit()`,
      );
      assert.equal(
        (
          await call(
            "owner",
            "PATCH",
            "/api/company/leases/" + lease.id,
            terms({ graceDays: 20 }),
          )
        ).statusCode,
        500,
      );
      const row = await read();
      assert.equal(row.lease.graceDays, lease.graceDays);
      assert.equal(row.lease.version, lease.version);
      await admin.query(
        `DROP TRIGGER reject_policy_audit ON "AuditEvent";DROP FUNCTION reject_policy_audit()`,
      );
    },
  );
  await t.test(
    "concurrent policy edits cannot silently change the grace snapshot of a reviewed charge",
    async () => {
      const original = lease.version,
        body = {
          periodOn: `${year}-09-01`,
          dueOn: today,
          amount: "900.00",
          memo: null,
          expectedVersion: original,
          submissionKey: randomUUID(),
        };
      const [posted, edited] = await Promise.all([
        call("owner", "POST", `${root}/${lease.id}/charges`, body),
        call(
          "manager",
          "PATCH",
          "/api/company/leases/" + lease.id,
          terms({ graceDays: 20 }),
        ),
      ]);
      ok(edited);
      assert.ok([200, 409].includes(posted.statusCode), posted.body);
      if (posted.statusCode === 200) assert.equal(posted.json().graceDays, 10);
      else assert.equal(posted.json().code, "RECORD_CHANGED");
    },
  );
}
