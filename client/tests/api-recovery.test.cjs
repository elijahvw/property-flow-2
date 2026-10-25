const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
function load(fetch, events = []) {
  const source = fs.readFileSync(path.join(__dirname, '../src/api.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = {exports:{}};
  new Function('module','exports','require','fetch','window',compiled)(mod,mod.exports,()=>({setTelemetrySession(){}}),fetch,{dispatchEvent(event){events.push(event.type);}});
  return mod.exports;
}
test('mutation transport failures and malformed replies carry an uncertain-submission marker',async()=>{
  for(const fetch of [async()=>{throw new TypeError('Transport interrupted');},async()=>({ok:true,json:async()=>{throw new SyntaxError('Invalid response');}})]) {
    const {api,ApiError}=load(fetch);
    await assert.rejects(api('/api/company/finances',{method:'POST',body:{submissionKey:'fixture'}}),error=>error instanceof ApiError&&error.submissionUncertain&&error.code==='SUBMISSION_UNCERTAIN');
  }
});

test('HTML and empty HTTP errors retain status, session recovery and submission certainty', async () => {
  for (const status of [401, 403, 429, 502]) {
    for (const method of ['GET', 'POST']) {
      const events = [];
      const { api, ApiError } = load(async () => ({
        ok: false, status, json: async () => { throw new SyntaxError('Unexpected token <'); },
      }), events);
      await assert.rejects(api('/api/fixture', { method }), error =>
        error instanceof ApiError && error.status === status &&
        error.submissionUncertain === (method === 'POST' && status >= 500) &&
        !error.message.includes('Unexpected token'));
      assert.deepEqual(events, status === 401 ? ['session-expired'] : []);
    }
  }
});

test('null JSON errors produce a recoverable HTTP error instead of a parsing failure', async () => {
  const { api, ApiError } = load(async () => ({ ok: false, status: 400, json: async () => null }));
  await assert.rejects(api('/api/fixture', { method: 'POST' }), error =>
    error instanceof ApiError && error.status === 400 && !error.submissionUncertain);
});

test('session expiry during support clears context without changing a definite 401 into an uncertain write', async () => {
  for (const malformed of [false, true]) {
    const seen = [];
    let client;
    const events = { push(type) {
      seen.push(type);
      if (type === 'session-expired') client.setImpersonationContext('');
    } };
    client = load(async () => ({ ok: false, status: 401, json: async () => {
      if (malformed) throw new SyntaxError('HTML response');
      return { error: 'Session expired.', code: 'UNAUTHENTICATED' };
    } }), events);
    client.setImpersonationContext('support-context');
    await assert.rejects(client.api('/api/company/resident-contacts', { method: 'POST' }), error =>
      error instanceof client.ApiError && error.status === 401 && !error.submissionUncertain);
    assert.deepEqual(seen, ['session-expired']);
  }
});
test('only mutation server errors need recovery; definitive rejection and GET failures do not',async()=>{
  for(const [method,status,uncertain] of [['POST',503,true],['POST',409,false],['POST',400,false],['GET',503,false]]) {
    const {api,ApiError}=load(async()=>({ok:false,status,json:async()=>({error:'Fixture response'})}));
    await assert.rejects(api('/api/fixture',{method}),error=>error instanceof ApiError&&error.status===status&&error.submissionUncertain===uncertain);
  }
  const {api,ApiError}=load(async()=>{throw new TypeError('Read interrupted');});
  await assert.rejects(api('/api/fixture'),error=>!(error instanceof ApiError));
});

test('local serialization failure does not claim a request was submitted',async()=>{
  let sent=false;const {api,ApiError}=load(async()=>{sent=true;});const body={};body.self=body;
  await assert.rejects(api('/api/fixture',{method:'POST',body}),error=>!(error instanceof ApiError));assert.equal(sent,false);
});

test('a reviewed company is sent exactly for its request without becoming a global selection',async()=>{
  const sent=[];
  const {api,setCsrfToken}=load(async(path,options)=>{sent.push({path,options});return {ok:true,status:200,json:async()=>({saved:true})};});
  setCsrfToken('fixture-csrf');
  await api('/api/company/resident-contacts',{method:'POST',expectedCompanyId:'company-reviewed-A',body:{submissionKey:'original-key'}});
  await api('/api/company/resident-contacts/contact-source',{expectedCompanyId:'company-reviewed-A'});
  await api('/api/company/properties');
  assert.equal(sent[0].options.headers['X-Company-ID'],'company-reviewed-A');
  assert.equal(sent[0].options.headers['X-CSRF-Token'],'fixture-csrf');
  assert.deepEqual(JSON.parse(sent[0].options.body),{submissionKey:'original-key'});
  assert.equal(sent[1].options.headers['X-Company-ID'],'company-reviewed-A');
  assert.equal(Object.hasOwn(sent[2].options.headers,'X-Company-ID'),false);
});

test('an invalid reviewed company never sends a request or claims submission uncertainty',async()=>{
  let sent=0;const {api,ApiError}=load(async()=>{sent++;});
  for(const expectedCompanyId of ['', 'bad\ncompany', 'company with spaces', 'x'.repeat(201), null, 42, {}]) {
    await assert.rejects(api('/api/company/resident-contacts',{method:'POST',expectedCompanyId,body:{name:'Fictional tenant'}}),error=>!(error instanceof ApiError));
  }
  assert.equal(sent,0);
});

test('a successful mutation hidden by a changed support context stays uncertain while a read does not',async()=>{
  for(const method of ['POST','GET']) {
    let client;
    client=load(async()=>({ok:true,status:200,json:async()=>{client.setImpersonationContext('new-context');return {saved:true};}}));
    client.setImpersonationContext('opening-context');
    await assert.rejects(client.api('/api/company/resident-contacts',{method}),error=>error instanceof client.ApiError&&error.code==='IMPERSONATION_CONTEXT_CHANGED'&&error.submissionUncertain===(method==='POST'));
  }
});
