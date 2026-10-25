import { test, expect, Page } from '@playwright/test';

async function fixture(page: Page, role = 'manager') {
  const expense = (id: string, reference: string, amountCents: number, memo: string) => ({ id, reference, amountCents, memo, propertyId: 'home', property: { name: 'Maple House' }, occurredOn: '2026-10-16', currency: 'USD', kind: 'expense', category: 'repairs', version: 1, voidedAt: null, voidReason: null });
  const state = { entries: [expense('e1', 'TX-101', 25000, 'Boiler repair'), expense('e2', 'TX-102', 4505, 'Kitchen sink parts')], links: [] as any[], posts: [] as any[], unlinks: [] as any[], loseLink: false, loseUnlink: false, costReads: 0 };
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method(), json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path.endsWith('/preventive')) return json(null);
  if (path === '/api/bootstrap') return json({ user: { id: 'u', name: 'Manager', email: 'u@test.invalid', status: 'active', emailVerified: true }, membership: { companyId: 'a', version: 1, role, status: 'active', company: { name: 'Company', status: 'active' } }, permissions: role === 'resident' ? ['resident.self'] : role === 'staff' ? ['property.read'] : ['property.read', 'maintenance.manage', 'finance.manage'], csrfToken: 'fixture' });
    if (path === '/api/company/properties') return json([{ id: 'home', name: 'Maple House' }]);
    if (path === '/api/company/properties/home') return json({ id: 'home', name: 'Maple House' });
    if (path.endsWith('/updates')) return json({ items: [], nextCursor: null });
    if (/\/maintenance\/request$/.test(path)) return json({ id: 'request', propertyId: 'home', unitId: null, unit: null, title: 'Kitchen tap leak', description: 'Tap needs repair.', category: 'plumbing', status: 'in_progress', priority: 'normal', version: 1, targetOn: null, createdAt: '2026-10-16T12:00:00Z', updatedAt: '2026-10-16T12:00:00Z', property: { name: 'Maple House' }, activity: [], historyLimited: false, recordedBy: 'Manager', residentUpdatesAvailable: false });
    if (path.includes('/costs')) {
      if (method === 'GET') state.costReads++;
      if (path.endsWith('/candidates')) {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        return json({ items: state.entries.filter(e => !e.voidedAt && !state.links.some(c => !c.unlinkedAt && c.entry.id === e.id) && (!q || (e.reference + e.memo).toLowerCase().includes(q))), nextCursor: null });
      }
      if (method === 'POST') {
        expect(req.headers()['x-csrf-token']).toBe('fixture'); const data = req.postDataJSON();
        if (path.endsWith('/unlink')) {
          state.unlinks.push(data); const linked = state.links.find(c => path.includes('/' + c.id + '/'));
          if (linked.version !== data.expectedVersion && !linked.unlinkedAt) return json({ error: 'Record changed. Review the latest link.' }, 409);
          Object.assign(linked, { version: 2, unlinkedAt: '2026-10-16T15:00:00Z', unlinkReason: data.reason });
          if (state.loseUnlink) { state.loseUnlink = false; return route.abort('failed'); }
          return json(linked);
        }
        state.posts.push(data); let linked = state.links.find(c => c.submissionKey === data.submissionKey);
        if (!linked) {
          const entry = state.entries.find(e => e.id === data.entryId)!;
          if (entry.version !== data.expectedEntryVersion) return json({ error: 'This record changed. Clear the draft and select its latest record.' }, 409);
          linked = { id: 'cost-' + state.links.length, version: 1, entry: { ...entry }, createdAt: '2026-10-16T14:00:00Z', unlinkedAt: null, unlinkReason: null, ...data }; state.links.push(linked);
        }
        if (state.loseLink) { state.loseLink = false; return route.abort('failed'); }
        return json(linked);
      }
      return json({ items: state.links, nextCursor: null, summary: { paidCents: String(state.links.filter(c => !c.unlinkedAt && !c.entry.voidedAt).reduce((sum, c) => sum + c.entry.amountCents, 0)), paidCount: state.links.filter(c => !c.unlinkedAt && !c.entry.voidedAt).length } });
    }
    if (path === '/api/company/finances') {
      if (method === 'POST') {
        const data = req.postDataJSON(), entry = expense('created', 'TX-103', Math.round(Number(data.amount) * 100), data.memo); state.entries.push(entry); return json(entry);
      }
      const rows = state.entries.filter(e => !url.searchParams.get('entryId') || e.id === url.searchParams.get('entryId')).map(e => ({ ...e, maintenanceCosts: state.links.filter(c => c.entry.id === e.id && !c.unlinkedAt).map(() => ({ requestId: 'request' })) }));
      return json({ items: rows, nextCursor: null, summary: { incomeCents: '0', expenseCents: String(rows.reduce((sum, e) => sum + e.amountCents, 0)), netCents: String(-rows.reduce((sum, e) => sum + e.amountCents, 0)) } });
    }
    return json([]);
  });
  return state;
}

