const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/report-export.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const mod={exports:{}};new Function('module','exports',compiled)(mod,mod.exports);
const {moneyCell,reportCsv}=mod.exports;
test('exports retain integer-cent precision beyond safe JS numeric limits and signed fractions',()=>{
 assert.deepEqual(moneyCell('900719925474099301'),{numeric:'9007199254740993.01'});
 assert.deepEqual(moneyCell('-1'),{numeric:'-0.01'});assert.deepEqual(moneyCell('0'),{numeric:'0.00'});
 assert.equal(reportCsv([['Net',moneyCell('-1234')]]),'\uFEFF"Net",-12.34\r\n');
 assert.throws(()=>reportCsv([[{numeric:'=1+1'}]]));
});
test('CSV quotes commas, newlines and Unicode while neutralizing spreadsheet formulas',()=>{
 const csv=reportCsv([['a,"b"\nc','Élodie','=HYPERLINK("x")',' \t+SUM(1,2)','\r-1','@name',moneyCell('101')]]);
 assert.equal(csv,'\uFEFF"a,""b""\nc","Élodie","\'=HYPERLINK(""x"")","\' \t+SUM(1,2)","\'\r-1","\'@name",1.01\r\n');
});
