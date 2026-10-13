const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function renderHome(auth) {
  const source = fs.readFileSync(path.join(__dirname, '../src/pages/Home.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const mod = { exports: {} };
  const scopedRequire = name => name === '../context/AuthContext' ? { useAuth: () => auth }
    : name === 'react-router-dom' ? { useNavigate: () => () => {} } : require(name);
  new Function('module', 'exports', 'require', compiled)(mod, mod.exports, scopedRequire);
  return renderToStaticMarkup(React.createElement(mod.exports.default));
}
test('public home content renders during authentication restoration', () => {
  const html = renderHome({ loading: true, user: undefined });
  assert.match(html, /Simplify Your Property Management/);
  assert.match(html, /Property Tracking/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /Go to Your Portal/);
});
test('home sign-in action appears after anonymous restoration completes', () => {
  const html = renderHome({ loading: false, user: undefined, signIn() {} });
  assert.match(html, /Get Started/);
  assert.doesNotMatch(html, /Restoring your sign-in/);
});
