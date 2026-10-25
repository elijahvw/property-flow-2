import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLayoutShifts } from '../../scripts/layout-stability-metrics.mjs';

const shift = (at, value, hadRecentInput = false) => ({ at, value, hadRecentInput });
test('CLS excludes recent input and uses the largest session rather than the full visit sum', () => {
  const result = summarizeLayoutShifts([shift(0, 0.2), shift(500, 0.9, true), shift(900, 0.3), shift(2100, 0.4)]);
  assert.equal(result.cls, 0.5);
  assert.equal(result.totalShiftValue, 0.9);
  assert.equal(result.eligibleShiftCount, 3);
  assert.equal(result.excludedRecentInputCount, 1);
});
test('a gap of one second starts a new window without rounding sub-millisecond boundaries', () => {
  assert.equal(summarizeLayoutShifts([shift(0, 0.2), shift(1000, 0.3)]).cls, 0.3);
  assert.equal(summarizeLayoutShifts([shift(0, 0.2), shift(999.99, 0.3)]).cls, 0.5);
});
test('continuous shifts cannot extend one session beyond five seconds', () => {
  const shifts = Array.from({ length: 8 }, (_, index) => shift(index * 900, 0.1));
  assert.ok(Math.abs(summarizeLayoutShifts(shifts).cls - 0.6) < 1e-12);
  const exactlyFive = [shift(0, 0.2), ...Array.from({ length: 5 }, (_, index) => shift(850 * (index + 1), 0.01)), shift(5000, 0.3)];
  assert.equal(summarizeLayoutShifts(exactlyFive).cls, 0.3);
});
