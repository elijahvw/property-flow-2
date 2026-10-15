const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  test = require("node:test"),
  ts = require("typescript");
const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/rent-policy.ts"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  },
).outputText;
const mod = { exports: {} };
new Function("module", "exports", compiled)(mod, mod.exports);
const { scheduledDueDate, graceDates } = mod.exports;
test("lease due-day previews clamp short months and include leap days", () => {
  assert.equal(scheduledDueDate("2027-02", 31), "2027-02-28");
  assert.equal(scheduledDueDate("2028-02", 31), "2028-02-29");
  assert.equal(scheduledDueDate("2026-11", 31), "2026-11-30");
  assert.equal(scheduledDueDate("2026-01", 15), "2026-01-15");
});
test("grace previews count full calendar days after due date across month, year and DST boundaries", () => {
  assert.deepEqual(graceDates("2026-01-01", 5), {
    through: "2026-01-06",
    after: "2026-01-07",
  });
  assert.deepEqual(graceDates("2026-12-31", 0), {
    through: "2026-12-31",
    after: "2027-01-01",
  });
  assert.deepEqual(graceDates("2026-03-07", 2), {
    through: "2026-03-09",
    after: "2026-03-10",
  });
  assert.equal(graceDates("", 5).through, "Choose a due date");
  assert.equal(graceDates("2026-10-01", 1e20).through, "Choose a due date");
});
