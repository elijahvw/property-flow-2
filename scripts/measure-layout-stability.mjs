// Local-only, fictional route fixtures. This never contacts a live API and does
// not enable production telemetry/replay. Use identical arguments for comparisons.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summarizeLayoutShifts } from './layout-stability-metrics.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (!process.argv[index].startsWith('--') || process.argv[index + 1] === undefined)
    throw new Error('Use --base-url URL --label NAME --out FILE [--runs 3] [--chromium PATH].');
  args.set(process.argv[index].slice(2), process.argv[index + 1]);
}
const base = new URL(args.get('base-url') || 'http://127.0.0.1:5090');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('Only a loopback preview is permitted.');
const runs = Number(args.get('runs') || 3), bootstrapDelay = Number(args.get('bootstrap-delay') || 200), dataDelay = Number(args.get('data-delay') || 800);
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 10 || [bootstrapDelay, dataDelay].some(delay => !Number.isSafeInteger(delay) || delay < 0 || delay > 5000)) throw new Error('Invalid run count or fixture delay.');
const output = resolve(args.get('out') || '/tmp/propertyflow-layout-stability.json');
const label = args.get('label') || 'working-tree';
const budget = args.has('budget') ? Number(args.get('budget')) : null;
if (budget !== null && (!Number.isFinite(budget) || budget < 0 || budget > 1)) throw new Error('CLS budget must be between 0 and 1.');
const selected = new Set((args.get('routes') || 'company,users,property,tenants').split(','));
const screenshots = args.get('screenshots');
if (screenshots) await mkdir(resolve(screenshots), { recursive: true });
const company = { id: 'layout-company', name: 'Fictional Layout Company', status: 'active', version: 1, timezone: 'America/New_York', legalName: 'Fictional Layout Company LLC', contactEmail: 'layout@test.invalid', contactName: 'Fictional Contact', addressLine1: '12 Fictional Street', city: 'Springfield', region: 'CA', postalCode: '12345', country: 'US', memberships: [], _count: { memberships: 0 } };
const property = { id: 'layout-property', name: 'Fictional Garden House', address: '12 Fictional Street', city: 'Springfield', state: 'CA', zip: '12345', version: 1, propertyType: 'multi_family', country: 'US', yearBuilt: 1985 };
const users = Array.from({ length: 12 }, (_, index) => ({ id: `layout-account-${index}`, name: `Fictional Account ${String(index + 1).padStart(2, '0')}`, email: `layout${index + 1}@test.invalid`, emailVerified: true, status: 'active', platformRole: null, membership: { userId: `layout-account-${index}`, companyId: company.id, role: index ? 'manager' : 'owner', status: 'active', version: 1, company } }));
const tenants = users.map((user, index) => ({ kind: 'contact', id: `layout-contact-${index}`, contactId: `layout-contact-${index}`, userId: user.id, name: user.name, email: user.email, phone: null, contactName: user.name, contactPhone: null, recordStatus: 'active', status: 'active', portalState: 'active', version: 1, user, canArchive: false, rentalCount: 1, rentals: [{ leaseId: `layout-lease-${index}`, propertyId: property.id, propertyName: property.name, unitLabel: `Apartment ${index + 1}`, role: 'leaseholder', status: 'current', startsOn: '2026-01-01', endsOn: '2026-12-31' }] }));
const scenarios = [
  { key: 'company', path: `/platform/companies/${company.id}`, platform: true, ready: 'h1', heading: company.name },
  { key: 'users', path: '/platform/users', platform: true, ready: 'h1', heading: 'Users' },
  { key: 'property', path: `/company/properties/${property.id}`, platform: false, ready: 'h1', heading: property.name },
  { key: 'tenants', path: '/company/residents', platform: false, ready: 'h1', heading: 'Tenants' },
].filter(scenario => selected.has(scenario.key));
if (scenarios.length !== selected.size) throw new Error('Unknown fixture route. Choose company, users, property or tenants.');

