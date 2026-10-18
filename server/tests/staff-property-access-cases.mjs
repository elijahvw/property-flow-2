import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

export async function staffPropertyAccessCases(t, admin, call, db, app) {
  const endpoint = '/api/company/members/staff/property-access';
  const read = async () => {
    const r = await call('owner', 'GET', endpoint);
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const save = async (scope, propertyIds, expectedVersion) => call('owner', 'PUT', endpoint, { scope, propertyIds, expectedVersion });
  const ids = async user => (await call(user, 'GET', '/api/company/properties')).json().map(p => p.id).sort();
  await t.test('existing staff retain all properties; only company owners administer scope', async () => {
    assert.deepEqual(await ids('staff'), ['home', 'other-home']);
    const current = await read();
    assert.equal(current.scope, 'all');
    assert.deepEqual(current.propertyIds, []);
    assert.deepEqual(current.properties.map(p => p.id).sort(), ['home', 'other-home']);
    for (const user of ['staff', 'manager', 'resident', 'platform']) {
      assert.equal((await call(user, 'GET', endpoint)).statusCode, 403, user);
      assert.equal((await call(user, 'PUT', endpoint, { scope: 'selected', propertyIds: [], expectedVersion: current.expectedVersion })).statusCode, 403, user);
    }
    assert.equal((await call('foreign', 'GET', endpoint)).statusCode, 404);
    assert.equal((await call('owner', 'GET', '/api/company/members/manager/property-access')).statusCode, 404);
    for (const extra of [{ origin: 'https://evil.test' }, { 'x-csrf-token': 'bad' }, { 'x-company-id': 'b' }]) {
      assert.equal((await call('owner', 'PUT', endpoint, { scope: 'selected', propertyIds: [], expectedVersion: current.expectedVersion }, extra)).statusCode, 403);
    }
  });
  await t.test('scope validation rejects foreign properties and stale or unsupported input', async () => {
    const current = await read();
    for (const patch of [{ scope: 'wrong' }, { propertyIds: ['home', 'home'] }, { scope: 'all', propertyIds: ['home'] }, { propertyIds: 'home' }, { expectedVersion: 0 }, { capabilities: ['finance.manage'] }]) {
      const r = await call('owner', 'PUT', endpoint, { scope: 'selected', propertyIds: [], expectedVersion: current.expectedVersion, ...patch });
      assert.equal(r.statusCode, 400, r.body);
    }
    for (const propertyIds of [['foreign-home'], ['missing']]) assert.equal((await save('selected', propertyIds, current.expectedVersion)).statusCode, 404);
    assert.equal((await read()).expectedVersion, current.expectedVersion);
  });
  await t.test('grant affects every read projection; guessed URLs and search stay denied', async () => {
    const current = await read();
    const r = await save('selected', ['other-home'], current.expectedVersion);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(await ids('staff'), ['other-home']);
    const directory = (await call('staff', 'GET', '/api/company/property-directory')).json();
    assert.deepEqual(directory.items.map(p => p.id), ['other-home']);
    const overview = (await call('staff', 'GET', '/api/company/overview')).json();
    assert.equal(overview.propertyCount, 1);
    assert.equal(overview.activeUnitCount, 0);
    assert.deepEqual(overview.properties.map(p => p.id), ['other-home']);
    assert.equal(overview.leases, undefined);
    assert.equal(overview.cash, undefined);
    for (const path of ['/api/company/properties/home', '/api/company/properties/home/units', '/api/company/properties/home/units?q=Unit', '/api/company/overview?propertyId=home']) {
      const response = await call('staff', 'GET', path);
      assert.equal(response.statusCode, 404, path + response.body);
    }
    assert.equal((await call('staff', 'GET', '/api/company/properties/other-home')).statusCode, 200);
    assert.equal((await call('staff', 'GET', '/api/company/properties/other-home/units')).statusCode, 200);
    assert.deepEqual(await ids('manager'), ['home', 'other-home']);
    assert.deepEqual(await ids('owner'), ['home', 'other-home']);
    for (const path of ['/api/company/leases', '/api/company/maintenance', '/api/company/members']) assert.equal((await call('staff', 'GET', path)).statusCode, 403, path);
    assert.equal((await save('all', [], current.expectedVersion)).statusCode, 409);
    const after = await read();
    assert.equal(after.history[0].detail.from.scope, 'all');
    assert.deepEqual(after.history[0].detail.to.propertyIds, ['other-home']);
    const count = after.history.length;
    assert.equal((await save('selected', ['other-home'], current.expectedVersion)).statusCode, 200, 'lost-response replay is harmless');
    assert.equal((await save('selected', ['other-home'], after.expectedVersion)).statusCode, 200);
    assert.equal((await read()).history.length, count, 'unchanged saves do not create duplicate history');
  });
  await t.test('competing access edits have one winner; revocation closes an existing session', async () => {
    const current = await read();
    const replies = await Promise.all([save('selected', ['home'], current.expectedVersion), save('selected', [], current.expectedVersion)]);
    assert.deepEqual(replies.map(r => r.statusCode).sort(), [200, 409]);
    const latest = await read();
    assert.equal((await save('selected', [], latest.expectedVersion)).statusCode, 200);
    assert.deepEqual(await ids('staff'), []);
    const overview = (await call('staff', 'GET', '/api/company/overview')).json();
    assert.equal(overview.propertyCount, 0);
    assert.equal(overview.activeUnitCount, 0);
    assert.deepEqual(overview.properties, []);
    assert.deepEqual((await call('staff', 'GET', '/api/company/property-directory')).json().items, []);
    assert.equal((await call('staff', 'GET', '/api/company/properties/other-home')).statusCode, 404);
  });
  await t.test('audit failure rolls back grants and membership version; RLS denies unscoped grants', async () => {
    const current = await read();
    await admin.query(`CREATE FUNCTION fail_staff_scope_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='staff.property_access.updated' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_staff_scope_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION fail_staff_scope_audit()`);
    try {
      assert.equal((await save('selected', ['home'], current.expectedVersion)).statusCode, 500);
      assert.equal((await read()).expectedVersion, current.expectedVersion);
      assert.deepEqual(await ids('staff'), []);
    } finally { await admin.query(`DROP TRIGGER fail_staff_scope_audit ON "AuditEvent"; DROP FUNCTION fail_staff_scope_audit()`); }
    const after = await read();
    assert.equal((await save('selected', ['home'], after.expectedVersion)).statusCode, 200);
    assert.equal((await db.staffPropertyAccess.findMany()).length, 0, 'runtime cannot read grants outside company context');
    await assert.rejects(() => db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.company_id','b',true)`;
      await tx.staffPropertyAccess.create({ data: { companyId: 'a', propertyId: 'other-home', userId: 'staff' } });
    }));
    assert.deepEqual(await ids('staff'), ['home']);
  });
  await t.test('revocation that leads a queued staff read invalidates its stale snapshot', async () => {
    const leader = await admin.connect();
    let pending;
    try {
      await leader.query('BEGIN');
      await leader.query(`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id='staff'`);
      pending = call('staff', 'GET', '/api/company/properties/home');
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        if ((await admin.query(`SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%User%'`)).rows.length) { blocked = true; break; }
        await new Promise(r => setTimeout(r, 10));
      }
      assert.ok(blocked, 'staff read waits on the access-change fence');
      await leader.query(`DELETE FROM "StaffPropertyAccess" WHERE "userId"='staff'`);
      await leader.query(`UPDATE "CompanyMembership" SET version=version+1 WHERE "userId"='staff'`);
      await leader.query('COMMIT');
      assert.equal((await pending).statusCode, 404);
      assert.deepEqual(await ids('staff'), []);
    } finally {
      await leader.query('ROLLBACK');
      leader.release();
      if (pending) await pending;
    }
  });
  await t.test('disabling access clears property grants and reactivation cannot resurrect them', async () => {
    const current = await read();
    assert.equal((await save('selected', ['home'], current.expectedVersion)).statusCode, 200);
    const active = await read();
    const disabled = await call('owner', 'PATCH', '/api/company/members/staff', { role: 'staff', status: 'disabled', expectedVersion: active.expectedVersion });
    assert.equal(disabled.statusCode, 200, disabled.body);
    assert.equal((await call('staff', 'GET', '/api/company/properties')).statusCode, 403);
    assert.equal((await read()).propertyIds.length, 0);
    const enabled = await call('owner', 'PATCH', '/api/company/members/staff', { role: 'staff', status: 'active', expectedVersion: disabled.json().version });
    assert.equal(enabled.statusCode, 200, enabled.body);
    assert.deepEqual(await ids('staff'), []);
  });
  await t.test('owner browser grant, response-loss retry, history and staff view use the real API', { skip: !process.env.TEST_LEASING_BROWSER_URL }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const owner = await browser.newPage(), staff = await browser.newPage();
      let loseResponse = true;
      const routePage = async (page, user) => page.route('**/api/**', async route => {
        const req = route.request(), u = new URL(req.url());
        const response = await app.inject({ method: req.method(), url: u.pathname + u.search, headers: { ...req.headers(), origin: 'https://app.test', cookie: `__Host-pf-session=token-${user}` }, ...(req.postData() ? { payload: req.postData() } : {}) });
        if (user === 'owner' && req.method() === 'PUT' && u.pathname === endpoint && loseResponse) {
          assert.equal(response.statusCode, 200, response.body);
          loseResponse = false;
          return route.abort('failed');
        }
        await route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
      });
      await routePage(owner, 'owner'); await routePage(staff, 'staff');
      await owner.goto(process.env.TEST_LEASING_BROWSER_URL + '/company/members');
      await owner.getByRole('button', { name: 'Property access', exact: true }).click();
      await owner.getByLabel('Property access', { exact: true }).selectOption('selected');
      await owner.getByRole('checkbox', { name: /^home / }).check();
      await owner.getByRole('searchbox', { name: 'Find a property' }).fill('other-home');
      await expect(owner.getByText('1 selected', { exact: true })).toBeVisible();
      await owner.getByRole('button', { name: 'Save property access', exact: true }).click();
      await expect(owner.getByRole('alert')).toBeVisible();
      await owner.getByRole('searchbox', { name: 'Find a property' }).fill('');
      await expect(owner.getByRole('checkbox', { name: /^home / })).toBeChecked();
      await owner.getByRole('button', { name: 'Save property access', exact: true }).click();
      await expect(owner.getByRole('dialog')).not.toBeVisible();
      await expect(owner.locator('.feedback-region')).toContainText('Staff property access saved.');
      await staff.goto(process.env.TEST_LEASING_BROWSER_URL + '/company/properties');
      await expect(staff.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible();
      await expect(staff.getByRole('link', { name: 'home', exact: true })).toBeVisible();
      await expect(staff.getByRole('link', { name: 'other-home', exact: true })).toHaveCount(0);
      await owner.getByRole('button', { name: 'Property access', exact: true }).click();
      await owner.getByText('Recent property access changes', { exact: true }).click();
      await expect(owner.getByText(/Company administrator:/).first()).toBeVisible();
      await owner.getByRole('checkbox', { name: /^home / }).uncheck();
      await owner.getByRole('button', { name: 'Save property access', exact: true }).click();
      await expect(owner.getByRole('dialog')).not.toBeVisible();
      await staff.reload();
      await expect(staff.getByRole('link', { name: 'home', exact: true })).toHaveCount(0);
      assert.deepEqual(await ids('staff'), []);
    } finally { await browser.close(); }
  });
  // Later leasing fixtures retain their original all-properties staff baseline.
  const final = await read();
  assert.equal((await save('all', [], final.expectedVersion)).statusCode, 200);
}
