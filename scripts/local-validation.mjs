// Local feedback planning and build staleness checks. This does not cache test
// results, select release CI coverage, connect to databases or install tools.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recipeVersion = 2;
const digest = value => createHash('sha256').update(value).digest('hex');
// Reviewed current config imports only installed Vite/React packages and reads
// PROPERTY_FLOW_DEV_HOST for the development server. New config code must be
// reviewed before opting it into reuse; do not guess its imports/environment.
const reviewedViteConfig = '39ea3ec31ffb2e29f1e12a4cb80c5e884f2cfcba8c523fe709a7d152a1653c67';
const reviewedPrismaConfig = 'f7aed5ca9519be372cd2b9178aa0f0d6a43bf8127f3f908eed8271848f71cbad';
const kinds = ['client', 'server'];
const allDatabaseRunners = ['maintenance', 'leasing', 'finances', 'users', 'impersonation', 'company-billing', 'roadmap', 'sales-demo', 'observability'];
const sharedFeedback = ['navigation-audit', 'forms-audit', 'company-feature-projections', 'page-leave-guard', 'impersonation'];
const areas = [
  { name: 'People and access', match: /(?:Workspace|CompanyAdministration|CompanyProfile|AccountProfile|ResidentProfiles|ContactDetail|TenantForm|UserProvisioning|UserDirectory|resident|tenant|user-administration|(?:^|[/.-])users?(?:[/.-]|$)|identity|account-profile|company-profile|invitations)/i, ui: ['account-profiles', 'admin-directories', 'people-navigation', 'prelogin-users', 'tenant-workspace'], db: ['users'] },
  { name: 'Leasing and acquisition', match: /(?:Leasing|Lease|Prospect|RentalApplication|Availability|leasing|lease|prospect|application|availability|unit-import)/i, ui: ['leasing', 'lease-workspace', 'lease-lifecycle', 'lease-recovery', 'lease-wayfinding', 'prospects', 'acquisition-consolidation'], db: ['leasing', 'roadmap'] },
  { name: 'Money and reporting', match: /(?:Finances|Rent|Deposit|Statement|Reports|Expense|finance|rent|deposit|settlement|report|proration|renewal)/i, ui: ['finances', 'rent', 'deposits', 'reports'], db: ['finances'] },
  { name: 'Maintenance and documents', match: /(?:Maintenance|WorkOrder|WorkCalendar|Vendor|Preventive|Document|Inspection|Agreement|maintenance|vendor|preventive|document|inspection|agreement)/i, ui: ['maintenance', 'maintenance-costs', 'preventive', 'work-calendar', 'vendors', 'private-documents-work-orders'], db: ['maintenance'] },
  { name: 'Company billing', match: /(?:subscription|company-billing|PlatformPlans)/i, ui: ['company-subscriptions', 'company-feature-projections'], db: ['company-billing'] },
  { name: 'Sales demos', match: /(?:sales-demo|SalesDemo)/, ui: ['company-administration', 'sales-demo-overhaul'], db: ['sales-demo'] },
];

