const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, mocks = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} }; const req = name => mocks[name] || require(name);
  new Function('require','module','exports',compiled)(req,mod,mod.exports); return mod.exports;
}
function render(permission, granted, overrides = {}) {
  const auth = { user: {}, loading: false, can: p => granted.includes(p), signIn() {}, refreshUser() {}, ...overrides };
  const Guard = load('components/ProtectedRoute.tsx', { '../context/AuthContext': { useAuth: () => auth }, 'react-router-dom': { Link: props => React.createElement('a', null, props.children) } }).default;
  return renderToStaticMarkup(React.createElement(Guard, { permission }, React.createElement('span', null, 'protected-content')));
}
test('direct pages enforce the same capability contract as navigation', () => {
  const { visibleRoutes } = load('navigation.ts');
  for (const grants of [[], ['resident.self'], ['property.read'], ['platform.manage']]) {
    const visible = visibleRoutes(grants);
    assert.equal(visible.some(r => r.path === '/platform/users'), grants.includes('platform.manage'));
    const html = render('platform.manage', grants);
    assert.equal(html.includes('protected-content'), grants.includes('platform.manage'));
  }
});
test('missing login, loading and failed bootstrap never render protected contents', () => {
  for (const override of [{user: undefined}, {loading:true}, {error:'Unavailable'}]) assert.doesNotMatch(render('platform.manage',['platform.manage'],override), /protected-content/);
});
test('unassigned users can reach their account but cannot open company pages', () => {
  assert.match(render(undefined, []), /protected-content/);
  assert.doesNotMatch(render('property.read', []), /protected-content/);
});
