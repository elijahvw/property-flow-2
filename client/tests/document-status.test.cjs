const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const compiled=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/document-status.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};new Function('module','exports',compiled)(mod,mod.exports);
const {documentAvailable,documentStatusLabel}=mod.exports;

test('upload status never suggests an unperformed malware scan or offers a known rejected file',()=>{
  for(const status of ['unscanned','pending']){
    assert.equal(documentStatusLabel(status),'Not scanned');
    assert.equal(documentAvailable(status),true);
  }
  assert.equal(documentStatusLabel('clean'),'Previously cleared by scanning');
  assert.equal(documentAvailable('clean'),true);
  assert.equal(documentAvailable('rejected'),false);
  assert.match(documentStatusLabel('rejected'),/Previously rejected.*blocked/);
  for(const status of ['',undefined,'unknown']){
    assert.equal(documentAvailable(status),false);
    assert.match(documentStatusLabel(status),/unavailable.*blocked/);
  }
});
