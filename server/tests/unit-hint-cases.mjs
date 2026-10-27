// Advisory unit hints use the existing scoped lease directory. All records are
// fictional and live only in the leasing runner's fresh tmpfs PostgreSQL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { digest } from '../dist/sessions.js';
import { newFixturePage, launchFixtureBrowser } from './browser-fixture.mjs';

export async function unitHintCases(t, admin, call, db, app, providerCalls) {
  const company = 'hint-company', home = 'hint-home', otherHome = 'hint-other-home', targetId = 'a-hint-target', fallbackId = 'z-hint-052';
  const origin = process.env.TEST_LEASING_BROWSER_URL, parsedOrigin = new URL(origin);
  assert.equal(parsedOrigin.protocol, 'http:'); assert.equal(parsedOrigin.hostname, '127.0.0.1'); assert.match(parsedOrigin.port, /^\d+$/);
  assert.equal(origin, parsedOrigin.origin); assert.equal(parsedOrigin.username, ''); assert.equal(parsedOrigin.password, '');
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  await admin.query('INSERT INTO "Company"(id,name,"updatedAt") VALUES($1,\'Fictional unit-hint company\',NOW())', [company]);
  for (const [id, role] of [['hint-owner', 'owner'], ['hint-manager', 'manager'], ['hint-staff', 'staff'], ['hint-resident', 'resident'], ['hint-person', null]]) {
    await admin.query('INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES($1,$1||\'@test.invalid\',$1,true,NOW())', [id]);
    if (role) await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,$2,$3,NOW())', [id, company, role]);
    await db.session.create({ data: { tokenHash: digest(`token-${id}`), csrfToken: 'csrf', userId: id, expiresAt: new Date(Date.now() + 3600000), idleExpiresAt: new Date(Date.now() + 3600000) } });
  }
  for (const [id, name] of [[home, 'Fictional hint home'], [otherHome, 'Other fictional hint property']])
    await admin.query('INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES($1,$2,\'Fixture street\',\'Town\',\'NY\',\'12345\',$3,NOW())', [id, name, company]);
  await admin.query('INSERT INTO "Unit"(id,"companyId","propertyId",label,"marketRentCents",version,"createdById","submissionKey","submissionHash","updatedAt") VALUES($1,$2,$3,\'Preferred beyond page fifty\',777777,7,\'hint-owner\',$1,\'fixture\',NOW()),(\'hint-other-property-unit\',$2,$4,\'Other property only\',888888,1,\'hint-owner\',\'hint-other-property-unit\',\'fixture\',NOW())', [targetId, company, home, otherHome]);
  await admin.query('INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") SELECT \'z-hint-\'||lpad(n::text,3,\'0\'),$1,$2,\'Fictional option \'||n,\'hint-owner\',\'hint-key-\'||n,\'fixture\',NOW() FROM generate_series(1,52) n', [company, home]);
  const contact = ok(await call('hint-owner', 'POST', '/api/company/resident-contacts', { name: 'Hint person', email: 'hint-person@test.invalid', submissionKey: randomUUID(), duplicateReviewed: false }));
  let prospect = ok(await call('hint-owner', 'POST', '/api/company/prospects', {
    propertyId: home, unitId: targetId, name: 'Fictional preferred-unit inquiry', email: 'hint-inquiry@test.invalid', phone: null,
    source: 'phone', desiredMoveIn: null, followUpOn: null, notes: null, reason: 'Fictional preferred-unit navigation fixture', submissionKey: randomUUID(),
  })).prospect;
  prospect = ok(await call('hint-owner', 'POST', `/api/company/prospects/${prospect.id}/stage`, {
    expectedVersion: prospect.version, stage: 'approved', reason: 'Manual fictional decision before lease setup', submissionKey: randomUUID(),
  })).prospect;
  const lookup = (unitId = targetId, propertyId = home) => '/api/company/leases?' + new URLSearchParams({ unitId, ...(propertyId ? { propertyId } : {}) });
  const setup = (unitId = targetId) => '/company/leases?' + new URLSearchParams({ new: 'lease', propertyId: home, unitId, contactId: contact.id });
  const currentUnit = async () => (await admin.query('SELECT id,label,"propertyId",status,version FROM "Unit" WHERE id=$1', [targetId])).rows[0];
  const currentProspect = () => call('hint-owner', 'GET', `/api/company/prospects/${prospect.id}`).then(ok).then(row => row.prospect);
  const snapshot = async () => (await admin.query(`SELECT
    (SELECT count(*)::int FROM "Lease" WHERE "companyId"=$1) AS leases,
    (SELECT count(*)::int FROM "LeaseParticipant" WHERE "companyId"=$1) AS participants,
    (SELECT count(*)::int FROM "ResidentContact" WHERE "companyId"=$1) AS contacts,
    (SELECT count(*)::int FROM "CompanyMembership" WHERE "userId"='hint-person') AS memberships,
    (SELECT count(*)::int FROM "ResidentPropertyAssignment" WHERE "userId"='hint-person') AS assignments,
    (SELECT count(*)::int FROM "Invitation" WHERE "companyId"=$1) AS invitations,
    (SELECT count(*)::int FROM "LedgerEntry" WHERE "companyId"=$1) AS cash,
    (SELECT count(*)::int FROM "RentCharge" WHERE "companyId"=$1) AS charges,
    (SELECT count(*)::int FROM "RentSchedule" WHERE "companyId"=$1) AS schedules,
    (SELECT count(*)::int FROM "AuditEvent" WHERE "companyId"=$1 AND action='lease.created') AS "createdAudits"`, [company])).rows[0];
  const policy = mode => admin.query('INSERT INTO "CompanySubscription"("companyId","updatedById","featureOverrides","updatedAt") VALUES($1,\'hint-owner\',$2::jsonb,NOW()) ON CONFLICT("companyId") DO UPDATE SET "featureOverrides"=EXCLUDED."featureOverrides","updatedAt"=NOW()', [company, JSON.stringify({ leasing: mode })]);

  await t.test('exact unit metadata includes current status/version and keeps fresh company, property, role and feature boundaries', async () => {
    const before = await snapshot();
    for (const actor of ['hint-owner', 'hint-manager']) {
      const result = ok(await call(actor, 'GET', lookup()));
      assert.deepEqual(result.unit, await currentUnit()); assert.deepEqual(result.items, []);
      assert.deepEqual(Object.keys(result.unit).sort(), ['id', 'label', 'propertyId', 'status', 'version']);
    }
    const page = ok(await call('hint-owner', 'GET', `/api/company/properties/${home}/units`));
    assert.equal(page.items.length, 50); assert.ok(page.nextCursor); assert.ok(!page.items.some(row => row.id === targetId));
    for (const actor of ['hint-staff', 'hint-resident', 'platform']) assert.equal((await call(actor, 'GET', lookup())).statusCode, 403);
    assert.equal((await call('foreign', 'GET', lookup())).statusCode, 404);
    assert.equal((await call('hint-owner', 'GET', lookup(targetId, otherHome))).statusCode, 404);
    assert.equal((await call('hint-owner', 'GET', lookup('foreign-unit', 'foreign-home'))).statusCode, 404);
    assert.equal((await call('hint-owner', 'GET', lookup('missing-hint-unit'))).statusCode, 404);
    assert.equal((await call('hint-owner', 'GET', lookup(), undefined, { 'x-company-id': 'b' })).statusCode, 403);
    await policy('read_only');
    try {
      assert.deepEqual(ok(await call('hint-owner', 'GET', lookup())).unit, await currentUnit());
      assert.equal((await call('hint-owner', 'POST', '/api/company/leases', {
        propertyId: home, unitId: targetId, residentContactId: contact.id, startsOn: '2026-11-01', endsOn: '2027-10-31', monthlyRent: '10.01', status: 'draft', submissionKey: randomUUID(),
      })).statusCode, 403);
    }
    finally { await admin.query('DELETE FROM "CompanySubscription" WHERE "companyId"=$1', [company]); }
    await policy('disabled');
    try { assert.equal((await call('hint-owner', 'GET', lookup())).statusCode, 403); }
    finally { await admin.query('DELETE FROM "CompanySubscription" WHERE "companyId"=$1', [company]); }
    await admin.query('UPDATE "Company" SET status=\'suspended\' WHERE id=$1', [company]);
    try { assert.equal((await call('hint-owner', 'GET', lookup())).statusCode, 403); }
    finally { await admin.query('UPDATE "Company" SET status=\'active\' WHERE id=$1', [company]); }
    await admin.query('UPDATE "Unit" SET status=\'archived\',version=version+1,label=\'Changed archived preferred source\' WHERE id=$1', [targetId]);
    assert.deepEqual(ok(await call('hint-manager', 'GET', lookup())).unit, await currentUnit(), 'retained history metadata reports current archive/version rather than claiming an active hint');
    await admin.query('UPDATE "Unit" SET status=\'active\',version=version+1,label=\'Preferred beyond page fifty\' WHERE id=$1', [targetId]);
    const leader = await admin.connect(); let pending;
    try {
      await leader.query('BEGIN'); await leader.query('UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=\'hint-owner\'');
      pending = call('hint-owner', 'GET', lookup());
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await admin.query('SELECT 1 FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE \'%User%\'')).rows.length) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(blocked);
      await leader.query('UPDATE "CompanyMembership" SET status=\'disabled\' WHERE "userId"=\'hint-owner\''); await leader.query('COMMIT');
      assert.equal((await pending).statusCode, 403);
    } finally {
      await leader.query('ROLLBACK'); leader.release(); if (pending) await pending;
      await admin.query('UPDATE "CompanyMembership" SET status=\'active\' WHERE "userId"=\'hint-owner\'');
    }
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await currentProspect(), prospect);
  });

  const browser = await launchFixtureBrowser({ headless: true }); t.after(() => browser.close());
  const posts = [], reads = [];
  async function fixturePage({ loseCommit = false, beforeCommit } = {}) {
    const page = await newFixturePage(browser); let lose = loseCommit;
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (path === '/api/telemetry') return route.fulfill({ status: 202, json: { accepted: true } });
      const isCreate = path === '/api/company/leases' && request.method() === 'POST';
      if (isCreate && beforeCommit) await beforeCommit();
      const response = await app.inject({ method: request.method(), url: path + url.search,
        headers: { ...request.headers(), origin: 'https://app.test', cookie: '__Host-pf-session=token-hint-owner' },
        ...(request.postData() ? { payload: request.postData() } : {}) });
      if (request.method() === 'GET') reads.push({ path, query: url.searchParams, status: response.statusCode, body: response.json() });
      else if (path !== '/api/account/guide') {
        const body = request.postDataJSON();
        assert.ok(!Object.keys(body || {}).some(key => /^prospect(?:Id|Q|Property|Stage|Due|Cursor)$/.test(key)), 'source markers remain navigation only');
        posts.push({ path, method: request.method(), body, status: response.statusCode, code: response.json().code });
      }
      if (isCreate && lose) { assert.equal(response.statusCode, 200, response.body); lose = false; return route.abort('failed'); }
      return route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
    });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort('blockedbyclient'));
    return page;
  }
  const unitPicker = page => page.getByLabel('Unit for new lease');
  const formReady = async page => {
    await expect(page.getByRole('region', { name: 'Record a lease', exact: true })).toBeVisible();
    await expect(unitPicker(page)).toBeVisible();
  };
  const fillTerms = async (page, rent = '1234.56') => {
    await page.getByLabel('Primary resident').selectOption(contact.id);
    await page.getByLabel('New lease start date').fill('2026-11-01');
    await page.getByLabel('New lease end date', { exact: true }).fill('2027-10-31');
    await page.getByLabel('New lease monthly rent (USD)').fill(rent);
    await page.getByLabel('New lease status').selectOption('draft');
  };

  await t.test('real prospect preferred unit beyond page fifty reaches review and durable recovery keeps the original unit despite a different hint', async () => {
    const before = await snapshot(), unitBefore = await currentUnit(), beforePosts = posts.length, beforeProvider = providerCalls.length;
    const page = await fixturePage({ loseCommit: true });
    let archivedForRecovery = false;
    try {
    await page.goto(origin + '/company/prospects?' + new URLSearchParams({ prospectId: prospect.id, propertyId: home, stage: 'approved' }));
    await page.getByRole('button', { name: 'Review tenant & lease link', exact: true }).click();
    await page.getByRole('combobox', { name: /^Tenant account/ }).selectOption(contact.id);
    const prepareLink = page.getByRole('link', { name: 'Prepare a lease through the normal lease workflow', exact: true });
    const preparation = new URL(await prepareLink.getAttribute('href'), origin);
    assert.equal(preparation.searchParams.get('new'), 'lease');
    assert.equal(preparation.searchParams.get('propertyId'), home);
    assert.equal(preparation.searchParams.get('contactId'), contact.id);
    assert.equal(preparation.searchParams.get('unitId'), targetId);
    assert.equal(preparation.searchParams.get('prospectId'), prospect.id);
    assert.equal(preparation.searchParams.get('prospectProperty'), home);
    assert.equal(preparation.searchParams.get('prospectStage'), 'approved');
    page.once('dialog', async dialog => { assert.equal(dialog.type(), 'confirm'); assert.match(dialog.message(), /discard its unsaved changes/); await dialog.dismiss(); });
    await prepareLink.click();
    await expect(page.getByRole('combobox', { name: /^Tenant account/ })).toHaveValue(contact.id);
    assert.equal(posts.length, beforePosts, 'canceling departure cannot write source records');
    page.once('dialog', dialog => dialog.accept());
    await prepareLink.click();
    await formReady(page); await expect(unitPicker(page)).toHaveValue(targetId);
    assert.equal(new URL(page.url()).searchParams.get('unitId'), targetId);
    await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('');
    await expect(page.getByLabel('New lease start date')).toHaveValue('');
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await currentUnit(), unitBefore); assert.equal(posts.length, beforePosts);
    assert.equal(providerCalls.length, beforeProvider, 'advisory navigation does not prepare an account or grant access');
    assert.ok(reads.some(read => read.path === `/api/company/properties/${home}/units` && read.status === 200 && read.body.items.length === 50 && !read.body.items.some(row => row.id === targetId)));
    assert.ok(reads.some(read => read.path === '/api/company/leases' && read.query.get('unitId') === targetId && read.query.get('propertyId') === home && read.status === 200 && read.body.unit.status === 'active'));
    await fillTerms(page);
    await page.getByRole('button', { name: 'Review lease', exact: true }).click();
    await expect(page.locator('.lease-review-summary')).toContainText('Preferred beyond page fifty');
    assert.deepEqual(await snapshot(), before);
    await page.getByRole('button', { name: 'Create lease record', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    const first = posts.at(-1); assert.equal(first.status, 200); assert.equal(first.body.unitId, targetId);
    assert.deepEqual(Object.keys(first.body).sort(), ['endsOn', 'graceDays', 'monthlyRent', 'paymentInstructions', 'propertyId', 'rentDueDay', 'residentContactId', 'startsOn', 'status', 'submissionKey', 'unitId']);
    // Every current choice can disappear after an acknowledged draft commit.
    // The receipt remains recoverable from its original journal; a new hint or
    // an empty active-unit directory cannot erase or rewrite that review.
    await admin.query('UPDATE "Unit" SET status=\'archived\',version=version+1 WHERE "companyId"=$1 AND "propertyId"=$2', [company, home]);
    archivedForRecovery = true;
    const archivedUnit = await currentUnit();
    assert.equal((await admin.query('SELECT count(*)::int n FROM "Unit" WHERE "companyId"=$1 AND "propertyId"=$2 AND status=\'active\'', [company, home])).rows[0].n, 0);
    const readsBeforeRecovery = reads.length;
    await page.goto(origin + setup(fallbackId));
    await expect.poll(() => reads.slice(readsBeforeRecovery).some(read => read.path === `/api/company/properties/${home}/units` && read.status === 200 && read.body.items.length === 50 && read.body.items.every(row => row.status === 'archived'))).toBe(true);
    await expect(page.getByRole('button', { name: 'Create lease record', exact: true })).toBeVisible();
    await expect(page.locator('.lease-review-summary')).toContainText('Preferred beyond page fifty');
    await expect(page.locator('.lease-review-summary')).toContainText('1234.56');
    const journalKey = `pf:lease-setup:hint-owner:${company}:${home}`;
    const originalJournal = await page.evaluate(key => sessionStorage.getItem(key), journalKey);
    assert.ok(originalJournal);
    await policy('read_only');
    try {
      await page.getByRole('button', { name: 'Create lease record', exact: true }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      const denied = posts.at(-1); assert.equal(denied.status, 403); assert.equal(denied.code, 'SUBSCRIPTION_READ_ONLY'); assert.deepEqual(denied.body, first.body);
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), journalKey), originalJournal, 'a fresh feature denial cannot erase the earlier uncertain committed request');
      await expect(page.getByRole('button', { name: 'Back to lease details', exact: true })).toHaveCount(0);
      assert.deepEqual(await snapshot(), { ...before, leases: 1, participants: 1, createdAudits: 1 });
    } finally { await admin.query('DELETE FROM "CompanySubscription" WHERE "companyId"=$1', [company]); }
    await page.reload();
    await expect(page.getByRole('button', { name: 'Create lease record', exact: true })).toBeVisible();
    await expect(page.locator('.lease-review-summary')).toContainText('Preferred beyond page fifty');
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), journalKey), originalJournal);
    await page.getByRole('button', { name: 'Create lease record', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Record a lease', exact: true })).not.toBeVisible();
    const second = posts.at(-1); assert.deepEqual(second.body, first.body); assert.equal(second.status, 200);
    assert.equal(posts.length, beforePosts + 3); assert.deepEqual(posts.slice(beforePosts).map(row => row.status), [200, 403, 200]);
    const rows = (await admin.query('SELECT id,"unitId","submissionKey","rentCents",status FROM "Lease" WHERE "companyId"=$1', [company])).rows;
    assert.equal(rows.length, 1); assert.equal(rows[0].unitId, targetId); assert.equal(rows[0].submissionKey, first.body.submissionKey); assert.equal(rows[0].rentCents, 123456); assert.equal(rows[0].status, 'draft');
    assert.deepEqual(await snapshot(), { ...before, leases: 1, participants: 1, createdAudits: 1 });
    assert.deepEqual(await currentUnit(), archivedUnit, 'acknowledging the receipt never restores or reserves the archived source'); assert.deepEqual(await currentProspect(), prospect);
    assert.equal((await call('hint-person', 'GET', '/api/resident/leases')).statusCode, 403);
    } finally {
      await page.close();
      if (archivedForRecovery) await admin.query('UPDATE "Unit" SET status=\'active\',version=version+1 WHERE "companyId"=$1 AND "propertyId"=$2', [company, home]);
    }
  });

  await t.test('manual choices dominate valid hints and invalid, wrong-property or archived hints fall back without writes or market-rent autofill', async () => {
    const before = await snapshot(), beforePosts = posts.length;
    for (const requested of [targetId, 'missing-hint-unit', 'hint-other-property-unit']) {
      const page = await fixturePage(); await page.goto(origin + setup(requested)); await formReady(page);
      if (requested === targetId) await expect(unitPicker(page)).toHaveValue(targetId);
      else {
        await expect.poll(() => reads.some(read => read.path === '/api/company/leases' && read.query.get('unitId') === requested && read.query.get('propertyId') === home && read.status === 404)).toBe(true);
        await expect(unitPicker(page)).toHaveValue('');
      }
      await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('');
      await unitPicker(page).selectOption(fallbackId);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(unitPicker(page)).toHaveValue(fallbackId);
      await fillTerms(page, '987.65');
      await page.getByRole('button', { name: 'Review lease', exact: true }).click();
      await expect(page.locator('.lease-review-summary')).toContainText('Fictional option 52');
      assert.deepEqual(await snapshot(), before); assert.equal(posts.length, beforePosts);
      await page.close();
    }
    await admin.query('UPDATE "Unit" SET status=\'archived\',version=version+1 WHERE id=$1', [targetId]);
    try {
      const page = await fixturePage(); await page.goto(origin + setup()); await formReady(page);
      await expect.poll(() => reads.some(read => read.path === '/api/company/leases' && read.query.get('unitId') === targetId && read.status === 200 && read.body.unit?.status === 'archived')).toBe(true);
      await expect(unitPicker(page)).toHaveValue('');
      await unitPicker(page).selectOption(fallbackId);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(unitPicker(page)).toHaveValue(fallbackId);
      await fillTerms(page, '987.65'); await page.getByRole('button', { name: 'Review lease', exact: true }).click();
      await expect(page.locator('.lease-review-summary')).toContainText('Fictional option 52');
      assert.deepEqual(await snapshot(), before); assert.equal(posts.length, beforePosts);
      await page.close();
    } finally { await admin.query('UPDATE "Unit" SET status=\'active\',version=version+1 WHERE id=$1', [targetId]); }
  });

  await t.test('unit archived after advisory review is rejected by current confirmation without partial lease, audit or access effects', async () => {
    const before = await snapshot(), beforePosts = posts.length;
    let changed = false;
    const page = await fixturePage({ beforeCommit: async () => {
      if (changed) return; changed = true;
      await admin.query('UPDATE "Unit" SET status=\'archived\',version=version+1 WHERE id=$1', [targetId]);
    } });
    try {
      await page.goto(origin + setup()); await formReady(page); await expect(unitPicker(page)).toHaveValue(targetId);
      await fillTerms(page); await page.getByRole('button', { name: 'Review lease', exact: true }).click();
      await expect(page.locator('.lease-review-summary')).toContainText('Preferred beyond page fifty');
      await page.getByRole('button', { name: 'Create lease record', exact: true }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      assert.equal(posts.length, beforePosts + 1); assert.equal(posts.at(-1).status, 409);
      assert.equal(posts.at(-1).code, 'UNIT_ARCHIVED');
      assert.equal(posts.at(-1).body.unitId, targetId); assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await currentProspect(), prospect);
      assert.equal((await currentUnit()).status, 'archived');
    } finally {
      await page.close(); await admin.query('UPDATE "Unit" SET status=\'active\',version=version+1 WHERE id=$1', [targetId]);
    }
  });
}
