// Never accepts a database URL: creates and removes its own fresh tmpfs database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const dockerEnv = { ...process.env };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete dockerEnv[key];
const docker = (...args) => execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { encoding: 'utf8', env: dockerEnv }).trim();
const image = docker('image', 'inspect', 'postgres:17-alpine', '--format', '{{.Id}}');
const password = randomUUID();
let container;
try {
  container = docker('run', '--detach', '--pull', 'never', '--name', `pf-impersonation-${randomUUID()}`,
    '--tmpfs', '/var/lib/postgresql/data:rw', '--publish', '127.0.0.1::5432',
    '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=propertyflow_impersonation_test', image);
  assert.match(container, /^[a-f0-9]{64}$/);
  const [info] = JSON.parse(docker('inspect', container));
  assert.equal(info.Mounts.length, 0, 'no persistent volumes permitted');
  assert.equal(info.HostConfig.Tmpfs['/var/lib/postgresql/data'], 'rw');
  const bindings = info.NetworkSettings.Ports['5432/tcp'];
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].HostIp, '127.0.0.1');
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { docker('exec', container, 'pg_isready', '-U', 'postgres'); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(ready, 'disposable PostgreSQL startup timed out');
  const env = { ...process.env, TEST_IMPERSONATION_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${bindings[0].HostPort}/propertyflow_impersonation_test`, IMPERSONATION_DISPOSABLE: 'tmpfs-verified' };
  for (const key of Object.keys(env)) if (key === 'DATABASE_URL' || key === 'RUNTIME_DATABASE_URL' || key.startsWith('TEST_') && key.endsWith('_DATABASE_URL') && key !== 'TEST_IMPERSONATION_DATABASE_URL') delete env[key];
  console.log('Verified fresh tmpfs PostgreSQL for impersonation authorization tests.');
  const tests = spawn(process.execPath, ['--test', 'server/tests/impersonation.test.mjs'], { cwd, env, stdio: 'inherit' });
  tests.on('error', error => console.error(error.message));
  const [code] = await once(tests, 'exit');
  process.exitCode = code ?? 1;
} finally {
  if (container) docker('rm', '--force', container);
}
