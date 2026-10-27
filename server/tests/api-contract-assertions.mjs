import assert from 'node:assert/strict';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { apiContractForRoute } from '../dist/api-contracts.js';
import inventory from '../src/api/route-inventory.json' with { type: 'json' };

// Assert serialized real results, independently of documentation registration.
// Callers choose their actual exercised domains; no fixture response is inferred
// from these schemas and no live handler/schema/serialization is modified.
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const matchers = inventory.routes.map(route => ({ ...route,
  matcher: new RegExp(`^${route.path.split('/').map(segment => segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/')}$`),
  dynamic: (route.path.match(/:/g) ?? []).length,
})).sort((a, b) => a.dynamic - b.dynamic);
const validators = new Map();
export function assertDocumentedResponse(method, url, response, sourceFiles) {
  const path = new URL(url, 'http://fixture.invalid').pathname;
  const operation = matchers.find(route => route.method === method.toUpperCase() && route.matcher.test(path));
  if (!operation || (sourceFiles && !sourceFiles.includes(operation.source.file))) return;
  // Existing integration fixtures sometimes use their historical error handler.
  // Their auth/error assertions remain authoritative; this helper checks the
  // exact successful JSON serialized by the actual business handler.
  if (response.statusCode < 200 || response.statusCode >= 300) return;
  const contract = apiContractForRoute(operation.method, operation.path);
  assert.equal(contract['x-pf-contract-status'], 'source-reviewed', `${operation.operation}: contract must be reviewed`);
  const schema = contract.response[response.statusCode];
  assert.ok(schema, `${operation.operation}: undocumented successful HTTP ${response.statusCode}`);
  if (response.statusCode === 204) {
    assert.equal(response.body, '', `${operation.operation}: 204 must be bodyless`);
    return;
  }
  const cacheKey = `${operation.operation} ${response.statusCode}`;
  let validate = validators.get(cacheKey);
  if (!validate) { validate = ajv.compile(schema); validators.set(cacheKey, validate); }
  const valid = validate(response.json());
  // Only bounded schema paths/keywords are reported; never print financial,
  // contact, password or document values from responses.
  const errors = [...new Map((validate.errors ?? []).map(({ instancePath, schemaPath, keyword }) => {
    const entry = { instancePath, schemaPath, keyword }; return [JSON.stringify(entry), entry];
  })).values()];
  // Preserve the tail as well as the first alternatives of oneOf/anyOf, while
  // keeping diagnostics bounded and free of response values.
  const bounded = errors.length > 8 ? [...errors.slice(0, 4), ...errors.slice(-4)] : errors;
  assert.ok(valid, `${cacheKey}: ${JSON.stringify(bounded)}`);
}

export async function documentedInject(app, options) {
  const response = await app.inject(options);
  assertDocumentedResponse(options.method ?? 'GET', options.url, response);
  return response;
}
