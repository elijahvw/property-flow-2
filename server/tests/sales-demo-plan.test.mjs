import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDemoBuildPlan, demoBlueprintPlan, demoEnvironment, demoPlanHash, readDemoBlueprint } from '../dist/sales-demo-plan.js';
import { FEATURE_CATALOG } from '../dist/company-features.js';

const blueprint = () => ({ format: 1, seedVersion: 4, anchorOn: '2026-10-25', environment: { name: 'dev', origin: 'https://app.test', identityIssuer: 'https://issuer.test/', provisioningAllowed: true } });
test('a blueprint is deterministic, complete and contains no issued credentials or business side effects', () => {
  const first = demoBlueprintPlan(blueprint()), second = demoBlueprintPlan(blueprint());
  assert.deepEqual(first, second);
  assert.equal(first.planHash, demoPlanHash(blueprint()));
  assert.deepEqual(first.inventory,{properties:2,unitsPerProperty:3,occupiedUnits:4,notOccupiedUnits:2,readyUnits:1,turnoverUnits:1});
  assert.equal(first.effects.dedicatedCompanies, 1); assert.equal(first.effects.preparedAccounts, 11); assert.equal(first.effects.issuedLogins, 8);
  assert.equal(first.roles.filter(role => !role.login).length, 3);
  assert.deepEqual(first.coverage.map(c => c.key).sort(), FEATURE_CATALOG.map(c => c.key).sort());
  assert.equal(first.effects.sendsExternalMessages, false); assert.equal(first.effects.movesMoney, false); assert.equal(first.effects.editsCustomerRecords, false); assert.equal(first.effects.preservesRetiredHistory, true);
  assert.ok(first.roles.every(role => !Object.hasOwn(role, 'password') && !Object.hasOwn(role, 'email')));
});
test('builds remain bound to the reviewed fixture, day, origin, issuer and declared environment', () => {
  const original = blueprint(); assert.doesNotThrow(() => assertDemoBuildPlan(original, blueprint()));
  for (const patch of [{ seedVersion: 5 }, { anchorOn: '2026-10-26' }]) assert.throws(() => assertDemoBuildPlan(original, { ...blueprint(), ...patch }), e => e.code === 'DEMO_PLAN_EXPIRED');
  for (const patch of [{ name: 'test' }, { origin: 'https://other.test' }, { identityIssuer: 'https://other-issuer.test/' }]) assert.throws(() => assertDemoBuildPlan(original, { ...blueprint(), environment: { ...original.environment, ...patch } }), e => e.code === 'DEMO_ENVIRONMENT_CHANGED');
  assert.throws(() => assertDemoBuildPlan(original, { ...blueprint(), environment: { ...original.environment, provisioningAllowed: false } }), e => e.code === 'DEMO_ENVIRONMENT_UNAVAILABLE');
});
test('plans remain readable disconnected and malformed persisted plans fail safely', () => {
  const before = { app: process.env.APP_ENV, disposable: process.env.SALES_DEMO_DISPOSABLE };
  try {
    process.env.APP_ENV = 'dev'; delete process.env.SALES_DEMO_DISPOSABLE;
    const disconnected = demoEnvironment('https://app.test/path');
    assert.equal(disconnected.origin, 'https://app.test'); assert.equal(disconnected.provisioningAllowed, false);
    assert.equal(demoBlueprintPlan({ ...blueprint(), environment: disconnected }).coverage.length, FEATURE_CATALOG.length);
    process.env.APP_ENV = 'production'; assert.equal(demoEnvironment('https://app.test', 'https://issuer.test/').provisioningAllowed, false);
    assert.equal(readDemoBlueprint(null), null);
    for (const value of [{}, [], 'invalid', { ...blueprint(), seedVersion: 0 }, { ...blueprint(), environment: null }]) assert.throws(() => readDemoBlueprint(value), e => e.code === 'DEMO_PLAN_INVALID');
  } finally {
    for (const [key, value] of [['APP_ENV', before.app], ['SALES_DEMO_DISPOSABLE', before.disposable]]) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});
