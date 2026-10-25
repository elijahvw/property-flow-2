import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { AccessError } from '../dist/access.js';
import { registerRequestErrors } from '../dist/request-errors.js';
import { IdentityProviderError } from '../dist/identity-provider.js';

test('malformed JSON, unsupported media and body limits return safe client errors', async t => {
  const failures = [];
  const app = Fastify({ bodyLimit: 64 });
  registerRequestErrors(app, (...args) => failures.push(args));
  app.post('/api/example', request => ({ saved: true, input: request.body }));
  t.after(() => app.close());
  for (const [payload, type, status] of [
    ['{"private@example.com":', 'application/json', 400],
    ['private@example.com', 'application/unsupported', 415],
    [JSON.stringify({ value: 'private@example.com'.repeat(10) }), 'application/json', 413],
  ]) {
    const result = await app.inject({ method: 'POST', url: '/api/example', headers: { 'content-type': type }, payload });
    assert.equal(result.statusCode, status, result.body);
    assert.equal(result.json().code, `REQUEST_${status}`);
    assert.ok(result.json().requestId);
    assert.doesNotMatch(result.body, /private@example.com|SyntaxError|5 MB|temporarily unavailable/);
  }
  assert.equal(failures.length, 0, 'invalid client input must not be counted as a service failure');
});

test('rate limits describe requests and preserve the retry header', async t => {
  const app = Fastify();
  registerRequestErrors(app);
  await app.register(rateLimit, { max: 1, timeWindow: '1 minute' });
  app.get('/api/example', () => ({ ok: true }));
  t.after(() => app.close());
  assert.equal((await app.inject('/api/example')).statusCode, 200);
  const result = await app.inject('/api/example');
  assert.equal(result.statusCode, 429);
  assert.equal(result.headers['retry-after'], '60');
  assert.match(result.json().error, /Too many requests/);
  assert.doesNotMatch(result.body, /sign-in/);
});

test('actionable access errors survive while internal failures stay private and observable', async t => {
  const failures = [];
  const app = Fastify();
  registerRequestErrors(app, (request, code, name) => failures.push({ id: request.id, code, name }));
  app.get('/api/access', () => { throw new AccessError(409, 'RECORD_CHANGED', 'Review the latest record before saving.'); });
  app.get('/api/internal', () => { throw new Error('private database credentials and parameters'); });
  app.get('/api/missing', () => { throw Object.assign(new Error('private record key'), { code: 'P2025' }); });
  t.after(() => app.close());
  const access = await app.inject('/api/access');
  assert.equal(access.statusCode, 409);
  assert.equal(access.json().code, 'RECORD_CHANGED');
  assert.equal(access.json().error, 'Review the latest record before saving.');
  const missing = await app.inject('/api/missing');
  assert.equal(missing.statusCode, 404);
  assert.doesNotMatch(missing.body, /private/);
  const internal = await app.inject('/api/internal');
  assert.equal(internal.statusCode, 503);
  assert.doesNotMatch(internal.body, /private|credentials|parameters/);
  assert.deepEqual(failures, [{ id: internal.json().requestId, code: 'REQUEST_503', name: 'Error' }]);
});

test('provider errors expose bounded retry guidance and only fixed safe diagnostic fields',async t=>{
 const logs=[];const app=Fastify({logger:{stream:{write:line=>logs.push(JSON.parse(line))}}});registerRequestErrors(app);
 app.post('/api/example',()=>{throw new IdentityProviderError('update','rate_limit',429,30);});
 app.post('/api/cooldown',()=>{throw new IdentityProviderError('lookup','rate_limit',undefined,30);});t.after(()=>app.close());
 const result=await app.inject({method:'POST',url:'/api/example'});assert.equal(result.statusCode,429);assert.equal(result.headers['retry-after'],'30');assert.equal(result.json().code,'IDENTITY_PROVIDER_UNAVAILABLE');assert.match(result.json().error,/30 seconds.*same request/);
 const warning=logs.find(row=>row.msg==='Request failed');assert.equal(warning.requestId,result.json().requestId);assert.equal(warning.providerOperation,'update');assert.equal(warning.providerFailure,'rate_limit');assert.equal(warning.providerStatus,429);assert.equal(warning.providerRateSource,'upstream');assert.equal(warning.retryAfterSeconds,30);
 const cooldown=await app.inject({method:'POST',url:'/api/cooldown'});assert.equal(cooldown.statusCode,429);assert.equal(cooldown.headers['retry-after'],'30');
 const cooldownLog=logs.find(row=>row.msg==='Request failed'&&row.requestId===cooldown.json().requestId);assert.equal(cooldownLog.providerRateSource,'cooldown');assert.ok(!Object.hasOwn(cooldownLog,'providerStatus'));
 for(const value of [result.json(),warning])assert.ok(!Object.hasOwn(value,'providerUrl')&&!Object.hasOwn(value,'providerBody')&&!Object.hasOwn(value,'email')&&!Object.hasOwn(value,'token'));
});
