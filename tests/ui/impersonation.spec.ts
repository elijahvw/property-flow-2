import { test, expect, BrowserContext, type Page } from '@playwright/test';

const company = { id: 'fictional-company', name: 'Fictional company', status: 'active' };
const target = { id: 'fictional-staff', name: 'Fictional staff', email: 'staff@test.invalid', membership: { companyId: company.id, role: 'staff', company } };
const expiresAt = '2099-01-01T12:30:00.000Z';
async function setup(context: BrowserContext, platformRole: string | null = 'owner') {
  const actor = { id: 'fictional-support', name: 'Fictional support', email: 'support@test.invalid', platformRole, status: 'active', emailVerified: true };
  const state = { acting: false, starts: [] as any[], stops: 0, support: [] as any[], guideRequests: 0, failStop: false, contextHeaders: [] as string[], queries: [] as URLSearchParams[], targets: [target] as any[], selected: target as any };
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    state.contextHeaders.push(request.headers()['x-impersonation-id'] || '');
    if (path === '/api/bootstrap') return json(state.acting ? {
      user: { ...state.selected, emailVerified: state.selected.emailVerified ?? true, platformRole: state.selected.platformRole ?? null, status: state.selected.status ?? 'active' }, membership: state.selected.membership ? { ...state.selected.membership, status: 'active', version: 1 } : null, permissions: state.selected.platformRole === 'owner' ? ['platform.manage','platform.impersonate'] : state.selected.membership ? ['property.read'] : [], csrfToken: 'fixture', destination: state.selected.platformRole === 'owner' ? '/platform/companies' : state.selected.membership ? '/company/properties' : '/access',
      impersonation: { actor, expiresAt, readOnly: true, contextId: `${state.selected.id}:${expiresAt}` },
    } : { user: actor, membership: null, permissions: platformRole === 'owner' ? ['platform.manage', 'platform.impersonate'] : platformRole === 'support' ? ['platform.impersonate'] : ['property.read'], csrfToken: 'fixture', destination: '/platform/impersonation', impersonation: null });
    if (path === '/api/account/guide') { state.guideRequests++; return json({ eligible: false, steps: [] }); }
    if (path === '/api/impersonation/users') {
      state.queries.push(url.searchParams);
      return json({ items: state.targets, nextCursor: url.searchParams.has('cursor') ? null : 'fixture-cursor' });
    }
    if (path === '/api/impersonation' && request.method() === 'POST') { state.starts.push(request.postDataJSON()); state.selected = state.targets.find(p=>p.id===request.postDataJSON().userId); state.acting = true; return json({ destination: state.selected.platformRole === 'owner' ? '/platform/companies' : state.selected.membership ? '/company/properties' : '/access' }); }
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

async function privateReplyFixture(page: Page, context: BrowserContext) {
  const state = { changed: false, posts: [] as unknown[], holdBootstrap: false, held: false, release: undefined as (() => void) | undefined };
  const original = { id: 'private-requester', name: 'Private requester', email: 'requester@test.invalid', status: 'active', emailVerified: true, platformRole: null };
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === '/api/bootstrap') {
      const result = state.changed ? { user: { ...original, id: 'other-support', platformRole: 'support' }, membership: null, permissions: ['platform.impersonate'], csrfToken: 'new-context', destination: '/platform/impersonation' }
        : { user: original, membership: { companyId: company.id, role: 'resident', status: 'active', version: 1, company }, permissions: ['resident.self'], csrfToken: 'old-context', destination: '/resident/maintenance', companyFeatures: { maintenance: 'enabled', resident_portal: 'enabled' } };
      if (state.holdBootstrap) { state.holdBootstrap = false; state.held = true; await new Promise<void>(resolve => { state.release = resolve; }); }
      return json(result);
    }
    if (path === '/api/account/guide') return json({ eligible: false, steps: [] });
    if (path === '/api/resident/maintenance/private-request/updates') {
      if (request.method() === 'POST') { state.posts.push(request.postDataJSON()); return json({ code: 'TEMPORARY_FAILURE', error: 'The original reply response was interrupted.' }, 503); }
      return json({ items: [], nextCursor: null });
    }
    if (path === '/api/resident/maintenance/private-request') return json({ id: 'private-request', propertyId: 'private-property', unitId: null, unit: null, title: 'Private context request', description: 'Private request details from the former account.', category: 'plumbing', priority: 'normal', status: 'resolved', version: 3, targetOn: null, createdAt: '2026-10-24T12:00:00Z', updatedAt: '2026-10-24T13:00:00Z', property: { name: 'Private property' }, historyLimited: false, activity: [] });
    return json([]);
  });
  await page.goto('/resident/maintenance/private-request');
  await page.getByRole('button', { name: 'Add reply', exact: true }).click();
  await page.getByLabel('Reply text', { exact: true }).fill('Private attempted reply from the former account.');
  await page.getByRole('button', { name: 'Post reply', exact: true }).click();
  await expect(page.getByText('The original reply response was interrupted.', { exact: true })).toBeVisible();
  const storageKey = `pf-maintenance-reply:private-requester:${company.id}:/api/resident/maintenance/private-request`;
  const journal = await page.evaluate(key => sessionStorage.getItem(key), storageKey);
  expect(journal).toBeTruthy();
  // An independent native unload handler can still veto a forced navigation.
  // Capture the DOM at that boundary to prove hiding precedes navigation.
  await page.evaluate(key => {
    window.addEventListener('beforeunload', event => {
      sessionStorage.setItem('context-unload-proof', JSON.stringify({ privateVisible: document.body.textContent?.includes('Private context request'), replyVisible: !!document.querySelector('textarea[aria-label="Reply text"]'), journal: sessionStorage.getItem(key) }));
      event.preventDefault(); event.returnValue = '';
    });
  }, storageKey);
  return { state, storageKey, journal };
}

