const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const test=require('node:test');
function load(fetch) {
  const source=fs.readFileSync(path.join(__dirname,'../src/browser-telemetry.ts'),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const mod={exports:{}};
  new Function('module','exports','fetch',compiled)(mod,mod.exports,fetch);
  return mod.exports;
}
test('browser telemetry sends bounded allowlisted fields to same-origin with CSRF',async()=>{
  const calls=[];const m=load(async(...args)=>calls.push(args));
  m.recordBrowserEvent('company.update');await m.flushTelemetry();assert.equal(calls.length,0);
  m.setTelemetrySession('test-csrf');
  try {
    for(let i=0;i<100;i++)m.recordBrowserEvent('company.update','success',500);
    await m.flushTelemetry();
    assert.equal(calls[0][0],'/api/telemetry');
    const options=calls[0][1];assert.equal(options.credentials,'same-origin');assert.equal(options.headers['X-CSRF-Token'],'test-csrf');
    const rows=JSON.parse(options.body).events;assert.equal(rows.length,16);
    assert.deepEqual(rows[0],{name:'company.update',outcome:'success',duration:500});
    m.setTelemetrySession('');await m.flushTelemetry();assert.equal(calls.length,1);
  } finally {m.setTelemetrySession('');}
});
test('browser monitoring failure is discarded without affecting user operations',async()=>{
  const m=load(async()=>{throw Error('offline');});m.setTelemetrySession('test');
  try {m.recordBrowserEvent('lease.update');await assert.doesNotReject(m.flushTelemetry());}
  finally {m.setTelemetrySession('');}
});