function bootstrap(platform, destination) {
  return { user: { id: platform ? 'layout-admin' : 'layout-manager', name: 'Fictional Layout Tester', email: 'tester@test.invalid', emailVerified: true, status: 'active', platformRole: platform ? 'owner' : null }, membership: platform ? null : { companyId: company.id, version: 1, role: 'manager', status: 'active', company }, permissions: platform ? ['platform.manage'] : ['property.read', 'property.write', 'resident.assignment.manage', 'lease.manage', 'finance.manage', 'maintenance.manage'], destination, csrfToken: 'layout-fixture', impersonation: null };
}

async function fixtures(page, scenario) {
  const calls = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const safeRoute = path === '/api/bootstrap' ? 'bootstrap' : path === '/api/platform/users/sync' ? 'directory-sync' : path.endsWith('/subscription') ? 'subscription' : path.includes('/resident-profiles/directory') ? 'tenant-directory' : path.includes('/platform/companies') ? 'company-records' : path.includes('/platform/users') ? 'user-records' : path.includes('/company/properties') ? 'property-records' : 'auxiliary';
    calls.push({ route: safeRoute, method: request.method() });
    await new Promise(resolve => setTimeout(resolve, path === '/api/bootstrap' ? bootstrapDelay : dataDelay));
    let json = [];
    if (path === '/api/bootstrap') json = bootstrap(scenario.platform, scenario.path);
    else if (path === '/api/account/guide') json = { eligible: false, steps: [] };
    else if (path === '/api/telemetry') json = { accepted: true };
    else if (path === '/api/platform/users/sync') json = { conflicts: [], nextPage: null, limited: false };
    else if (path === '/api/platform/users') json = users;
    else if (path === '/api/platform/companies') json = [company];
    else if (path === `/api/platform/companies/${company.id}`) json = company;
    else if (path.endsWith('/subscription')) json = { subscription: null, plans: [], catalog: [{ key: 'properties', label: 'Properties', description: 'Property and unit records' }], effectiveFeatures: { properties: 'enabled' }, billingProfile: { name: company.name, email: 'layout@test.invalid', address: {}, companyVersion: 1 } };
    else if (path.endsWith('/subscription/history')) json = { items: [], nextCursor: null };
    else if (path === '/api/company/properties') json = [property];
    else if (path === `/api/company/properties/${property.id}`) json = property;
    else if (path === '/api/company/resident-profiles/directory') json = { companyId: company.id, today: '2026-10-25', timezone: 'UTC', items: tenants, total: tenants.length, pageSize: 50, nextCursor: null, previousCursor: null, properties: [{ id: property.id, name: property.name }] };
    else if (path === '/api/platform/sales-demos') json = { items: [], setups: [], seedVersion: 1 };
    return route.fulfill({ json });
  });
  // Reject unexpected external traffic rather than touching a provider during
  // the measurement. Static preview assets remain the only unmocked requests.
  await page.route(url => url.origin !== base.origin, route => route.abort());
  return calls;
}

function observeLayout() {
  const state = { supported: PerformanceObserver.supportedEntryTypes.includes('layout-shift'), shifts: [], paints: [], navigations: [] };
  const allowedClasses = new Set(['workspace', 'workspace-main', 'sidebar', 'topbar', 'topbar-location', 'app-footer', 'status-panel', 'page-heading', 'panel', 'record-list', 'table-wrap', 'form-grid', 'property-detail-workspace', 'property-context', 'tenant-directory-page', 'tenant-directory-panel', 'tenant-directory-toolbar', 'admin-directory', 'admin-directory-heading', 'admin-directory-intro', 'admin-directory-toolbar', 'admin-directory-summary', 'directory-workbench', 'directory-view-summary', 'directory-result-summary', 'directory-pagination']);
  const nodePath = node => {
    if (!(node instanceof Element)) return 'unavailable';
    const pieces = [];
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      const classes = [...node.classList].filter(name => allowedClasses.has(name));
      const tag = node.tagName.toLowerCase();
      pieces.unshift(tag + classes.map(name => `.${name}`).join(''));
      if (node.id === 'main' || classes.includes('workspace-main')) break;
    }
    return pieces.join(' > ');
  };
  const rect = value => [value.x, value.y, value.width, value.height].map(number => Math.round(number));
  if (state.supported) {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) state.shifts.push({ at: entry.startTime, value: entry.value, hadRecentInput: entry.hadRecentInput, sources: (entry.sources || []).map(source => ({ node: nodePath(source.node), previous: rect(source.previousRect), current: rect(source.currentRect) })) });
    });
    observer.observe({ type: 'layout-shift', buffered: true });
    state.observer = observer;
  }
  window.__layoutMeasurement = state;
}