test('an observed account change hides an uncertain private editor before a cancelled navigation', async ({ page, context }) => {
  const { state, storageKey, journal } = await privateReplyFixture(page, context);
  state.changed = true;
  const stopped = page.waitForEvent('dialog');
  const refresh = page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const dialog = await stopped; expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss(); await refresh;
  await expect(page.getByRole('heading', { name: 'Private context request', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Reply text', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Your account or support session changed' })).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).toBe(journal);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('context-unload-proof')!))).toEqual({ privateVisible: false, replyVisible: false, journal });
  expect(state.posts).toHaveLength(1);
});

test('a cross-tab support change hides private work before cancelled reload and rejects an older bootstrap', async ({ page, context }) => {
  const { state, storageKey, journal } = await privateReplyFixture(page, context);
  const other = await context.newPage(); await other.goto('/help');
  await expect(other.getByRole('heading', { name: 'Help Center', exact: true })).toBeVisible();
  state.holdBootstrap = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => state.held).toBe(true);
  state.changed = true;
  const stopped = page.waitForEvent('dialog');
  await other.evaluate(() => { const channel = new BroadcastChannel('property-flow-support-session'); channel.postMessage({ source: 'other-support-tab' }); channel.close(); });
  const dialog = await stopped; expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss();
  const stale = page.waitForResponse(response => new URL(response.url()).pathname === '/api/bootstrap');
  state.release?.(); await stale;
  await expect(page.getByRole('heading', { name: 'Private context request', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Reply text', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'Your account or support session changed' })).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).toBe(journal);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('context-unload-proof')!))).toEqual({ privateVisible: false, replyVisible: false, journal });
  expect(state.posts).toHaveLength(1);
  await other.close();
});


test('platform owner target directory shows platform and no-company accounts without enabling nested support actions', async ({page,context})=>{
 const state=await setup(context);
 state.targets=[{id:'unassigned',name:'Unassigned account',email:'unassigned@test.invalid',status:'disabled',emailVerified:false,platformRole:null,membership:null},{id:'second-owner',name:'Other platform owner',email:'owner@test.invalid',status:'active',emailVerified:true,platformRole:'owner',membership:null}];
 await page.goto('/platform/impersonation');
 await expect(page.getByText('Platform owners can inspect any recorded account',{exact:false})).toBeVisible();
 const unassigned=page.getByRole('row').filter({hasText:'Unassigned account'});await expect(unassigned).toContainText('Disabled account');await expect(unassigned).toContainText('No company assigned');await expect(unassigned).toContainText('Email not verified');
 await page.getByRole('button',{name:'View as Other platform owner',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Start impersonation',exact:true});await expect(dialog).toContainText('Platform owner');
 await dialog.getByLabel('Support case or testing reason',{exact:true}).fill('Inspect recorded platform role');await dialog.getByRole('button',{name:'Start read-only session',exact:true}).click();
 await expect(page).toHaveURL(/platform\/companies$/);await expect(page.getByRole('region',{name:'Impersonation session'})).toContainText('Platform owner');
 await page.goto('/platform/impersonation');
 await expect(page.getByRole('button',{name:'View as Unassigned account',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Grant support access for Fictional colleague',exact:true})).toBeDisabled();
 expect(state.starts).toHaveLength(1);expect(state.support).toHaveLength(0);
});

test('company ownership alone exposes no platform support or impersonation controls',async({page,context})=>{
 let platformRequests=0;
 await context.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/bootstrap')return route.fulfill({json:{user:{id:'company-owner',email:'company-owner@test.invalid',name:'Company owner',status:'active',emailVerified:true,platformRole:null},membership:{companyId:company.id,role:'owner',status:'active',version:1,company},permissions:['property.read','company.manage','members.manage'],csrfToken:'fixture',destination:'/company/overview'}});
  if(path.startsWith('/api/impersonation')||path.startsWith('/api/platform/support-access'))platformRequests++;
  return route.fulfill({json:[]});
 });
 await page.goto('/platform/impersonation');await expect(page.getByText('Your account does not currently have access to this page.')).toBeVisible();
 await expect(page.getByRole('heading',{name:'Support access',exact:true})).toHaveCount(0);expect(platformRequests).toBe(0);
 await expect(page.getByRole('link',{name:'Impersonation',exact:true})).toHaveCount(0);
});

test('a linked separate support grant review retains the exact target filter',async({page,context})=>{
 await setup(context);const queries:string[]=[];
 await context.route('**/api/platform/support-access?**',route=>{queries.push(new URL(route.request().url()).searchParams.get('userId')||'');return route.fulfill({json:{items:[{id:'linked-support',name:'Linked support user',email:'linked@test.invalid',status:'active',emailVerified:true,platformRole:'support',hasIdentity:true,updatedAt:'2026-10-24T12:00:00.000Z'}],nextCursor:null}});});
 await page.goto('/platform/impersonation?supportUserId=linked-support');
 await expect(page.getByText('Reviewing the linked account’s separate platform support grant.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Revoke support access for Linked support user',exact:true})).toBeVisible();expect(queries).toContain('linked-support');
 await page.getByRole('button',{name:'Show all support accounts',exact:true}).click();await expect(page).not.toHaveURL(/supportUserId=/);await expect.poll(()=>queries.at(-1)).toBe('');
});
