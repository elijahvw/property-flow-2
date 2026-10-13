import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const serverRoot = fileURLToPath(new URL('../', import.meta.url));
const probe = `
  import assert from 'node:assert/strict';
  await import('./dist/tracing.js');
  const { default: tracer } = await import('dd-trace');
  const { PrismaClient } = await import('@prisma/client');
  let queried = false;
  const driver = {
    provider: 'postgres',
    adapterName: 'readiness-test',
    async queryRaw(query) {
      queried = true;
      assert.match(query.sql, /SELECT 1/);
      if (process.env.PROBE_FAILURE === 'true') throw new Error('database unavailable');
      return { columnTypes: [0], columnNames: ['ready'], rows: [[1]] };
    },
    async executeRaw() { return 0; },
    async dispose() {},
  };
  const adapter = {
    provider: 'postgres',
    adapterName: 'readiness-test',
    async connect() { return driver; },
  };
  const prisma = new PrismaClient({ adapter });
  try {
    const query = () => tracer.trace('readiness', () => prisma.$queryRawUnsafe('SELECT 1 AS ready'));
    if (process.env.PROBE_FAILURE === 'true') {
      await assert.rejects(query, error => {
        assert.match(error.message, /database unavailable/);
        assert.doesNotMatch(error.message, /getActiveContext/);
        return true;
      });
    } else {
      assert.deepEqual(await query(), [{ ready: 1 }]);
    }
    assert.equal(queried, true);
  } finally {
    await prisma.$disconnect();
  }
`;

for (const failure of [false, true]) {
  test(failure ? 'database failures reach Prisma without a tracing crash' : 'readiness query works with production Datadog initialization', () => {
    const env = { ...process.env, PROBE_FAILURE: String(failure), DD_TRACE_STARTUP_LOGS: 'false' };
    delete env.DD_TRACE_DISABLED_PLUGINS;
    delete env.DD_TRACE_PRISMA_ENABLED;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
      cwd: serverRoot, env, encoding: 'utf8', timeout: 30000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr + result.stdout);
  });
}
