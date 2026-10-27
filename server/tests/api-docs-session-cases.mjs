import assert from 'node:assert/strict';

// These requests pass through registerSessions with real fixture cookies and
// current PostgreSQL identities; no test header supplies documentation authority.
const paths = [
  '/api/docs', '/api/docs/', '/api/docs/json', '/api/docs/yaml',
  '/api/docs/static/swagger-initializer.js', '/api/docs/static/swagger-ui.css',
  '/api/docs/static/swagger-ui-bundle.js', '/api/docs/static/index.html',
];
const methods = ['GET', 'HEAD'];

function uncached(response, label) {
  assert.equal(response.headers['cache-control'], 'no-store', label);
  assert.equal(response.headers.pragma, 'no-cache', label);
  assert.equal(response.headers['x-content-type-options'], 'nosniff', label);
}

function denied(response, status, method, label, code) {
  assert.equal(response.statusCode, status, `${label}: ${response.body}`);
  uncached(response, label);
  if (method === 'HEAD') assert.equal(response.body, '', label);
  else {
    if (code) assert.equal(response.json().code, code, label);
    assert.doesNotMatch(response.body, /Property Flow API|openapi|swagger-ui-bundle|sessionFixtureBootstrap/, label);
  }
}

export async function apiDocsSessionCases(t, { admin, call, start, stop }) {
  await t.test('real sessions deny documentation and assets to anonymous users and nonplatform company roles', async () => {
    for (const method of methods) {
      for (const path of paths) {
        denied(await call(null, method, path), 401, method, `anonymous ${method} ${path}`, 'SIGN_IN_REQUIRED');
        for (const user of ['owner', 'manager', 'staff', 'resident', 'support', 'disabled', 'unverified'])
          denied(await call(user, method, path), 403, method, `${user} ${method} ${path}`);
      }
    }
  });

  await t.test('real platform owner session reads uncached documentation, definitions and local assets with GET and HEAD', async () => {
    for (const method of methods) {
      for (const path of paths) {
        const response = await call('platform', method, path);
        const label = `platform ${method} ${path}`;
        const redirects = path === '/api/docs/static/index.html';
        assert.equal(response.statusCode, redirects ? 302 : 200, `${label}: ${response.body}`);
        if (redirects) assert.equal(response.headers.location, '/api/docs/');
        uncached(response, label);
        if (method === 'HEAD') assert.equal(response.body, '', label);
        else if (path === '/api/docs/json') {
          const specification = response.json();
          assert.equal(specification.openapi, '3.0.3');
          assert.equal(specification.components.securitySchemes.sessionCookie.name, '__Host-pf-session');
          assert.equal(specification.paths['/api/bootstrap'].get.operationId, 'sessionFixtureBootstrap');
          assert.equal(response.body.includes('token-platform'), false);
        }
      }
    }
  });

  await t.test('documentation rejects current impersonation and stale identity headers even for a platform owner target', async () => {
    // A platform target deliberately retains platform.manage in its effective
    // projection, so this verifies the explicit impersonation restriction too.
    const viewed = await start('platform', 'platform');
    const context = viewed.impersonation?.contextId;
    try {
      assert.equal(typeof context, 'string');
      assert.ok(context);
      assert.ok(viewed.permissions.includes('platform.manage'));
      for (const method of methods) {
        for (const path of paths) {
          denied(await call('platform', method, path), 403, method,
            `impersonation ${method} ${path}`, 'DOCUMENTATION_ACCESS_DENIED');
          for (const marker of ['', 'stale-fixture-context'])
            denied(await call('platform', method, path, undefined, { 'x-impersonation-id': marker }), 409, method,
              `stale context ${method} ${path}`, 'IMPERSONATION_CONTEXT_CHANGED');
        }
      }
    } finally {
      await stop('platform');
    }
    for (const method of methods) {
      for (const path of ['/api/docs/json', '/api/docs/static/swagger-ui-bundle.js'])
        denied(await call('platform', method, path, undefined, { 'x-impersonation-id': context }), 409, method,
          `ended context ${method} ${path}`, 'IMPERSONATION_CONTEXT_CHANGED');
    }
    assert.equal((await call('platform', 'GET', '/api/docs/json')).statusCode, 200);
  });

  await t.test('documentation authority is freshly read from PostgreSQL after a platform grant is revoked', async () => {
    assert.equal((await call('platform', 'GET', '/api/docs/json')).statusCode, 200);
    const original = (await admin.query('SELECT "platformRole" FROM "User" WHERE id=$1', ['platform'])).rows[0].platformRole;
    try {
      // Only the dedicated disposable fixture is changed. The same cookie stays
      // valid, so a cached principal or session-time grant would fail this test.
      await admin.query('UPDATE "User" SET "platformRole"=NULL WHERE id=$1', ['platform']);
      for (const method of methods) {
        for (const path of paths)
          denied(await call('platform', method, path), 403, method,
            `revoked platform grant ${method} ${path}`, 'ACCESS_DENIED');
      }
    } finally {
      await admin.query('UPDATE "User" SET "platformRole"=$1 WHERE id=$2', [original, 'platform']);
    }
    for (const path of ['/api/docs/json', '/api/docs/static/swagger-ui-bundle.js']) {
      const restored = await call('platform', 'GET', path);
      assert.equal(restored.statusCode, 200, restored.body);
      uncached(restored, `restored ${path}`);
    }
  });
}
