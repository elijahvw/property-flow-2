import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerCompanyManagement } from '../dist/company-management.js';

async function fixture(t, role = 'admin', overrides = {}) {
  const calls = [];
  const company = { id: 'company-one', name: 'One', domain: null, users: [], properties: [] };
  const db = { company: {
    findUnique: async args => { calls.push(args); return company; },
    update: async args => { calls.push(args); return { ...company, ...args.data }; },
    ...overrides,
  } };
  const app = Fastify();
  app.decorateRequest('dbUser', null);
  registerCompanyManagement(app, db, [async (request, reply) => {
    if (!role) return reply.code(401).send({ error: 'Unauthorized' });
    request.dbUser = { role };
  }]);
  t.after(() => app.close());
  return { app, calls };
}

test('company details query uses only the selected company and limits user fields', async t => {
  const { app, calls } = await fixture(t);
  const result = await app.inject('/api/companies/company-one');
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls[0].where, { id: 'company-one' });
  assert.deepEqual(calls[0].include.users.select, { id: true, name: true, email: true, role: true });
});

test('anonymous and non-admin users cannot read or edit a company', async t => {
  for (const [role, status] of [[null, 401], ['tenant', 403], ['landlord', 403]]) {
    const { app, calls } = await fixture(t, role);
    assert.equal((await app.inject('/api/companies/company-one')).statusCode, status);
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/companies/company-one', payload: { name: 'Changed', domain: null } })).statusCode, status);
    assert.equal(calls.length, 0);
  }
});

test('save changes only the selected company, trims the name, and clears empty domains', async t => {
  const { app, calls } = await fixture(t);
  const result = await app.inject({ method: 'PATCH', url: '/api/companies/company-two', payload: { name: ' Updated ', domain: ' ' } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls[0], { where: { id: 'company-two' }, data: { name: 'Updated', domain: null } });
});

test('domain lookup is normalized to lower case', async t => {
  const { app, calls } = await fixture(t);
  await app.inject({ method: 'PATCH', url: '/api/companies/company-one', payload: { name: 'One', domain: ' Example.COM ' } });
  assert.equal(calls[0].data.domain, 'example.com');
});

test('invalid or blank company data cannot be saved', async t => {
  const { app, calls } = await fixture(t);
  for (const payload of [{ name: '   ', domain: null }, { name: '', domain: null }, { name: 'One' }, { name: 8, domain: {} }]) {
    const result = await app.inject({ method: 'PATCH', url: '/api/companies/company-one', payload });
    assert.equal(result.statusCode, 400);
  }
  assert.equal(calls.length, 0);
});

test('missing companies and domain conflicts return actionable errors', async t => {
  const { app } = await fixture(t, 'admin', {
    findUnique: async () => null,
    update: async () => { throw { code: 'P2002' }; },
  });
  assert.equal((await app.inject('/api/companies/missing')).statusCode, 404);
  const result = await app.inject({ method: 'PATCH', url: '/api/companies/company-one', payload: { name: 'One', domain: 'used.test' } });
  assert.equal(result.statusCode, 409);
  assert.match(result.json().error, /another company/);
});

test('saving a missing company returns 404 and unexpected failures return sanitized 503', async t => {
  for (const [code, status] of [['P2025', 404], ['P1001', 503]]) {
    const { app } = await fixture(t, 'admin', { update: async () => { throw { code, message: 'private database details' }; } });
    const result = await app.inject({ method: 'PATCH', url: '/api/companies/missing', payload: { name: 'One', domain: null } });
    assert.equal(result.statusCode, status);
    assert.doesNotMatch(result.body, /private database details/);
  }
});