test('paid expense review retains an interrupted link and opens its exact financial source', async ({ page }) => {
  const state = await fixture(page); state.loseLink = true; await page.goto('/company/maintenance/request');
  await page.getByRole('button', { name: 'Link existing expense', exact: true }).click(); await page.getByLabel('Find paid expense').fill('sink'); await page.getByRole('radio', { name: /TX-102/ }).check();
  await page.getByRole('button', { name: 'Link expense', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible(); await expect(page.getByLabel('Find paid expense')).toBeDisabled(); await expect(page.getByRole('radio', { name: /TX-102/ })).toBeDisabled(); await page.getByRole('button', { name: 'Close', exact: true }).click();await page.getByRole('button',{name:/^(Save draft & close|Close & keep recovery)$/,exact:true}).click();
  await page.getByRole('button', { name: 'Link existing expense', exact: true }).click(); await expect(page.getByRole('group', { name: 'Review selected expense' })).toContainText('$45.05'); await page.getByRole('button', { name: 'Link expense', exact: true }).click();
  await expect(page.locator('.cost-total')).toContainText('$45.05'); expect(state.links.length).toBe(1); expect(state.posts[0]).toEqual(state.posts[1]);
  await page.getByRole('link', { name: 'TX-102 · View transaction →', exact: true }).click(); await expect(page).toHaveURL(/entryId=e2/); await expect(page.getByRole('heading', { name: 'Maple House · expense · $45.05', exact: true })).toBeVisible(); await expect(page.getByText('Boiler repair', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '← Back to maintenance request', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Kitchen tap leak', exact: true })).toBeVisible();
});

test('unlink retries retain the reason and original expense without changing financial amounts', async ({ page }) => {
  const state = await fixture(page); state.links.push({ id: 'cost', version: 1, entry: state.entries[0], createdAt: '2026-10-16T14:00:00Z', unlinkedAt: null, unlinkReason: null }); state.loseUnlink = true;
  await page.goto('/company/maintenance/request'); await page.getByRole('button', { name: 'Unlink expense TX-101', exact: true }).click(); await page.getByLabel('Unlink reason').fill('Linked to the wrong request.'); await page.getByRole('dialog').getByRole('button', { name: 'Unlink expense', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Unlink expense', exact: true }).click(); await expect(page.locator('.cost-total')).toContainText('$0.00'); await expect(page.getByText(/Linked to the wrong request\./)).toBeVisible(); expect(state.unlinks[0]).toEqual(state.unlinks[1]); expect(state.entries[0].amountCents).toBe(25000); expect(state.entries[0].voidedAt).toBeNull();
});

test('stale expense selection stays frozen through background updates until deliberately discarded', async ({ page }) => {
  const state = await fixture(page); await page.goto('/company/maintenance/request'); await page.getByRole('button', { name: 'Link existing expense', exact: true }).click(); await page.getByRole('radio', { name: /TX-101/ }).check(); state.entries[0].version = 2;
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.getByRole('button', { name: 'Link expense', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toContainText('record changed'); expect(state.posts[0].expectedEntryVersion).toBe(1);
  await page.getByRole('button', { name: 'Clear draft', exact: true }).click(); await page.getByRole('button', { name: 'Discard draft', exact: true }).click(); await page.getByRole('radio', { name: /TX-101/ }).check(); await page.getByRole('button', { name: 'Link expense', exact: true }).click(); await expect(page.locator('.cost-total')).toContainText('$250.00'); expect(state.posts[1].expectedEntryVersion).toBe(2); expect(state.posts[1].submissionKey).not.toBe(state.posts[0].submissionKey);
});

test('empty phone cost view leads to a property-scoped paid expense form and back to maintenance', async ({ page }) => {
  const state = await fixture(page); state.entries = []; await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/company/maintenance/request'); await expect(page.getByText('No expenses linked to this request.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Record a paid expense in Cash activity →', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Record a transaction', exact: true })).toBeVisible(); await expect(page.getByLabel('What are you recording?',{exact:true})).toHaveValue('expense'); await expect(page.getByLabel('Transaction property')).toHaveValue('home'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Close', exact: true }).click(); await page.getByRole('link', { name: '← Back to maintenance request', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Kitchen tap leak', exact: true })).toBeVisible();
});

test('resident and staff flows never request or render maintenance finance data', async ({ page }) => {
  const resident = await fixture(page, 'resident'); await page.goto('/resident/maintenance/request'); await expect(page.getByRole('heading', { name: 'Kitchen tap leak', exact: true })).toBeVisible(); await expect(page.getByRole('region', { name: 'Maintenance costs', exact: true })).toHaveCount(0); expect(resident.costReads).toBe(0);
  await page.unroute('**/api/**'); const staff = await fixture(page, 'staff'); await page.goto('/company/maintenance/request'); await expect(page.getByRole('heading', { name: 'Access unavailable', exact: true })).toBeVisible(); expect(staff.costReads).toBe(0);
});


test('stale maintenance cost reads suspend mutations and recover without losing expense review', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/company/maintenance/request');
  await page.getByRole('button', { name: 'Link existing expense', exact: true }).click();
  await page.getByRole('radio', { name: /TX-101/ }).check();
  let failCandidates = true;
  await page.route('**/api/company/maintenance/request/costs/candidates*', route => failCandidates ? route.fulfill({ status: 503, json: { error: 'Expense choices are temporarily unavailable.' } }) : route.fallback());
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(dialog.getByRole('button', { name: 'Link expense', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('radio', { name: /TX-101/ })).toBeDisabled();
  await expect(dialog.getByRole('group', { name: 'Review selected expense' })).toContainText('TX-101');
  expect(state.posts).toHaveLength(0);
  failCandidates = false;
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Link expense', exact: true })).toBeEnabled();
  let failSource = true;
  await page.route('**/api/company/maintenance/request/costs', route => failSource ? route.fulfill({ status: 503, json: { error: 'Maintenance cost history could not be refreshed.' } }) : route.fallback());
  await page.waitForTimeout(300);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog.getByRole('alert')).toContainText('could not be refreshed');
  await expect(dialog.getByRole('button', { name: 'Link expense', exact: true })).toBeDisabled();
  failSource = false;
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Link expense', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('group', { name: 'Review selected expense' })).toContainText('TX-101');
  await dialog.getByRole('button', { name: 'Link expense', exact: true }).click();
  await expect(page.locator('.cost-total')).toContainText('$250.00');
  expect(state.posts).toHaveLength(1);
});


test('expense selection stays fixed while a link response is pending', async ({ page }) => {
  const state = await fixture(page);
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/company/maintenance/request/costs', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    await pending;
    return route.fallback();
  });
  await page.goto('/company/maintenance/request');
  await page.getByRole('button', { name: 'Link existing expense', exact: true }).click();
  await page.getByRole('radio', { name: /TX-101/ }).check();
  await page.getByRole('button', { name: 'Link expense', exact: true }).click();
  await expect(page.getByLabel('Find paid expense')).toBeDisabled();
  await expect(page.getByRole('radio', { name: /TX-102/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  release();
  await expect(page.locator('.cost-total')).toContainText('$250.00');
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0].entryId).toBe('e1');
});


test('temporarily denied cost access conceals an uncertain editor and restores its exact retry', async ({ page }) => {
  const state = await fixture(page); state.loseLink = true;
  let denied = false;
  await page.route('**/api/company/maintenance/request/costs', route => route.request().method() === 'GET' && denied ? route.fulfill({ status: 403, json: { error: 'Maintenance costs are unavailable.' } }) : route.fallback());
  await page.goto('/company/maintenance/request');
  await page.getByRole('button', { name: 'Link existing expense', exact: true }).click();
  await page.getByRole('radio', { name: /TX-101/ }).check();
  await page.getByRole('button', { name: 'Link expense', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Link a paid maintenance expense', exact: true });
  await expect(dialog.getByRole('alert')).toBeVisible();
  denied = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(dialog).not.toBeVisible();
  const costs = page.getByRole('region', { name: 'Maintenance costs', exact: true });
  await expect(costs.getByRole('alert')).toContainText('unavailable');
  await expect(costs.getByRole('button', { name: 'Link existing expense', exact: true })).toBeDisabled();
  denied = false;
  await costs.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Review selected expense' })).toContainText('TX-101');
  await expect(dialog.getByLabel('Find paid expense')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Link expense', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.links).toHaveLength(1);
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0]).toEqual(state.posts[1]);
});
