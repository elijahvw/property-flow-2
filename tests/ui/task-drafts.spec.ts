import {test,expect,type Page} from '@playwright/test';
async function fixture(page:Page){
 const property={id:'home',name:'Maple House',address:'1 Maple Street',city:'City',state:'PA',zip:'19100',version:1};
 const unit={id:'unit',label:'First suite',propertyId:'home',status:'active',version:1},far={...unit,id:'far-unit',label:'Suite outside the first page'};
 const state={signedIn:true,drafts:new Map<string,any>(),posts:[] as any[],leases:new Map<string,any>(),abortLease:false,denyLease:false,readOnlyLease:false,abortDraft:false,abortPatch:false,unavailable:false,draftStatus:200,failDelete:false,stale:false,draftCreates:0,draftPosts:[] as any[],taskPatches:[] as any[],features:{} as Record<string,string>};
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method(),json=(value:unknown,status=200)=>route.fulfill({json:value,status});
  const project=(row:any)=>state.unavailable?{companyId:row.companyId,id:row.id,kind:row.kind,title:row.title,version:row.version,savedAt:row.savedAt,expiresAt:row.expiresAt,unavailable:true,stale:true,sourceIssue:'The saved source no longer supports this task.'}:row;
  if(path==='/api/bootstrap')return state.signedIn?json({user:{id:'owner',email:'owner@test.invalid',status:'active',emailVerified:true},membership:{companyId:'a',role:'owner',status:'active',version:1,company:{id:'a',name:'Fictional Properties',status:'active'}},permissions:['property.read','property.write','lease.manage','resident.assignment.manage'],destination:'/company/leases',csrfToken:'fixture',companyFeatures:state.features}):json({error:'Sign in required'},401);
  if(path==='/api/company/properties')return json([property]);
  if(path==='/api/company/properties/home')return json(property);
  if(path==='/api/company/units/far-unit')return json(far);
  if(path==='/api/company/properties/home/units')return json({items:[unit],nextCursor:null});
  if(path.endsWith('/residents'))return json([{userId:'tenant',membership:{user:{name:'Fixture Tenant',email:'tenant@test.invalid'}}}]);
  if(path==='/api/company/task-drafts'){
   if(method==='GET')return json({companyId:'a',items:[...state.drafts.values()].map(project),hasMore:false});
   const b=request.postDataJSON();state.draftCreates++;state.draftPosts.push(b);expect(request.headers()['x-company-id']).toBe('a');if(state.draftStatus!==200)return json({error:'Task area is read-only',code:'SUBSCRIPTION_READ_ONLY'},state.draftStatus);
   const existing=[...state.drafts.values()].find(row=>row.submissionKey===b.submissionKey);if(existing)return json(project(existing));
   const row={companyId:'a',id:'task-'+state.draftCreates,kind:b.kind,propertyId:b.propertyId,sourceId:b.sourceId||null,values:b.values,context:b.context,version:1,actionKey:crypto.randomUUID(),sourceVersions:{property:{id:'home',version:1}},title:'New lease · Maple House',savedAt:'2026-10-22T14:00:00Z',expiresAt:'2026-11-21T14:00:00Z',stale:state.stale,property,submissionKey:b.submissionKey};state.drafts.set(row.id,row);if(state.abortDraft){state.abortDraft=false;return route.abort('failed');}return json(project(row));
  }
  if(path.startsWith('/api/company/task-drafts/')){
   const id=path.split('/').at(-1)!,row=state.drafts.get(id);if(!row)return json({error:'Saved draft is unavailable.'},404);
   if(method==='GET')return json(project({...row,stale:state.stale}));
   const b=request.postDataJSON();
   if(method==='DELETE'){if(state.failDelete)return json({error:'Draft cleanup interrupted'},503);state.drafts.delete(id);return json({deleted:true});}
   state.taskPatches.push(b);expect(request.headers()['x-company-id']).toBe('a');
   if(row.lastMutationKey===b.submissionKey)return json(project(row));
   if(b.expectedVersion!==row.version)return json({error:'This record changed. Open the saved task again.',code:'RECORD_CHANGED'},409);
   if(b.reviewSources)state.stale=false;
   Object.assign(row,{values:b.values,context:b.context,version:row.version+1,stale:state.stale,lastMutationKey:b.submissionKey});if(state.abortPatch){state.abortPatch=false;return route.abort('failed');}return json(project(row));
  }
  if(path==='/api/company/leases'){
   if(method==='GET')return json({items:[],nextCursor:null,...(url.searchParams.get('unitId')?{unit:url.searchParams.get('unitId')==='far-unit'?far:unit}:{})});
   const b=request.postDataJSON();state.posts.push(b);if(state.denyLease)return json({error:'Current lease access is unavailable',code:'ACCESS_DENIED'},403);if(state.readOnlyLease)return json({error:'Lease area is read-only',code:'SUBSCRIPTION_READ_ONLY'},403);let row=state.leases.get(b.submissionKey);
   if(!row){row={id:'saved-lease',...b,version:1,rentCents:Math.round(Number(b.monthlyRent)*100),currency:'USD',property,unit:b.unitId==='far-unit'?far:unit,resident:{name:'Fixture Tenant',email:'tenant@test.invalid'},startsOn:b.startsOn,endsOn:b.endsOn||null};state.leases.set(b.submissionKey,row);}
   if(state.abortLease){state.abortLease=false;return route.abort('failed');}return json(row);
  }
  if(path==='/api/company/leases/saved-lease')return json([...state.leases.values()][0]);
  if(path.endsWith('/participants'))return json({items:[],candidates:[],lease:[...state.leases.values()][0]});
  return json([]);
 });return state;
}
async function enterLease(page:Page){await page.goto('/company/leases?new=lease&unitId=far-unit');await expect(page.getByLabel('Unit for new lease')).toHaveValue('far-unit');await page.getByLabel('New lease start date').fill('2026-11-01');await page.getByLabel('New lease monthly rent (USD)').fill('1234.50');await page.getByLabel('New lease payment instructions shared with resident (optional)').fill('Fictional reviewed payment instructions');}

