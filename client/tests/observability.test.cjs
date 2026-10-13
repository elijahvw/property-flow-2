const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/observability.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleUnderTest = { exports: {} };
new Function('module', 'exports', compiled)(moduleUnderTest, moduleUnderTest.exports);
const { isFirstPartyApiUrl } = moduleUnderTest.exports;
const origin = 'https://drfbeumseaytt.cloudfront.net';

test('trace headers are allowed for same-origin API requests', () => {
  for (const url of ['/api/me', '/api/companies?limit=10', origin + '/api/ready']) {
    assert.equal(isFirstPartyApiUrl(url, origin), true);
  }
});
test('trace headers are excluded from Auth0, other tenants, assets and lookalike URLs', () => {
  for (const url of [
    'https://dev-p1y78gnnq2o2fssw.us.auth0.com/api/users',
    'https://other-company.example.com/api/properties',
    origin + '.evil.example/api/me',
    origin + '/api-lookalike/me',
    origin + '/assets/index.js',
    origin.replace('https:', 'http:') + '/api/me',
    'https://[invalid',
  ]) {
    assert.equal(isFirstPartyApiUrl(url, origin), false, url);
  }
});
