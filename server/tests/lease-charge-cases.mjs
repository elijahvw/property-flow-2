import { newFixturePage } from "./browser-fixture.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { companyDay } from "../dist/reports.js";

export async function leaseChargeCases(t, admin, call, app, db) {
  const ok = r => { assert.equal(r.statusCode, 200, r.body); return r.json(); };
  const today = companyDay("America/New_York"), month = today.slice(0, 7) + "-01";
  async function createLease(label) {
    const unit = ok(await call("owner", "POST", "/api/company/properties/home/units", { label, submissionKey: randomUUID() }));
    return ok(await call("owner", "POST", "/api/company/leases", { propertyId: "home", unitId: unit.id, residentId: "resident", startsOn: month, endsOn: null, monthlyRent: "1000.01", status: "active", submissionKey: randomUUID() }));
  }
  const lease = await createLease("Charges and credit notes");
  const root = `/api/company/rent/${lease.id}`;
  const read = async () => ok(await call("owner", "GET", `/api/company/rent?leaseId=${lease.id}`)).accounts[0];
  const chargeBody = (patch = {}) => ({ category: "parking", effectiveOn: today, dueOn: today, amount: "100.02", description: "Agreed parking space", expectedLeaseVersion: lease.version, submissionKey: randomUUID(), ...patch });
  const receive = amount => call("owner", "POST", root + "/payments", { occurredOn: today, amount, memo: "PRIVATE CASH NOTE", submissionKey: randomUUID() });
  const creditBody = (charge, patch = {}) => ({ chargeId: charge.id, kind: "credit_note", effectiveOn: today, amount: "200.01", reason: "Agreed rent reduction", expectedChargeVersion: charge.version, expectedRemainingCents: charge.remainingCents, expectedLeaseVersion: lease.version, submissionKey: randomUUID(), ...patch });
  let rent, parking, concession, parkingCredit;
  await t.test("migration preserves historical rent identities and defaults; multiple manual charges coexist with monthly rent", async () => {
    const old = (await admin.query(`SELECT id,kind,category,"effectiveOn","amountCents" FROM "RentCharge" WHERE id='migration-charge'`)).rows[0];
    assert.deepEqual(old, { id: "migration-charge", kind: "rent", category: "rent", effectiveOn: null, amountCents: 123456 });
    rent = ok(await call("owner", "POST", root + "/charges", { periodOn: month, dueOn: month, amount: "1000.01", memo: "Rent", expectedVersion: 1, submissionKey: randomUUID() }));
    const payload = chargeBody(), responses = await Promise.all([call("owner", "POST", root + "/one-time-charges", payload), call("owner", "POST", root + "/one-time-charges", payload)]);
    parking = ok(responses[0]); assert.equal(ok(responses[1]).id, parking.id);
    assert.equal(parking.kind, "one_time"); assert.equal(parking.graceDays, 0);
    assert.equal((await call("owner", "POST", root + "/one-time-charges", { ...payload, amount: "100.03" })).statusCode, 409);
    ok(await call("manager", "POST", root + "/one-time-charges", chargeBody({ category: "utilities", amount: "75.05", description: "Utility reimbursement" })));
    const row = await read(); assert.equal(row.charges.length, 3); assert.equal(row.summary.outstandingCents, "117508"); assert.equal(row.summary.otherOutstandingCents, "17507");
    const preview = ok(await call("owner", "POST", root + "/schedule-preview", { firstPeriodOn: month, lastPeriodOn: null, firstDueOn: month, firstAmount: null, lastAmount: null, leadDays: 0, expectedVersion: 1, submissionKey: randomUUID() }));
    assert.equal(preview.preview[0].action, "existing");
    assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='lease.charge.created' AND "targetId"=$1`, [parking.id])).rows[0].n, 1);
  });
  await t.test("noncash credits reduce named unpaid obligations and reconcile without another cash receipt", async () => {
    ok(await receive("400.01"));
    const row = await read(), target = row.charges.find(c => c.id === rent.id), payload = creditBody(target);
    const replies = await Promise.all([call("manager", "POST", root + "/credits", payload), call("manager", "POST", root + "/credits", payload)]);
    concession = ok(replies[0]); assert.equal(ok(replies[1]).id, concession.id);
    const result = await read(); assert.equal(result.summary.paidCents, "40001"); assert.equal(result.summary.noncashCreditCents, "20001"); assert.equal(result.summary.outstandingCents, "57506"); assert.equal(result.summary.rentOutstandingCents, "39999");
    assert.equal(result.charges.find(c => c.id === rent.id).creditedCents, "20001");
    const own = ok(await call("resident", "GET", `/api/resident/rent?leaseId=${lease.id}`)).accounts[0]; assert.deepEqual(own.summary, result.summary); assert.equal(own.credits[0].reason, "Agreed rent reduction");
    const statement = ok(await call("resident", "GET", `/api/resident/statements/${lease.id}`));
    assert.deepEqual(statement.current, result.summary); assert.equal(statement.period.receivedCents, "40001"); assert.equal(statement.period.noncashCreditCents, "20001"); assert.equal(statement.period.closingNetCents, "57506");
    assert.equal(statement.items.find(r => r.id === concession.id).relatedId, rent.id); assert.equal(statement.items.find(r => r.id === concession.id).effectCents, "-20001");
    assert.doesNotMatch(JSON.stringify(statement), /PRIVATE CASH NOTE|"(?:memo|paymentReference|createdById|submissionHash)":/);
    const cash = (await admin.query(`SELECT SUM("amountCents")::text amount,count(*)::int n FROM "LedgerEntry" WHERE "leaseId"=$1`, [lease.id])).rows[0];
    assert.deepEqual(cash, { amount: "40001", n: 1 });
  });
  await t.test("a fully credited charge is settled with credit rather than labeled paid or paid late", async () => {
    const row = await read(), target = row.charges.find(c => c.id === parking.id);
    parkingCredit = ok(await call("owner", "POST", root + "/credits", creditBody(target, { kind: "concession", amount: "100.02", reason: "Parking concession" })));
    const statement = ok(await call("owner", "GET", `/api/company/statements/${lease.id}`));
    const charge = statement.items.find(r => r.id === parking.id); assert.equal(charge.status, "settled"); assert.equal(charge.remainingCents, "0"); assert.equal(charge.settledOn, null);
    const row2 = await read(); assert.equal(row2.summary.outstandingCents, "47504"); assert.equal(row2.summary.creditCents, "0");
    const overview = ok(await call("owner", "GET", "/api/company/overview?propertyId=home"));
    const accounts = ok(await call("owner", "GET", "/api/company/rent?propertyId=home")).accounts;
    assert.equal(overview.rentCollections.pastDueCents, String(accounts.reduce((sum, account) => sum + BigInt(account.summary.overdueCents), 0n)));
  });
  await t.test("reviewed remaining amounts and concurrent credit/payment writers cannot over-credit a charge", async () => {
    const row = await read(), target = row.charges.find(c => c.category === "utilities");
    const results = await Promise.all([call("owner", "POST", root + "/credits", creditBody(target, { amount: "50.00" })), call("manager", "POST", root + "/credits", creditBody(target, { amount: "50.00" }))]);
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
    const current = (await read()).charges.find(c => c.id === target.id); assert.equal(current.remainingCents, "2505");
    assert.equal((await call("owner", "POST", root + "/credits", creditBody(current, { amount: "25.06" }))).statusCode, 409);
    const before = await read(), rentTarget = before.charges.find(c => c.id === rent.id);
    const race = await Promise.all([call("owner", "POST", root + "/credits", creditBody(rentTarget, { amount: "300.00" })), receive("500.00")]);
    assert.equal(race[1].statusCode, 200); assert.ok([200, 409].includes(race[0].statusCode));
    const after = await read(); for (const c of after.charges) assert.ok(BigInt(c.remainingCents) >= 0n);
    assert.equal(BigInt(after.summary.netCents), BigInt(after.summary.outstandingCents) - BigInt(after.summary.creditCents));
  });
  await t.test("immutable linked reversal reopens debt and consumes available cash credit without rearranging old allocations", async () => {
    ok(await receive("1000.00"));
    const before = await read(), payload = { effectiveOn: today, reason: "Reverse the parking concession", expectedLeaseVersion: lease.version, submissionKey: randomUUID() };
    const results = await Promise.all([call("owner", "POST", root + `/credits/${parkingCredit.id}/reverse`, payload), call("owner", "POST", root + `/credits/${parkingCredit.id}/reverse`, payload)]);
    assert.equal(ok(results[0]).id, ok(results[1]).id);
    const after = await read(); assert.equal(after.summary.paidCents, before.summary.paidCents); assert.equal(after.summary.outstandingCents, "0");
    assert.equal(BigInt(after.summary.creditCents), BigInt(before.summary.creditCents) - 10002n);
    assert.deepEqual(after.allocations.filter(a => before.allocations.some(old => old.id === a.id)), before.allocations);
    const statement = ok(await call("owner", "GET", `/api/company/statements/${lease.id}`));
    assert.equal(statement.items.find(r => r.id === parkingCredit.id).effectCents, "-10002");
    const reversal = statement.items.find(r => r.type === "credit_reversal" && r.relatedId === parkingCredit.id); assert.equal(reversal.effectCents, "10002");
    assert.equal(statement.period.closingNetCents, statement.current.netCents);
    assert.equal((await call("manager", "POST", root + `/credits/${parkingCredit.id}/reverse`, { ...payload, submissionKey: randomUUID() })).statusCode, 409);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='lease.credit.reversed' AND "targetId"=$1`, [reversal.id])).rows[0].n, 1);
  });
  await t.test("active credits block charge voids, and reversal preserves a safe correction path", async () => {
    const other = await createLease("Credit correction unit"), otherRoot = `/api/company/rent/${other.id}`;
    const charge = ok(await call("owner", "POST", otherRoot + "/one-time-charges", chargeBody({ amount: "75.05" })));
    const credit = ok(await call("owner", "POST", otherRoot + "/credits", creditBody({ ...charge, remainingCents: "7505" }, { amount: "75.05" })));
    assert.equal((await call("owner", "POST", `/api/company/rent/charges/${charge.id}/void`, { expectedVersion: 1, reason: "Wrong charge" })).statusCode, 409);
    await assert.rejects(db.$transaction(async tx => { await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`; return tx.rentCharge.update({ where: { id: charge.id }, data: { voidedAt: new Date(), voidReason: "Wrong", version: 2 } }); }), /Reverse active credits/i);
    ok(await call("owner", "POST", otherRoot + `/credits/${credit.id}/reverse`, { effectiveOn: today, reason: "Correction before replacing charge", expectedLeaseVersion: 1, submissionKey: randomUUID() }));
    ok(await call("owner", "POST", `/api/company/rent/charges/${charge.id}/void`, { expectedVersion: 1, reason: "Wrong charge" }));
    const statement = ok(await call("owner", "GET", `/api/company/statements/${other.id}`)); assert.equal(statement.current.netCents, "0"); assert.equal(statement.period.closingNetCents, "0"); assert.equal(statement.period.voidedCount, 1);
    await assert.rejects(db.$transaction(async tx => { await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`; return tx.leaseCredit.update({ where: { id: credit.id }, data: { amountCents: 1 } }); }), /permission denied/i);
    assert.deepEqual(await db.leaseCredit.findMany(), []);
  });
  await t.test("denied roles, stale authority, scope, invalid dates and audit failures leave no partial financial writes", async () => {
    for (const user of ["staff", "resident", "platform"]) assert.equal((await call(user, "POST", root + "/one-time-charges", chargeBody())).statusCode, 403);
    assert.equal((await call("foreign", "POST", root + "/one-time-charges", chargeBody())).statusCode, 404);
    assert.equal((await call("owner", "POST", root + "/one-time-charges", chargeBody(), { "x-company-id": "b" })).statusCode, 403);
    for (const patch of [{ category: "automatic_late_fee" }, { amount: "0" }, { amount: "0.001" }, { amount: "-10" }, { effectiveOn: "2026-02-30" }, { effectiveOn: "2999-01-01" }, { description: "" }, { companyId: "b" }]) assert.equal((await call("owner", "POST", root + "/one-time-charges", chargeBody(patch))).statusCode, 400);
    await admin.query(`CREATE FUNCTION reject_adjustment_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action LIKE 'lease.charge.%' OR NEW.action LIKE 'lease.credit.%' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END$$; CREATE TRIGGER reject_adjustment_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_adjustment_audit()`);
    const payload = chargeBody(); assert.ok((await call("owner", "POST", root + "/one-time-charges", payload)).statusCode >= 500);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM "RentCharge" WHERE "submissionKey"=$1`, [payload.submissionKey])).rows[0].n, 0);
    await admin.query(`DROP TRIGGER reject_adjustment_audit ON "AuditEvent";DROP FUNCTION reject_adjustment_audit()`);
    ok(await call("owner", "POST", root + "/one-time-charges", payload));
  });
  await t.test("real browser preserves reviewed charge after response loss and reload; local forms are readable and plain references replace ID menus", { skip: !process.env.TEST_FINANCES_BROWSER_URL }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await newFixturePage(browser); let lose = true; const keys = [];
      await page.route("**/api/**", async route => {
        const request = route.request(), url = new URL(request.url());
        const response = await app.inject({ method: request.method(), url: url.pathname + url.search, headers: { ...request.headers(), origin: "https://app.test", cookie: "__Host-pf-session=token-owner" }, ...(request.postData() ? { payload: request.postData() } : {}) });
        if (request.method() === "POST" && url.pathname === root + "/one-time-charges") { keys.push(request.postDataJSON().submissionKey); assert.equal(response.statusCode, 200, response.body); if (lose) { lose = false; return route.abort("failed"); } }
        await route.fulfill({ status: response.statusCode, contentType: "application/json", body: response.body });
      });
      await page.goto(process.env.TEST_FINANCES_BROWSER_URL + "/company/rent?leaseId=" + lease.id);
      await page.getByRole("button", { name: "Add one-time charge", exact: true }).click();
      await page.getByLabel("Charge category", { exact: true }).selectOption("parking");
      await page.getByLabel("Amount (USD)", { exact: true }).fill("19.99");
      await page.getByLabel("Description shown to the tenant", { exact: true }).fill("Reviewed browser parking charge");
      await page.getByRole("button", { name: "Review charge", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Review before saving" })).toBeVisible();
      await page.getByRole("button", { name: "Post one-time charge", exact: true }).click();
      await expect(page.getByRole("alert")).toBeVisible(); await page.reload();
      await page.getByRole("button", { name: "Resume review", exact: true }).click();
      await expect(page.getByLabel("Amount (USD)", { exact: true })).toHaveValue("19.99");
      await page.getByRole("button", { name: "Review charge", exact: true }).click();
      await page.getByRole("button", { name: "Post one-time charge", exact: true }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible(); assert.equal(keys[0], keys[1]);
      assert.equal((await admin.query(`SELECT count(*)::int n FROM "RentCharge" WHERE memo='Reviewed browser parking charge'`)).rows[0].n, 1);
      await expect(page.getByRole("button", { name: "Copy internal ID" })).toHaveCount(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Add one-time charge", exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: "/tmp/propertyflow-one-time-charge-mobile.png", fullPage: false });
    } finally { await browser.close(); }
  });
}
