import test from "node:test";
import assert from "node:assert/strict";
import { chargeTiming, paymentPolicyPatch } from "../dist/payment-policy.js";
import { companyDay } from "../dist/reports.js";
test("grace includes the whole last calendar day; due, grace and past-grace dates stay distinct", () => {
  const due = new Date("2026-12-31T00:00:00Z");
  assert.equal(
    chargeTiming(due, 5, "2027-01-05", 1n).collectionStatus,
    "within_grace",
  );
  assert.equal(
    chargeTiming(due, 5, "2027-01-06", 1n).collectionStatus,
    "past_grace",
  );
  assert.equal(
    chargeTiming(due, 0, "2026-12-31", 1n).collectionStatus,
    "due_today",
  );
  assert.equal(
    chargeTiming(due, 0, "2027-01-01", 1n).collectionStatus,
    "past_grace",
  );
  assert.equal(chargeTiming(due, 5, "2027-01-06", 0n).collectionStatus, "paid");
  assert.equal(
    chargeTiming(due, 5, "2027-01-06", 1n, true).collectionStatus,
    "voided",
  );
  const instant = new Date("2027-01-06T00:30:00Z");
  assert.equal(
    chargeTiming(due, 5, companyDay("America/Los_Angeles", instant), 1n)
      .collectionStatus,
    "within_grace",
  );
  assert.equal(
    chargeTiming(due, 5, companyDay("Asia/Tokyo", instant), 1n)
      .collectionStatus,
    "past_grace",
  );
});
test("omitted payment fields stay omitted for old clients and optional instructions can be cleared", () => {
  assert.deepEqual(paymentPolicyPatch({}), {});
  assert.deepEqual(paymentPolicyPatch({ paymentInstructions: null }), {
    paymentInstructions: null,
  });
  assert.deepEqual(
    paymentPolicyPatch({
      rentDueDay: 31,
      graceDays: 0,
      paymentInstructions: " Check at office ",
    }),
    { rentDueDay: 31, graceDays: 0, paymentInstructions: "Check at office" },
  );
});
