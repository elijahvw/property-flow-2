import { test, expect, Page } from '@playwright/test';

async function fixture(page: Page) {
  const company = { id: 'fictional-company', name: 'Fictional presentation company', status: 'active', version: 1, memberships: [], _count: { memberships: 0 } };
  const item = { id: 'generation', companyId: company.id, ownerId: 'fictional-owner', status: 'ready', version: 1, seedVersion: 3, createdAt: '2026-10-25T12:00:00Z', company, owner: { email: 'owner@sales-demo.invalid', name: 'Fictional Owner' }, setup: { id: 'generation', status: 'ready' }, replacementSetups: [] as { id: string; status: string }[] };
  const state = { denyList: false, configured: true, blockers: [] as string[], loseRebuild: false, posts: [] as any[], item };
  const sheet = { id: 'replacement', companyId: 'replacement-company', credentials: [{ name: 'Fictional Owner', role: 'Owner', email: 'replacement@sales-demo.invalid', password: 'fixture-only-password' }] };
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === '/api/bootstrap') return json({ user: { id: 'platform', email: 'platform@test.invalid', emailVerified: true, status: 'active', platformRole: 'owner' }, permissions: ['platform.manage'], membership: null, csrfToken: 'fixture' });
    if (path === '/api/platform/companies') return json([company]);
    if (path === '/api/platform/sales-demos/blueprint') return json({ seedVersion: 5, anchorOn: '2026-10-25', planHash: 'a'.repeat(64), environment: { name: 'dev', provisioningAllowed: state.configured }, effects: { dedicatedCompanies: 1, preparedAccounts: 11, issuedLogins: 8 }, roles: [{ key: 'owner', role: 'Owner', login: true }, { key: 'offline', role: 'Tenant without portal access', login: false }], coverage: [{ key: 'leasing', label: 'Leasing and tenants' }] });
    if (path === '/api/platform/sales-demos') return state.denyList ? json({ error: 'Platform access is no longer available.' }, 403) : json({ seedVersion: 5, items: [item], setups: [] });
    if (path.endsWith('/plan')) return json({ id: 'generation', planHash: 'b'.repeat(64), expectedVersion: 1, seedVersion: 3, latestSeedVersion: 5, automatic: true, canRebuild: state.configured && !state.blockers.length, companyMembers: 8, blockers: state.blockers, replacement: null, coverage: [{ key: 'leasing', complete: true }], stops: [{ title: 'Offline tenant with an active lease', role: 'Owner or manager', state: 'No portal membership or issued password.', path: '/company/leases/fictional-lease' }] });
    if (path.endsWith('/credentials')) return json(sheet);
    if (path.endsWith('/rebuild')) {
      expect(request.headers()['x-csrf-token']).toBe('fixture');
      state.posts.push(request.postDataJSON()); item.status = 'retired'; item.setup.status = 'retired'; item.replacementSetups = [{ id: 'replacement', status: 'ready' }];
      if (state.loseRebuild) { state.loseRebuild = false; return route.abort('failed'); }
      return json(sheet);
    }
    if (path === '/api/platform/users/sync') return json({ conflicts: [], nextPage: null, limited: false });
    return json([]);
  });
  return state;
}

test('disconnected demo blueprint remains useful and cannot provision by accident', async ({ page }) => {
  const state = await fixture(page); state.configured = false;
  await page.goto('/platform/companies'); await page.getByRole('button', { name: 'Manage sales demos', exact: true }).click();
  const blueprint = page.getByRole('region', { name: 'Sales demo blueprint' });
  await expect(blueprint).toContainText('Preview only'); await expect(blueprint).toContainText('11'); await expect(blueprint).toContainText('Building is unavailable');
  await expect(blueprint.getByRole('button', { name: 'Build sales demo', exact: true })).toBeDisabled();
  await blueprint.getByText('Roles and feature coverage', { exact: true }).click(); await expect(blueprint).toContainText('No portal login or password is issued'); expect(state.posts).toHaveLength(0);
});

test('reviewed replacement recovers the exact request after response loss and leaves source history visible', async ({ page }) => {
  const state = await fixture(page); state.loseRebuild = true;
  await page.goto('/platform/companies'); await page.getByRole('button', { name: 'Manage sales demos', exact: true }).click(); await page.getByRole('button', { name: 'Review fixture update', exact: true }).click();
  const review = page.getByRole('region', { name: 'Demo rebuild review' });
  await expect(review).toContainText('Existing posted records are not rewritten');
  await review.getByRole('button', { name: 'Build replacement demo', exact: true }).click(); expect(state.posts).toHaveLength(0);
  await review.getByRole('checkbox').check(); await review.getByRole('button', { name: 'Build replacement demo', exact: true }).click();
  await expect(review.getByRole('alert')).toBeVisible(); await expect(review.getByRole('button', { name: 'Refresh action plan', exact: true })).toBeDisabled();
  await expect(review.getByRole('checkbox')).toBeDisabled(); await review.getByRole('button', { name: 'Build replacement demo', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Demo login credentials' })).toBeVisible(); expect(state.posts).toHaveLength(2); expect(state.posts[0]).toEqual(state.posts[1]);
  expect(state.posts[0]).toMatchObject({ expectedVersion: 1, confirmed: true, planHash: 'b'.repeat(64) }); await expect(page.getByText('Torn down', { exact: false }).first()).toBeVisible();
});

test('foreign ownership blockers stop a reviewed rebuild and expose source walkthrough without new authority', async ({ page }) => {
  const state = await fixture(page); state.blockers = ['This company contains an account not owned by this demo.'];
  await page.goto('/platform/companies'); await page.getByRole('button', { name: 'Manage sales demos', exact: true }).click(); await page.getByRole('button', { name: 'Review fixture update', exact: true }).click();
  const review = page.getByRole('region', { name: 'Demo rebuild review' }); await expect(review.getByRole('alert')).toContainText('not owned'); await expect(review.getByRole('button', { name: 'Build replacement demo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Presentation walkthrough', exact: true }).click(); const guide = page.getByRole('region', { name: 'Demo presentation walkthrough' }); await expect(guide).toContainText('normal permissions'); await expect(guide.getByRole('link')).toHaveAttribute('href', '/company/leases/fictional-lease'); expect(state.posts).toHaveLength(0);
});

test('denied list refresh conceals issued credentials and demo review fits a narrow screen', async ({ page }) => {
  const state = await fixture(page); await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/platform/companies'); await page.getByRole('button', { name: 'Manage sales demos', exact: true }).click(); await page.getByRole('button', { name: 'View role logins', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Demo login credentials' })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  state.denyList = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert')).toContainText('no longer available'); await expect(page.getByRole('region', { name: 'Demo login credentials' })).toHaveCount(0);
});
