import {test, expect, Page} from '@playwright/test';
async function fixture(page: Page, role='manager', residentId='resident') {
 const state={assigned:false,fail:false,loads:0,features:undefined as undefined | Record<string,string>,writes:0};
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname, method=route.request().method();
  const json=(value:unknown,status=200)=>route.fulfill({json:value,status});
  if(path==='/api/bootstrap') return json({user:{id:'u',email:'u@test.invalid',name:'Test',emailVerified:true,status:'active',platformRole:null},membership:{companyId:'a',version:1,role,status:'active',company:{id:'a',name:'Company',status:'active'}},permissions:role==='resident'?['resident.self']:role==='staff'?['property.read']:['property.read','property.write','resident.assignment.manage'],destination:role==='resident'?'/resident':'/company/properties',csrfToken:'fixture',companyFeatures:state.features});
  if(path==='/api/company/properties')return json([{id:'home',name:'Home',address:'1 Main',city:'City',state:'CA',zip:'12345'}]);
  if(path==='/api/company/residents')return json([{userId:residentId,user:{name:'Accepted Resident',email:'resident@test.invalid'}}]);
  if(path.endsWith(`/residents/${encodeURIComponent(residentId)}`)) { state.writes++; expect(route.request().headers()['x-csrf-token']).toBe('fixture'); if(state.fail)return json({error:'Access changed. Refresh and try again.'},409); state.assigned=method==='PUT';return json({success:true}); }
  if(path.endsWith('/residents')){state.loads++;return json(state.assigned?[{userId:residentId,membership:{user:{name:'Accepted Resident',email:'resident@test.invalid'}}}]:[]);}
  if(path==='/api/resident/rent')return json({businessDate:'2026-10-25',accounts:[]});
  if(path==='/api/resident/properties')return state.fail?json({error:'Temporarily unavailable'},503):json(state.assigned?[{id:'home',name:'Home',address:'1 Main'}]:[]);
  return json([]);
 });return state;
}
test('manager assigns accepted resident, reports conflict, retries and removes association',async({page})=>{
 const state=await fixture(page);await page.goto('/company/properties');await page.getByRole('button',{name:'Manage residents'}).click();
 await expect(page.getByText('No residents assigned.',{exact:true})).toBeVisible();await expect(page.getByText(/Pending invitations are not eligible/)).toBeVisible();
 await page.getByLabel('Accepted resident').selectOption('resident');state.fail=true;await page.getByRole('button',{name:'Assign resident',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Access changed');
 state.fail=false;await page.getByRole('button',{name:'Assign resident',exact:true}).click();await expect(page.getByText('Assigned',{exact:true})).toBeVisible();await expect(page.getByText('No additional active accepted residents available.')).toBeVisible();
 await page.getByRole('button',{name:'Remove assignment'}).click();await expect(page.getByText('No residents assigned.',{exact:true})).toBeVisible();expect(state.assigned).toBe(false);
});
test('staff cannot mount assignment UI or load resident directory',async({page})=>{
 const state=await fixture(page,'staff');await page.goto('/company/properties');await expect(page.getByText('Home',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Manage residents'})).toHaveCount(0);expect(state.loads).toBe(0);
});
test('read-only property or leasing settings keep tenant access readable without assignment entry', async ({ page }) => {
  for (const feature of ['properties', 'leasing']) {
    await page.unroute('**/api/**');
    const state = await fixture(page);
    state.features = { properties: 'enabled', leasing: 'enabled', [feature]: 'read_only' };
    await page.goto('/company/properties');
    await expect(page.getByRole('button', { name: 'Manage residents', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'View tenant access', exact: true })).toHaveAttribute('href', '/company/properties/home/residents');
    if (feature === 'properties') await expect(page.getByRole('button', { name: 'Add property', exact: true })).toBeDisabled();
    expect(state.writes).toBe(0);
  }
});
test('an open assignment review keeps its selection and locks writes after a policy-only refresh', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/company/properties');
  await page.getByRole('button', { name: 'Manage residents', exact: true }).click();
  await page.getByLabel('Accepted resident').selectOption('resident');
  state.features = { properties: 'enabled', leasing: 'read_only' };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const editor = page.getByRole('dialog', { name: 'Residents for Home', exact: true });
  await expect(editor.getByText(/Tenant property access is read-only/)).toBeVisible();
  await expect(editor.getByLabel('Accepted resident')).toHaveValue('resident');
  await expect(editor.getByLabel('Accepted resident')).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Assign resident', exact: true })).toBeDisabled();
  expect(state.writes).toBe(0);
  state.features = { properties: 'enabled', leasing: 'enabled' };
  await expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    return editor.getByLabel('Accepted resident').isEnabled();
  }).toBe(true);
  await expect(editor.getByLabel('Accepted resident')).toHaveValue('resident');
  await editor.getByRole('button', { name: 'Assign resident', exact: true }).click();
  await expect(editor.getByText('Assigned', { exact: true })).toBeVisible();
  expect(state.writes).toBe(1);
});
test('resident shows own property cards, empty state, and recoverable failure',async({page})=>{
 const state=await fixture(page,'resident');await page.goto('/resident');await expect(page.getByRole('heading',{name:'No properties assigned'})).toBeVisible();
 state.assigned=true;await page.reload();await expect(page.getByRole('heading',{name:'Home',exact:true})).toBeVisible();await expect(page.getByText('1 Main',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'My rental',exact:true})).toBeVisible();
 const services=page.getByRole('navigation',{name:'Resident services'});
 for (const [name,href] of [['View rent & payments','/resident/rent'],['View security deposit','/resident/deposits'],['Maintenance requests','/resident/maintenance'],['My profile','/account']]) {
  await expect(services.getByRole('link',{name,exact:true})).toHaveAttribute('href',href);
 }
 state.fail=true;await page.reload();await expect(page.getByRole('alert')).toContainText('Temporarily unavailable');state.fail=false;await page.getByRole('button',{name:'Try again'}).click();await expect(page.getByRole('heading',{name:'Home',exact:true})).toBeVisible();
});
test('assignment controls stay pending until eligible and assigned records load',async({page})=>{
 await fixture(page);let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 await page.route('**/api/company/residents',async route=>{await gate;await route.fulfill({json:[]});});
 await page.goto('/company/properties');await page.getByRole('button',{name:'Manage residents'}).click();await expect(page.getByRole('status').filter({hasText:'Loading records'})).toBeVisible();await expect(page.getByRole('button',{name:'Assign resident',exact:true})).toHaveCount(0);release();await expect(page.getByText('No additional active accepted residents available.')).toBeVisible();
});

for (const residentId of ['auth0|abc+def','auth0|'+'x'.repeat(240),'samlp|provider|!@£$%^&*()+}{:;|P9/opaque?#%']) {
 test(`client encodes and round-trips opaque resident ${residentId.slice(0,25)}`,async({page})=>{
  const state=await fixture(page,'manager',residentId);await page.goto('/company/properties');await page.getByRole('button',{name:'Manage residents'}).click();
  await page.getByLabel('Accepted resident').selectOption(residentId);
  const assigned=page.waitForRequest(request=>request.method()==='PUT'&&new URL(request.url()).pathname.endsWith(`/residents/${encodeURIComponent(residentId)}`));
  await page.getByRole('button',{name:'Assign resident',exact:true}).click();await assigned;
  await expect(page.getByText('Assigned',{exact:true})).toBeVisible();
  const removed=page.waitForRequest(request=>request.method()==='DELETE'&&new URL(request.url()).pathname.endsWith(`/residents/${encodeURIComponent(residentId)}`));
  await page.getByRole('button',{name:'Remove assignment'}).click();await removed;await expect(page.getByText('No residents assigned.',{exact:true})).toBeVisible();expect(state.assigned).toBe(false);
 });
}