export function validationPlan(paths) {
  const ui = new Set(), databases = new Set(), matched = new Set(), reasons = [];
  let client = false, server = false, operations = false, broad = false, tooling = false;
  for (const original of paths) {
    const path = original.replaceAll('\\', '/');
    if (/^(?:README\.md|AGENTS\.md|docs\/|\.codex\/|\.github\/pull_request_template\.md$)/.test(path)) continue;
    if (/^(?:infra\/|config\/|tests\/operations\/|\.github\/workflows\/)|^scripts\/(?:validate-dev-power|dev-power)\./.test(path)) { operations = true; continue; }
    if (/^scripts\/(?:local-validation\.mjs|browser-failure-summary\.py|test-production-preview\.mjs)$|^tests\/local-validation\.test\.mjs$|^playwright\.production\.config\.ts$/.test(path)) {
      matched.add('Local validation tooling'); tooling = true;
      operations ||= path.endsWith('browser-failure-summary.py');
      if (/test-production-preview\.mjs$|^playwright\.production\.config\.ts$/.test(path)) ui.add('navigation-audit');
      continue;
    }
    client ||= path.startsWith('client/');
    server ||= path.startsWith('server/');
    const direct = path.match(/^tests\/ui\/([a-z0-9-]+)\.spec\.ts$/i);
    if (direct) { ui.add(direct[1]); continue; }
    const shared = /^(?:package(?:-lock)?\.json|client\/package(?:-lock)?\.json|server\/package(?:-lock)?\.json|server\/prisma\/|server\/src\/(?:application|access|sessions|identity-sync|company-features)\.ts|client\/src\/(?:App\.(?:tsx|css)|index\.css|api\.ts|navigation\.ts|company-features\.tsx|context\/|components\/(?:Form|EditorDialog|PageLeaveGuard|ProtectedRoute)))/.test(path);
    const clientPath = path.startsWith('client/');
    const presentation = clientPath && (/\.(?:css|svg|png|jpe?g|ico)$/.test(path) || /\/(?:navigation|help-content|task-metadata)\.ts$/.test(path));
    const found = areas.filter(area => area.match.test(path));
    if (shared || !found.length) {
      broad = true;
      sharedFeedback.forEach(name => ui.add(name));
      if (clientPath) {
        reasons.push(`${path}: shared or unclassified client input; keep broad UI verification`);
        if (!presentation && /components\/(?:Form|EditorDialog|PageLeaveGuard)/.test(path)) ['users', 'finances'].forEach(name => databases.add(name));
        if (/\/(?:api|request-errors|request-error|error-messages|api-errors)\.[cm]?[jt]sx?$/.test(path)) allDatabaseRunners.forEach(name => databases.add(name));
        if (/context\/|ProtectedRoute|company-features/.test(path)) ['users', 'impersonation', 'sales-demo'].forEach(name => databases.add(name));
      } else {
        client = server = true;
        allDatabaseRunners.forEach(name => databases.add(name));
        reasons.push(`${path}: shared or unclassified server/build input; keep broad verification`);
      }
    }
    for (const area of found) {
      matched.add(area.name); area.ui.forEach(name => ui.add(name));
      if (!presentation) area.db.forEach(name => databases.add(name));
    }
    if (/identity-provider|identity-sync|demo-identity/i.test(path)) {
      ['users', 'sales-demo'].forEach(name => databases.add(name));
      ['prelogin-users', 'sales-demo-overhaul'].forEach(name => ui.add(name));
    }
  }
  return { areas: [...matched].sort(), builds: [client && 'client', server && 'server'].filter(Boolean), ui: [...ui].sort(), databases: [...databases].sort(), operations, tooling, broad, reasons, finalBrowserRequired: client || server || ui.size > 0 };
}

