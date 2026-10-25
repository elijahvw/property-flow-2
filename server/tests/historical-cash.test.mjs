import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeHistoricalCash } from '../dist/historical-cash-reports.js';

const cutoff = new Date('2026-02-01T05:00:00Z');
const row = (id, kind, category, amountCents, extra = {}) => ({ id, reference: `TX-${id}`, propertyId: 'home', property: { name: 'Current property' }, occurredOn: new Date('2026-01-01'), createdAt: new Date('2026-01-02'), kind, category, amountCents, currency: 'USD', memo: null, voidedAt: null, voidReason: null, movement: null, depositReceipt: null, ...extra });
test('historical cash keeps deposit and refund classifications separate from operating net with exact cents', () => {
  const rows = [row('income', 'income', 'rent', 100000000), row('expense', 'expense', 'repairs', 10000), row('deposit', 'deposit', 'security_deposit', 30000), row('rent-refund', 'refund', 'rent', 20000), row('deposit-return', 'refund', 'security_deposit', 5000)];
  const result = summarizeHistoricalCash(rows, cutoff);
  assert.equal(result.summary.netCents, '99970000');
  assert.equal(result.summary.cashMovementCents, '99995000');
  assert.equal(result.summary.depositReceivedCents, '30000');
  assert.equal(result.summary.depositRefundCents, '5000');
  assert.equal(result.groups.reduce((count, group) => count + group.count, 0), 5);
});
test('later correction metadata cannot leak into the captured recorded state and cutoff is exclusive', () => {
  const result = summarizeHistoricalCash([
    row('before', 'income', 'other', 100, { voidedAt: new Date(cutoff.getTime() - 1), voidReason: 'Known at cutoff' }),
    row('boundary', 'income', 'other', 200, { voidedAt: cutoff, voidReason: 'Next day correction' }),
    row('after', 'income', 'other', 300, { voidedAt: new Date(cutoff.getTime() + 1), voidReason: 'Later correction' }),
  ], cutoff);
  assert.equal(result.summary.incomeCents, '500'); assert.equal(result.summary.voidedCount, 1);
  assert.equal(result.items[0].voidReason, 'Known at cutoff');
  for (const source of result.items.slice(1)) { assert.equal(source.included, true); assert.equal(source.voidReason, null); assert.equal(source.voidedAt, null); }
});
