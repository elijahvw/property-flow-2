import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function statementCases(t, admin, call) {
  const ok = (r) => {
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const unit = ok(
    await call("owner", "POST", "/api/company/properties/home/units", {
      label: "Statement unit",
      submissionKey: randomUUID(),
    }),
  );
  const lease = ok(
    await call("owner", "POST", "/api/company/leases", {
      propertyId: "home",
      unitId: unit.id,
      residentId: "resident",
      startsOn: "2025-01-01",
      endsOn: null,
      monthlyRent: "1000.01",
      status: "active",
      submissionKey: randomUUID(),
    }),
  );
  const root = `/api/company/statements/${lease.id}`,
    tenant = `/api/resident/statements/${lease.id}`;
  const charge = async (month, amount = "1000.01") =>
    ok(
      await call("owner", "POST", `/api/company/rent/${lease.id}/charges`, {
        periodOn: month,
        dueOn: month,
        amount,
        memo: "PRIVATE CHARGE NOTE",
        expectedVersion: lease.version,
        submissionKey: randomUUID(),
      }),
    );
  const receive = async (occurredOn, amount) =>
    ok(
      await call("owner", "POST", `/api/company/rent/${lease.id}/payments`, {
        occurredOn,
        amount,
        memo: "PRIVATE PAYMENT NOTE",
        submissionKey: randomUUID(),
      }),
    );
  let receipt;
  await t.test(
    "partial and excess receipts reconcile across current ledger, tenant and date range",
    async () => {
      await charge("2025-01-01");
      await charge("2025-02-01");
      await receive("2025-01-10", "400.00");
      let s = ok(await call("owner", "GET", root));
      assert.equal(s.current.outstandingCents, "160002");
      receipt = await receive("2025-03-01", "1900.04");
      s = ok(await call("manager", "GET", root));
      const ledger = ok(
        await call("owner", "GET", `/api/company/rent?leaseId=${lease.id}`),
      ).accounts[0];
      assert.deepEqual(s.current, ledger.summary);
      assert.equal(s.current.creditCents, "30002");
      assert.equal(s.period.closingNetCents, "-30002");
      const own = ok(await call("resident", "GET", tenant));
      for (const key of [
        "current",
        "period",
        "items",
        "allocations",
        "deposit",
        "basis",
        "lease",
      ])
        assert.deepEqual(own[key], s[key]);
      assert.doesNotMatch(
        JSON.stringify(s),
        /PRIVATE|"(?:memo|voidReason|email|paymentReference|residentId|residentContact|submissionHash|createdById)":/,
      );
      const jan = ok(
        await call(
          "owner",
          "GET",
          root + "?dateFrom=2025-01-01&dateTo=2025-01-31",
        ),
      );
      assert.equal(jan.period.chargedCents, "100001");
      assert.equal(jan.period.receivedCents, "40000");
      assert.equal(jan.period.closingNetCents, "60001");
      assert.equal(jan.period.laterNetCents, "-90003");
      assert.equal(jan.items.length, 2);
      assert.equal(jan.allocations.length, 2);
      assert.equal(jan.items[0].status, "paid_late");
      assert.match(jan.basis, /not historical as-of/);
      const empty = ok(
        await call(
          "resident",
          "GET",
          tenant + "?dateFrom=2025-04-01&dateTo=2025-04-30",
        ),
      );
      assert.equal(empty.period.recordCount, 0);
      assert.equal(empty.period.openingNetCents, "-30002");
      assert.equal(empty.period.closingNetCents, "-30002");
      assert.equal(empty.current.creditCents, "30002");
    },
  );
  await t.test(
    "deposit summary uses linked active cash sources and stays separate from rent",
    async () => {
      const deposit = ok(
        await call("owner", "POST", `/api/company/deposits/${lease.id}`, {
          amount: "500.03",
          dueOn: "2025-01-01",
          expectedLeaseVersion: lease.version,
          submissionKey: randomUUID(),
        }),
      );
      ok(
        await call(
          "owner",
          "POST",
          `/api/company/deposits/${lease.id}/receipts`,
          {
            amount: "250.02",
            occurredOn: "2025-01-01",
            method: "bank_transfer",
            paymentReference: "PRIVATE BANK REF",
            memo: "PRIVATE DEPOSIT NOTE",
            expectedVersion: deposit.version,
            expectedLeaseVersion: lease.version,
            submissionKey: randomUUID(),
          },
        ),
      );
      const s = ok(await call("resident", "GET", tenant));
      const detail = ok(
        await call("resident", "GET", `/api/resident/deposits/${lease.id}`),
      ).account;
      for (const [key, value] of Object.entries(detail.summary))
        assert.equal(s.deposit[key], value);
      assert.equal(s.deposit.requiredCents, "50003");
      assert.equal(s.deposit.heldCents, "25002");
      assert.equal(s.current.creditCents, "30002");
      assert.doesNotMatch(
        JSON.stringify(s),
        /PRIVATE|paymentReference|cashEntries/,
      );
    },
  );
  await t.test(
    "voids reopen obligations, retain inactive allocations and never appear as refunds",
    async () => {
      ok(
        await call(
          "owner",
          "POST",
          `/api/company/finances/${receipt.id}/void`,
          { expectedVersion: 1, reason: "PRIVATE CORRECTION" },
        ),
      );
      const s = ok(await call("resident", "GET", tenant));
      assert.equal(s.current.outstandingCents, "160002");
      assert.equal(s.current.creditCents, "0");
      assert.equal(s.period.voidedCount, 1);
      const row = s.items.find((r) => r.id === receipt.id);
      assert.equal(row.effectCents, "0");
      assert.equal(row.status, "voided");
      assert.equal(row.amountCents, "190004");
      assert.equal(s.allocations.filter((a) => !a.active).length, 2);
      assert.doesNotMatch(JSON.stringify(s), /PRIVATE/);
    },
  );
  await t.test(
    "company, current membership, assignment and approved leaseholder fences protect shared statements",
    async () => {
      for (const user of ["staff", "resident", "platform"])
        assert.equal((await call(user, "GET", root)).statusCode, 403);
      for (const user of ["resident2", "foreign-resident"])
        assert.equal((await call(user, "GET", tenant)).statusCode, 404);
      assert.equal((await call("foreign", "GET", root)).statusCode, 404);
      assert.equal(
        (await call("owner", "GET", root, undefined, { "x-company-id": "b" }))
          .statusCode,
        403,
      );
      const participant = ok(
        await call(
          "owner",
          "POST",
          `/api/company/leases/${lease.id}/participants`,
          {
            userId: "resident2",
            name: "Second leaseholder",
            email: "resident2@test.invalid",
            phone: null,
            role: "leaseholder",
            startsOn: "2025-01-01",
            endsOn: null,
            portalApproved: true,
            submissionKey: randomUUID(),
          },
        ),
      );
      assert.deepEqual(
        ok(await call("resident2", "GET", tenant)).current,
        ok(await call("owner", "GET", root)).current,
      );
      for (const changes of [
        "role='occupant'",
        '"portalApproved"=false',
        '"removedAt"=NOW()',
        "\"endsOn\"='2025-12-31'",
      ]) {
        await admin.query(
          `UPDATE "LeaseParticipant" SET ${changes} WHERE id=$1`,
          [participant.id],
        );
        assert.equal((await call("resident2", "GET", tenant)).statusCode, 404);
        await admin.query(
          `UPDATE "LeaseParticipant" SET role='leaseholder',"portalApproved"=true,"removedAt"=NULL,"endsOn"=NULL WHERE id=$1`,
          [participant.id],
        );
      }
      await admin.query(
        `DELETE FROM "ResidentPropertyAssignment" WHERE "companyId"='a' AND "propertyId"='home' AND "userId"='resident2'`,
      );
      assert.equal((await call("resident2", "GET", tenant)).statusCode, 404);
      await admin.query(
        `INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','resident2')`,
      );
      await admin.query(
        `UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='resident2'`,
      );
      assert.equal((await call("resident2", "GET", tenant)).statusCode, 403);
      await admin.query(
        `UPDATE "CompanyMembership" SET status='active' WHERE "userId"='resident2'`,
      );
      await admin.query(`UPDATE "Lease" SET status='draft' WHERE id=$1`, [
        lease.id,
      ]);
      assert.equal((await call("resident", "GET", tenant)).statusCode, 404);
      assert.equal((await call("resident2", "GET", tenant)).statusCode, 404);
      await admin.query(`UPDATE "Lease" SET status='active' WHERE id=$1`, [
        lease.id,
      ]);
      await admin.query(`UPDATE "Company" SET status='suspended' WHERE id='a'`);
      assert.equal((await call("owner", "GET", root)).statusCode, 403);
      await admin.query(`UPDATE "Company" SET status='active' WHERE id='a'`);
    },
  );
  await t.test(
    "invalid filters and oversized sources never produce partial totals",
    async () => {
      for (const query of [
        "?dateFrom=2025-02-30",
        "?dateFrom=2025-03-01&dateTo=2025-01-01",
        "?companyId=b",
        "?dateTo=",
        "?propertyId=home",
      ])
        assert.equal(
          (await call("owner", "GET", root + query)).statusCode,
          400,
        );
      await admin.query(
        `INSERT INTO "RentCharge"(id,"companyId","propertyId","leaseId","createdById","submissionKey","submissionHash","periodOn","dueOn","amountCents","voidedAt","voidReason") SELECT 'statement-limit-'||i,'a','home',$1,'owner',gen_random_uuid()::text,'fixture','2025-06-01','2025-06-01',1,NOW(),'fixture' FROM generate_series(1,10001) i`,
        [lease.id],
      );
      const r = await call(
        "owner",
        "GET",
        root + "?dateFrom=2025-01-01&dateTo=2025-01-31",
      );
      assert.equal(r.statusCode, 422, r.body);
      assert.ok(!Object.hasOwn(r.json(), "current"));
      await admin.query(
        `DELETE FROM "RentCharge" WHERE id LIKE 'statement-limit-%'`,
      );
    },
  );
}