test('a saved task restores exact unit/text after refresh and sign-in without submitting',async({page})=>{
 const state=await fixture(page);await enterLease(page);await page.getByRole('button',{name:'Save task draft',exact:true}).click();await expect(page.getByRole('region',{name:'Saved task draft'})).toContainText('Saved October');expect(state.drafts.size).toBe(1);expect(state.posts).toHaveLength(0);
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Saved drafts',exact:true}).click();await page.getByRole('link',{name:'Continue task',exact:true}).click();await expect(page.getByLabel('Unit for new lease')).toHaveValue('far-unit');await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('1234.50');
 await page.reload();await expect(page.getByLabel('New lease payment instructions shared with resident (optional)')).toHaveValue('Fictional reviewed payment instructions');
 state.signedIn=false;await page.reload();await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveCount(0);state.signedIn=true;await page.reload();await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('1234.50');expect(state.posts).toHaveLength(0);
});

test('changed sources require an explicit review; commit redirect and cleanup failure keep one source',async({page})=>{
 const state=await fixture(page);await enterLease(page);await page.getByRole('button',{name:'Save task draft',exact:true}).click();await expect.poll(()=>state.drafts.size).toBe(1);state.stale=true;const id=[...state.drafts.keys()][0];
 await page.goto('/company/drafts?draftId='+id);await page.getByRole('button',{name:'Review lease',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'Review the changed source records'})).toBeVisible();expect(state.posts).toHaveLength(0);
 await page.getByRole('checkbox',{name:'I checked the current source records and will review this task before submitting.',exact:true}).check();await page.getByRole('button',{name:'Review lease',exact:true}).click();state.failDelete=true;
 await page.getByRole('button',{name:'Create lease record',exact:true}).click();await expect(page).toHaveURL(url=>url.pathname==='/company/leases/saved-lease'&&url.searchParams.get('onboarding')==='household'&&url.searchParams.get('leaseListUnit')==='far-unit');expect(state.leases.size).toBe(1);
 await page.goto('/company/drafts?draftId='+id);await page.getByRole('button',{name:'Review lease',exact:true}).click();await page.getByRole('button',{name:'Create lease record',exact:true}).click();await expect(page).toHaveURL(url=>url.pathname==='/company/leases/saved-lease'&&url.searchParams.get('onboarding')==='household'&&url.searchParams.get('leaseListUnit')==='far-unit');expect(state.posts).toHaveLength(2);expect(state.posts[0].submissionKey).toBe(state.posts[1].submissionKey);expect(state.leases.size).toBe(1);
});