const browser = await chromium.launch({ headless: true, ...(args.get('chromium') ? { executablePath: args.get('chromium') } : {}) });
const browserVersion = browser.version();
const results = [];
try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
    for (const scenario of scenarios) {
      for (let run = 1; run <= runs; run++) {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce' });
        const page = await context.newPage(), errors = [], requests = await fixtures(page, scenario);
        page.on('pageerror', () => errors.push('pageerror'));
        await page.addInitScript(observeLayout);
        try {
          await page.goto(new URL(scenario.path, base).href, { waitUntil: 'domcontentloaded' });
          await page.getByRole('heading', { level: 1, name: scenario.heading, exact: true }).waitFor({ state: 'visible', timeout: 15000 });
          if (scenario.key === 'users') await page.getByText(users.at(-1).name, { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 });
          if (scenario.key === 'tenants') await page.getByRole('link', { name: tenants.at(-1).name, exact: true }).waitFor({ state: 'visible', timeout: 15000 });
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(750);
          if (!await page.getByRole('heading', { level: 1, name: scenario.heading, exact: true }).isVisible()) throw new Error('Final heading was replaced.');
          if (await page.getByRole('heading', { name: 'Something went wrong', exact: true }).isVisible()) throw new Error('The error boundary replaced this route.');
          const observation = await page.evaluate(() => {
            const state = window.__layoutMeasurement;
            state.observer?.disconnect();
            const navigation = performance.getEntriesByType('navigation')[0];
            const resources = performance.getEntriesByType('resource').flatMap(entry => {
              const path = new URL(entry.name).pathname;
              if (!path.startsWith('/api/')) return [];
              const category = path === '/api/bootstrap' ? 'bootstrap' : path === '/api/platform/users/sync' ? 'directory-sync' : path.endsWith('/subscription') ? 'subscription' : path.includes('/resident-profiles/directory') ? 'tenant-directory' : path.includes('/platform/companies') ? 'company-records' : path.includes('/platform/users') ? 'user-records' : path.includes('/company/properties') ? 'property-records' : 'auxiliary';
              return [{ category, startMs: entry.startTime, responseEndMs: entry.responseEnd }];
            });
            return { supported: state.supported, shifts: state.shifts, resources, navigation: navigation ? { ttfbMs: Math.round(navigation.responseStart - navigation.requestStart), domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd) } : null, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
          });
          if (screenshots && run === 1) await page.screenshot({ path: resolve(screenshots, `${label}-${scenario.key}-${viewport.name}.png`), fullPage: false });
          results.push({ route: scenario.key, viewport: viewport.name, run, ...summarizeLayoutShifts(observation.shifts), ...observation, errors, requests });
        } catch (error) {
          results.push({ route: scenario.key, viewport: viewport.name, run, failed: true, reason: error?.name || 'measurement-failure', errors, requests });
        } finally { await context.close(); }
      }
    }
  }
} finally { await browser.close(); }

const report = { label, fixtureOnly: true, privacy: 'Only static structural paths, rectangles and route categories are exported; no text, record IDs, contact values or URLs.', configuration: { browserVersion, viewports: ['1440x1000', '390x844'], locale: 'en-US', timezone: 'UTC', reducedMotion: 'reduce', runs, bootstrapDelayMs: bootstrapDelay, dataDelayMs: dataDelay, input: 'No user interactions during measurement', cls: 'Maximum session-window sum: gap <1000ms and duration <5000ms; excludes hadRecentInput entries.', cache: 'Fresh browser context per run; routing disables HTTP cache.', budget }, results };
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
for (const result of results) console.log(JSON.stringify({ label, route: result.route, viewport: result.viewport, run: result.run, cls: result.cls, shifts: result.eligibleShiftCount, failed: !!result.failed, errors: result.errors.length, overflow: result.horizontalOverflow }));
console.log(`Report: ${output}`);
if (results.some(result => result.failed || result.errors.length || !result.supported || budget !== null && result.cls > budget)) process.exitCode = 1;
