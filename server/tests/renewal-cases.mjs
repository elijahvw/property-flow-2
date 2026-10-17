import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function renewalCases(t, admin, call, db) {
  const ok = (r) => {
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  let parent, child;
  const terms = (row, extra = {}) => ({
    startsOn: row.startsOn.slice(0, 10),
    endsOn: row.endsOn?.slice(0, 10) || null,
    monthlyRent: (row.rentCents / 100).toFixed(2),
    status: row.status,
    expectedVersion: row.version,
    ...extra,
  });
  const createParent = async (label) => {
    const unit = ok(
      await call(
        "owner",
        "POST",
        "/api/company/properties/renewal-home/units",
        { label, submissionKey: randomUUID() },
      ),
    );
    return ok(
      await call("owner", "POST", "/api/company/leases", {
        propertyId: "renewal-home",
        unitId: unit.id,
        residentId: "resident2",
        startsOn: "2026-01-01",
        endsOn: "2026-12-31",
        monthlyRent: "1000.00",
        status: "active",
        rentDueDay: 5,
        graceDays: 3,
        submissionKey: randomUUID(),
      }),
    );
  };
  const proposal = (p = parent) => ({
    propertyId: p.propertyId,
    unitId: p.unitId,
    residentId: p.residentId,
    previousLeaseId: p.id,
    expectedPreviousVersion: p.version,
    startsOn: "2027-01-01",
    endsOn: "2027-12-31",
    monthlyRent: "1100.00",
    status: "draft",
    rentDueDay: 5,
    graceDays: 3,
    submissionKey: randomUUID(),
  });
  await t.test(
    "renewals are reviewed linked drafts with durable identity, eligibility and scoped validation",
    async () => {
      await admin.query(
        `INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES('renewal-home','Renewal House','street','city','state','zip','a',NOW());INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','renewal-home','resident2')`,
      );
      parent = await createParent("Renewal unit");
      for (const patch of [
        { startsOn: "2026-12-31" },
        { status: "active" },
        { expectedPreviousVersion: 99 },
        { previousLeaseId: "foreign-lease" },
        { residentId: "resident" },
        { unitId: "foreign-unit" },
      ])
        assert.ok(
          [404, 409].includes(
            (
              await call("owner", "POST", "/api/company/leases", {
                ...proposal(),
                ...patch,
              })
            ).statusCode,
          ),
        );
      for (const user of ["staff", "resident", "platform", "foreign"])
        assert.ok(
          [403, 404].includes(
            (await call(user, "POST", "/api/company/leases", proposal()))
              .statusCode,
          ),
        );
      const body = proposal();
      const results = await Promise.all([
        call("owner", "POST", "/api/company/leases", body),
        call("owner", "POST", "/api/company/leases", body),
      ]);
      child = ok(results[0]);
      assert.equal(ok(results[1]).id, child.id);
      assert.equal(child.previousLeaseId, parent.id);
      assert.equal(child.previousLease.endsOn.slice(0, 10), "2026-12-31");
      assert.equal(child.status, "draft");
      assert.equal(child.rentCents, 110000);
      assert.equal(
        (await call("owner", "POST", "/api/company/leases", proposal())).json()
          .code,
        "RENEWAL_EXISTS",
      );
      const rows = ok(
        await call(
          "owner",
          "GET",
          "/api/company/leases?propertyId=renewal-home",
        ),
      ).items;
      assert.equal(rows.find((r) => r.id === parent.id).rentCents, 100000);
      assert.equal(
        rows.find((r) => r.id === parent.id).renewals[0].id,
        child.id,
      );
    },
  );
  await t.test(
    "linked term guards prevent overlap and activation retains the one-active-lease boundary",
    async () => {
      for (const patch of [
        { endsOn: null },
        { endsOn: "2027-01-01" },
        { status: "draft" },
      ])
        assert.equal(
          (
            await call(
              "owner",
              "PATCH",
              "/api/company/leases/" + parent.id,
              terms(parent, patch),
            )
          ).json().code,
          "RENEWAL_TERM_CONFLICT",
        );
      assert.equal(
        (
          await call(
            "owner",
            "PATCH",
            "/api/company/leases/" + child.id,
            terms(child, { startsOn: "2026-12-31" }),
          )
        ).json().code,
        "RENEWAL_TERMS_INVALID",
      );
      assert.equal(
        (
          await call(
            "owner",
            "PATCH",
            "/api/company/leases/" + child.id,
            terms(child, { status: "active" }),
          )
        ).json().code,
        "ACTIVE_LEASE_EXISTS",
      );
      parent = ok(
        await call(
          "owner",
          "PATCH",
          "/api/company/leases/" + parent.id,
          terms(parent, { status: "ended" }),
        ),
      );
      child = ok(
        await call(
          "owner",
          "PATCH",
          "/api/company/leases/" + child.id,
          terms(child, { status: "active" }),
        ),
      );
      assert.equal(child.status, "active");
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
          return tx.lease.update({
            where: { id: child.id },
            data: { previousLeaseId: null },
          });
        }),
        /immutable/i,
      );
    },
  );
  await t.test(
    "independent renewal creators cannot produce two open successors",
    async () => {
      const source = await createParent("Concurrent renewal");
      const results = await Promise.all([
        call("owner", "POST", "/api/company/leases", proposal(source)),
        call("manager", "POST", "/api/company/leases", proposal(source)),
      ]);
      assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409],results.map(r=>r.body).join("\n"));
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "Lease" WHERE "previousLeaseId"=$1`,
            [source.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "renewal creation and audit roll back together and original retry succeeds once",
    async () => {
      const source = await createParent("Audit renewal"),
        body = proposal(source);
      await admin.query(
        `CREATE FUNCTION reject_renewal_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='lease.created' AND NEW.detail ? 'previousLeaseId' THEN RAISE EXCEPTION 'test audit outage'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_renewal_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_renewal_audit()`,
      );
      assert.equal(
        (await call("owner", "POST", "/api/company/leases", body)).statusCode,
        500,
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "Lease" WHERE "previousLeaseId"=$1`,
            [source.id],
          )
        ).rows[0].n,
        0,
      );
      await admin.query(
        `DROP TRIGGER reject_renewal_audit ON "AuditEvent";DROP FUNCTION reject_renewal_audit()`,
      );
      const row = ok(await call("owner", "POST", "/api/company/leases", body));
      assert.equal(
        ok(await call("owner", "POST", "/api/company/leases", body)).id,
        row.id,
      );
    },
  );
 await t.test('ended renewal history stays in order and subsequent terms form a chain rather than a second branch',async()=>{
  child=ok(await call('owner','PATCH','/api/company/leases/'+child.id,terms(child,{status:'ended'})));
  assert.equal((await call('owner','PATCH','/api/company/leases/'+parent.id,terms(parent,{endsOn:'2027-01-01'}))).json().code,'RENEWAL_TERM_CONFLICT');
  assert.equal((await call('owner','POST','/api/company/leases',proposal())).json().code,'RENEWAL_EXISTS');
  const next=ok(await call('owner','POST','/api/company/leases',{...proposal(child),startsOn:'2028-01-01',endsOn:'2028-12-31'}));assert.equal(next.previousLeaseId,child.id);
 });

}