test('an interrupted submitted lease stays original recovery and never becomes a new draft',async({page})=>{
 const state=await fixture(page);await enterLease(page);await page.getByRole('button',{name:'Save task draft',exact:true}).click();await expect.poll(()=>state.drafts.size).toBe(1);state.abortLease=true;
 await page.getByRole('button',{name:'Review lease',exact:true}).click();await page.getByRole('button',{name:'Create lease record',exact:true}).click();await expect(page.getByText('This request may already be saved. Retry with the original details before starting another record.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Save task draft',exact:true})).toHaveCount(0);expect(state.draftCreates).toBe(1);
 await page.reload();await page.getByRole('button',{name:'Create lease record',exact:true}).click();await expect(page).toHaveURL(/company\/leases\/saved-lease\?onboarding=household/);expect(state.posts[0]).toEqual(state.posts[1]);expect(state.leases.size).toBe(1);expect(state.draftCreates).toBe(1);
});

test('Save draft and close persists the selected task before hiding its form',async({page})=>{
 const state=await fixture(page);await enterLease(page);await page.getByRole('button',{name:'Back to leases',exact:true}).click();await page.getByRole('alertdialog',{name:'Close without saving changes?',exact:true}).getByRole('button',{name:'Save draft & close',exact:true}).click();
 await expect(page.getByRole('region',{name:'Record a lease',exact:true})).not.toBeVisible();expect(state.drafts.size).toBe(1);const id=[...state.drafts.keys()][0];await page.goto('/company/drafts?draftId='+id);await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('1234.50');expect(state.posts).toHaveLength(0);
});

test('a rejected close-confirmation draft save explains the failure and preserves entered values',async({page})=>{
 const state=await fixture(page);await enterLease(page);state.draftStatus=403;
 await page.getByRole('button',{name:'Back to leases',exact:true}).click();
 const confirmation=page.getByRole('alertdialog',{name:'Close without saving changes?',exact:true});
 await confirmation.getByRole('button',{name:'Save draft & close',exact:true}).click();
 await expect(confirmation.getByRole('alert')).toContainText('Task area is read-only');
 expect(state.drafts.size).toBe(0);expect(state.posts).toHaveLength(0);
 await confirmation.getByRole('button',{name:'Keep editing',exact:true}).click();
 await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('1234.50');
 await expect(page.getByLabel('New lease payment instructions shared with resident (optional)')).toHaveValue('Fictional reviewed payment instructions');
});

test('a stale close-confirmation draft save remains visible until the user returns to the editor',async({page})=>{
 const state=await fixture(page);await enterLease(page);
 await page.getByRole('button',{name:'Save task draft',exact:true}).click();
 // Fixture persistence precedes the UI acknowledging the saved dirty baseline.
 // Finish that save before introducing the peer version and a new local edit.
 await expect(page.getByRole('region',{name:'Saved task draft'})).toContainText('Saved October');
 await expect(page.getByRole('button',{name:'Save task draft',exact:true})).toBeEnabled();
 expect(state.drafts.size).toBe(1);
 const row=[...state.drafts.values()][0];row.version++;
 await page.getByLabel('New lease monthly rent (USD)').fill('1650.00');
 await page.getByRole('button',{name:'Back to leases',exact:true}).click();
 const confirmation=page.getByRole('alertdialog',{name:'Close without saving changes?',exact:true});
 await confirmation.getByRole('button',{name:'Save draft & close',exact:true}).click();
 await expect(confirmation.getByRole('alert')).toContainText('This record changed');
 await confirmation.getByRole('button',{name:'Keep editing',exact:true}).click();
 await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('1650.00');
 expect(state.posts).toHaveLength(0);expect(row.values.monthlyRent).toBe('1234.50');
});

