import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { newFixturePage } from './browser-fixture.mjs';

export async function maintenanceConversationCases(t, admin, db, call, app, requestId) {
  const residentPath = `/api/resident/maintenance/${requestId}/updates`;
  const managementPath = `/api/company/maintenance/${requestId}/updates`;
  const reply = { content: 'The tap still drips after the visit. Please arrange a follow-up.', submissionKey: randomUUID() };
  let replyId;
  await t.test('resident replies append once under concurrent retries and notify only management', async () => {
    const before = (await admin.query(`SELECT status,version FROM "MaintenanceRequest" WHERE id=$1`, [requestId])).rows[0];
    const results = await Promise.all(Array.from({ length: 3 }, () => call('resident', 'POST', residentPath, reply)));
    for (const result of results) assert.equal(result.statusCode, 200, result.body);
    assert.equal(new Set(results.map(result => result.json().id)).size, 1);
    replyId = results[0].json().id;
    assert.equal(results[0].json().author, 'You');
    for (const secret of ['createdById', 'submissionKey', 'submissionHash', 'authorType', 'resident@test.invalid']) assert.ok(!results[0].body.includes(secret), secret);
    assert.equal((await call('resident', 'POST', residentPath, { ...reply, submissionKey: reply.submissionKey.toUpperCase() })).json().id, replyId);
    assert.equal((await call('resident', 'POST', residentPath, { ...reply, content: 'Different message' })).statusCode, 409);
    const recorded = (await admin.query(`SELECT "authorType",visibility FROM "MaintenanceUpdate" WHERE id=$1`, [replyId])).rows[0];
    assert.deepEqual(recorded, { authorType: 'resident', visibility: 'resident' });
    assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='maintenance.reply.recorded' AND detail->>'updateId'=$1`, [replyId])).rows[0].n, 1);
    const events = (await admin.query(`SELECT id FROM "NotificationEvent" WHERE kind='maintenance.reply' AND "requestId"=$1 AND "eventKey"=$2`, [requestId, `maintenance.reply:${replyId}`])).rows;
    assert.equal(events.length, 1);
    const inbox = (await admin.query(`SELECT id,"userId",audience,version FROM "InboxNotification" WHERE "eventId"=$1 ORDER BY "userId"`, [events[0].id])).rows;
    assert.deepEqual(inbox.map(({ userId, audience }) => ({ userId, audience })), [{ userId: 'manager', audience: 'management' }, { userId: 'owner', audience: 'management' }]);
    for (const notification of inbox) {
      const read = await call(notification.userId, 'POST', `/api/account/notifications/${notification.id}`, { action: 'read', expectedVersion: notification.version, submissionKey: randomUUID(), status: 'all', type: 'maintenance', page: '1' });
      assert.equal(read.statusCode, 200, read.body);
      assert.equal(read.json().version, notification.version + 1);
    }
    await call('resident', 'POST', residentPath, reply);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM "InboxNotification" WHERE "eventId"=$1 AND "readAt" IS NULL`, [events[0].id])).rows[0].n, 0);
    assert.deepEqual((await admin.query(`SELECT status,version FROM "MaintenanceRequest" WHERE id=$1`, [requestId])).rows[0], before, 'a reply does not reopen or otherwise change request status');
    const management = (await call('manager', 'GET', managementPath)).json();
    assert.ok(management.items.some(item => item.id === replyId && item.author === 'Resident requester'));
    const resident = (await call('resident', 'GET', residentPath)).json();
    assert.equal(resident.items.find(item => item.id === replyId).author, 'You');
    assert.ok(resident.items.filter(item => item.id !== replyId).every(item => item.author === 'Property team'));
  });
  await t.test('reply fields, requester identity, staff and company boundaries are enforced before replay', async () => {
    for (const extra of [{ visibility: 'internal' }, { authorType: 'team' }, { createdById: 'owner' }, { companyId: 'b' }, { expectedVersion: 1 }])
      assert.equal((await call('resident', 'POST', residentPath, { ...reply, ...extra })).statusCode, 400);
    for (const content of ['', ' ', 'x'.repeat(4001), 'a\0b'])
      assert.equal((await call('resident', 'POST', residentPath, { ...reply, content })).statusCode, 400);
    for (const actor of ['owner', 'manager', 'staff', 'foreign']) assert.equal((await call(actor, 'POST', residentPath, reply)).statusCode, 403);
    assert.equal((await call('other', 'POST', residentPath, { ...reply, submissionKey: randomUUID() })).statusCode, 404);
    for (const headers of [{ origin: 'https://evil.test' }, { 'x-csrf-token': 'wrong' }, { 'x-company-id': 'b' }])
      assert.equal((await call('resident', 'POST', residentPath, reply, headers)).statusCode, 403);
    const management = (await admin.query(`SELECT id FROM "MaintenanceRequest" WHERE title='Boiler inspection'`)).rows[0].id;
    assert.equal((await call('resident', 'POST', `/api/resident/maintenance/${management}/updates`, reply)).statusCode, 404);
    // This slice has one resident request. Create a separate isolated source
    // directly, without publishing an unrelated intake notification, and remove
    // only those fixture records before the runner's exact-count assertions.
    const anotherId = `conversation-boundary-${randomUUID()}`, auditId = randomUUID();
    try {
      await admin.query(`INSERT INTO "MaintenanceRequest"(id,"companyId","propertyId","requesterId",title,description,priority,status,"updatedAt") VALUES($1,'a','home','resident','Conversation boundary fixture','Isolated request used only to test retry source identity.','normal','open',NOW())`, [anotherId]);
      await admin.query(`INSERT INTO "AuditEvent"(id,"companyId","targetId","actorId",action,detail,"requestId") VALUES($1,'a',$2,'resident','maintenance.created','{"source":"resident"}'::jsonb,'conversation-boundary-fixture')`, [auditId, anotherId]);
      const result = await call('resident', 'POST', `/api/resident/maintenance/${anotherId}/updates`, reply);
      assert.equal(result.statusCode, 409, result.body);
    } finally {
      await admin.query(`DELETE FROM "AuditEvent" WHERE id=$1`, [auditId]);
      await admin.query(`DELETE FROM "MaintenanceRequest" WHERE id=$1`, [anotherId]);
    }
  });
  await t.test('legacy resident sources notify the requester while explicit management sources cannot publish shared replies', async () => {
    const creation = (await admin.query(`SELECT id,detail FROM "AuditEvent" WHERE "companyId"='a' AND "targetId"=$1 AND action='maintenance.created' ORDER BY "createdAt",id LIMIT 1`, [requestId])).rows[0];
    assert.ok(creation);
    try {
      await admin.query(`UPDATE "AuditEvent" SET detail=COALESCE(detail,'{}'::jsonb)-'source' WHERE id=$1`, [creation.id]);
      const shared = await call('owner', 'POST', managementPath, { content: 'Legacy resident request follow-up fixture', visibility: 'resident', submissionKey: randomUUID() });
      assert.equal(shared.statusCode, 200, shared.body);
      const events = (await admin.query(`SELECT id FROM "NotificationEvent" WHERE kind='maintenance.update' AND "eventKey"=$1`, [`maintenance.update:${shared.json().id}`])).rows;
      assert.equal(events.length, 1);
      const recipients = (await admin.query(`SELECT "userId",audience FROM "InboxNotification" WHERE "eventId"=$1`, [events[0].id])).rows;
      assert.deepEqual(recipients, [{ userId: 'resident', audience: 'requester' }]);
      const management = (await admin.query(`SELECT id FROM "MaintenanceRequest" WHERE title='Boiler inspection'`)).rows[0].id;
      const before = (await admin.query(`SELECT count(*)::int n FROM "NotificationEvent" WHERE "requestId"=$1`, [management])).rows[0].n;
      const denied = await call('owner', 'POST', `/api/company/maintenance/${management}/updates`, { content: 'Must remain private', visibility: 'resident', submissionKey: randomUUID() });
      assert.equal(denied.statusCode, 409, denied.body);
      assert.equal((await admin.query(`SELECT count(*)::int n FROM "NotificationEvent" WHERE "requestId"=$1`, [management])).rows[0].n, before);
    } finally { await admin.query(`UPDATE "AuditEvent" SET detail=$2::jsonb WHERE id=$1`, [creation.id, creation.detail == null ? null : JSON.stringify(creation.detail)]); }
  });
  await t.test('visible timeline pagination never includes private notes, private cursors or author identities', async () => {
    const before = (await admin.query(`SELECT count(*)::int n FROM "MaintenanceUpdate" WHERE "requestId"=$1 AND visibility='resident'`, [requestId])).rows[0].n;
    try {
      await admin.query(`INSERT INTO "MaintenanceUpdate"(id,"companyId","requestId",content,visibility,"createdById","submissionKey","submissionHash","authorType","createdAt") SELECT 'conversation-history-'||audience||'-'||n,'a',$1,'Conversation history '||audience||' '||n,audience,CASE WHEN audience='resident' THEN 'resident' ELSE 'manager' END,'conversation-history-'||audience||'-'||n,'fixture',CASE WHEN audience='resident' THEN 'resident' ELSE 'team' END,'2031-01-01'::timestamp FROM generate_series(1,51) n CROSS JOIN (VALUES('internal'),('resident')) v(audience)`, [requestId]);
      const first = await call('resident', 'GET', residentPath);
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().items.length, 50); assert.ok(first.json().nextCursor);
      const second = (await call('resident', 'GET', residentPath + '?cursor=' + first.json().nextCursor)).json();
      assert.equal(new Set([...first.json().items, ...second.items].map(item => item.id)).size, before + 51);
      assert.equal(second.nextCursor, null);
      for (const secret of ['conversation-history-internal', 'manager@test.invalid', 'createdById', 'submissionHash', 'authorType']) assert.ok(!first.body.includes(secret), secret);
      assert.ok(first.json().items.every(item => item.author === 'You' && item.visibility === 'resident'));
      assert.equal((await call('resident', 'GET', residentPath + '?cursor=conversation-history-internal-51')).statusCode, 404);
      assert.equal((await call('resident', 'GET', residentPath + '?authorType=team')).statusCode, 400);
    } finally { await admin.query(`DELETE FROM "MaintenanceUpdate" WHERE id LIKE 'conversation-history-%'`); }
  });
  await t.test('reply visibility constraints and immutable runtime permissions retain source history', async () => {
    for (const sql of [`UPDATE "MaintenanceUpdate" SET "authorType"='team' WHERE id='${replyId}'`, `DELETE FROM "MaintenanceUpdate" WHERE id='${replyId}'`]) await assert.rejects(db.$executeRawUnsafe(sql), /permission denied/);
    await assert.rejects(admin.query(`INSERT INTO "MaintenanceUpdate"(id,"companyId","requestId",content,visibility,"createdById","submissionKey","submissionHash","authorType") VALUES ('invalid-resident-private','a',$1,'Must not exist','internal','resident','invalid-private','fixture','resident')`, [requestId]), /check constraint/);
    await db.$transaction(async tx => { await tx.$queryRaw`SELECT set_config('app.company_id','b',true)`; assert.equal(await tx.maintenanceUpdate.count({ where: { id: replyId } }), 0); });
  });
  await t.test('failed audit or notification rolls back reply, durable identity and inbox atomically', async () => {
    for (const target of ['audit', 'notification']) {
      const payload = { content: `Atomic ${target} reply fixture`, submissionKey: randomUUID() };
      const table = target === 'audit' ? 'AuditEvent' : 'NotificationEvent';
      const condition = target === 'audit' ? `NEW.action='maintenance.reply.recorded'` : `NEW.kind='maintenance.reply'`;
      await admin.query(`CREATE FUNCTION reject_conversation_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'fixture rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_conversation_record BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION reject_conversation_record()`);
      try {
        assert.equal((await call('resident', 'POST', residentPath, payload)).statusCode, 500);
        assert.equal((await admin.query(`SELECT count(*)::int n FROM "MaintenanceUpdate" WHERE "submissionKey"=$1`, [payload.submissionKey])).rows[0].n, 0);
      } finally { await admin.query(`DROP TRIGGER reject_conversation_record ON "${table}"; DROP FUNCTION reject_conversation_record()`); }
      const retry = await call('resident', 'POST', residentPath, payload); assert.equal(retry.statusCode, 200, retry.body);
      assert.equal((await admin.query(`SELECT count(*)::int n FROM "MaintenanceUpdate" WHERE "submissionKey"=$1`, [payload.submissionKey])).rows[0].n, 1);
    }
  });
  await t.test('assignment revocation leading a queued reply denies both new messages and durable replay', async () => {
    for (const payload of [reply, { ...reply, submissionKey: randomUUID() }]) {
      const leader = await admin.connect(); let queued;
      try {
        await leader.query('BEGIN'); await leader.query(`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id='resident'`);
        queued = call('resident', 'POST', residentPath, payload);
        let blocked = false;
        for (let i = 0; i < 200; i++) { if ((await admin.query(`SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%User%'`)).rows.length) { blocked = true; break; } await new Promise(resolve => setTimeout(resolve, 10)); }
        assert.ok(blocked); await leader.query(`DELETE FROM "ResidentPropertyAssignment" WHERE "userId"='resident'`); await leader.query('COMMIT');
        assert.equal((await queued).statusCode, 404);
      } finally {
        await leader.query('ROLLBACK'); leader.release(); if (queued) await queued;
        await admin.query(`INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','resident') ON CONFLICT DO NOTHING`);
      }
    }
  });
  await t.test('resident reply recovers the same committed submission after response loss and browser reload', { skip: !process.env.TEST_MAINTENANCE_BROWSER_URL }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await newFixturePage(browser); const attempts = []; let lose = true;
      await page.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url());
        const response = await app.inject({ method: req.method(), url: url.pathname + url.search, headers: { ...req.headers(), origin: 'https://app.test', cookie: '__Host-pf-session=token-resident' }, ...(req.postData() ? { payload: req.postData() } : {}) });
        if (req.method() === 'POST' && url.pathname === residentPath) { attempts.push(req.postDataJSON()); assert.equal(response.statusCode, 200, response.body); if (lose) { lose = false; return route.abort('failed'); } }
        await route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
      });
      await page.goto(process.env.TEST_MAINTENANCE_BROWSER_URL + `/resident/maintenance/${requestId}`);
      await page.getByLabel('Reply to your property team', { exact: true }).fill('Browser response-loss conversation fixture');
      await page.getByRole('button', { name: 'Send reply', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Request updates', exact: true }).getByRole('alert')).toBeVisible();
      await page.reload();
      await expect(page.getByLabel('Reply to your property team', { exact: true })).toHaveValue('Browser response-loss conversation fixture');
      await expect(page.getByLabel('Reply to your property team', { exact: true })).toHaveAttribute('readonly', '');
      await page.getByRole('button', { name: 'Retry original reply', exact: true }).click();
      await expect(page.getByText('Reply sent to your property team.', { exact: true }).first()).toBeVisible();
      assert.deepEqual(attempts[0], attempts[1]);
      assert.equal((await admin.query(`SELECT count(*)::int n FROM "MaintenanceUpdate" WHERE "submissionKey"=$1`, [attempts[0].submissionKey])).rows[0].n, 1);
      await expect(page.getByLabel('Reply to your property team', { exact: true })).toHaveValue('');
      assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('pf-maintenance-reply:')).length), 0);
    } finally { await browser.close(); }
  });
}
