import {test, expect, Page} from '@playwright/test';
async function fixture(page: Page, role='manager') {
 const state={assigned:false,fail:false,loads:0};
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname, method=route.request().method();
  const json=(value:unknown,status=200)=>route.fulfill({json:value,status});
  if(path==='/api/bootstrap') return json({user:{id:'u',email:'u@test.invalid',name:'Test',emailVerified:true,status:'active',platformRole:null},membership:{companyId:'a',version:1,role,status:'active',company:{id:'a',name:'Company',status:'active'}},permissions:role==='resident'?['resident.self']:role==='staff'?['property.read']:['property.read','property.write','resident.assignment.manage'],destination:role==='resident'?'/resident':'/company/properties',csrfToken:'fixture'});
  if(path==='/api/company/properties')return json([{id:'home',name:'Home',address:'1 Main',city:'City',state:'CA',zip:'12345'}]);
  if(path==='/api/company/residents')return json([{userId:'resident',user:{name:'Accepted Resident',email:'resident@test.invalid'}}]);
  if(path.endsWith('/residents/resident')) { expect(route.request().headers()['x-csrf-token']).toBe('fixture'); if(state.fail)return json({error:'Access changed. Refresh and try again.'},409); state.assigned=method==='PUT';return json({success:true}); }
  if(path.endsWith('/residents')){state.loads++;return json(state.assigned?[{userId:'resident',membership:{user:{name:'Accepted Resident',email:'resident@test.invalid'}}}]:[]);}
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
test('resident shows own property cards, empty state, and recoverable failure',async({page})=>{
 const state=await fixture(page,'resident');await page.goto('/resident');await expect(page.getByRole('heading',{name:'No properties assigned'})).toBeVisible();
 state.assigned=true;await page.reload();await expect(page.getByRole('heading',{name:'Home',exact:true})).toBeVisible();await expect(page.getByText('1 Main',{exact:true})).toBeVisible();await expect(page.getByText(/not leases or proof of occupancy/)).toBeVisible();
 state.fail=true;await page.reload();await expect(page.getByRole('alert')).toContainText('Temporarily unavailable');state.fail=false;await page.getByRole('button',{name:'Try again'}).click();await expect(page.getByRole('heading',{name:'Home',exact:true})).toBeVisible();
});
test('assignment controls stay pending until eligible and assigned records load',async({page})=>{
 await fixture(page);let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 await page.route('**/api/company/residents',async route=>{await gate;await route.fulfill({json:[]});});
 await page.goto('/company/properties');await page.getByRole('button',{name:'Manage residents'}).click();await expect(page.getByRole('status').filter({hasText:'Loading records'})).toBeVisible();await expect(page.getByRole('button',{name:'Assign resident',exact:true})).toHaveCount(0);release();await expect(page.getByText('No additional active accepted residents available.')).toBeVisible();
});
