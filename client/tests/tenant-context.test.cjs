const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

// Compile local imports in memory; these checks need no generated build or DOM.
function loadSource(relative, stubs = {}) {
  const cache = new Map();
  function load(filename) {
    const resolved = [filename, `${filename}.ts`, `${filename}.tsx`].find(value => fs.existsSync(value) && fs.statSync(value).isFile());
    if (!resolved) throw new Error(`Missing local test module: ${filename}`);
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const mod = { exports: {} };
    cache.set(resolved, mod);
    const compiled = ts.transpileModule(fs.readFileSync(resolved, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = name => Object.hasOwn(stubs, name) ? stubs[name] : name.startsWith(".") ? load(path.resolve(path.dirname(resolved), name)) : require(name);
    new Function("require", "module", "exports", compiled)(localRequire, mod, mod.exports);
    return mod.exports;
  }
  return load(path.join(__dirname, "../src", relative));
}
const { tenantDirectorySearch, tenantPath, contactPath, tenantLedgerContext } = loadSource("tenant-links.ts");
const { leaseContext, leasePath } = loadSource("lease-links.ts");
const localUrl = value => new URL(value, "https://propertyflow.test");
const prospect = {
  prospectId: "prospect-source", prospectQ: "pipeline search", prospectProperty: "pipeline-property", prospectStage: "approved", prospectDue: "today", prospectCursor: "prospect-page",
};
const longestToken = "A_".repeat(256);
const shorterToken = "B-".repeat(255);

test("tenant paths keep the complete native directory page without mixing rental-history or prospect cursor names", () => {
  const params = new URLSearchParams({
    q: "Fictional José + Maple", access: "verification", propertyId: "actual-property", rental: "former", records: "archived", cursor: longestToken,
    section: "rentals", rentalBefore: shorterToken, ...prospect,
  });
  const directory = new URLSearchParams(tenantDirectorySearch(params));
  assert.deepEqual(Object.fromEntries(directory), {
    q: "Fictional José + Maple", access: "verification", propertyId: "actual-property", rental: "former", records: "archived", cursor: longestToken, ...prospect,
  });
  for (const field of ["section", "rentalCursor", "rentalBefore"]) assert.equal(directory.has(field), false, field);
  const identity = "auth0|opaque/person?part#%+";
  for (const [build, pathname] of [[tenantPath, "/company/residents/"], [contactPath, "/company/tenants/"]]) {
    const target = localUrl(build(identity, params));
    assert.equal(target.pathname, pathname + encodeURIComponent(identity));
    assert.equal(target.searchParams.get("cursor"), longestToken);
    assert.equal(target.searchParams.get("rentalBefore"), shorterToken);
    assert.equal(target.searchParams.get("section"), "rentals");
    assert.equal(target.searchParams.get("prospectCursor"), "prospect-page");
    assert.equal(target.searchParams.get("propertyId"), "actual-property");
    assert.equal(target.searchParams.get("prospectProperty"), "pipeline-property");
  }
});

test("directory and history context use separate transport names through a lease and its tenant return link", () => {
  const params = new URLSearchParams({
    q: "tenant search", access: "active", propertyId: "tenant-property", rental: "draft", records: "archived", before: longestToken,
    section: "rentals", rentalCursor: shorterToken, ...prospect,
    tenantId: "unrelated-marker", contactId: "not-a-selector", leaseId: "not-a-selector", returnTo: "https://outside.test/",
  });
  const context = tenantLedgerContext("actual-contact", params, true);
  assert.deepEqual(context, {
    ...prospect, tenantContact: "true", tenantId: "actual-contact", tenantQ: "tenant search", tenantAccess: "active", tenantProperty: "tenant-property", tenantRental: "draft", tenantRecords: "archived",
    tenantBefore: longestToken, tenantSection: "rentals", tenantHistoryCursor: shorterToken,
  });
  const carried = leaseContext(new URLSearchParams({ ...context, cursor: "lease-page", rentalCursor: "wrong-history-page", leaseId: "unrelated-lease", returnTo: "//outside.test/" }));
  assert.deepEqual(carried, context);
  const leaseId = "lease/opaque?part#%";
  const target = localUrl(leasePath(leaseId, carried));
  assert.equal(target.pathname, `/company/leases/${encodeURIComponent(leaseId)}`);
  assert.equal(target.searchParams.get("tenantBefore"), longestToken);
  assert.equal(target.searchParams.get("tenantHistoryCursor"), shorterToken);
  assert.equal(target.searchParams.get("prospectCursor"), "prospect-page");
  for (const field of ["cursor", "rentalCursor", "leaseId", "returnTo"]) assert.equal(target.searchParams.has(field), false, field);
});

test("valid directory and rental-history tokens preserve all 512 base64url characters without truncation", () => {
  for (const key of ["cursor", "before"]) {
    const params = new URLSearchParams({ [key]: longestToken, prospectId: "prospect", prospectCursor: "x".repeat(201) });
    assert.equal(new URLSearchParams(tenantDirectorySearch(params)).get(key), longestToken);
    assert.equal(tenantLedgerContext("actual-tenant", params)[key === "cursor" ? "tenantCursor" : "tenantBefore"], longestToken);
    assert.equal(new URLSearchParams(tenantDirectorySearch(params)).has("prospectCursor"), false, "prospect marker bounds remain independent");
  }
  for (const [native, transport] of [["rentalCursor", "tenantHistoryCursor"], ["rentalBefore", "tenantHistoryBefore"]]) {
    const params = new URLSearchParams({ [native]: longestToken });
    assert.equal(localUrl(contactPath("contact", params)).searchParams.get(native), longestToken, "history paging is valid without a section target");
    const context = tenantLedgerContext("actual-tenant", params);
    assert.equal(context[transport], longestToken);
    assert.equal(leaseContext(new URLSearchParams(context))[transport], longestToken);
    assert.equal(Object.hasOwn(context, "tenantSection"), false);
  }
});

test("invalid paging tokens drop without erasing valid directory filters or prospect context", () => {
  const fields = ["cursor", "before", "rentalCursor", "rentalBefore"];
  for (const invalid of ["", "x".repeat(513), "token+value", "token/value", "token=value", "token%value", "token\\value", "token\nvalue"]) {
    const params = new URLSearchParams({ q: "valid-search", ...prospect, ...Object.fromEntries(fields.map(key => [key, invalid])) });
    const target = localUrl(contactPath("contact", params));
    for (const key of fields) assert.equal(target.searchParams.has(key), false, `${key}: ${JSON.stringify(invalid)}`);
    assert.equal(target.searchParams.get("q"), "valid-search");
    assert.equal(target.searchParams.get("prospectCursor"), "prospect-page");
    const context = tenantLedgerContext("contact", params);
    for (const key of ["tenantCursor", "tenantBefore", "tenantHistoryCursor", "tenantHistoryBefore"]) assert.equal(Object.hasOwn(context, key), false, key);
  }
});

test("lease transport drops invalid or orphan new fields while allowing an independent rentals section target", () => {
  const paging = { tenantCursor: longestToken, tenantBefore: shorterToken, tenantHistoryCursor: shorterToken, tenantHistoryBefore: longestToken, tenantSection: "rentals" };
  const orphan = leaseContext(new URLSearchParams({ ...paging, ...prospect }));
  assert.deepEqual(orphan, prospect, "a prospect marker cannot supply a missing tenant identity");
  const valid = leaseContext(new URLSearchParams({ tenantId: "actual-tenant", ...paging, ...prospect }));
  for (const [key, value] of Object.entries(paging)) assert.equal(valid[key], value, key);
  const invalid = leaseContext(new URLSearchParams({ tenantId: "actual-tenant", tenantCursor: "bad+token", tenantBefore: "x".repeat(513), tenantHistoryCursor: "bad/token", tenantHistoryBefore: "bad=token", tenantSection: "documents", ...prospect }));
  assert.deepEqual(invalid, { tenantId: "actual-tenant", ...prospect });
  assert.deepEqual(leaseContext(new URLSearchParams({ tenantId: "actual-tenant", tenantSection: "rentals" })), { tenantId: "actual-tenant", tenantSection: "rentals" });
  assert.equal(localUrl(contactPath("contact", new URLSearchParams({ section: "rentals" }))).searchParams.get("section"), "rentals");
  assert.equal(localUrl(contactPath("contact", new URLSearchParams({ section: "documents" }))).searchParams.has("section"), false);
});

test("TenantReturnLink restores only its tenant's directory and history envelope and retains the independent prospect marker", () => {
  const params = new URLSearchParams({
    tenantId: "contact/opaque?part#%", tenantContact: "true", tenantQ: "tenant search", tenantAccess: "disabled", tenantProperty: "tenant-property", tenantRental: "former", tenantRecords: "archived",
    tenantCursor: longestToken, tenantHistoryBefore: shorterToken, tenantSection: "rentals", ...prospect,
    q: "lease search", cursor: "unrelated-lease-page", rentalCursor: "unrelated-history-page", returnTo: "https://outside.test/",
  });
  let allowed = true;
  const { TenantReturnLink } = loadSource("components/TenantReturnLink.tsx", {
    "react-router-dom": { Link: "a", useSearchParams: () => [params] },
    "../context/AuthContext": { useAuth: () => ({ can: permission => allowed && permission === "resident.assignment.manage" }) },
  });
  const rendered = TenantReturnLink();
  const target = localUrl(rendered.props.children.props.to);
  assert.equal(target.pathname, `/company/tenants/${encodeURIComponent("contact/opaque?part#%")}`);
  assert.deepEqual(Object.fromEntries(target.searchParams), {
    q: "tenant search", access: "disabled", records: "archived", propertyId: "tenant-property", rental: "former", cursor: longestToken, ...prospect, section: "rentals", rentalBefore: shorterToken,
  });
  allowed = false;
  assert.equal(TenantReturnLink(), null, "navigation metadata does not grant tenant management authority");
  allowed = true; params.delete("tenantId");
  assert.equal(TenantReturnLink(), null, "an unrelated prospect marker does not identify a tenant source");
});
