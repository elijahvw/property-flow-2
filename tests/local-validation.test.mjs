import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInputs, buildProject, claimProductionBuild, main, validationPlan, verifyBuild, verifyProductionBuild } from '../scripts/local-validation.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const file = (root, path, content = 'fixture') => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'propertyflow-validation-unit-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  file(directory, 'package.json', JSON.stringify({ devDependencies: { vite: '1.0.0' } }));
  file(directory, 'package-lock.json', '{}');
  for (const kind of ['client', 'server']) {
    file(directory, `${kind}/package.json`, JSON.stringify({ scripts: { build: kind === 'client' ? 'tsc -b && vite build' : 'npx prisma generate && tsc -p tsconfig.json' } }));
    file(directory, `${kind}/tsconfig.json`, '{"include":["src"]}');
    file(directory, `${kind}/src/index.ts`);
  }
  file(directory, 'client/vite.config.ts', readFileSync(join(root, 'client/vite.config.ts')));
  file(directory, 'server/prisma/schema.prisma');
  file(directory, 'node_modules/vite/package.json', '{"version":"1.0.0"}');
  const options = { directory: join(directory, 'receipts'), environment: {}, run: () => ({ status: 0 }) };
  const outputs = kind => {
    if (kind === 'client') file(directory, 'client/dist/index.html', '<html>fixture</html>');
    else {
      file(directory, 'server/dist/bootstrap.js'); file(directory, 'server/dist/application.js');
      file(directory, 'node_modules/.prisma/client/schema.prisma');
    }
  };
  return { directory, options, outputs };
}

test('unchanged successful normal build is reused; changed source forces normal build', t => {
  const { directory, options, outputs } = fixture(t);
  let builds = 0;
  options.run = args => { builds++; assert.deepEqual(args, ['run', 'build', '--workspace=@property-flow/client']); outputs('client'); return { status: 0 }; };
  assert.equal(buildProject(directory, 'client', options).reused, false);
  assert.equal(buildProject(directory, 'client', { ...options, reuse: true }).reused, true);
  assert.equal(builds, 1);
  file(directory, 'client/src/index.ts', 'changed');
  assert.throws(() => verifyBuild(directory, 'client', options), /changed/);
  assert.equal(buildProject(directory, 'client', { ...options, reuse: true }).reused, false);
  assert.equal(builds, 2);
});

test('corrupt or missing build artifacts cannot reuse a successful receipt', t => {
  const { directory, options, outputs } = fixture(t);
  outputs('client'); buildProject(directory, 'client', options);
  file(directory, 'client/dist/index.html', 'corrupted');
  assert.throws(() => verifyBuild(directory, 'client', options), /changed/);
  rmSync(join(directory, 'client/dist/index.html'));
  assert.throws(() => verifyBuild(directory, 'client', options), /missing/);
});

test('failed or source-changing build cannot leave an earlier receipt valid', t => {
  const { directory, options, outputs } = fixture(t);
  outputs('client'); buildProject(directory, 'client', options);
  assert.throws(() => buildProject(directory, 'client', { ...options, run: () => ({ status: 1 }) }), /normal build failed/);
  assert.throws(() => verifyBuild(directory, 'client', options), /ENOENT/);
  assert.throws(() => buildProject(directory, 'client', { ...options, run: () => { file(directory, 'client/src/index.ts', 'raced'); return { status: 0 }; } }), /changed while building/);
  assert.throws(() => verifyBuild(directory, 'client', options), /ENOENT/);
});

test('lockfiles, installed tool versions and new compiler configs invalidate receipts', t => {
  const { directory, options, outputs } = fixture(t);
  outputs('client'); buildProject(directory, 'client', options);
  file(directory, 'package-lock.json', '{"updated":true}');
  assert.throws(() => verifyBuild(directory, 'client', options), /changed/);
  buildProject(directory, 'client', options);
  file(directory, 'node_modules/vite/package.json', '{"version":"1.1.0"}');
  assert.throws(() => verifyBuild(directory, 'client', options), /changed/);
  buildProject(directory, 'client', options);
  file(directory, 'client/tsconfig.extra.json', '{}');
  assert.throws(() => verifyBuild(directory, 'client', options), /changed/);
});

