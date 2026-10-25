import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnitCsv } from '../dist/unit-import-csv.js';

test('unit CSV preserves quoted commas, exact opaque property IDs, Unicode and multiline escaped quotes', () => {
  const rows = parseUnitCsv('\uFEFFpropertyId,label,notes\r\n\r\n"auth0|exact+id","지원, A","First line\r\nSecond ""quoted"" line"\r\n');
  assert.deepEqual(rows, [{ row: 3, values: { propertyId: 'auth0|exact+id', label: '지원, A', notes: 'First line\nSecond "quoted" line' } }]);
});

test('unit CSV rejects ambiguous headers, broken quoting and row-width changes instead of dropping data', () => {
  for (const csv of ['propertyId,label,label\na,A,B', 'propertyId,label,unknown\na,A,value', 'propertyId,notes\na,note', 'propertyId,label\na,"never closed', 'propertyId,label\na,unquoted"quote', 'propertyId,label\na,"closed" trailing', 'propertyId,label\na,A,extra', 'propertyId,label\na', 'propertyId,label\n'])
    assert.throws(() => parseUnitCsv(csv), error => error.statusCode === 400, csv);
});

test('unit CSV enforces complete byte and row bounds while allowing a trailing empty line', () => {
  const csv = 'propertyId,label\n' + Array.from({ length: 500 }, (_, index) => `property,Unit ${index}\n`).join('');
  assert.equal(parseUnitCsv(csv).length, 500);
  assert.throws(() => parseUnitCsv(csv + 'property,Excess row\n'), error => error.code === 'IMPORT_TOO_LARGE');
  assert.throws(() => parseUnitCsv('propertyId,label\nproperty,' + 'x'.repeat(256 * 1024)), error => error.code === 'INVALID_CSV');
  assert.throws(() => parseUnitCsv('propertyId,label\nproperty,Unit\0'), error => error.code === 'INVALID_CSV');
});
