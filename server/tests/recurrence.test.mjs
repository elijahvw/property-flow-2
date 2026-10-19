import test from "node:test";
import assert from "node:assert/strict";
import { nextOccurrence } from "../dist/recurrence.js";
const d = (s) => new Date(s + "T00:00:00Z");
for (const [name, anchor, current, cadence, end, expected] of [
  [
    "weekly crosses year",
    "2026-12-29",
    "2026-12-29",
    "weekly",
    null,
    "2027-01-05",
  ],
  [
    "monthly clamps January 31",
    "2026-01-31",
    "2026-01-31",
    "monthly",
    null,
    "2026-02-28",
  ],
  [
    "monthly recovers original 31",
    "2026-01-31",
    "2026-02-28",
    "monthly",
    null,
    "2026-03-31",
  ],
  [
    "quarterly preserves original month day",
    "2026-01-31",
    "2026-04-30",
    "quarterly",
    null,
    "2026-07-31",
  ],
  [
    "yearly clamps leap day",
    "2024-02-29",
    "2024-02-29",
    "yearly",
    null,
    "2025-02-28",
  ],
  [
    "yearly recovers leap day",
    "2024-02-29",
    "2027-02-28",
    "yearly",
    null,
    "2028-02-29",
  ],
  [
    "weekly is calendar based across DST",
    "2026-03-01",
    "2026-03-01",
    "weekly",
    null,
    "2026-03-08",
  ],
  [
    "inclusive end keeps last occurrence",
    "2026-01-31",
    "2026-01-31",
    "monthly",
    "2026-02-28",
    "2026-02-28",
  ],
  [
    "past end finishes schedule",
    "2026-01-31",
    "2026-02-28",
    "monthly",
    "2026-02-28",
    null,
  ],
  [
    "upper bound finishes schedule",
    "9999-12-31",
    "9999-12-31",
    "yearly",
    null,
    null,
  ],
])
  test(name, () =>
    assert.equal(
      nextOccurrence(d(anchor), d(current), cadence, end ? d(end) : null)
        ?.toISOString()
        .slice(0, 10) || null,
      expected,
    ),
  );
