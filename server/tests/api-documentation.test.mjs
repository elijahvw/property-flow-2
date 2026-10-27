import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import Fastify from 'fastify';
import { AccessError } from '../dist/access.js';
import { installApiDocumentation, registerApiDocumentationRoutes } from '../dist/api-documentation.js';
import { registerRequestErrors } from '../dist/request-errors.js';

const owner = { id: 'fixture-owner', status: 'active', emailVerified: true, platformRole: 'owner', membership: null };
const actors = {
  owner,
  support: { ...owner, platformRole: 'support' },
  disabled: { ...owner, status: 'disabled' },
  unverified: { ...owner, emailVerified: false },
  ...Object.fromEntries(['owner', 'manager', 'staff', 'resident'].map(role => [`company-${role}`, {
    ...owner, platformRole: null,
    membership: { companyId: 'fixture-company', role, status: 'active', company: { status: 'active' } },
  }])),
};
const paths = ['/api/docs', '/api/docs/', '/api/docs/json', '/api/docs/yaml',
  '/api/docs/static/swagger-initializer.js', '/api/docs/static/swagger-ui.css',
  '/api/docs/static/swagger-ui-bundle.js', '/api/docs/static/index.html'];
const contract = {
  operationId: 'exampleRead', summary: 'Read fixture resource', tags: ['Fixture'],
  security: [{ sessionCookie: [] }],
  response: { 200: { type: 'object', properties: { label: { type: 'string' } } } },
  'x-pf-access': { permission: 'platform.manage', support: 'denied' },
};

async function fixture(t, options = {}) {
  const app = Fastify();
  registerRequestErrors(app);
  const inventory = await installApiDocumentation(app, {
    contractForRoute: (method, path) => path === '/api/example' && method === 'GET' ? contract : undefined,
    ...options,
  });
  let currentActors = { ...actors };
  const authentications = [];
  const authenticate = async request => {
    authentications.push(request.url);
    const principal = currentActors[request.headers['x-fixture-actor']];
    if (!principal) throw new AccessError(401, 'SIGN_IN_REQUIRED', 'Sign in to continue.');
    request.principal = principal;
    if (request.headers['x-fixture-view'] === 'active') request.impersonation = { readOnly: true };
    if (request.headers['x-fixture-view'] === 'pinned') request.appSession = { impersonatedUserId: 'fixture-target' };
  };
  app.get('/api/example', () => ({ label: 'Fixture', privateRuntimeField: 'preserved' }));
  await registerApiDocumentationRoutes(app, authenticate);
  await app.ready();
  t.after(() => app.close());
  return { app, inventory, authentications, setActor: (name, actor) => { currentActors[name] = actor; } };
}

test('documentation UI, specs, redirects and bundled assets require fresh platform owner authority', async t => {
  const { app, authentications } = await fixture(t);
  for (const path of paths) {
    const anonymous = await app.inject(path);
    assert.equal(anonymous.statusCode, 401, path);
    assert.equal(anonymous.headers['cache-control'], 'no-store');
    assert.doesNotMatch(anonymous.body, /Property Flow API|openapi|swagger-ui-bundle|fixture-owner/);
    for (const actor of Object.keys(actors).filter(value => value !== 'owner')) {
      const response = await app.inject({ url: path, headers: { 'x-fixture-actor': actor } });
      assert.equal(response.statusCode, 403, `${actor}: ${path}`);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.doesNotMatch(response.body, /Property Flow API|fixture-owner/);
    }
  }
  assert.equal(authentications.length, paths.length * Object.keys(actors).length);
});

test('owner docs use only local assets and remain uncached, including static conditional reads', async t => {
  const { app } = await fixture(t);
  for (const path of paths) {
    const response = await app.inject({ url: path, headers: { 'x-fixture-actor': 'owner' } });
    assert.ok([200, 301, 302].includes(response.statusCode), `${path}: ${response.statusCode} ${response.body.slice(0,150)}`);
    assert.equal(response.headers['cache-control'], 'no-store', path);
    assert.equal(response.headers['pragma'], 'no-cache');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.equal(response.headers['x-frame-options'], 'DENY');
    const csp = response.headers['content-security-policy'];
    assert.match(csp, /connect-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /https:|validator\.swagger\.io|'unsafe-eval'/);
    if (path === '/api/docs/') {
      assert.match(response.body, /Property Flow API reference/);
      assert.doesNotMatch(response.body, /(?:src|href)="https?:/);
    }
    if (response.headers.etag) {
      const denied = await app.inject({ url: path, headers: { 'if-none-match': response.headers.etag } });
      assert.equal(denied.statusCode, 401, `${path}: conditional requests still authenticate`);
      const unchanged = await app.inject({ url: path, headers: { 'x-fixture-actor': 'owner', 'if-none-match': response.headers.etag } });
      assert.equal(unchanged.headers['cache-control'], 'no-store');
    }
  }
});

test('all impersonation projections deny docs even when the effective target is also a platform owner', async t => {
  const { app } = await fixture(t);
  for (const view of ['active', 'pinned']) {
    for (const path of paths) {
      const response = await app.inject({ url: path, headers: { 'x-fixture-actor': 'owner', 'x-fixture-view': view } });
      assert.equal(response.statusCode, 403, `${view}: ${path}`);
      assert.equal(response.json().code, 'DOCUMENTATION_ACCESS_DENIED');
    }
  }
});

test('access is re-read on every spec and asset request after a platform grant is revoked', async t => {
  const { app, setActor } = await fixture(t);
  const headers = { 'x-fixture-actor': 'owner' };
  assert.equal((await app.inject({ url: '/api/docs/json', headers })).statusCode, 200);
  setActor('owner', actors['company-manager']);
  for (const path of ['/api/docs/json', '/api/docs/static/swagger-ui-bundle.js'])
    assert.equal((await app.inject({ url: path, headers })).statusCode, 403);
});

test('explicit static and generated HEAD routes preserve denial status and send no payload', async t => {
  const { app } = await fixture(t);
  for (const path of paths) {
    for (const [actor, expected] of [[undefined, 401], ['company-owner', 403], ['owner', path === '/api/docs/static/index.html' ? 302 : 200]]) {
      const response = await app.inject({ method: 'HEAD', url: path, headers: actor ? { 'x-fixture-actor': actor } : {} });
      assert.equal(response.statusCode, expected, `${actor ?? 'anonymous'} ${path}: ${response.body}`);
      assert.equal(response.body, '', `${actor ?? 'anonymous'} ${path}`);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['pragma'], 'no-cache');
    }
  }
});