function checkKind(kind) { if (!kinds.includes(kind)) throw new Error('Choose client or server.'); }
function walk(root, path, hash) {
  const absolute = join(root, path);
  hash.update(path + '\0');
  if (!existsSync(absolute)) { hash.update('<missing>\0'); return; }
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`Cannot safely fingerprint a symbolic link: ${path}`);
  if (stat.isDirectory()) for (const entry of readdirSync(absolute).sort()) walk(root, join(path, entry), hash);
  else if (stat.isFile()) { hash.update(readFileSync(absolute)); hash.update('\0'); }
}
export function fingerprintPaths(root, paths) {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) walk(root, path, hash);
  return hash.digest('hex');
}
function installedVersions(root, kind) {
  const names = new Set();
  for (const path of ['package.json', `${kind}/package.json`]) {
    if (!existsSync(join(root, path))) continue;
    const manifest = JSON.parse(readFileSync(join(root, path), 'utf8'));
    Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).forEach(name => names.add(name));
  }
  return [...names].sort().map(name => {
    const path = [join(root, kind, 'node_modules', name, 'package.json'), join(root, 'node_modules', name, 'package.json')].find(existsSync);
    return [name, path ? JSON.parse(readFileSync(path, 'utf8')).version : '<missing>'];
  });
}
function buildOverrides(root, kind, environment) {
  // Presence disables reuse. A one-use fresh build also needs an opaque witness
  // that these explicit build inputs did not change. Never emit their contents.
  const files = ['', kind].flatMap(directory => ['.env', '.env.local', '.env.production', '.env.production.local'].map(name => join(directory, name))).filter(path => existsSync(join(root, path)));
  const variables = Object.keys(environment).filter(key => key.startsWith('NODE_') || /^npm_config_/i.test(key) || key === 'PROPERTY_FLOW_DEV_HOST' || (kind === 'client' ? key.startsWith('VITE_') : key.startsWith('PRISMA_'))).sort();
  const witness = digest(JSON.stringify({ files: fingerprintPaths(root, files), environment: variables.map(key => [key, environment[key]]) }));
  return { files, variables, witness };
}
function unmodelledBuildInputs(root, kind, environment) {
  const { files, variables } = buildOverrides(root, kind, environment);
  const manifestPath = join(root, kind, 'package.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const script = manifest.scripts?.build;
  const expected = kind === 'client' ? 'tsc -b && vite build' : 'npx prisma generate && tsc -p tsconfig.json';
  const custom = script?.trim().replace(/\s+/g, ' ') === expected ? [] : ['custom build recipe'];
  if (manifest.scripts?.prebuild || manifest.scripts?.postbuild) custom.push('build lifecycle hooks');
  for (const path of ['.npmrc', `${kind}/.npmrc`]) if (existsSync(join(root, path))) custom.push(`file:${path}`);
  const vitePath = join(root, 'client/vite.config.ts');
  if (kind === 'client') {
    if (existsSync(vitePath) && digest(readFileSync(vitePath)) !== reviewedViteConfig) custom.push('custom Vite configuration');
    for (const suffix of ['js', 'mjs', 'mts', 'cjs', 'cts']) if (existsSync(join(root, `client/vite.config.${suffix}`))) custom.push('alternate Vite configuration');
  } else {
    const prismaPath = join(root, 'server/prisma.config.ts');
    if (existsSync(prismaPath) && digest(readFileSync(prismaPath)) !== reviewedPrismaConfig) custom.push('custom Prisma configuration');
    for (const suffix of ['js', 'mjs', 'mts', 'cjs', 'cts']) if (existsSync(join(root, `server/prisma.config.${suffix}`))) custom.push('alternate Prisma configuration');
  }
  for (const name of readdirSync(join(root, kind)).filter(name => /^tsconfig.*\.json$/.test(name))) {
    const content = readFileSync(join(root, kind, name), 'utf8');
    if (/"(?:extends|references)"\s*:/.test(content)) custom.push('TypeScript configuration dependency');
    // The current configs read src and the fingerprinted Vite config only.
    // External includes/aliases need an explicit input review before reuse.
    if (/"(?:paths|files|baseUrl)"\s*:/.test(content)) custom.push('custom TypeScript source paths');
    const include = content.match(/"include"\s*:\s*\[([^\]]*)\]/)?.[1];
    if (include && [...include.matchAll(/"([^"]*)"/g)].some(([, path]) => !['src', 'src/**/*', 'vite.config.ts'].includes(path))) custom.push('external TypeScript source includes');
  }
  return [...files.map(path => `file:${path}`), ...variables.map(key => `environment:${key}`), ...custom];
}
export function buildInputs(root, kind, environment = process.env) {
  checkKind(kind);
  const paths = ['package.json', 'package-lock.json', '.npmrc', `${kind}/.npmrc`, 'scripts/local-validation.mjs', `${kind}/package.json`, `${kind}/package-lock.json`, `${kind}/src`, ...readdirSync(join(root, kind)).filter(name => /^tsconfig.*\.json$/.test(name)).map(name => `${kind}/${name}`)];
  if (kind === 'client') paths.push('client/index.html', 'client/public', 'client/vite.config.ts', 'client/vite.config.js', 'client/vite.config.mjs', 'client/vite.config.mts', 'client/vite.config.cjs', 'client/vite.config.cts', 'client/tsconfig.node.json');
  else paths.push('server/prisma', 'server/prisma.config.ts');
  const unmodelled = unmodelledBuildInputs(root, kind, environment);
  return { hash: digest(JSON.stringify({ recipeVersion, node: process.version, source: fingerprintPaths(root, paths), versions: installedVersions(root, kind), overrides: buildOverrides(root, kind, environment).witness, unmodelled })), unmodelled };
}
export function buildArtifacts(root, kind) {
  checkKind(kind);
  const required = kind === 'client' ? ['client/dist/index.html'] : ['server/dist/bootstrap.js', 'server/dist/application.js', 'node_modules/.prisma/client/schema.prisma'];
  for (const path of required) if (!existsSync(join(root, path))) throw new Error(`Build output is missing: ${path}`);
  return fingerprintPaths(root, kind === 'client' ? ['client/dist'] : ['server/dist', 'node_modules/.prisma/client']);
}
function defaultReceiptDirectory(root) { return join(tmpdir(), `propertyflow-build-receipts-${digest(resolve(root)).slice(0, 20)}`); }
function receiptPath(root, kind, directory) { return join(directory || defaultReceiptDirectory(root), `${kind}.json`); }
function checkReceiptPath(path) {
  for (const item of [dirname(path), path]) {
    if (!existsSync(item)) continue;
    const stat = lstatSync(item);
    if (stat.isSymbolicLink() || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('Build receipts must be owned local files, not symbolic links.');
  }
}
export function verifyBuild(root, kind, { directory, environment = process.env } = {}) {
  checkKind(kind);
  const path = receiptPath(root, kind, directory); checkReceiptPath(path);
  const receipt = JSON.parse(readFileSync(path, 'utf8'));
  const inputs = buildInputs(root, kind, environment);
  if (inputs.unmodelled.length || receipt.unmodelled?.length) throw new Error('Build reuse is disabled by unmodelled build configuration or environment. Use a fresh explicit build and the existing validation path.');
  assertBuildReceipt(root, kind, receipt, environment);
  return receipt;
}
function assertBuildReceipt(root, kind, receipt, environment) {
  const inputs = buildInputs(root, kind, environment);
  if (receipt.recipeVersion !== recipeVersion || receipt.repository !== digest(resolve(root)) || receipt.kind !== kind || receipt.inputs !== inputs.hash || receipt.artifacts !== buildArtifacts(root, kind))
    throw new Error('Build inputs or outputs changed. Build again; do not reuse this receipt.');
}
const witnessedOverride = reason => reason.startsWith('environment:') || /^file:(?:(?:client|server)\/)?\.env(?:\.local|\.production(?:\.local)?)?$/.test(reason);
export function claimProductionBuild(root, { directory, environment = process.env } = {}) {
  const path = receiptPath(root, 'client', directory); checkReceiptPath(path);
  const receipt = JSON.parse(readFileSync(path, 'utf8'));
  assertBuildReceipt(root, 'client', receipt, environment);
  if (receipt.unmodelled?.some(reason => !witnessedOverride(reason))) throw new Error('Production freshness cannot be verified for custom build dependencies. Review and model those inputs before using this gate.');
  let consumedPath;
  if (receipt.unmodelled?.length) {
    // Atomic rename makes a fresh-only receipt available to exactly one run.
    consumedPath = `${path}.claimed-${randomUUID()}`;
    renameSync(path, consumedPath);
  }
  return { receipt, consumedPath };
}
export function verifyProductionBuild(root, claim, { environment = process.env } = {}) {
  assertBuildReceipt(root, 'client', claim.receipt, environment);
}
export function buildProject(root, kind, { directory, environment = process.env, reuse = false, run } = {}) {
  checkKind(kind);
  if (reuse) { try { return { reused: true, receipt: verifyBuild(root, kind, { directory, environment }) }; } catch { /* A changed or absent receipt requires a real build. */ } }
  const path = receiptPath(root, kind, directory); checkReceiptPath(path);
  rmSync(path, { force: true });
  const before = buildInputs(root, kind, environment);
  const args = ['run', 'build', `--workspace=${kind === 'client' ? '@property-flow/client' : 'server'}`];
  const env = { ...environment };
  if (kind === 'server') { env.DATABASE_URL = 'postgresql://build:build@127.0.0.1:1/propertyflow_access_test'; delete env.RUNTIME_DATABASE_URL; }
  const started = performance.now();
  const outcome = run ? run(args, env) : spawnSync('npm', args, { cwd: root, env, stdio: 'inherit' });
  if (outcome.error || outcome.status !== 0) throw new Error('The normal build failed; no successful receipt was written.');
  const after = buildInputs(root, kind, environment);
  if (before.hash !== after.hash) throw new Error('Build inputs changed while building; no receipt was written.');
  const receipt = { recipeVersion, repository: digest(resolve(root)), kind, command: ['npm', ...args], node: process.version, inputs: after.hash, artifacts: buildArtifacts(root, kind), unmodelled: after.unmodelled, elapsedMs: Math.round(performance.now() - started), completedAt: new Date().toISOString() };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 }); renameSync(temporary, path);
  return { reused: false, receipt };
}