test('an interrupted task save keeps its body through a later read-only denial and locks business submission',async({page})=>{
 const state=await fixture(page);await enterLease(page);state.abortDraft=true;
 await page.getByRole('button',{name:'Save task draft',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry saving task draft',exact:true})).toBeVisible();
 await expect(page.getByLabel('New lease monthly rent (USD)')).toBeDisabled();
 await expect(page.getByRole('button',{name:'Review lease',exact:true})).toBeDisabled();
 const original=state.draftPosts[0];state.draftStatus=403;
 await page.getByRole('button',{name:'Retry saving task draft',exact:true}).click();
 await expect(page.getByText('Task area is read-only',{exact:true})).toBeVisible();
 await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('1234.50');
 state.draftStatus=200;
 await page.getByRole('button',{name:'Retry saving task draft',exact:true}).click();
 await expect(page.getByRole('button',{name:'Save task draft',exact:true})).toBeVisible();
 expect(state.drafts.size).toBe(1);expect(state.draftPosts).toHaveLength(3);
 expect(state.draftPosts[1]).toEqual(original);expect(state.draftPosts[2]).toEqual(original);expect(state.posts).toHaveLength(0);
 await expect(page.getByLabel('New lease monthly rent (USD)')).toBeEnabled();
});

test('a policy-only refresh keeps the same unfinished task fields without allowing writes',async({page})=>{
 const state=await fixture(page);await enterLease(page);state.features={leasing:'read_only'};
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByLabel('New lease monthly rent (USD)')).toBeDisabled();
 await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('1234.50');
 await expect(page.getByRole('button',{name:'Save task draft',exact:true})).toBeDisabled();
 state.features={leasing:'enabled'};await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByLabel('New lease monthly rent (USD)')).toBeEnabled();
 await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('1234.50');
 expect(state.draftPosts).toHaveLength(0);expect(state.posts).toHaveLength(0);
});

