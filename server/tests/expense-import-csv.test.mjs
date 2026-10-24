import assert from 'node:assert/strict';
import test from 'node:test';
import { parseExpenseCsv, expenseSourceId, expenseSourceNamespace } from '../dist/expense-imports.js';
import { parseUnitCsv } from '../dist/unit-import-csv.js';

const header = 'sourceId,propertyId,occurredOn,amount,category,memo';
test('expense CSV preserves stable source identity, quoted operational evidence and exact money strings', () => {
  const rows = parseExpenseCsv('\uFEFF' + header + '\r\n"지급+exact/ID","auth0|property+id",2026-01-31,1234.56,repairs,"Repair, invoice ""A""\r\nPaid by check"\r\n');
  assert.deepEqual(rows, [{ row: 2, values: { sourceId: '지급+exact/ID', propertyId: 'auth0|property+id', occurredOn: '2026-01-31', amount: '1234.56', category: 'repairs', memo: 'Repair, invoice "A"\nPaid by check' } }]);
  assert.equal(expenseSourceNamespace('bookkeeper.2026-a_1'), 'bookkeeper.2026-a_1');
  assert.equal(expenseSourceId('지급+exact/ID'), '지급+exact/ID');
  assert.notEqual(expenseSourceId('source-1'), expenseSourceId('Source-1'), 'source IDs are exact and never silently case-linked');
});

test('expense namespaces and source IDs reject unstable normalization instead of silently changing identity', () => {
  for (const value of ['', ' Uppercase', 'UPPERCASE', 'contains space', 'book:source', 'a'.repeat(101), null]) assert.throws(() => expenseSourceNamespace(value), error => error.code === 'INVALID_SOURCE_NAMESPACE');
  for (const value of ['', ' source-id', 'source-id ', '\tID', 'source\nID', 'source\0ID', 'a'.repeat(201), null]) assert.throws(() => expenseSourceId(value), error => error.code === 'INVALID_SOURCE_ID');
});

test('expense CSV accepts only the paid-expense contract and never drops ambiguous or oversized rows', () => {
  for (const csv of [
    'propertyId,occurredOn,amount,category\nhome,2026-01-01,1.00,repairs',
    header + ',kind\nID,home,2026-01-01,1.00,repairs,,income',
    'sourceId,sourceId,propertyId,occurredOn,amount,category\na,b,home,2026-01-01,1.00,repairs',
    header + '\nID,home,2026-01-01,1.00,repairs,"unterminated',
    header + '\nID,home,2026-01-01,1.00,repairs,extra,unexpected',
  ]) assert.throws(() => parseExpenseCsv(csv), error => error.statusCode === 400);
  const withoutMemo = 'sourceId,propertyId,occurredOn,amount,category\nID,home,2026-01-01,1.00,repairs';
  assert.equal(parseExpenseCsv(withoutMemo).length, 1);
  const csv = header + '\n' + Array.from({ length: 500 }, (_, i) => `ID-${i},home,2026-01-01,1.00,repairs,`).join('\n');
  assert.equal(parseExpenseCsv(csv).length, 500);
  assert.throws(() => parseExpenseCsv(csv + '\nID-501,home,2026-01-01,1.00,repairs,'), error => error.code === 'IMPORT_TOO_LARGE');
  assert.throws(() => parseExpenseCsv(header + '\nID,home,2026-01-01,1.00,repairs,' + 'x'.repeat(256 * 1024)), error => error.code === 'INVALID_CSV');
  assert.throws(() => parseExpenseCsv(header + '\n\ud800,home,2026-01-01,1.00,repairs,'), error => error.code === 'INVALID_CSV', 'malformed Unicode must not silently replace an exact external source ID');
  assert.deepEqual(parseUnitCsv('propertyId,label,notes\nhome,Unit A,"Quoted, note"'), [{ row: 2, values: { propertyId: 'home', label: 'Unit A', notes: 'Quoted, note' } }], 'the shared parser preserves the existing inventory contract');
});
