import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerUnitAvailability } from '../dist/unit-availability.js';

const principal = (role, platformRole = null) => ({ id: 'actor', status: 'active', emailVerified: true, platformRole, membership: role ? { companyId: 'company-a', role, status: 'active', company: { status: 'active' } } : null });
async function fixture(t, user) {
  const app = Fastify();
  t.after(() => app.close());
  let queried = false;
  registerUnitAvailability(app, { async $transaction() { queried = true; throw Error('No source query was expected.'); } }, async request => {
    request.principal = user;
    request.appSession = { csrfToken: 'csrf' };
  }, 'https://app.test');
  const call = (method, url, payload, headers = {}) => app.inject({ method, url, payload, headers: { origin: 'https://app.test', 'x-csrf-token': 'csrf', ...headers } });
  return { call, queried: () => queried };
}

test('availability and readiness history require actual company management, not platform or resident access', async t => {
  for (const user of [principal('staff'), principal('resident'), principal(null, 'owner'), principal(null, 'support')]) {
    const f = await fixture(t, user);
    for (const [method, url, payload] of [
      ['GET', '/api/company/availability'],
      ['GET', '/api/company/units/unit/availability/history'],
      ['PUT', '/api/company/units/unit/availability', { expectedVersion: null, condition: 'turnover', availableOn: null, reason: 'Review turnover work', submissionKey: 'fa628d3c-aae9-4b19-b051-0924b38fc746' }],
    ]) assert.equal((await f.call(method, url, payload)).statusCode, 403);
    assert.equal(f.queried(), false);
  }
});

test('invalid planning filters and forged company context fail before reading unit or lease sources', async t => {
  const f = await fixture(t, principal('manager'));
  for (const url of [
    '/api/company/availability?asOf=2026-02-29',
    '/api/company/availability?status=vacant',
    '/api/company/availability?includeResidents=true',
    '/api/company/availability?cursor=invalid%20cursor',
    '/api/company/availability?q=' + 'a'.repeat(201),
    '/api/company/units/unit/availability/history?propertyId=another',
  ]) assert.equal((await f.call('GET', url)).statusCode, 400, url);
  assert.equal((await f.call('GET', '/api/company/availability', undefined, { 'x-company-id': 'company-b' })).statusCode, 403);
  assert.equal(f.queried(), false);
});

test('readiness changes require exact-origin CSRF, a reason and an optimistic source version', async t => {
  const f = await fixture(t, principal('owner'));
  const payload = { expectedVersion: null, condition: 'ready', availableOn: null, reason: 'Unit reviewed after turnover', submissionKey: 'fa628d3c-aae9-4b19-b051-0924b38fc746' };
  for (const headers of [{ origin: 'https://evil.test' }, { 'x-csrf-token': 'wrong' }]) assert.equal((await f.call('PUT', '/api/company/units/unit/availability', payload, headers)).statusCode, 403);
  for (const invalid of [
    { ...payload, reason: '' }, { ...payload, reason: 'a'.repeat(501) },
    { ...payload, expectedVersion: 0 }, { ...payload, expectedVersion: undefined },
    { ...payload, condition: 'occupied' }, { ...payload, availableOn: '2026-02-29' },
    { ...payload, submissionKey: 'not-a-durable-key' }, { ...payload, companyId: 'company-b' },
  ]) assert.equal((await f.call('PUT', '/api/company/units/unit/availability', invalid)).statusCode, 400);
  assert.equal(f.queried(), false);
});
