import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

export async function maintenanceUpdateCases(t, admin, db, call, app, requestId) {
  const endpoint = `/api/company/maintenance/${requestId}/updates`, residentEndpoint = `/api/resident/maintenance/${requestId}/updates`;
  const internal = { content: 'Internal: compare repair estimates before approval.', visibility: 'internal', submissionKey: randomUUID() };
  const shared = { content: 'The repair visit is planned for Friday morning.', visibility: 'resident', submissionKey: randomUUID() };
  let internalId, sharedId;
  await t.test('updates replay once, validate payloads, and retain immutable audience', async () => {
    const results = await Promise.all(Array.from({ length: 3 }, () => call('manager', 'POST', endpoint, internal)));
    for (const result of results) assert.equal(result.statusCode, 200, result.body);
    internalId = results[0].json().id;
    assert.equal(new Set(results.map(r => r.json().id)).size, 1);
    assert.equal((await call('manager', 'POST', endpoint, { ...internal, submissionKey: internal.submissionKey.toUpperCase() })).json().id, internalId);
    for (const patch of [{ content: 'Changed' }, { visibility: 'resident' }]) assert.equal((await call('manager', 'POST', endpoint, { ...internal, ...patch })).statusCode, 409);
    const response = await call('owner', 'POST', endpoint, shared); assert.equal(response.statusCode, 200, response.body); sharedId = response.json().id;
    assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='maintenance.update.recorded' AND detail->>'updateId'=$1`, [internalId])).rows[0].n, 1);
    for (const payload of [{ ...internal, content: ' ' }, { ...internal, content: 'x'.repeat(4001) }, { ...internal, content: 'a\0b' }, { ...internal, visibility: 'all' }, { ...internal, submissionKey: 'invalid' }, { ...internal, createdById: 'owner' }, { ...internal, companyId: 'b' }, { ...internal, expectedVersion: 1 }]) assert.equal((await call('manager', 'POST', endpoint, payload)).statusCode, 400);
    for (const actor of ['resident', 'staff']) for (const method of ['GET', 'POST']) assert.equal((await call(actor, method, endpoint, method === 'POST' ? internal : null)).statusCode, 403);
    for (const method of ['GET', 'POST']) assert.equal((await call('foreign', method, endpoint, method === 'POST' ? internal : null)).statusCode, 404);
    for (const headers of [{ origin: 'https://evil.test' }, { 'x-csrf-token': 'wrong' }, { 'x-company-id': 'b' }]) assert.equal((await call('manager', 'POST', endpoint, internal, headers)).statusCode, 403);
    const management = (await admin.query(`SELECT id FROM "MaintenanceRequest" WHERE title='Boiler inspection'`)).rows[0].id;
    assert.equal((await call('owner', 'GET', `/api/company/maintenance/${management}`)).json().residentUpdatesAvailable, false);
    assert.equal((await call('owner', 'GET', `/api/company/maintenance/${requestId}`)).json().residentUpdatesAvailable, true);
    assert.equal((await call('owner', 'POST', `/api/company/maintenance/${management}/updates`, { ...shared, submissionKey: randomUUID() })).statusCode, 409);
    assert.equal((await call('manager', 'POST', `/api/company/maintenance/${management}/updates`, internal)).statusCode, 409, 'reusing a key on another request must not replay another request\'s update');
  });
  await t.test('resident projection excludes private notes, author identity and submission metadata', async () => {
    const management = (await call('manager', 'GET', endpoint)).json(); assert.equal(management.items.length, 2);
    const resident = await call('resident', 'GET', residentEndpoint); assert.equal(resident.statusCode, 200, resident.body);
    assert.deepEqual(resident.json().items, [{ id: sharedId, content: shared.content, visibility: 'resident', createdAt: management.items.find(r => r.id === sharedId).createdAt, author: 'Property team' }]);
    for (const secret of [internal.content, internalId, 'createdById', 'submissionKey', 'submissionHash', '@test.invalid']) assert.ok(!resident.body.includes(secret), secret);
    assert.equal((await call('other', 'GET', residentEndpoint)).statusCode, 404);
    assert.equal((await call('resident', 'GET', residentEndpoint + '?cursor=' + internalId)).statusCode, 404);
    assert.equal((await call('resident', 'GET', residentEndpoint + '?visibility=internal')).statusCode, 400);
    const detail = (await call('resident', 'GET', `/api/resident/maintenance/${requestId}`)).body; assert.ok(!detail.includes(internal.content)); assert.ok(!detail.includes(internalId));
    assert.ok(!JSON.stringify((await admin.query(`SELECT detail FROM "AuditEvent" WHERE action='maintenance.update.recorded'`)).rows).includes(internal.content), 'audit metadata must not duplicate note bodies');
  });
  await t.test('visible updates paginate before the limit without exposing private cursors', async () => {
    try {
      await admin.query(`INSERT INTO "MaintenanceUpdate"(id,"companyId","requestId",content,visibility,"createdById","submissionKey","submissionHash","createdAt") SELECT 'history-'||audience||'-'||n,'a',$1,'History '||audience||' '||n,audience,'manager','history-'||audience||'-'||n,'fixture','2030-01-01'::timestamp FROM generate_series(1,51) n CROSS JOIN (VALUES('internal'),('resident')) v(audience)`, [requestId]);
      const first = (await call('resident', 'GET', residentEndpoint)).json(); assert.equal(first.items.length, 50); assert.ok(first.nextCursor); assert.ok(first.items.every(r => r.visibility === 'resident'));
      const second = (await call('resident', 'GET', residentEndpoint + '?cursor=' + first.nextCursor)).json(); assert.equal(second.items.length, 2); assert.equal(second.nextCursor, null);
      assert.equal(new Set([...first.items, ...second.items].map(r => r.id)).size, 52);
      assert.equal((await call('resident', 'GET', residentEndpoint + '?cursor=history-internal-51')).statusCode, 404);
      const owner = (await call('owner', 'GET', endpoint)).json(); assert.equal(owner.items.length, 50); assert.ok(owner.nextCursor);
    } finally { await admin.query(`DELETE FROM "MaintenanceUpdate" WHERE id LIKE 'history-%'`); }
  });
  await t.test('updates enforce forced RLS, composite request scope and append-only runtime privileges', async () => {
    const withoutContext = await db.maintenanceUpdate.findMany(); assert.deepEqual(withoutContext, []);
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.company_id','b',true)`; assert.equal(await tx.maintenanceUpdate.count(), 0);
    });
    for (const statement of [`UPDATE "MaintenanceUpdate" SET content='changed' WHERE id='${internalId}'`, `DELETE FROM "MaintenanceUpdate" WHERE id='${internalId}'`]) await assert.rejects(db.$executeRawUnsafe(statement), /permission denied/);
    await assert.rejects(admin.query(`INSERT INTO "MaintenanceUpdate"(id,"companyId","requestId",content,"createdById","submissionKey","submissionHash") VALUES ('foreign-note','b',$1,'Wrong scope','foreign','foreign-note','fixture')`, [requestId]), /foreign key/);
  });
  await t.test('failed audit rolls back note and retry identity atomically', async () => {
    const payload = { ...internal, content: 'Atomic note regression', submissionKey: randomUUID() };
    await admin.query(`CREATE FUNCTION reject_update_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='maintenance.update.recorded' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_update_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_update_audit()`);
    try { assert.equal((await call('manager', 'POST', endpoint, payload)).statusCode, 500); assert.equal((await admin.query(`SELECT count(*)::int n FROM "MaintenanceUpdate" WHERE "submissionKey"=$1`, [payload.submissionKey])).rows[0].n, 0); }
    finally { await admin.query(`DROP TRIGGER reject_update_audit ON "AuditEvent"; DROP FUNCTION reject_update_audit()`); }
    assert.equal((await call('manager', 'POST', endpoint, payload)).statusCode, 200);
  });
  await t.test('revocation-leading reads and replay discard stale authorization snapshots', async () => {
    const cases = [
      ['resident', 'GET', residentEndpoint, null, `DELETE FROM "ResidentPropertyAssignment" WHERE "userId"='resident'`, 404],
      ['manager', 'POST', endpoint, internal, `UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='manager'`, 403],
    ];
    for (const [actor, method, path, payload, revoke, expected] of cases) {
      const leader = await admin.connect(); let pending;
      try {
        await leader.query('BEGIN'); await leader.query(`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=$1`, [actor]);
        pending = call(actor, method, path, payload);
        let blocked = false;
        for (let i = 0; i < 200; i++) { if ((await admin.query(`SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%User%'`)).rows.length) { blocked = true; break; } await new Promise(r => setTimeout(r, 10)); }
        assert.ok(blocked); await leader.query(revoke); await leader.query('COMMIT'); assert.equal((await pending).statusCode, expected);
      } finally {
        await leader.query('ROLLBACK'); leader.release(); if (pending) await pending;
        await admin.query(`UPDATE "CompanyMembership" SET status='active' WHERE "userId"='manager'`);
        await admin.query(`INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','resident') ON CONFLICT DO NOTHING`);
      }
    }
  });
  await t.test('browser committed-response-loss keeps the update draft, audience and key', { skip: !process.env.TEST_MAINTENANCE_BROWSER_URL }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage(); let lose = true; const attempts = [];
      await page.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url());
        const response = await app.inject({ method: req.method(), url: url.pathname + url.search, headers: { ...req.headers(), origin: 'https://app.test', cookie: '__Host-pf-session=token-manager' }, ...(req.postData() ? { payload: req.postData() } : {}) });
        if (req.method() === 'POST' && url.pathname === endpoint) { attempts.push(req.postDataJSON()); assert.equal(response.statusCode, 200, response.body); if (lose) { lose = false; return route.abort('failed'); } }
        await route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
      });
      await page.goto(process.env.TEST_MAINTENANCE_BROWSER_URL + `/company/maintenance/${requestId}`);
      await page.getByRole('button', { name: 'Add update', exact: true }).click();
      await expect(page.getByLabel('Update audience')).toHaveValue('internal');
      await page.getByLabel('Update audience').selectOption('resident'); await page.getByLabel('Update text').fill('Browser shared update regression');
      await page.getByRole('button', { name: 'Record update', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
      await page.getByRole('button', { name: 'Close', exact: true }).click(); await page.getByRole('button', { name: 'Add update', exact: true }).click();
      await expect(page.getByLabel('Update text')).toHaveValue('Browser shared update regression'); await expect(page.getByLabel('Update audience')).toHaveValue('resident');
      await page.getByRole('button', { name: 'Record update', exact: true }).click(); await expect(page.getByText('Update recorded.', { exact: true })).toBeVisible();
      assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1]);
      assert.equal((await admin.query(`SELECT count(*)::int n FROM "MaintenanceUpdate" WHERE "submissionKey"=$1`, [attempts[0].submissionKey])).rows[0].n, 1);
      await expect(page.getByText('Browser shared update regression', { exact: true })).toHaveCount(1);
      await page.getByRole('button', { name: 'Add update', exact: true }).click(); await expect(page.getByLabel('Update text')).toHaveValue(''); await expect(page.getByLabel('Update audience')).toHaveValue('internal');
    } finally { await browser.close(); }
  });
}
