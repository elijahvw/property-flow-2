import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { captureInventory, describeRouteRegistration, inventoryDrift, manifestInventory, runtimeInventory } from "../scripts/api-inventory.mjs";

// This executes registration with inaccessible DB/provider transports. It does
// not invoke a handler, start an HTTP server, or require generated build output.
let inventory;
let byOperation;
before(async () => {
  inventory = await captureInventory();
  byOperation = new Map(inventory.routes.map(route => [route.operation, route]));
});

test("checked-in inventory matches the actual production registration graph", async () => {
  const expected = JSON.parse(await readFile(new URL("../docs/api/route-inventory.json", import.meta.url), "utf8"));
  assert.deepEqual(manifestInventory(inventory), expected);
  const runtime = JSON.parse(await readFile(new URL("../server/src/api/route-inventory.json", import.meta.url), "utf8"));
  assert.deepEqual(runtimeInventory(inventory), runtime);
});

test("inventory includes health, session callbacks, telemetry and business routes", () => {
  for (const operation of ["GET /", "GET /api/health", "GET /api/ready", "GET /api/auth/login", "GET /api/auth/callback", "POST /api/auth/logout", "POST /api/telemetry", "POST /api/company/leases", "GET /api/resident/leases", "GET /api/platform/users"])
    assert.ok(byOperation.has(operation), operation);
  assert.equal(byOperation.get("GET /api/auth/callback").authentication, "no-route-preValidation-hook");
  assert.equal(byOperation.get("POST /api/auth/logout").authentication, "preValidation-hook");
  assert.equal(byOperation.get("POST /api/telemetry").supportMode, "telemetry-write-exception");
  assert.equal(byOperation.get("POST /api/company/leases").supportMode, "centrally-read-only");
});

test("Fastify-generated HEAD operations retain their real source", () => {
  const head = byOperation.get("HEAD /api/company/leases");
  const get = byOperation.get("GET /api/company/leases");
  assert.equal(head.generatedHead, true);
  assert.deepEqual(head.source, get.source);
  assert.equal(new Set(inventory.routes.map(route => route.operation)).size, inventory.routes.length);
});

test("source evidence links validation, authorization and responses without claiming schema coverage", () => {
  const lease = byOperation.get("POST /api/company/leases");
  assert.equal(lease.contractReview, "source-evidence-only");
  assert.ok(lease.observedPermissionCalls.includes("lease.manage"));
  assert.ok(lease.bodyKeys.includes("submissionKey"));
  assert.ok(lease.bodyKeys.includes("expectedPreviousVersion"));
  assert.ok(lease.statuses.includes(409));
  assert.ok(lease.errorCodes.includes("SUBMISSION_MISMATCH"));
  assert.ok(lease.sourceEvidence.input.length);
  assert.ok(lease.sourceEvidence.response.length);
  const query = byOperation.get("GET /api/company/leases");
  assert.ok(query.queryKeys.includes("cursor"));
  assert.ok(query.queryKeys.includes("approvals"));
});

test("runtime reference excludes generated HEAD and documentation assets", () => {
  const runtime = runtimeInventory(inventory);
  assert.ok(runtime.routes.every(route => route.method !== "HEAD" && route.protocol !== "documentation-infrastructure"));
  assert.equal(runtime.routes.length, inventory.routes.filter(route => !route.generatedHead && route.protocol !== "documentation-infrastructure").length);
  assert.ok(runtime.routes.every(route => route.handlerHash.length === 64 && route.reviewStatus === "unverified-source-evidence"));
  assert.equal("document" in manifestInventory({ ...inventory, document: { protected: true } }), false);
  assert.equal("document" in runtimeInventory({ ...inventory, document: { protected: true } }), false);
  assert.equal(inventory.generation.staticSourceRegistrationSites, inventory.generation.observedSourceRegistrationSites);
  assert.deepEqual(inventory.generation.unobservedSourceRegistrationSites, []);
});

test("drift detects a deliberately missing or changed registered operation", () => {
  const removed = { ...inventory, routes: inventory.routes.filter(route => route.operation !== "POST /api/company/leases") };
  assert.deepEqual(inventoryDrift(inventory, removed).removed, ["POST /api/company/leases"]);
  const changed = { ...inventory, routes: inventory.routes.map(route => route.operation === "POST /api/company/leases" ? { ...route, authentication: "no-route-preValidation-hook" } : route) };
  assert.deepEqual(inventoryDrift(inventory, changed).changed, ["POST /api/company/leases"]);
  const added = { ...inventory, routes: [...inventory.routes, { operation: "POST /api/not-yet-documented" }] };
  assert.deepEqual(inventoryDrift(inventory, added).added, ["POST /api/not-yet-documented"]);
});

test("drift also detects changed shared source even when operation keys stay fixed", () => {
  const changed = { ...inventory, sourceFiles: inventory.sourceFiles.map((file, index) => index === 0 ? { ...file, sha256: "changed" } : file) };
  assert.equal(inventoryDrift(inventory, changed).sourceChanged, true);
  assert.deepEqual(inventoryDrift(inventory, changed).changed, []);
});

test("documentation exceptions require both named operation and actual plugin provenance", () => {
  const stack = "    at routes (/workspace/node_modules/@fastify/swagger-ui/lib/routes.js:100:5)";
  const trusted = describeRouteRegistration({ method: "GET", path: "/api/docs/json", stack });
  assert.equal(trusted.protocol, "documentation-infrastructure");
  assert.equal(trusted.source.package.name, "@fastify/swagger-ui");
  assert.equal(trusted.authentication, "inherited-onRequest-documentation-gate");
  assert.throws(() => describeRouteRegistration({ method: "GET", path: "/api/docs/custom", stack }), /Unattributed runtime route/);
  assert.throws(() => describeRouteRegistration({ method: "POST", path: "/api/docs/json", stack }), /Unattributed runtime route/);
  assert.throws(() => describeRouteRegistration({ method: "GET", path: "/api/docs/json", stack: "    at custom (/workspace/server/src/custom.ts:1:1)" }), /Unattributed runtime route/);
  assert.throws(() => describeRouteRegistration({ method: "GET", path: "/api/docs/json", stack: "    at static (/workspace/node_modules/@fastify/static/index.js:100:5)" }), /unexpected documentation plugin/);
  assert.throws(() => describeRouteRegistration({ method: "GET", path: "/api/docs/coverage" }), /Unattributed runtime route/);
});

test("custom source routes in the docs namespace retain their own access and contract obligation", () => {
  const source = { file: "server/src/custom.ts", line: 1, registrationHash: "a".repeat(64), registrationMethod: "get" };
  for (const path of ["/api/docs/custom", "/api/docs/json"]) {
    const route = { method: "GET", path, operation: `GET ${path}`, generatedHead: false,
      ...describeRouteRegistration({ method: "GET", path, source, authenticated: false,
        stack: "    at routes (/workspace/node_modules/@fastify/swagger-ui/lib/routes.js:100:5)" }) };
    assert.equal(route.protocol, "business", path);
    assert.equal(route.authentication, "no-route-preValidation-hook", path);
    assert.equal(route.supportMode, "not-session-authenticated", path);
    assert.equal(route.source.package, undefined);
    assert.equal(runtimeInventory({ routes: [route] }).routes[0].operation, route.operation,
      "regeneration must retain a custom docs-prefixed operation in the reviewed catalog surface");
  }
});
