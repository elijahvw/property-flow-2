import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { companyRoleGuide, permissions, companyScope, safeReturnTo, defaultDestination } from '../dist/access.js';
import { registerApplication } from '../dist/application.js';
import { digest, sameSecret, validSession, readAuthConfig, registerSessions } from '../dist/sessions.js';
const principal = (role, extra = {}) => ({ id: 'user-a', status: 'active', platformRole: null, membership: role ? { companyId: 'company-a', role, status: 'active', company: { status: 'active' } } : null, ...extra });
test('permissions deny unknown/default roles, disabled users, disabled memberships and suspended companies', () => {
  for (const role of [null, 'tenant', 'admin', 'nonsense']) assert.deepEqual(permissions(principal(role)), []);
  assert.deepEqual(permissions(principal('owner', { status: 'disabled' })), []);
  for (const [memberStatus, companyStatus] of [['disabled', 'active'], ['active', 'suspended']]) {
    const p = principal('owner'); p.membership.status = memberStatus; p.membership.company.status = companyStatus;
    assert.deepEqual(permissions(p), []);
  }
});
test('resident and staff cannot write properties; manager can; platform role is not a company bypass', () => {
  for (const role of ['resident', 'staff']) assert.throws(() => companyScope(principal(role), 'property.write'), /access/);
  assert.equal(companyScope(principal('manager'), 'property.write'), 'company-a');
  assert.throws(() => companyScope(principal(null, { platformRole: 'owner' }), 'property.read'), /access/);
  assert.throws(() => companyScope(principal('owner'), 'property.read', 'company-b'), /company/);
});
test('return paths cannot become off-site redirects or OAuth endpoints', () => {
  for (const path of ['//evil.test', 'https://evil.test', '/api/auth/login', '/account%2f%2fevil', '/company\\evil', '/invite#secret']) assert.equal(safeReturnTo(path), '/dashboard');
  assert.equal(safeReturnTo('/company/properties'), '/company/properties');
});
test('session expiry, CSRF comparisons and production configuration fail closed', () => {
  assert.equal(validSession({ expiresAt: new Date(2000), idleExpiresAt: new Date(1500) }, 1000), true);
  assert.equal(validSession({ expiresAt: new Date(2000), idleExpiresAt: new Date(1500) }, 1500), false);
  assert.equal(validSession({ expiresAt: new Date(900), idleExpiresAt: new Date(1500) }, 1000), false);
  assert.equal(sameSecret('same', 'same'), true); assert.equal(sameSecret('éééé', 'same'), false); assert.equal(sameSecret(undefined, 'same'), false);
  assert.equal(digest('token').length, 64);
  assert.throws(() => readAuthConfig({ NODE_ENV: 'production', AUTH0_DOMAIN: 'example.auth0.com' }), /HTTPS/);
});
test('real Fastify routes deny resident writes, platform bypass, forged company and missing login before database work', async t => {
  for (const [user, method, url, headers, expected] of [
    [principal('resident'), 'POST', '/api/company/properties', {}, 403],
    [principal('manager'), 'GET', '/api/company/properties', { 'x-company-id': 'company-b' }, 403],
    [principal(null, { platformRole: 'owner' }), 'GET', '/api/company/properties', {}, 403],
    [principal('owner'), 'GET', '/api/platform/users', {}, 403],
    [null, 'GET', '/api/platform/users', {}, 401],
  ]) {
    const app = Fastify(); t.after(() => app.close());
    registerApplication(app, new Proxy({}, { get() { throw new Error('Unauthorized database access'); } }), async (request, reply) => {
      if (!user) return reply.code(401).send({ error: 'Unauthorized' }); request.principal = user;
    }, 'https://example.test');
    const response = await app.inject({ method, url, headers, ...(method === 'POST' ? { payload: {} } : {}) });
    assert.equal(response.statusCode, expected, response.body);
  }
});
test('session middleware enforces origin AND CSRF token; logout destroys session', async t => {
  const user = principal('manager'); let deleted = 0;
  const session = { tokenHash: digest('valid'), csrfToken: 'csrf-token', user, expiresAt: new Date(Date.now() + 3600000), idleExpiresAt: new Date(Date.now() + 7200000) };
  const db = { session: { findUnique: async ({where}) => where.tokenHash === session.tokenHash ? session : null, deleteMany: async () => { deleted++; return { count: 1 }; } }, auditEvent: { create: async () => ({}) }, $transaction: async actions => Promise.all(actions) };
  const app = Fastify(); t.after(() => app.close());
  const auth = await registerSessions(app, db, { origin: 'https://example.test', domain: 'example.auth0.com', clientId: 'web', clientSecret: 'test-only', secure: true });
  app.post('/api/write', { preValidation: auth }, async () => ({ ok: true }));
  for (const headers of [{}, { origin: 'https://evil.test', 'x-csrf-token': 'csrf-token' }, { origin: 'https://example.test' }]) {
    const response = await app.inject({ method: 'POST', url: '/api/write', headers: { cookie: '__Host-pf-session=valid', ...headers } });
    assert.equal(response.statusCode, 403);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/write', headers: { cookie: '__Host-pf-session=valid', origin: 'https://example.test', 'x-csrf-token': 'csrf-token' } })).statusCode, 200);
  const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: '__Host-pf-session=valid', origin: 'https://example.test', 'x-csrf-token': 'csrf-token' } });
  assert.equal(logout.statusCode, 200); assert.equal(deleted, 1); assert.match(logout.headers['set-cookie'], /Expires=Thu, 01 Jan 1970/);
});

