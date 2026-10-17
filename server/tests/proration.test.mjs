import test from "node:test";
import assert from "node:assert/strict";
import { calendarProration } from "../dist/proration-policy.js";
const calc = (from, through, rent = "150000") =>
  calendarProration(
    new Date(from),
    through ? new Date(through) : null,
    new Date(from.slice(0, 7) + "-01"),
    Number(rent),
  );
test("actual calendar proration covers leap February, every month length and inclusive same-day terms", () => {
  for (const [from, to, days, total] of [
    ["2024-02-10", "2024-02-29", 20, 29],
    ["2025-02-10", "2025-02-28", 19, 28],
    ["2026-04-10", "2026-04-30", 21, 30],
    ["2026-10-10", "2026-10-31", 22, 31],
    ["2026-10-16", "2026-10-16", 1, 31],
  ]) {
    const c = calc(from, to);
    assert.equal(c.days, days);
    assert.equal(c.daysInMonth, total);
    assert.equal(
      c.calculatedCents,
      Number(
        (150000n * BigInt(days) * 2n + BigInt(total)) / (BigInt(total) * 2n),
      ),
    );
    assert.equal(c.throughOn, to);
    assert.equal(
      c.throughExclusiveOn,
      new Date(Date.parse(to) + 86400000).toISOString().slice(0, 10),
    );
  }
});
test("round once in integer cents and retain full-month amount without local-DST elapsed hours", () => {
  assert.equal(calc("2026-03-01", "2026-03-31").calculatedCents, 150000);
  assert.equal(calc("2026-11-01", "2026-11-30").days, 30);
  assert.equal(calc("2026-04-01", "2026-04-15", "1").calculatedCents, 1);
  assert.equal(calc("2026-04-01", "2026-04-14", "1").calculatedCents, 0);
  assert.throws(
    () =>
      calendarProration(
        new Date("2026-10-10"),
        null,
        new Date("2026-09-01"),
        150000,
      ),
    /inside this lease/,
  );
});
