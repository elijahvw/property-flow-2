import {test,expect,Page} from '@playwright/test';
async function fixture(page:Page,role='owner'){
 const state={features:{properties:'enabled',leasing:'enabled',finances:'enabled',maintenance:'enabled',documents:'enabled',reports:'enabled',resident_portal:'enabled',inspections:'enabled',agreements:'enabled',notifications:'enabled'},financeAllowed:false,company:'a',propertyStatus:200,additionalProperty:false,units:[] as any[],leases:[] as any[],residents:[{userId:'r',membership:{user:{name:'Resident',email:'r@test.invalid'}}}],loseUnit:false,loseLease:false,keys:[] as string[],writes:0,writeRequests:[] as string[],telemetry:0};
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,json=(value:unknown,status=200)=>route.fulfill({json:value,status});
  const property={id:'home',name:'Home',address:'1 Main St',city:'City',state:'PA',zip:'19100'};
  if(path==='/api/telemetry'&&req.method()==='POST'){expect(req.headers()['x-csrf-token']).toBe('fixture');state.telemetry++;return route.fulfill({status:204,body:''});}
  if(path==='/api/bootstrap')return json({user:{id:role,email:`${role}@test.invalid`,status:'active'},membership:{companyId:state.company,version:1,role,status:'active',company:{name:state.company,status:'active'}},permissions:role==='owner'||role==='manager'?['property.read','property.write','lease.manage','resident.assignment.manage',...(state.financeAllowed?['finance.manage']:[])]:role==='staff'?['property.read']:role==='resident'?['resident.self']:['platform.manage'],companyFeatures:state.features,csrfToken:'fixture'});
  if(path==='/api/company/properties')return json([property,...(state.additionalProperty?[{...property,id:'other',name:'Other property'}]:[])]);
  if(path==='/api/company/properties/home')return state.propertyStatus===200?json(property):json({error:'Property unavailable'},state.propertyStatus);
  if(path.endsWith('/residents'))return json(state.residents);
  if(req.method()==='GET'&&/^\/api\/company\/leases\/[^/]+(?:\/participants)?$/.test(path)){
   const row=state.leases.find(r=>r.id===path.split('/')[4]);
   return path.endsWith('/participants')?json({lease:row,items:[],candidates:[]}):json(row);
  }
  if(req.method()!=='GET'){
   expect(req.headers()['x-csrf-token']).toBe('fixture');state.writes++;state.writeRequests.push(req.method()+' '+path);
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
   const selected=rows.filter(r=>(!isUnit||r.propertyId===path.split('/')[4])&&(!cursor||r.id<cursor)&&(!status||r.status===status)&&(!unitId||r.unitId===unitId)&&(!q||[r.label,r.floor,r.unit?.label,r.resident?.name].some(v=>v?.toLowerCase().includes(q)))).sort((a,b)=>b.id.localeCompare(a.id));
   return json({items:selected.slice(0,50).map(row=>isUnit?{...row,occupancy:row.occupancy||'not_occupied'}:row),...(isUnit?{occupancyAsOf:'2026-10-25'}:{}),nextCursor:selected.length>50?selected[49].id:null,...(unitId?{unit:state.units.find(r=>r.id===unitId)}:{})});
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
 await expect(page.getByText('Each tenant has one Auth0 account;', {exact:false})).toBeVisible();
 expect(state.keys).toHaveLength(0);
});
test('unit search keeps typing responsive and batches the API query',async({page})=>{
 const state=await fixture(page);state.units.push({id:'u1',label:'Garden studio',propertyId:'home',status:'active',version:1});
 const queries:string[]=[];page.on('request',request=>{const url=new URL(request.url());if(url.pathname.endsWith('/units')&&url.searchParams.get('q'))queries.push(url.searchParams.get('q')!);});
 await page.goto('/company/properties/home/units');await expect(page.getByRole('heading',{name:'Garden studio',exact:true})).toBeVisible();
 // Control the debounce deadline independently of worker scheduling delays.
 await page.clock.install({time:new Date('2026-10-25T12:00:00Z')});
 await page.clock.pauseAt(new Date('2026-10-25T12:00:01Z'));
 const search=page.getByLabel('Find unit',{exact:true});
 await search.pressSequentially('Garden',{delay:5});
 await expect(search).toHaveValue('Garden');await expect(search).toBeFocused();
 await expect(page.getByText('Updating search…',{exact:true})).toBeVisible();
 expect(queries).toEqual([]);
 await page.clock.runFor(249);expect(queries).toEqual([]);
 await page.clock.runFor(1);
 await expect.poll(()=>queries).toEqual(['Garden']);await expect(search).toBeFocused();
 await page.reload();await expect(page.getByLabel('Find unit',{exact:true})).toHaveValue('Garden');
});
test('lease creation retries same key and records exact monthly rent',async({page})=>{
 const state=await fixture(page,'manager');state.additionalProperty=true;state.units.push({id:'u1',label:'Unit 1',propertyId:'home',status:'active',version:1});state.loseLease=true;
 await page.goto('/company/leases');await page.getByRole('button',{name:'Record a lease',exact:true}).click();await page.getByLabel('Property for new lease').selectOption('home');await page.getByLabel('New lease start date').fill('2026-11-01');await page.getByLabel('New lease monthly rent (USD)').fill('1234.56');
 await page.getByRole('button',{name:'Review lease',exact:true}).click();await page.getByRole('button',{name:'Create lease record'}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Create lease record'}).click();await expect(page.getByRole('region',{name:'Record a lease',exact:true})).not.toBeVisible();expect(state.leases.length).toBe(1);expect(state.leases[0].rentCents).toBe(123456);expect(state.keys[0]).toBe(state.keys[1]);
 await expect(page).toHaveURL(/\/company\/leases\/l1\?onboarding=household/);await expect(page.getByRole('heading',{name:'Leaseholders and occupants',exact:true})).toBeVisible();await page.getByRole('link',{name:'← All leases',exact:true}).click();await expect(page.getByText(/1234\.56|1,234\.56/)).toBeVisible();await page.getByRole('button',{name:'Record a lease',exact:true}).click();await page.getByLabel('Property for new lease').selectOption('home');await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('');
});

test('completing one property lease keeps another property task protected',async({page})=>{
 const state=await fixture(page);state.additionalProperty=true;
 state.units.push({id:'u1',label:'Unit 1',propertyId:'home',status:'active',version:1},{id:'u2',label:'Other suite',propertyId:'other',status:'active',version:1});
 const active=page.locator('.lease-property-draft:not([hidden])');
 await page.goto('/company/leases?new=lease');
 await page.getByLabel('Property for new lease').selectOption('other');
 await active.getByLabel('New lease monthly rent (USD)').fill('2222.00');
 await active.getByLabel('New lease payment instructions shared with resident (optional)').fill('Keep the other property task');
 await page.getByLabel('Property for new lease').selectOption('home');
 await active.getByLabel('New lease start date').fill('2026-11-01');
 await active.getByLabel('New lease monthly rent (USD)').fill('1250.00');
 await active.getByRole('button',{name:'Review lease',exact:true}).click();
 let confirmations=0;
 page.on('dialog',async dialog=>{confirmations++;expect(dialog.type()).toBe('confirm');expect(dialog.message()).toContain('discard its unsaved changes');await dialog.dismiss();});
 await active.getByRole('button',{name:'Create lease record',exact:true}).click();
 await expect(page.getByRole('link',{name:'Open the recorded lease workspace',exact:true})).toBeVisible();
 await expect(page).toHaveURL(/\/company\/leases\?new=lease$/);
 expect(state.leases).toHaveLength(1);expect(state.leases[0].propertyId).toBe('home');
 await page.getByLabel('Property for new lease').selectOption('other');
 await expect(active.getByLabel('New lease monthly rent (USD)')).toHaveValue('2222.00');
 await expect(active.getByLabel('New lease payment instructions shared with resident (optional)')).toHaveValue('Keep the other property task');
 const beforeHelp=confirmations;
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Help',exact:true}).click();
 await expect.poll(()=>confirmations).toBe(beforeHelp+1);
 await expect(page).toHaveURL(/\/company\/leases\?new=lease$/);expect(state.leases).toHaveLength(1);
 await expect(active.getByLabel('New lease monthly rent (USD)')).toHaveValue('2222.00');
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
 await page.getByRole('button',{name:'First page'}).click();await expect(page.getByRole('button',{name:'Next page'})).toBeVisible();await page.getByRole('button',{name:'Create lease record'}).click();await expect(page.getByRole('region',{name:'Record a lease',exact:true})).not.toBeVisible();expect(state.leases.length).toBe(1);expect(state.keys[0]).toBe(state.keys[1]);
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


test('unit filters reset only directory choices and preserve the source return context',async({page})=>{
 const state=await fixture(page);state.units.push({id:'u1',label:'Garden suite',propertyId:'home',status:'active',version:1});
 await page.goto('/company/properties/home/units?q=Garden&status=active&prospectId=original-prospect&prospectQ=retained-search');
 await expect(page.getByRole('heading',{name:'Garden suite',exact:true})).toBeVisible();
 await expect(page.getByLabel('Active filters',{exact:true}).getByRole('button')).toHaveCount(2);
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 await expect(page).toHaveURL(url=>!url.searchParams.has('q')&&!url.searchParams.has('status')&&url.searchParams.get('prospectId')==='original-prospect'&&url.searchParams.get('prospectQ')==='retained-search');
 await expect(page.getByRole('navigation',{name:'Unit directory pages',exact:true})).toContainText('All matching records are shown.');
});

test('unit policy refresh retains an unfinished form and an exact uncertain save without allowing new writes',async({page})=>{
 const state=await fixture(page);
 await page.goto('/company/properties/home/units');await page.getByRole('button',{name:'Add a unit',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Add a unit',exact:true});
 await dialog.getByLabel('Unit name',{exact:true}).fill('Retained suite');
 state.features.properties='read_only';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('button',{name:'Add a unit',exact:true})).toBeDisabled();
 await expect(dialog.getByLabel('Unit name',{exact:true})).toHaveValue('Retained suite');
 await expect(dialog.getByRole('button',{name:'Create unit',exact:true})).toBeDisabled();expect(state.writes).toBe(0);
 state.features.properties='enabled';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(dialog.getByRole('button',{name:'Create unit',exact:true})).toBeEnabled();state.loseUnit=true;
 await dialog.getByRole('button',{name:'Create unit',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();
 state.features.properties='read_only';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(dialog.getByRole('button',{name:'Create unit',exact:true})).toBeDisabled();
 await expect(dialog.getByLabel('Unit name',{exact:true})).toHaveValue('Retained suite');expect(state.keys).toHaveLength(1);
 state.features.properties='enabled';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(dialog.getByRole('button',{name:'Create unit',exact:true})).toBeEnabled();
 await dialog.getByRole('button',{name:'Create unit',exact:true}).click();await expect(dialog).not.toBeVisible();
 expect(state.units).toHaveLength(1);expect(state.keys).toHaveLength(2);expect(state.keys[0]).toBe(state.keys[1]);
});

test('lease view exposes reset and next-step links while respecting current feature access',async({page})=>{
 await page.clock.install({time:new Date('2026-10-25T12:00:00Z')});
 const state=await fixture(page);state.financeAllowed=true;state.features.finances='disabled';
 state.leases.push({id:'lease',propertyId:'home',unitId:'u1',status:'draft',startsOn:'2026-11-01',endsOn:null,rentCents:125000,version:1,property:{name:'Home'},unit:{label:'Garden suite'},resident:{name:'Resident',email:'r@test.invalid'}});
 await page.goto('/company/leases?status=draft&prospectId=original-prospect&prospectQ=retained-search');
 await expect(page.getByRole('link',{name:'Continue lease setup',exact:true})).toHaveAttribute('href',/section=household/);
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 await expect(page).toHaveURL(url=>!url.searchParams.has('status')&&url.searchParams.get('prospectId')==='original-prospect');
 await page.getByText('More actions',{exact:true}).click();
 await expect(page.locator('.row-more-actions').getByRole('link',{name:'Rent & payments →',exact:true})).toHaveCount(0);
 state.features.leasing='read_only';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('button',{name:'Record a lease',exact:true})).toBeDisabled();
 await expect(page.getByRole('link',{name:'Continue lease setup',exact:true})).toBeVisible();
 const actions=page.locator('.row-more');
 if(!(await actions.evaluate(node=>(node as HTMLDetailsElement).open)))await actions.getByText('More actions',{exact:true}).click();
 await expect(page.getByRole('button',{name:'Edit lease',exact:true})).toBeDisabled();expect(state.writes).toBe(0);
 state.units.push({id:'u1',label:'Garden suite',propertyId:'home',status:'active',version:1});
 await page.goto('/company/leases?new=lease');
 await expect(page.getByRole('button',{name:'Review lease',exact:true})).toBeDisabled();expect(state.writes,state.writeRequests.join(', ')).toBe(0);
 // Exercise the actual15s monitoring flush without counting it as a domain write.
 await page.clock.runFor(15000);await expect.poll(()=>state.telemetry).toBeGreaterThan(0);
 expect(state.writes,state.writeRequests.join(', ')).toBe(0);
 state.features.leasing='disabled';await page.goto('/company/leases?new=lease');
 await expect(page.getByRole('heading',{name:'Feature unavailable',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Record a lease',exact:true})).toHaveCount(0);expect(state.writes,state.writeRequests.join(', ')).toBe(0);
});

for(const role of ['owner','staff'])test(`units distinguish recorded occupancy from inventory status for ${role}`,async({page},info)=>{
 const state=await fixture(page,role);
 state.units.push({id:'u3',label:'Current household',propertyId:'home',status:'active',version:1,occupancy:'occupied'}, {id:'u2',label:'Upcoming tenancy',propertyId:'home',status:'active',version:1,occupancy:'not_occupied'}, {id:'u1',label:'Retired space',propertyId:'home',status:'archived',version:1,occupancy:'not_occupied'});
 await page.setViewportSize({width:390,height:844});
 await page.goto('/company/properties/home/units');
 const occupied=page.getByRole('row').filter({hasText:'Current household'}),future=page.getByRole('row').filter({hasText:'Upcoming tenancy'}),archived=page.getByRole('row').filter({hasText:'Retired space'});
 await expect(occupied.getByText('Occupied',{exact:true})).toBeVisible();await expect(occupied.getByText('Active',{exact:true})).toBeVisible();
 for(const row of [future,archived])await expect(row.getByText('Not occupied',{exact:true})).toBeVisible();
 await expect(archived.getByText('Archived',{exact:true})).toBeVisible();
 await expect(page.getByText('Not occupied does not confirm physical vacancy or readiness.',{exact:false})).toBeVisible();
 await page.reload();await expect(occupied.getByText('Occupied',{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath(`units-occupancy-${role}-phone.png`),fullPage:true});
 expect(state.writes).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});
