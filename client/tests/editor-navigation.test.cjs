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


test('an already open lease intake keeps its pinned source when only its URL unit suggestion changes', () => {
  assert.equal(editorNavigationChangesSource(location('/company/leases?new=lease&propertyId=home&unitId=unit-51'), location('/company/leases?new=lease&propertyId=home&unitId=unit-3')), false);
  assert.equal(editorNavigationChangesSource(location('/company/properties/home/leases?new=lease&unitId=unit-51'), location('/company/properties/home/leases?new=lease&unitId=unit-3')), false);
  assert.equal(editorNavigationChangesSource(location('/company/leases?new=lease&unitId=unit-51'), location('/company/leases?new=lease&unitId=unit-3')), false);
});

test('unit identity stays protected outside the same open lease intake', () => {
  const pairs = [
    ['/company/leases?unitId=unit-51', '/company/leases?unitId=unit-3'],
    ['/company/leases?unitId=unit-51', '/company/leases?new=lease&unitId=unit-3'],
    ['/company/leases?new=lease&unitId=unit-51', '/company/leases?unitId=unit-3'],
    ['/company/leases/lease-a?new=lease&unitId=unit-51', '/company/leases/lease-a?new=lease&unitId=unit-3'],
    ['/company/properties/home/units?new=lease&unitId=unit-51', '/company/properties/home/units?new=lease&unitId=unit-3'],
    ['/company/rent?new=lease&unitId=unit-51', '/company/rent?new=lease&unitId=unit-3'],
  ];
  for (const [from, to] of pairs) assert.equal(editorNavigationChangesSource(location(from), location(to)), true, `${from} → ${to}`);
});

test('a changed property, person or reviewed source still protects an open lease intake', () => {
  const pairs = [
    ['/company/leases?new=lease&propertyId=home&unitId=unit-51', '/company/leases?new=lease&propertyId=other&unitId=unit-3'],
    ['/company/properties/home/leases?new=lease&unitId=unit-51', '/company/properties/other/leases?new=lease&unitId=unit-3'],
    ['/company/leases?new=lease&contactId=tenant-a&unitId=unit-51', '/company/leases?new=lease&contactId=tenant-b&unitId=unit-3'],
    ['/company/leases?new=lease&prospectId=inquiry-a&unitId=unit-51', '/company/leases?new=lease&prospectId=inquiry-b&unitId=unit-3'],
    ['/company/leases?new=lease&taskVersion=1&unitId=unit-51', '/company/leases?new=lease&taskVersion=2&unitId=unit-3'],
    ['/company/leases?new=lease&section=details&unitId=unit-51', '/company/leases?new=lease&section=household&unitId=unit-3'],
  ];
  for (const [from, to] of pairs) assert.equal(editorNavigationChangesSource(location(from), location(to)), true, `${from} → ${to}`);
});
