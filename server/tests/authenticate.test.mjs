import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import auth0 from 'fastify-auth0-verify';
import { authenticate } from '../dist/authenticate.js';

async function fixture(t) {
  const server = Fastify();
  server.register(auth0, { secret: 'local-test-signing-secret-not-a-production-credential', audience: 'property-flow-test' });
  const activity = { sync: 0, handler: 0 };
  const sync = async request => {
    assert.equal(request.user.sub, 'test-user');
    activity.sync++;
  };
  const hooks = [authenticate(server), sync];
  server.get('/api/me', { preValidation: hooks }, request => {
    activity.handler++;
    return { id: request.user.sub };
  });
  server.get('/api/companies', { preValidation: hooks }, () => {
    activity.handler++;
    return [];
  });
  server.post('/api/companies', { preValidation: hooks }, (request, reply) => {
    activity.handler++;
    return reply.code(201).send({ id: 'test-company', name: request.body.name });
  });
  await server.ready();
  t.after(() => server.close());
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'test-user', aud: 'property-flow-test' })).toString('base64url');
  const body = header + '.' + payload;
  const signature = createHmac('sha256', 'local-test-signing-secret-not-a-production-credential').update(body).digest('base64url');
  const token = body + '.' + signature;
  return { server, token, activity };
}

test('valid tokens complete profile, company listing and company creation', { timeout: 5000 }, async t => {
  const { server, token, activity } = await fixture(t);
  const headers = { authorization: 'Bearer ' + token };
  const profile = await server.inject({ method: 'GET', url: '/api/me', headers });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().id, 'test-user');
  const list = await server.inject({ method: 'GET', url: '/api/companies', headers });
  assert.equal(list.statusCode, 200);
  const created = await server.inject({ method: 'POST', url: '/api/companies', headers, payload: { name: 'Test Company' } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().name, 'Test Company');
  assert.deepEqual(activity, { sync: 3, handler: 3 });
});

for (const authorization of [undefined, 'Bearer invalid-token']) {
  test('missing or invalid token cannot reach company creation: ' + String(authorization), { timeout: 5000 }, async t => {
    const { server, activity } = await fixture(t);
    const response = await server.inject({
      method: 'POST', url: '/api/companies',
      headers: authorization ? { authorization } : {},
      payload: { name: 'Test Company' },
    });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(activity, { sync: 0, handler: 0 });
  });
}

test('missing authentication plugin fails closed', { timeout: 5000 }, async t => {
  const server = Fastify();
  t.after(() => server.close());
  let called = false;
  server.get('/protected', { preValidation: authenticate(server) }, () => { called = true; return {}; });
  const response = await server.inject('/protected');
  assert.equal(response.statusCode, 500);
  assert.equal(called, false);
});
