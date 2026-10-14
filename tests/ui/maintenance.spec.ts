import {test,expect,Page} from '@playwright/test';
async function fixture(page:Page,resident=true){
 const state={rows:[] as any[],fail:false,assigned:true};
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;const json=(value:unknown,status=200)=>route.fulfill({json:value,status});
 if(path==='/api/bootstrap')return json({user:{id:'u',email:'u@test.invalid',status:'active',emailVerified:true},membership:{companyId:'a',version:1,role:resident?'resident':'manager',status:'active',company:{name:'Company',status:'active'}},permissions:resident?['resident.self']:['property.read','maintenance.manage'],destination:resident?'/resident/maintenance':'/company/maintenance',csrfToken:'fixture'});
 if(path.endsWith('/properties'))return json(state.assigned?[{id:'home',name:'Home'}]:[]);
 if(route.request().method()!=='GET'){expect(route.request().headers()['x-csrf-token']).toBe('fixture');if(state.fail)return json({error:'Access changed. Try again.'},409);const data=route.request().postDataJSON();if(route.request().method()==='POST')state.rows.push({id:'request',...data,status:'open',property:{name:'Home'}});else state.rows[0].status=data.status;return json(state.rows[0]);}
 if(state.fail)return json({error:'Temporarily unavailable'},503);const status=new URL(route.request().url()).searchParams.get('status');return json(state.rows.filter(r=>!status||r.status===status));
 });return state;
}
test('resident empty, create failure/retry, success and actual counts',async({page})=>{const state=await fixture(page);await page.goto('/resident/maintenance');await expect(page.getByText('No requests match these filters.')).toBeVisible();await page.getByLabel('Title',{exact:true}).fill('Tap leak');await page.getByLabel('Description',{exact:true}).fill('Kitchen tap leaks');state.fail=true;await page.getByRole('button',{name:'Submit request'}).click();await expect(page.getByRole('alert')).toContainText('Access changed');state.fail=false;await page.getByRole('button',{name:'Submit request'}).click();await expect(page.getByRole('heading',{name:'Tap leak'})).toBeVisible();await expect(page.getByText('Saved.',{exact:true})).toBeVisible();await expect(page.getByRole('status').filter({hasText:'1 matching requests'})).toBeVisible();await expect(page.getByRole('button',{name:'Update status'})).toHaveCount(0);});
test('manager updates status, filters and retries load errors',async({page})=>{const state=await fixture(page,false);state.rows.push({id:'request',propertyId:'home',title:'Tap leak',description:'Leaks',priority:'normal',status:'open',property:{name:'Home'}});state.fail=true;await page.goto('/company/maintenance');await expect(page.getByRole('alert')).toContainText('Temporarily unavailable');state.fail=false;await page.getByRole('button',{name:'Try again'}).click();await page.getByLabel('Status for Tap leak').selectOption('resolved');await page.getByRole('button',{name:'Update status'}).click();await expect(page.getByText('Home · normal priority · resolved')).toBeVisible();await page.getByLabel('Filter status').selectOption('open');await expect(page.getByText('No requests match these filters.')).toBeVisible();});
test('unassigned resident cannot submit',async({page})=>{const state=await fixture(page);state.assigned=false;await page.goto('/resident/maintenance');await expect(page.getByText(/No properties assigned/)).toBeVisible();await expect(page.getByRole('button',{name:'Submit request'})).toHaveCount(0);});
test('loading state hides request controls until properties load',async({page})=>{
 await fixture(page);
 let release!:()=>void;
 const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/resident/properties',async route=>{await gate;await route.fulfill({json:[{id:'home',name:'Home'}]});});
 // Hold both independent resources so the two legitimate loaders are deterministic.
 await page.route('**/api/resident/maintenance?*',async route=>{await gate;await route.fulfill({json:[]});});
 try {
  await page.goto('/resident/maintenance');
  const submission=page.locator('section').filter({has:page.getByRole('heading',{name:'Submit a request',exact:true})});
  const requests=page.locator('section').filter({has:page.getByRole('heading',{name:'Requests',exact:true})});
  await expect(submission.getByRole('status')).toHaveText('Loading maintenance…');
  await expect(requests.getByRole('status')).toHaveText('Loading maintenance…');
  await expect(page.getByRole('button',{name:'Submit request'})).toHaveCount(0);
  release();
  await expect(page.getByRole('button',{name:'Submit request'})).toBeVisible();
 } finally { release(); }
});
