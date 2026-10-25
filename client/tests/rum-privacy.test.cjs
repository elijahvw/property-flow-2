const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/rum-privacy.ts'), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(mod, mod.exports);
const { rumPath, sanitizeRumItem, validRumCollector } = mod.exports;
const origin = 'https://app.test';
const meta = { app: { name: 'private-company', version: 'release-sha' }, user: { email: 'private@example.com' }, session: { id: 'random-session', attributes: { token: 'private' } }, page: { url: origin + '/company/properties/private-id/maintenance?token=private#private' }, browser: { name: 'Chrome', userAgent: 'private' }, view: { name: 'private' } };
test('RUM paths remove IDs, secrets, third-party hosts and unbounded path labels', () => {
  assert.equal(rumPath(meta.page.url, origin), '/company/properties/:id/maintenance');
  assert.equal(rumPath('https://private.example/private?token=private', origin), '/external');
  assert.equal(rumPath('/assets/private.js', origin), '/assets/:asset');
  assert.equal(rumPath('/x'.repeat(20), origin), '/unknown');
});
test('demo planning and lifecycle paths retain fixed operations while concealing generations, plans and credentials', () => {
  assert.equal(rumPath('/api/platform/sales-demos/blueprint?planHash=private-plan', origin), '/api/platform/sales-demos/blueprint');
  for (const action of ['plan', 'rebuild', 'resume', 'teardown', 'credentials']) {
    const url = `${origin}/api/platform/sales-demos/private-generation/${action}?planHash=private-plan&email=private-email#private-password`;
    const expected = `/api/platform/sales-demos/:id/${action}`;
    assert.equal(rumPath(url, origin), expected);
    const safe = sanitizeRumItem({ type: 'event', meta, payload: { name: 'faro.tracing.fetch', attributes: { 'http.url': url, 'http.method': 'POST', planHash: 'private-plan', credentials: 'private-password', body: '{"email":"private-email","password":"private-password"}' } } }, origin);
    assert.equal(safe.payload.attributes['http.url'], origin + expected);
    assert.deepEqual(Object.keys(safe.payload.attributes).sort(), ['http.method', 'http.url']);
    assert.doesNotMatch(JSON.stringify(safe), /private-|planHash|password|email|body/);
  }
});
test('Web Vitals retain measurements without DOM attribution or identity', () => {
  const safe = sanitizeRumItem({type:'measurement',meta,payload:{type:'web-vitals', values:{lcp:2400,delta:2,private:22,inp:Infinity},context:{rating:'good',element:'#private',interaction_target:'private',resource_url:'private'}}},origin);
  assert.deepEqual(safe.payload.values,{lcp:2400,delta:2});
  assert.equal(safe.meta.session.id,'random-session');
  assert.doesNotMatch(JSON.stringify(safe),/private|userAgent|email|interaction_target/);
});
test('exception errors retain category and frame position without messages or source values', () => {
  const safe = sanitizeRumItem({type:'exception',meta,payload:{type:'TypeError',value:'private',originalError:{message:'private'},stacktrace:{frames:[{filename:origin+'/assets/private.js?token=private',function:'private',lineno:123,colno:4}]},context:{private:'private'}}},origin);
  assert.equal(safe.payload.value,'Browser TypeError');
  assert.equal(safe.payload.stacktrace.frames[0].lineno,123);
  assert.doesNotMatch(JSON.stringify(safe),/private|originalError|token/);
});
test('resource and view events reconstruct safe timings and templates only', () => {
  for(const name of ['faro.performance.resource','view_changed','session_start']) {
    const safe=sanitizeRumItem({type:'event',meta,payload:{name,attributes:{name:meta.page.url,duration:'155',responseStatus:'503',httpHost:'private',body:'private',view_name:'private'},action:{name:'private'}}},origin);
    assert.equal(safe.payload.attributes.duration,'155');
    assert.doesNotMatch(JSON.stringify(safe),/private|httpHost|body|action/);
  }
  for(const type of ['log','future-signal']) assert.equal(sanitizeRumItem({type,meta,payload:{message:'private'}},origin),null);
  assert.equal(sanitizeRumItem({type:'event',meta,payload:{name:'click',attributes:{text:'private'}}},origin),null);
});
test('browser spans retain correlation and status without request content or error details', () => {
  const safe=sanitizeRumItem({type:'trace',meta,payload:{resourceSpans:[{resource:{attributes:[{key:'private',value:{stringValue:'private'}}]},scopeSpans:[{scope:{name:'private'},spans:[{traceId:'a'.repeat(32),spanId:'b'.repeat(16),name:'GET private',kind:3,startTimeUnixNano:'123',endTimeUnixNano:'456',attributes:[{key:'http.url',value:{stringValue:meta.page.url}},{key:'http.status_code',value:{intValue:503}},{key:'private',value:{stringValue:'private'}}],events:[{name:'private'}],links:[{private:'private'}],status:{code:2,message:'private'}}]}]}]}},origin);
  const span=safe.payload.resourceSpans[0].scopeSpans[0].spans[0];
  assert.equal(span.traceId,'a'.repeat(32)); assert.equal(span.status.code,2);
  assert.doesNotMatch(JSON.stringify(safe),/private|events|links|message/);
});
test('browser accepts only the reviewed public Faro collector, never OTLP credentials', () => {
  assert.equal(validRumCollector('https://faro-collector-prod-us-east-3.grafana.net/collect/'+'a'.repeat(32)),true);
  for(const value of [undefined,'http://localhost:4318','https://token@faro-collector-prod-us-east-3.grafana.net/collect/'+'a'.repeat(32),'https://evil.example/collect/'+'a'.repeat(32)]) assert.equal(validRumCollector(value),false);
});
