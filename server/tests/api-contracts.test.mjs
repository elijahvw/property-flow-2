import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { captureInventory, runtimeInventory } from '../../scripts/api-inventory.mjs';
import { apiContractForRoute, apiContractCoverage, isSourceReviewedContract } from '../dist/api-contracts.js';
import { registerHealth } from '../dist/health.js';
import { registerRequestErrors } from '../dist/request-errors.js';

let capture;
before(async () => { capture = await captureInventory({ includeDocument: true }); });
const operationKey = (method, path) => `${method.toUpperCase()} ${path.replace(/\{([^}]+)\}/g, ':$1')}`;
function documentedOperations(document) {
  const methods = new Set(['get', 'head', 'post', 'put', 'patch', 'delete', 'options', 'trace']);
  return Object.entries(document.paths).flatMap(([path, item]) => Object.keys(item)
    .filter(method => methods.has(method)).map(method => operationKey(method, path))).sort();
}

test('production OpenAPI accounts for every explicit API and separates HEAD/documentation infrastructure', () => {
  const expected = runtimeInventory(capture).routes.map(route => route.operation).sort();
  assert.deepEqual(documentedOperations(capture.document), expected);
  assert.equal(capture.document.openapi, '3.0.3');
  assert.equal(new Set(expected).size, expected.length);
  assert.ok(capture.routes.some(route => route.protocol === 'documentation-infrastructure'));
  assert.ok(capture.routes.some(route => route.generatedHead));
  assert.ok(!Object.keys(capture.document.paths).some(path => path.startsWith('/api/docs')));
});

test('a missing documented operation fails parity rather than disappearing behind route counts', () => {
  const incomplete = structuredClone(capture.document);
  delete incomplete.paths['/api/company/leases'].post;
  const expected = runtimeInventory(capture).routes.map(route => route.operation).sort();
  assert.notDeepEqual(documentedOperations(incomplete), expected);
  assert.ok(expected.includes('POST /api/company/leases'));
  assert.ok(!documentedOperations(incomplete).includes('POST /api/company/leases'));
});

test('source-reviewed contracts and remaining field-review gaps are reported independently', () => {
  const coverage = apiContractCoverage();
  assert.equal(coverage.indexedOperations, runtimeInventory(capture).routes.length);
  assert.equal(coverage.sourceReviewedOperations + coverage.sourceIndexedOnly.length, coverage.indexedOperations);
  assert.equal(coverage.sourceReviewedOperations, coverage.indexedOperations, 'new endpoints require an actual reviewed contract, not an index-only entry');
  assert.deepEqual(coverage.sourceIndexedOnly, []);
  assert.equal(coverage.handlerVerifiedOperations, 0, 'source review does not assert complete handler verification');
  assert.deepEqual(coverage.orphanReviewedContracts, []);
  assert.deepEqual(coverage.duplicateReviewedContracts, []);
  assert.equal(isSourceReviewedContract({}), false, 'a truthy placeholder cannot close the review gap');
  assert.equal(isSourceReviewedContract({ 'x-pf-contract-status': 'source-reviewed' }), false, 'a review flag alone cannot replace a contract');
  assert.equal(isSourceReviewedContract({ 'x-pf-contract-status': 'source-indexed' }), false);
  for (const route of runtimeInventory(capture).routes)
    assert.equal(apiContractForRoute(route.method, route.path)['x-pf-contract-status'], 'source-reviewed', route.operation);
  assert.equal(apiContractForRoute('GET', '/api/account/guide')['x-pf-contract-status'], 'source-reviewed');
  const lease = apiContractForRoute('POST', '/api/company/leases');
  assert.equal(lease['x-pf-contract-status'], 'source-reviewed');
  assert.ok(lease.body);
  assert.ok(lease.response[200]);
  assert.equal(apiContractForRoute('POST', '/api/not-registered'), undefined);
});

test('every reviewed request and response schema compiles independently of live route validation', () => {
  const ajv = new Ajv({ strict: false }); addFormats(ajv);
  for (const route of runtimeInventory(capture).routes) {
    const contract = apiContractForRoute(route.method, route.path);
    for (const [part, schema] of Object.entries({ params: contract.params, query: contract.querystring,
      headers: contract.headers, body: contract.body, ...Object.fromEntries(Object.entries(contract.response).map(([status, schema]) => [`response-${status}`, schema])) })) {
      if (!schema) continue;
      assert.doesNotThrow(() => ajv.compile(schema), `${route.operation}: ${part}`);
    }
  }
});

test('documented security schemes resolve and actual protocol exceptions retain their behavior', () => {
  const document = capture.document;
  assert.equal(document.components.securitySchemes.sessionCookie.name, '__Host-pf-session');
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!operation.responses) continue;
      for (const alternative of operation.security ?? [])
        for (const scheme of Object.keys(alternative)) assert.ok(document.components.securitySchemes[scheme], `${method} ${path}: ${scheme}`);
      assert.ok(Object.keys(operation.responses).length, `${method} ${path}`);
    }
  }
  assert.deepEqual(document.paths['/api/health'].get.security, []);
  assert.deepEqual(document.paths['/api/auth/callback'].get.security, []);
  assert.ok(document.paths['/api/auth/callback'].get.responses['302']);
  assert.equal(document.paths['/api/auth/callback'].get.responses['302'].content, undefined);
  assert.ok(document.paths['/api/telemetry'].post.responses['204']);
  assert.equal(document.paths['/api/telemetry'].post.responses['204'].content, undefined);
});

test('the protected generated specification contains no captured credentials or private examples', () => {
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    assert.equal(Object.hasOwn(value, 'example'), false);
    assert.equal(Object.hasOwn(value, 'examples'), false);
    for (const item of Object.values(value)) visit(item);
  };
  visit(capture.document);
  assert.doesNotMatch(JSON.stringify(capture.document), /token-platform|fixture-secret|BEGIN PRIVATE KEY|Bearer eyJ/);
});

test('real health and readiness outcomes conform to their source-reviewed response schemas', async t => {
  const app = Fastify();
  registerRequestErrors(app);
  let queries = 0, fail = false;
  registerHealth(app, { $queryRaw: async query => {
    assert.equal(query[0], 'SELECT 1'); queries++;
    if (fail) throw new Error('private database diagnostic must stay concealed');
    return [];
  } });
  t.after(() => app.close());
  const ajv = new Ajv({ strict: false }); addFormats(ajv);
  for (const path of ['/', '/api/health', '/api/ready']) {
    const result = await app.inject(path);
    assert.equal(result.statusCode, 200);
    const validate = ajv.compile(apiContractForRoute('GET', path).response[200]);
    assert.ok(validate(result.json()), JSON.stringify(validate.errors));
  }
  assert.equal(queries, 1, 'liveness routes do not issue database probes');
  fail = true;
  const unavailable = await app.inject('/api/ready');
  assert.equal(unavailable.statusCode, 503);
  const validate = ajv.compile(apiContractForRoute('GET', '/api/ready').response[503]);
  assert.ok(validate(unavailable.json()), JSON.stringify(validate.errors));
  assert.doesNotMatch(unavailable.body, /private database diagnostic/);
});
