import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerCompanyUsage, usageRange } from '../dist/company-usage.js';

test('usage periods use inclusive UTC days, reject invalid dates and bound report scans', () => {
  const defaults = usageRange({}, new Date('2026-10-01T00:15:00Z'));
  assert.equal(defaults.from.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(defaults.to.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(usageRange({ from: '2024-02-29', to: '2025-02-28' }).to.toISOString(), '2025-02-28T00:00:00.000Z');
  for (const query of [
    { from: '2026-02-29', to: '2026-03-01' },
    { from: '2026-10-02', to: '2026-10-01' },
    { from: '2024-01-01', to: '2025-01-01' },
    { from: ['2026-10-01'] },
    { from: '2026-10-01T00:00:00Z' },
    { companyId: 'another-company' },
  ]) assert.throws(() => usageRange(query), error => error.statusCode === 400);
});

test('usage counts only successful operational requests in real member scope and never changes the response', async t => {
  const saved = [];
  let broken = false;
  const db = { companyFeatureUsage: { async upsert(record) { if (broken) throw Error('private database failure'); saved.push(record); } } };
  const app = Fastify();
  t.after(() => app.close());
  const actor = { id: 'actual-user', status: 'active', emailVerified: true, platformRole: null, membership: { companyId: 'actual-company', role: 'manager', status: 'active', company: { status: 'active' } } };
  registerCompanyUsage(app, db, async request => { request.principal = actor; });
  for (const path of ['/api/company/maintenance', '/api/company/maintenance/:requestId/documents', '/api/bootstrap', '/api/telemetry', '/api/platform/companies'])
    app.get(path, { preValidation: async request => {
      request.principal = actor;
      if (request.headers['x-test-impersonating']) request.impersonation = {};
    } }, async (request, reply) => reply.code(Number(request.headers['x-test-status'] || 200)).send({ source: 'kept' }));
  assert.equal((await app.inject({ url: '/api/company/maintenance', headers: { 'x-company-id': 'forged-company' } })).statusCode, 200);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].create.companyId, 'actual-company');
  assert.equal(saved[0].create.area, 'maintenance');
  assert.equal(saved[0].create.successfulReads, 1);
  await app.inject({ url: '/api/company/maintenance/record/documents' });
  assert.equal(saved.length, 2);
  assert.equal(saved[1].create.area, 'documents');
  for (const [url, headers] of [
    ['/api/company/maintenance', { 'x-test-status': '403' }],
    ['/api/company/maintenance', { 'x-test-impersonating': 'yes' }],
    ['/api/bootstrap', {}], ['/api/telemetry', {}], ['/api/platform/companies', {}],
  ]) await app.inject({ url, headers });
  assert.equal(saved.length, 2);
  broken = true;
  const response = await app.inject({ url: '/api/company/maintenance' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { source: 'kept' });
});

test('company usage denies non-owner roles and forged company selection before loading data', async t => {
  for (const [role, platformRole, selected] of [
    ['manager', null], ['staff', null], ['resident', null], [null, 'support'], [null, 'owner'], ['owner', null, 'another-company'],
  ]) {
    const app = Fastify();
    t.after(() => app.close());
    let queried = false;
    const db = { async $transaction() { queried = true; throw Error('Unexpected private data query'); } };
    registerCompanyUsage(app, db, async request => {
      request.principal = { id: 'user', status: 'active', emailVerified: true, platformRole,
        membership: role ? { companyId: 'own-company', role, status: 'active', company: { status: 'active' } } : null };
    });
    const response = await app.inject({ url: '/api/company/usage', headers: selected ? { 'x-company-id': selected } : {} });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(queried, false);
  }
});
