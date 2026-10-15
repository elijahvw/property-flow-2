const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/dates.ts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const mod = {exports:{}};
new Function('module','exports',compiled)(mod,mod.exports);
const {formatDate,formatMonth}=mod.exports;
test('business dates use month names without changing a day across viewer timezones',()=>{
  const prior=process.env.TZ;
  try {
    for(const zone of ['America/Los_Angeles','Asia/Tokyo','Pacific/Honolulu']) {
      process.env.TZ=zone;
      assert.equal(formatDate('2026-10-15'),'October 15, 2026');
      assert.equal(formatDate('2028-02-29T00:00:00.000Z'),'February 29, 2028');
      assert.equal(formatMonth('2026-12'),'December 2026');
    }
  } finally {if(prior===undefined) delete process.env.TZ;else process.env.TZ=prior;}
});
test('empty and invalid dates never normalize into a misleading valid business day',()=>{
  for(const value of [null,undefined,'','2026-02-29','2026-13-01','2026-00-01','2026-02-30','not-a-date'])assert.equal(formatDate(value),'—');
  assert.equal(formatDate(null,'Open ended'),'Open ended');
});
