import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { registerApplication } from '../dist/application.js';
import { registerSessions, digest } from '../dist/sessions.js';
import { registerBrowserTelemetry } from '../dist/browser-telemetry.js';

const url = process.env.TEST_IMPERSONATION_DATABASE_URL;
test('impersonation preserves identity, company and read-only support boundaries', { skip: !url }, async t => {
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/propertyflow_impersonation_test');
  assert.equal(process.env.IMPERSONATION_DISPOSABLE, 'tmpfs-verified');
  const admin = new pg.Pool({ connectionString: url });
  t.after(() => admin.end());
  assert.equal((await admin.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n, 0);
  for (const name of readdirSync(new URL('../prisma/migrations/', import.meta.url)).filter(n => /^\d/.test(n)).sort())
    await admin.query(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
  await admin.query("ALTER ROLE propertyflow_runtime LOGIN PASSWORD 'impersonation-test-only'");
  const runtime = new URL(url);
  runtime.username = 'propertyflow_runtime';
  runtime.password = 'impersonation-test-only';
  const pool = new pg.Pool({ connectionString: runtime.href, max: 10 });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  t.after(async () => { await db.$disconnect(); await pool.end(); });
  const now = Date.now();
  for (const id of ['a', 'b', 'suspended'])
    await admin.query('INSERT INTO "Company"(id,name,status,"updatedAt") VALUES($1,$1,$2,NOW())', [id, id === 'suspended' ? 'suspended' : 'active']);
  for (const [id, company, role, platform, verified = true, status = 'active', identity = true] of [
    ['platform', null, null, 'owner'], ['support', null, null, 'support'], ['candidate', null, null, null],
    ['noidentity', null, null, null, true, 'active', false], ['unverified', 'a', 'manager', null, false],
    ['disabled', 'a', 'manager', null, true, 'disabled'], ['suspended-member', 'suspended', 'manager', null],
    ['owner', 'a', 'owner', null], ['manager', 'a', 'manager', null], ['staff', 'a', 'staff', null],
    ['resident', 'a', 'resident', null], ['other-resident', 'a', 'resident', null], ['foreign', 'b', 'manager', null],
  ]) {
    await admin.query('INSERT INTO "User"(id,email,name,"emailVerified","platformRole",status,"updatedAt") VALUES($1,$2,$1,$3,$4,$5,NOW())', [id, `${id}@test.invalid`, verified, platform, status]);
    if (identity) await db.identity.create({ data: { issuer: 'https://unused.auth0.com/', subject: id, userId: id } });
    if (company) await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"staffPropertyScope","updatedAt") VALUES($1,$2,$3,$4,NOW())', [id, company, role, role === 'staff' ? 'selected' : 'all']);
    await db.session.create({ data: { tokenHash: digest(`token-${id}`), csrfToken: 'csrf', userId: id, expiresAt: new Date(now + 3600000), idleExpiresAt: new Date(now + 3600000) } });
  }
  for (const [id, company] of [['home', 'a'], ['hidden-home', 'a'], ['foreign-home', 'b']])
    await admin.query('INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES($1,$1,\'street\',\'city\',\'state\',\'zip\',$2,NOW())', [id, company]);
  await admin.query('INSERT INTO "StaffPropertyAccess"("companyId","propertyId","userId") VALUES(\'a\',\'home\',\'staff\')');
  await admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES(\'a\',\'home\',\'resident\'),(\'a\',\'hidden-home\',\'other-resident\')');
  for (const [id, propertyId, requester] of [['repair', 'home', 'resident'], ['other-repair', 'hidden-home', 'other-resident']])
    await admin.query('INSERT INTO "MaintenanceRequest"(id,"companyId","propertyId","requesterId",title,description,"updatedAt") VALUES($1,\'a\',$2,$3,$1,\'Isolated fictional support fixture\',NOW())', [id, propertyId, requester]);
  const content = Buffer.from('Isolated fictional support test document.');
  await admin.query('INSERT INTO "PrivateDocument"(id,"companyId","requestId",title) VALUES(\'document\',\'a\',\'repair\',\'Support fixture\')');
  await admin.query('INSERT INTO "DocumentVersion"(id,"companyId","documentId",number,filename,"mediaType","byteLength",sha256,content,"createdById","submissionKey","submissionHash","scanStatus") VALUES(\'version\',\'a\',\'document\',1,\'support.txt\',\'text/plain\',$1,$2,$3,\'manager\',\'support-fixture\',\'fixture\',\'clean\')', [content.length, createHash('sha256').update(content).digest('hex'), content]);

  const app = Fastify();
  t.after(() => app.close());
  const auth = await registerSessions(app, db, { origin: 'https://app.test', domain: 'unused.auth0.com', clientId: 'test', clientSecret: 'test-only', secure: true });
  registerApplication(app, db, auth, 'https://app.test');
  registerBrowserTelemetry(app, auth);
  const state = new Map();
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  const call = (user, method, path, payload, extra = {}) => {
    const context = state.get(user);
    return app.inject({ method, url: path, headers: {
      ...(user ? { cookie: `__Host-pf-session=token-${user}` } : {}), origin: 'https://app.test',
      'x-csrf-token': context?.csrfToken ?? 'csrf',
      ...(context?.impersonation?.contextId ? { 'x-impersonation-id': context.impersonation.contextId } : {}), ...extra,
    }, ...(payload === undefined ? {} : { payload }) });
  };
  const bootstrap = async user => { const body = ok(await call(user, 'GET', '/api/bootstrap')); state.set(user, body); return body; };
  const start = async (user, userId) => { const response = await call(user, 'POST', '/api/impersonation', { userId, reason: 'Test role access for support case' }); ok(response); return bootstrap(user); };
  const stop = async user => { ok(await call(user, 'DELETE', '/api/impersonation')); return bootstrap(user); };
  const supportVersion = async user => (await db.user.findUniqueOrThrow({ where: { id: user } })).updatedAt.toISOString();

  await t.test('only platform owner/support can select active verified company users', async () => {
    assert.equal((await call(null, 'GET', '/api/impersonation/users')).statusCode, 401);
    for (const role of ['owner', 'manager', 'staff', 'resident']) assert.equal((await call(role, 'GET', '/api/impersonation/users')).statusCode, 403);
    const directory = ok(await call('support', 'GET', '/api/impersonation/users'));
    assert.deepEqual(directory.items.map(u => u.id).sort(), ['foreign', 'manager', 'other-resident', 'owner', 'resident', 'staff']);
    assert.equal(JSON.stringify(directory).includes('managementNotes'), false);
    assert.deepEqual(ok(await call('support', 'GET', '/api/impersonation/users?role=staff&companyId=a')).items.map(u => u.id), ['staff']);
    for (const path of ['/api/platform/users', '/api/platform/companies', '/api/platform/support-access', '/api/platform/audit', '/api/company/properties']) assert.equal((await call('support', 'GET', path)).statusCode, 403);
    assert.equal((await call('support', 'GET', '/api/impersonation/users?role=admin')).statusCode, 400);
  });

  await t.test('owner delegates support without company or owner authority, version checks and atomic audits', async () => {
    const updatedAt = await supportVersion('candidate');
    const payload = { enabled: true, updatedAt };
    assert.equal((await call('support', 'PATCH', '/api/platform/users/candidate/support-access', payload)).statusCode, 403);
    for (const extra of [{ origin: 'https://evil.test' }, { 'x-csrf-token': 'bad' }]) assert.equal((await call('platform', 'PATCH', '/api/platform/users/candidate/support-access', payload, extra)).statusCode, 403);
    assert.equal((await call('platform', 'PATCH', '/api/platform/users/platform/support-access', { enabled: false, updatedAt: await supportVersion('platform') })).statusCode, 403);
    for (const user of ['unverified', 'disabled', 'noidentity']) assert.equal((await call('platform', 'PATCH', `/api/platform/users/${user}/support-access`, { enabled: true, updatedAt: await supportVersion(user) })).statusCode, 409);
    const saved = ok(await call('platform', 'PATCH', '/api/platform/users/candidate/support-access', payload));
    assert.equal(saved.platformRole, 'support');
    const grants = await bootstrap('candidate');
    assert.ok(grants.permissions.includes('platform.impersonate'));
    assert.equal(grants.permissions.includes('platform.manage'), false);
    assert.equal(grants.permissions.includes('property.read'), false);
    assert.equal((await call('platform', 'PATCH', '/api/platform/users/candidate/support-access', { ...payload, enabled: false })).statusCode, 409);
    assert.equal(await db.auditEvent.count({ where: { actorId: 'platform', targetId: 'candidate', action: 'platform.support.granted' } }), 1);
    await admin.query("CREATE FUNCTION reject_support_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='platform.support.revoked' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_support_audit BEFORE INSERT ON \"AuditEvent\" FOR EACH ROW EXECUTE FUNCTION reject_support_audit()");
    try { assert.equal((await call('platform', 'PATCH', '/api/platform/users/candidate/support-access', { enabled: false, updatedAt: saved.updatedAt })).statusCode, 500); }
    finally { await admin.query('DROP TRIGGER reject_support_audit ON "AuditEvent"; DROP FUNCTION reject_support_audit()'); }
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: 'candidate' } })).platformRole, 'support');
  });

  await t.test('target restrictions, CSRF and malformed input cannot create an impersonation', async () => {
    for (const userId of ['platform', 'support', 'candidate', 'unverified', 'disabled', 'suspended-member', 'noidentity', 'missing']) {
      const result = await call('platform', 'POST', '/api/impersonation', { userId, reason: 'Support test' });
      assert.equal(result.statusCode, 403, `${userId}: ${result.body}`);
    }
    for (const extra of [{ origin: 'https://evil.test' }, { 'x-csrf-token': 'bad' }]) assert.equal((await call('platform', 'POST', '/api/impersonation', { userId: 'manager', reason: 'Support test' }, extra)).statusCode, 403);
    for (const payload of [{ userId: 'manager', reason: '' }, { userId: 'manager', reason: 'x'.repeat(201) }, { userId: 'manager', reason: 'Support test', role: 'owner' }]) assert.equal((await call('platform', 'POST', '/api/impersonation', payload)).statusCode, 400);
    assert.equal((await db.session.findUniqueOrThrow({ where: { tokenHash: digest('token-platform') } })).impersonatedUserId, null);
  });

  await t.test('staff sees its real property grants and cannot inherit original platform access', async () => {
    const b = await start('platform', 'staff');
    assert.equal(b.user.id, 'staff');
    assert.equal(b.membership.role, 'staff');
    assert.equal(b.membership.companyId, 'a');
    assert.ok(b.impersonation.contextId);
    assert.ok(b.impersonation.expiresAt);
    assert.equal(b.permissions.includes('platform.manage'), false);
    assert.equal((await db.session.findUniqueOrThrow({ where: { tokenHash: digest('token-platform') } })).userId, 'platform');
    assert.deepEqual(ok(await call('platform', 'GET', '/api/company/properties')).map(p => p.id), ['home']);
    assert.equal((await call('platform', 'GET', '/api/company/properties/hidden-home')).statusCode, 404);
    assert.equal((await call('platform', 'GET', '/api/company/properties/foreign-home')).statusCode, 404);
    assert.equal((await call('platform', 'GET', '/api/company/properties', undefined, { 'x-company-id': 'b' })).statusCode, 403);
    for (const path of ['/api/company/finances', '/api/company/members', '/api/platform/users', '/api/impersonation/users']) assert.equal((await call('platform', 'GET', path)).statusCode, 403);
    assert.equal((await call('platform', 'POST', '/api/impersonation', { userId: 'manager', reason: 'Nested support test' })).statusCode, 403);
    await stop('platform');
  });

  await t.test('manager reads one company; all writes fail before payload handling and target state stays unchanged', async () => {
    await start('support', 'manager');
    assert.deepEqual(ok(await call('support', 'GET', '/api/company/properties')).map(p => p.id).sort(), ['hidden-home', 'home']);
    const before = await admin.query('SELECT id,name,"updatedAt",version FROM "Property" ORDER BY id');
    const userBefore = await db.user.findUniqueOrThrow({ where: { id: 'manager' } });
    for (const [method, path] of [['POST', '/api/company/properties'], ['PATCH', '/api/company/properties/home'], ['PATCH', '/api/account'], ['PUT', '/api/account/guide'], ['POST', '/api/company/finances'], ['DELETE', '/api/platform/users/resident/membership']]) {
      const result = await call('support', method, path, {});
      assert.equal(result.statusCode, 403, `${method} ${path}: ${result.body}`);
      assert.equal(result.json().code, 'IMPERSONATION_READ_ONLY');
    }
    assert.deepEqual((await admin.query('SELECT id,name,"updatedAt",version FROM "Property" ORDER BY id')).rows, before.rows);
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: 'manager' } }), userBefore);
    assert.equal((await call('support', 'POST', '/api/telemetry', { events: [{ name: 'auth.session.restore', outcome: 'success', duration: 1 }] })).statusCode, 204);
    await stop('support');
  });

  await t.test('resident view follows actual assignment and requester identity', async () => {
    await start('support', 'resident');
    assert.deepEqual(ok(await call('support', 'GET', '/api/resident/properties')).map(p => p.id), ['home']);
    assert.equal((await call('support', 'GET', '/api/company/properties')).statusCode, 403);
    assert.equal((await call('support', 'GET', '/api/resident/maintenance/repair')).statusCode, 200);
    assert.equal((await call('support', 'GET', '/api/resident/maintenance/other-repair')).statusCode, 404);
    assert.equal((await call('support', 'POST', '/api/resident/maintenance', {})).json().code, 'IMPERSONATION_READ_ONLY');
    await stop('support');
  });

  await t.test('reads and mutations reject stale identity markers after starting and stopping', async () => {
    await start('platform', 'manager');
    const contextId = state.get('platform').impersonation.contextId;
    for (const marker of ['', 'forged']) {
      const response = await call('platform', 'GET', '/api/company/properties', undefined, { 'x-impersonation-id': marker });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().code, 'IMPERSONATION_CONTEXT_CHANGED');
    }
    await stop('platform');
    const stale = await call('platform', 'GET', '/api/platform/users', undefined, { 'x-impersonation-id': contextId });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().code, 'IMPERSONATION_CONTEXT_CHANGED');
    assert.equal((await call('platform', 'POST', '/api/company/properties', {}, { 'x-impersonation-id': contextId })).statusCode, 409);
    ok(await call('platform', 'GET', '/api/platform/users'));
  });

  await t.test('download and property view audits identify the support actor and impersonated user', async () => {
    await start('support', 'manager');
    ok(await call('support', 'GET', '/api/company/properties/home'));
    const download = ok(await call('support', 'GET', '/api/company/maintenance/repair/documents/document/versions/version/download'));
    assert.equal(Buffer.from(download.contentBase64, 'base64').toString(), content.toString());
    for (const action of ['property.viewed', 'document.downloaded']) {
      const event = await db.auditEvent.findFirstOrThrow({ where: { action }, orderBy: { createdAt: 'desc' } });
      assert.equal(event.actorId, 'support');
      assert.equal(event.detail.impersonatedUserId, 'manager');
      assert.equal(event.companyId, 'a');
    }
    const endedBefore = await db.auditEvent.count({ where: { actorId: 'support', action: 'impersonation.ended' } });
    await stop('support');
    await stop('support');
    assert.equal(await db.auditEvent.count({ where: { actorId: 'support', action: 'impersonation.ended' } }), endedBefore + 1);
  });

  await t.test('start is atomic with its audit and concurrent starts create only one context', async () => {
    await admin.query("CREATE FUNCTION reject_impersonation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='impersonation.started' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_impersonation_audit BEFORE INSERT ON \"AuditEvent\" FOR EACH ROW EXECUTE FUNCTION reject_impersonation_audit()");
    try { assert.equal((await call('platform', 'POST', '/api/impersonation', { userId: 'manager', reason: 'Atomic audit test' })).statusCode, 500); }
    finally { await admin.query('DROP TRIGGER reject_impersonation_audit ON "AuditEvent"; DROP FUNCTION reject_impersonation_audit()'); }
    assert.equal((await db.session.findUniqueOrThrow({ where: { tokenHash: digest('token-platform') } })).impersonatedUserId, null);
    const before = await db.auditEvent.count({ where: { actorId: 'platform', action: 'impersonation.started' } });
    const attempts = await Promise.all(Array.from({ length: 3 }, () => call('platform', 'POST', '/api/impersonation', { userId: 'manager', reason: 'Concurrent support test' })));
    assert.equal(attempts.filter(r => r.statusCode === 200).length, 1, attempts.map(r => r.body).join('\n'));
    assert.ok(attempts.every(r => [200, 403, 409].includes(r.statusCode)));
    assert.equal(await db.auditEvent.count({ where: { actorId: 'platform', action: 'impersonation.started' } }), before + 1);
    await bootstrap('platform');
    await stop('platform');
  });

  await t.test('expiry and changes to target access fail closed and stopping remains available', async () => {
    const cases = [
      ['expiry', () => admin.query('UPDATE "Session" SET "impersonationExpiresAt"=NOW()-interval \'1 second\' WHERE "userId"=\'support\'')],
      ['account disabled', () => admin.query('UPDATE "User" SET status=\'disabled\' WHERE id=\'manager\'')],
      ['email unverified', () => admin.query('UPDATE "User" SET "emailVerified"=false WHERE id=\'manager\'')],
      ['membership changed', () => admin.query('UPDATE "CompanyMembership" SET version=version+1,role=\'staff\' WHERE "userId"=\'manager\'')],
      ['company transfer', () => admin.query('UPDATE "CompanyMembership" SET version=version+1,"companyId"=\'b\' WHERE "userId"=\'manager\'')],
      ['company suspended', () => admin.query('UPDATE "Company" SET status=\'suspended\' WHERE id=\'a\'')],
      ['target now privileged', () => admin.query('UPDATE "User" SET "platformRole"=\'support\' WHERE id=\'manager\'')],
    ];
    for (const [label, change] of cases) {
      await start('support', 'manager');
      await change();
      const result = await call('support', 'GET', '/api/company/properties');
      assert.ok([403, 409].includes(result.statusCode), `${label}: ${result.body}`);
      const write = await call('support', 'PATCH', '/api/account', {});
      assert.ok([403, 409].includes(write.statusCode), `${label}: ${write.body}`);
      // Bootstrap reconciles the context before the explicit stop/recovery request.
      const unavailable = await bootstrap('support');
      assert.equal(unavailable.impersonation.unavailable, true, label);
      assert.deepEqual(unavailable.permissions, [], label);
      await stop('support');
      await admin.query('UPDATE "User" SET status=\'active\',"emailVerified"=true,"platformRole"=NULL WHERE id=\'manager\'');
      await admin.query('UPDATE "CompanyMembership" SET role=\'manager\',status=\'active\',"companyId"=\'a\' WHERE "userId"=\'manager\'');
      await admin.query('UPDATE "Company" SET status=\'active\' WHERE id=\'a\'');
    }
  });

  await t.test('owner revocation invalidates support sessions without restoring stale target requests', async () => {
    await start('candidate', 'manager');
    const context = state.get('candidate').impersonation.contextId;
    const revoked = ok(await call('platform', 'PATCH', '/api/platform/users/candidate/support-access', { enabled: false, updatedAt: await supportVersion('candidate') }));
    assert.equal(revoked.platformRole, null);
    const session = await db.session.findUniqueOrThrow({ where: { tokenHash: digest('token-candidate') } });
    assert.equal(session.impersonatedUserId, 'manager');
    assert.equal(session.impersonationExpiresAt.getTime(), 0);
    const stale = await call('candidate', 'GET', '/api/company/properties', undefined, { 'x-impersonation-id': context });
    assert.equal(stale.statusCode, 409, stale.body);
    const unavailable = await bootstrap('candidate');
    assert.equal(unavailable.impersonation.unavailable, true);
    assert.deepEqual(unavailable.permissions, []);
    await stop('candidate');
    const b = state.get('candidate');
    assert.equal(b.user.id, 'candidate');
    assert.equal(b.permissions.includes('platform.impersonate'), false);
    assert.equal((await call('candidate', 'POST', '/api/impersonation', { userId: 'manager', reason: 'Revoked attempt' })).statusCode, 403);
    const event = await db.auditEvent.findFirstOrThrow({ where: { action: 'impersonation.revoked', actorId: 'candidate', targetId: 'manager' } });
    assert.equal(event.detail.revokedBy, 'platform');
  });

  await t.test('actor access is fresh and logout revokes the original session with actor audit', async () => {
    await start('support', 'manager');
    await admin.query('UPDATE "User" SET status=\'disabled\' WHERE id=\'support\'');
    assert.equal((await call('support', 'GET', '/api/company/properties')).statusCode, 403);
    const disabled = await bootstrap('support');
    assert.equal(disabled.impersonation.unavailable, true);
    await stop('support');
    await admin.query('UPDATE "User" SET status=\'active\' WHERE id=\'support\'');
    await start('support', 'manager');
    await admin.query('UPDATE "User" SET "platformRole"=NULL WHERE id=\'support\'');
    const result = await call('support', 'GET', '/api/company/properties');
    assert.ok([403, 409].includes(result.statusCode), result.body);
    await bootstrap('support');
    await stop('support');
    await admin.query('UPDATE "User" SET "platformRole"=\'support\' WHERE id=\'support\'');
    await start('support', 'manager');
    ok(await call('support', 'POST', '/api/auth/logout', {}));
    assert.equal(await db.session.findUnique({ where: { tokenHash: digest('token-support') } }), null);
    assert.equal((await call('support', 'GET', '/api/bootstrap')).statusCode, 401);
    const revoked = await db.auditEvent.findFirstOrThrow({ where: { actorId: 'support', action: 'session.revoked' } });
    assert.equal(revoked.actorId, 'support');
    assert.equal(await db.auditEvent.count({ where: { actorId: 'manager', action: 'session.revoked' } }), 0);
  });

  await t.test('opaque external identity IDs produce a usable ASCII context header', async () => {
    const id = 'external|지원+opaque';
    await db.user.create({ data: {
      id, email: 'opaque-identity@test.invalid', name: 'Opaque identity fixture', emailVerified: true,
      identities: { create: { issuer: 'https://unused.auth0.com/', subject: id } },
      membership: { create: { companyId: 'a', role: 'manager' } },
    } });
    const b = await start('platform', id);
    assert.equal(b.user.id, id);
    assert.ok(b.impersonation.contextId.startsWith(`${encodeURIComponent(id)}:`));
    const header = new Headers({ 'X-Impersonation-ID': b.impersonation.contextId });
    assert.equal(header.get('X-Impersonation-ID'), b.impersonation.contextId);
    assert.deepEqual(ok(await call('platform', 'GET', '/api/company/properties')).map(p => p.id).sort(), ['hidden-home', 'home']);
    assert.equal(ok(await call('platform', 'GET', '/api/company/properties/home')).id, 'home');
    await stop('platform');
    assert.equal(state.get('platform').user.id, 'platform');
  });
});
