const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function load(file) {
  const filename = path.join(__dirname, "../src", file);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => load(`${name.replace(/^\.\//, "")}.ts`), module, module.exports);
  return module.exports;
}
const { leaseContext, leasePath } = load("lease-links.ts");

test("move-in returns preserve the exact lease and source filters without accepting arbitrary destinations", () => {
  const incoming = new URLSearchParams({ onboarding: "move-in", leaseReturn: "lease/opaque", leaseId: "other", leaseListProperty: "maple", leaseListStatus: "draft", tenantId: "tenant", tenantQ: "Rivera", prospectId: "inquiry", prospectStage: "approved", returnTo: "https://outside.invalid" });
  const context = leaseContext(incoming);
  const target = new URL(leasePath(incoming.get("leaseReturn"), context), "https://propertyflow.invalid");
  assert.equal(target.pathname, "/company/leases/lease%2Fopaque");
  assert.equal(target.searchParams.get("onboarding"), "move-in");
  assert.equal(target.searchParams.get("leaseListStatus"), "draft");
  assert.equal(target.searchParams.get("tenantQ"), "Rivera");
  assert.equal(target.searchParams.get("prospectStage"), "approved");
  for (const key of ["leaseId", "leaseReturn", "returnTo"]) assert.equal(target.searchParams.has(key), false);
  for (const value of ["household", "completed", "//outside.invalid", "move-in&section=renewal"]) {
    incoming.set("onboarding", value);
    assert.equal(leaseContext(incoming).onboarding, undefined);
  }
});