test('catalog schemas and metadata document the real route without changing runtime serialization or validation', async t => {
  const writeContract = {
    operationId: 'fixtureWrite', summary: 'Fixture docs-only schema', tags: ['Fixture'],
    body: { type: 'object', required: ['documented'], properties: { documented: { type: 'string' } }, additionalProperties: false },
    response: { 200: { type: 'object', properties: { documented: { type: 'string' } }, additionalProperties: false } },
  };
  const app = Fastify();
  const inventory = await installApiDocumentation(app, {
    contractForRoute: (method, path) => path === '/api/example' ? contract : path === '/api/write' ? writeContract : undefined,
  });
  app.get('/api/example', () => ({ label: 'Fixture', privateRuntimeField: 'preserved' }));
  app.post('/api/write', request => ({ accepted: request.body, additionalRuntimeField: true }));
  t.after(() => app.close());
  await app.ready();
  const spec = app.swagger();
  assert.equal(spec.openapi, '3.0.3');
  assert.deepEqual(spec.paths['/api/example'].get['x-pf-access'], contract['x-pf-access']);
  assert.equal(spec.paths['/api/write'].post.requestBody.required, true);
  assert.deepEqual((await app.inject('/api/example')).json(), { label: 'Fixture', privateRuntimeField: 'preserved' });
  const written = await app.inject({ method: 'POST', url: '/api/write', payload: { actualInput: 'retained' } });
  assert.equal(written.statusCode, 200);
  assert.deepEqual(written.json(), { accepted: { actualInput: 'retained' }, additionalRuntimeField: true });
  assert.deepEqual(inventory.registeredRoutes().map(route => `${route.method} ${route.path}`),
    ['GET /api/example', 'HEAD /api/example', 'POST /api/write']);
  assert.equal(spec.paths['/api/example'].head, undefined, 'implicit HEAD is inventoried separately from GET documentation');
  assert.deepEqual(writeContract.body.required, ['documented'], 'spec generation does not mutate the contract source');
});

test('Swagger configuration disables execution, persisted credentials and external specification requests', async t => {
  const { app } = await fixture(t);
  const response = await app.inject({ url: '/api/docs/static/swagger-initializer.js', headers: { 'x-fixture-actor': 'owner' } });
  assert.equal(response.statusCode, 200);
  let config;
  const bundle = Object.assign(value => { config = value; return { initOAuth() {} }; }, {
    presets: { apis: {} }, plugins: { DownloadUrl: {} },
  });
  const context = {
    URL, SwaggerUIBundle: bundle, SwaggerUIStandalonePreset: {},
    window: { location: { href: 'https://property-flow.invalid/api/docs/', origin: 'https://property-flow.invalid' } },
    document: { createElement: () => ({ href: '' }) },
  };
  vm.runInNewContext(response.body, context);
  context.window.onload();
  assert.equal(config.layout, 'BaseLayout');
  assert.deepEqual(Array.from(config.supportedSubmitMethods), []);
  assert.equal(config.tryItOutEnabled, false);
  assert.equal(config.persistAuthorization, false);
  assert.equal(config.queryConfigEnabled, false);
  assert.equal(config.validatorUrl, null);
  const allowed = config.requestInterceptor({ url: 'https://property-flow.invalid/api/docs/json', method: 'GET' });
  assert.equal(allowed.credentials, 'same-origin');
  for (const request of [
    { url: 'https://external.invalid/api/docs/json' },
    { url: 'https://property-flow.invalid/api/health' },
    { url: 'https://property-flow.invalid/api/docs/json', method: 'POST' },
  ]) assert.throws(() => config.requestInterceptor(request), /only loads its same-origin specification/);
});
