const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/FormFields.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', compiled)(mod, mod.exports, name => name.endsWith('.css') ? {} : require(name));
const { FormField, FormSection } = mod.exports;

test('field label, native requirement, existing description, hint and supplied error stay connected', () => {
  const html = renderToStaticMarkup(React.createElement(FormField, { id: 'unit-floor', label: 'Floor', required: true, hint: 'Use the building floor label.', error: 'Use at most 40 characters.' }, React.createElement('input', { name: 'floor', 'aria-describedby': 'existing-context', maxLength: 40 })));
  assert.match(html, /<label for="unit-floor">Floor<\/label>/);
  assert.match(html, /id="unit-floor"/);
  assert.match(html, /required=""/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="existing-context unit-floor-hint unit-floor-error"/);
  assert.match(html, /id="unit-floor-hint"/);
  assert.match(html, /id="unit-floor-error"/);
});

test('optional field keeps native bounds without inventing a required constraint or error', () => {
  const html = renderToStaticMarkup(React.createElement(FormField, { label: 'Bedrooms' }, React.createElement('input', { name: 'bedrooms', type: 'number', min: 0, max: 100, step: 1 })));
  assert.match(html, /Optional/);
  assert.match(html, /name="bedrooms"/);
  assert.match(html, /min="0" max="100" step="1"/);
  assert.doesNotMatch(html, /required=""|aria-invalid/);
});

test('section keeps native legend semantics and exposes its description to the group', () => {
  const html = renderToStaticMarkup(React.createElement(FormSection, { id: 'physical-details', title: 'Unit details', description: 'Optional physical details.' }, React.createElement('input', { name: 'floor' })));
  assert.match(html, /<fieldset[^>]*aria-describedby="physical-details-description"/);
  assert.match(html, /<legend id="physical-details">Unit details<\/legend>/);
  assert.match(html, /id="physical-details-description"/);
});
