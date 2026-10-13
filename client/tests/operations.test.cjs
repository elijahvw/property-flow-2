const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
function load(name) {
  const source = fs.readFileSync(path.join(__dirname, '../src/' + name + '.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', compiled)(mod, mod.exports);
  return mod.exports;
}
const { beginOperation } = load('operation-lifecycle');
const { loadProfile, AuthTimeoutError } = load('auth-profile');
function sink() {
  const events = [];
  return { events,
    startFeatureOperation: (name, options) => events.push({ type: 'start', name, options }),
    succeedFeatureOperation: (name, options) => events.push({ type: 'success', name, options }),
    failFeatureOperation: (name, reason, options) => events.push({ type: reason, name, options }),
  };
}
test('parallel operations have distinct keys and each completes exactly once', () => {
  const recorder = sink();
  const first = beginOperation(recorder, 'company.update');
  const second = beginOperation(recorder, 'company.update');
  second.succeed(); first.fail({ response: { status: 409 }, message: 'private email' });
  first.succeed(); second.abandon();
  assert.equal(recorder.events.length, 4);
  assert.notEqual(recorder.events[0].options.operationKey, recorder.events[1].options.operationKey);
  assert.equal(recorder.events[2].options.operationKey, recorder.events[1].options.operationKey);
  assert.equal(recorder.events[3].options.operationKey, recorder.events[0].options.operationKey);
  assert.deepEqual(recorder.events[3].options.context, { http_status: 409 });
  assert.doesNotMatch(JSON.stringify(recorder.events), /private email/);
});
test('unfinished operations time out and cannot later report success', async () => {
  const recorder = sink();
  const operation = beginOperation(recorder, 'auth.profile.load', 10);
  await new Promise(resolve => setTimeout(resolve, 30));
  operation.succeed();
  assert.equal(recorder.events.length, 2);
  assert.equal(recorder.events[1].type, 'error');
  assert.equal(recorder.events[1].options.context.error_code, 'OPERATION_TIMEOUT');
});
test('unmounted company loading records abandonment once', () => {
  const recorder = sink();
  const operation = beginOperation(recorder, 'company.details.load');
  operation.abandon(); operation.fail(null);
  assert.equal(recorder.events[1].type, 'abandoned');
  assert.equal(recorder.events.length, 2);
});
test('telemetry failures cannot break an application workflow', () => {
  const broken = {
    startFeatureOperation() { throw Error('SDK unavailable'); },
    succeedFeatureOperation() { throw Error('SDK unavailable'); },
    failFeatureOperation() { throw Error('SDK unavailable'); },
  };
  const operation = beginOperation(broken, 'company.update');
  assert.doesNotThrow(() => operation.succeed());
});
test('profile load succeeds with the real result and aborts its request scope afterward', async () => {
  let signal;
  const result = await loadProfile(async () => 'access-token', async (token, requestSignal) => {
    assert.equal(token, 'access-token'); signal = requestSignal;
    return { id: 'identity', role: 'admin' };
  }, 30);
  assert.equal(result.role, 'admin');
  assert.equal(signal.aborted, true);
});
test('a stalled token request expires and never starts a late profile request', async () => {
  let resolveToken, requested = false;
  const result = loadProfile(() => new Promise(resolve => { resolveToken = resolve; }),
    async () => { requested = true; }, 10);
  await assert.rejects(result, AuthTimeoutError);
  resolveToken('late-token');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(requested, false);
});
test('a stalled profile request is aborted and late completion cannot replace a timeout', async () => {
  let resolveProfile, signal;
  const result = loadProfile(async () => 'access-token', async (_token, requestSignal) => {
    signal = requestSignal; return new Promise(resolve => { resolveProfile = resolve; });
  }, 10);
  await assert.rejects(result, AuthTimeoutError);
  assert.equal(signal.aborted, true);
  resolveProfile({ role: 'admin' });
});
test('profile API errors propagate and the request scope is cleaned up', async () => {
  let signal;
  const error = { response: { status: 503 } };
  await assert.rejects(loadProfile(async () => 'token', async (_token, requestSignal) => {
    signal = requestSignal; throw error;
  }, 30), value => value === error);
  assert.equal(signal.aborted, true);
});
