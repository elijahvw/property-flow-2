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

test('each task belongs to its owning workspace while account and platform authority stay separate', () => {
  const sections = groupedNavigation(['property.read', 'property.write', 'lease.manage', 'subscription.read']);
  assert.deepEqual(sections[0].routes.map(route => route.path), ['/company/overview']);
  assert(sections.find(section => section.title === 'Settings').routes.some(route => route.path === '/company/subscription'));
  assert(sections.find(section => section.title === 'Properties').routes.some(route => route.path === '/company/imports/units'));
  assert.equal(sections.flatMap(section => section.routes).filter(route => route.title === 'Applications').length, 1);
  assert.equal(sections.flatMap(section => section.routes).find(route => route.path === '/company/prospects').title, 'Prospects');
  assert(!sections.flatMap(section => section.routes).some(route => route.path.startsWith('/platform/')));
});

test('management sidebar has six daily jobs and keeps specialist tools in their contextual workspace', () => {
  const { sidebarNavigation, contextualNavigation } = mod.exports;
  const permissions = ['property.read', 'property.write', 'resident.assignment.manage', 'lease.manage', 'maintenance.manage', 'finance.manage', 'company.manage', 'members.manage', 'subscription.read'];
  const sidebar = sidebarNavigation(permissions, '/company/finances');
  assert.deepEqual(sidebar[0].routes.map(route => route.title), ['Today', 'Properties', 'Tenants', 'Leasing', 'Maintenance', 'Money']);
  assert.deepEqual(sidebar.flatMap(section => section.routes).filter(route => route.active).map(route => route.title), ['Money']);
  assert(!sidebar.flatMap(section => section.routes).some(route => /imports|prospects|applications|drafts|deposits|reports/.test(route.path)));
  const leasing = contextualNavigation(permissions, '/company/applications/application/edit');
  assert.equal(leasing.title, 'Leasing');
  assert(leasing.routes.some(route => route.path === '/company/drafts'));
  assert(leasing.routes.some(route => route.path === '/company/availability'));
  assert(contextualNavigation(permissions, '/company/imports/units').routes.some(route => route.path === '/company/properties'));
  assert.equal(contextualNavigation(permissions, '/company/properties/maple/rent').title, 'Money');
  assert.equal(contextualNavigation(permissions, '/company/properties/maple/leases').title, 'Leasing');
});

test('compact navigation filters feature availability before choosing the workspace entry', () => {
  const { sidebarNavigation, contextualNavigation } = mod.exports;
  const permissions = ['property.read', 'lease.manage', 'finance.manage', 'maintenance.manage'];
  const available = path => !/rent|deposits|finances|reports|imports\/expenses|maintenance|vendors|preventive|work-calendar/.test(path);
  const sidebar = sidebarNavigation(permissions, '/company/leases', available);
  assert(!sidebar.flatMap(section => section.routes).some(route => ['Money', 'Maintenance'].includes(route.title)));
  assert.equal(contextualNavigation(permissions, '/company/rent', available), undefined);
  const platform = sidebarNavigation(['platform.manage', 'platform.impersonate'], '/platform/users');
  assert(platform.some(section => section.title === 'Platform'));
  assert(!platform.flatMap(section => section.routes).some(route => route.path.startsWith('/company/')));
});

test('staff keep assigned work while residents retain their own rental destinations', () => {
  const { sidebarNavigation, contextualNavigation } = mod.exports;
  const staff = sidebarNavigation(['property.read', 'maintenance.execute'], '/company/work-orders/request');
  assert.deepEqual(staff[0].routes.map(route => route.title), ['Today', 'Properties', 'Assigned work']);
  assert.equal(staff[0].routes.find(route => route.active).path, '/company/work-orders');
  assert.equal(contextualNavigation(['property.read', 'maintenance.execute'], '/company/work-orders/request'), undefined);
  const resident = sidebarNavigation(['resident.self'], '/resident/documents');
  assert.deepEqual(resident[0].routes.map(route => route.path), ['/resident', '/resident/maintenance', '/resident/rent', '/resident/deposits', '/resident/documents']);
  assert(!resident.flatMap(section => section.routes).some(route => route.path.startsWith('/company/')));
});

test('contextual tools retain the property scope without carrying editor or unrelated filter state', () => {
  const { contextualDestinationPath } = mod.exports;
  assert.equal(contextualDestinationPath('/company/availability', '?propertyId=maple&new=lease&contactId=person&status=draft'), '/company/availability?propertyId=maple');
  assert.equal(contextualDestinationPath('/company/reports', '?leaseId=lease&memo=private'), '/company/reports');
  assert.equal(contextualDestinationPath('/company/deposits', '?propertyId=wrong&memo=private', '/company/properties/maple/rent'), '/company/deposits?propertyId=maple');
  assert.equal(contextualDestinationPath('/company/leases', '?new=lease', '/company/properties/maple/leases'), '/company/leases?propertyId=maple');
  for (const destination of ['/company/imports/units', '/company/imports/expenses', '/company/drafts', '/company/vendors'])
    assert.equal(contextualDestinationPath(destination, '?propertyId=maple', '/company/properties/maple/units'), destination);
});

test('each contextual maintenance tool selects one exact destination while its sidebar selects Maintenance', () => {
  const { contextualNavigation, sidebarNavigation } = mod.exports;
  for (const path of ['/company/vendors', '/company/vendors/vendor', '/company/preventive', '/company/preventive/plan', '/company/work-calendar']) {
    const context = contextualNavigation(['maintenance.manage'], path);
    const active = context.routes.filter(route => route.active);
    assert.equal(active.length, 1);
    assert.equal(active[0].path, path.includes('/vendors') ? '/company/vendors' : path.includes('/preventive') ? '/company/preventive' : path);
    assert.deepEqual(sidebarNavigation(['maintenance.manage'], path).flatMap(section => section.routes).filter(route => route.active).map(route => route.title), ['Maintenance']);
  }
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