test('generated output is excluded from inputs and included in server artifacts', t => {
  const { directory, options, outputs } = fixture(t);
  const before = buildInputs(directory, 'server', {});
  options.environment = { DATABASE_URL: 'do-not-use-live', RUNTIME_DATABASE_URL: 'do-not-use-runtime' };
  options.run = (args, environment) => {
    assert.deepEqual(args, ['run', 'build', '--workspace=server']);
    assert.equal(environment.DATABASE_URL, 'postgresql://build:build@127.0.0.1:1/propertyflow_access_test');
    assert.equal(environment.RUNTIME_DATABASE_URL, undefined);
    outputs('server'); return { status: 0 };
  };
  buildProject(directory, 'server', options);
  assert.equal(before.hash, buildInputs(directory, 'server', {}).hash);
  file(directory, 'node_modules/.prisma/client/schema.prisma', 'different generated schema');
  assert.throws(() => verifyBuild(directory, 'server', options), /changed/);
  buildProject(directory, 'server', options);
  file(directory, 'server/prisma/schema.prisma', 'new schema');
  assert.throws(() => verifyBuild(directory, 'server', options), /changed/);
});

test('incremental compiler outputs do not masquerade as source changes', t => {
  const { directory, options, outputs } = fixture(t);
  outputs('client'); buildProject(directory, 'client', options);
  file(directory, 'client/tsconfig.tsbuildinfo', 'compiler output');
  assert.doesNotThrow(() => verifyBuild(directory, 'client', options));
});

test('environment and env-file overrides disable reuse without exposing values', t => {
  const { directory, options, outputs } = fixture(t);
  outputs('client');
  const privateValue = 'fictional-value-must-not-be-recorded';
  const environment = { VITE_PUBLIC_LABEL: privateValue };
  buildProject(directory, 'client', { ...options, environment });
  assert.throws(() => verifyBuild(directory, 'client', { ...options, environment }), /unmodelled/);
  assert.equal(readFileSync(join(options.directory, 'client.json'), 'utf8').includes(privateValue), false);
  file(directory, 'client/.env.production', privateValue);
  buildProject(directory, 'client', options);
  assert.throws(() => verifyBuild(directory, 'client', options), /unmodelled/);
  assert.equal(readFileSync(join(options.directory, 'client.json'), 'utf8').includes(privateValue), false);
});

test('fresh-only production receipt is consumed once and verifies the same source, artifacts and override witness', t => {
  const { directory, options, outputs } = fixture(t);
  outputs('client');
  const environment = { NODE_PATH: '/fictional/managed/modules', NODE_EXTRA_CA_CERTS: '/fictional/public-ca.pem', VITE_PUBLIC_LABEL: 'fictional-label' };
  buildProject(directory, 'client', { ...options, environment });
  assert.throws(() => verifyBuild(directory, 'client', { ...options, environment }), /unmodelled/);
  const claim = claimProductionBuild(directory, { ...options, environment });
  assert.ok(claim.consumedPath);
  assert.throws(() => claimProductionBuild(directory, { ...options, environment }), /ENOENT/);
  assert.doesNotThrow(() => verifyProductionBuild(directory, claim, { environment }));
  assert.throws(() => verifyProductionBuild(directory, claim, { environment: { ...environment, VITE_PUBLIC_LABEL: 'changed' } }), /changed/);
  file(directory, 'client/src/index.ts', 'changed after setup');
  assert.throws(() => verifyProductionBuild(directory, claim, { environment }), /changed/);
});

test('changed explicit .env content invalidates a fresh-only receipt before setup', t => {
  const { directory, options, outputs } = fixture(t);
  outputs('client'); file(directory, 'client/.env.production', 'VITE_PUBLIC_LABEL=before');
  buildProject(directory, 'client', options);
  file(directory, 'client/.env.production', 'VITE_PUBLIC_LABEL=after');
  assert.throws(() => claimProductionBuild(directory, options), /changed/);
  assert.equal(readFileSync(join(options.directory, 'client.json'), 'utf8').includes('VITE_PUBLIC_LABEL=before'), false);
});

