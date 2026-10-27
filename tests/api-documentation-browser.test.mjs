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

test('real Swagger UI loads with an HttpOnly owner session, displays reviewed contracts and executes no API operations', { timeout: 60000 }, async t => {
  // Dedicated fictional identity and cookie; no provider, customer or database.
  const fixtureCookie = 'api-reference-browser-fixture-only';
  const fixtureOwner = { id: 'api-reference-fixture-owner', email: 'api-reference-owner@example.invalid',
    name: 'Fictional API reference owner', status: 'active', emailVerified: true, platformRole: 'owner', membership: null };
  const app = Fastify();
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
    transformObject: document => apiDocumentTransform(document, false) });
  let sessionReads = 0;
  const db = new Proxy({ session: {
    async findUnique(query) {
      assert.equal(query.where.tokenHash, digest(fixtureCookie));
      assert.ok(++sessionReads <= 64, 'fixture session reads stay bounded');
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
  const requests = [], blockedRequests = [], pageErrors = [];
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
  await page.locator('h3.opblock-tag[data-tag="Rental applications"]').click();
  const applications = page.locator('#operations-Rental_applications-leasing_get_api_company_applications');
  await applications.locator('.opblock-summary').click();
  await expect(applications).toContainText('List filtered rental applications with complete counts');
  await expect(applications).toContainText('complete filtered total');
  await expect(applications).toContainText('pageSize');
  await expect(page.getByRole('button', { name: /try it out|execute/i })).toHaveCount(0);
  assert.deepEqual(blockedRequests, [], 'no external, business or mutation request is attempted');
  assert.deepEqual(businessRequests, [], 'no business/readiness handler executes');
  assert.deepEqual(pageErrors, [], 'the bundled UI initializes without browser exceptions');
  assert.ok(sessionReads > 1, 'real authentication checks the owner cookie for the UI, assets and specification');
  assert.ok(requests.some(request => request.path === '/api/docs/static/swagger-ui-bundle.js'));
  assert.ok(requests.some(request => request.path === '/api/docs/json'));
});
