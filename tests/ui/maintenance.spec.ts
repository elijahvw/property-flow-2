import {test,expect,Page} from '@playwright/test';
async function fixture(page:Page,resident=true){
 const state={rows:[] as any[],properties:[{id:'home',name:'Home'}],fail:false,assigned:true,posts:[] as any[],patches:[] as any[],updates:[] as any[],updatePosts:[] as any[],updateFail:false,shareable:true,detailDenied:false};
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname,method=route.request().method(),json=(value:unknown,status=200)=>route.fulfill({json:value,status});
  if(path==='/api/telemetry')return json({accepted:true});
  if(path==='/api/bootstrap')return json({user:{id:'u',name:'Test Owner',email:'u@test.invalid',status:'active',emailVerified:true},membership:{companyId:'a',version:1,role:resident?'resident':'manager',status:'active',company:{name:'Company',status:'active'}},permissions:resident?['resident.self']:['property.read','maintenance.manage'],destination:resident?'/resident/maintenance':'/company/maintenance',csrfToken:'fixture'});
  if(path.endsWith('/units'))return json({items:[{id:'unit-a',label:'Apartment 1',status:'active'}],nextCursor:null});
  if(path.endsWith('/properties'))return json(state.assigned?state.properties:[]);
  if(path==='/api/company/properties/home')return json({id:'home',name:'Home'});
  if(path.endsWith('/updates')){
   if(state.detailDenied)return json({error:'Request unavailable'},404);
   if(method==='POST'){
    const data=route.request().postDataJSON();expect(route.request().headers()['x-csrf-token']).toBe('fixture');state.updatePosts.push(data);
    if(state.updateFail)return json({error:'Unable to record update. Try again.'},503);
    const row={id:'update-'+state.updatePosts.length,...data,author:'Test Owner',createdAt:'2026-10-16T14:00:00Z'};state.updates.unshift(row);return json(row);
   }
   return json({items:state.updates.filter(row=>!resident||row.visibility==='resident').map(row=>({...row,author:resident?'Property team':row.author})),nextCursor:null});
  }
  if(method!=='GET'){
   expect(route.request().headers()['x-csrf-token']).toBe('fixture');const data=route.request().postDataJSON();
   if(method==='POST')state.posts.push(data);else state.patches.push(data);
   if(state.fail)return json({error:'Access changed. Try again.'},409);
   if(method==='POST')state.rows.push({id:'request',unitId:null,unit:null,category:'other',targetOn:null,version:1,createdAt:'2026-10-16T12:00:00Z',updatedAt:'2026-10-16T12:00:00Z',...data,status:'open',property:{name:'Home'},activity:[{id:'created',action:'maintenance.created',actorName:'Test Owner',createdAt:'2026-10-16T12:00:00Z'}]});
   else {Object.assign(state.rows[0],data,{version:state.rows[0].version+1});state.rows[0].activity.push({id:'updated',action:'maintenance.status.changed',from:'open',to:data.status,createdAt:'2026-10-16T13:00:00Z'});}
   return json(state.rows[0]);
  }
  if(state.fail)return json({error:'Temporarily unavailable'},503);
  if(/\/maintenance\/[^/]+$/.test(path))return state.detailDenied?json({error:'Request unavailable'},404):json({...state.rows.find(r=>r.id===path.split('/').pop()),recordedBy:'Test Owner',historyLimited:false,residentUpdatesAvailable:state.shareable});
  const status=url.searchParams.get('status'),q=url.searchParams.get('q')||'',priority=url.searchParams.get('priority');return json(state.rows.filter(r=>(!status||r.status===status||status==='unresolved'&&r.status!=='resolved')&&(!priority||r.priority===priority)&&r.title.toLowerCase().includes(q.toLowerCase())));
 });return state;
}
const sample=()=>({id:'request',propertyId:'home',unitId:'unit-a',unit:{label:'Apartment 1'},title:'Tap leak',description:'Leaks under the kitchen sink.',category:'plumbing',priority:'normal',status:'open',version:1,targetOn:'2026-10-23',createdAt:'2026-10-16T12:00:00Z',updatedAt:'2026-10-16T12:00:00Z',property:{name:'Home'},activity:[{id:'created',action:'maintenance.created',actorName:'Test Owner',createdAt:'2026-10-16T12:00:00Z'}]});
test('resident create retains failed draft and retry identity; directory has useful details',async({page})=>{
 const state=await fixture(page);await page.goto('/resident/maintenance');await expect(page.getByText('No requests match these filters.')).toBeVisible();
 await page.getByRole('button',{name:'Submit a request',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Tap leak');await page.getByLabel('Description',{exact:true}).fill('Kitchen tap leaks');state.fail=true;
 await page.getByRole('button',{name:'Submit request',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Access changed');state.fail=false;
 await page.getByRole('button',{name:'Submit request',exact:true}).click();await expect(page.getByRole('heading',{name:'Tap leak'})).toBeVisible();expect(state.posts[0]).toEqual(state.posts[1]);
 await page.getByRole('link',{name:'View request →'}).click();await expect(page.getByRole('heading',{name:'Activity history'})).toBeVisible();await expect(page.getByRole('button',{name:'Update request'})).toHaveCount(0);
});
test('manager opens a stable request, updates status and returns to retained filters',async({page})=>{
 const state=await fixture(page,false);state.rows.push(sample());state.fail=true;await page.goto('/company/maintenance?priority=normal');await expect(page.getByRole('alert')).toContainText('Temporarily unavailable');state.fail=false;
 await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('link',{name:'Manage request →'}).click();await expect(page).toHaveURL(/maintenance\/request\?priority=normal$/);
 await page.getByRole('button',{name:'Update request',exact:true}).click();await page.getByLabel('Status for Tap leak').selectOption('resolved');await page.getByRole('button',{name:'Save request changes',exact:true}).click();
 await expect(page.getByText('Request updated.',{exact:true})).toBeVisible();expect(state.patches[0].expectedVersion).toBe(1);
 await page.getByRole('link',{name:'← Back to maintenance'}).click();await expect(page.getByLabel('Filter priority')).toHaveValue('normal');await page.getByLabel('Filter status').selectOption('open');await expect(page.getByText('No requests match these filters.')).toBeVisible();
});
test('manager intake records unit, category and readable target date with no invented resident',async({page})=>{
 const state=await fixture(page,false);await page.goto('/company/maintenance');await page.getByRole('button',{name:'Add request',exact:true}).click();
 await page.getByLabel('Unit (optional)',{exact:true}).selectOption('unit-a');await page.getByLabel('Title',{exact:true}).fill('Inspect boiler');await page.getByLabel('Description',{exact:true}).fill('Annual inspection for the unit boiler.');await page.getByLabel('Category',{exact:true}).selectOption('hvac');await page.getByLabel('Target date',{exact:true}).fill('2026-10-23');
 await page.getByLabel('Title',{exact:true}).focus();await expect(page.getByText('October 23, 2026',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Save request',exact:true}).click();expect(state.posts[0]).toMatchObject({unitId:'unit-a',category:'hvac',targetOn:'2026-10-23'});expect(state.posts[0]).not.toHaveProperty('requesterId');
});
test('property maintenance intake stays in scope while company intake keeps property selection',async({page})=>{
 const state=await fixture(page,false);state.properties.unshift({id:'garden',name:'Garden'});
 await page.goto('/company/properties/home/maintenance');await page.getByRole('button',{name:'Add request',exact:true}).click();
 const property=page.getByRole('dialog').getByRole('combobox',{name:'Property',exact:true});await expect(property.locator('option')).toHaveText(['Home']);await expect(property).toHaveValue('home');
 await page.getByLabel('Title',{exact:true}).fill('Inspect boiler');await page.getByLabel('Description',{exact:true}).fill('Check the boiler at Home.');await page.getByRole('button',{name:'Save request',exact:true}).click();expect(state.posts[0].propertyId).toBe('home');
 await page.evaluate(()=>fetch('/api/telemetry',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':'fixture'},body:JSON.stringify({events:[{name:'maintenance.create',outcome:'success',duration:1}]})}));expect(state.posts).toHaveLength(1);expect(state.rows).toHaveLength(1);
 await page.getByRole('link',{name:'Manage request →',exact:true}).click();await expect(page).toHaveURL(/\/company\/maintenance\/request\?propertyId=home&nested=true$/);await page.getByRole('link',{name:'← Back to maintenance',exact:true}).click();await expect(page).toHaveURL(/\/company\/properties\/home\/maintenance$/);
 await page.goto('/company/maintenance');await page.getByRole('button',{name:'Add request',exact:true}).click();const companyProperty=page.getByRole('dialog').getByRole('combobox',{name:'Property',exact:true});await expect(companyProperty.locator('option')).toHaveText(['Garden','Home']);await companyProperty.selectOption('garden');await expect(companyProperty).toHaveValue('garden');
});
test('stale maintenance editor preserves draft and opening version after background updates',async({page})=>{
 const state=await fixture(page,false);state.rows.push(sample());await page.goto('/company/maintenance/request');await page.getByRole('button',{name:'Update request',exact:true}).click();await page.getByLabel('Description',{exact:true}).fill('My unsaved update');state.rows[0].version=2;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));state.fail=true;await page.getByRole('button',{name:'Save request changes',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Access changed');await expect(page.getByLabel('Description',{exact:true})).toHaveValue('My unsaved update');expect(state.patches[0].expectedVersion).toBe(1);await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:/^(Save draft & close|Close & keep recovery)$/,exact:true}).click();await page.getByRole('button',{name:'Update request',exact:true}).click();await expect(page.getByLabel('Description',{exact:true})).toHaveValue('My unsaved update');
});
test('unassigned resident cannot submit or select unit assignments',async({page})=>{
 const state=await fixture(page);state.assigned=false;await page.goto('/resident/maintenance');await page.getByRole('button',{name:'Submit a request',exact:true}).click();await expect(page.getByText(/No properties assigned/)).toBeVisible();await expect(page.getByRole('button',{name:'Submit request',exact:true})).toHaveCount(0);await expect(page.getByLabel('Unit (optional)')).toHaveCount(0);
});
test('request controls wait for authorized properties',async({page})=>{
 await fixture(page);let release!:()=>void;const gate=new Promise<void>(r=>release=r);await page.route('**/api/resident/properties',async route=>{await gate;await route.fulfill({json:[{id:'home',name:'Home'}]});});
 try{await page.goto('/resident/maintenance');await page.getByRole('button',{name:'Submit a request',exact:true}).click();await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Loading maintenance…');await expect(page.getByRole('button',{name:'Submit request',exact:true})).toHaveCount(0);release();await expect(page.getByRole('button',{name:'Submit request',exact:true})).toBeVisible();}finally{release();}
});

test('progress update editor defaults private and preserves failed text, audience and retry identity',async({page})=>{
 const state=await fixture(page,false);state.rows.push(sample());await page.goto('/company/maintenance/request');
 await page.getByRole('button',{name:'Add update',exact:true}).click();await expect(page.getByLabel('Update audience')).toHaveValue('internal');await page.getByLabel('Update audience').selectOption('resident');await page.getByLabel('Update text').fill('We will inspect the tap tomorrow.');state.updateFail=true;
 await page.getByRole('button',{name:'Record update',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Unable to record update');await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:/^(Save draft & close|Close & keep recovery)$/,exact:true}).click();await page.getByRole('button',{name:'Add update',exact:true}).click();
 await expect(page.getByLabel('Update text')).toHaveValue('We will inspect the tap tomorrow.');await expect(page.getByLabel('Update audience')).toHaveValue('resident');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));state.updateFail=false;
 await page.getByRole('button',{name:'Record update',exact:true}).click();await expect(page.getByText('Update recorded.',{exact:true})).toBeVisible();expect(state.updatePosts[0]).toEqual(state.updatePosts[1]);await expect(page.getByText('Resident-visible update',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Add update',exact:true}).click();await expect(page.getByLabel('Update text')).toHaveValue('');await expect(page.getByLabel('Update audience')).toHaveValue('internal');
});

test('management-created requests offer internal updates only and fit a phone viewport',async({page})=>{
 const state=await fixture(page,false);state.shareable=false;state.rows.push(sample());state.updates.push({id:'note',content:'Internal repair estimate to review.',visibility:'internal',author:'Manager',createdAt:'2026-10-16T14:00:00Z'});await page.setViewportSize({width:390,height:844});await page.goto('/company/maintenance/request');
 await expect(page.getByText('Internal repair estimate to review.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Add update',exact:true}).click();await expect(page.getByRole('option',{name:'Resident requester and management team',exact:true})).toHaveCount(0);await expect(page.getByText(/This management-created request has no resident requester/)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});

test('residents read only shared progress and cannot record updates',async({page})=>{
 const state=await fixture(page);state.rows.push(sample());state.updates.push({id:'private',content:'Private management estimate.',visibility:'internal',author:'Manager',createdAt:'2026-10-16T13:00:00Z'},{id:'shared',content:'The visit is planned for Friday.',visibility:'resident',author:'Manager',createdAt:'2026-10-16T14:00:00Z'});await page.goto('/resident/maintenance/request');
 await expect(page.getByRole('heading',{name:'Updates from your property team',exact:true})).toBeVisible();await expect(page.getByText('The visit is planned for Friday.',{exact:true})).toBeVisible();await expect(page.getByText('Private management estimate.',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Add update',exact:true})).toHaveCount(0);
});

test('revoked request access clears update content and the open private draft',async({page})=>{
 const state=await fixture(page,false);state.rows.push(sample());state.updates.push({id:'private',content:'Private saved update.',visibility:'internal',author:'Manager',createdAt:'2026-10-16T13:00:00Z'});await page.goto('/company/maintenance/request');await page.getByRole('button',{name:'Add update',exact:true}).click();await page.getByLabel('Update text').fill('Private unsaved draft');state.detailDenied=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByText('Request unavailable',{exact:true})).toBeVisible();await expect(page.getByText('Private saved update.',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Update text')).toHaveCount(0);
});
