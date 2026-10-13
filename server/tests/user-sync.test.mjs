import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import auth0 from 'fastify-auth0-verify';
import { authenticate } from '../dist/authenticate.js';
import { synchronizeUser, UserProfileError } from '../dist/user-sync.js';

const claims = { sub: 'auth0|test-subject', 'https://propertyflow.com/roles': ['admin'] };
const profile = { sub: claims.sub, email: 'user@example.test', name: 'Test User' };

function fixture(existing = null) {
  const writes = [];
  const reads = [];
  const store = {
    async findUnique(args) { reads.push(args); return existing; },
    async upsert(args) {
      writes.push(args);
      assert.equal(typeof args.create.email, 'string');
      assert.ok(args.create.email.length > 0);
      return { companyId: null, name: null, ...args.create };
    },
  };
  return { store, writes, reads };
}

test('first login without email claims resolves the matching Auth0 profile', async () => {
  const { store, writes } = fixture();
  const user = await synchronizeUser(store, claims, async () => profile);
  assert.equal(user.email, profile.email);
  assert.equal(user.name, profile.name);
  assert.equal(user.role, 'admin');
  assert.equal(writes[0].create.id, claims.sub);
});

test('existing profile is retained without an Auth0 lookup and roles still refresh', async () => {
  const existing = { id: claims.sub, email: profile.email, name: profile.name, role: 'tenant', companyId: 'company-a' };
  const { store, writes } = fixture(existing);
  const user = await synchronizeUser(store, claims, async () => { throw new Error('must not fetch'); });
  assert.equal(user.email, profile.email);
  assert.equal(writes[0].update.name, profile.name);
  assert.equal(writes[0].update.role, 'admin');
  assert.equal('companyId' in writes[0].update, false);
});

test('signed profile claims avoid the remote lookup and preserve omitted name updates', async () => {
  const { store, reads, writes } = fixture();
  await synchronizeUser(store, { ...claims, email: profile.email }, async () => { throw new Error('must not fetch'); });
  assert.equal(reads.length, 0);
  assert.equal(writes[0].update.name, undefined);
});

for (const [name, result, status, code] of [
  ['mismatched identity', { ...profile, sub: 'auth0|another-user' }, 401, 'IDENTITY_SUBJECT_MISMATCH'],
  ['missing email', { sub: claims.sub }, 422, 'IDENTITY_EMAIL_MISSING'],
  ['blank email', { sub: claims.sub, email: ' ' }, 422, 'IDENTITY_EMAIL_MISSING'],
]) {
  test(name + ' fails before any database write', async () => {
    const { store, writes } = fixture();
    await assert.rejects(synchronizeUser(store, claims, async () => result),
      error => error instanceof UserProfileError && error.status === status && error.code === code);
    assert.equal(writes.length, 0);
  });
}

test('profile lookup failure is sanitized and does not leak bearer tokens', async () => {
  const { store, writes } = fixture();
  await assert.rejects(synchronizeUser(store, claims, async () => {
    const error = new Error('network error with private-test-bearer');
    error.config = { headers: { Authorization: 'Bearer private-test-bearer' } };
    throw error;
  }), error => error.status === 502 && error.code === 'IDENTITY_PROFILE_UNAVAILABLE' &&
    !JSON.stringify(error).includes('private-test-bearer') && !error.message.includes('private-test-bearer'));
  assert.equal(writes.length, 0);
});

test('profile response cannot grant roles and missing subject cannot create a user', async () => {
  const { store, writes } = fixture();
  const user = await synchronizeUser(store, { sub: claims.sub }, async () => ({
    ...profile, 'https://propertyflow.com/roles': ['admin'],
  }));
  assert.equal(user.role, 'tenant');
  await assert.rejects(synchronizeUser(store, {}, async () => profile), error => error.status === 401);
  assert.equal(writes.length, 1);
});

test('verified scope-only tokens complete profile, users and company routes', { timeout: 5000 }, async t => {
  const server = Fastify();
  t.after(() => server.close());
  const secret = 'local-profile-test-signing-secret';
  server.register(auth0, { secret, audience: 'property-flow-profile-test' });
  const { store } = fixture();
  const hooks = [authenticate(server), async request => {
    request.dbUser = await synchronizeUser(store, request.user, async () => profile);
  }];
  server.get('/api/me', { preValidation: hooks }, request => request.dbUser);
  server.get('/api/users', { preValidation: hooks }, request => {
    assert.equal(request.dbUser.role, 'admin');
    return [request.dbUser];
  });
  server.get('/api/companies', { preValidation: hooks }, request => {
    assert.equal(request.dbUser.role, 'admin');
    return [];
  });
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    ...claims, aud: 'property-flow-profile-test', scope: 'openid profile email',
  })).toString('base64url');
  const body = header + '.' + payload;
  const token = body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
  for (const url of ['/api/me', '/api/users', '/api/companies']) {
    const response = await server.inject({ method: 'GET', url, headers: { authorization: 'Bearer ' + token } });
    assert.equal(response.statusCode, 200, response.body);
  }
});
