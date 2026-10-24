import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '../dist/sessions.js';
import { publishNotification } from '../dist/notification-events.js';

export async function notificationPreferenceCases(t, admin, db, call) {
  const company = 'pref-company', foreignCompany = 'pref-foreign-company', home = 'pref-home';
  const endpoint = '/api/account/notifications/preferences';
  const enabled = { maintenanceEnabled: true, workEnabled: true, inspectionsEnabled: true, agreementsEnabled: true };
  const disabled = Object.fromEntries(Object.keys(enabled).map(key => [key, false]));
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  for (const id of [company, foreignCompany])
    await admin.query('INSERT INTO "Company"(id,name,"updatedAt") VALUES($1,$1,NOW())', [id]);
  for (const [suffix, role, scope, platform] of [
    ['owner', 'owner', company, null], ['manager', 'manager', company, null], ['staff', 'staff', company, null],
    ['resident', 'resident', company, null], ['other', 'resident', company, null], ['mover', 'resident', company, null], ['foreign', 'manager', foreignCompany, null], ['support', null, null, 'support'],
  ]) {
    const id = `pref-${suffix}`;
    await admin.query('INSERT INTO "User"(id,email,name,"emailVerified","platformRole","updatedAt") VALUES($1,$2,$1,true,$3,NOW())', [id, `${id}@test.invalid`, platform]);
    await db.identity.create({ data: { issuer: 'https://unused.auth0.com/', subject: id, userId: id } });
    if (role) await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"maintenanceExecution","staffPropertyScope","updatedAt") VALUES($1,$2,$3,$4,\'selected\',NOW())', [id, scope, role, role === 'staff']);
    await db.session.create({ data: { userId: id, tokenHash: digest(`token-${id}`), csrfToken: 'csrf', expiresAt: new Date(Date.now() + 3600000), idleExpiresAt: new Date(Date.now() + 3600000) } });
  }
  await admin.query('INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES($1,$1,\'Fictional street\',\'Town\',\'NY\',\'12345\',$2,NOW())', [home, company]);
  for (const user of ['pref-resident', 'pref-other'])
    await admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES($1,$2,$3)', [company, home, user]);
  await admin.query('INSERT INTO "StaffPropertyAccess"("companyId","propertyId","userId") VALUES($1,$2,\'pref-staff\')', [company, home]);
  await admin.query('INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") VALUES(\'pref-unit\',$1,$2,\'Fictional suite\',\'pref-owner\',\'pref-unit\',\'fixture\',NOW())', [company, home]);
  await admin.query('INSERT INTO "Lease"(id,"companyId","propertyId","unitId","createdById","residentId","startsOn","rentCents",status,"submissionKey","submissionHash","updatedAt") VALUES(\'pref-lease\',$1,$2,\'pref-unit\',\'pref-owner\',\'pref-resident\',\'2026-10-01\',100000,\'active\',\'pref-lease\',\'fixture\',NOW())', [company, home]);
  const current = user => call(user, 'GET', endpoint).then(ok);
  const save = (user, settings, expectedVersion, submissionKey = randomUUID(), expectedCompanyId = company) => call(user, 'POST', endpoint, { ...settings, expectedVersion, expectedCompanyId, submissionKey });
  const choose = async (user, settings) => {
    const opening = await current(user);
    return ok(await save(user, settings, opening.version, randomUUID(), opening.companyId));
  };
  const inbox = user => call(user, 'GET', '/api/account/notifications').then(ok);
  const counts = async () => (await admin.query(`SELECT
    (SELECT count(*)::int FROM "NotificationPreference" WHERE "companyId"=$1) preferences,
    (SELECT count(*)::int FROM "NotificationPreferenceAction" WHERE "companyId"=$1) actions,
    (SELECT count(*)::int FROM "AuditEvent" WHERE "companyId"=$1 AND action='notification.preferences.saved') audits`, [company])).rows[0];
  const intake = async (label, actor = 'pref-resident') => {
    const path = actor === 'pref-resident' ? '/api/resident/maintenance' : '/api/company/maintenance';
    const payload = { propertyId: home, title: `Fictional preference ${label}`, description: 'Private fictional source text', priority: 'normal', submissionKey: randomUUID() };
    const row = ok(await call(actor, 'POST', path, payload));
    return { row, actor, path, payload, kind: 'maintenance.created', sourceId: row.id, sourceType: 'maintenance' };
  };
  const workAction = async (requestId, actor, action, extra = {}) => {
    const version = (await admin.query('SELECT version FROM "MaintenanceRequest" WHERE id=$1', [requestId])).rows[0].version;
    const path = `/api/company/work-orders/${requestId}/actions`, payload = { action, note: 'Private fictional work progress', expectedVersion: version, submissionKey: randomUUID(), ...extra };
    ok(await call(actor, 'POST', path, payload));
    return { actor, path, payload, kind: action === 'submit' ? 'work.review' : 'work.assigned', sourceId: requestId, sourceType: 'work' };
  };
  const leaseBase = '/api/company/leases/pref-lease';
  let document;
  const families = async label => {
    const maintenance = await intake(`${label} maintenance`);
    const work = await intake(`${label} work`, 'pref-owner');
    await workAction(work.row.id, 'pref-owner', 'assign', { assigneeId: 'pref-staff' });
    await workAction(work.row.id, 'pref-staff', 'accept');
    const completed = await workAction(work.row.id, 'pref-staff', 'submit');
    const inspection = ok(await call('pref-owner', 'POST', leaseBase + '/inspections', {
      kind: 'move_in', inspectedOn: '2026-10-01', baselineRevisionId: null,
      items: [{ key: randomUUID(), area: 'Kitchen', item: `Fictional ${label} tap`, condition: 'good', notes: 'Private inspection notes', evidenceVersionIds: [] }], submissionKey: randomUUID(),
    }));
    const inspectionPath = leaseBase + `/inspections/${inspection.inspectionId}`;
    const inspectionPayload = { action: 'submit', expectedVersion: inspection.version, submissionKey: randomUUID() };
    ok(await call('pref-owner', 'POST', inspectionPath, inspectionPayload));
    if (!document) {
      document = ok(await call('pref-owner', 'POST', leaseBase + '/documents', { title: 'Fictional preference original', filename: 'preference.txt', mediaType: 'text/plain', contentBase64: Buffer.from('Fictional unsigned original').toString('base64'), submissionKey: randomUUID() }));
      ok(await call('pref-owner', 'POST', `${leaseBase}/documents/${document.documentId}/versions/${document.versionId}/scan`, {}));
    }
    const context = ok(await call('pref-owner', 'GET', leaseBase + '/agreements/context'));
    const agreement = ok(await call('pref-owner', 'POST', leaseBase + '/agreements', {
      title: `Fictional ${label} agreement`, kind: 'lease', notes: 'Private agreement preparation', documentVersionIds: [document.versionId], partyIds: [context.leaseholders[0].id], companySignerId: 'pref-owner', submissionKey: randomUUID(),
    }));
    const agreementPath = leaseBase + `/agreements/${agreement.agreementId}`;
    const agreementPayload = { action: 'submit', expectedVersion: agreement.version, confirmed: true, submissionKey: randomUUID() };
    ok(await call('pref-owner', 'POST', agreementPath, agreementPayload));
    return [maintenance, completed,
      { actor: 'pref-owner', path: inspectionPath, payload: inspectionPayload, kind: 'inspection.review', sourceId: inspection.inspectionId, sourceType: 'inspections' },
      { actor: 'pref-owner', path: agreementPath, payload: agreementPayload, kind: 'agreement.review', sourceId: agreement.agreementId, sourceType: 'agreements' }];
  };
  const event = async source => {
    const column = source.sourceType === 'inspections' ? 'inspectionId' : source.sourceType === 'agreements' ? 'agreementId' : 'requestId';
    const rows = (await admin.query(`SELECT id FROM "NotificationEvent" WHERE "companyId"=$1 AND kind=$2 AND "${column}"=$3`, [company, source.kind, source.sourceId])).rows;
    assert.equal(rows.length, 1, `${source.kind} must retain exactly one source event`); return rows[0].id;
  };
  const recipients = async source => (await admin.query('SELECT "userId" FROM "InboxNotification" WHERE "companyId"=$1 AND "eventId"=$2 ORDER BY "userId"', [company, await event(source)])).rows.map(row => row.userId);
  const settingFor = { maintenance: 'maintenanceEnabled', work: 'workEnabled', inspections: 'inspectionsEnabled', agreements: 'agreementsEnabled' };

  await t.test('missing preferences are all-enabled virtual defaults and only exact own account/company input is accepted', async () => {
    const before = await counts();
    for (const user of ['pref-owner', 'pref-manager', 'pref-staff', 'pref-resident', 'pref-other', 'pref-mover', 'pref-foreign'])
      assert.deepEqual(await current(user), { companyId: user === 'pref-foreign' ? foreignCompany : company, version: 0, settings: enabled });
    assert.deepEqual(await counts(), before, 'reading defaults creates no settings, receipt or audit');
    assert.equal((await call(null, 'GET', endpoint)).statusCode, 401);
    assert.equal((await call('pref-support', 'GET', endpoint)).statusCode, 403);
    assert.equal((await call('pref-manager', 'GET', endpoint, undefined, { 'x-company-id': foreignCompany })).statusCode, 403);
    for (const query of ['?userId=pref-other', '?companyId=' + foreignCompany, '?cursor=other'])
      assert.equal((await call('pref-manager', 'GET', endpoint + query)).statusCode, 400);
    const valid = { ...enabled, expectedVersion: 0, expectedCompanyId: company, submissionKey: randomUUID() };
    for (const patch of [{ maintenanceEnabled: 'false' }, { workEnabled: undefined }, { inspectionsEnabled: null }, { agreementsEnabled: 1 }, { userId: 'pref-other' }, { companyId: foreignCompany }, { expectedVersion: -1 }, { expectedVersion: undefined }, { expectedCompanyId: undefined }, { expectedCompanyId: 42 }, { submissionKey: 'invalid' }, { submissionKey: undefined }])
      assert.equal((await call('pref-manager', 'POST', endpoint, { ...valid, ...patch })).statusCode, 400);
    for (const headers of [{ origin: 'https://evil.test' }, { 'x-csrf-token': '' }, { 'x-csrf-token': 'wrong' }, { 'x-company-id': foreignCompany }])
      assert.equal((await call('pref-manager', 'POST', endpoint, valid, headers)).statusCode, 403);
    assert.deepEqual(await counts(), before);
    const first = ok(await save('pref-other', enabled, 0));
    assert.equal(first.version, 1); assert.equal(first.receipt.changed, false);
  });

  await t.test('versioned preferences retain exact old and no-op receipts without overwriting newer choices; history pages are complete and private', async () => {
    const firstSettings = { ...enabled, maintenanceEnabled: false }, key = randomUUID();
    const first = ok(await save('pref-manager', firstSettings, 0, key));
    assert.equal(first.version, 1); assert.equal(first.receipt.appliedVersion, 1); assert.equal(first.receipt.changed, true);
    const secondSettings = { ...enabled, workEnabled: false };
    const second = ok(await save('pref-manager', secondSettings, 1)); assert.equal(second.version, 2);
    const beforeReplay = await counts(), replay = ok(await save('pref-manager', firstSettings, 0, key.toUpperCase()));
    assert.deepEqual(replay.settings, secondSettings); assert.equal(replay.version, 2);
    assert.deepEqual(replay.receipt.appliedSettings, firstSettings); assert.equal(replay.receipt.appliedVersion, 1); assert.equal(replay.receipt.replayed, true);
    assert.deepEqual(await counts(), beforeReplay);
    assert.equal((await save('pref-manager', enabled, 0, key)).statusCode, 409);
    assert.equal((await save('pref-manager', enabled, 1)).statusCode, 409);
    const noopKey = randomUUID(), noop = ok(await save('pref-manager', secondSettings, 2, noopKey));
    assert.equal(noop.version, 2); assert.equal(noop.receipt.changed, false);
    const concurrent = await Promise.all([
      save('pref-manager', { ...enabled, inspectionsEnabled: false }, 2), save('pref-manager', { ...enabled, agreementsEnabled: false }, 2),
    ]);
    assert.deepEqual(concurrent.map(row => row.statusCode).sort(), [200, 409]);
    const afterConcurrent = await current('pref-manager'); assert.equal(afterConcurrent.version, 3);
    const lateNoop = ok(await save('pref-manager', secondSettings, 2, noopKey));
    assert.deepEqual(lateNoop.settings, afterConcurrent.settings); assert.deepEqual(lateNoop.receipt.appliedSettings, secondSettings); assert.equal(lateNoop.receipt.changed, false);
    const exactKey = randomUUID(), desired = { ...enabled, maintenanceEnabled: false, workEnabled: false };
    const exact = (await Promise.all(Array.from({ length: 3 }, () => save('pref-manager', desired, 3, exactKey)))).map(ok);
    assert.ok(exact.every(row => row.version === 4));
    assert.equal((await admin.query('SELECT count(*)::int n FROM "NotificationPreferenceAction" WHERE "companyId"=$1 AND "userId"=\'pref-manager\' AND "submissionKey"=$2', [company, exactKey])).rows[0].n, 1);
    await choose('pref-manager', enabled);
    const stable = await current('pref-manager');
    for (let index = 0; index < 51; index++) assert.equal(ok(await save('pref-manager', enabled, stable.version)).receipt.changed, false);
    let cursor, history = [];
    do {
      const page = ok(await call('pref-manager', 'GET', endpoint + '/history' + (cursor ? '?cursor=' + cursor : '')));
      assert.equal(page.companyId, company);
      assert.ok(page.items.length <= 50); history.push(...page.items); cursor = page.nextCursor;
    } while (cursor);
    const expected = (await admin.query('SELECT count(*)::int n FROM "NotificationPreferenceAction" WHERE "companyId"=$1 AND "userId"=\'pref-manager\'', [company])).rows[0].n;
    assert.equal(history.length, expected); assert.equal(new Set(history.map(row => row.id)).size, expected);
    for (const secret of ['submissionKey', 'submissionHash', key, noopKey, exactKey, '@test.invalid']) assert.ok(!JSON.stringify(history).includes(secret), secret);
    const otherAction = (await admin.query('SELECT id FROM "NotificationPreferenceAction" WHERE "companyId"=$1 AND "userId"=\'pref-other\' LIMIT 1', [company])).rows[0].id;
    assert.equal((await call('pref-manager', 'GET', endpoint + '/history?cursor=' + otherAction)).statusCode, 404);
  });

  await t.test('all four real source families respect independent future delivery choices while retaining old inbox/read state and zero-recipient events', async () => {
    const baseline = await families('baseline');
    for (const source of baseline) assert.ok((await recipients(source)).includes('pref-manager'), source.kind);
    const oldNotice = (await inbox('pref-manager')).items[0];
    ok(await call('pref-manager', 'POST', `/api/account/notifications/${oldNotice.id}`, { action: 'read', expectedVersion: oldNotice.version, status: 'all', type: 'all', page: '1', submissionKey: randomUUID() }));
    const oldRows = (await admin.query('SELECT id,version,"readAt" FROM "InboxNotification" WHERE "companyId"=$1 AND "userId"=\'pref-manager\' ORDER BY id', [company])).rows;
    for (const settings of [
      { maintenanceEnabled: false, workEnabled: true, inspectionsEnabled: false, agreementsEnabled: true },
      { maintenanceEnabled: true, workEnabled: false, inspectionsEnabled: true, agreementsEnabled: false },
    ]) {
      await choose('pref-manager', settings);
      for (const source of await families(randomUUID()))
        assert.equal((await recipients(source)).includes('pref-manager'), settings[settingFor[source.sourceType]], source.kind);
    }
    await choose('pref-manager', disabled); await choose('pref-owner', disabled);
    const suppressed = await families('all-opted-out');
    for (const source of suppressed) assert.deepEqual(await recipients(source), [], source.kind);
    await choose('pref-manager', enabled); await choose('pref-owner', enabled);
    for (const source of suppressed) {
      ok(await call(source.actor, 'POST', source.path, source.payload));
      assert.deepEqual(await recipients(source), [], 'reenabling cannot backfill on business replay');
    }
    const retained = (await admin.query('SELECT id,version,"readAt" FROM "InboxNotification" WHERE id=ANY($1::text[]) ORDER BY id', [oldRows.map(row => row.id)])).rows;
    assert.deepEqual(retained, oldRows);
    const currentInbox = await inbox('pref-manager'); assert.ok(currentInbox.total >= oldRows.length);
    assert.ok(currentInbox.items.some(row => row.id === oldNotice.id && row.readAt));
  });

  await t.test('muting assigned work or maintenance never changes source duties, requester access, role or property grants', async () => {
    await choose('pref-staff', { ...enabled, workEnabled: false });
    const work = await intake('muted assigned duty', 'pref-owner');
    const assignment = await workAction(work.row.id, 'pref-owner', 'assign', { assigneeId: 'pref-staff' });
    assert.deepEqual(await recipients(assignment), []);
    assert.equal((await call('pref-staff', 'GET', `/api/company/work-orders/${work.row.id}`)).statusCode, 200);
    await workAction(work.row.id, 'pref-staff', 'accept');
    assert.equal((await admin.query('SELECT "assigneeId","executionStatus" FROM "MaintenanceRequest" WHERE id=$1', [work.row.id])).rows[0].executionStatus, 'accepted');
    await choose('pref-resident', { ...enabled, maintenanceEnabled: false });
    const request = await intake('muted requester source');
    const reply = ok(await call('pref-manager', 'POST', `/api/company/maintenance/${request.row.id}/updates`, { content: 'Fictional shared source still available', visibility: 'resident', submissionKey: randomUUID() }));
    const notices = (await admin.query('SELECT n."userId" FROM "InboxNotification" n JOIN "NotificationEvent" e ON e.id=n."eventId" WHERE e."companyId"=$1 AND e."eventKey"=$2', [company, `maintenance.update:${reply.id}`])).rows;
    assert.deepEqual(notices, []);
    assert.ok(ok(await call('pref-resident', 'GET', `/api/resident/maintenance/${request.row.id}/updates`)).items.some(row => row.id === reply.id));
    assert.equal((await call('pref-other', 'GET', `/api/resident/maintenance/${request.row.id}/updates`)).statusCode, 404);
    assert.equal((await call('pref-staff', 'GET', '/api/company/finances')).statusCode, 403);
    await choose('pref-staff', enabled); await choose('pref-resident', enabled);
  });

  await t.test('saving preferences and publishing a source serialize in both orders, including retrying an older snapshot', async () => {
    const waitBlocked = async count => {
      for (let attempt = 0; attempt < 250; attempt++) {
        if ((await admin.query(`SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%NotificationPreferenceFence%'`)).rows.length >= count) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.fail(`expected ${count} operations queued on the preference fence`);
    };
    for (const saveFirst of [true, false]) {
      await choose('pref-manager', enabled);
      const version = (await current('pref-manager')).version, leader = await admin.connect();
      let saving, publishing;
      try {
        await leader.query('BEGIN'); await leader.query('SELECT "companyId" FROM "NotificationPreferenceFence" WHERE "companyId"=$1 FOR UPDATE', [company]);
        if (saveFirst) {
          saving = save('pref-manager', { ...enabled, maintenanceEnabled: false }, version);
          await waitBlocked(1);
          publishing = intake('save-leading publication');
        } else {
          publishing = intake('publication-leading save');
          await waitBlocked(1);
          saving = save('pref-manager', { ...enabled, maintenanceEnabled: false }, version);
        }
        await waitBlocked(2); await leader.query('COMMIT');
        const [saved, source] = await Promise.all([saving.then(ok), publishing]);
        assert.equal(saved.settings.maintenanceEnabled, false);
        assert.equal((await recipients(source)).includes('pref-manager'), !saveFirst);
        const next = await intake('after committed opt-out');
        assert.equal((await recipients(next)).includes('pref-manager'), false);
      } finally {
        await leader.query('ROLLBACK'); leader.release();
        await Promise.allSettled([saving, publishing]);
      }
    }
    await choose('pref-manager', enabled);
  });

  await t.test('preference audit/receipts are atomic and immutable; own RLS remains closed after publisher whitelist reads', async () => {
    const before = await counts(), value = await current('pref-other'), key = randomUUID();
    await admin.query(`CREATE FUNCTION reject_preference_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='notification.preferences.saved' THEN RAISE EXCEPTION 'fixture preference audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_preference_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_preference_audit()`);
    try {
      assert.equal((await save('pref-other', disabled, value.version, key)).statusCode, 500);
      assert.deepEqual(await current('pref-other'), value); assert.deepEqual(await counts(), before);
    } finally { await admin.query('DROP TRIGGER reject_preference_audit ON "AuditEvent"; DROP FUNCTION reject_preference_audit()'); }
    ok(await save('pref-other', disabled, value.version, key));
    const receiptId = (await admin.query('SELECT id FROM "NotificationPreferenceAction" WHERE "companyId"=$1 AND "userId"=\'pref-other\' AND "submissionKey"=$2', [company, key])).rows[0].id;
    for (const statement of ['UPDATE "NotificationPreferenceAction" SET changed=false WHERE id=$1', 'DELETE FROM "NotificationPreferenceAction" WHERE id=$1'])
      await assert.rejects(admin.query(statement, [receiptId]), /Notification history is immutable/);
    await assert.rejects(admin.query('UPDATE "NotificationPreference" SET "maintenanceEnabled"=true WHERE "companyId"=$1 AND "userId"=\'pref-other\'', [company]), /Only versioned notification preference choices may change/);
    assert.deepEqual(await db.notificationPreference.findMany(), []); assert.deepEqual(await db.notificationPreferenceAction.findMany(), []);
    const source = await intake('publisher context cleanup');
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.company_id', ${company}, true)`;
      await tx.$queryRaw`SELECT set_config('app.notification_user_id', 'pref-other', true)`;
      await publishNotification(tx, { companyId: company, actorId: 'pref-resident', kind: 'maintenance.created', requestId: source.row.id, eventKey: randomUUID() });
      assert.equal((await tx.$queryRaw`SELECT current_setting('app.notification_preference_recipients',true) AS recipients`)[0].recipients, '[]');
      assert.deepEqual((await tx.notificationPreference.findMany()).map(row => row.userId), ['pref-other']);
      assert.ok((await tx.notificationPreferenceAction.findMany()).every(row => row.userId === 'pref-other'));
      assert.equal(await tx.notificationPreference.count({ where: { userId: 'pref-manager' } }), 0);
      await tx.$queryRaw`SELECT set_config('app.notification_preference_recipients', '["pref-owner"]', true)`;
      assert.equal(await tx.notificationPreference.count({ where: { userId: 'pref-owner' } }), 1);
      assert.equal(await tx.notificationPreferenceAction.count({ where: { userId: 'pref-owner' } }), 0, 'publisher flag reads never grant another account history');
      assert.equal((await tx.notificationPreference.updateMany({ where: { userId: 'pref-owner' }, data: { maintenanceEnabled: false, version: { increment: 1 } } })).count, 0, 'publisher whitelist grants no preference writes');
      await tx.$queryRaw`SELECT set_config('app.notification_preference_recipients', '[]', true)`;
      await tx.$queryRaw`SELECT set_config('app.company_id', ${foreignCompany}, true)`;
      assert.equal(await tx.notificationPreference.count(), 0); assert.equal(await tx.notificationPreferenceAction.count(), 0);
    });
    for (const statement of [
      'UPDATE "NotificationPreferenceAction" SET changed=false', 'DELETE FROM "NotificationPreferenceAction"', 'DELETE FROM "NotificationPreference"',
      'UPDATE "NotificationPreference" SET "userId"=\'pref-manager\' WHERE "userId"=\'pref-other\'',
    ]) await assert.rejects(db.$executeRawUnsafe(statement), /permission denied/);
    await assert.rejects(db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.company_id', ${company}, true)`;
      await tx.$queryRaw`SELECT set_config('app.notification_user_id', 'pref-other', true)`;
      await tx.notificationPreferenceAction.create({ data: { companyId: company, userId: 'pref-owner', submissionKey: randomUUID(), submissionHash: 'fixture', ...enabled, appliedVersion: 1, changed: false } });
    }), /row-level security/);
  });

  await t.test('choices follow exact account and company through role changes, transfer, feature restrictions and support read-only viewing', async () => {
    const scopedState = async scope => (await admin.query(`SELECT
      (SELECT count(*)::int FROM "NotificationPreference" WHERE "companyId"=$1) preferences,
      (SELECT count(*)::int FROM "NotificationPreferenceAction" WHERE "companyId"=$1) actions,
      (SELECT count(*)::int FROM "AuditEvent" WHERE "companyId"=$1 AND action='notification.preferences.saved') audits,
      (SELECT generation::text FROM "NotificationPreferenceFence" WHERE "companyId"=$1) generation`, [scope])).rows[0];
    const unopened = await current('pref-mover');
    assert.deepEqual(unopened, { companyId: company, version: 0, settings: enabled });
    try {
      await admin.query('UPDATE "CompanyMembership" SET "companyId"=$1 WHERE "userId"=\'pref-mover\'', [foreignCompany]);
      const before = await scopedState(foreignCompany);
      const staleVirtual = await save('pref-mover', disabled, unopened.version, randomUUID(), unopened.companyId);
      assert.equal(staleVirtual.statusCode, 409, staleVirtual.body); assert.equal(staleVirtual.json().code, 'COMPANY_CONTEXT_CHANGED');
      assert.deepEqual(await scopedState(foreignCompany), before, 'an old-company virtual version-zero draft cannot write new-company defaults, receipts, fence or audit');
      const fresh = await current('pref-mover');
      assert.deepEqual(fresh, { companyId: foreignCompany, version: 0, settings: enabled });
      ok(await save('pref-mover', disabled, fresh.version, randomUUID(), fresh.companyId));
    } finally { await admin.query('UPDATE "CompanyMembership" SET "companyId"=$1 WHERE "userId"=\'pref-mover\'', [company]); }
    assert.deepEqual(await current('pref-mover'), unopened);
    const custom = { ...enabled, inspectionsEnabled: false };
    const saved = await choose('pref-manager', custom);
    const replayKey = randomUUID();
    ok(await save('pref-manager', custom, saved.version, replayKey));
    try {
      for (const role of ['staff', 'resident']) {
        await admin.query('UPDATE "CompanyMembership" SET role=$1 WHERE "userId"=\'pref-manager\'', [role]);
        assert.deepEqual((await current('pref-manager')).settings, custom);
      }
    } finally { await admin.query('UPDATE "CompanyMembership" SET role=\'manager\' WHERE "userId"=\'pref-manager\''); }
    let transferredAction;
    try {
      await admin.query('UPDATE "CompanyMembership" SET "companyId"=$1 WHERE "userId"=\'pref-manager\'', [foreignCompany]);
      assert.deepEqual(await current('pref-manager'), { companyId: foreignCompany, version: 0, settings: enabled });
      assert.equal(ok(await call('pref-manager', 'GET', endpoint + '/history')).companyId, foreignCompany);
      const before = await scopedState(foreignCompany);
      const oldReceipt = await save('pref-manager', custom, saved.version, replayKey, company);
      assert.equal(oldReceipt.statusCode, 409, oldReceipt.body); assert.equal(oldReceipt.json().code, 'COMPANY_CONTEXT_CHANGED');
      assert.deepEqual(await scopedState(foreignCompany), before);
      ok(await save('pref-manager', disabled, 0, replayKey, foreignCompany));
      const beforeKeyCollision = await scopedState(foreignCompany);
      const oldSameKey = await save('pref-manager', custom, saved.version, replayKey, company);
      assert.equal(oldSameKey.statusCode, 409, oldSameKey.body); assert.equal(oldSameKey.json().code, 'COMPANY_CONTEXT_CHANGED', 'company identity is checked before a colliding new-company receipt');
      assert.deepEqual(await scopedState(foreignCompany), beforeKeyCollision);
      assert.deepEqual((await current('pref-manager')).settings, disabled);
      transferredAction = (await admin.query('SELECT id FROM "NotificationPreferenceAction" WHERE "companyId"=$1 AND "userId"=\'pref-manager\' LIMIT 1', [foreignCompany])).rows[0].id;
      assert.equal((await call('pref-manager', 'GET', endpoint, undefined, { 'x-company-id': company })).statusCode, 403);
      assert.deepEqual(await current('pref-foreign'), { companyId: foreignCompany, version: 0, settings: enabled }, 'another member never inherits the transferred account choices');
    } finally { await admin.query('UPDATE "CompanyMembership" SET "companyId"=$1 WHERE "userId"=\'pref-manager\'', [company]); }
    assert.deepEqual((await current('pref-manager')).settings, custom);
    assert.equal((await call('pref-manager', 'GET', endpoint + '/history?cursor=' + transferredAction)).statusCode, 404);
    const policy = overrides => admin.query('INSERT INTO "CompanySubscription"("companyId","updatedById","featureOverrides","updatedAt") VALUES($1,\'pref-owner\',$2::jsonb,NOW()) ON CONFLICT("companyId") DO UPDATE SET "featureOverrides"=EXCLUDED."featureOverrides","updatedAt"=NOW()', [company, JSON.stringify(overrides)]);
    for (const mode of ['read_only', 'disabled']) {
      try {
        await policy({ notifications: mode });
        assert.equal((await call('pref-manager', 'GET', endpoint)).statusCode, mode === 'read_only' ? 200 : 403);
        assert.equal((await save('pref-manager', enabled, saved.version)).statusCode, 403);
        assert.equal((await save('pref-manager', custom, saved.version, replayKey)).statusCode, 403);
      } finally { await admin.query('DELETE FROM "CompanySubscription" WHERE "companyId"=$1', [company]); }
    }
    try {
      await admin.query('UPDATE "CompanyMembership" SET status=\'disabled\' WHERE "userId"=\'pref-manager\'');
      assert.equal((await call('pref-manager', 'GET', endpoint)).statusCode, 403);
      assert.equal((await save('pref-manager', enabled, saved.version)).statusCode, 403);
    } finally { await admin.query('UPDATE "CompanyMembership" SET status=\'active\' WHERE "userId"=\'pref-manager\''); }
    ok(await call('pref-support', 'POST', '/api/impersonation', { userId: 'pref-manager', reason: 'Fictional notification preference access check' }));
    try {
      const context = ok(await call('pref-support', 'GET', '/api/bootstrap'));
      const headers = { 'x-csrf-token': context.csrfToken, 'x-impersonation-id': context.impersonation.contextId };
      assert.deepEqual(ok(await call('pref-support', 'GET', endpoint, undefined, headers)).settings, custom);
      const denied = await call('pref-support', 'POST', endpoint, { ...enabled, expectedVersion: saved.version, expectedCompanyId: company, submissionKey: randomUUID() }, headers);
      assert.equal(denied.statusCode, 403); assert.equal(denied.json().code, 'IMPERSONATION_READ_ONLY');
    } finally {
      const session = await db.session.findUniqueOrThrow({ where: { tokenHash: digest('token-pref-support') } });
      ok(await call('pref-support', 'DELETE', '/api/impersonation', undefined, { 'x-csrf-token': session.csrfToken }));
    }
  });
}
