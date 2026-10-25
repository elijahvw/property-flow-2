const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/navigation.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', compiled)(mod, mod.exports);
const { routes, navigationSections, groupedNavigation, navigationActive } = mod.exports;

test('every primary destination has exactly one explicit navigation placement', () => {
  const placed = navigationSections.flatMap(section => section.paths);
  assert.equal(new Set(placed).size, placed.length);
  assert.deepEqual([...placed].sort(), routes.map(route => route.path).sort());
});

test('daily work leads the menu and administration stays with setup and billing', () => {
  const sections = groupedNavigation(['property.read', 'property.write', 'lease.manage', 'subscription.read']);
  assert.deepEqual(sections[0].routes.map(route => route.path), ['/company/overview', '/company/properties']);
  assert(sections.find(section => section.title === 'Administration').routes.some(route => route.path === '/company/subscription'));
  assert(sections.find(section => section.title === 'Administration').routes.some(route => route.path === '/company/imports/units'));
  assert.equal(sections.flatMap(section => section.routes).filter(route => route.title === 'Applications').length, 1);
  assert.equal(sections.flatMap(section => section.routes).find(route => route.path === '/company/prospects').title, 'Prospects');
  assert(!sections.flatMap(section => section.routes).some(route => route.path.startsWith('/platform/')));
});

test('resident and property detail routes retain one correct primary destination', () => {
  for (const [pathname, expected] of [
    ['/company/properties/maple/rent', '/company/properties'],
    ['/company/applications/application/edit', '/company/applications'],
    ['/resident/leases/lease/statement', '/resident/rent'],
    ['/resident/leases/lease/terms', '/resident'],
    ['/company/work-calendar', '/company/maintenance'],
  ]) {
    assert.deepEqual(routes.filter(route => navigationActive(route.path, pathname)).map(route => route.path), [expected]);
  }
});

test('workspace finder exposes existing secondary workspaces without expanding primary navigation', () => {
  const { workspaceDestinations, matchingWorkspaceDestinations } = mod.exports;
  const work = workspaceDestinations(['property.read', 'lease.manage', 'maintenance.manage', 'finance.manage']);
  assert.equal(matchingWorkspaceDestinations(work, 'late')[0].path, '/company/rent');
  assert.equal(matchingWorkspaceDestinations(work, 'vendor')[0].path, '/company/vendors');
  assert.equal(matchingWorkspaceDestinations(work, 'calendar')[0].path, '/company/work-calendar');
  assert(!routes.some(route => route.path === '/company/vendors'));
  assert.equal(new Set(work.map(route => route.path)).size, work.length);
  assert.deepEqual(matchingWorkspaceDestinations(work, '').slice(0, 4).map(route => route.path), ['/company/overview', '/company/properties', '/company/leases', '/company/maintenance']);
});

test('workspace finder does not invent role grants or expose company work to residents/platform admins', () => {
  const { workspaceDestinations, matchingWorkspaceDestinations } = mod.exports;
  const resident = workspaceDestinations(['resident.self']);
  assert(resident.some(route => route.path === '/resident/rent'));
  assert.equal(matchingWorkspaceDestinations(resident, 'rent')[0].path, '/resident/rent');
  assert.equal(matchingWorkspaceDestinations(resident, 'repair')[0].path, '/resident/maintenance');
  assert(!resident.some(route => /^\/(company|platform)\//.test(route.path)));
  const platform = workspaceDestinations(['platform.manage']);
  assert.equal(matchingWorkspaceDestinations(platform, 'people')[0].path, '/platform/users');
  assert(!platform.some(route => /^\/(company|resident)(?:\/|$)/.test(route.path)));
  assert(!workspaceDestinations(['property.read']).some(route => route.path === '/company/vendors'));
});
