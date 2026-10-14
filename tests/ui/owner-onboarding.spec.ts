import { test, expect, Page } from '@playwright/test';

// Isolated browser UI contracts: mocked same-origin JSON, no real authentication,
// database, Auth0, or deployment. Server authorization is covered separately.
const grants = {
  owner: ['property.read', 'property.write', 'company.manage', 'members.manage'],
  manager: ['property.read', 'property.write'], staff: ['property.read'], resident: ['resident.self'],
};
function bootstrap(role: string | null = 'owner', status = 'active', platform = false) {
  const permissions = status === 'active' ? [...(grants[role as keyof typeof grants] || []), ...(platform ? ['platform.manage'] : [])] : [];
  return {
    user: { id: 'owner-a', name: 'Test user', email: 'owner@example.test', emailVerified: true, status, platformRole: platform ? 'owner' : null },
    membership: role ? { companyId: 'company-a', version: 1, role, status: 'active', company: {id: 'company-a', name: 'Test company', status: 'active'} } : null,
    permissions, csrfToken: 'fixture-csrf',
    destination: platform ? '/platform/companies' : permissions.includes('property.read') ? '/company/properties' : permissions.includes('resident.self') ? '/resident' : '/access',
  };
}
async function fixture(page: Page, auth: ReturnType<typeof bootstrap> | null = bootstrap()) {
  const records = { properties: [] as any[], invitations: [] as any[], propertyFail: false, invitationFail: false, invitationRequests: 0, invitationPosts: [] as any[] };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({status, json: value});
    if (path === '/api/bootstrap') return json(auth || {error:'Unauthorized'}, auth ? 200 : 401);
    if (path === '/api/company/properties') {
      if (route.request().method() === 'POST') { records.properties.push({id:'property-a', ...route.request().postDataJSON()}); return json(records.properties[0]); }
      return records.propertyFail ? json({error:'Property fixture unavailable'}, 503) : json(records.properties);
    }
    if (path === '/api/invitations') {
      records.invitationRequests++;
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        records.invitationPosts.push(body);
        // Mirror the existing platform-user requirement; never infer this field
        // in the fixture or the dual-role regression would miss the defect.
        if (auth?.permissions.includes('platform.manage') && body.companyId !== auth.membership?.companyId) return json({error:'Company is required.'}, 400);
        records.invitations.push({id:'invite-a', companyId:'company-a', ...body, expiresAt:'2099-01-01', acceptedAt:null, revokedAt:null});
        return json({acceptanceUrl:'https://example.test/invite#fixture'});
      }
      return records.invitationFail ? json({error:'Invitation fixture unavailable'}, 503) : json(records.invitations);
    }
    if (path === '/api/company/members') return json([]);
    return json([]);
  });
  return records;
}

