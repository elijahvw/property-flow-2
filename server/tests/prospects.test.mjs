import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerProspects } from '../dist/prospects.js';

const key = '7c546fa6-396a-4cb3-884c-e1e2a07f14cd';
const draft = { propertyId: 'property-a', unitId: null, name: 'Fictional inquiry', email: 'inquiry@test.invalid', phone: null, source: 'phone', desiredMoveIn: null, followUpOn: null, notes: null, reason: 'Record an incoming inquiry', submissionKey: key };
const principal = (role, platformRole = null) => ({ id: 'actor', status: 'active', emailVerified: true, platformRole, membership: role ? { companyId: 'a', role, status: 'active', company: { status: 'active' } } : null });
async function fixture(t, actor) {
  const app = Fastify(); t.after(() => app.close());
  let queried = false;
  registerProspects(app, { async $transaction() { queried = true; throw Error('Applicant data must not be queried.'); } }, async request => { request.principal = actor; request.appSession = { csrfToken: 'csrf' }; }, 'https://app.test');
  const call = (method, url, payload, headers = {}) => app.inject({ method, url, payload, headers: { origin: 'https://app.test', 'x-csrf-token': 'csrf', ...headers } });
  return { call, queried: () => queried };
}

test('prospect records and conversion sources deny staff, residents and platform-only authority before private queries', async t => {
  for (const actor of [principal('staff'), principal('resident'), principal(null, 'support'), principal(null, 'owner')]) {
    const f = await fixture(t, actor);
    for (const [method, url, payload] of [
      ['GET', '/api/company/prospects'], ['GET', '/api/company/prospects/prospect'],
      ['GET', '/api/company/prospects/prospect/history'], ['GET', '/api/company/prospects/prospect/conversion-options'],
      ['POST', '/api/company/prospects', draft],
      ['POST', '/api/company/prospects/prospect/stage', { expectedVersion: 1, stage: 'approved', reason: 'Manual decision', submissionKey: key }],
      ['POST', '/api/company/prospects/prospect/convert', { expectedVersion: 1, contactId: 'tenant', expectedContactVersion: 1, leaseId: 'lease', expectedLeaseVersion: 1, confirmedMatch: true, reason: 'Sources reviewed', submissionKey: key }],
      ['POST', '/api/company/prospects/prospect/reopen-conversion', { expectedVersion: 1, confirmedUnlink: true, reason: 'Correct the source selection', submissionKey: key }],
    ]) assert.equal((await f.call(method, url, payload)).statusCode, 403, `${method} ${url}`);
    assert.equal(f.queried(), false);
  }
});

test('inquiry validation rejects unsupported dossiers, missing contact information and arbitrary company selection', async t => {
  const f = await fixture(t, principal('manager'));
  for (const invalid of [
    { ...draft, ssn: 'not-collected' }, { ...draft, applicationFee: '5.00' },
    { ...draft, email: null, phone: null }, { ...draft, email: 'invalid' },
    { ...draft, source: 'screening_provider' }, { ...draft, name: '' },
    { ...draft, followUpOn: '2026-02-30' }, { ...draft, desiredMoveIn: 'not-a-date' },
    { ...draft, reason: '' }, { ...draft, notes: 'x'.repeat(2001) },
    { ...draft, submissionKey: 'not-a-durable-key' },
  ]) assert.equal((await f.call('POST', '/api/company/prospects', invalid)).statusCode, 400);
  assert.equal((await f.call('GET', '/api/company/prospects', undefined, { 'x-company-id': 'b' })).statusCode, 403);
  for (const url of ['/api/company/prospects?stage=screened', '/api/company/prospects?due=any', '/api/company/prospects?income=private', '/api/company/prospects?q=' + 'x'.repeat(201)]) assert.equal((await f.call('GET', url)).statusCode, 400);
  assert.equal(f.queried(), false);
});

test('conversion and unlink corrections require explicit human confirmation and reviewed source versions', async t => {
  const f = await fixture(t, principal('owner'));
  const conversion = { expectedVersion: 1, contactId: 'tenant', expectedContactVersion: 1, leaseId: 'lease', expectedLeaseVersion: 1, confirmedMatch: true, reason: 'Reviewed actual sources', submissionKey: key };
  for (const invalid of [{ ...conversion, confirmedMatch: false }, { ...conversion, expectedContactVersion: 0 }, { ...conversion, expectedLeaseVersion: undefined }, { ...conversion, reason: '' }, { ...conversion, userId: 'different-account' }]) assert.equal((await f.call('POST', '/api/company/prospects/prospect/convert', invalid)).statusCode, 400);
  assert.equal((await f.call('POST', '/api/company/prospects/prospect/reopen-conversion', { expectedVersion: 1, confirmedUnlink: false, reason: 'Correction', submissionKey: key })).statusCode, 400);
  assert.equal((await f.call('POST', '/api/company/prospects/prospect/stage', { expectedVersion: 1, stage: 'converted', reason: 'Bypass source checks', submissionKey: key })).statusCode, 400);
  assert.equal((await f.call('POST', '/api/company/prospects', draft, { origin: 'https://evil.test' })).statusCode, 403);
  assert.equal(f.queried(), false);
});
