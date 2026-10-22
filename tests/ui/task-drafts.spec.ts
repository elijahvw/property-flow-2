import {test,expect,type Page} from '@playwright/test';
async function fixture(page:Page){
 const property={id:'home',name:'Maple House',address:'1 Maple Street',city:'City',state:'PA',zip:'19100',version:1};
 const unit={id:'unit',label:'First suite',propertyId:'home',status:'active',version:1},far={...unit,id:'far-unit',label:'Suite outside the first page'};
 const state={signedIn:true,drafts:new Map<string,any>(),posts:[] as any[],leases:new Map<string,any>(),abortLease:false,failDelete:false,stale:false,draftCreates:0};
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method(),json=(value:unknown,status=200)=>route.fulfill({json:value,status});
  if(path==='/api/bootstrap')return state.signedIn?json({user:{id:'owner',email:'owner@test.invalid',status:'active',emailVerified:true},membership:{companyId:'a',role:'owner',status:'active',version:1,company:{id:'a',name:'Fictional Properties',status:'active'}},permissions:['property.read','property.write','lease.manage','resident.assignment.manage'],destination:'/company/leases',csrfToken:'fixture'}):json({error:'Sign in required'},401);
  if(path==='/api/company/properties')return json([property]);
  if(path==='/api/company/properties/home')return json(property);
  if(path==='/api/company/units/far-unit')return json(far);
  if(path==='/api/company/properties/home/units')return json({items:[unit],nextCursor:null});
  if(path.endsWith('/residents'))return json([{userId:'tenant',membership:{user:{name:'Fixture Tenant',email:'tenant@test.invalid'}}}]);
  if(path==='/api/company/task-drafts'){
   if(method==='GET')return json({items:[...state.drafts.values()],hasMore:false});
   const b=request.postDataJSON();state.draftCreates++;
   const existing=[...state.drafts.values()].find(row=>row.submissionKey===b.submissionKey);if(existing)return json(existing);
   const row={id:'task-'+state.draftCreates,kind:b.kind,propertyId:b.propertyId,sourceId:b.sourceId||null,values:b.values,context:b.context,version:1,actionKey:crypto.randomUUID(),sourceVersions:{property:{id:'home',version:1}},title:'New lease · Maple House',savedAt:'2026-10-22T14:00:00Z',expiresAt:'2026-11-21T14:00:00Z',stale:state.stale,property,submissionKey:b.submissionKey};state.drafts.set(row.id,row);return json(row);
  }
  if(path.startsWith('/api/company/task-drafts/')){
   const id=path.split('/').at(-1)!,row=state.drafts.get(id);if(!row)return json({error:'Saved draft is unavailable.'},404);
   if(method==='GET')return json({...row,stale:state.stale});
   const b=request.postDataJSON();
   if(method==='DELETE'){if(state.failDelete)return json({error:'Draft cleanup interrupted'},503);state.drafts.delete(id);return json({deleted:true});}
   if(b.expectedVersion!==row.version)return json({error:'This record changed. Open the saved task again.'},409);
   if(b.reviewSources)state.stale=false;
   Object.assign(row,{values:b.values,context:b.context,version:row.version+1,stale:state.stale});return json(row);
  }
  if(path==='/api/company/leases'){
   if(method==='GET')return json({items:[],nextCursor:null});
   const b=request.postDataJSON();state.posts.push(b);let row=state.leases.get(b.submissionKey);
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
 await page.getByRole('button',{name:'Create lease record',exact:true}).click();await expect(page).toHaveURL(/company\/leases\/saved-lease\?onboarding=household/);expect(state.leases.size).toBe(1);
 await page.goto('/company/drafts?draftId='+id);await page.getByRole('button',{name:'Review lease',exact:true}).click();await page.getByRole('button',{name:'Create lease record',exact:true}).click();await expect(page).toHaveURL(/company\/leases\/saved-lease\?onboarding=household/);expect(state.posts).toHaveLength(2);expect(state.posts[0].submissionKey).toBe(state.posts[1].submissionKey);expect(state.leases.size).toBe(1);
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