test('custom hooks, config imports, compiler dependencies and compile-only recipes fail closed', t => {
  const { directory, options, outputs } = fixture(t);
  outputs('client'); outputs('server');
  const cases = [
    ['client/vite.config.ts', "import settings from './settings.mjs'; export default settings;", 'client'],
    ['client/tsconfig.json', '{"extends":"../tsconfig.base.json"}', 'client'],
    ['client/package.json', '{"scripts":{"prebuild":"node helper.mjs","build":"tsc -b && vite build"}}', 'client'],
    ['server/package.json', '{"scripts":{"build":"tsc -p tsconfig.json"}}', 'server'],
  ];
  for (const [path, content, kind] of cases) {
    const previous = readFileSync(join(directory, path)); file(directory, path, content);
    buildProject(directory, kind, options);
    assert.throws(() => verifyBuild(directory, kind, options), /unmodelled/);
    if (kind === 'client') assert.throws(() => claimProductionBuild(directory, options), /custom build dependencies/);
    file(directory, path, previous);
  }
  assert.throws(() => main(['build', 'client', '--mode=other']), /extra build arguments/);
});

test('receipts and fingerprinted files reject symbolic links', t => {
  const { directory, options, outputs } = fixture(t);
  outputs('client'); buildProject(directory, 'client', options);
  rmSync(join(options.directory, 'client.json'));
  symlinkSync(join(directory, 'package.json'), join(options.directory, 'client.json'));
  assert.throws(() => verifyBuild(directory, 'client', options), /symbolic links/);
  rmSync(join(options.directory, 'client.json'));
  symlinkSync(join(directory, 'package.json'), join(directory, 'client/src/linked.ts'));
  assert.throws(() => buildInputs(directory, 'client', {}), /symbolic link/);
});

test('known-area feedback includes actual workflow specs and integration runners', () => {
  const plan = validationPlan(['client/src/pages/SalesDemo.tsx', 'client/src/pages/Preventive.tsx']);
  assert.equal(plan.broad, false);
  assert.deepEqual(plan.databases, ['maintenance', 'sales-demo']);
  for (const name of ['sales-demo-overhaul', 'preventive', 'work-calendar']) assert.ok(plan.ui.includes(name));
  assert.deepEqual(plan.builds, ['client']);
  assert.equal(plan.finalBrowserRequired, true);
  for (const path of ['client/src/useUserDirectory.ts', 'client/src/pages/CompanyProfile.tsx']) {
    assert.ok(validationPlan([path]).databases.includes('users'));
    assert.ok(validationPlan([path]).ui.includes('prelogin-users'));
  }
});

test('shared client source widens UI, stateful guards add relevant integration feedback', () => {
  for (const path of ['client/src/index.css', 'client/src/navigation.ts', 'client/src/pages/NewWorkflow.tsx']) {
    const plan = validationPlan([path]);
    assert.equal(plan.broad, true);
    assert.equal(plan.databases.length, 0);
    assert.ok(plan.ui.includes('page-leave-guard'));
    assert.deepEqual(plan.builds, ['client']);
    assert.equal(plan.finalBrowserRequired, true);
  }
  assert.deepEqual(validationPlan(['client/src/components/PageLeaveGuard.tsx']).databases, ['finances', 'users']);
  assert.equal(validationPlan(['client/src/api.ts']).databases.length, 9);
});

test('server schema/shared inputs and global request errors keep broad gates; provider changes cover demo identities', () => {
  for (const path of ['server/prisma/schema.prisma', 'server/src/request-errors.ts', 'server/src/application.ts']) {
    const plan = validationPlan([path]);
    assert.equal(plan.broad, true);
    assert.equal(plan.databases.length, 9);
    assert.deepEqual(plan.builds, ['client', 'server']);
    assert.equal(plan.finalBrowserRequired, true);
  }
  const provider = validationPlan(['server/src/identity-provider.ts']);
  assert.ok(provider.databases.includes('users'));
  assert.ok(provider.databases.includes('sales-demo'));
  assert.ok(provider.ui.includes('sales-demo-overhaul'));
});

test('direct fixture selection and docs-only plans do not remove existing final gates', () => {
  const direct = validationPlan(['tests/ui/admin-directories.spec.ts']);
  assert.deepEqual(direct.ui, ['admin-directories']);
  assert.equal(direct.finalBrowserRequired, true);
  assert.equal(validationPlan(['docs/agent-validation.md']).finalBrowserRequired, false);
  assert.equal(validationPlan(['infra/terraform/main.tf']).operations, true);
  assert.equal(validationPlan(['scripts/local-validation.mjs']).tooling, true);
  assert.equal(validationPlan(['scripts/test-production-preview.mjs']).tooling, true);
  assert.equal(validationPlan(['scripts/test-production-preview.mjs']).finalBrowserRequired, true);
  assert.equal(validationPlan(['scripts/browser-failure-summary.py']).operations, true);
});
