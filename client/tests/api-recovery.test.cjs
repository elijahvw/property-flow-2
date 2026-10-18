const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
function load(fetch) {
  const source = fs.readFileSync(path.join(__dirname, '../src/api.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = {exports:{}};
  new Function('module','exports','require','fetch','window',compiled)(mod,mod.exports,()=>({setTelemetrySession(){}}),fetch,{dispatchEvent(){}});
  return mod.exports;
}
test('mutation transport failures and malformed replies carry an uncertain-submission marker',async()=>{
  for(const fetch of [async()=>{throw new TypeError('Transport interrupted');},async()=>({ok:true,json:async()=>{throw new SyntaxError('Invalid response');}})]) {
    const {api,ApiError}=load(fetch);
    await assert.rejects(api('/api/company/finances',{method:'POST',body:{submissionKey:'fixture'}}),error=>error instanceof ApiError&&error.submissionUncertain&&error.code==='SUBMISSION_UNCERTAIN');
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
