import { test, expect, Page } from '@playwright/test';

// Isolated browser UI contracts: mocked same-origin JSON, no real authentication,
// database, Auth0, or deployment. Server authorization is covered separately.
const grants = {
  owner: ['property.read', 'property.write', 'company.manage', 'members.manage', 'resident.assignment.manage','lease.manage','maintenance.manage'],
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
  let tenant:any;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({status, json: value});
    if (path === '/api/bootstrap') return json(auth || {error:'Unauthorized'}, auth ? 200 : 401);
    if (path === '/api/company/properties') {
      if (route.request().method() === 'POST') { records.properties.push({id:'property-a', ...route.request().postDataJSON()}); return json(records.properties[0]); }
      return records.propertyFail ? json({error:'Property fixture unavailable'}, 503) : json(records.properties);
    }
    if(path==='/api/company/resident-contacts'&&route.request().method()==='POST'){tenant={id:'contact-a',...route.request().postDataJSON(),version:1,userId:null,status:'active',leases:[]};return json(tenant);}
    if(path==='/api/company/resident-contacts/contact-a')return json(tenant);
    if(path==='/api/company/resident-contacts/contact-a/invitations'){records.invitationPosts.push(route.request().postDataJSON());records.invitations.push({id:'contact-invite',companyId:'company-a',email:tenant.email,role:'resident',expiresAt:'2099-01-01',acceptedAt:null,revokedAt:null});return json({acceptanceUrl:'https://example.test/invite?contact=1#fixture',expiresAt:'2099-01-01'});}
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

test('first-property guidance disappears after a property is recorded; invitations stay optional',async({page})=>{
 const records=await fixture(page);await page.goto('/dashboard');
 await expect(page).toHaveURL(/\/company\/properties$/);
 await page.getByRole('button',{name:'Add your first property',exact:true}).click();
 for(const [label,value] of [['Property name','First home'],['Street address','1 Main'],['City','Test'],['State / region','CA'],['Postal code','12345']])await page.getByLabel(label,{exact:true}).fill(value);
 await page.getByRole('button',{name:'Create property',exact:true}).click();
 await expect(page.getByRole('link',{name:'First home',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Start with the place you manage'})).toHaveCount(0);
 await expect(page.getByText('1 property',{exact:true})).toBeVisible();
 expect(records.invitationRequests).toBe(0);
});
test('an established property directory has no completed onboarding or invitation prerequisite',async({page})=>{
 const records=await fixture(page);records.properties=[{id:'home',name:'Maple House',address:'14 Maple Lane',city:'Philadelphia',state:'PA',zip:'19106'}];
 await page.route('**/api/company/property-directory',route=>route.fulfill({json:{today:'2026-10-16',items:[{id:'home',activeUnits:4,occupiedUnits:3,draftLeases:1,openMaintenance:2}]}}));
 await page.goto('/company/properties');await expect(page.getByRole('heading',{name:'Get started with your company'})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'Maple House',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'4 active'})).toBeVisible();await expect(page.getByRole('link',{name:'2 open'})).toBeVisible();
 await expect(page.locator('.postal-address')).toHaveText('14 Maple LanePhiladelphia, PA 19106');
 await page.getByLabel('Find property').fill('19106');await expect(page.getByRole('link',{name:'Maple House',exact:true})).toBeVisible();
 await page.getByLabel('Find property').fill('No match');await expect(page.getByRole('heading',{name:'No matching properties'})).toBeVisible();
 expect(records.invitationRequests).toBe(0);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Clear filters'}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});
test('failed property load shows an error without claiming setup is missing',async({page})=>{
 const records=await fixture(page);records.propertyFail=true;await page.goto('/company/properties');
 await expect(page.getByRole('alert').filter({hasText:'Property fixture unavailable'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Add your first property',exact:true})).toHaveCount(0);
 records.propertyFail=false;await page.getByRole('button',{name:'Try again',exact:true}).click();
 await expect(page.getByRole('button',{name:'Add your first property',exact:true})).toBeVisible();expect(records.invitationRequests).toBe(0);
});
for(const role of ['manager','staff','resident',null])test(`${role||'unassigned'} cannot mount owner setup or invitation queries`,async({page})=>{
 const records=await fixture(page,bootstrap(role));await page.goto('/dashboard');
 await expect(page.getByRole('heading',{name:'Start with the place you manage'})).toHaveCount(0);expect(records.invitationRequests).toBe(0);
 if(role==='staff')await expect(page.getByRole('button',{name:'Add property',exact:true})).toHaveCount(0);
});
test('company refresh replaces established property records with the new company empty state',async({page})=>{
 const auth=bootstrap(),records=await fixture(page,auth);records.properties=[{id:'old-home',name:'Old property'}];
 await page.goto('/company/properties');await expect(page.getByRole('link',{name:'Old property',exact:true})).toBeVisible();
 auth.membership!.companyId='company-b';auth.membership!.company={id:'company-b',name:'Second company',status:'active'};records.properties=[];
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('button',{name:'Add your first property',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Old property',exact:true})).toHaveCount(0);expect(records.invitationRequests).toBe(0);
});
test('dual platform/company owner can still create a tenant and optional invitation from Tenants',async({page})=>{
 const records=await fixture(page,bootstrap('owner','active',true));await page.goto('/company/residents');
 await page.getByRole('button',{name:'Invite tenant',exact:true}).click();await page.getByLabel('Full name *',{exact:true}).fill('New Resident');await page.getByLabel('Contact email',{exact:true}).fill('resident@example.test');
 await page.getByRole('button',{name:'Review tenant',exact:true}).click();await page.getByRole('button',{name:'Save tenant',exact:true}).click();await page.getByRole('checkbox',{name:/I approve this person/}).check();await page.getByRole('button',{name:'Create invitation link',exact:true}).click();
 await expect(page.getByLabel('Private invitation link')).toBeVisible();expect(records.invitationPosts).toEqual([{expectedVersion:1,approvals:[],submissionKey:expect.any(String)}]);
});
