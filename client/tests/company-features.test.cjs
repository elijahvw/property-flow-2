const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function policyHelpers() {
  const source = fs.readFileSync(path.join(__dirname, '../src/company-features.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => name === './context/AuthContext' || name === 'react-router-dom' ? {} : require(name), mod, mod.exports);
  return mod.exports;
}

test('disabled company areas hide direct pages while billing recovery and permitted history remain available', () => {
  const { availableFeatureRoute } = policyHelpers();
  const policy = { properties: 'enabled', leasing: 'enabled', finances: 'disabled', reports: 'enabled', maintenance: 'read_only', documents: 'disabled' };
  for (const page of ['/company/rent', '/company/reports', '/company/leases/lease/statement', '/company/documents']) assert.equal(availableFeatureRoute(page, policy), false, page);
  for (const page of ['/company/properties', '/company/maintenance', '/company/leases/lease', '/company/subscription', '/company/settings', '/account']) assert.equal(availableFeatureRoute(page, policy), true, page);
  assert.equal(availableFeatureRoute('/company/rent', null), true, 'unconfigured legacy companies retain existing role-based behavior');
});

test('resident portal restriction also blocks Notifications navigation and direct page boundaries', () => {
  const { availableFeatureRoute, featureKeysForPage } = policyHelpers();
  const policy = { notifications: 'enabled', resident_portal: 'disabled' };
  assert.deepEqual(featureKeysForPage('/account/notifications', 'resident'), ['notifications', 'resident_portal']);
  assert.equal(availableFeatureRoute('/account/notifications', policy, 'resident'), false);
  assert.equal(availableFeatureRoute('/resident', policy, 'resident'), false);
  assert.equal(availableFeatureRoute('/account', policy, 'resident'), true);
  assert.equal(availableFeatureRoute('/account/notifications', policy, 'owner'), true);
});
