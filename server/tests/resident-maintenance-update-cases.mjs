import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '../dist/sessions.js';

// Each source and actor belongs to a dedicated fictional company, keeping the
// older maintenance/count fixtures independent of replies and notifications.
export async function residentMaintenanceUpdateCases(t, admin, db, call) {
  const company = 'reply-company', foreignCompany = 'reply-foreign-company', home = 'reply-home';
  for (const id of [company, foreignCompany])
    await admin.query('INSERT INTO "Company"(id,name,"updatedAt") VALUES($1,$1,NOW())', [id]);
  for (const [suffix, role, scope, platform] of [
    ['owner', 'owner', company, null], ['manager', 'manager', company, null],
    ['resident', 'resident', company, null], ['other', 'resident', company, null],
    ['staff', 'staff', company, null], ['foreign', 'resident', foreignCompany, null],
    ['support', null, null, 'support'],
  ]) {
    const id = `reply-${suffix}`;
    await admin.query('INSERT INTO "User"(id,email,name,"emailVerified","platformRole","updatedAt") VALUES($1,$2,$3,true,$4,NOW())',
      [id, `${id}@test.invalid`, suffix === 'resident' ? 'Fictional Resident Requester' : `Fictional ${suffix}`, platform]);
    await db.identity.create({ data: { issuer: 'https://unused.auth0.com/', subject: id, userId: id } });
    if (role) await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,$2,$3,NOW())', [id, scope, role]);
    await db.session.create({ data: { tokenHash: digest(`token-${id}`), csrfToken: 'csrf', userId: id,
      expiresAt: new Date(Date.now() + 3600000), idleExpiresAt: new Date(Date.now() + 3600000) } });
  }
  for (const [id, scope] of [[home, company], ['reply-foreign-home', foreignCompany]])
    await admin.query('INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES($1,$1,\'Fictional street\',\'Town\',\'NY\',\'12345\',$2,NOW())', [id, scope]);
  for (const [property, user, scope] of [[home, 'reply-resident', company], [home, 'reply-other', company], ['reply-foreign-home', 'reply-foreign', foreignCompany]])
    await admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES($1,$2,$3)', [scope, property, user]);
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  const create = (title, user = 'reply-resident', propertyId = home) => call(user, 'POST', '/api/resident/maintenance', {
    title, description: 'Fictional requester-owned maintenance source', priority: 'normal', propertyId, submissionKey: randomUUID(),
  }).then(ok);
  const source = await create('Fictional resident reply source');
  const second = await create('Fictional second requester source');
  const other = await create('Fictional household member source', 'reply-other');
  const foreign = await create('Fictional foreign source', 'reply-foreign', 'reply-foreign-home');
  const endpoint = `/api/resident/maintenance/${source.id}/updates`, management = `/api/company/maintenance/${source.id}/updates`;
  const post = payload => call('reply-resident', 'POST', endpoint, payload);
  const payload = (content = 'The fictional repair still needs attention.') => ({ content, submissionKey: randomUUID() });
  const snapshot = async () => (await admin.query(`SELECT status,version,title,description,priority,"unitId","assigneeId","executionStatus","updatedAt" FROM "MaintenanceRequest" WHERE id=$1`, [source.id])).rows[0];
  const counts = async () => (await admin.query(`SELECT
    (SELECT count(*)::int FROM "MaintenanceUpdate" WHERE "companyId"=$1) updates,
    (SELECT count(*)::int FROM "AuditEvent" WHERE "companyId"=$1 AND action IN ('maintenance.update.recorded','maintenance.reply.recorded')) audits,
    (SELECT count(*)::int FROM "NotificationEvent" WHERE "companyId"=$1) events,
    (SELECT count(*)::int FROM "InboxNotification" WHERE "companyId"=$1) deliveries`, [company])).rows[0];
  // Fixture administration owns temporary policy setup/cleanup. The runtime
  // deliberately has no subscription DELETE privilege.
  const policy = overrides => admin.query('INSERT INTO "CompanySubscription"("companyId","updatedById","featureOverrides","updatedAt") VALUES($1,\'reply-owner\',$2::jsonb,NOW()) ON CONFLICT("companyId") DO UPDATE SET "featureOverrides"=EXCLUDED."featureOverrides","updatedAt"=NOW()', [company, JSON.stringify(overrides)]);
  const clearPolicy = () => admin.query('DELETE FROM "CompanySubscription" WHERE "companyId"=$1', [company]);
  let recorded, original;

  await t.test('requester reply remains shared and immutable without changing resolved work or exposing team notes', async () => {
    ok(await call('reply-manager', 'PATCH', `/api/company/maintenance/${source.id}`, { status: 'resolved', expectedVersion: 1 }));
    const privateNote = ok(await call('reply-manager', 'POST', management, { ...payload('PRIVATE_REPLY_FIXTURE_NOTE'), visibility: 'internal' }));
    const team = ok(await call('reply-manager', 'POST', management, { ...payload('Fictional management shared update'), visibility: 'resident' }));
    const before = await snapshot();
    original = payload('Fictional resident reply on resolved work');
    recorded = ok(await post(original));
    assert.equal(recorded.content, original.content);
    assert.equal(recorded.visibility, 'resident');
    assert.equal(recorded.author, 'You');
    assert.deepEqual(Object.keys(recorded).sort(), ['id', 'content', 'visibility', 'createdAt', 'author'].sort());
    assert.deepEqual(await snapshot(), before, 'a shared reply cannot reopen, resolve, reprioritize or invalidate a work-order draft');
    const own = ok(await call('reply-resident', 'GET', endpoint));
    assert.equal(own.items.find(row => row.id === recorded.id).author, 'You');
    assert.equal(own.items.find(row => row.id === team.id).author, 'Property team');
    for (const secret of [privateNote.id, privateNote.content, 'reply-manager', 'Fictional manager', 'reply-resident', 'Fictional Resident Requester', '@test.invalid', 'createdById', 'submissionKey', 'submissionHash'])
      assert.ok(!JSON.stringify(own).includes(secret), secret);
    const managers = ok(await call('reply-manager', 'GET', management));
    assert.equal(managers.items.find(row => row.id === recorded.id).author, 'Fictional Resident Requester');
    assert.equal(managers.items.find(row => row.id === recorded.id).authorType, 'requester');
    assert.equal(managers.items.find(row => row.id === team.id).authorType, 'team');
    const audit = (await admin.query(`SELECT "actorId",detail FROM "AuditEvent" WHERE "companyId"=$1 AND action='maintenance.reply.recorded' AND detail->>'updateId'=$2`, [company, recorded.id])).rows;
    assert.equal(audit.length, 1); assert.equal(audit[0].actorId, 'reply-resident');
    assert.ok(!JSON.stringify(audit).includes(original.content), 'free-text replies stay out of copied audit metadata');
    assert.deepEqual(await db.maintenanceUpdate.findMany({ where: { id: recorded.id } }), []);
    for (const statement of ['UPDATE "MaintenanceUpdate" SET content=\'changed\' WHERE id=$1', 'DELETE FROM "MaintenanceUpdate" WHERE id=$1'])
      await assert.rejects(db.$executeRawUnsafe(statement, recorded.id), /permission denied/);
  });

  await t.test('CSRF, requester identity, household, company and strict payload boundaries deny writes without side effects', async () => {
    const before = await counts(), valid = payload();
    for (const value of [{ ...valid, content: '' }, { ...valid, content: ' ' }, { ...valid, content: 'x'.repeat(4001) }, { ...valid, content: 'x\0y' }, { ...valid, content: 42 },
      { ...valid, submissionKey: 'invalid' }, { ...valid, submissionKey: undefined }, { ...valid, visibility: 'internal' }, { ...valid, visibility: 'resident' },
      { ...valid, createdById: 'reply-owner' }, { ...valid, author: 'Property team' }, { ...valid, status: 'open' }, { ...valid, companyId: foreignCompany }, { ...valid, expectedVersion: 1 }])
      assert.equal((await post(value)).statusCode, 400, JSON.stringify(value));
    assert.equal((await call(null, 'POST', endpoint, valid)).statusCode, 401);
    for (const actor of ['reply-owner', 'reply-manager', 'reply-staff', 'reply-support'])
      assert.equal((await call(actor, 'POST', endpoint, valid)).statusCode, 403, actor);
    for (const actor of ['reply-other', 'reply-foreign'])
      assert.equal((await call(actor, 'POST', endpoint, valid)).statusCode, 404, actor);
    for (const id of [other.id, foreign.id, 'missing-reply-source'])
      assert.equal((await call('reply-resident', 'POST', `/api/resident/maintenance/${id}/updates`, valid)).statusCode, 404, id);
    for (const headers of [{ origin: 'https://evil.test' }, { 'x-csrf-token': '' }, { 'x-csrf-token': 'wrong' }, { 'x-company-id': foreignCompany }])
      assert.equal((await call('reply-resident', 'POST', endpoint, valid, headers)).statusCode, 403);
    assert.deepEqual(await counts(), before);
  });

  await t.test('concurrent commits and lost-response retries retain one reply, audit and fixed management-only notification', async () => {
    const draft = payload('Fictional durable requester retry');
    const attempts = await Promise.all(Array.from({ length: 3 }, () => post(draft)));
    const rows = attempts.map(ok); assert.equal(new Set(rows.map(row => row.id)).size, 1);
    const row = rows[0];
    assert.equal(ok(await post({ ...draft, submissionKey: draft.submissionKey.toUpperCase() })).id, row.id);
    ok(await call('reply-manager', 'PATCH', `/api/company/maintenance/${source.id}`, { status: 'open', expectedVersion: (await snapshot()).version }));
    assert.equal(ok(await post(draft)).id, row.id, 'retry after a lost committed response acknowledges the retained reply');
    assert.equal((await post({ ...draft, content: 'Changed after commit' })).statusCode, 409);
    assert.equal((await call('reply-resident', 'POST', `/api/resident/maintenance/${second.id}/updates`, draft)).statusCode, 409);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "MaintenanceUpdate" WHERE "companyId"=$1 AND "submissionKey"=$2', [company, draft.submissionKey])).rows[0].n, 1);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE "companyId"=$1 AND action='maintenance.reply.recorded' AND detail->>'updateId'=$2`, [company, row.id])).rows[0].n, 1);
    const events = (await admin.query('SELECT id,kind,"actorId" FROM "NotificationEvent" WHERE "companyId"=$1 AND "eventKey"=$2', [company, `maintenance.reply:${row.id}`])).rows;
    assert.equal(events.length, 1); assert.equal(events[0].kind, 'maintenance.reply'); assert.equal(events[0].actorId, 'reply-resident');
    const recipients = (await admin.query('SELECT "userId",audience FROM "InboxNotification" WHERE "companyId"=$1 AND "eventId"=$2 ORDER BY "userId"', [company, events[0].id])).rows;
    assert.deepEqual(recipients, [{ userId: 'reply-manager', audience: 'management' }, { userId: 'reply-owner', audience: 'management' }]);
    for (const actor of ['reply-owner', 'reply-manager']) {
      const inbox = ok(await call(actor, 'GET', '/api/account/notifications'));
      const notice = inbox.items.find(item => item.title === 'Resident replied to maintenance request');
      assert.ok(notice); assert.equal(notice.sourceTitle, source.title);
      for (const secret of [draft.content, 'PRIVATE_REPLY_FIXTURE_NOTE', draft.submissionKey, 'Fictional Resident Requester']) assert.ok(!JSON.stringify(inbox).includes(secret), secret);
    }
    const residentInbox = ok(await call('reply-resident', 'GET', '/api/account/notifications'));
    assert.ok(!residentInbox.items.some(item => item.title === 'Resident replied to maintenance request'), 'reply authors never receive a self echo');
  });

  await t.test('stored author provenance survives role changes and old team rows never become resident replies', async () => {
    const legacyId = randomUUID(), legacyKey = randomUUID();
    await admin.query('INSERT INTO "MaintenanceUpdate"(id,"companyId","requestId",content,visibility,"createdById","submissionKey","submissionHash") VALUES($1,$2,$3,\'Fictional legacy team update\',\'resident\',\'reply-resident\',$4,\'fixture\')', [legacyId, company, source.id, legacyKey]);
    assert.equal((await admin.query('SELECT "authorType" FROM "MaintenanceUpdate" WHERE id=$1', [legacyId])).rows[0].authorType, 'team');
    let team;
    const teamDraft = payload('Fictional team note by a former resident');
    try {
      await admin.query('UPDATE "CompanyMembership" SET role=\'manager\' WHERE "userId"=\'reply-resident\'');
      team = ok(await call('reply-resident', 'POST', management, { ...teamDraft, visibility: 'resident' }));
      const oldKeyAtNewEndpoint = await call('reply-resident', 'POST', management, { ...original, visibility: 'resident' });
      assert.equal(oldKeyAtNewEndpoint.statusCode, 409, oldKeyAtNewEndpoint.body);
      const rows = ok(await call('reply-resident', 'GET', management)).items;
      assert.equal(rows.find(row => row.id === recorded.id).authorType, 'requester');
      assert.equal(rows.find(row => row.id === team.id).authorType, 'team');
      assert.equal(rows.find(row => row.id === legacyId).authorType, 'team');
    } finally { await admin.query('UPDATE "CompanyMembership" SET role=\'resident\' WHERE "userId"=\'reply-resident\''); }
    const visible = ok(await call('reply-resident', 'GET', endpoint)).items;
    assert.equal(visible.find(row => row.id === recorded.id).author, 'You');
    for (const id of [team.id, legacyId]) assert.equal(visible.find(row => row.id === id).author, 'Property team');
    assert.equal((await post(teamDraft)).statusCode, 409, 'a committed team update cannot replay as a resident reply with the same actor/key');
    for (const [type, visibility] of [['requester', 'internal'], ['invented', 'resident']])
      await assert.rejects(admin.query('INSERT INTO "MaintenanceUpdate"(id,"companyId","requestId",content,visibility,"createdById","submissionKey","submissionHash","authorType") VALUES($1,$2,$3,\'Invalid author provenance\',$4,\'reply-resident\',$5,\'fixture\',$6)', [randomUUID(), company, source.id, visibility, randomUUID(), type]), /check constraint/);
    await assert.rejects(admin.query('UPDATE "MaintenanceRequest" SET "requesterId"=\'reply-other\' WHERE id=$1', [source.id]), /original maintenance requester is immutable/);
    assert.equal((await admin.query('SELECT "requesterId" FROM "MaintenanceRequest" WHERE id=$1', [source.id])).rows[0].requesterId, 'reply-resident');
    await assert.rejects(db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.company_id', ${company}, true)`;
      await tx.maintenanceUpdate.create({ data: { companyId: company, requestId: source.id, content: 'Invalid actor claiming requester authorship', visibility: 'resident',
        authorType: 'requester', createdById: 'reply-other', submissionKey: randomUUID(), submissionHash: 'fixture' } });
    }), /requester reply must belong to the original request author/);
    await assert.rejects(db.$executeRawUnsafe('UPDATE "MaintenanceUpdate" SET "authorType"=\'team\' WHERE id=$1', recorded.id), /permission denied/);
    const managementSource = ok(await call('reply-manager', 'POST', '/api/company/maintenance', {
      propertyId: home, title: 'Fictional management-origin source', description: 'Fictional source that has never been resident intake', priority: 'normal', submissionKey: randomUUID(),
    }));
    const originalTeamDraft = payload('Fictional original internal management note');
    ok(await call('reply-manager', 'POST', `/api/company/maintenance/${managementSource.id}/updates`, { ...originalTeamDraft, visibility: 'internal' }));
    const beforeDeniedOrigin = await counts();
    try {
      await admin.query('UPDATE "CompanyMembership" SET role=\'resident\' WHERE "userId"=\'reply-manager\'');
      await admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES($1,$2,\'reply-manager\')', [company, home]);
      for (const draft of [originalTeamDraft, payload('Fictional new reply to management-origin source')]) {
        const denied = await call('reply-manager', 'POST', `/api/resident/maintenance/${managementSource.id}/updates`, draft);
        assert.equal(denied.statusCode, 409, denied.body);
        assert.equal(denied.json().code, 'NO_RESIDENT_REQUESTER', 'original source provenance is checked before an old team receipt');
      }
      assert.deepEqual(await counts(), beforeDeniedOrigin);
    } finally {
      await admin.query('UPDATE "CompanyMembership" SET role=\'manager\' WHERE "userId"=\'reply-manager\'');
      await admin.query('DELETE FROM "ResidentPropertyAssignment" WHERE "userId"=\'reply-manager\'');
    }
  });

  await t.test('fresh membership, assignment, company, feature and impersonation policy applies before replay', async () => {
    const before = await counts();
    const restoreAssignment = () => admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES($1,$2,\'reply-resident\') ON CONFLICT DO NOTHING', [company, home]);
    const mutations = [
      ['UPDATE "CompanyMembership" SET status=\'disabled\' WHERE "userId"=\'reply-resident\'', 'UPDATE "CompanyMembership" SET status=\'active\' WHERE "userId"=\'reply-resident\'', 403],
      ['UPDATE "CompanyMembership" SET role=\'staff\' WHERE "userId"=\'reply-resident\'', 'UPDATE "CompanyMembership" SET role=\'resident\' WHERE "userId"=\'reply-resident\'', 403],
      ['UPDATE "User" SET status=\'disabled\' WHERE id=\'reply-resident\'', 'UPDATE "User" SET status=\'active\' WHERE id=\'reply-resident\'', 403],
      ['UPDATE "User" SET "emailVerified"=false WHERE id=\'reply-resident\'', 'UPDATE "User" SET "emailVerified"=true WHERE id=\'reply-resident\'', 403],
      ['DELETE FROM "ResidentPropertyAssignment" WHERE "userId"=\'reply-resident\'', null, 404],
      [`UPDATE "Company" SET status='suspended' WHERE id='${company}'`, `UPDATE "Company" SET status='active' WHERE id='${company}'`, 403],
    ];
    for (const [change, restore, expected] of mutations) {
      try { await admin.query(change); for (const draft of [original, payload()]) assert.equal((await post(draft)).statusCode, expected, change); }
      finally { if (restore) await admin.query(restore); else await restoreAssignment(); }
    }
    for (const feature of ['maintenance', 'resident_portal']) for (const mode of ['read_only', 'disabled']) {
      try {
        await policy({ [feature]: mode });
        for (const draft of [original, payload()]) assert.equal((await post(draft)).statusCode, 403, `${feature}:${mode}`);
        assert.equal((await call('reply-resident', 'GET', endpoint)).statusCode, mode === 'read_only' ? 200 : 403);
      } finally { await clearPolicy(); }
    }
    ok(await call('reply-support', 'POST', '/api/impersonation', { userId: 'reply-resident', reason: 'Fictional resident reply access test' }));
    try {
      const bootstrap = ok(await call('reply-support', 'GET', '/api/bootstrap'));
      const denied = await call('reply-support', 'POST', endpoint, original, { 'x-csrf-token': bootstrap.csrfToken, 'x-impersonation-id': bootstrap.impersonation.contextId });
      assert.equal(denied.statusCode, 403, denied.body); assert.equal(denied.json().code, 'IMPERSONATION_READ_ONLY');
    } finally {
      const session = await db.session.findUniqueOrThrow({ where: { tokenHash: digest('token-reply-support') } });
      ok(await call('reply-support', 'DELETE', '/api/impersonation', undefined, { 'x-csrf-token': session.csrfToken }));
    }
    assert.deepEqual(await counts(), before);
  });

  await t.test('failed audit and failed inbox publication roll back reply and durable retry identity together', async () => {
    for (const table of ['AuditEvent', 'InboxNotification']) {
      const draft = payload(`Fictional atomic ${table} reply`), before = await counts();
      await admin.query(`CREATE FUNCTION reject_resident_reply() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${table === 'AuditEvent' ? "IF NEW.action='maintenance.reply.recorded' THEN RAISE EXCEPTION 'fixture reply audit failure'; END IF;" : "RAISE EXCEPTION 'fixture reply notification failure';"} RETURN NEW; END $$; CREATE TRIGGER reject_resident_reply BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION reject_resident_reply()`);
      try { assert.equal((await post(draft)).statusCode, 500); assert.deepEqual(await counts(), before); }
      finally { await admin.query(`DROP TRIGGER reject_resident_reply ON "${table}"; DROP FUNCTION reject_resident_reply()`); }
      assert.equal(ok(await post(draft)).content, draft.content, 'an uncommitted identity remains safely retryable');
    }
  });

  await t.test('optional notifications and fixed eligible recipients never block replies or backfill on replay', async () => {
    for (const mode of ['disabled', 'read_only']) {
      const draft = payload(`Fictional reply with notifications ${mode}`);
      const before = await counts();
      try { await policy({ notifications: mode }); ok(await post(draft)); }
      finally { await clearPolicy(); }
      ok(await post(draft));
      const after = await counts();
      assert.equal(after.updates, before.updates + 1); assert.equal(after.audits, before.audits + 1);
      assert.equal(after.events, before.events); assert.equal(after.deliveries, before.deliveries);
    }
    const draft = payload('Fictional fixed management recipients'); let row;
    try {
      await admin.query('UPDATE "CompanyMembership" SET status=\'disabled\' WHERE "userId"=\'reply-manager\'');
      row = ok(await post(draft));
    } finally { await admin.query('UPDATE "CompanyMembership" SET status=\'active\' WHERE "userId"=\'reply-manager\''); }
    ok(await post(draft));
    const recipients = (await admin.query('SELECT n."userId" FROM "InboxNotification" n JOIN "NotificationEvent" e ON e.id=n."eventId" WHERE e."companyId"=$1 AND e."eventKey"=$2', [company, `maintenance.reply:${row.id}`])).rows;
    assert.deepEqual(recipients, [{ userId: 'reply-owner' }], 'restored management access never backfills an existing reply notice');
  });

  await t.test('revocation committed ahead of queued new replies and replay invalidates the older authorization snapshot', async () => {
    for (const [draft, revoke, expected] of [
      [original, 'DELETE FROM "ResidentPropertyAssignment" WHERE "userId"=\'reply-resident\'', 404],
      [payload('Fictional queued revoked reply'), 'DELETE FROM "ResidentPropertyAssignment" WHERE "userId"=\'reply-resident\'', 404],
      [original, 'UPDATE "CompanyMembership" SET status=\'disabled\' WHERE "userId"=\'reply-resident\'', 403],
      [payload('Fictional queued demoted reply'), 'UPDATE "CompanyMembership" SET role=\'staff\' WHERE "userId"=\'reply-resident\'', 403],
    ]) {
      const leader = await admin.connect(); let pending;
      const before = await counts();
      try {
        await leader.query('BEGIN'); await leader.query('UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=\'reply-resident\'');
        pending = post(draft);
        let blocked = false;
        for (let attempt = 0; attempt < 200; attempt++) {
          if ((await admin.query("SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%User%'")).rows.length) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(blocked, 'reply reached the existing actor authorization fence');
        await leader.query(revoke);
        await leader.query('COMMIT'); assert.equal((await pending).statusCode, expected);
        assert.deepEqual(await counts(), before);
      } finally {
        await leader.query('ROLLBACK'); leader.release(); if (pending) await pending;
        await admin.query('UPDATE "CompanyMembership" SET status=\'active\',role=\'resident\' WHERE "userId"=\'reply-resident\'');
        await admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES($1,$2,\'reply-resident\') ON CONFLICT DO NOTHING', [company, home]);
      }
    }
  });
}