test('an unavailable renewal stays separate from usable saved tasks and can be cleaned up',async({page})=>{
 const state=await fixture(page);await enterLease(page);await page.getByRole('button',{name:'Save task draft',exact:true}).click();
 await expect.poll(()=>state.drafts.size).toBe(1);
 state.drafts.set('invalid-renewal',{companyId:'a',id:'invalid-renewal',kind:'lease_renewal',title:'Renewal with changed source',version:1,savedAt:'2026-10-22T14:00:00Z',expiresAt:'2026-11-21T14:00:00Z',unavailable:true,sourceIssue:'The saved source no longer supports this task.'});
 await page.goto('/company/drafts');await expect(page.getByRole('link',{name:'Continue task',exact:true})).toHaveCount(1);
 await page.getByRole('link',{name:'Review unavailable task',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Saved task needs attention',exact:true})).toBeVisible();
 await expect(page.getByLabel('Renewal monthly rent (USD)')).toHaveCount(0);
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete draft',exact:true}).click();
 await expect(page).toHaveURL(/company\/drafts$/);expect(state.drafts.size).toBe(1);
 await page.getByRole('link',{name:'Continue task',exact:true}).click();await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('1234.50');
 expect(state.posts).toHaveLength(0);
});

test('an original committed save can be acknowledged after its source becomes unavailable',async({page})=>{
 const state=await fixture(page);await enterLease(page);state.abortDraft=true;
 await page.getByRole('button',{name:'Save task draft',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry saving task draft',exact:true})).toBeVisible();
 const original=state.draftPosts[0];state.unavailable=true;
 await page.getByRole('button',{name:'Retry saving task draft',exact:true}).click();
 await expect(page.getByText('The task save is recorded, but its source no longer supports this task. Its private task fields are hidden.',{exact:true})).toBeVisible();
 await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveCount(0);
 expect(state.drafts.size).toBe(1);expect(state.draftPosts[1]).toEqual(original);expect(state.posts).toHaveLength(0);
 await page.getByRole('link',{name:'Review or remove the unavailable saved task',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Saved task needs attention',exact:true})).toBeVisible();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete draft',exact:true}).click();
 await expect(page).toHaveURL(/company\/drafts$/);expect(state.drafts.size).toBe(0);
});

for(const interrupted of ['create','edit'] as const)test(`a lost task ${interrupted} does not adopt peer edits without an explicit current-record decision`,async({page})=>{
 await page.setViewportSize(interrupted==='edit'?{width:390,height:844}:{width:1440,height:900});
 const state=await fixture(page);await enterLease(page);
 if(interrupted==='edit'){
  await page.getByRole('button',{name:'Save task draft',exact:true}).click();await expect.poll(()=>state.drafts.size).toBe(1);
  const id=[...state.drafts.keys()][0];await page.goto('/company/drafts?draftId='+id);
  await page.getByLabel('New lease monthly rent (USD)').fill('1350.00');state.abortPatch=true;
 }else state.abortDraft=true;
 await page.getByRole('button',{name:'Save task draft',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry saving task draft',exact:true})).toBeVisible();
 const row=[...state.drafts.values()][0];row.values={...row.values,monthlyRent:'1999.00'};row.version++;row.lastMutationKey='independent-peer-edit';
 await page.getByRole('button',{name:'Retry saving task draft',exact:true}).click();
 await expect(page.getByLabel('New lease monthly rent (USD)')).toBeDisabled();
 await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue(interrupted==='edit'?'1350.00':'1234.50');
 const pendingWrites=state.draftPosts.length+state.taskPatches.length;
 const read=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/company/task-drafts/'+row.id&&request.method()==='GET');
 await page.getByRole('button',{name:'Review current saved task',exact:true}).click();expect((await read).headers()['x-company-id']).toBe('a');
 await page.getByText('Current saved task values',{exact:true}).click();await expect(page.getByRole('definition').filter({hasText:'1999.00'})).toBeVisible();
 const resolution=page.getByRole('region',{name:'Resolve interrupted task save',exact:true});
 await resolution.scrollIntoViewIfNeeded();
 await expect(resolution.getByRole('definition').filter({hasText:'November 1, 2026'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
 await resolution.screenshot({path:`/tmp/propertyflow-task-current-record-${interrupted==='edit'?'mobile':'desktop'}.png`});
 await page.screenshot({path:`/tmp/propertyflow-task-current-record-${interrupted==='edit'?'mobile':'desktop'}-viewport.png`,fullPage:false});
 await page.getByRole('checkbox',{name:'I reviewed the current saved task. Stop retrying my earlier draft save and use this record as it is.',exact:true}).check();
 await page.getByRole('button',{name:'Use current saved task',exact:true}).click();
 await expect(page).toHaveURL(new RegExp('draftId='+row.id+'&taskVersion='+row.version));
 await expect(page.getByLabel('New lease monthly rent (USD)')).toHaveValue('1999.00');
 expect(state.draftPosts.length+state.taskPatches.length).toBe(pendingWrites);expect(state.posts).toHaveLength(0);
});

test('a denied final lease retry hides private task review immediately and preserves its original journal',async({page})=>{
 const state=await fixture(page);await enterLease(page);await page.getByRole('button',{name:'Save task draft',exact:true}).click();
 await expect.poll(()=>state.drafts.size).toBe(1);state.abortLease=true;
 await page.getByRole('button',{name:'Review lease',exact:true}).click();await page.getByRole('button',{name:'Create lease record',exact:true}).click();
 await expect(page.getByText('A previous save may have succeeded. Retry preserves the original reviewed details and submission identity.',{exact:true})).toBeVisible();
 const journal=await page.evaluate(()=>sessionStorage.getItem('pf:lease-setup:owner:a:home'));expect(journal).toBeTruthy();
 const original=state.posts[0];state.readOnlyLease=true;
 await page.getByRole('button',{name:'Create lease record',exact:true}).click();
 await expect(page.locator('.lease-review-summary')).toContainText('Maple House');
 state.readOnlyLease=false;state.denyLease=true;
 await page.getByRole('button',{name:'Create lease record',exact:true}).click();
 await expect(page.getByText('Task access is unavailable. Its private details are hidden; an interrupted request is kept on this page for recovery.',{exact:true})).toBeVisible();
 await expect(page.locator('.lease-review-summary')).toHaveCount(0);
 expect(await page.evaluate(()=>sessionStorage.getItem('pf:lease-setup:owner:a:home'))).toBe(journal);
 state.denyLease=false;await page.getByRole('button',{name:'Reload workspace',exact:true}).click();
 await expect(page.getByRole('button',{name:'Create lease record',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Create lease record',exact:true}).click();
 await expect(page).toHaveURL(/company\/leases\/saved-lease/);
 expect(state.posts).toHaveLength(4);for(const attempt of state.posts)expect(attempt).toEqual(original);expect(state.leases.size).toBe(1);
});
