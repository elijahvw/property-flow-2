import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveFeatures, memberRouteFeatures, requireFeatures, routeFeatures } from '../dist/company-features.js';

const instant = new Date('2026-10-24T12:00:00.000Z');
const subscription = (extra = {}) => ({ status: 'active', plan: { features: ['properties', 'leasing', 'maintenance'] }, featureOverrides: {}, ...extra });

test('existing unconfigured companies retain operating access; configured plans grant only included areas', () => {
  assert.ok(Object.values(effectiveFeatures(null)).every(value => value === 'enabled'));
  assert.ok(Object.values(effectiveFeatures(subscription({ plan: null }))).every(value => value === 'enabled'));
  const configured = effectiveFeatures(subscription());
  assert.equal(configured.maintenance, 'enabled');
  assert.equal(configured.finances, 'disabled');
  assert.equal(configured.resident_portal, 'disabled');
});

test('trial and override expiration boundaries are exclusive and cannot restore cancelled writes', () => {
  const overrides = subscription({ featureOverrides: { documents: 'enabled', leasing: 'read_only' }, overrideExpiresAt: instant });
  assert.equal(effectiveFeatures(overrides, new Date(instant.getTime() - 1)).documents, 'enabled');
  assert.equal(effectiveFeatures(overrides, instant).documents, 'disabled');
  assert.equal(effectiveFeatures(overrides, instant).leasing, 'enabled');
  const trial = subscription({ status: 'trial', trialEndsAt: instant });
  assert.equal(effectiveFeatures(trial, new Date(instant.getTime() - 1)).leasing, 'enabled');
  assert.equal(effectiveFeatures(trial, instant).leasing, 'read_only');
  for (const status of ['expired', 'suspended', 'cancelled']) {
    const policy = effectiveFeatures(subscription({ status, featureOverrides: { finances: 'enabled' } }), instant);
    assert.equal(policy.finances, 'read_only');
    assert.equal(policy.leasing, 'read_only');
    assert.equal(policy.documents, 'disabled');
  }
});

test('malformed persisted policy cannot become an enable grant', () => {
  for (const features of [null, {}, ['not-an-implemented-feature']])
    assert.ok(Object.values(effectiveFeatures(subscription({ plan: { features } }))).every(mode => mode === 'disabled'));
  assert.ok(Object.values(effectiveFeatures(subscription({ planId: 'missing', plan: null }))).every(mode => mode === 'disabled'));
  assert.equal(effectiveFeatures(subscription({ featureOverrides: { documents: 'anything' } })).documents, 'disabled');
  assert.equal(effectiveFeatures(subscription({ status: 'trial', trialEndsAt: 'not-a-date' })).leasing, 'read_only');
  assert.equal(effectiveFeatures(subscription({ status: 'unknown' })).leasing, 'read_only');
  assert.equal(effectiveFeatures(subscription({ featureOverrides: { documents: 'enabled' }, overrideExpiresAt: 'bad-date' })).documents, 'disabled');
});

test('nested routes retain parent dependencies and recovery routes remain independently reachable', () => {
  for (const parent of ['leases', 'maintenance'])
    assert.deepEqual(routeFeatures(`/api/company/${parent}/:sourceId/documents/:documentId/versions/:versionId/download`), ['documents', parent === 'leases' ? 'leasing' : 'maintenance']);
  assert.deepEqual(routeFeatures('/api/company/leases/:leaseId/inspections/:inspectionId'), ['inspections', 'leasing']);
  assert.deepEqual(routeFeatures('/api/company/leases/:leaseId/agreements/:agreementId'), ['agreements', 'leasing', 'documents']);
  assert.deepEqual(routeFeatures('/api/company/maintenance/:requestId/costs'), ['finances', 'maintenance']);
  assert.deepEqual(routeFeatures('/api/company/deposit-receipts/:receiptId/void'), ['finances', 'leasing']);
  assert.deepEqual(routeFeatures('/api/company/properties/:propertyId/residents/:userId'), ['leasing', 'properties']);
  assert.deepEqual(routeFeatures('/api/resident/leases/:leaseId/settlement'), ['finances', 'leasing', 'resident_portal']);
  assert.deepEqual(routeFeatures('/api/resident/maintenance/:requestId'), ['maintenance', 'resident_portal']);
  assert.deepEqual(routeFeatures('/api/company/reports'), ['reports', 'finances']);
  assert.deepEqual(routeFeatures('/api/account/notifications/:notificationId/open'), ['notifications']);
  assert.deepEqual(routeFeatures('/api/resident'), ['resident_portal']);
  assert.deepEqual(memberRouteFeatures('/api/account/notifications', 'resident'), ['notifications', 'resident_portal']);
  assert.deepEqual(memberRouteFeatures('/api/account/notifications', 'owner'), ['notifications']);
  assert.deepEqual(memberRouteFeatures('/api/account', 'resident'), []);
  for (const path of ['/api/bootstrap', '/api/auth/logout', '/api/platform/companies/:companyId/billing', '/api/company/subscription', '/api/company/billing/invoices/:invoiceId', '/api/company/usage', '/api/company', '/api/account', '/api/company/members/:userId', '/api/invitations/accept'])
    assert.deepEqual(routeFeatures(path), [], path);
});

test('read-only preserves reads while disabled areas reject all access including nested dependencies', () => {
  const policy = effectiveFeatures(subscription({ status: 'expired' }), instant);
  requireFeatures(policy, ['properties'], 'GET');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
    assert.throws(() => requireFeatures(policy, ['properties'], method), error => error.statusCode === 403 && error.code === 'SUBSCRIPTION_READ_ONLY');
  assert.throws(() => requireFeatures(policy, ['documents', 'leasing'], 'GET'), error => error.statusCode === 403 && error.code === 'FEATURE_DISABLED');
  requireFeatures(policy, [], 'POST');
});
