const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const mod = { exports: {} };
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/finance-create-recovery.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
new Function('require', 'module', 'exports', compiled)(() => ({}), mod, mod.exports);
const { parseFinanceCreateAttempt, financeCreateStorageKey } = mod.exports;
const attempt = { actorId: 'owner', companyId: 'company-a', body: {
  propertyId: 'home', occurredOn: '2026-10-14', amount: '1234.56', kind: 'income', category: 'other',
  memo: 'Fictional receipt', submissionKey: 'cd325391-5413-46a3-b4cf-390f8927b8d1',
} };

test('finance retry journal retains exact payload strings only within the original actor/company scope', () => {
  const raw = JSON.stringify(attempt);
  assert.deepEqual(parseFinanceCreateAttempt(raw, 'owner', 'company-a'), attempt);
  for (const [actor, company] of [['other', 'company-a'], ['owner', 'company-b'], [undefined, 'company-a'], ['owner', undefined]])
    assert.equal(parseFinanceCreateAttempt(raw, actor, company), null);
  assert.notEqual(financeCreateStorageKey('owner', 'company-a'), financeCreateStorageKey('owner', 'company-b'));
  assert.notEqual(financeCreateStorageKey('owner', 'company-a'), financeCreateStorageKey('other', 'company-a'));
});

test('malformed, oversized and expanded cash journals are rejected without inventing a replacement', () => {
  for (const value of [null, '', '{', 'x'.repeat(6001), JSON.stringify({ ...attempt, path: '/api/other' }),
    ...[{ submissionKey: 'new-key' }, { propertyId: '../another-company' }, { amount: 1234.56 },
      { kind: 'deposit' }, { memo: 'x'.repeat(501) }, { createdById: 'other' }]
      .map(patch => JSON.stringify({ ...attempt, body: { ...attempt.body, ...patch } }))])
    assert.equal(parseFinanceCreateAttempt(value, 'owner', 'company-a'), null);
});
