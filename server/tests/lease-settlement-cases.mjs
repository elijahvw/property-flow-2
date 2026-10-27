import { newFixturePage, launchFixtureBrowser } from "./browser-fixture.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { companyDay } from "../dist/reports.js";
export async function leaseSettlementCases(t, admin, call, app, db) {
  const ok = (r) => {
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    },
    today = companyDay("America/New_York"),
    month = today.slice(0, 7) + "-01";
  const unit = ok(
    await call("owner", "POST", "/api/company/properties/home/units", {
      label: "Settlement test home",
      submissionKey: randomUUID(),
    }),
  );
  const lease = ok(
    await call("owner", "POST", "/api/company/leases", {
      propertyId: "home",
      unitId: unit.id,
      residentId: "resident",
      startsOn: month,
      endsOn: null,
      monthlyRent: "1500.00",
      status: "active",
      submissionKey: randomUUID(),
    }),
  );
  const root = `/api/company/leases/${lease.id}/settlement`,
    residentRoot = `/api/resident/leases/${lease.id}/settlement`,
    rent = `/api/company/rent/${lease.id}`,
    deposit = `/api/company/deposits/${lease.id}`;
  const charge = ok(
    await call("owner", "POST", rent + "/one-time-charges", {
      category: "damage",
      effectiveOn: today,
      dueOn: today,
      amount: "400.01",
      description: "Agreed move-out repair",
      expectedLeaseVersion: lease.version,
      submissionKey: randomUUID(),
    }),
  );
  ok(
    await call("owner", "POST", deposit, {
      amount: "1500.00",
      dueOn: month,
      expectedLeaseVersion: lease.version,
      submissionKey: randomUUID(),
    }),
  );
  const receipt = ok(
    await call("owner", "POST", deposit + "/receipts", {
      amount: "1500.00",
      occurredOn: month,
      method: "bank_transfer",
      memo: "PRIVATE RECEIPT NOTE",
      paymentReference: "PRIVATE BANK REFERENCE",
      expectedVersion: 1,
      expectedLeaseVersion: lease.version,
      submissionKey: randomUUID(),
    }),
  );
  const schedule = ok(
    await call("owner", "POST", rent + "/schedules", {
      firstPeriodOn: month,
      firstDueOn: month,
      leadDays: 0,
      expectedVersion: lease.version,
      submissionKey: randomUUID(),
    }),
  );
  const read = async () => ok(await call("owner", "GET", root));
  const body = async (patch = {}) => {
    const d = await read();
    return {
      movedOutOn: today,
      reason: "Reviewed final charges and deposit disposition",
      forwarding: {
        status: "provided",
        addressLine1: "PRIVATE FORWARDING STREET",
        city: "Philadelphia",
        region: "PA",
        postalCode: "19103",
        country: "US",
        email: "private-forward@test.invalid",
      },
      applications: [
        {
          chargeId: charge.id,
          amount: "100.01",
          evidenceReference: "Lease clause 12 and agreed repair itemization",
        },
      ],
      pauseBilling: true,
      expectedLeaseVersion: d.lease.version,
      expectedSettlementVersion: d.settlement?.version ?? 0,
      ...patch,
    };
  };
  const reviewed = async (patch) => {
    const b = await body(patch),
      p = ok(await call("owner", "POST", root + "/preview", b));
    return {
      ...b,
      sourceHash: p.sourceHash,
      confirmed: true,
      submissionKey: randomUUID(),
    };
  };
  let first, committed;
  await t.test(
    "preview is source-linked, read-only and validates actual dates, evidence, forwarding and billing",
    async () => {
      const b = await body(),
        p = ok(await call("owner", "POST", root + "/preview", b));
      assert.equal(p.plannedAppliedCents, "10001");
      assert.equal(p.after.depositHeldCents, "139999");
      assert.equal(p.pauseSchedules[0].id, schedule.id);
      assert.equal((await read()).settlement, null);
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "LeaseMovement" WHERE "leaseId"=$1`,
            [lease.id],
          )
        ).rows[0].n,
        0,
      );
      for (const patch of [
        { movedOutOn: "2099-01-01" },
        { movedOutOn: "2000-01-01" },
        { forwarding: { status: "provided" } },
        { reason: "" },
        {
          applications: [
            { chargeId: charge.id, amount: "1.00", evidenceReference: "" },
          ],
        },
        { applications: [b.applications[0], b.applications[0]] },
        { companyId: "b" },
        { applications: [{ ...b.applications[0], amount: "9999.00" }] },
      ])
        assert.ok(
          [400, 409].includes(
            (await call("owner", "POST", root + "/preview", { ...b, ...patch }))
              .statusCode,
          ),
        );
      assert.equal(
        (
          await call("owner", "POST", root + "/preview", {
            ...b,
            pauseBilling: false,
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await call("owner", "POST", root, {
            ...b,
            confirmed: true,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        400,
      );
    },
  );
  await t.test(
    "changed financial sources invalidate confirmation with no partial applications or paused billing",
    async () => {
      const b = await reviewed();
      ok(
        await call("owner", "POST", rent + "/payments", {
          occurredOn: today,
          amount: "1.00",
          memo: "PRIVATE PAYMENT MEMO",
          submissionKey: randomUUID(),
        }),
      );
      const rejected = await call("owner", "POST", root, b);
      assert.equal(rejected.statusCode, 409, rejected.body);
      assert.equal(rejected.json().code, "SETTLEMENT_SOURCES_CHANGED");
      assert.equal((await read()).settlement, null);
      assert.equal(
        (
          await admin.query(`SELECT status FROM "RentSchedule" WHERE id=$1`, [
            schedule.id,
          ])
        ).rows[0].status,
        "active",
      );
    },
  );
  await t.test(
    "finalization atomically applies deposit and pauses reviewed billing; replay creates one immutable revision and no cash refund",
    async () => {
      committed = await reviewed();
      const replies = await Promise.all([
        call("owner", "POST", root, committed),
        call("owner", "POST", root, committed),
      ]);
      first = ok(replies[0]);
      assert.equal(ok(replies[1]).id, first.id);
      assert.equal(first.version, 1);
      assert.equal(first.snapshot.itemizedApplications.length, 1);
      assert.equal(first.snapshot.deposit.heldCents, "139999");
      assert.equal(first.snapshot.financial.current.outstandingCents, "29900");
      assert.equal((await read()).sourceChanged, false);
      assert.equal(
        (
          await admin.query(`SELECT status FROM "RentSchedule" WHERE id=$1`, [
            schedule.id,
          ])
        ).rows[0].status,
        "paused",
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "LedgerEntry" WHERE "movementId" IN(SELECT id FROM "LeaseMovement" WHERE "leaseId"=$1)`,
            [lease.id],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await admin.query(
            `SELECT status,"endsOn","unitId" FROM "Lease" WHERE id=$1`,
            [lease.id],
          )
        ).rows[0].status,
        "active",
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "AuditEvent" WHERE action='lease.settlement.finalized' AND "targetId"=$1`,
            [(await read()).settlement.id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await call("owner", "POST", root, {
            ...committed,
            reason: "Different",
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (await call("owner", "POST", root + "/preview", await body()))
          .statusCode,
        409,
      );
    },
  );
  await t.test(
    "tenant saved review omits management-only forwarding and financial notes while preserving original source IDs",
    async () => {
      const d = ok(await call("resident", "GET", residentRoot));
      assert.equal(d.latest.id, first.id);
      assert.equal(d.sourceChanged, false);
      assert.equal(d.current, undefined);
      assert.equal(d.sourceHash, undefined);
      assert.equal(d.latest.forwarding, undefined);
      assert.equal(d.latest.sourceHash, undefined);
      assert.equal(d.latest.snapshot.deposit.receipts[0].id, receipt.id);
      assert.ok(
        d.latest.snapshot.financial.items.some((i) => i.id === charge.id),
      );
      for (const value of [
        "PRIVATE FORWARDING STREET",
        "private-forward@test.invalid",
        "PRIVATE RECEIPT NOTE",
        "PRIVATE BANK REFERENCE",
        "PRIVATE PAYMENT MEMO",
      ])
        assert.ok(!JSON.stringify(d).includes(value), value);
      for (const user of ["staff", "resident", "platform"])
        assert.equal(
          (await call(user, "POST", root, committed)).statusCode,
          403,
        );
      assert.equal((await call("foreign", "GET", root)).statusCode, 404);
      assert.equal(
        (await call("resident2", "GET", residentRoot)).statusCode,
        404,
      );
      await admin.query(
        `DELETE FROM "ResidentPropertyAssignment" WHERE "userId"='resident' AND "propertyId"='home'`,
      );
      assert.equal(
        (await call("resident", "GET", residentRoot)).statusCode,
        404,
      );
      await admin.query(
        `INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','resident')`,
      );
    },
  );
  await t.test(
    "later activity leaves saved amounts unchanged; reopen and revised finalization preserve money and prior versions",
    async () => {
      ok(
        await call("owner", "POST", rent + "/payments", {
          occurredOn: today,
          amount: "2.00",
          memo: null,
          submissionKey: randomUUID(),
        }),
      );
      let d = await read();
      assert.equal(d.sourceChanged, true);
      assert.deepEqual(d.latest.snapshot, first.snapshot);
      const b = {
        reason: "Additional payment received after review",
        expectedLeaseVersion: d.lease.version,
        expectedSettlementVersion: d.settlement.version,
        submissionKey: randomUUID(),
      };
      const reopened = ok(await call("owner", "POST", root + "/reopen", b));
      assert.equal(
        ok(await call("owner", "POST", root + "/reopen", b)).id,
        reopened.id,
      );
      d = await read();
      assert.equal(d.settlement.status, "open");
      assert.equal(d.settlement.version, 2);
      assert.equal(d.current.deposit.heldCents, "139999");
      assert.equal(d.current.schedules[0].status, "paused");
      const b2 = await reviewed({ applications: [] });
      const final = ok(await call("owner", "POST", root, b2));
      assert.equal(final.version, 3);
      assert.equal(final.snapshot.financial.current.outstandingCents, "29700");
      d = await read();
      assert.equal(d.revisions.length, 3);
      assert.deepEqual(
        d.revisions.find((r) => r.id === first.id).snapshot,
        first.snapshot,
      );
      assert.equal(
        (await call("owner", "GET", root + "?beforeVersion=3")).json().revisions
          .length,
        2,
      );
      assert.equal(
        (await call("owner", "GET", root + "?beforeVersion=bad")).statusCode,
        400,
      );
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
          return tx.leaseSettlementRevision.update({
            where: { id: first.id },
            data: { reason: "Tamper" },
          });
        }),
        /permission denied/i,
      );
      assert.deepEqual(await db.leaseSettlement.findMany(), []);
      assert.deepEqual(await db.leaseSettlementRevision.findMany(), []);
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
          return tx.leaseSettlement.update({
            where: { id: d.settlement.id },
            data: { version: 4, status: "open" },
          });
        }),
        /requires immutable revision/i,
      );
    },
  );
  await t.test(
    "failed settlement audit rolls back deposit applications, billing changes and version together",
    async () => {
      const d = await read();
      ok(
        await call("owner", "POST", root + "/reopen", {
          reason: "Audit rollback review",
          expectedLeaseVersion: d.lease.version,
          expectedSettlementVersion: d.settlement.version,
          submissionKey: randomUUID(),
        }),
      );
      const b = await reviewed({
          applications: [
            {
              chargeId: charge.id,
              amount: "1.00",
              evidenceReference: "Agreed item",
            },
          ],
        }),
        count = (
          await admin.query(
            `SELECT count(*)::int n FROM "LeaseMovement" WHERE "leaseId"=$1`,
            [lease.id],
          )
        ).rows[0].n;
      await admin.query(
        `CREATE FUNCTION reject_settlement_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='lease.settlement.finalized' THEN RAISE EXCEPTION 'Audit offline'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_settlement_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_settlement_audit()`,
      );
      try {
        assert.ok((await call("owner", "POST", root, b)).statusCode >= 500);
        assert.equal((await read()).settlement.status, "open");
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM "LeaseMovement" WHERE "leaseId"=$1`,
              [lease.id],
            )
          ).rows[0].n,
          count,
        );
      } finally {
        await admin.query(
          `DROP TRIGGER reject_settlement_audit ON "AuditEvent";DROP FUNCTION reject_settlement_audit()`,
        );
      }
    },
  );
  await t.test(
    "real browser preserves settlement review across lost commit and reload and is usable at phone width",
    { skip: !process.env.TEST_FINANCES_BROWSER_URL },
    async () => {
      const paused = (
        await admin.query(`SELECT version FROM "RentSchedule" WHERE id=$1`, [
          schedule.id,
        ])
      ).rows[0];
      ok(
        await call(
          "owner",
          "PATCH",
          `/api/company/rent-schedules/${schedule.id}`,
          { status: "active", expectedVersion: paused.version },
        ),
      );
      const browser = await launchFixtureBrowser({ headless: true });
      try {
        const page = await newFixturePage(browser);
        let lose = true;
        const keys = [];
        await page.route("**/api/**", async (route) => {
          const req = route.request(),
            u = new URL(req.url()),
            res = await app.inject({
              method: req.method(),
              url: u.pathname + u.search,
              headers: {
                ...req.headers(),
                origin: "https://app.test",
                cookie: "__Host-pf-session=token-owner",
              },
              ...(req.postData() ? { payload: req.postData() } : {}),
            });
          if (req.method() === "POST" && u.pathname === root) {
            keys.push(req.postDataJSON().submissionKey);
            assert.equal(res.statusCode, 200, res.body);
            if (lose) {
              lose = false;
              return route.abort("failed");
            }
          }
          return route.fulfill({
            status: res.statusCode,
            contentType: "application/json",
            body: res.body,
          });
        });
        await page.goto(
          process.env.TEST_FINANCES_BROWSER_URL +
            `/company/leases/${lease.id}?section=settlement`,
        );
        await page
          .getByRole("button", { name: "Prepare settlement", exact: true })
          .click();
        await page
          .getByLabel("Reason shown to the tenant", { exact: true })
          .fill("Browser validated settlement");
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await expect(
          page.getByLabel("Street address", { exact: true }),
        ).toHaveValue("PRIVATE FORWARDING STREET");
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Add deposit application", exact: true })
          .click();
        await page
          .getByLabel("Charge for application 1", { exact: true })
          .selectOption(charge.id);
        await page
          .getByLabel("Application 1 amount (USD)", { exact: true })
          .fill("1.00");
        await page
          .getByLabel("Supporting reference for application 1", { exact: true })
          .fill("Agreed lease item");
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await page
          .getByRole("checkbox", { name: /Pause the 1 reviewed active/ })
          .check();
        await page
          .getByRole("button", { name: "Review settlement", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toContainText(
          "PRIVATE FORWARDING STREET",
        );
        await page
          .getByRole("button", {
            name: "Back to settlement details",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", { name: "Previous step", exact: true })
          .click();
        await expect(
          page.getByLabel("Application 1 amount (USD)", { exact: true }),
        ).toHaveValue("1.00");
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Review settlement", exact: true })
          .click();
        await page
          .getByRole("checkbox", { name: /I have reviewed the sources/ })
          .check();
        await page
          .getByRole("button", { name: "Save settlement", exact: true })
          .click();
        await expect(page.getByRole("alert")).toBeVisible();
        await page.reload();
        await page
          .getByRole("button", {
            name: "Resume settlement review",
            exact: true,
          })
          .click();
        await page
          .getByRole("checkbox", { name: /I have reviewed the sources/ })
          .check();
        await page
          .getByRole("button", { name: "Save settlement", exact: true })
          .click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        assert.equal(keys[0], keys[1]);
        assert.equal((await read()).current.schedules[0].status, "paused");
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM "LeaseSettlementRevision" WHERE reason='Browser validated settlement'`,
            )
          ).rows[0].n,
          1,
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(
          page.getByRole("heading", {
            name: "Finish the move-out",
            exact: true,
          }),
        ).toBeVisible();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: "/tmp/propertyflow-settlement-mobile.png",
          fullPage: false,
        });
      } finally {
        await browser.close();
      }
    },
  );
}
