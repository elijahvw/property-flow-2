import { newFixturePage } from "./browser-fixture.mjs";
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

export async function residentPortalCases(t, admin, call, app, { lease, today }) {
  const rent = `/api/company/rent/${lease.id}`;
  const deposit = `/api/company/deposits/${lease.id}`;
  const movements = `/api/company/lease-movements/${lease.id}`;
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  await t.test('resident financial writes are denied with valid payloads and leave balances, sources and audits unchanged', async () => {
    const before = ok(await call('resident', 'GET', movements.replace('/company/', '/resident/')));
    const charge = before.charges[0], payment = before.payments[0], movement = before.movements[0];
    const receipt = ok(await call('resident', 'GET', deposit.replace('/company/', '/resident/'))).account.receipts[0];
    assert.ok(charge && payment && movement && receipt, 'Read-only fixture must have retained financial sources');
    const movementBody = kind => ({ kind, amount: '1.00', effectiveOn: today, reason: 'Unauthorized movement', expectedLeaseVersion: lease.version,
      expectedAvailableCents: kind === 'rent_refund' ? payment.availableCents : before.deposit.heldCents,
      expectedAccountVersion: before.deposit.version, expectedSourceVersion: 1, chargeId: charge.id, paymentId: payment.id,
      expectedRemainingCents: charge.remainingCents, payee: 'Resident', method: 'cash', confirmed: true, submissionKey: randomUUID() });
    const auditCount = (await admin.query('SELECT count(*)::int n FROM "AuditEvent"')).rows[0].n;
    const base = { amount: '1.00', submissionKey: randomUUID() };
    const cases = [
      ['POST', `${rent}/payments`, { ...base, occurredOn: today, memo: null }],
      ['POST', `${rent}/charges`, { ...base, periodOn: today.slice(0, 7) + '-01', dueOn: today, expectedVersion: lease.version, memo: null }],
      ['POST', `${rent}/one-time-charges`, { ...base, category: 'other', effectiveOn: today, dueOn: today, description: 'Unauthorized charge', expectedLeaseVersion: lease.version }],
      ['POST', `${rent}/credits`, { ...base, kind: 'credit_note', chargeId: charge.id, effectiveOn: today, reason: 'Unauthorized credit', expectedLeaseVersion: lease.version, expectedChargeVersion: 1, expectedRemainingCents: '10000' }],
      ['POST', `${rent}/credits/${charge.id}/reverse`, { effectiveOn: today, reason: 'Unauthorized credit reversal', expectedLeaseVersion: lease.version, submissionKey: randomUUID() }],
      ['POST', `/api/company/rent/charges/${charge.id}/void`, { expectedVersion: 1, reason: 'Unauthorized correction' }],
      ['POST', `/api/company/finances/${payment.id}/void`, { expectedVersion: 1, reason: 'Unauthorized correction' }],
      ['POST', deposit, { ...base, dueOn: today, expectedLeaseVersion: lease.version }],
      ['PATCH', deposit, { ...base, dueOn: today, reason: 'Unauthorized terms', expectedVersion: 1, expectedLeaseVersion: lease.version }],
      ['POST', `${deposit}/receipts`, { ...base, occurredOn: today, method: 'cash', expectedVersion: 1, expectedLeaseVersion: lease.version }],
      ['POST', `/api/company/deposit-receipts/${receipt.id}/void`, { expectedVersion: 1, reason: 'Unauthorized receipt correction' }],
      ...['deposit_application', 'deposit_refund', 'rent_refund'].map(kind => ['POST', movements, movementBody(kind)]),
      ['POST', `${movements}/${movement.id}/reverse`, { effectiveOn: today, reason: 'Unauthorized reversal', expectedLeaseVersion: lease.version, confirmed: true, submissionKey: randomUUID() }],
    ];
    for (const [method, path, body] of cases) {
      const response = await call('resident', method, path, body);
      assert.equal(response.statusCode, 403, `${method} ${path}: ${response.body}`);
      // There is no resident write alias for any of these financial operations.
      const alias = await call('resident', method, path.replace('/company/', '/resident/'), body);
      assert.equal(alias.statusCode, 404, `${method} resident alias: ${alias.body}`);
    }
    assert.deepEqual(ok(await call('resident', 'GET', movements.replace('/company/', '/resident/'))), before);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent"')).rows[0].n, auditCount);
  });
  await t.test('resident portal shows read-only history on desktop and phone without management forms', { skip: !process.env.TEST_FINANCES_BROWSER_URL }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await newFixturePage(browser);
      const writes = [];
      await page.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url());
        // Walkthrough progress and bounded telemetry do not mutate business records.
        if (!['GET', 'HEAD'].includes(req.method()) && !['/api/account/guide', '/api/telemetry'].includes(url.pathname)) writes.push(`${req.method()} ${url.pathname}`);
        const response = await app.inject({ method: req.method(), url: url.pathname + url.search,
          headers: { ...req.headers(), origin: 'https://app.test', cookie: '__Host-pf-session=token-resident' },
          ...(req.postData() ? { payload: req.postData() } : {}) });
        await route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
      });
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(process.env.TEST_FINANCES_BROWSER_URL + '/resident');
        await expect(page.getByRole('heading', { name: 'My rental', exact: true })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Resident services' })).toBeVisible();
        await expect(page.getByText('Your lease and household records are view-only.', { exact: false })).toBeVisible();
        await page.locator('summary').filter({ hasText: 'View invitation history' }).first().click();
        await expect(page.getByRole('heading', { name: 'Invitation history', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /Invite a resident|Request owner approval|Cancel invitation/ })).toHaveCount(0);
        for (const path of [`/resident/rent?leaseId=${lease.id}`, `/resident/deposits?leaseId=${lease.id}`]) {
          await page.goto(process.env.TEST_FINANCES_BROWSER_URL + path);
          await expect(page.getByRole('complementary', { name: 'Read-only financial records' })).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Deposit activity', exact: true })).toBeVisible();
          await expect(page.getByRole('heading', { name: /Apply or return deposit funds|Return an unapplied payment/ })).toHaveCount(0);
          await expect(page.locator('main form')).toHaveCount(0);
          await expect(page.getByRole('button', { name: /Record (payment|deposit|credit)|Apply deposit|Post monthly rent|Void |Reverse |Correct refund|Change deposit|Set up deposit/ })).toHaveCount(0);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          if (width === 390 && path.includes('/deposits')) await page.screenshot({ path: '/tmp/propertyflow-resident-deposit-read-only-mobile.png', fullPage: true });
        }
      }
      assert.deepEqual(writes, [], 'Viewing resident records must never submit a business mutation');
    } finally { await browser.close(); }
  });
}
