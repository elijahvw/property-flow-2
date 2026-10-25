const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/PageLeaveGuard.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', compiled)(mod, mod.exports, require);
const { editorNavigationChangesSource } = mod.exports;
const location = value => { const url = new URL(value, 'https://propertyflow.test'); return { pathname: url.pathname, search: url.search }; };
test('changing a selected prospect or lease section protects the editor even on the same route', () => {
  assert.equal(editorNavigationChangesSource(location('/company/prospects?prospectId=first&q=Maple'), location('/company/prospects?prospectId=second&q=Maple')), true);
  assert.equal(editorNavigationChangesSource(location('/company/leases/lease-a?section=inspections'), location('/company/leases/lease-a?section=household')), true);
  assert.equal(editorNavigationChangesSource(location('/company/leases/lease-a?section=inspections&inspectionId=first'), location('/company/leases/lease-a?section=inspections&inspectionId=second')), true);
});
test('directory paging and opening or closing a retained intake leave its source in place', () => {
  assert.equal(editorNavigationChangesSource(location('/company/leases?propertyId=home&new=lease&q=Maple'), location('/company/leases?propertyId=home&q=Garden&cursor=next')), false);
  assert.equal(editorNavigationChangesSource(location('/company/prospects?prospectId=first&stage=review'), location('/company/prospects?prospectId=first&stage=approved&cursor=next')), false);
  assert.equal(editorNavigationChangesSource(location('/company/leases?propertyId=home'), location('/company/leases?propertyId=other')), true);
  assert.equal(editorNavigationChangesSource(location('/company/leases'), location('/help')), true);
});