test('validated CloudFront viewers have independent login limits; spoofed/direct headers are rejected', async t => {
  const { loginRateKey } = await import('../dist/sessions.js');
  const headers = address => ({ 'x-propertyflow-origin': 'edge-test-secret', 'cloudfront-viewer-address': address });
  assert.equal(loginRateKey(headers('198.51.100.1:50000'), 'edge-test-secret', 'alb'), '198.51.100.1');
  assert.equal(loginRateKey(headers('[2001:db8::1]:50000'), 'edge-test-secret', 'alb'), '2001:db8::1');
  assert.throws(() => loginRateKey({ ...headers('198.51.100.1:50000'), 'x-propertyflow-origin':'forged' }, 'edge-test-secret', 'alb'), /public/);
  assert.throws(() => loginRateKey(headers('forged'), 'edge-test-secret', 'alb'), /visitor/);
  const app = Fastify(); t.after(() => app.close());
  await registerSessions(app, {}, { origin:'https://example.test',domain:'unused.auth0.com',clientId:'test',clientSecret:'test-only',secure:true,originSecret:'edge-test-secret' });
  app.get('/api/throttle-test', {config:{rateLimit:{max:2,timeWindow:'1 minute'}}}, async()=>({ok:true}));
  for (const port of ['40000','40001']) assert.equal((await app.inject({url:'/api/throttle-test',headers:headers(`198.51.100.1:${port}`)})).statusCode,200);
  assert.equal((await app.inject({url:'/api/throttle-test',headers:headers('198.51.100.1:40002')})).statusCode,429);
  assert.equal((await app.inject({url:'/api/throttle-test',headers:headers('198.51.100.2:40000')})).statusCode,200);
  assert.equal((await app.inject({url:'/api/throttle-test',headers:{'cloudfront-viewer-address':'198.51.100.2:40000'}})).statusCode,403);
});

// Every server-selected landing is a terminal workspace, never /dashboard itself.
test('role landings include unassigned and disabled states without redirect loops', () => {
  for (const [user, expected] of [
    [principal('owner'), '/company/overview'], [principal('manager'), '/company/overview'],
    [principal('staff'), '/company/overview'], [principal('resident'), '/resident'],
    [principal(null), '/access'], [principal('tenant'), '/access'],
    [principal('owner', {status:'disabled'}), '/access'],
    [principal(null, {platformRole:'owner'}), '/platform/companies'],
  ]) assert.equal(defaultDestination(user), expected);
});
test('invalid callback binding expires locally without contacting the identity provider', async t => {
  const app = Fastify(); t.after(() => app.close());
  const db = { loginTransaction: { findUnique: async () => null } };
  await registerSessions(app, db, {origin:'https://example.test',domain:'unused.auth0.com',clientId:'test',clientSecret:'test-only',secure:true});
  for (const url of ['/api/auth/callback', '/api/auth/callback?state=unknown']) {
    const response = await app.inject({url});
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, '/?authError=expired');
    assert.match(response.headers['set-cookie'], /Expires=Thu, 01 Jan 1970/);
  }
});

test('role guidance uses the enforced grants and distinguishes company ownership from platform authority',()=>{
 for(const row of companyRoleGuide())assert.deepEqual(row.permissions,permissions(principal(row.role)));
 assert.equal(companyRoleGuide()[0].label,'Company owner');
 assert.ok(!companyRoleGuide().find(r=>r.role==='manager').permissions.includes('members.manage'));
});

test('sign-in retains allowlisted task context and rejects redirect tricks or private invitation material',()=>{
 assert.equal(safeReturnTo('/company/leases/record?section=renewal&propertyId=home'),'/company/leases/record?section=renewal&propertyId=home');
 assert.equal(safeReturnTo('/company/residents/auth0%7Cperson?access=active'),'/company/residents/auth0%7Cperson?access=active');
 assert.equal(safeReturnTo('/invite?token=private-test-only&lease=1'),'/invite');
 for(const path of ['/company/a/../platform/users','/company/%2e%2e/platform','/company/a%2fb','/company/%252f','/company/record%0a'])assert.equal(safeReturnTo(path),'/dashboard');
 assert.equal(safeReturnTo('/company/leases?redirect=https://evil.test&section=overview'),'/company/leases?section=overview');
});
