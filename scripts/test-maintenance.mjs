// Runs only against a new cached-image, tmpfs-backed database created here.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const image = docker('image', 'inspect', 'postgres:17-alpine', '--format', '{{.Id}}');
const password = randomUUID();
let container, vite, browserDirectory;
try {
  container = docker('run', '--detach', '--pull', 'never', '--name', `pf-maintenance-${randomUUID()}`,
    '--tmpfs', '/var/lib/postgresql/data:rw', '--publish', '127.0.0.1::5432',
    '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=propertyflow_maintenance_test', image);
  assert.match(container, /^[a-f0-9]{64}$/);
  const [info] = JSON.parse(docker('inspect', container));
  assert.equal(info.Mounts.length, 0, 'no persistent volumes permitted');
  assert.equal(info.HostConfig.Tmpfs['/var/lib/postgresql/data'], 'rw');
  const bindings = info.NetworkSettings.Ports['5432/tcp'];
  assert.equal(bindings.length, 1);assert.equal(bindings[0].HostIp, '127.0.0.1');
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { docker('exec', container, 'pg_isready', '-U', 'postgres');ready = true;break; } catch { await pause(); }
  }
  assert.ok(ready, 'disposable PostgreSQL startup timed out');
  const reserve = createServer();reserve.listen(0, '127.0.0.1');await once(reserve, 'listening');
  const port = reserve.address().port;await new Promise(resolve => reserve.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  // Concurrent disposable runners and the persistent preview must not rewrite
  // one another's optimized dependency cache. This directory belongs to this run.
  browserDirectory = await mkdtemp(`${tmpdir()}/pf-maintenance-browser-`);
  const browserConfig = `${browserDirectory}/vite.config.mjs`;
  await writeFile(browserConfig, `import base from ${JSON.stringify(new URL('../client/vite.config.ts', import.meta.url).href)};\nexport default {...base, cacheDir:${JSON.stringify(browserDirectory + '/cache')}};\n`);
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'client', '--config', browserConfig, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd, stdio: 'ignore' });
  vite.on('error', error => console.error(error.message));
  ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    assert.equal(vite.exitCode, null, 'fixture server exited before readiness');
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(500) })).ok) { ready = true;break; } } catch {}
    await pause();
  }
  assert.ok(ready, 'fixture server startup timed out');
  const env = { ...process.env, TEST_MAINTENANCE_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${bindings[0].HostPort}/propertyflow_maintenance_test`,
    MAINTENANCE_DISPOSABLE: 'tmpfs-verified', TEST_MAINTENANCE_BROWSER_URL: origin };
  delete env.TEST_DATABASE_URL;delete env.DATABASE_URL;delete env.RUNTIME_DATABASE_URL;
  console.log('Verified fresh tmpfs PostgreSQL and isolated loopback fixture server.');
  const tests = spawn(process.execPath, ['--test', 'server/tests/maintenance.test.mjs'], { cwd, env, stdio: 'inherit' });
  tests.on('error', error => console.error(error.message));
  const [code] = await once(tests, 'exit');
  process.exitCode = code ?? 1;
} finally {
  if (vite && vite.exitCode === null) { const stopped = once(vite, 'exit');vite.kill('SIGTERM');await stopped; }
  if (container) docker('rm', '--force', container);
  if (browserDirectory) await rm(browserDirectory, { recursive: true, force: true });
}