const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
function printPlan(plan) {
  console.log(`Areas: ${plan.areas.join(', ') || 'documentation/operations or no changes'}`);
  console.log('\nFast feedback (run only the affected groups):');
  if (plan.tooling) console.log('node --test tests/local-validation.test.mjs');
  for (const kind of plan.builds) console.log(`node scripts/local-validation.mjs build ${kind} --reuse`);
  if (plan.ui.length && !plan.builds.includes('client')) console.log('node scripts/local-validation.mjs build client --reuse');
  if (plan.builds.includes('client')) console.log('node --test client/tests/*.test.cjs');
  if (plan.builds.includes('server')) console.log('env -u DATABASE_URL -u RUNTIME_DATABASE_URL -u TEST_DATABASE_URL -u TEST_USERS_DATABASE_URL -u TEST_IMPERSONATION_DATABASE_URL -u TEST_FINANCES_DATABASE_URL -u TEST_COMPANY_BILLING_DATABASE_URL -u TEST_MAINTENANCE_DATABASE_URL -u TEST_LEASING_DATABASE_URL -u TEST_SALES_DEMO_DATABASE_URL -u TEST_ROADMAP_DATABASE_URL node --test server/tests/*.test.mjs');
  if (plan.operations) console.log("python3 -m unittest discover -s tests/operations -p 'test_*.py'\npython3 scripts/validate-dev-power.py");
  if (plan.ui.length) console.log(`node node_modules/@playwright/test/cli.js test -c playwright.production.config.ts ${plan.ui.map(name => shellQuote(`tests/ui/${name}.spec.ts`)).join(' ')}`);
  if (plan.databases.length) {
    console.log('\nRelevant disposable database/browser workflows — run sequentially:');
    plan.databases.forEach(name => console.log(`node scripts/test-${name}.mjs`));
  }
  if (plan.finalBrowserRequired) console.log('\nOne final source-frozen aggregate after corrections:\nnode scripts/local-validation.mjs build client --reuse\nnode node_modules/@playwright/test/cli.js test -c playwright.production.config.ts');
  console.log('\nThe plan is feedback guidance, not a completeness guarantee or a replacement for existing CI/release gates. No test result is cached.');
  plan.reasons.forEach(reason => console.log(`- ${reason}`));
}
export function main(args = process.argv.slice(2)) {
  const [action, kind, ...extra] = args;
  if (action === 'plan') {
    if (extra.length || kind && !kind.startsWith('--base=')) throw new Error('Usage: local-validation.mjs plan [--base=REF]');
    const base = kind?.slice(7) || 'HEAD';
    if (!base || base.startsWith('-')) throw new Error('Choose a Git revision, not an option.');
    const paths = [...execFileSync('git', ['diff', '--name-only', '-z', base, '--'], { cwd: repository }).toString().split('\0'), ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: repository }).toString().split('\0')].filter(Boolean);
    printPlan(validationPlan(paths)); return;
  }
  if (action === 'build') {
    if (extra.some(arg => arg !== '--reuse') || extra.length > 1) throw new Error('Usage: local-validation.mjs build client|server [--reuse]; extra build arguments are not accepted.');
    const result = buildProject(repository, kind, { reuse: extra.includes('--reuse') });
    console.log(`${result.reused ? 'Reused verified' : 'Completed normal'} ${kind} build. Build receipt: ${receiptPath(repository, kind)}`);
    if (result.receipt.unmodelled.length) console.log(result.receipt.unmodelled.every(witnessedOverride)
      ? 'Fresh-only receipt: environment overrides disable cache reuse. The production suite can consume it once. No values were recorded.'
      : 'Reuse and production receipt acceptance are disabled by unsupported custom build dependencies. Review and model those inputs first. No values were recorded.');
    return;
  }
  if (action === 'verify' && !extra.length) { verifyBuild(repository, kind); console.log(`${kind} input and artifact fingerprints match the successful build.`); return; }
  throw new Error('Usage: local-validation.mjs plan [--base=REF] | build client|server [--reuse] | verify client|server');
}

// Playwright production global setup: retain failure traces and reject a build
// or test-source change during the aggregate. This never reruns a failed test.
export default async function productionSetup(config) {
  const claim = claimProductionBuild(repository);
  const testInputs = ['tests/ui', 'playwright.production.config.ts', 'scripts/browser-failure-summary.py', 'scripts/test-production-preview.mjs'];
  const tests = fingerprintPaths(repository, testInputs);
  console.log(`Production browser artifacts: ${config.projects[0].outputDir}`);
  return async () => {
    const summary = spawnSync('python3', [join(repository, 'scripts/browser-failure-summary.py'), config.projects[0].outputDir], { stdio: 'inherit' });
    if (summary.error || summary.status !== 0) console.warn('Browser failure summary unavailable; retain the original Playwright trace and failure.');
    try {
      verifyProductionBuild(repository, claim);
      if (tests !== fingerprintPaths(repository, testInputs)) throw new Error('Browser test sources changed during the aggregate; this run cannot validate the final source.');
    } finally { if (claim.consumedPath) rmSync(claim.consumedPath, { force: true }); }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
