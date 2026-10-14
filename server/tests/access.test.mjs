import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { permissions, companyScope, safeReturnTo } from '../dist/access.js';
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
