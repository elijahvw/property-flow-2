const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const compiled = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/prospect-context.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;
const mod = { exports: {} };
new Function("module", "exports", compiled)(mod, mod.exports);
const { prospectContext, prospectSourceContext, prospectReturnPath, prospectHandoffPath, withProspectContext } = mod.exports;
const localUrl = value => new URL(value, "https://propertyflow.test");

test("a prospect handoff round-trips the original pipeline without copying source selectors or return URLs", () => {
  const origin = new URLSearchParams({
    q: "Fictional Maple & Garden + 50%", propertyId: "property/opaque?#", stage: "approved", due: "today", cursor: "cursor|opaque/?#",
    prospectId: "unrelated-marker", prospectQ: "unrelated-search", contactId: "contact-not-a-match", leaseId: "lease-not-a-match", unitId: "unit-not-selected",
    returnTo: "https://outside.test/", redirect: "/platform/users", tenantQ: "tenant-filter",
  });
  const unchanged = origin.toString();
  const context = prospectSourceContext(origin, "prospect/opaque?#");
  assert.deepEqual(context, {
    prospectId: "prospect/opaque?#", prospectQ: "Fictional Maple & Garden + 50%", prospectProperty: "property/opaque?#",
    prospectStage: "approved", prospectDue: "today", prospectCursor: "cursor|opaque/?#",
  });
  const returned = localUrl(prospectReturnPath(new URLSearchParams(context)));
  assert.equal(returned.pathname, "/company/prospects");
  assert.deepEqual(Object.fromEntries(returned.searchParams), {
    q: "Fictional Maple & Garden + 50%", propertyId: "property/opaque?#", stage: "approved", due: "today", cursor: "cursor|opaque/?#", prospectId: "prospect/opaque?#",
  });
  assert.equal(origin.toString(), unchanged, "constructing navigation metadata leaves the origin query untouched");
});

test("namespaced pipeline filters stay distinct from the destination's tenant and lease filters", () => {
  const params = new URLSearchParams({
    prospectId: "prospect-a", prospectQ: "pipeline-search", prospectProperty: "pipeline-property", prospectStage: "review", prospectDue: "overdue", prospectCursor: "pipeline-cursor",
    q: "tenant-search", propertyId: "lease-property", stage: "draft", due: "unscheduled", cursor: "tenant-cursor",
    contactId: "actual-contact", residentId: "actual-account", leaseId: "actual-lease", prospectReturnUrl: "//outside.test/", arbitrary: "not-context",
  });
  assert.deepEqual(prospectContext(params), {
    prospectId: "prospect-a", prospectQ: "pipeline-search", prospectProperty: "pipeline-property", prospectCursor: "pipeline-cursor", prospectStage: "review", prospectDue: "overdue",
  });
  const target = localUrl(withProspectContext("/company/leases?new=lease&propertyId=lease-property&contactId=actual-contact#terms", params));
  assert.equal(target.pathname, "/company/leases");
  assert.equal(target.hash, "#terms");
  assert.equal(target.searchParams.get("new"), "lease");
  assert.equal(target.searchParams.get("propertyId"), "lease-property");
  assert.equal(target.searchParams.get("contactId"), "actual-contact");
  assert.equal(target.searchParams.get("prospectProperty"), "pipeline-property");
  for (const key of ["q", "stage", "due", "cursor", "residentId", "leaseId", "prospectReturnUrl", "arbitrary"])
    assert.equal(target.searchParams.has(key), false, key);
});

test("plain prospect IDs remain compatible and marker fields cannot supply a return destination", () => {
  const params = new URLSearchParams({ prospectId: "plain-prospect", returnTo: "https://outside.test/", url: "/platform/users", prospectReturnUrl: "//outside.test/" });
  assert.deepEqual(prospectContext(params), { prospectId: "plain-prospect" });
  assert.equal(prospectReturnPath(params), "/company/prospects?prospectId=plain-prospect");
  assert.equal(localUrl(prospectReturnPath(new URLSearchParams({ prospectId: "https://outside.test/?x=1#part" }))).pathname, "/company/prospects");
});

test("missing, oversized or control-containing prospect IDs cannot activate a partial return context", () => {
  for (const id of [null, "", "x".repeat(201), "prospect\nother", "prospect\u0000other", "prospect\u007fother", "prospect\\other"]) {
    const params = new URLSearchParams({ prospectQ: "safe-search", prospectProperty: "safe-property", prospectStage: "approved", prospectDue: "today", prospectCursor: "safe-cursor" });
    if (id !== null) params.set("prospectId", id);
    assert.deepEqual(prospectContext(params), {}, JSON.stringify(id));
    assert.equal(prospectReturnPath(params), null, JSON.stringify(id));
    assert.deepEqual(prospectSourceContext(new URLSearchParams({ prospectId: "fallback-is-not-authority", q: "safe-search" }), id || ""), {}, JSON.stringify(id));
  }
});

