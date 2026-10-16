import test from "node:test";
import assert from "node:assert/strict";
import { buildRentStatement } from "../dist/statements.js";

const stamp = new Date("2026-10-16T12:00:00Z");
const charge = (id, dueOn, amountCents, extra = {}) => ({
  id,
  reference: `RC-${id}`,
  leaseId: "lease",
  dueOn: new Date(dueOn),
  periodOn: new Date(dueOn.slice(0, 7) + "-01"),
  amountCents,
  graceDays: 5,
  memo: "private",
  version: 1,
  createdAt: stamp,
  scheduleId: null,
  voidedAt: null,
  voidReason: null,
  ...extra,
});
const payment = (id, occurredOn, amountCents, extra = {}) => ({
  id,
  reference: `TX-${id}`,
  leaseId: "lease",
  occurredOn: new Date(occurredOn),
  amountCents,
  memo: "private",
  version: 1,
  createdAt: stamp,
  voidedAt: null,
  voidReason: null,
  ...extra,
});
const allocation = (chargeId, entryId, amountCents) => ({
  id: `${chargeId}-${entryId}`,
  leaseId: "lease",
  chargeId,
  entryId,
  amountCents,
  createdAt: stamp,
});

test("statement splits current unpaid timing and paid-late history without changing the rent calculator", () => {
  const data = {
    charges: [
      charge("future", "2026-11-01", 111),
      charge("today", "2026-10-16", 222),
      charge("grace", "2026-10-13", 333),
      charge("past", "2026-10-01", 444),
      charge("late", "2026-09-01", 555),
    ],
    payments: [payment("late", "2026-09-08", 555)],
    allocations: [allocation("late", "late", 555)],
  };
  const s = buildRentStatement(data, "2026-10-16", null, null);
  assert.deepEqual(
    s.items.filter((r) => r.type === "charge").map((r) => r.status),
    ["paid_late", "past_grace", "within_grace", "due_today", "upcoming"],
  );
  assert.equal(s.current.outstandingCents, "1110");
  assert.equal(s.current.paidLateChargeCount, "1");
  assert.equal(s.current.afterGraceCents, "444");
  assert.equal(s.current.withinGraceCents, "333");
  assert.equal(s.current.dueTodayCents, "222");
  assert.equal(s.current.upcomingCents, "111");
  assert.equal(s.allocations[0].chargeReference, "RC-late");
  assert.equal(s.allocations[0].receiptReference, "TX-late");
});

test("a filtered statement bridges opening, closing and later activity, including cross-period allocations", () => {
  const data = {
    charges: [
      charge("old", "2026-01-01", 100001),
      charge("current", "2026-02-01", 100001),
    ],
    payments: [
      payment("partial", "2026-01-10", 40000),
      payment("excess", "2026-03-01", 190004),
    ],
    allocations: [
      allocation("old", "partial", 40000),
      allocation("old", "excess", 60001),
      allocation("current", "excess", 100001),
    ],
  };
  const s = buildRentStatement(data, "2026-10-16", "2026-02-01", "2026-02-28");
  assert.deepEqual(s.period, {
    openingNetCents: "60001",
    chargedCents: "100001",
    receivedCents: "0",
    closingNetCents: "160002",
    laterNetCents: "-190004",
    currentNetCents: "-30002",
    recordCount: 1,
    voidedCount: 0,
  });
  assert.equal(s.current.outstandingCents, "0");
  assert.equal(s.current.creditCents, "30002");
  assert.equal(s.items[0].status, "paid_late");
  assert.equal(s.allocations.length, 1);
  assert.equal(s.allocations[0].receiptDate, "2026-03-01");
  assert.equal(
    BigInt(s.period.closingNetCents) + BigInt(s.period.laterNetCents),
    BigInt(s.current.netCents),
  );
});

test("correction voids have zero effect, retain original amounts and inactive allocation history", () => {
  const data = {
    charges: [
      charge("old", "2026-01-01", 10000, { voidedAt: stamp }),
      charge("new", "2026-01-01", 9000),
    ],
    payments: [
      payment("void", "2026-01-02", 4000, { voidedAt: stamp }),
      payment("new", "2026-01-02", 5000),
    ],
    allocations: [
      allocation("old", "void", 4000),
      allocation("new", "new", 5000),
    ],
  };
  const s = buildRentStatement(data, "2026-10-16", null, null);
  assert.equal(s.period.closingNetCents, "4000");
  assert.equal(s.period.voidedCount, 2);
  assert.equal(s.items.find((r) => r.id === "old").amountCents, "10000");
  assert.equal(s.items.find((r) => r.id === "old").effectCents, "0");
  assert.deepEqual(s.allocations.map((a) => a.active).sort(), [false, true]);
  assert.doesNotMatch(JSON.stringify(s), /private|voidReason|memo/);
});

test("empty periods keep opening and closing equal and preserve full current balances", () => {
  const data = {
    charges: [
      charge("old", "2026-01-01", 101),
      charge("later", "2026-03-01", 202),
    ],
    payments: [],
    allocations: [],
  };
  const s = buildRentStatement(data, "2026-10-16", "2026-02-01", "2026-02-28");
  assert.deepEqual(s.items, []);
  assert.deepEqual(s.allocations, []);
  assert.equal(s.period.openingNetCents, "101");
  assert.equal(s.period.closingNetCents, "101");
  assert.equal(s.period.laterNetCents, "202");
  assert.equal(s.current.outstandingCents, "303");
});

test("source dates are inclusive; partial receipts and unsettled charges remain distinct", () => {
  const data = {
    charges: [charge("due", "2026-10-01", 10001)],
    payments: [payment("partial", "2026-10-16", 10000)],
    allocations: [allocation("due", "partial", 10000)],
  };
  const s = buildRentStatement(data, "2026-10-16", "2026-10-01", "2026-10-16");
  assert.equal(s.items.length, 2);
  assert.equal(s.current.outstandingCents, "1");
  assert.equal(s.items[0].status, "past_grace");
  assert.equal(s.items[0].settledOn, null);
  assert.equal(s.items[1].status, "fully_applied");
  assert.equal(s.period.closingNetCents, "1");
});
