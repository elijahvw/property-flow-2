const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
function load(file, mocks = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), compiled)(name => mocks[name] || require(name), mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
test('support navigation grants only impersonation while company roles stay scoped', () => {
  const { visibleRoutes } = load('navigation.ts');
  const support = visibleRoutes(['platform.impersonate']);
  assert(support.some(row => row.path === '/platform/impersonation'));
  assert(!support.some(row => ['/platform/users', '/platform/companies', '/platform/audit', '/company/properties'].includes(row.path)));
  assert(!visibleRoutes(['property.read']).some(row => row.path === '/platform/impersonation'));
});
test('requests carry the current context and stale-context rejection triggers a workspace reset', async () => {
  const calls = [], events = [];
  let mismatch = false;
  const { api, setImpersonationContext } = load('api.ts', { './browser-telemetry': { setTelemetrySession() {} } }, {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: !mismatch, status: mismatch ? 409 : 200, json: async () => mismatch ? { code: 'IMPERSONATION_CONTEXT_CHANGED' } : {} };
    }, window: { dispatchEvent: event => events.push(event.type) },
  });
  await api('/api/company/properties');
  assert.equal(calls[0].options.headers['X-Impersonation-ID'], '');
  setImpersonationContext('target:expiry');
  await api('/api/company/properties');
  assert.equal(calls[1].options.headers['X-Impersonation-ID'], 'target:expiry');
  mismatch = true;
  await assert.rejects(api('/api/company/properties'), error => error.code === 'IMPERSONATION_CONTEXT_CHANGED' && !error.submissionUncertain);
  assert.deepEqual(events, ['impersonation-context-changed']);
});
test('a read response arriving after the effective account changed is never returned', async () => {
  let complete;
  const events = [];
  const { api, setImpersonationContext } = load('api.ts', { './browser-telemetry': { setTelemetrySession() {} } }, {
    fetch: () => new Promise(resolve => { complete = resolve; }), window: { dispatchEvent: event => events.push(event.type) },
  });
  const response = api('/api/company/properties');
  setImpersonationContext('another-user:expiry');
  complete({ ok: true, json: async () => [{ id: 'prior-company-record' }] });
  await assert.rejects(response, error => error.code === 'IMPERSONATION_CONTEXT_CHANGED');
  assert.deepEqual(events, ['impersonation-context-changed']);
});
