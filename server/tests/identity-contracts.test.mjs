import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { identityApiContracts } from '../dist/api/identity-contracts.js';
import { membershipAccessSelect } from '../dist/membership-view.js';

test('identity contracts account for every registered assigned-domain operation without duplicating session protocols', async () => {
  const inventory = JSON.parse(await readFile(new URL('../src/api/route-inventory.json', import.meta.url), 'utf8'));
  const expected = inventory.routes.filter(route => /\/(?:account-profile|user-administration|application|manual-passwords|impersonation|invitations)\.ts$/.test(route.source.file)).map(route => route.operation).sort();
  assert.equal(expected.length, 48);
  assert.deepEqual(Object.keys(identityApiContracts).sort(), expected);
  for (const [key, contract] of Object.entries(identityApiContracts)) {
    assert.equal(contract['x-pf-contract-status'], 'source-reviewed', key);
    assert.equal(contract['x-pf-validation-status'], 'not-handler-verified', key);
    assert.ok(contract['x-pf-authorization'] && contract['x-pf-support'], key);
    assert.ok(contract.response[200], key);
  }
});

test('access-response schemas track the shared privacy selector rather than the full membership model', () => {
  const actualFields = Object.keys(membershipAccessSelect).sort();
  for (const key of ['PUT /api/platform/users/:userId/membership', 'PATCH /api/company/members/:userId']) {
    const documented = identityApiContracts[key].response[200];
    assert.deepEqual(Object.keys(documented.properties).sort(), actualFields, key);
    assert.deepEqual([...documented.required].sort(), actualFields, key);
  }
  for (const privateField of ['contactName', 'contactPhone', 'emergencyContactName', 'managementNotes'])
    assert.ok(!actualFields.includes(privateField), `${privateField} is not an access-administration projection`);
});

test('password documentation follows the real secret-free receipt serializer and contains no captured examples/defaults', async () => {
  const code = await readFile(new URL('../src/manual-passwords.ts', import.meta.url), 'utf8');
  const source = ts.createSourceFile('manual-passwords.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let actualFields;
  function inspect(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'safe') {
      const body = node.initializer.body.expression;
      assert.ok(ts.isObjectLiteralExpression(body));
      actualFields = body.properties.map(property => property.name.getText(source)).sort();
    }
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  assert.ok(actualFields?.length);
  for (const scope of ['platform', 'company']) {
    const base = `/api/${scope}/users/:userId/password`;
    const review = identityApiContracts[`GET ${base}`].response[200].properties.operation;
    const release = identityApiContracts[`POST ${base}/release`].response[200];
    assert.deepEqual(Object.keys(review.properties).sort(), actualFields);
    assert.deepEqual(Object.keys(release.properties).sort(), actualFields);
    for (const field of ['password', 'confirmation', 'subject', 'issuer', 'submissionHash'])
      assert.ok(!Object.hasOwn(review.properties, field), field);
    for (const field of ['password', 'confirmation'])
      assert.equal(identityApiContracts[`POST ${base}`].body.properties[field].writeOnly, true);
  }
  function check(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!['example', 'examples', 'default'].includes(key), `no captured value in ${key}`);
      check(child);
    }
  }
  check(identityApiContracts);
  const entry = identityApiContracts['POST /api/invitations/entry'];
  assert.deepEqual(entry.security, []);
  assert.deepEqual(entry.headers.required, ['origin']);
  assert.match(entry['x-pf-authentication'], /No authenticated session or CSRF/);
});
