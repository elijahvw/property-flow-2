const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = fs.readFileSync(path.join(__dirname, '../src/components/ProtectedRoute.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

function renderGuard(role, allowedRoles, overrides = {}) {
  const auth = { user: {}, role, loading: false, isConfigured: true, signIn() {}, ...overrides };
  const module = { exports: {} };
  function mockedRequire(name) {
    if (name === 'react') return React;
    if (name === '../context/AuthContext') return { useAuth: () => auth };
    if (name === 'react-router-dom') return {
      useLocation: () => ({ pathname: '/admin' }),
      Navigate: () => React.createElement('span', null, 'redirected'),
    };
    throw new Error('Unexpected import: ' + name);
  }
  new Function('require', 'module', 'exports', compiled)(mockedRequire, module, module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default, {
    allowedRoles,
    children: React.createElement('span', null, 'protected-content'),
  }));
}

test('missing role cannot open protected dashboards or admin', () => {
  for (const allowed of [['tenant', 'landlord', 'admin'], ['admin']]) {
    const output = renderGuard(null, allowed);
    assert.match(output, /Account access pending/);
    assert.doesNotMatch(output, /protected-content/);
  }
});

test('tenant and landlord cannot open admin', () => {
  for (const role of ['tenant', 'landlord']) {
    const output = renderGuard(role, ['admin']);
    assert.match(output, /redirected/);
    assert.doesNotMatch(output, /protected-content/);
  }
});

test('admin can open admin; assigned roles can open their dashboard', () => {
  assert.match(renderGuard('admin', ['admin']), /protected-content/);
  for (const role of ['tenant', 'landlord', 'admin']) {
    assert.match(renderGuard(role, ['tenant', 'landlord', 'admin']), /protected-content/);
  }
});

test('loading, missing login and missing configuration cannot render protected content', () => {
  for (const override of [{ loading: true }, { user: undefined }, { isConfigured: false }]) {
    assert.doesNotMatch(renderGuard('admin', ['admin'], override), /protected-content/);
  }
});
