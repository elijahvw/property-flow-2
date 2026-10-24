import { test, expect, BrowserContext } from '@playwright/test';

const company = { id: 'fictional-company', name: 'Fictional company', status: 'active' };
const target = { id: 'fictional-staff', name: 'Fictional staff', email: 'staff@test.invalid', membership: { companyId: company.id, role: 'staff', company } };
const expiresAt = '2099-01-01T12:30:00.000Z';
async function setup(context: BrowserContext, platformRole = 'owner') {
  const actor = { id: 'fictional-support', name: 'Fictional support', email: 'support@test.invalid', platformRole, status: 'active', emailVerified: true };
  const state = { acting: false, starts: [] as any[], stops: 0, support: [] as any[], guideRequests: 0, failStop: false, contextHeaders: [] as string[], queries: [] as URLSearchParams[] };
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    state.contextHeaders.push(request.headers()['x-impersonation-id'] || '');
    if (path === '/api/bootstrap') return json(state.acting ? {
      user: { ...target, emailVerified: true, platformRole: null, status: 'active' }, membership: { ...target.membership, status: 'active', version: 1 }, permissions: ['property.read'], csrfToken: 'fixture', destination: '/company/properties',
      impersonation: { actor, expiresAt, readOnly: true, contextId: `${target.id}:${expiresAt}` },
    } : { user: actor, membership: null, permissions: platformRole === 'owner' ? ['platform.manage', 'platform.impersonate'] : platformRole === 'support' ? ['platform.impersonate'] : ['property.read'], csrfToken: 'fixture', destination: '/platform/impersonation', impersonation: null });
    if (path === '/api/account/guide') { state.guideRequests++; return json({ eligible: false, steps: [] }); }
    if (path === '/api/impersonation/users') {
      state.queries.push(url.searchParams);
      return json({ items: [target], nextCursor: url.searchParams.has('cursor') ? null : 'fixture-cursor' });
    }
    if (path === '/api/impersonation' && request.method() === 'POST') { state.starts.push(request.postDataJSON()); state.acting = true; return json({ destination: '/company/properties' }); }
    if (path === '/api/impersonation' && request.method() === 'DELETE') { state.stops++; if (state.failStop) return json({ error: 'Temporary failure. Retry ending the session.' }, 503); state.acting = false; return json({ destination: '/platform/impersonation' }); }
    if (path === '/api/platform/support-access') return json({ items: [{ ...actor, id: 'fictional-colleague', name: 'Fictional colleague', platformRole: state.support.length ? 'support' : null, hasIdentity: true, updatedAt: '2026-10-24T12:00:00.000Z' }], nextCursor: null });
    if (path.endsWith('/support-access') && request.method() === 'PATCH') { state.support.push(request.postDataJSON()); return json({ success: true }); }
    if (path === '/api/company/properties') return json([]);
    return json([]);
  });
  return state;
}

test('owner grants support separately, filters real users and starts and ends a read-only session', async ({ page, context }) => {
  const state = await setup(context);
  await page.goto('/platform/impersonation');
  await page.getByRole('button', { name: 'Grant support access for Fictional colleague' }).click();
  await page.getByRole('button', { name: 'Confirm grant', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Support access granted.' })).toBeVisible();
  expect(state.support).toEqual([{ enabled: true, updatedAt: '2026-10-24T12:00:00.000Z' }]);
  await page.getByRole('combobox', { name: 'Company role', exact: true }).selectOption('staff');
  await expect.poll(() => state.queries.at(-1)?.get('role')).toBe('staff');
  await page.getByRole('button', { name: 'Next users', exact: true }).click();
  await expect.poll(() => state.queries.at(-1)?.get('cursor')).toBe('fixture-cursor');
  await page.getByRole('button', { name: 'View as Fictional staff', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Start impersonation', exact: true });
  await expect(dialog.getByRole('button', { name: 'Start read-only session' })).toBeDisabled();
  await dialog.getByLabel('Support case or testing reason', { exact: true }).fill('Case 123: verify staff access');
  await dialog.getByRole('button', { name: 'Start read-only session' }).click();
  await expect(page).toHaveURL(/\/company\/properties$/);
  const banner = page.getByRole('region', { name: 'Impersonation session' });
  await expect(banner).toContainText('Read-only impersonation');
  await expect(banner).toContainText('Fictional staff');
  await expect(banner).toContainText('Changes are disabled');
  expect(state.starts).toEqual([{ userId: target.id, reason: 'Case 123: verify staff access' }]);
  await expect.poll(() => state.contextHeaders).toContain(`${target.id}:${expiresAt}`);
  state.failStop = true;
  await banner.getByRole('button', { name: 'Return to my account' }).click();
  await expect(banner.getByRole('alert')).toContainText('Temporary failure');
  state.failStop = false;
  await banner.getByRole('button', { name: 'Return to my account' }).click();
  await expect(page).toHaveURL(/\/platform\/impersonation$/);
  await expect(page.getByRole('region', { name: 'Impersonation session' })).toHaveCount(0);
  expect(state.stops).toBe(2);
});

test('support sees impersonation but cannot access owner management; guide is suppressed while acting on mobile', async ({ page, context }) => {
  const state = await setup(context, 'support');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/platform/impersonation');
  await expect(page.getByRole('heading', { name: 'Impersonation', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Support access', exact: true })).toHaveCount(0);
  await page.goto('/platform/users');
  await expect(page.getByText('Your account does not currently have access to this page.')).toBeVisible();
  state.acting = true; state.guideRequests = 0;
  await page.goto('/company/properties');
  await expect(page.getByRole('region', { name: 'Impersonation session' })).toBeVisible();
  expect(state.guideRequests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('starting support in one tab reloads another tab with the effective user', async ({ page, context }) => {
  const state = await setup(context, 'support');
  await page.goto('/platform/impersonation');
  const other = await context.newPage();
  await other.goto('/platform/impersonation');
  await expect(other.getByRole('heading', { name: 'Impersonation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View as Fictional staff', exact: true }).click();
  await page.getByLabel('Support case or testing reason', { exact: true }).fill('Verify support tab boundaries');
  await page.getByRole('button', { name: 'Start read-only session' }).click();
  await expect(page.getByRole('region', { name: 'Impersonation session' })).toBeVisible();
  await expect(other.getByRole('region', { name: 'Impersonation session' })).toBeVisible();
  expect(state.acting).toBe(true);
  await other.close();
});