test("invalid optional fields are dropped individually while valid values retain their full bounded content", () => {
  const full = "é".repeat(200);
  const valid = new URLSearchParams({ prospectId: full, prospectQ: full, prospectProperty: full, prospectCursor: full, prospectStage: "converted", prospectDue: "upcoming" });
  assert.deepEqual(prospectContext(valid), Object.fromEntries(valid));
  const invalid = new URLSearchParams({ prospectId: "valid-prospect", prospectQ: "x".repeat(201), prospectProperty: "property\rname", prospectCursor: "x".repeat(201), prospectStage: "signed", prospectDue: "tomorrow" });
  assert.deepEqual(prospectContext(invalid), { prospectId: "valid-prospect" });
  assert.equal(prospectReturnPath(invalid), "/company/prospects?prospectId=valid-prospect");
  invalid.set("prospectQ", "safe-search");
  assert.deepEqual(prospectContext(invalid), { prospectId: "valid-prospect", prospectQ: "safe-search" });
  const backslashes = new URLSearchParams({ prospectId: "valid-prospect", prospectQ: "search\\other", prospectProperty: "property\\other", prospectCursor: "cursor\\other", prospectStage: "approved", prospectDue: "today" });
  assert.deepEqual(prospectContext(backslashes), { prospectId: "valid-prospect", prospectStage: "approved", prospectDue: "today" }, "invalid optional filters do not discard the valid prospect and queue context");
});

test("only the existing prospect stages and follow-up queues survive a return handoff", () => {
  for (const stage of ["inquiry", "tour", "application", "review", "approved", "declined", "withdrawn", "converted"])
    assert.equal(prospectContext(new URLSearchParams({ prospectId: "prospect", prospectStage: stage })).prospectStage, stage);
  for (const due of ["overdue", "today", "upcoming"])
    assert.equal(prospectContext(new URLSearchParams({ prospectId: "prospect", prospectDue: due })).prospectDue, due);
});

test("the handoff whitelist includes tenant, lease and financial source routes without exposing other workspaces", () => {
  for (const target of [
    "/company/residents", "/company/residents/account", "/company/tenants/contact", "/company/leases", "/company/leases/lease", "/company/leases/lease/statement", "/company/rent", "/company/deposits",
    "/company/properties/property/residents", "/company/properties/property/leases", "/company/properties/property/rent", "/company/properties/property/deposits",
    "/company/applications", "/company/applications/new", "/company/applications/application", "/company/applications/application/edit", "/company/applications/application/convert",
  ]) assert.equal(prospectHandoffPath(target), true, target);
  for (const target of [
    "/company/prospects", "/platform/users", "/resident", "/resident/leases/lease/statement", "/account", "/company/maintenance", "/company/finances",
    "/company/leases/lease/statement/extra", "/company/residents/account/extra", "/company/properties/property/maintenance", "/company/properties/property/units", "/company/tenants",
    "/company/applications/application/delete", "/company/applications/application/convert/extra",
  ]) assert.equal(prospectHandoffPath(target), false, target);
});

test("safe path appending replaces old marker fields and rejects unsupported or external destinations", () => {
  const params = new URLSearchParams({ prospectId: "new-prospect", prospectStage: "approved", returnTo: "https://outside.test/" });
  const target = localUrl(withProspectContext("/company/tenants/contact?q=tenant-search&prospectId=old-prospect&prospectQ=old-search&prospectDue=today#contact", params));
  assert.equal(target.pathname, "/company/tenants/contact");
  assert.equal(target.hash, "#contact");
  assert.deepEqual(Object.fromEntries(target.searchParams), { q: "tenant-search", prospectId: "new-prospect", prospectStage: "approved" });
  const cleared = localUrl(withProspectContext("/company/tenants/contact?prospectId=old-prospect&prospectQ=old-search&q=tenant-search", new URLSearchParams()));
  assert.deepEqual(Object.fromEntries(cleared.searchParams), { q: "tenant-search" });
  for (const unsafe of ["https://outside.test/company/leases", "//outside.test/company/leases", "javascript:alert(1)", "http://[", "/company/maintenance", "/company/prospects", "/company/leases/../prospects"])
    assert.equal(withProspectContext(unsafe, params), "/company/prospects", unsafe);
});
