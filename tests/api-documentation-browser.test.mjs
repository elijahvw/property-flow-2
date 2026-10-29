import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { expect } from '@playwright/test';
import { launchFixtureBrowser } from '../server/tests/browser-fixture.mjs';
import { installApiDocumentation, registerApiDocumentationRoutes } from '../server/dist/api-documentation.js';
import { apiContractForRoute, apiDocumentTransform } from '../server/dist/api-contracts.js';
import { registerSessions, digest, SESSION_MS, IDLE_MS } from '../server/dist/sessions.js';
import { registerRequestErrors } from '../server/dist/request-errors.js';
import { captureInventory, runtimeInventory } from '../scripts/api-inventory.mjs';

test('real Swagger UI renders every production operation with an HttpOnly owner session and executes no API operations', { timeout: 300000 }, async t => {
  // Dedicated fictional identity and cookie; no provider, customer or database.
  // Capture the actual production registration graph without invoking handlers,
  // startup jobs or transports; the browser receives its complete specification.
  const captured = await captureInventory({ includeDocument: true });
  const document = captured.document;
  const methods = new Set(['get', 'head', 'post', 'put', 'patch', 'delete', 'options', 'trace']);
  const operations = Object.entries(document.paths).flatMap(([path, item]) => Object.entries(item)
    .filter(([method]) => methods.has(method)).map(([method, operation]) => ({ path, method, operation, item })));
  const operationKey = ({ method, path }) => `${method.toUpperCase()} ${path.replace(/\{([^}]+)\}/g, ':$1')}`;
  const expectedKeys = runtimeInventory(captured).routes.map(route => route.operation).sort();
  assert.equal(expectedKeys.length, 304, 'the regression covers the complete current production catalog');
  assert.deepEqual(operations.map(operationKey).sort(), expectedKeys);
  // Deep links make Chromium reload uncached icons on history changes. Bound
  // real session reads by this full traversal, rather than the old two-operation
  // smoke test: four icon reads per open/close plus the initial/focused checks.
  const tagCount = new Set(operations.map(entry => entry.operation.tags?.[0] ?? 'default')).size;
  const maxSessionReads = 16 + 4 * (2 * operations.length + 2 * tagCount + 16);
  const fixtureCookie = 'api-reference-browser-fixture-only';
  const fixtureOwner = { id: 'api-reference-fixture-owner', email: 'api-reference-owner@example.invalid',
    name: 'Fictional API reference owner', status: 'active', emailVerified: true, platformRole: 'owner', membership: null };
  const app = Fastify();
  const serverErrors = [];
  app.addHook('onError', async (request, _reply, error) => {
    // This server contains only fictional documentation fixtures. Keep useful
    // diagnostics bounded and exclude request headers, cookies and bodies.
    serverErrors.push({ path: request.url.split('?')[0], code: error.code, message: error.message.slice(0, 200) });
  });
  const artifacts = await mkdtemp(join(tmpdir(), 'propertyflow-api-reference-'));
  let browser, context, page;
  t.after(async () => {
    try {
      if (page && !page.isClosed()) {
        const screenshot = join(artifacts, 'swagger-ui.png');
        await page.screenshot({ path: screenshot, fullPage: true });
        t.diagnostic(`Fictional local API reference screenshot: ${screenshot}`);
      }
    } finally {
      if (context) {
        const trace = join(artifacts, 'trace.zip');
        await context.tracing.stop({ path: trace });
        t.diagnostic(`Fictional local API reference browser trace: ${trace}`);
      }
      await context?.close();
      await browser?.close();
      await app.close();
    }
  });
  registerRequestErrors(app);
  await installApiDocumentation(app, { contractForRoute: apiContractForRoute, sessionCookieName: 'pf-session',
    transformObject: () => apiDocumentTransform(structuredClone(document), false) });
  let sessionReads = 0;
  const db = new Proxy({ session: {
    async findUnique(query) {
      assert.equal(query.where.tokenHash, digest(fixtureCookie));
      assert.ok(++sessionReads <= maxSessionReads, 'fixture session reads stay bounded by the operation traversal');
      return { tokenHash: digest(fixtureCookie), csrfToken: 'unused-fixture-csrf',
        expiresAt: new Date(Date.now() + SESSION_MS), idleExpiresAt: new Date(Date.now() + IDLE_MS),
        user: { ...fixtureOwner }, impersonatedUserId: null, impersonatedUser: null, impersonationExpiresAt: null };
    },
  } }, { get(target, key) {
    if (!(key in target)) throw new Error(`Unexpected database access in documentation fixture: ${String(key)}`);
    return target[key];
  } });
  const authConfig = { origin: 'http://127.0.0.1', domain: 'provider.example.invalid',
    clientId: 'fictional-unused-client', clientSecret: 'fictional-unused-secret', secure: false };
  const authenticate = await registerSessions(app, db, authConfig);
  const businessRequests = [];
  for (const path of ['/api/health', '/api/ready', '/api/company/applications']) app.get(path, request => {
    businessRequests.push(request.url);
    throw new Error('Documentation must not execute a business or readiness handler.');
  });
  await registerApiDocumentationRoutes(app, authenticate);
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  authConfig.origin = origin; // Exact ephemeral origin; only documentation GETs are exercised.
  browser = await launchFixtureBrowser({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  await context.addCookies([{ name: 'pf-session', value: fixtureCookie, url: origin,
    httpOnly: true, secure: false, sameSite: 'Strict' }]);
  const requests = [], blockedRequests = [], pageErrors = [], consoleErrors = [];
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    const entry = { method: request.method(), origin: url.origin, path: url.pathname };
    requests.push(entry);
    if (url.origin !== origin || !url.pathname.startsWith('/api/docs/') || request.method() !== 'GET') {
      blockedRequests.push(entry);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  // React's component error boundary catches render failures without necessarily
  // emitting pageerror; the original ParameterRow crash is one such failure.
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 1000));
  });
  const specResponse = page.waitForResponse(response => response.url() === `${origin}/api/docs/json`);
  const navigation = await page.goto(`${origin}/api/docs/`);
  assert.equal(navigation.status(), 200);
  assert.equal((await specResponse).status(), 200);
  await expect(page).toHaveTitle('Property Flow API reference');
  await expect(page.getByRole('heading', { name: /^Property Flow API(?:\s|$)/ })).toBeVisible();
  await page.locator('#operations-tag-Health').click();
  const readiness = page.locator('#operations-Health-apiReadiness');
  await readiness.locator('.opblock-summary').click();
  await expect(readiness).toContainText('Executes SELECT 1');
  await expect(readiness).toContainText('Readiness probe failed');
  await expect(readiness.getByText('503', { exact: true })).toBeVisible();
  await readiness.locator('.opblock-summary').click();
  await page.locator('#operations-tag-Health').click();
  await page.locator('h3.opblock-tag[data-tag="Rental applications"]').click();
  const applications = page.locator('#operations-Rental_applications-leasing_get_api_company_applications');
  await applications.locator('.opblock-summary').click();
  await expect(applications).toContainText('List filtered rental applications with complete counts');
  await expect(applications).toContainText('complete filtered total');
  await expect(applications).toContainText('pageSize');
  await applications.locator('.opblock-summary').click();
  await page.locator('h3.opblock-tag[data-tag="Rental applications"]').click();

  // Mount one operation at a time, then collapse its tag. This exercises every
  // ParameterRow/schema without keeping hundreds of large response examples open.
  const byTag = new Map();
  for (const entry of operations) {
    const tag = entry.operation.tags?.[0] ?? 'default';
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push(entry);
  }
  const visited = [];
  let renderedParameterCount = 0;
  for (const [tag, entries] of byTag) {
    const tagHeader = page.locator(`h3.opblock-tag[data-tag=${JSON.stringify(tag)}]`);
    await expect(tagHeader).toHaveAttribute('data-is-open', 'false');
    await tagHeader.click();
    const section = tagHeader.locator('..');
    for (const entry of entries) {
      const key = operationKey(entry);
      // Select by exact method and rendered source path, rather than depending
      // on Swagger's escaping of operation IDs or tag names.
      const block = section.locator(`.opblock-${entry.method}`).filter({
        has: page.locator(`[data-path=${JSON.stringify(entry.path)}]`),
      });
      await expect(block, key).toHaveCount(1);
      await block.locator('.opblock-summary').click();
      await expect(block.locator('.opblock-body'), key).toBeVisible();
      await expect(block.locator('.fallback'), `${key}: no caught component failure`).toHaveCount(0);
      const parameters = new Map([...(entry.item.parameters ?? []), ...(entry.operation.parameters ?? [])]
        .map(parameter => {
          assert.equal(typeof parameter.name, 'string', `${key}: named inline parameter required`);
          assert.equal(typeof parameter.in, 'string', `${key}: parameter location required`);
          return [`${parameter.in} ${parameter.name}`, parameter];
        }));
      const rows = block.locator('table.parameters > tbody > tr[data-param-name]');
      await expect(rows, `${key}: all parameter rows render`).toHaveCount(parameters.size);
      const rendered = await rows.evaluateAll(elements => elements.map(row =>
        `${row.getAttribute('data-param-in')} ${row.getAttribute('data-param-name')}`));
      assert.deepEqual(rendered.sort(), [...parameters.keys()].sort(), `${key}: exact parameter names and locations`);
      assert.deepEqual({ consoleErrors, serverErrors }, { consoleErrors: [], serverErrors: [] }, `${key}: no caught React/browser or fixture errors`);
      assert.deepEqual(pageErrors, [], `${key}: no uncaught browser errors`);
      await expect(block.getByRole('button', { name: /try it out|execute/i })).toHaveCount(0);
      renderedParameterCount += rendered.length;
      visited.push(key);
      await block.locator('.opblock-summary').click();
      await expect(block).not.toHaveClass(/\bis-open\b/);
    }
    await tagHeader.click();
    await expect(tagHeader).toHaveAttribute('data-is-open', 'false');
  }
  assert.deepEqual(visited.sort(), expectedKeys, 'every production method/path was expanded and checked');
  t.diagnostic(`Rendered ${visited.length} production operations and ${renderedParameterCount} parameter rows without business requests; ${sessionReads}/${maxSessionReads} bounded session reads.`);
  await expect(page.locator('.fallback')).toHaveCount(0);
  // Leave a useful real contract open in the retained screenshot.
  await page.locator('h3.opblock-tag[data-tag="Rental applications"]').click();
  await applications.locator('.opblock-summary').click();
  await expect(applications).toContainText('complete filtered total');
  await expect(page.getByRole('button', { name: /try it out|execute/i })).toHaveCount(0);
  assert.deepEqual(blockedRequests, [], 'no external, business or mutation request is attempted');
  assert.deepEqual(businessRequests, [], 'no business/readiness handler executes');
  assert.deepEqual(pageErrors, [], 'the bundled UI initializes without browser exceptions');
  assert.deepEqual(consoleErrors, [], 'the complete reference renders without caught React errors');
  assert.ok(sessionReads > 1, 'real authentication checks the owner cookie for the UI, assets and specification');
  assert.ok(requests.some(request => request.path === '/api/docs/static/swagger-ui-bundle.js'));
  assert.ok(requests.some(request => request.path === '/api/docs/json'));
});
