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
  if(req.method()==='GET'&&/^\/api\/company\/leases\/[^/]+(?:\/participants)?$/.test(path)){
   const row=state.leases.find(r=>r.id===path.split('/')[4]);
   return path.endsWith('/participants')?json({lease:row,items:[],candidates:[]}):json(row);
  }
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
   const isUnit=path.endsWith('/units'),rows=isUnit?state.units:state.leases,cursor=url.searchParams.get('cursor'),q=(url.searchParams.get('q')||'').trim().toLowerCase(),status=url.searchParams.get('status'),unitId=url.searchParams.get('unitId');
   const selected=rows.filter(r=>(!cursor||r.id<cursor)&&(!status||r.status===status)&&(!unitId||r.unitId===unitId)&&(!q||[r.label,r.floor,r.unit?.label,r.resident?.name].some(v=>v?.toLowerCase().includes(q)))).sort((a,b)=>b.id.localeCompare(a.id));
   return json({items:selected.slice(0,50),nextCursor:selected.length>50?selected[49].id:null,...(unitId?{unit:state.units.find(r=>r.id===unitId)}:{})});
  }
  return json([]);
 });return state;
}
test('unit creation survives response loss, shows success and explicit new-record reset',async({page})=>{
 const state=await fixture(page);state.loseUnit=true;
 await page.goto('/company/properties/home/units');await page.getByRole('button',{name:'Add a unit',exact:true}).click();await page.getByLabel('Unit name',{exact:true}).fill('Apartment 1');await page.getByRole('button',{name:'Create unit',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
 await page.getByRole('button',{name:'Create unit',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();expect(state.units.length).toBe(1);expect(state.keys[0]).toBe(state.keys[1]);
 await page.getByRole('button',{name:'Add a unit',exact:true}).click();await expect(page.getByLabel('Unit name',{exact:true})).toHaveValue('');await page.getByLabel('Unit name',{exact:true}).fill('Apartment 2');await page.getByRole('button',{name:'Create unit',exact:true}).click();await expect(page.getByRole('heading',{name:'Apartment 2',exact:true})).toBeVisible();expect(state.keys[2]).not.toBe(state.keys[0]);
});
test('lease setup selects the only property and opens its choices without a redundant step',async({page})=>{
 const state=await fixture(page);state.units.push({id:'u1',label:'Available suite',propertyId:'home',status:'active',version:1});
 await page.goto('/company/leases');await page.getByRole('button',{name:'Record a lease',exact:true}).click();
 await expect(page.getByLabel('Property for new lease')).toHaveValue('home');
 await expect(page.getByLabel('Unit for new lease')).toBeVisible();
 await expect(page.getByText('Each tenant has one sign-in account.', {exact:false})).toBeVisible();
 expect(state.keys).toHaveLength(0);
});
test('unit search keeps typing responsive and batches the API query',async({page})=>{
 const state=await fixture(page);state.units.push({id:'u1',label:'Garden studio',propertyId:'home',status:'active',version:1});
 const queries:string[]=[];page.on('request',request=>{const url=new URL(request.url());if(url.pathname.endsWith('/units')&&url.searchParams.get('q'))queries.push(url.searchParams.get('q')!);});
 await page.goto('/company/properties/home/units');await expect(page.getByRole('heading',{name:'Garden studio',exact:true})).toBeVisible();
 await page.getByLabel('Find unit',{exact:true}).pressSequentially('Garden',{delay:5});
 await expect(page.getByLabel('Find unit',{exact:true})).toHaveValue('Garden');
 await expect.poll(()=>queries.at(-1)).toBe('Garden');expect(queries).toHaveLength(1);
 await page.reload();await expect(page.getByLabel('Find unit',{exact:true})).toHaveValue('Garden');
});
test('lease creation retries same key and records exact monthly rent',async({page})=>{
 const state=await fixture(page,'manager');state.units.push({id:'u1',label:'Unit 1',propertyId:'home',status:'active',version:1});state.loseLease=true;
 await page.goto('/company/leases');await page.getByRole('button',{name:'Record a lease',exact:true}).click();await page.getByLabel('Property for new lease').selectOption('home');await page.getByLabel('New lease start date').fill('2026-11-01');await page.getByLabel('New lease monthly rent (USD)').fill('1234.56');
 await page.getByRole('button',{name:'Review lease',exact:true}).click();await page.getByRole('button',{name:'Create lease record'}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Create lease record'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();expect(state.leases.length).toBe(1);expect(state.leases[0].rentCents).toBe(123456);expect(state.keys[0]).toBe(state.keys[1]);
 await expect(page).toHaveURL(/\/company\/leases\/l1\?onboarding=household/);await expect(page.getByRole('heading',{name:'Leaseholders and occupants',exact:true})).toBeVisible();await page.getByRole('link',{name:'← All leases',exact:true}).click();await expect(page.getByText(/1234\.56|1,234\.56/)).toBeVisible();await page.getByRole('button',{name:'Record a lease',exact:true}).click();await page.getByLabel('Property for new lease').selectOption('home');await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('');
});
test('stale unit edit requires list reload before retry with refreshed version',async({page})=>{
 const state=await fixture(page);state.units.push({id:'u1',label:'Unit 1',propertyId:'home',status:'active',version:1});await page.goto('/company/properties/home/units');await page.getByRole('button',{name:'Edit unit'}).click();await page.getByLabel('Name for Unit 1').fill('New name');state.units[0].version=2;
 await page.getByRole('button',{name:'Save unit Unit 1'}).click();await expect(page.getByRole('alert').first()).toContainText('Reload the list');await Promise.all([page.waitForResponse(r=>r.url().includes('/properties/home/units')&&r.request().method()==='GET'),(async()=>{await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Close without saving',exact:true}).click();})()]);await page.getByRole('button',{name:'Edit unit'}).click();await expect(page.getByLabel('Name for Unit 1')).toHaveValue('Unit 1');await page.getByLabel('Name for Unit 1').fill('New name');await page.getByRole('button',{name:'Save unit Unit 1'}).click();await expect(page.getByRole('heading',{name:'New name',exact:true})).toBeVisible();expect(state.units[0].version).toBe(3);
});
test('staff unit access is read-only and lease page is blocked; resident/platform units denied',async({page})=>{
 await fixture(page,'staff');await page.goto('/company/properties/home/units');await expect(page.getByText('You have read-only unit access.')).toBeVisible();await expect(page.getByRole('button',{name:'Create unit'})).toHaveCount(0);await page.goto('/company/leases');await expect(page.getByRole('heading',{name:'Access unavailable'})).toBeVisible();
 for(const role of ['resident','platform']){await page.unroute('**/api/**');await fixture(page,role);await page.goto('/company/properties/home/units');await expect(page.getByRole('heading',{name:'Access unavailable'})).toBeVisible();}
});
test('units pagination and lease assignment prerequisite remain truthful',async({page})=>{
 const state=await fixture(page);for(let i=1;i<=51;i++)state.units.push({id:'u'+String(i).padStart(3,'0'),label:'Unit '+i,propertyId:'home',status:'active',version:1});await page.goto('/company/properties/home/units');await expect(page.getByText('50 units on this page')).toBeVisible();await page.getByRole('button',{name:'Next page'}).click();await expect(page.getByText('1 unit on this page')).toBeVisible();await page.getByRole('button',{name:'First page'}).click();await expect(page.getByText('50 units on this page')).toBeVisible();
 state.residents=[];await page.goto('/company/leases');await page.getByRole('button',{name:'Record a lease',exact:true}).click();await page.getByLabel('Property for new lease').selectOption('home');await expect(page.getByText(/Choose an active unit, then add a tenant/)).toBeVisible();await expect(page.getByRole('button',{name:'Create lease record'})).toHaveCount(0);
});
test('company change clears unit drafts and inaccessible property never exposes creation',async({page})=>{
 const state=await fixture(page);await page.goto('/company/properties/home/units');await page.getByRole('button',{name:'Add a unit',exact:true}).click();await page.getByLabel('Unit name',{exact:true}).fill('Old company draft');state.company='b';state.propertyStatus=404;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByText('Property unavailable')).toBeVisible();await expect(page.getByRole('button',{name:'Create unit'})).toHaveCount(0);await expect(page.getByLabel('Unit name',{exact:true})).toHaveCount(0);
});

test('unit-picker pagination preserves an ambiguous committed lease draft and retry key',async({page})=>{
 const state=await fixture(page);for(let i=1;i<=51;i++)state.units.push({id:'u'+String(i).padStart(3,'0'),label:'Unit '+i,propertyId:'home',status:'active',version:1});state.loseLease=true;
 await page.goto('/company/leases');await page.getByRole('button',{name:'Record a lease',exact:true}).click();await page.getByLabel('Property for new lease').selectOption('home');await page.getByLabel('New lease start date').fill('2026-11-01');await page.getByLabel('New lease monthly rent (USD)').fill('1500.00');
 await page.getByRole('button',{name:'Review lease',exact:true}).click();await page.getByRole('button',{name:'Create lease record'}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Next page'}).click();await expect(page.getByRole('button',{name:'First page'})).toBeVisible();
 await expect(page.getByLabel('New lease start date')).toHaveValue('2026-11-01');await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('1500.00');await expect(page.getByLabel('Unit for new lease')).toHaveValue('u051');
 await page.getByRole('button',{name:'First page'}).click();await expect(page.getByRole('button',{name:'Next page'})).toBeVisible();await page.getByRole('button',{name:'Create lease record'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();expect(state.leases.length).toBe(1);expect(state.keys[0]).toBe(state.keys[1]);
});

test('unit directory searches all pages, resets pagination and keeps filters on refresh',async({page})=>{
 const state=await fixture(page);for(let i=1;i<=51;i++)state.units.push({id:'u'+String(i).padStart(3,'0'),label:'Unit '+i,propertyId:'home',status:i===1?'archived':'active',version:1,floor:i===1?'Garden':'Upper'});
 await page.goto('/company/properties/home/units');await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.getByText('1 unit on this page')).toBeVisible();
 await page.getByLabel('Find unit', {exact:true}).fill('Garden');await expect(page.getByRole('heading',{name:'Unit 1',exact:true})).toBeVisible();await expect(page).not.toHaveURL(/cursor=/);await expect(page.getByRole('heading',{name:'Unit 51',exact:true})).toHaveCount(0);
 await page.getByLabel('Unit view',{exact:true}).selectOption('active');await expect(page.getByRole('heading',{name:'No matching units',exact:true})).toBeVisible();
 await page.getByLabel('Unit view',{exact:true}).selectOption('archived');await page.reload();await expect(page.getByLabel('Find unit',{exact:true})).toHaveValue('Garden');await expect(page.getByLabel('Unit view',{exact:true})).toHaveValue('archived');await expect(page.getByRole('heading',{name:'Unit 1',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(page.getByText('50 units on this page')).toBeVisible();
});

test('unit lease history retains exact scope through lease details and back to the unit directory',async({page})=>{
 const state=await fixture(page);state.units.push({id:'u1',label:'Garden studio',propertyId:'home',status:'active',version:1,bedrooms:0,marketRentCents:0});
 state.leases.push({id:'l1',unitId:'u1',propertyId:'home',residentId:'r',resident:{name:'Resident',email:'r@test.invalid'},unit:{label:'Garden studio'},property:{name:'Home'},startsOn:'2026-10-01',endsOn:null,rentCents:150000,currency:'USD',status:'active',version:1});
 await page.goto('/company/properties/home/units?q=Garden&status=active');await expect(page.getByRole('cell',{name:'Studio · Bathrooms not recorded',exact:true})).toBeVisible();await expect(page.getByText('$0.00',{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'View leases for Garden studio',exact:true}).click();await expect(page).toHaveURL(/unitId=u1/);await expect(page.getByText(/Showing leases for Garden studio/)).toBeVisible();
 await page.getByLabel('Lease view',{exact:true}).selectOption('active');await page.getByRole('link',{name:'Open lease workspace',exact:true}).click();await expect(page).toHaveURL(/leaseListUnit=u1/);
 await page.getByRole('link',{name:'← All leases',exact:true}).click();await expect(page).toHaveURL(/unitId=u1/);await expect(page.getByLabel('Lease view',{exact:true})).toHaveValue('active');
 await page.getByRole('link',{name:'← Back to units',exact:true}).click();await expect(page.getByLabel('Find unit',{exact:true})).toHaveValue('Garden');await expect(page.getByLabel('Unit view',{exact:true})).toHaveValue('active');
});

test('staff can search unit records without editing or lease links',async({page})=>{
 const state=await fixture(page,'staff');state.units.push({id:'u1',label:'Read-only suite',propertyId:'home',status:'active',version:1});
 await page.goto('/company/properties/home/units?q=Read-only&status=active');await expect(page.getByRole('heading',{name:'Read-only suite',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:/View leases/})).toHaveCount(0);await expect(page.getByRole('button',{name:/Edit unit|Add a unit/})).toHaveCount(0);
});
