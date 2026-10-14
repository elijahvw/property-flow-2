import {test,expect,Page} from '@playwright/test';
async function fixture(page:Page,role='owner'){
 const state={company:'a',propertyStatus:200,units:[] as any[],leases:[] as any[],residents:[{userId:'r',membership:{user:{name:'Resident',email:'r@test.invalid'}}}],loseUnit:false,loseLease:false,keys:[] as string[],writes:0};
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,json=(value:unknown,status=200)=>route.fulfill({json:value,status});
  const property={id:'home',name:'Home',address:'1 Main St',city:'City',state:'PA',zip:'19100'};
  if(path==='/api/bootstrap')return json({user:{id:role,email:`${role}@test.invalid`,status:'active'},membership:{companyId:state.company,version:1,role,status:'active',company:{name:state.company,status:'active'}},permissions:role==='owner'||role==='manager'?['property.read','property.write','lease.manage','resident.assignment.manage']:role==='staff'?['property.read']:role==='resident'?['resident.self']:['platform.manage'],csrfToken:'fixture'});
  if(path==='/api/company/properties')return json([property]);
  if(path==='/api/company/properties/home')return state.propertyStatus===200?json(property):json({error:'Property unavailable'},state.propertyStatus);
  if(path.endsWith('/residents'))return json(state.residents);
  if(req.method()!=='GET'){
   expect(req.headers()['x-csrf-token']).toBe('fixture');state.writes++;
   const data=req.postDataJSON();
   if(req.method()==='POST'){
    state.keys.push(data.submissionKey);
    const isUnit=path.endsWith('/units'),rows=isUnit?state.units:state.leases;
    let row=rows.find(r=>r.submissionKey===data.submissionKey);
    if(!row){row=isUnit?{id:`u${rows.length+1}`,propertyId:'home',label:data.label,status:'active',version:1,submissionKey:data.submissionKey}:{id:`l${rows.length+1}`,...data,startsOn:data.startsOn+'T00:00:00Z',endsOn:data.endsOn?data.endsOn+'T00:00:00Z':null,rentCents:Math.round(Number(data.monthlyRent)*100),currency:'USD',version:1,unit:{label:state.units.find(r=>r.id===data.unitId)?.label},property:{name:'Home'},resident:{name:'Resident',email:'r@test.invalid'}};rows.push(row);}
    if(isUnit&&state.loseUnit){state.loseUnit=false;return route.abort('failed');}
    if(!isUnit&&state.loseLease){state.loseLease=false;return route.abort('failed');}
    return json(row);
   }
   const rows=path.includes('/units/')?state.units:state.leases,row=rows.find(r=>path.endsWith('/'+r.id));
   if(data.expectedVersion!==row.version)return json({error:'This record changed. Reload the list before editing again.'},409);
   Object.assign(row,data,{version:row.version+1});return json(row);
  }
  if(path.endsWith('/units')||path==='/api/company/leases'){
   const rows=path.endsWith('/units')?state.units:state.leases,cursor=url.searchParams.get('cursor');
   const selected=rows.filter(r=>!cursor||r.id<cursor).sort((a,b)=>b.id.localeCompare(a.id));
   return json({items:selected.slice(0,50),nextCursor:selected.length>50?selected[49].id:null});
  }
  return json([]);
 });return state;
}
test('unit creation survives response loss, shows success and explicit new-record reset',async({page})=>{
 const state=await fixture(page);state.loseUnit=true;
 await page.goto('/company/properties/home/units');await page.getByLabel('Unit name',{exact:true}).fill('Apartment 1');await page.getByRole('button',{name:'Create unit',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
 await page.getByRole('button',{name:'Create unit',exact:true}).click();await expect(page.getByText('Saved.',{exact:true})).toBeVisible();expect(state.units.length).toBe(1);expect(state.keys[0]).toBe(state.keys[1]);
 await page.getByRole('button',{name:'Start a new unit'}).click();await expect(page.getByLabel('Unit name',{exact:true})).toHaveValue('');await page.getByLabel('Unit name',{exact:true}).fill('Apartment 2');await page.getByRole('button',{name:'Create unit',exact:true}).click();await expect(page.getByRole('heading',{name:'Apartment 2',exact:true})).toBeVisible();expect(state.keys[2]).not.toBe(state.keys[0]);
});
test('lease creation retries same key and records exact monthly rent',async({page})=>{
 const state=await fixture(page,'manager');state.units.push({id:'u1',label:'Unit 1',propertyId:'home',status:'active',version:1});state.loseLease=true;
 await page.goto('/company/leases');await page.getByLabel('Property for new lease').selectOption('home');await page.getByLabel('New lease start date').fill('2026-11-01');await page.getByLabel('New lease monthly rent (USD)').fill('1234.56');
 await page.getByRole('button',{name:'Create lease record'}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Create lease record'}).click();await expect(page.getByText('Saved.',{exact:true})).toBeVisible();expect(state.leases.length).toBe(1);expect(state.leases[0].rentCents).toBe(123456);expect(state.keys[0]).toBe(state.keys[1]);
 await expect(page.getByText(/1234\.56|1,234\.56/)).toBeVisible();await page.getByRole('button',{name:'Start a new lease'}).click();await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('');
});
test('stale unit edit requires list reload before retry with refreshed version',async({page})=>{
 const state=await fixture(page);state.units.push({id:'u1',label:'Unit 1',propertyId:'home',status:'active',version:1});await page.goto('/company/properties/home/units');await page.getByLabel('Name for Unit 1').fill('New name');state.units[0].version=2;
 await page.getByRole('button',{name:'Save unit Unit 1'}).click();await expect(page.getByRole('alert').first()).toContainText('Reload the list');await Promise.all([page.waitForResponse(r=>r.url().includes('/properties/home/units')&&r.request().method()==='GET'),page.getByRole('button',{name:'Reload units'}).click()]);await expect(page.getByLabel('Name for Unit 1')).toHaveValue('Unit 1');await page.getByLabel('Name for Unit 1').fill('New name');await page.getByRole('button',{name:'Save unit Unit 1'}).click();await expect(page.getByRole('heading',{name:'New name',exact:true})).toBeVisible();expect(state.units[0].version).toBe(3);
});
test('staff unit access is read-only and lease page is blocked; resident/platform units denied',async({page})=>{
 await fixture(page,'staff');await page.goto('/company/properties/home/units');await expect(page.getByText('You have read-only unit access.')).toBeVisible();await expect(page.getByRole('button',{name:'Create unit'})).toHaveCount(0);await page.goto('/company/leases');await expect(page.getByRole('heading',{name:'Access unavailable'})).toBeVisible();
 for(const role of ['resident','platform']){await page.unroute('**/api/**');await fixture(page,role);await page.goto('/company/properties/home/units');await expect(page.getByRole('heading',{name:'Access unavailable'})).toBeVisible();}
});
test('units pagination and lease assignment prerequisite remain truthful',async({page})=>{
 const state=await fixture(page);for(let i=1;i<=51;i++)state.units.push({id:'u'+String(i).padStart(3,'0'),label:'Unit '+i,propertyId:'home',status:'active',version:1});await page.goto('/company/properties/home/units');await expect(page.getByText('50 units on this page')).toBeVisible();await page.getByRole('button',{name:'Next page'}).click();await expect(page.getByText('1 units on this page')).toBeVisible();await page.getByRole('button',{name:'First page'}).click();await expect(page.getByText('50 units on this page')).toBeVisible();
 state.residents=[];await page.goto('/company/leases');await page.getByLabel('Property for new lease').selectOption('home');await expect(page.getByText(/An active unit and an accepted resident/)).toBeVisible();await expect(page.getByRole('button',{name:'Create lease record'})).toHaveCount(0);
});
test('company change clears unit drafts and inaccessible property never exposes creation',async({page})=>{
 const state=await fixture(page);await page.goto('/company/properties/home/units');await page.getByLabel('Unit name',{exact:true}).fill('Old company draft');state.company='b';state.propertyStatus=404;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByText('Property unavailable')).toBeVisible();await expect(page.getByRole('button',{name:'Create unit'})).toHaveCount(0);await expect(page.getByLabel('Unit name',{exact:true})).toHaveCount(0);
});

test('unit-picker pagination preserves an ambiguous committed lease draft and retry key',async({page})=>{
 const state=await fixture(page);for(let i=1;i<=51;i++)state.units.push({id:'u'+String(i).padStart(3,'0'),label:'Unit '+i,propertyId:'home',status:'active',version:1});state.loseLease=true;
 await page.goto('/company/leases');await page.getByLabel('Property for new lease').selectOption('home');await page.getByLabel('New lease start date').fill('2026-11-01');await page.getByLabel('New lease monthly rent (USD)').fill('1500.00');
 await page.getByRole('button',{name:'Create lease record'}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Next page'}).click();await expect(page.getByRole('button',{name:'First page'})).toBeVisible();
 await expect(page.getByLabel('New lease start date')).toHaveValue('2026-11-01');await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('1500.00');await expect(page.getByLabel('Unit for new lease')).toHaveValue('u051');
 await page.getByRole('button',{name:'First page'}).click();await expect(page.getByRole('button',{name:'Next page'})).toBeVisible();await page.getByRole('button',{name:'Create lease record'}).click();await expect(page.getByText('Saved.',{exact:true})).toBeVisible();expect(state.leases.length).toBe(1);expect(state.keys[0]).toBe(state.keys[1]);
});
