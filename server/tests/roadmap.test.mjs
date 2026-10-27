import { documentedInject } from './api-contract-assertions.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { registerApplication } from '../dist/application.js';
import { registerSessions, digest } from '../dist/sessions.js';
import { historicalCashCases } from './historical-cash-cases.mjs';
import { expenseImportCases } from './expense-import-cases.mjs';
import { documentAcknowledgmentCases } from './document-acknowledgment-cases.mjs';

const url = process.env.TEST_ROADMAP_DATABASE_URL;
test('roadmap workflows preserve recorded history, property scope and retry integrity', { skip: !url }, async t => {
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/propertyflow_roadmap_test');
  assert.equal(process.env.ROADMAP_DISPOSABLE, 'tmpfs-verified');
  const admin = new pg.Pool({ connectionString: url });
  t.after(() => admin.end());
  assert.equal((await admin.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n, 0);
  for (const name of readdirSync(new URL('../prisma/migrations/', import.meta.url)).filter(n => /^\d/.test(n)).sort())
    await admin.query(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
  await admin.query("ALTER ROLE propertyflow_runtime LOGIN PASSWORD 'roadmap-test-only'");
  const runtime = new URL(url);
  runtime.username = 'propertyflow_runtime';
  runtime.password = 'roadmap-test-only';
  const pool = new pg.Pool({ connectionString: runtime.href, max: 12 });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  t.after(async () => { await db.$disconnect(); await pool.end(); });
  for (const id of ['a', 'b'])
    await admin.query('INSERT INTO "Company"(id,name,timezone,"updatedAt") VALUES($1,$1,$2,NOW())', [id, id === 'a' ? 'America/New_York' : 'UTC']);
  for (const [id, company, role, platform] of [
    ['platform', null, null, 'owner'], ['support', null, null, 'support'],
    ['owner', 'a', 'owner', null], ['manager', 'a', 'manager', null], ['staff', 'a', 'staff', null], ['resident', 'a', 'resident', null], ['foreign', 'b', 'owner', null],
  ]) {
    await admin.query('INSERT INTO "User"(id,email,name,"emailVerified","platformRole","updatedAt") VALUES($1,$2,$1,true,$3,NOW())', [id, `${id}@test.invalid`, platform]);
    await db.identity.create({ data: { issuer: 'https://unused.auth0.com/', subject: id, userId: id } });
    if (company) await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,$2,$3,NOW())', [id, company, role]);
    await db.session.create({ data: { tokenHash: digest(`token-${id}`), csrfToken: 'csrf', userId: id, expiresAt: new Date(Date.now() + 6 * 3600000), idleExpiresAt: new Date(Date.now() + 6 * 3600000) } });
  }
  for (const [id, company] of [['home', 'a'], ['other-home', 'a'], ['foreign-home', 'b']])
    await admin.query('INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES($1,$1,\'Fictional street\',\'Town\',\'NY\',\'12345\',$2,NOW())', [id, company]);
  for (const [id, company, property, label, creator] of [['unit-home', 'a', 'home', 'Existing-A', 'owner'], ['unit-other', 'a', 'other-home', 'Existing-B', 'owner'], ['foreign-unit', 'b', 'foreign-home', 'Foreign-A', 'foreign']])
    await admin.query('INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") VALUES($1,$2,$3,$4,$5,$1,\'fictional-fixture\',NOW())', [id, company, property, label, creator]);
  await admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES(\'a\',\'home\',\'resident\')');

  const app = Fastify();
  t.after(() => app.close());
  const authenticate = await registerSessions(app, db, { origin: 'https://app.test', domain: 'unused.auth0.com', clientId: 'test', clientSecret: 'test-only', secure: true });
  registerApplication(app, db, authenticate, 'https://app.test');
  const call = (user, method, path, payload, extra = {}) => documentedInject(app,{ method, url: path, headers: {
    ...(user ? { cookie: `__Host-pf-session=token-${user}` } : {}), origin: 'https://app.test', 'x-csrf-token': 'csrf', ...extra,
  }, ...(payload === undefined ? {} : { payload }) });
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  const policy = (featureOverrides = {}, status = 'active') => db.companySubscription.upsert({
    where: { companyId: 'a' },
    create: { companyId: 'a', updatedById: 'platform', status, featureOverrides },
    update: { planId: null, status, featureOverrides, trialEndsAt: null, overrideExpiresAt: null },
  });
  const today = ok(await call('owner', 'GET', '/api/company/reports/context')).today;
  const shift = days => { const value = new Date(`${today}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };

  await t.test('fresh migrations retain restricted runtime roles and forced property boundaries', async () => {
    const role = (await pool.query('SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
    assert.deepEqual(role, { rolsuper: false, rolbypassrls: false, rolcreaterole: false });
    assert.equal(await db.property.count(), 0);
    assert.equal(await db.$transaction(async tx => { await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`; return tx.property.count(); }), 2);
  });

  await historicalCashCases(t, admin, call, app, db);

  const unit = async (id, { companyId = 'a', propertyId = 'home', status = 'active' } = {}) => admin.query(
    'INSERT INTO "Unit"(id,"companyId","propertyId",label,status,"createdById","submissionKey","submissionHash","updatedAt") VALUES($1,$2,$3,$1,$4,$5,$1,\'fictional-fixture\',NOW())',
    [id, companyId, propertyId, status, companyId === 'a' ? 'owner' : 'foreign']);
  const lease = async (id, unitId, { status = 'active', start = shift(-30), end = null } = {}) => admin.query(
    'INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentId","createdById","submissionKey","submissionHash","startsOn","endsOn","rentCents",status,"updatedAt") VALUES($1,\'a\',\'home\',$2,\'resident\',\'owner\',$1,\'fictional-fixture\',$3,$4,100000,$5,NOW())',
    [id, unitId, start, end, status]);
  const availabilityPath = id => `/api/company/units/${id}/availability`;
  const review = (patch = {}) => ({ expectedVersion: null, condition: 'ready', availableOn: today, reason: 'Fictional unit inspected and confirmed ready', submissionKey: randomUUID(), ...patch });

  await t.test('availability distinguishes recorded occupancy from confirmed readiness and scopes every source', async () => {
    for (const [id, options] of [['ava-occupied', {}], ['ava-future', {}], ['ava-turnover', {}], ['ava-unavailable', {}], ['ava-unconfirmed', {}], ['ava-archived', { status: 'archived' }]]) await unit(id, options);
    await lease('ava-current-lease', 'ava-occupied', { end: shift(10) });
    await lease('ava-future-lease', 'ava-future', { start: shift(10), end: shift(365) });
    await lease('ava-draft-does-not-reserve', 'ava-unconfirmed', { status: 'draft', start: shift(2), end: shift(30) });
    ok(await call('owner', 'PUT', availabilityPath('ava-turnover'), review({ condition: 'turnover', availableOn: shift(5) })));
    ok(await call('manager', 'PUT', availabilityPath('ava-unavailable'), review({ condition: 'unavailable', availableOn: shift(20) })));
    const board = ok(await call('owner', 'GET', '/api/company/availability?q=ava-'));
    const states = Object.fromEntries(board.items.map(item => [item.unit.id, item.state]));
    assert.deepEqual(states, { 'ava-unconfirmed': 'unconfirmed', 'ava-unavailable': 'unavailable', 'ava-turnover': 'turnover', 'ava-occupied': 'occupied', 'ava-future': 'future_occupancy', 'ava-archived': 'archived' });
    assert.equal(board.items.find(item => item.unit.id === 'ava-occupied').currentLease.id, 'ava-current-lease');
    assert.equal(board.items.find(item => item.unit.id === 'ava-future').nextLease.id, 'ava-future-lease');
    assert.match(board.definition, /not reconstructed historical occupancy/);
    assert.equal(board.total, 6);
    assert.equal(Object.values(board.counts).reduce((sum, count) => sum + count, 0), 6);
    assert.equal((await call('owner', 'GET', '/api/company/availability?propertyId=foreign-home')).statusCode, 404);
    assert.equal(ok(await call('foreign', 'GET', '/api/company/availability?q=ava-')).total, 0);
    for (const user of ['staff', 'resident', 'platform', 'support']) {
      assert.equal((await call(user, 'GET', '/api/company/availability')).statusCode, 403, user);
      assert.equal((await call(user, 'PUT', availabilityPath('ava-unconfirmed'), review())).statusCode, 403, user);
    }
    assert.equal((await call(null, 'GET', '/api/company/availability')).statusCode, 401);
    assert.equal((await call('owner', 'GET', '/api/company/availability', undefined, { 'x-company-id': 'b' })).statusCode, 403);
    assert.equal((await call('foreign', 'GET', `${availabilityPath('ava-turnover')}/history`)).statusCode, 404);
    assert.equal((await call('owner', 'PUT', availabilityPath('foreign-unit'), review())).statusCode, 404);
    for (const extra of [{ origin: 'https://untrusted.test' }, { 'x-csrf-token': 'invalid' }]) assert.equal((await call('owner', 'PUT', availabilityPath('ava-unconfirmed'), review(), extra)).statusCode, 403);
    for (const query of ['asOf=2026-02-30', 'status=vacant', 'companyId=b']) assert.equal((await call('owner', 'GET', `/api/company/availability?${query}`)).statusCode, 400);
  });

  await t.test('readiness reviews retain source history, reject stale/racing edits and never override a current tenancy', async () => {
    const first = review();
    ok(await call('owner', 'PUT', availabilityPath('ava-unconfirmed'), first));
    const replies = await Promise.all([
      call('owner', 'PUT', availabilityPath('ava-unconfirmed'), review({ expectedVersion: 1, condition: 'turnover', reason: 'Owner reviewed repair work' })),
      call('manager', 'PUT', availabilityPath('ava-unconfirmed'), review({ expectedVersion: 1, condition: 'unavailable', reason: 'Manager reviewed blocked work' })),
    ]);
    assert.deepEqual(replies.map(response => response.statusCode).sort(), [200, 409], replies.map(response => response.body).join('\n'));
    const replay = ok(await call('owner', 'PUT', availabilityPath('ava-unconfirmed'), first));
    assert.equal(replay.availability.version, 2);
    assert.equal((await call('owner', 'PUT', availabilityPath('ava-unconfirmed'), { ...first, reason: 'Different use of an old submission' })).statusCode, 409);
    const history = ok(await call('owner', 'GET', `${availabilityPath('ava-unconfirmed')}/history`));
    assert.deepEqual(history.items.map(item => item.version), [2, 1]);
    assert.equal(history.items.find(item => item.version === 1).snapshot.condition, 'ready');
    assert.doesNotMatch(JSON.stringify(history), /submissionHash|submissionKey/);
    const reset = ok(await call('manager', 'PUT', availabilityPath('ava-unconfirmed'), review({ expectedVersion: 2, condition: 'unconfirmed', availableOn: null, reason: 'Withdraw readiness confirmation pending a fresh inspection' })));
    assert.equal(reset.availability.version, 3);
    assert.equal(reset.availability.condition, 'unconfirmed');
    assert.equal(reset.availability.availableOn, null);
    assert.equal(ok(await call('owner', 'GET', '/api/company/availability?q=ava-unconfirmed')).items[0].state, 'unconfirmed');
    const occupied = await call('owner', 'PUT', availabilityPath('ava-occupied'), review());
    assert.equal(occupied.statusCode, 409, occupied.body);
    assert.equal(occupied.json().code, 'UNIT_OCCUPIED');
    assert.equal((await call('owner', 'PUT', availabilityPath('ava-archived'), review())).statusCode, 409);
    assert.equal((await call('owner', 'PUT', availabilityPath('unit-home'), review({ availableOn: shift(1) }))).statusCode, 400);
    assert.equal((await call('owner', 'PUT', availabilityPath('unit-home'), review({ reason: '' }))).statusCode, 400);
    await unit('ava-stale');
    ok(await call('owner', 'PUT', availabilityPath('ava-stale'), review({ availableOn: shift(-5) })));
    await lease('ava-later-recorded-tenancy', 'ava-stale', { status: 'ended', start: shift(-4), end: shift(-1) });
    const stale = ok(await call('owner', 'GET', '/api/company/availability?q=ava-stale')).items[0];
    assert.equal(stale.readinessStale, true);
    assert.equal(stale.state, 'unconfirmed');
    const recheck = await call('owner', 'PUT', availabilityPath('ava-stale'), review({ expectedVersion: 1, availableOn: shift(-2) }));
    assert.equal(recheck.statusCode, 409, recheck.body);
    ok(await call('owner', 'PUT', availabilityPath('ava-stale'), review({ expectedVersion: 1 })));
    assert.equal(ok(await call('owner', 'GET', '/api/company/availability?q=ava-stale')).items[0].state, 'ready');
    await unit('ava-ended-today');
    await lease('ava-inclusive-ending', 'ava-ended-today', { status: 'ended', start: shift(-10), end: today });
    const inclusiveEnd = await call('owner', 'PUT', availabilityPath('ava-ended-today'), review());
    assert.equal(inclusiveEnd.statusCode, 409, inclusiveEnd.body);
    assert.equal(inclusiveEnd.json().code, 'READINESS_PRECEDES_TENANCY');
  });

  await t.test('availability totals cover all filtered units before pagination and controls remain atomic under feature changes', async () => {
    await admin.query('INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") SELECT \'ava-page-\'||lpad(i::text,3,\'0\'),\'a\',\'home\',\'ava-page-\'||lpad(i::text,3,\'0\'),\'owner\',gen_random_uuid()::text,\'fixture\',NOW() FROM generate_series(1,55) i');
    const first = ok(await call('manager', 'GET', '/api/company/availability?q=ava-page-'));
    assert.equal(first.total, 55);
    assert.equal(first.items.length, 50);
    assert.equal(first.counts.unconfirmed, 55);
    const second = ok(await call('manager', 'GET', `/api/company/availability?q=ava-page-&cursor=${first.nextCursor}`));
    assert.equal(second.total, 55);
    assert.equal(second.items.length, 5);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.unit.id)).size, 55);
    await policy({ leasing: 'read_only' });
    assert.equal((await call('owner', 'GET', '/api/company/availability')).statusCode, 200);
    assert.equal((await call('owner', 'PUT', availabilityPath('unit-home'), review())).json().code, 'SUBSCRIPTION_READ_ONLY');
    await policy({ leasing: 'disabled' });
    assert.equal((await call('owner', 'GET', '/api/company/availability')).json().code, 'FEATURE_DISABLED');
    await policy();
    await admin.query("CREATE FUNCTION reject_availability_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='availability.reviewed' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_availability_audit BEFORE INSERT ON \"AuditEvent\" FOR EACH ROW EXECUTE FUNCTION reject_availability_audit()");
    try { assert.equal((await call('owner', 'PUT', availabilityPath('unit-home'), review())).statusCode, 500); }
    finally { await admin.query('DROP TRIGGER reject_availability_audit ON "AuditEvent"; DROP FUNCTION reject_availability_audit()'); }
    assert.equal((await admin.query('SELECT count(*)::int n FROM "UnitAvailability" WHERE "unitId"=\'unit-home\'')).rows[0].n, 0);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "UnitAvailabilityRevision" WHERE "unitId"=\'unit-home\'')).rows[0].n, 0);
    assert.equal(await db.unitAvailability.count(), 0);
    await assert.rejects(pool.query('DELETE FROM "UnitAvailabilityRevision" WHERE false'), /permission denied/);
  });

  const imports = '/api/company/imports/units';
  const csv = rows => rows.map(row => row.map(value => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : value).join(',')).join('\r\n');
  const preview = async (rows, extra = {}, user = 'owner') => ok(await call(user, 'POST', `${imports}/preview`, { csv: csv(rows), fileName: 'fictional-units.csv', submissionKey: randomUUID(), ...extra }));
  const commit = (batch, extra = {}) => ({ expectedVersion: batch.version, submissionKey: randomUUID(), ...extra });

  await t.test('CSV preview validates complete rows and company mapping without creating partial inventory', async () => {
    const countBefore = (await admin.query('SELECT count(*)::int n FROM "Unit"')).rows[0].n;
    const batch = await preview([
      ['propertyId', 'label', 'bedrooms', 'bathrooms', 'squareFeet', 'marketRent', 'floor', 'notes'],
      ['home', 'import-preview-good', '2', '1.25', '900', '1250.05', '2', 'Quoted, notes\nwith "evidence"'],
      ['home', 'Existing-A', '', '', '', '', '', ''],
      ['foreign-home', 'private foreign mapping', '', '', '', '', '', ''],
      ['home', 'import-duplicate', '', '', '', '', '', ''],
      ['home', 'import-duplicate', '', '', '', '', '', ''],
      ['home', 'import-invalid-number', '-1', '1.2', '', '', '', ''],
    ]);
    assert.equal(batch.preview.rowCount, 6);
    assert.equal(batch.preview.validCount, 1);
    assert.equal(batch.preview.errorCount, 5);
    assert.equal(batch.preview.rows[0].property.id, 'home');
    assert.equal(batch.preview.rows[0].details.marketRentCents, 125005);
    assert.equal(batch.preview.rows[0].details.notes, 'Quoted, notes\nwith "evidence"');
    assert.equal(batch.preview.rows[2].property, null);
    assert.equal((await call('owner', 'POST', `${imports}/${batch.id}/commit`, commit(batch))).json().code, 'IMPORT_INVALID');
    assert.equal((await admin.query('SELECT count(*)::int n FROM "Unit"')).rows[0].n, countBefore);
    assert.doesNotMatch(JSON.stringify(batch), /submissionHash|submissionKey|sourceHash|sourceRows/);
    const batchesBefore = (await admin.query('SELECT count(*)::int n FROM "UnitImportBatch"')).rows[0].n;
    for (const invalid of ['propertyId,label\nhome,"unterminated', 'propertyId,label,label\nhome,A,B', 'propertyId,label,unknown\nhome,A,B', 'propertyId,label\nhome,A,extra', `propertyId,label\n${Array.from({ length: 501 }, (_, index) => `home,too-many-${index}`).join('\n')}`])
      assert.equal((await call('owner', 'POST', `${imports}/preview`, { csv: invalid, fileName: 'invalid.csv', submissionKey: randomUUID() })).statusCode, 400);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "UnitImportBatch"')).rows[0].n, batchesBefore);
  });

  await t.test('valid import commits atomically, handles concurrent lost-response retries and preserves exact source rows', async () => {
    const source = { csv: '\uFEFFpropertyId,label,bedrooms,bathrooms,squareFeet,marketRent,floor,notes\r\nhome,import-created-one,2,1.25,800,1250.05,Second,"Line one, quoted\r\nLine two"\r\nother-home,import-created-two,0,1,400,900.00,Ground,Studio', fileName: 'fictional-committed.csv', submissionKey: randomUUID() };
    const batch = ok(await call('manager', 'POST', `${imports}/preview`, source));
    assert.equal(batch.preview.errorCount, 0);
    assert.equal(ok(await call('manager', 'POST', `${imports}/preview`, source)).id, batch.id);
    assert.equal((await call('manager', 'POST', `${imports}/preview`, { ...source, fileName: 'changed.csv' })).statusCode, 409);
    const payload = commit(batch);
    const replies = await Promise.all([call('owner', 'POST', `${imports}/${batch.id}/commit`, payload), call('manager', 'POST', `${imports}/${batch.id}/commit`, payload)]);
    for (const response of replies) assert.equal(response.statusCode, 200, response.body);
    const committed = replies[0].json();
    assert.equal(committed.status, 'committed');
    assert.equal(committed.result.createdCount, 2);
    assert.equal(committed.result.items.length, 2);
    assert.deepEqual(replies[1].json().result, committed.result);
    const created = (await admin.query('SELECT id,label,"bathroomsHundredths","marketRentCents",notes FROM "Unit" WHERE label IN (\'import-created-one\',\'import-created-two\') ORDER BY label')).rows;
    assert.equal(created.length, 2);
    assert.equal(created[0].bathroomsHundredths, 125);
    assert.equal(created[0].marketRentCents, 125005);
    assert.equal(created[0].notes, 'Line one, quoted\nLine two');
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'unit.import.committed\' AND "targetId"=$1', [batch.id])).rows[0].n, 1);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'unit.created\' AND detail->>\'importBatchId\'=$1', [batch.id])).rows[0].n, 2);
    assert.equal((await call('owner', 'POST', `${imports}/${batch.id}/commit`, commit(batch))).statusCode, 409);
    assert.equal((await call('owner', 'POST', `${imports}/${batch.id}/commit`, { ...payload, expectedVersion: 2 })).statusCode, 409);
    assert.equal((await call('foreign', 'GET', `${imports}/${batch.id}`)).statusCode, 404);
    assert.equal(ok(await call('foreign', 'GET', imports)).total, 0);
  });

  await t.test('commit revalidates property versions and duplicate source records with no partial creations', async () => {
    const changed = await preview([['propertyId', 'label'], ['home', 'import-stale-property'], ['other-home', 'import-should-not-create']]);
    await admin.query('UPDATE "Property" SET version=version+1 WHERE id=\'home\'');
    const stale = await call('owner', 'POST', `${imports}/${changed.id}/commit`, commit(changed));
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().code, 'IMPORT_REVIEW_CHANGED');
    assert.equal((await admin.query('SELECT count(*)::int n FROM "Unit" WHERE label IN (\'import-stale-property\',\'import-should-not-create\')')).rows[0].n, 0);
    const duplicate = await preview([['propertyId', 'label'], ['home', 'import-concurrent-source'], ['home', 'import-batch-rollback']]);
    await unit('import-concurrent-source');
    const raced = await call('manager', 'POST', `${imports}/${duplicate.id}/commit`, commit(duplicate));
    assert.equal(raced.statusCode, 409, raced.body);
    assert.equal(raced.json().code, 'IMPORT_REVIEW_CHANGED');
    assert.equal((await admin.query('SELECT count(*)::int n FROM "Unit" WHERE label=\'import-batch-rollback\'')).rows[0].n, 0);
    assert.equal(ok(await call('owner', 'GET', `${imports}/${duplicate.id}`)).status, 'preview');
  });

  await t.test('the supported 500-row bulk import returns every exact source mapping without truncation or duplicate replay', async () => {
    const rows = Array.from({ length: 500 }, (_, index) => [index % 2 ? 'other-home' : 'home', `import-bulk-${String(index).padStart(3, '0')}`, `${1000 + index}.01`]);
    const batch = await preview([['propertyId', 'label', 'marketRent'], ...rows], { fileName: 'fictional-500-units.csv' });
    assert.equal(batch.preview.rowCount, 500);
    assert.equal(batch.preview.validCount, 500);
    assert.equal(batch.preview.errorCount, 0);
    const payload = commit(batch);
    const result = ok(await call('owner', 'POST', `${imports}/${batch.id}/commit`, payload));
    assert.equal(result.result.createdCount, 500);
    assert.equal(result.result.items.length, 500);
    assert.equal(new Set(result.result.items.map(item => item.unitId)).size, 500);
    const actual = new Map((await admin.query('SELECT id,"propertyId",label,"marketRentCents" FROM "Unit" WHERE id=ANY($1::text[])', [result.result.items.map(item => item.unitId)])).rows.map(row => [row.id, row]));
    for (const item of result.result.items) {
      const source = rows[item.row - 2];
      assert.ok(source, `known source row ${item.row}`);
      assert.equal(item.propertyId, source[0]);
      assert.equal(item.label, source[1]);
      assert.equal(actual.get(item.unitId).propertyId, source[0]);
      assert.equal(actual.get(item.unitId).label, source[1]);
      assert.equal(actual.get(item.unitId).marketRentCents, Math.round(Number(source[2]) * 100));
    }
    assert.deepEqual(ok(await call('manager', 'POST', `${imports}/${batch.id}/commit`, payload)).result, result.result);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "Unit" WHERE label LIKE \'import-bulk-%\'')).rows[0].n, 500);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'unit.created\' AND detail->>\'importBatchId\'=$1', [batch.id])).rows[0].n, 500);
  });

  await t.test('import cancellation, fresh feature authority and audit failures preserve recoverable drafts', async () => {
    const cancelled = await preview([['propertyId', 'label'], ['home', 'import-cancelled-unit']]);
    const cancelPayload = { expectedVersion: cancelled.version, reason: 'Fictional source file was superseded', submissionKey: randomUUID() };
    ok(await call('manager', 'POST', `${imports}/${cancelled.id}/cancel`, cancelPayload));
    assert.equal(ok(await call('manager', 'POST', `${imports}/${cancelled.id}/cancel`, cancelPayload)).status, 'cancelled');
    assert.equal((await call('owner', 'POST', `${imports}/${cancelled.id}/commit`, commit(cancelled))).statusCode, 409);
    const gated = await preview([['propertyId', 'label'], ['home', 'import-policy-gated']]);
    await policy({ properties: 'read_only' });
    assert.equal((await call('owner', 'GET', `${imports}/${gated.id}`)).statusCode, 200);
    assert.equal((await call('owner', 'POST', `${imports}/${gated.id}/commit`, commit(gated))).json().code, 'SUBSCRIPTION_READ_ONLY');
    await policy({ properties: 'disabled' });
    assert.equal((await call('owner', 'GET', `${imports}/${gated.id}`)).json().code, 'FEATURE_DISABLED');
    await policy();
    for (const user of ['staff', 'resident', 'platform', 'support']) {
      assert.equal((await call(user, 'GET', imports)).statusCode, 403, user);
      assert.equal((await call(user, 'POST', `${imports}/preview`, { csv: 'propertyId,label\nhome,forbidden', fileName: 'no.csv', submissionKey: randomUUID() })).statusCode, 403, user);
    }
    assert.equal((await call('owner', 'GET', imports, undefined, { 'x-company-id': 'b' })).statusCode, 403);
    assert.equal((await call('owner', 'POST', `${imports}/preview`, { csv: 'propertyId,label\nhome,forbidden', fileName: 'no.csv', submissionKey: randomUUID() }, { 'x-csrf-token': 'invalid' })).statusCode, 403);
    await admin.query("CREATE FUNCTION reject_import_commit_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='unit.import.committed' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_import_commit_audit BEFORE INSERT ON \"AuditEvent\" FOR EACH ROW EXECUTE FUNCTION reject_import_commit_audit()");
    try { assert.equal((await call('owner', 'POST', `${imports}/${gated.id}/commit`, commit(gated))).statusCode, 500); }
    finally { await admin.query('DROP TRIGGER reject_import_commit_audit ON "AuditEvent"; DROP FUNCTION reject_import_commit_audit()'); }
    const recovered = ok(await call('owner', 'GET', `${imports}/${gated.id}`));
    assert.equal(recovered.status, 'preview');
    assert.equal(recovered.version, 1);
    assert.equal(recovered.result, null);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "Unit" WHERE label=\'import-policy-gated\'')).rows[0].n, 0);
    assert.equal(await db.unitImportBatch.count(), 0);
    await assert.rejects(pool.query('DELETE FROM "UnitImportAction" WHERE false'), /permission denied/);
    await assert.rejects(pool.query('UPDATE "UnitImportBatch" SET "sourceRows"=\'[]\'::jsonb WHERE false'), /permission denied/);
    await assert.rejects(pool.query('UPDATE "UnitImportBatch" SET preview=\'{}\'::jsonb WHERE false'), /permission denied/);
  });

  const prospects = '/api/company/prospects';
  const prospectPayload = (extra = {}) => ({ propertyId: 'home', unitId: null, name: 'Fictional prospective resident', email: 'resident@test.invalid', phone: null, source: 'referral', desiredMoveIn: shift(10), followUpOn: today, notes: 'Private fictional inquiry notes', reason: 'Record a direct management inquiry', submissionKey: randomUUID(), ...extra });
  const newProspect = async (extra = {}, user = 'owner') => ok(await call(user, 'POST', prospects, prospectPayload(extra))).prospect;
  const stage = async (row, next, extra = {}, user = 'owner') => ok(await call(user, 'POST', `${prospects}/${row.id}/stage`, { expectedVersion: row.version, stage: next, reason: `Management reviewed the ${next} stage`, submissionKey: randomUUID(), ...extra })).prospect;
  const editProspect = (row, extra = {}) => ({ expectedVersion: row.version, unitId: row.unitId, name: row.name, email: row.email, phone: row.phone, source: row.source, desiredMoveIn: row.desiredMoveIn?.slice(0, 10) ?? null, followUpOn: row.followUpOn?.slice(0, 10) ?? null, notes: row.notes, reason: 'Review the inquiry details', submissionKey: randomUUID(), ...extra });
  let stageCase, approvedCase, convertedCase, conversionPayload;

  await t.test('prospect intake and details stay management-only, company-scoped and recoverable after a lost creation response', async () => {
    const payload = prospectPayload({ name: 'pros-initial-intake' });
    const first = ok(await call('owner', 'POST', prospects, payload)).prospect;
    assert.equal(first.stage, 'inquiry');
    assert.equal(first.property.id, 'home');
    assert.equal(ok(await call('manager', 'POST', prospects, payload)).prospect.id, first.id);
    assert.equal((await call('owner', 'POST', prospects, { ...payload, name: 'Different inquiry with an old source key' })).statusCode, 409);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "Prospect" WHERE name=\'pros-initial-intake\'')).rows[0].n, 1);
    const detail = ok(await call('manager', 'GET', `${prospects}/${first.id}`));
    assert.equal(detail.prospect.notes, 'Private fictional inquiry notes');
    assert.equal(detail.history.items.length, 1);
    assert.equal(detail.history.items[0].action, 'created');
    assert.doesNotMatch(JSON.stringify(detail), /submissionHash|submissionKey|createdById/);
    for (const user of ['staff', 'resident', 'platform', 'support']) {
      assert.equal((await call(user, 'GET', prospects)).statusCode, 403, user);
      assert.equal((await call(user, 'GET', `${prospects}/${first.id}`)).statusCode, 403, user);
      assert.equal((await call(user, 'POST', prospects, prospectPayload())).statusCode, 403, user);
    }
    assert.equal((await call(null, 'GET', prospects)).statusCode, 401);
    assert.equal((await call('foreign', 'GET', `${prospects}/${first.id}`)).statusCode, 404);
    assert.equal(ok(await call('foreign', 'GET', prospects)).total, 0);
    assert.equal((await call('owner', 'GET', prospects, undefined, { 'x-company-id': 'b' })).statusCode, 403);
    assert.equal((await call('owner', 'POST', prospects, prospectPayload({ propertyId: 'foreign-home' }))).statusCode, 404);
    assert.equal((await call('owner', 'POST', prospects, prospectPayload({ unitId: 'unit-other' }))).statusCode, 409);
    assert.equal((await call('owner', 'POST', prospects, prospectPayload({ email: null, phone: null }))).statusCode, 400);
    assert.equal((await call('owner', 'POST', prospects, prospectPayload({ email: 'invalid-email' }))).statusCode, 400);
    assert.equal((await call('owner', 'POST', prospects, prospectPayload(), { origin: 'https://untrusted.test' })).statusCode, 403);
    assert.equal((await call('owner', 'POST', prospects, prospectPayload(), { 'x-csrf-token': 'invalid' })).statusCode, 403);
    stageCase = first;
  });

  await t.test('prospect decisions require versioned reasons, preserve past decisions and reopen closed inquiries explicitly', async () => {
    const patch = editProspect(stageCase, { name: 'pros-versioned-intake', followUpOn: shift(2) });
    const attempts = await Promise.all([
      call('owner', 'PATCH', `${prospects}/${stageCase.id}`, patch),
      call('manager', 'PATCH', `${prospects}/${stageCase.id}`, { ...patch, name: 'pros-manager-intake', submissionKey: randomUUID() }),
    ]);
    assert.deepEqual(attempts.map(response => response.statusCode).sort(), [200, 409], attempts.map(response => response.body).join('\n'));
    stageCase = attempts.find(response => response.statusCode === 200).json().prospect;
    assert.equal(stageCase.version, 2);
    assert.equal((await call('owner', 'POST', `${prospects}/${stageCase.id}/stage`, { expectedVersion: stageCase.version, stage: 'tour', reason: '', submissionKey: randomUUID() })).statusCode, 400);
    stageCase = await stage(stageCase, 'tour');
    stageCase = await stage(stageCase, 'application');
    stageCase = await stage(stageCase, 'review');
    const declinedKey = randomUUID();
    const reviewed = stageCase;
    stageCase = await stage(stageCase, 'declined', { submissionKey: declinedKey, reason: 'Application review did not meet the documented criteria' });
    assert.equal((await call('owner', 'POST', `${prospects}/${stageCase.id}/stage`, { expectedVersion: stageCase.version, stage: 'approved', reason: 'Changed decision without reopening review', submissionKey: randomUUID() })).statusCode, 409);
    stageCase = await stage(stageCase, 'review', { reason: 'Reopen to consider corrected application evidence' });
    stageCase = await stage(stageCase, 'approved');
    const oldReplay = ok(await call('manager', 'POST', `${prospects}/${stageCase.id}/stage`, { expectedVersion: reviewed.version, stage: 'declined', submissionKey: declinedKey, reason: 'Application review did not meet the documented criteria' })).prospect;
    assert.equal(oldReplay.stage, 'approved');
    assert.equal(oldReplay.version, stageCase.version);
    const detail = ok(await call('owner', 'GET', `${prospects}/${stageCase.id}`));
    assert.equal(detail.history.items.length, stageCase.version);
    assert.ok(detail.history.items.some(item => item.action === 'stage.changed' && item.snapshot.stage === 'declined'));
    assert.ok(detail.history.items.some(item => item.action === 'stage.changed' && item.snapshot.stage === 'approved'));
  });

  await t.test('prospect totals, follow-up dates and history privileges remain complete under paging and changing feature authority', async () => {
    await admin.query('INSERT INTO "Prospect"(id,"companyId","propertyId",name,email,source,"followUpOn","createdById","updatedAt") SELECT \'pros-page-\'||lpad(i::text,3,\'0\'),\'a\',\'home\',\'pros-page-\'||lpad(i::text,3,\'0\'),\'fixture@test.invalid\',\'phone\',CASE WHEN i<=30 THEN $1::date WHEN i<=40 THEN $2::date ELSE $3::date END,\'owner\',NOW() FROM generate_series(1,53) i', [shift(-1), today, shift(1)]);
    const first = ok(await call('owner', 'GET', `${prospects}?q=pros-page-`));
    assert.equal(first.total, 53);
    assert.equal(first.items.length, 50);
    assert.equal(first.counts.inquiry, 53);
    const last = ok(await call('manager', 'GET', `${prospects}?q=pros-page-&cursor=${first.nextCursor}`));
    assert.equal(last.total, 53);
    assert.equal(last.items.length, 3);
    assert.equal(new Set([...first.items, ...last.items].map(row => row.id)).size, 53);
    assert.equal(ok(await call('owner', 'GET', `${prospects}?q=pros-page-&due=overdue`)).total, 30);
    assert.equal(ok(await call('owner', 'GET', `${prospects}?q=pros-page-&due=today`)).total, 10);
    assert.equal(ok(await call('owner', 'GET', `${prospects}?q=pros-page-&due=upcoming`)).total, 23, 'upcoming includes today through the next seven days');
    for (const query of ['due=tomorrow', 'stage=unknown', 'companyId=b']) assert.equal((await call('owner', 'GET', `${prospects}?${query}`)).statusCode, 400);
    await policy({ leasing: 'read_only' });
    assert.equal((await call('owner', 'GET', prospects)).statusCode, 200);
    assert.equal((await call('owner', 'POST', prospects, prospectPayload())).json().code, 'SUBSCRIPTION_READ_ONLY');
    await policy({ properties: 'disabled' });
    assert.equal((await call('owner', 'GET', prospects)).json().code, 'FEATURE_DISABLED');
    await policy();
    assert.equal(await db.prospect.count(), 0);
    await assert.rejects(pool.query('DELETE FROM "ProspectAction" WHERE false'), /permission denied/);
    await assert.rejects(pool.query('UPDATE "ProspectAction" SET reason=\'changed\' WHERE false'), /permission denied/);
    await admin.query("CREATE FUNCTION reject_prospect_create_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='prospect.created' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_prospect_create_audit BEFORE INSERT ON \"AuditEvent\" FOR EACH ROW EXECUTE FUNCTION reject_prospect_create_audit()");
    try { assert.equal((await call('owner', 'POST', prospects, prospectPayload({ name: 'pros-audit-rollback' }))).statusCode, 500); }
    finally { await admin.query('DROP TRIGGER reject_prospect_create_audit ON "AuditEvent"; DROP FUNCTION reject_prospect_create_audit()'); }
    assert.equal((await admin.query('SELECT count(*)::int n FROM "Prospect" WHERE name=\'pros-audit-rollback\'')).rows[0].n, 0);
  });

  const contactLease = async (id, unitId, contactId, { propertyId = 'home', residentId = 'resident', status = 'draft' } = {}) => admin.query(
    'INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentId","residentContactId","createdById","submissionKey","submissionHash","startsOn","rentCents",status,"updatedAt") VALUES($1,\'a\',$2,$3,$4,$5,\'owner\',$1,\'fictional-fixture\',$6,100000,$7,NOW())', [id, propertyId, unitId, residentId, contactId, shift(10), status]);
  const conversion = (row, extra = {}) => ({ expectedVersion: row.version, contactId: 'pros-contact', expectedContactVersion: 1, leaseId: 'pros-lease-correct', expectedLeaseVersion: 1, confirmedMatch: true, reason: 'Explicitly reviewed the existing tenant account and lease source', submissionKey: randomUUID(), ...extra });

  await t.test('conversion candidates require exact account bindings and the reviewed primary tenant, property and preferred unit', async () => {
    for (const id of ['pros-other-resident', 'pros-noidentity']) {
      await admin.query('INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES($1,$2,$1,true,NOW())', [id, `${id}@test.invalid`]);
      await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,\'a\',\'resident\',NOW())', [id]);
    }
    await db.identity.create({ data: { userId: 'pros-other-resident', issuer: 'https://unused.auth0.com/', subject: 'pros-other-resident' } });
    for (const [id, userId, email] of [['pros-contact', 'resident', 'resident@test.invalid'], ['pros-other-contact', 'pros-other-resident', 'resident@test.invalid'], ['pros-noidentity-contact', 'pros-noidentity', 'unbound@test.invalid']])
      await admin.query('INSERT INTO "ResidentContact"(id,"companyId","userId",name,email,"updatedAt") VALUES($1,\'a\',$2,$1,$3,NOW())', [id, userId, email]);
    await unit('pros-unit');
    await contactLease('pros-lease-correct', 'pros-unit', 'pros-contact');
    await contactLease('pros-lease-wrong-party', 'pros-unit', 'pros-other-contact', { residentId: 'pros-other-resident' });
    await contactLease('pros-lease-wrong-unit', 'unit-home', 'pros-contact');
    await contactLease('pros-lease-wrong-property', 'unit-other', 'pros-contact', { propertyId: 'other-home' });
    await contactLease('pros-lease-noidentity', 'pros-unit', 'pros-noidentity-contact', { residentId: 'pros-noidentity' });
    approvedCase = await newProspect({ name: 'pros-approved-source-link', unitId: 'pros-unit' });
    assert.equal((await call('owner', 'GET', `${prospects}/${approvedCase.id}/conversion-options`)).statusCode, 409);
    approvedCase = await stage(approvedCase, 'approved');
    const options = ok(await call('manager', 'GET', `${prospects}/${approvedCase.id}/conversion-options?contactId=pros-contact`));
    assert.ok(options.contacts.some(contact => contact.id === 'pros-contact'));
    assert.ok(options.contacts.some(contact => contact.id === 'pros-other-contact'), 'contact email does not merge distinct account-bound contacts');
    assert.ok(!options.contacts.some(contact => contact.id === 'pros-noidentity-contact'));
    assert.deepEqual(options.leases.map(lease => lease.id), ['pros-lease-correct']);
    assert.equal((await call('owner', 'GET', `${prospects}/${approvedCase.id}/conversion-options?contactId=pros-noidentity-contact`)).statusCode, 409);
    for (const leaseId of ['pros-lease-wrong-party', 'pros-lease-wrong-unit', 'pros-lease-wrong-property']) {
      const result = await call('owner', 'POST', `${prospects}/${approvedCase.id}/convert`, conversion(approvedCase, { leaseId }));
      assert.equal(result.statusCode, 409, result.body);
      assert.equal(result.json().code, 'LEASE_PARTY_MISMATCH');
    }
    const missingAccount = await call('owner', 'POST', `${prospects}/${approvedCase.id}/convert`, conversion(approvedCase, { contactId: 'pros-noidentity-contact', leaseId: 'pros-lease-noidentity' }));
    assert.equal(missingAccount.statusCode, 409, missingAccount.body);
    assert.equal(missingAccount.json().code, 'ACCOUNT_REQUIRED');
    assert.equal((await call('owner', 'POST', `${prospects}/${approvedCase.id}/convert`, conversion(approvedCase, { confirmedMatch: false }))).statusCode, 400);
    assert.equal((await call('owner', 'POST', `${prospects}/${approvedCase.id}/convert`, conversion(approvedCase, { expectedContactVersion: 99 }))).statusCode, 409);
    assert.equal((await call('owner', 'POST', `${prospects}/${approvedCase.id}/convert`, conversion(approvedCase, { expectedLeaseVersion: 99 }))).statusCode, 409);
  });

  await t.test('concurrent conversions link existing sources once without creating accounts, leases, money or portal grants', async () => {
    const sourceCounts = async () => (await admin.query('SELECT (SELECT count(*)::int FROM "User") users,(SELECT count(*)::int FROM "ResidentContact") contacts,(SELECT count(*)::int FROM "Lease") leases,(SELECT count(*)::int FROM "LedgerEntry") ledger,(SELECT count(*)::int FROM "ResidentPropertyAssignment") assignments,(SELECT count(*)::int FROM "Invitation") invitations')).rows[0];
    const before = await sourceCounts();
    conversionPayload = conversion(approvedCase);
    const managerPayload = conversion(approvedCase);
    const attempts = await Promise.all([
      call('owner', 'POST', `${prospects}/${approvedCase.id}/convert`, conversionPayload),
      call('manager', 'POST', `${prospects}/${approvedCase.id}/convert`, managerPayload),
    ]);
    assert.deepEqual(attempts.map(response => response.statusCode).sort(), [200, 409], attempts.map(response => response.body).join('\n'));
    convertedCase = attempts.find(response => response.statusCode === 200).json().prospect;
    if (attempts[0].statusCode !== 200) conversionPayload = managerPayload;
    assert.equal(convertedCase.stage, 'converted');
    assert.equal(convertedCase.contactId, 'pros-contact');
    assert.equal(convertedCase.leaseId, 'pros-lease-correct');
    assert.deepEqual(await sourceCounts(), before);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ProspectAction" WHERE "prospectId"=$1 AND action=\'converted\'', [approvedCase.id])).rows[0].n, 1);
    assert.equal((await call('owner', 'PATCH', `${prospects}/${convertedCase.id}`, editProspect(convertedCase))).statusCode, 409);
    assert.equal((await call('owner', 'POST', `${prospects}/${convertedCase.id}/stage`, { expectedVersion: convertedCase.version, stage: 'review', reason: 'Attempt an unreviewed unlink', submissionKey: randomUUID() })).statusCode, 409);
    await admin.query('UPDATE "ResidentContact" SET name=\'Changed source label\',version=version+1 WHERE id=\'pros-contact\'');
    await admin.query('UPDATE "Lease" SET status=\'ended\',"endsOn"=$1::date,version=version+1 WHERE id=\'pros-lease-correct\'', [shift(30)]);
    const replay = ok(await call('owner', 'POST', `${prospects}/${convertedCase.id}/convert`, conversionPayload)).prospect;
    assert.equal(replay.id, convertedCase.id);
    assert.equal(replay.stage, 'converted');
    assert.equal(replay.version, convertedCase.version);
    assert.deepEqual(await sourceCounts(), before);
    await admin.query('UPDATE "CompanyMembership" SET status=\'disabled\' WHERE "userId"=\'manager\'');
    try { assert.equal((await call('manager', 'POST', `${prospects}/${convertedCase.id}/convert`, conversionPayload)).statusCode, 403); }
    finally { await admin.query('UPDATE "CompanyMembership" SET status=\'active\' WHERE "userId"=\'manager\''); }
  });

  await t.test('conversion corrections reopen only the prospect link and retain immutable original source evidence', async () => {
    const body = { expectedVersion: convertedCase.version, confirmedUnlink: true, reason: 'Correct the selected prospect-to-lease association after review', submissionKey: randomUUID() };
    assert.equal((await call('owner', 'POST', `${prospects}/${convertedCase.id}/reopen-conversion`, { ...body, confirmedUnlink: false })).statusCode, 400);
    const leaseBefore = (await admin.query('SELECT * FROM "Lease" WHERE id=\'pros-lease-correct\'')).rows[0];
    const contactBefore = (await admin.query('SELECT * FROM "ResidentContact" WHERE id=\'pros-contact\'')).rows[0];
    const reopened = ok(await call('owner', 'POST', `${prospects}/${convertedCase.id}/reopen-conversion`, body)).prospect;
    assert.equal(reopened.stage, 'review');
    assert.equal(reopened.contactId, null);
    assert.equal(reopened.leaseId, null);
    assert.deepEqual((await admin.query('SELECT * FROM "Lease" WHERE id=\'pros-lease-correct\'')).rows[0], leaseBefore);
    assert.deepEqual((await admin.query('SELECT * FROM "ResidentContact" WHERE id=\'pros-contact\'')).rows[0], contactBefore);
    assert.equal(ok(await call('manager', 'POST', `${prospects}/${convertedCase.id}/reopen-conversion`, body)).prospect.version, reopened.version);
    assert.equal(ok(await call('owner', 'POST', `${prospects}/${convertedCase.id}/convert`, conversionPayload)).prospect.stage, 'review', 'replaying old conversion acknowledges current history without relinking corrected sources');
    const history = ok(await call('owner', 'GET', `${prospects}/${convertedCase.id}/history`));
    const correction = history.items.find(item => item.action === 'conversion.reopened');
    assert.equal(correction.snapshot.previousContactId, 'pros-contact');
    assert.equal(correction.snapshot.previousLeaseId, 'pros-lease-correct');
    assert.ok(history.items.some(item => item.action === 'converted' && item.snapshot.leaseId === 'pros-lease-correct'));
  });

  await t.test('conversion and immutable action audit roll back together, leaving approved cases recoverable', async () => {
    await unit('pros-rollback-unit');
    await contactLease('pros-rollback-lease', 'pros-rollback-unit', 'pros-contact');
    let row = await newProspect({ name: 'pros-conversion-rollback', unitId: 'pros-rollback-unit' });
    row = await stage(row, 'approved');
    const contact = (await admin.query('SELECT version FROM "ResidentContact" WHERE id=\'pros-contact\'')).rows[0];
    const payload = conversion(row, { expectedContactVersion: contact.version, leaseId: 'pros-rollback-lease' });
    await admin.query("CREATE FUNCTION reject_prospect_conversion_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='prospect.converted' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_prospect_conversion_audit BEFORE INSERT ON \"AuditEvent\" FOR EACH ROW EXECUTE FUNCTION reject_prospect_conversion_audit()");
    try { assert.equal((await call('owner', 'POST', `${prospects}/${row.id}/convert`, payload)).statusCode, 500); }
    finally { await admin.query('DROP TRIGGER reject_prospect_conversion_audit ON "AuditEvent"; DROP FUNCTION reject_prospect_conversion_audit()'); }
    const current = ok(await call('owner', 'GET', `${prospects}/${row.id}`)).prospect;
    assert.equal(current.stage, 'approved');
    assert.equal(current.version, row.version);
    assert.equal(current.contactId, null);
    assert.equal(current.leaseId, null);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ProspectAction" WHERE "prospectId"=$1 AND action=\'converted\'', [row.id])).rows[0].n, 0);
    ok(await call('owner', 'POST', `${prospects}/${row.id}/convert`, payload));
  });

  const sharingBase = '/api/company/leases/share-lease/documents/share-document/shares';
  const residentDocuments = '/api/resident/documents';
  const sharedFirst = Buffer.from('First explicitly shared fictional original.');
  const sharedLatest = Buffer.from('Later fictional original, requiring a separate reviewed share.');
  const shareVersion = async (id, number, content, scanStatus = 'unscanned', documentId = 'share-document') => admin.query(
    'INSERT INTO "DocumentVersion"(id,"companyId","documentId",number,filename,"mediaType","byteLength",sha256,content,"createdById","submissionKey","submissionHash","scanStatus","scannedAt") VALUES($1,\'a\',$2,$3,$4,\'text/plain\',$5,$6,$7,\'owner\',$1,\'fictional-fixture\',$8,CASE WHEN $8 IN (\'clean\',\'rejected\') THEN NOW() ELSE NULL END)',
    [id, documentId, number, `${id}.txt`, content.length, createHash('sha256').update(content).digest('hex'), content, scanStatus]);
  const sharePayload = (extra = {}) => ({ documentVersionId: 'share-version-1', userId: 'resident', expiresOn: shift(7), reason: 'Owner explicitly reviewed this original for the named leaseholder', expectedVersion: null, expectedDocumentVersion: 3, submissionKey: randomUUID(), ...extra });
  let primaryShare, secondaryShare, originalGrantPayload;

  await t.test('lease document sharing requires owner approval, exact available originals and current approved leaseholder authority', async () => {
    for (const [id, verified] of [['share-occupant', true], ['share-outsider', true], ['share-unapproved', true], ['share-removed', true], ['share-unverified', false]]) {
      await admin.query('INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES($1,$2,$1,$3,NOW())', [id, `${id}@test.invalid`, verified]);
      await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,\'a\',\'resident\',NOW())', [id]);
      await db.identity.create({ data: { userId: id, issuer: 'https://unused.auth0.com/', subject: id } });
    }
    await admin.query('INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES(\'share-foreign-resident\',\'share-foreign-resident@test.invalid\',\'Foreign fictional resident\',true,NOW())');
    await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES(\'share-foreign-resident\',\'b\',\'resident\',NOW())');
    await admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES(\'b\',\'foreign-home\',\'share-foreign-resident\')');
    await db.identity.create({ data: { userId: 'share-foreign-resident', issuer: 'https://unused.auth0.com/', subject: 'share-foreign-resident' } });
    await db.session.create({ data: { tokenHash: digest('token-share-foreign-resident'), csrfToken: 'csrf', userId: 'share-foreign-resident', expiresAt: new Date(Date.now() + 6 * 3600000), idleExpiresAt: new Date(Date.now() + 6 * 3600000) } });
    for (const id of ['resident', 'pros-other-resident', 'share-occupant', 'share-outsider', 'share-unapproved', 'share-removed', 'share-unverified', 'pros-noidentity']) {
      await admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES(\'a\',\'home\',$1) ON CONFLICT DO NOTHING', [id]);
      await db.session.upsert({ where: { tokenHash: digest(`token-${id}`) }, update: {}, create: { tokenHash: digest(`token-${id}`), csrfToken: 'csrf', userId: id, expiresAt: new Date(Date.now() + 6 * 3600000), idleExpiresAt: new Date(Date.now() + 6 * 3600000) } });
    }
    await unit('share-unit');
    await contactLease('share-lease', 'share-unit', 'pros-contact', { status: 'active' });
    await admin.query('UPDATE "Lease" SET "startsOn"=$1,"endsOn"=$2 WHERE id=\'share-lease\'', [shift(-30), shift(100)]);
    for (const [userId, role, approved, removed] of [['resident', 'leaseholder', true, false], ['pros-other-resident', 'leaseholder', true, false], ['share-occupant', 'occupant', true, false], ['share-unapproved', 'leaseholder', false, false], ['share-removed', 'leaseholder', true, true], ['share-unverified', 'leaseholder', true, false], ['pros-noidentity', 'leaseholder', true, false]])
      await admin.query('INSERT INTO "LeaseParticipant"(id,"companyId","propertyId","leaseId","userId",name,email,role,"startsOn","portalApproved","removedAt","createdById","submissionKey","submissionHash","updatedAt") VALUES($1,\'a\',\'home\',\'share-lease\',$2,$2,$3,$4,$5,$6,$7,\'owner\',$1,\'fictional-fixture\',NOW())', [`share-participant-${userId}`, userId, `${userId}@test.invalid`, role, shift(-20), approved, removed ? new Date() : null]);
    await admin.query('INSERT INTO "PrivateDocument"(id,"companyId","leaseId",title,version) VALUES(\'share-document\',\'a\',\'share-lease\',\'Fictional explicitly shared notice\',3),(\'share-other-document\',\'a\',\'share-lease\',\'A separate private original\',1)');
    await shareVersion('share-version-1', 1, sharedFirst);
    await shareVersion('share-version-2', 2, Buffer.from('Rejected fictional historical original.'), 'rejected');
    await shareVersion('share-version-3', 3, sharedLatest);
    await shareVersion('share-other-version', 1, Buffer.from('Separate original.'), 'clean', 'share-other-document');
    const managerView = ok(await call('manager', 'GET', sharingBase));
    assert.equal(managerView.document.id, 'share-document');
    assert.ok(managerView.eligibleResidents.some(person => person.id === 'resident'));
    assert.ok(managerView.eligibleResidents.some(person => person.id === 'pros-other-resident'));
    for (const id of ['share-occupant', 'share-outsider', 'share-unapproved', 'share-removed', 'share-unverified', 'pros-noidentity']) assert.ok(!managerView.eligibleResidents.some(person => person.id === id), id);
    assert.equal(ok(await call('resident', 'GET', residentDocuments)).total, 0);
    for (const user of ['manager', 'staff', 'resident', 'platform', 'support']) assert.equal((await call(user, 'POST', sharingBase, sharePayload())).statusCode, 403, user);
    for (const id of ['share-occupant', 'share-outsider', 'share-unapproved', 'share-removed', 'share-unverified', 'pros-noidentity', 'foreign']) {
      const denied = await call('owner', 'POST', sharingBase, sharePayload({ userId: id }));
      assert.ok([403, 404, 409].includes(denied.statusCode), `${id}: ${denied.body}`);
    }
    assert.equal((await call('owner', 'POST', sharingBase, sharePayload({ documentVersionId: 'share-version-2' }))).statusCode, 409);
    assert.ok([404, 409].includes((await call('owner', 'POST', sharingBase, sharePayload({ documentVersionId: 'share-other-version' }))).statusCode));
    assert.equal((await call('owner', 'POST', sharingBase, sharePayload({ reason: '' }))).statusCode, 400);
    assert.equal((await call('owner', 'POST', sharingBase, sharePayload({ expiresOn: shift(-1) }))).statusCode, 400);
    assert.equal((await call('owner', 'POST', sharingBase, sharePayload(), { 'x-csrf-token': 'invalid' })).statusCode, 403);
    assert.equal((await call('owner', 'POST', sharingBase, sharePayload(), { origin: 'https://untrusted.test' })).statusCode, 403);
    assert.equal((await call('foreign', 'GET', sharingBase)).statusCode, 404);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "LeaseDocumentShare"')).rows[0].n, 0);
  });

  await t.test('explicit grants pin exact file versions and expose only the named recipient projection and audited original bytes', async () => {
    originalGrantPayload = sharePayload();
    const grants = await Promise.all([call('owner', 'POST', sharingBase, originalGrantPayload), call('owner', 'POST', sharingBase, originalGrantPayload)]);
    for (const response of grants) assert.equal(response.statusCode, 200, response.body);
    primaryShare = grants[0].json().share;
    assert.equal(grants[1].json().share.id, primaryShare.id);
    assert.equal(primaryShare.documentVersionId, 'share-version-1');
    assert.equal(primaryShare.versionNumber, 1);
    secondaryShare = ok(await call('owner', 'POST', sharingBase, sharePayload({ userId: 'pros-other-resident', documentVersionId: 'share-version-3', reason: 'Different named leaseholder, explicitly selected third original' }))).share;
    const listed = ok(await call('resident', 'GET', residentDocuments));
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0].id, primaryShare.id);
    assert.equal(listed.items[0].versionNumber, 1);
    assert.doesNotMatch(JSON.stringify(listed), /Owner explicitly reviewed|Different named leaseholder|pros-other-resident|submissionHash|submissionKey|sha256|contentBase64|reason/);
    const downloaded = ok(await call('resident', 'GET', `${residentDocuments}/${primaryShare.id}/download`));
    assert.equal(Buffer.from(downloaded.contentBase64, 'base64').toString(), sharedFirst.toString());
    assert.equal((await call('pros-other-resident', 'GET', `${residentDocuments}/${primaryShare.id}/download`)).statusCode, 404);
    assert.equal((await call('share-occupant', 'GET', `${residentDocuments}/${primaryShare.id}/download`)).statusCode, 404);
    assert.equal((await call('share-foreign-resident', 'GET', `${residentDocuments}/${primaryShare.id}/download`)).statusCode, 404);
    const event = (await admin.query('SELECT "actorId",detail FROM "AuditEvent" WHERE action=\'document.shared.downloaded\' ORDER BY "createdAt" DESC LIMIT 1')).rows[0];
    assert.equal(event.actorId, 'resident');
    assert.equal(event.detail.shareId, primaryShare.id);
    assert.equal(event.detail.documentVersionId, 'share-version-1');
    await shareVersion('share-version-4', 4, Buffer.from('Fourth private version was never shared.'));
    await admin.query('UPDATE "PrivateDocument" SET version=4 WHERE id=\'share-document\'');
    assert.equal(ok(await call('resident', 'GET', residentDocuments)).items[0].versionNumber, 1);
    assert.equal(Buffer.from(ok(await call('resident', 'GET', `${residentDocuments}/${primaryShare.id}/download`)).contentBase64, 'base64').toString(), sharedFirst.toString());
    const stale = await call('owner', 'POST', sharingBase, sharePayload({ documentVersionId: 'share-version-4' }));
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "LeaseDocumentShare"')).rows[0].n, 2);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "LeaseDocumentShareAction" WHERE action=\'grant\' AND "shareId"=$1', [primaryShare.id])).rows[0].n, 1);
  });

  await t.test('resident shared-file reads recheck expiry, membership, approval, assignment, immutable scan verdicts and company feature access', async () => {
    const unavailable = async () => {
      assert.equal(ok(await call('resident', 'GET', residentDocuments)).total, 0);
      assert.equal((await call('resident', 'GET', `${residentDocuments}/${primaryShare.id}/download`)).statusCode, 404);
    };
    await admin.query('UPDATE "LeaseDocumentShare" SET "expiresOn"=$1 WHERE id=$2', [shift(-1), primaryShare.id]);
    await unavailable();
    await admin.query('UPDATE "LeaseDocumentShare" SET "expiresOn"=$1 WHERE id=$2', [today, primaryShare.id]);
    assert.equal(ok(await call('resident', 'GET', residentDocuments)).total, 1, 'expiry includes the whole company business day');
    await admin.query('UPDATE "LeaseDocumentShare" SET "expiresOn"=$1 WHERE id=$2', [shift(7), primaryShare.id]);
    await admin.query('DELETE FROM "ResidentPropertyAssignment" WHERE "companyId"=\'a\' AND "propertyId"=\'home\' AND "userId"=\'resident\'');
    await unavailable();
    await admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES(\'a\',\'home\',\'resident\')');
    await admin.query('UPDATE "LeaseParticipant" SET "portalApproved"=false WHERE id=\'share-participant-resident\'');
    await unavailable();
    await admin.query('UPDATE "LeaseParticipant" SET "portalApproved"=true WHERE id=\'share-participant-resident\'');
    await assert.rejects(admin.query('UPDATE "DocumentVersion" SET "scanStatus"=\'rejected\' WHERE id=\'share-version-1\''), /Document originals and scan verdicts are immutable/);
    assert.equal((await call('resident', 'GET', `${residentDocuments}/${primaryShare.id}/download`)).statusCode, 200);
    await admin.query('UPDATE "Lease" SET status=\'ended\' WHERE id=\'share-lease\'');
    await unavailable();
    await admin.query('UPDATE "Lease" SET status=\'active\' WHERE id=\'share-lease\'');
    await admin.query('UPDATE "CompanyMembership" SET status=\'disabled\' WHERE "userId"=\'resident\'');
    assert.equal((await call('resident', 'GET', residentDocuments)).statusCode, 403);
    await admin.query('UPDATE "CompanyMembership" SET status=\'active\' WHERE "userId"=\'resident\'');
    await policy({ documents: 'disabled' });
    assert.equal((await call('resident', 'GET', residentDocuments)).json().code, 'FEATURE_DISABLED');
    await policy({ leasing: 'disabled' });
    assert.equal((await call('resident', 'GET', residentDocuments)).json().code, 'FEATURE_DISABLED');
    await policy({ resident_portal: 'disabled' });
    assert.equal((await call('resident', 'GET', `${residentDocuments}/${primaryShare.id}/download`)).json().code, 'FEATURE_DISABLED');
    await policy({ documents: 'read_only' });
    assert.equal((await call('resident', 'GET', `${residentDocuments}/${primaryShare.id}/download`)).statusCode, 200);
    assert.equal((await call('owner', 'POST', sharingBase, sharePayload({ expectedVersion: primaryShare.version, expectedDocumentVersion: 4 }))).json().code, 'SUBSCRIPTION_READ_ONLY');
    await policy();
  });

  await t.test('owner revocation uses versions and durable audit receipts and cannot be undone by a stale grant replay', async () => {
    const revoke = { expectedVersion: primaryShare.version, reason: 'The owner withdrew the original file approval', submissionKey: randomUUID() };
    assert.equal((await call('manager', 'POST', `${sharingBase}/${primaryShare.id}/revoke`, revoke)).statusCode, 403);
    const revoked = ok(await call('owner', 'POST', `${sharingBase}/${primaryShare.id}/revoke`, revoke)).share;
    assert.equal(revoked.status, 'revoked');
    assert.equal(ok(await call('owner', 'POST', `${sharingBase}/${primaryShare.id}/revoke`, revoke)).share.version, revoked.version);
    assert.equal(ok(await call('owner', 'POST', sharingBase, originalGrantPayload)).share.status, 'revoked');
    assert.equal(ok(await call('resident', 'GET', residentDocuments)).total, 0);
    assert.equal((await call('resident', 'GET', `${residentDocuments}/${primaryShare.id}/download`)).statusCode, 404);
    const history = ok(await call('manager', 'GET', `${sharingBase}/${primaryShare.id}/history`));
    assert.ok(history.items.some(item => item.action === 'grant'));
    assert.ok(history.items.some(item => item.action === 'revoke'));
    assert.doesNotMatch(JSON.stringify(history), /submissionHash|submissionKey/);
    primaryShare = ok(await call('owner', 'POST', sharingBase, sharePayload({ expectedVersion: revoked.version, expectedDocumentVersion: 4, reason: 'Owner explicitly re-reviewed and restored this original grant' }))).share;
    assert.equal(primaryShare.status, 'active');
    assert.equal(ok(await call('resident', 'GET', residentDocuments)).total, 1);
    assert.equal(await db.leaseDocumentShare.count(), 0);
    await assert.rejects(pool.query('DELETE FROM "LeaseDocumentShareAction" WHERE false'), /permission denied/);
    await assert.rejects(pool.query('UPDATE "LeaseDocumentShare" SET "documentVersionId"=\'share-version-4\' WHERE false'), /permission denied/);
  });

  await t.test('source archival revokes all grants atomically and restoring a document never restores an old recipient grant', async () => {
    const documentPath = '/api/company/leases/share-lease/documents/share-document';
    await admin.query("CREATE FUNCTION reject_document_share_archive_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='document.share.source_archived' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_document_share_archive_audit BEFORE INSERT ON \"AuditEvent\" FOR EACH ROW EXECUTE FUNCTION reject_document_share_archive_audit()");
    try { assert.equal((await call('owner', 'PATCH', documentPath, { expectedVersion: 4, archived: true })).statusCode, 500); }
    finally { await admin.query('DROP TRIGGER reject_document_share_archive_audit ON "AuditEvent"; DROP FUNCTION reject_document_share_archive_audit()'); }
    assert.equal((await admin.query('SELECT "archivedAt" FROM "PrivateDocument" WHERE id=\'share-document\'')).rows[0].archivedAt, null);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "LeaseDocumentShare" WHERE "documentId"=\'share-document\' AND "revokedAt" IS NULL')).rows[0].n, 2);
    const archived = ok(await call('owner', 'PATCH', documentPath, { expectedVersion: 4, archived: true }));
    assert.equal(archived.version, 5);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "LeaseDocumentShare" WHERE "documentId"=\'share-document\' AND "revokedAt" IS NULL')).rows[0].n, 0);
    assert.equal(ok(await call('resident', 'GET', residentDocuments)).total, 0);
    assert.equal(ok(await call('pros-other-resident', 'GET', residentDocuments)).total, 0);
    assert.equal((await call('resident', 'GET', `${residentDocuments}/${primaryShare.id}/download`)).statusCode, 404);
    ok(await call('owner', 'PATCH', documentPath, { expectedVersion: 5, archived: false }));
    assert.equal(ok(await call('resident', 'GET', residentDocuments)).total, 0);
    assert.equal(ok(await call('pros-other-resident', 'GET', residentDocuments)).total, 0);
    const history = ok(await call('owner', 'GET', `${sharingBase}/${secondaryShare.id}/history`));
    assert.ok(history.items.some(item => item.action === 'source_archived'));
    const archiveAudit = (await admin.query('SELECT detail FROM "AuditEvent" WHERE action=\'document.share.source_archived\' AND "targetId"=\'share-document\'')).rows;
    assert.equal(archiveAudit.length, 1);
    assert.equal(archiveAudit[0].detail.revokedCount, 2);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "LeaseDocumentShareAction" WHERE action=\'source_archived\'')).rows[0].n, 2);
  });
  await documentAcknowledgmentCases(t, { admin, db, call, sharingBase, residentDocuments, sharePayload, policy, today, shift });
  await t.test('historical pending originals remain pending through owner grant, resident download and receipt',async()=>{
    const documentId=randomUUID(),versionId=randomUUID(),content=Buffer.from('Fictional retained original with no historical scan verdict.');
    await admin.query('INSERT INTO "PrivateDocument" (id,"companyId","leaseId",title) VALUES($1,\'a\',\'share-lease\',\'Retained no-verdict original\')',[documentId]);
    await shareVersion(versionId,1,content,'pending',documentId);
    const before=(await admin.query('SELECT "scanStatus","scannedAt" FROM "DocumentVersion" WHERE id=$1',[versionId])).rows[0];assert.deepEqual(before,{scanStatus:'pending',scannedAt:null});
    const base=`/api/company/leases/share-lease/documents/${documentId}/shares`,grant=ok(await call('owner','POST',base,sharePayload({documentVersionId:versionId,expectedDocumentVersion:1,reason:'Owner reviewed this retained original without inventing a scan verdict'}))).share;
    const visible=ok(await call('resident','GET',`${residentDocuments}/${grant.id}`));assert.equal(visible.document.scanStatus,'pending');
    const original=ok(await call('resident','GET',`${residentDocuments}/${grant.id}/download`));assert.deepEqual(Buffer.from(original.contentBase64,'base64'),content);
    assert.equal((await call('resident','POST',`${residentDocuments}/${grant.id}/received`,{expectedVersion:grant.version,submissionKey:randomUUID()})).statusCode,200);
    assert.deepEqual((await admin.query('SELECT "scanStatus","scannedAt" FROM "DocumentVersion" WHERE id=$1',[versionId])).rows[0],before);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE "targetId"=$1 AND action=\'document.scanned\'',[documentId])).rows[0].n,0);
  });
  await expenseImportCases(t, admin, call, app, db, pool);
});
