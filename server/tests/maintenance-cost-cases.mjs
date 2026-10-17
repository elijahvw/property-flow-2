import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

export async function maintenanceCostCases(t, admin, db, call, app, requestId) {
  const base = `/api/company/maintenance/${requestId}/costs`, otherRequest = (await admin.query(`SELECT id FROM "MaintenanceRequest" WHERE title='Boiler inspection'`)).rows[0].id;
  const expense = async (overrides = {}, actor = 'owner') => {
    const result = await call(actor, 'POST', '/api/company/finances', { propertyId: 'home', occurredOn: '2026-10-16', amount: '125.05', kind: 'expense', category: 'repairs', memo: 'Kitchen repair paid', submissionKey: randomUUID(), ...overrides });
    assert.equal(result.statusCode, 200, result.body); return result.json();
  };
  let entry, link, payload;
  await t.test('cost links reuse one paid source with durable replay and unchanged finance totals', async () => {
    entry = await expense(); payload = { entryId: entry.id, expectedEntryVersion: entry.version, submissionKey: randomUUID() };
    const before = (await call('owner', 'GET', '/api/company/finances')).json().summary;
    const results = await Promise.all(Array.from({ length: 3 }, () => call('manager', 'POST', base, payload)));
    for (const result of results) assert.equal(result.statusCode, 200, result.body);
    link = results[0].json(); assert.equal(new Set(results.map(r => r.json().id)).size, 1);
    assert.deepEqual((await call('owner', 'GET', '/api/company/finances')).json().summary, before);
    const costs = (await call('owner', 'GET', base)).json(); assert.deepEqual(costs.summary, { paidCents: '12505', paidCount: 1 }); assert.equal(costs.items[0].entry.id, entry.id);
    const source = await call('owner', 'GET', `/api/company/finances?entryId=${entry.id}&propertyId=home`); assert.equal(source.json().items.length, 1); assert.equal(source.json().summary.expenseCents, '12505'); assert.equal(source.json().items[0].maintenanceCosts[0].requestId, requestId);
    assert.equal((await call('foreign', 'GET', `/api/company/finances?entryId=${entry.id}`)).statusCode, 404);
    assert.equal((await call('manager', 'POST', base, { ...payload, expectedEntryVersion: 2 })).statusCode, 409);
    assert.equal((await call('owner', 'POST', `/api/company/maintenance/${otherRequest}/costs`, { ...payload, submissionKey: randomUUID() })).statusCode, 409);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='maintenance.cost.linked' AND detail->>'linkId'=$1`, [link.id])).rows[0].n, 1);
  });
  await t.test('cost access is management-only and rejects cross-company/property, income, voids and CSRF', async () => {
    for (const actor of ['staff', 'resident', 'other']) for (const path of [base, base + '/candidates']) assert.equal((await call(actor, 'GET', path)).statusCode, 403);
    for (const method of ['GET', 'POST']) assert.equal((await call('foreign', method, base, method === 'POST' ? payload : null)).statusCode, 404);
    assert.equal((await call('resident', 'POST', base, payload)).statusCode, 403);
    for (const headers of [{ origin: 'https://evil.test' }, { 'x-csrf-token': 'wrong' }, { 'x-company-id': 'b' }]) assert.equal((await call('manager', 'POST', base, payload, headers)).statusCode, 403);
    for (const patch of [{ amount: '1.00' }, { propertyId: 'home' }, { expectedEntryVersion: undefined }, { submissionKey: 'bad' }]) assert.equal((await call('manager', 'POST', base, { ...payload, ...patch })).statusCode, 400);
    const income = await expense({ kind: 'income', category: 'other' });
    assert.equal((await call('owner', 'POST', base, { entryId: income.id, expectedEntryVersion: 1, submissionKey: randomUUID() })).statusCode, 409);
    const foreign = await expense({ propertyId: 'foreign-home' }, 'foreign');
    assert.equal((await call('owner', 'POST', base, { entryId: foreign.id, expectedEntryVersion: 1, submissionKey: randomUUID() })).statusCode, 404);
    await admin.query(`INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES('cost-other-home','Other','Street','City','PA','00000','a',NOW())`);
    try {
      const other = await expense({ propertyId: 'cost-other-home' });
      assert.equal((await call('owner', 'POST', base, { entryId: other.id, expectedEntryVersion: 1, submissionKey: randomUUID() })).statusCode, 404);
      assert.equal((await call('owner', 'GET', `/api/company/finances?propertyId=cost-other-home&entryId=${entry.id}`)).statusCode, 404);
      await assert.rejects(admin.query(`INSERT INTO "MaintenanceCost"(id,"companyId","propertyId","requestId","entryId","createdById","submissionKey","submissionHash") VALUES('bad-scope','a','cost-other-home',$1,$2,'owner','bad-scope','fixture')`, [requestId, other.id]), /foreign key/);
    } finally { await admin.query(`DELETE FROM "LedgerEntry" WHERE "propertyId"='cost-other-home'`); await admin.query(`DELETE FROM "Property" WHERE id='cost-other-home'`); }
    const resident = await call('resident', 'GET', `/api/resident/maintenance/${requestId}`); for (const value of [entry.id, link.id, '12505', 'maintenanceCosts']) assert.ok(!resident.body.includes(value));
  });
  await t.test('unlink preserves source, requires reviewed version/reason, and supports deliberate relinking', async () => {
    const path = base + `/${link.id}/unlink`, body = { expectedVersion: 1, reason: 'Expense belongs with the boiler request.' };
    assert.equal((await call('manager', 'POST', path, { ...body, expectedVersion: 2 })).statusCode, 409);
    const response = await call('manager', 'POST', path, body); assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().version, 2);
    assert.equal((await call('manager', 'POST', path, body)).json().id, link.id);
    assert.equal((await call('owner', 'POST', path, body)).statusCode, 409);
    assert.deepEqual((await call('owner', 'GET', base)).json().summary, { paidCents: '0', paidCount: 0 });
    assert.equal((await call('owner', 'GET', `/api/company/finances?entryId=${entry.id}`)).json().summary.expenseCents, '12505');
    assert.ok((await call('manager', 'POST', base, payload)).json().unlinkedAt, 'creation replay must not reactivate an unlinked record');
    const relocated = await call('owner', 'POST', `/api/company/maintenance/${otherRequest}/costs`, { entryId: entry.id, expectedEntryVersion: 1, submissionKey: randomUUID() }); assert.equal(relocated.statusCode, 200, relocated.body);
    const voided = await call('owner', 'POST', `/api/company/finances/${entry.id}/void`, { expectedVersion: 1, reason: 'Correct recorded expense.' }); assert.equal(voided.statusCode, 200, voided.body);
    const history = (await call('manager', 'GET', `/api/company/maintenance/${otherRequest}/costs`)).json(); assert.equal(history.summary.paidCents, '0'); assert.ok(history.items[0].entry.voidedAt); assert.equal(history.items[0].entry.amountCents, 12505);
    assert.equal((await call('owner', 'POST', base, { entryId: entry.id, expectedEntryVersion: 2, submissionKey: randomUUID() })).statusCode, 409);
  });
  await t.test('candidate search precedes pagination and totals include every linked page', async () => {
    try {
      await admin.query(`INSERT INTO "LedgerEntry"(id,"companyId","propertyId","createdById","submissionKey","submissionHash","occurredOn","amountCents",kind,category,memo) SELECT 'cost-page-'||lpad(n::text,3,'0'),'a','home','owner','cost-page-'||n,'fixture','2026-10-16',101,'expense','repairs',CASE n WHEN 0 THEN 'Unique cost target' ELSE 'Pagination cost' END FROM generate_series(0,50) n`);
      const first = (await call('manager', 'GET', base + '/candidates')).json(); assert.equal(first.items.length, 50); assert.ok(first.nextCursor);
      const searched = (await call('manager', 'GET', base + '/candidates?q=UNIQUE%20cost%20target')).json(); assert.deepEqual(searched.items.map(r => r.id), ['cost-page-000']);
      for (const q of ['q=' + 'x'.repeat(201), 'q=a&q=b', 'companyId=b']) assert.equal((await call('owner', 'GET', base + '/candidates?' + q)).statusCode, 400);
      await admin.query(`INSERT INTO "MaintenanceCost"(id,"companyId","propertyId","requestId","entryId","createdById","submissionKey","submissionHash") SELECT 'cost-link-'||lpad(n::text,3,'0'),'a','home',$1,'cost-page-'||lpad(n::text,3,'0'),'owner','cost-link-'||n,'fixture' FROM generate_series(0,50) n`, [requestId]);
      const list = (await call('owner', 'GET', base)).json(); assert.equal(list.items.length, 50); assert.deepEqual(list.summary, { paidCents: '5151', paidCount: 51 });
      const next = (await call('owner', 'GET', base + '?cursor=' + list.nextCursor)).json(); assert.deepEqual(next.summary, list.summary); assert.equal(new Set([...list.items, ...next.items].map(r => r.id)).size, 52);
      assert.equal((await call('owner', 'GET', base + '/candidates?q=Unique%20cost%20target')).json().items.length, 0);
    } finally { await admin.query(`DELETE FROM "MaintenanceCost" WHERE id LIKE 'cost-link-%'`); await admin.query(`DELETE FROM "LedgerEntry" WHERE id LIKE 'cost-page-%'`); }
  });
  await t.test('audit failures roll back link and unlink; database guards preserve source and link history', async () => {
    const fresh = await expense(), body = { entryId: fresh.id, expectedEntryVersion: 1, submissionKey: randomUUID() };
    await admin.query(`CREATE FUNCTION reject_cost_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'maintenance.cost.%' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_cost_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_cost_audit()`);
    try { assert.equal((await call('owner', 'POST', base, body)).statusCode, 500); assert.equal((await admin.query(`SELECT count(*)::int n FROM "MaintenanceCost" WHERE "entryId"=$1`, [fresh.id])).rows[0].n, 0); }
    finally { await admin.query(`DROP TRIGGER reject_cost_audit ON "AuditEvent"; DROP FUNCTION reject_cost_audit()`); }
    const result = await call('owner', 'POST', base, body); assert.equal(result.statusCode, 200, result.body); const linked = result.json();
    await assert.rejects(db.$executeRaw`DELETE FROM "MaintenanceCost" WHERE id=${linked.id}`, /permission denied/);
    await assert.rejects(db.$executeRaw`UPDATE "MaintenanceCost" SET "entryId"=${entry.id} WHERE id=${linked.id}`, /permission denied/);
    assert.deepEqual(await db.maintenanceCost.findMany(), []);
    await admin.query(`CREATE FUNCTION reject_unlink_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='maintenance.cost.unlinked' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_unlink_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_unlink_audit()`);
    try { assert.equal((await call('owner', 'POST', base + `/${linked.id}/unlink`, { expectedVersion: 1, reason: 'Correction' })).statusCode, 500); assert.equal((await admin.query(`SELECT "unlinkedAt" FROM "MaintenanceCost" WHERE id=$1`, [linked.id])).rows[0].unlinkedAt, null); }
    finally { await admin.query(`DROP TRIGGER reject_unlink_audit ON "AuditEvent"; DROP FUNCTION reject_unlink_audit()`); }
    assert.equal((await call('owner', 'POST', base + `/${linked.id}/unlink`, { expectedVersion: 1, reason: 'Correction' })).statusCode, 200);
    await assert.rejects(admin.query(`UPDATE "MaintenanceCost" SET "unlinkedAt"=NULL,"unlinkedById"=NULL,"unlinkReason"=NULL,version=3 WHERE id=$1`, [linked.id]), /immutable/);
  });
  await t.test('competing request links and expense correction never duplicate or overstate paid cost', async () => {
    const fresh = await expense();
    const results = await Promise.all([requestId, otherRequest].map((id, n) => call(n ? 'manager' : 'owner', 'POST', `/api/company/maintenance/${id}/costs`, { entryId: fresh.id, expectedEntryVersion: 1, submissionKey: randomUUID() })));
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
    const racing = await expense();
    const [linked, voided] = await Promise.all([call('owner', 'POST', base, { entryId: racing.id, expectedEntryVersion: 1, submissionKey: randomUUID() }), call('manager', 'POST', `/api/company/finances/${racing.id}/void`, { expectedVersion: 1, reason: 'Concurrent expense correction' })]);
    assert.ok([200, 409].includes(linked.statusCode), linked.body); assert.equal(voided.statusCode, 200, voided.body);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM "MaintenanceCost" c JOIN "LedgerEntry" e ON e.id=c."entryId" WHERE e.id=$1 AND e."voidedAt" IS NULL`, [racing.id])).rows[0].n, 0);
  });
  await t.test('revocation-leading cost replay rechecks current company permissions', async () => {
    const fresh = await expense(), body = { entryId: fresh.id, expectedEntryVersion: 1, submissionKey: randomUUID() };
    assert.equal((await call('manager', 'POST', base, body)).statusCode, 200);
    const leader = await admin.connect(); let pending;
    try {
      await leader.query('BEGIN'); await leader.query(`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id='manager'`);
      pending = call('manager', 'POST', base, body); let blocked = false;
      for (let i = 0; i < 200; i++) { if ((await admin.query(`SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%User%'`)).rows.length) { blocked = true; break; } await new Promise(r => setTimeout(r, 10)); }
      assert.ok(blocked); await leader.query(`UPDATE "CompanyMembership" SET role='staff' WHERE "userId"='manager'`); await leader.query('COMMIT'); assert.equal((await pending).statusCode, 403);
    } finally { await leader.query('ROLLBACK'); leader.release(); if (pending) await pending; await admin.query(`UPDATE "CompanyMembership" SET role='manager' WHERE "userId"='manager'`); }
    await admin.query(`UPDATE "Company" SET status='suspended' WHERE id='a'`);
    try { assert.equal((await call('manager', 'POST', base, body)).statusCode, 403); assert.equal((await call('owner', 'GET', base)).statusCode, 403); }
    finally { await admin.query(`UPDATE "Company" SET status='active' WHERE id='a'`); }
  });
  await t.test('real browser lost link and unlink responses replay one association and one audit', { skip: !process.env.TEST_MAINTENANCE_BROWSER_URL }, async () => {
    const fresh = await expense({ memo: 'Browser cost retry', amount: '35.50' }); const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage(); let loseLink = true, loseUnlink = true; const attempts = [];
      await page.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url()); const response = await app.inject({ method: req.method(), url: url.pathname + url.search, headers: { ...req.headers(), origin: 'https://app.test', cookie: '__Host-pf-session=token-manager' }, ...(req.postData() ? { payload: req.postData() } : {}) });
        if (req.method() === 'POST' && (url.pathname === base || url.pathname.endsWith('/unlink'))) {
          assert.equal(response.statusCode, 200, response.body); attempts.push(req.postDataJSON());
          if (url.pathname === base && loseLink) { loseLink = false; return route.abort('failed'); }
          if (url.pathname.endsWith('/unlink') && loseUnlink) { loseUnlink = false; return route.abort('failed'); }
        }
        await route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
      });
      await page.goto(process.env.TEST_MAINTENANCE_BROWSER_URL + `/company/maintenance/${requestId}`);
      await page.getByRole('button', { name: 'Link existing expense', exact: true }).click(); await page.getByLabel('Find paid expense').fill('Browser cost retry');
      await page.getByRole('radio', { name: new RegExp(fresh.reference) }).check(); await page.getByRole('button', { name: 'Link expense', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
      await page.getByRole('button', { name: 'Close', exact: true }).click(); await page.getByRole('button', { name: 'Link existing expense', exact: true }).click(); await page.getByRole('button', { name: 'Link expense', exact: true }).click(); await expect(page.getByText('Expense linked. Financial records are unchanged.', { exact: true })).toBeVisible(); assert.deepEqual(attempts[0], attempts[1]);
      await page.getByRole('button', { name: `Unlink expense ${fresh.reference}`, exact: true }).click(); await page.getByLabel('Unlink reason').fill('Wrong maintenance association.'); await page.getByRole('dialog').getByRole('button', { name: 'Unlink expense', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible(); await page.getByRole('dialog').getByRole('button', { name: 'Unlink expense', exact: true }).click(); await expect(page.getByText('Expense unlinked; its transaction and link history are retained.', { exact: true })).toBeVisible();
      assert.deepEqual(attempts[2], attempts[3]); assert.equal((await admin.query(`SELECT count(*)::int n FROM "MaintenanceCost" WHERE "entryId"=$1`, [fresh.id])).rows[0].n, 1); assert.equal((await call('owner', 'GET', `/api/company/finances?entryId=${fresh.id}`)).json().summary.expenseCents, '3550');
    } finally { await browser.close(); }
  });
}
