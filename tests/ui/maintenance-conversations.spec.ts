import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page, role = 'resident') {
  const state = {
    lose: false, fail: 0, denied: false, posts: [] as Record<string, string>[], requests: [] as string[],
    updates: [
      { id: 'private', content: 'Private repair estimate for management.', visibility: 'internal', author: 'Manager', createdAt: '2026-10-21T12:00:00Z' },
      { id: 'shared', content: 'A plumber will visit on Friday morning.', visibility: 'resident', author: 'Property team', createdAt: '2026-10-21T13:00:00Z' },
    ],
  };
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    state.requests.push(path);
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === '/api/bootstrap') return json({
      user: { id: role, name: 'Fixture User', email: `${role}@test.invalid`, emailVerified: true, status: 'active' },
      membership: { companyId: 'company', version: 1, role, status: 'active', company: { name: 'Fictional Preview Company', status: 'active' } },
      permissions: role === 'resident' ? ['resident.self'] : role === 'staff' ? ['property.read'] : ['property.read', 'maintenance.manage'], csrfToken: 'fixture',
    });
    if (path.endsWith('/properties')) return json([{ id: 'home', name: 'Maple House' }]);
    // A resident-created request has no preventive occurrence. This API uses
    // null for that state; an array would incorrectly claim a schedule exists.
    if (path.endsWith('/preventive')) return json(null);
    if (path.endsWith('/documents')) return json({ items: [], scanningConfigured: false });
    if (path.endsWith('/vendor')) return json({ id: 'request', version: 2, vendor: null });
    if (path === '/api/company/work-orders/request') return json({ id: 'request', status: 'resolved', executionStatus: 'unassigned', actions: [], eligible: [] });
    if (path.endsWith('/updates')) {
      if (state.denied) return json({ error: 'Request access is no longer available.' }, 404);
      if (req.method() === 'POST') {
        expect(req.headers()['x-csrf-token']).toBe('fixture');
        const payload = req.postDataJSON(); state.posts.push(payload);
        if (state.fail) return json({ error: 'Your reply could not be saved. Try again.' }, state.fail);
        let row = state.updates.find(item => (item as any).submissionKey === payload.submissionKey);
        if (!row) { row = { id: 'reply-' + state.posts.length, content: payload.content, visibility: payload.visibility || 'resident', author: role === 'resident' ? 'You' : 'Manager', createdAt: '2026-10-22T12:00:00Z', ...payload }; state.updates.unshift(row!); }
        if (state.lose) { state.lose = false; return route.abort('failed'); }
        return json(row);
      }
      return json({ items: state.updates.filter(item => role !== 'resident' || item.visibility === 'resident'), nextCursor: null });
    }
    if (/\/maintenance\/request$/.test(path)) return state.denied ? json({ error: 'Request access is no longer available.' }, 404) : json({
      id: 'request', propertyId: 'home', unitId: null, unit: null, property: { name: 'Maple House' }, title: 'Kitchen tap leak', description: 'The kitchen tap drips.', category: 'plumbing', priority: 'normal', status: 'resolved', version: 2, targetOn: null,
      createdAt: '2026-10-21T12:00:00Z', updatedAt: '2026-10-21T13:00:00Z', residentUpdatesAvailable: true, activity: [], historyLimited: false,
    });
    return json([]);
  });
  return state;
}

test('resident sends a reply from the visible-only conversation and recovers a lost response after reload', async ({ page }) => {
  const state = await fixture(page); state.lose = true;
  await page.goto('/resident/maintenance/request');
  const conversation = page.getByRole('region', { name: 'Request updates', exact: true });
  await expect(conversation).toContainText('A plumber will visit on Friday morning.');
  await expect(page.getByText('Private repair estimate for management.', { exact: true })).toHaveCount(0);
  await expect(conversation).toContainText('Replies do not change the request’s status.');
  await page.getByLabel('Reply to your property team', { exact: true }).fill('The tap is still dripping after the visit.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(conversation.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Reply to your property team', { exact: true })).toHaveValue('The tap is still dripping after the visit.');
  await page.reload();
  await expect(page.getByLabel('Reply to your property team', { exact: true })).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: 'Retry original reply', exact: true }).click();
  await expect(conversation.getByRole('status')).toContainText('Reply sent to your property team.');
  expect(state.posts).toHaveLength(2); expect(state.posts[0]).toEqual(state.posts[1]);
  expect(Object.keys(state.posts[0]).sort()).toEqual(['content', 'submissionKey']);
  await expect(conversation.getByText('The tap is still dripping after the visit.', { exact: true })).toHaveCount(1);
  await expect(page.getByLabel('Reply to your property team', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('pf-maintenance-reply:')))).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('definitive reply failure preserves editable input and revoked access removes the conversation', async ({ page }) => {
  const state = await fixture(page); state.fail = 400;
  await page.goto('/resident/maintenance/request');
  await page.getByLabel('Reply to your property team', { exact: true }).fill('Please confirm the next visit.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Request updates', exact: true }).getByRole('alert')).toContainText('could not be saved');
  await expect(page.getByLabel('Reply to your property team', { exact: true })).toBeEditable();
  await page.getByLabel('Reply to your property team', { exact: true }).fill('Please confirm a morning visit.');
  state.fail = 0; await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(page.getByText('Please confirm a morning visit.', { exact: true })).toBeVisible();
  state.denied = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Request access is no longer available.', { exact: false })).toBeVisible();
  await expect(page.getByText('Please confirm a morning visit.', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Reply to your property team', { exact: true })).toHaveCount(0);
});

test('management keeps internal notes separate and explicitly chooses the resident audience', async ({ page }) => {
  const state = await fixture(page, 'manager');
  await page.goto('/company/maintenance/request');
  await expect(page.getByText('Private repair estimate for management.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add update', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Add maintenance update', exact: true });
  await expect(editor.getByLabel('Update audience')).toHaveValue('internal');
  await editor.getByLabel('Update audience').selectOption('resident');
  await editor.getByLabel('Update text').fill('We will arrange another visit.');
  await editor.getByRole('button', { name: 'Record update', exact: true }).click();
  expect(state.posts[0].visibility).toBe('resident');
  await expect(editor).not.toBeVisible();
  await expect(page.getByText('We will arrange another visit.', { exact: true })).toBeVisible();
  await expect(page.getByText('Update recorded.', { exact: true })).toBeVisible();
});

test('staff direct links cannot load management or resident conversations', async ({ page }) => {
  const state = await fixture(page, 'staff');
  for (const path of ['/company/maintenance/request', '/resident/maintenance/request']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Access unavailable', exact: true })).toBeVisible();
  }
  expect(state.requests.some(path => path.includes('/maintenance/'))).toBe(false);
});

test('leaving an unsent resident reply requires confirmation and cancel keeps the text', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/resident/maintenance/request');
  const reply = page.getByLabel('Reply to your property team', { exact: true });
  await reply.fill('Please keep this unsent follow-up while I check the request.');
  expect(await page.evaluate(() => {
    const warning = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(warning);
    return warning.defaultPrevented;
  })).toBe(true);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('link', { name: '← Back to maintenance', exact: true }).click();
  await expect(page).toHaveURL(/\/resident\/maintenance\/request$/);
  await expect(reply).toHaveValue('Please keep this unsent follow-up while I check the request.');
  expect(state.posts).toHaveLength(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('link', { name: '← Back to maintenance', exact: true }).click();
  await expect(page).toHaveURL(/\/resident\/maintenance$/);
  expect(state.posts).toHaveLength(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('pf-maintenance-reply:')))).toBe(false);
});