test('owner landing creates a property and invitation, refreshes Team, and returns to truthful progress', async ({page}) => {
  await fixture(page);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/company\/properties$/);
  await expect(page.getByText('No properties yet', {exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Add your first property'}).click();
  for (const [label, value] of [['Property name','First home'], ['Street address','1 Main'], ['City','Test'], ['State / region','CA'], ['Postal code','12345']]) await page.getByLabel(label, {exact:true}).fill(value);
  await page.getByRole('button', {name:'Create property', exact:true}).click();
  await expect(page.getByText('Property added', {exact:true})).toBeVisible();
  await page.getByRole('link', {name:'Invite a resident in Team'}).click();
  await page.getByRole('button',{name:'Invite a person',exact:true}).click();await page.getByLabel('Email address', {exact:true}).fill('resident@example.test');
  await page.getByRole('button', {name:'Create invitation', exact:true}).click();
  await expect(page.getByText('resident@example.test', {exact:true})).toBeVisible();
  await expect(page.getByText('Pending', {exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('link', {name:'Properties', exact:true}).click();
  await expect(page.getByText('Resident invitation issued', {exact:true})).toBeVisible();
  await expect(page.getByText(/assign accepted residents using Manage residents/)).toBeVisible();
});

test('partial failures do not invent progress and retry recovers independently', async ({page}) => {
  const records = await fixture(page);
  records.propertyFail = true; records.invitationFail = true;
  await page.goto('/company/properties');
  await expect(page.getByText(/Progress could not be checked: Property/)).toBeVisible();
  await expect(page.getByText(/Progress could not be checked: Invitation/)).toBeVisible();
  await expect(page.getByText('Property added', {exact:true})).toHaveCount(0);
  records.propertyFail = false; records.invitationFail = false;
  records.invitations = [{companyId:'company-b', role:'resident'}, {companyId:'company-a', role:'manager'}];
  await page.getByRole('button', {name:'Check progress again'}).click();
  await expect(page.getByText('No properties yet', {exact:true})).toBeVisible();
  await expect(page.getByText('No resident invitation in the available records', {exact:true})).toBeVisible();
});

test('loading remains unknown until the response arrives', async ({page}) => {
  await fixture(page);
  let release!: () => void;
  const wait = new Promise<void>(resolve => release = resolve);
  await page.route('**/api/invitations', async route => { await wait; await route.fulfill({json:[]}); });
  await page.goto('/company/properties');
  await expect(page.getByRole('listitem').filter({hasText:'Issue a resident invitation'}).getByRole('status')).toBeVisible();
  await expect(page.getByText('No resident invitation in the available records', {exact:true})).toHaveCount(0);
  release();
  await expect(page.getByText('No resident invitation in the available records', {exact:true})).toBeVisible();
});

for (const role of ['manager', 'staff', 'resident', null]) {
  test(`${role || 'unassigned'} landing hides owner checklist and invitation fetches`, async ({page}) => {
    const records = await fixture(page, bootstrap(role));
    await page.goto('/dashboard');
    const expected = role === 'resident' ? '/resident' : role ? '/company/properties' : '/access';
    await expect(page).toHaveURL(new RegExp(`${expected}$`));
    await expect(page.getByRole('heading', {name:'Get started with your company'})).toHaveCount(0);
    if (!role) await expect(page.getByText(/Your administrator will create your company/)).toBeVisible();
    expect(records.invitationRequests).toBe(0);
    await page.goto('/company/members');
    await expect(page.getByRole('heading', {name:'Access unavailable'})).toBeVisible();
  });
}

test('anonymous and disabled owners do not get protected contents', async ({page}) => {
  await fixture(page, null);
  await page.goto('/company/properties');
  await expect(page.getByRole('heading', {name:'Sign in to continue'})).toBeVisible();
  await expect(page.getByRole('heading', {name:'Get started with your company'})).toHaveCount(0);
  await page.unrouteAll();
  await fixture(page, bootstrap('owner', 'disabled'));
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/access$/);
  await expect(page.getByRole('heading', {name:'Access is disabled'})).toBeVisible();
});

test('suspended companies, disabled memberships and platform-only authority cannot mount owner progress', async ({page}) => {
  for (const state of ['suspended-company', 'disabled-membership', 'platform-only']) {
    await page.unrouteAll();
    const auth = bootstrap(state === 'platform-only' ? null : 'owner', 'active', state === 'platform-only');
    // Deliberately inconsistent fixture grants prove the owner gate independently
    // checks membership/company status even before bootstrap capabilities refresh.
    auth.permissions = grants.owner;
    if (state === 'suspended-company') auth.membership!.company.status = 'suspended';
    if (state === 'disabled-membership') auth.membership!.status = 'disabled';
    const records = await fixture(page, auth);
    await page.goto('/company/properties');
    await expect(page.getByRole('heading', {name:'Properties', exact:true})).toBeVisible();
    await expect(page.getByRole('heading', {name:'Get started with your company'})).toHaveCount(0);
    expect(records.invitationRequests).toBe(0);
  }
});

test('owner progress follows current company on session refresh and discards old records', async ({page}) => {
  const auth = bootstrap();
  const records = await fixture(page, auth);
  records.properties = [{id:'a', name:'First company property'}];
  records.invitations = [{companyId:'company-a', role:'resident', revokedAt:'2026-01-01'}];
  await page.goto('/company/properties');
  await expect(page.getByText('Resident invitation issued', {exact:true})).toBeVisible();
  auth.membership!.companyId = 'company-b';
  auth.membership!.company = {id:'company-b', name:'Second company', status:'active'};
  records.properties = [];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText(/You are an active owner of Second company/)).toBeVisible();
  await expect(page.getByText('No properties yet', {exact:true})).toBeVisible();
  await expect(page.getByText('No resident invitation in the available records', {exact:true})).toBeVisible();
  await page.setViewportSize({width:390, height:844});
  await expect(page.getByRole('link', {name:'Invite a resident in Team'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const checklist = await page.getByRole('region', {name:'Get started with your company'}).boundingBox();
  expect(checklist).not.toBeNull();
  expect(checklist!.x).toBeGreaterThanOrEqual(0);
  expect(checklist!.x + checklist!.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:'/tmp/propertyflow-owner-onboarding-mobile.png', fullPage:true});
});


test('company owner with platform authority supplies its membership company when inviting', async ({page}) => {
  const records = await fixture(page, bootstrap('owner', 'active', true));
  await page.goto('/company/properties');
  await page.getByRole('link', {name:'Invite a resident in Team'}).click();
  await page.getByRole('button',{name:'Invite a person',exact:true}).click();await page.getByLabel('Email address', {exact:true}).fill('dual-role-resident@example.test');
  await page.getByRole('button', {name:'Create invitation', exact:true}).click();
  await expect(page.getByLabel('Invitation acceptance link')).toBeVisible();
  expect(records.invitationPosts).toEqual([{email:'dual-role-resident@example.test', role:'resident', companyId:'company-a'}]);
  await expect(page.getByText('dual-role-resident@example.test', {exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('link', {name:'Properties', exact:true}).click();
  await expect(page.getByText('Resident invitation issued', {exact:true})).toBeVisible();
});

test('late responses from the previous company cannot replace newly loaded progress', async ({page}) => {
  const auth = bootstrap();
  await fixture(page, auth);
  let release!: () => void;
  let signalOldRequests!: () => void;
  const held = new Promise<void>(resolve => release = resolve);
  const oldRequests = new Promise<void>(resolve => signalOldRequests = resolve);
  let heldCount = 0;
  const deliveries: Promise<void>[] = [];
  let holdOldScope = true;
  for (const path of ['company/properties', 'invitations']) {
    await page.route(`**/api/${path}`, async route => {
      if (!holdOldScope) return route.fulfill({json:[]});
      // Capture old data before the session changes, then release it only after
      // both new-scope resources have completed. These requests are aborted by
      // useResource cleanup; completion must not restore their old progress.
      const oldData = path === 'invitations' ? [{companyId:'company-b', role:'resident'}] : [{id:'old', name:'Old property'}];
      const delivery = (async () => { await held; await route.fulfill({json:oldData}); })();
      deliveries.push(delivery);
      if (++heldCount === 2) signalOldRequests();
      await delivery;
    });
  }
  await page.goto('/company/properties');
  await oldRequests;
  auth.membership!.companyId = 'company-b';
  auth.membership!.company = {id:'company-b', name:'New company', status:'active'};
  holdOldScope = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText(/You are an active owner of New company/)).toBeVisible();
  await expect(page.getByText('No properties yet', {exact:true})).toBeVisible();
  await expect(page.getByText('No resident invitation in the available records', {exact:true})).toBeVisible();
  release();
  await Promise.all(deliveries);
  // Let any response-driven React work settle before checking the newer state.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByText('No properties yet', {exact:true})).toBeVisible();
  await expect(page.getByText('No resident invitation in the available records', {exact:true})).toBeVisible();
  await expect(page.getByText('Property added', {exact:true})).toHaveCount(0);
  await expect(page.getByText('Resident invitation issued', {exact:true})).toHaveCount(0);
});
