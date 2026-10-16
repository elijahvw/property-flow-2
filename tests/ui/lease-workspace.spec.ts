import {test,expect,Page} from '@playwright/test';

async function fixture(page:Page,role='owner'){
 const lease={id:'shared',propertyId:'home',unitId:'unit',residentId:'primary',version:1,status:'active',startsOn:'2020-01-01',endsOn:'2026-12-31',rentCents:100001,rentDueDay:1,graceDays:5,paymentInstructions:'Pay the owner',property:{name:'Oak House'},unit:{label:'Apartment 2'},resident:{name:'Jordan Rivera',email:'primary@test.invalid'},renewals:[]};
 const primary={id:'p-primary',userId:'primary',name:'Jordan Rivera',email:'primary@test.invalid',phone:null,role:'leaseholder',startsOn:'2020-01-01',endsOn:null,removedAt:null,version:1};
 const state={role,lease,status:200,previewStatus:200,failAdd:false,items:[primary] as any[],writes:[] as any[],requests:[] as string[],invitations:[{id:'invited',email:'alex@test.invalid',participantName:'Alex Rivera',participantRole:'occupant',approvedAt:null,acceptedAt:null,revokedAt:null,expiresAt:'2099-01-01'}] as any[]};
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname,json=(v:unknown,status=200)=>route.fulfill({json:v,status});state.requests.push(p);
  if(p==='/api/bootstrap')return json({user:{id:state.role,email:state.role+'@test.invalid',status:'active',emailVerified:true},membership:{companyId:'a',role:state.role,status:'active',version:1,company:{name:'Oak & Elm',status:'active'}},permissions:state.role==='owner'?['property.read','lease.manage','finance.manage','members.manage','resident.assignment.manage']:state.role==='resident'?['resident.self']:['property.read'],csrfToken:'fixture'});
  if(p==='/api/company/properties')return json([{id:'home',name:'Oak House'}]);
  if(p==='/api/company/overview')return json({company:{name:'Oak & Elm',timezone:'America/New_York'},property:null,today:'2026-10-15',generatedAt:'2026-10-15T12:00:00Z',propertyCount:1,activeUnitCount:1,properties:[],residentApprovals:{pendingCount:1},leases:{inEffectCount:1,monthlyRentCents:'100001',draftCount:0,endingSoonCount:1,pastEndCount:0,withoutCurrentLease:0,endingSoon:[]}});
  if(p==='/api/company/leases')return json({items:[lease],nextCursor:null});
  if(p==='/api/resident/properties')return json([{id:'home',name:'Oak House',address:'1 Oak Lane'}]);
  if(p==='/api/resident/leases')return json([lease]);
  if(p==='/api/invitations/preview')return state.previewStatus===200?json({company:'Oak & Elm',property:'Oak House',unit:'Apartment 2',name:'Taylor Occupant',role:'occupant',startsOn:'2026-11-01',leaseStartsOn:'2026-11-01',leaseEndsOn:'2027-10-31',leaseStatus:'active'}):json({error:'Invitation unavailable for your verified email'},state.previewStatus);
  if(p==='/api/invitations/accept'){state.writes.push(req.postDataJSON());return json({success:true});}
  if(p==='/api/company/leases/shared'){
   if(state.status!==200)return json({error:'Lease access unavailable'},state.status);
   if(req.method()==='PATCH'){const b=req.postDataJSON();state.writes.push(b);if(b.expectedVersion!==lease.version)return json({error:'This record changed. Reload before editing.'},409);Object.assign(lease,b,{version:lease.version+1});}
   return json(lease);
  }
  if(p==='/api/company/leases/shared/participants'){
   if(req.method()==='POST'){const b=req.postDataJSON();state.writes.push(b);if(state.failAdd)return json({error:'Unable to save resident'},503);state.items.push({...b,id:'added',version:1,removedAt:null});return json(state.items.at(-1));}
   return json({lease,businessDate:'2026-10-15',items:state.items,candidates:[]});
  }
  if(req.method()==='PATCH'&&p.startsWith('/api/company/leases/shared/participants/')){const b=req.postDataJSON();state.writes.push(b);const item=state.items.find(i=>p.endsWith('/'+i.id));Object.assign(item,b,{version:item.version+1});return json(item);}
  if(p.endsWith('/invitations')){
   if(req.method()==='POST'){const b=req.postDataJSON();state.writes.push(b);state.invitations.push({...b,id:'new-invite',participantName:b.name,participantRole:b.role,approvedAt:null,acceptedAt:null,revokedAt:null,expiresAt:'2099-01-01'});return json({acceptanceUrl:null});}
   return json(state.invitations);
  }
  if(p.endsWith('/approve')){state.writes.push({action:'approve'});state.invitations[0].approvedAt='2026-10-15';return json({acceptanceUrl:'https://app.test/invite#isolated-test-only'});}
  return json([]);
 });return state;
}

test('lease workspace keeps household drafts across section navigation and retries the same resident creation',async({page})=>{
 const state=await fixture(page);state.failAdd=true;
 await page.goto('/company/leases/shared?onboarding=household');
 await expect(page.getByRole('heading',{name:'Oak House · Apartment 2',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Add resident',exact:true}).click();
 await page.getByLabel('Resident full name',{exact:true}).fill('Taylor Tenant');
 await page.getByLabel('Resident contact phone',{exact:true}).fill('555-0100');
 await page.getByRole('button',{name:'Invitations & approvals',exact:true}).click();
 await page.getByRole('button',{name:'Leaseholders & occupants',exact:true}).click();
 await expect(page.getByLabel('Resident full name',{exact:true})).toHaveValue('Taylor Tenant');
 await page.getByRole('button',{name:'Add to household',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Unable to save');
 await expect(page.getByLabel('Resident contact phone',{exact:true})).toHaveValue('555-0100');
 state.failAdd=false;await page.getByRole('button',{name:'Add to household',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Taylor Tenant',exact:true})).toBeVisible();
 expect(state.writes[0].submissionKey).toBe(state.writes[1].submissionKey);
 await page.reload();await expect(page.getByRole('heading',{name:'Taylor Tenant',exact:true})).toBeVisible();
});

test('lease term drafts retain their reviewed version across dismissal and background changes',async({page})=>{
 const state=await fixture(page);await page.goto('/company/leases/shared');
 await page.getByRole('button',{name:'Review lease terms',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Review lease terms',exact:true});
 await dialog.getByLabel('Lease monthly rent (USD)',{exact:true}).fill('1200.00');
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 state.lease.version++;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByRole('button',{name:'Review lease terms',exact:true}).click();
 await expect(dialog.getByLabel('Lease monthly rent (USD)',{exact:true})).toHaveValue('1200.00');
 await dialog.getByRole('button',{name:'Save lease terms',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('record changed');expect(state.writes[0].expectedVersion).toBe(1);
 await dialog.getByRole('button',{name:'Discard lease changes',exact:true}).click();
 await page.getByRole('button',{name:'Review lease terms',exact:true}).click();
 await expect(dialog.getByLabel('Lease monthly rent (USD)',{exact:true})).toHaveValue('1000.01');
 const reads=state.requests.filter(p=>p==='/api/company/leases/shared').length;
 state.status=403;await expect.poll(async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('focus')));return state.requests.filter(p=>p==='/api/company/leases/shared').length;}).toBeGreaterThan(reads);
 await expect(page.getByRole('heading',{name:'Lease unavailable',exact:true})).toBeVisible();await expect(dialog).toHaveCount(0);
});

test('owner approval is explicit for an occupant invitation and phone layout remains navigable',async({page})=>{
 const state=await fixture(page);await page.setViewportSize({width:390,height:844});await page.goto('/company/leases/shared?section=invitations');
 await expect(page.locator('.record-list').getByText('Awaiting owner approval',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Approve resident Alex Rivera',exact:true}).click();
 await expect(page.getByLabel('Resident invitation acceptance link',{exact:true})).toHaveValue('https://app.test/invite#isolated-test-only');
 expect(state.writes[0].action).toBe('approve');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Renewal',exact:true}).click();await page.reload();
 await expect(page.getByRole('heading',{name:'Renew this lease',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Prepare linked renewal',exact:true})).toBeVisible();
});

test('leaseholders can request occupants without approving them or receiving an acceptance link',async({page})=>{
 const state=await fixture(page,'resident');state.invitations=[];
 await page.goto('/resident');await page.getByRole('button',{name:'Invite a resident · Apartment 2',exact:true}).click();
 await page.getByLabel('Invited resident name',{exact:true}).fill('Taylor Resident');await page.getByLabel('Invited resident email',{exact:true}).fill('taylor@test.invalid');
 await page.getByRole('button',{name:'Request owner approval',exact:true}).click();
 await expect(page.locator('.record-list').getByText('Awaiting owner approval',{exact:false})).toBeVisible();
 await expect(page.getByLabel('Resident invitation acceptance link',{exact:true})).toHaveCount(0);
 expect(state.requests.some(p=>p.endsWith('/approve'))).toBe(false);
 await expect(page.getByRole('button',{name:/Approve resident/})).toHaveCount(0);
});

for(const role of ['staff','resident'])test(`${role} cannot fetch the management lease workspace`,async({page})=>{
 const state=await fixture(page,role);await page.goto('/company/leases/shared');await expect(page.getByRole('heading',{name:'Access unavailable',exact:true})).toBeVisible();expect(state.requests.some(p=>p==='/api/company/leases/shared')).toBe(false);
});

test('lease invitation acceptance previews the unit, role and dates after removing the secret from the URL',async({page})=>{
 const state=await fixture(page,'resident');await page.goto('/invite?lease=1#isolated-test-token');
 await expect(page).toHaveURL(/\/invite$/);
 await expect(page.locator('.lease-review-summary')).toContainText('Oak House · Apartment 2');
 await expect(page.locator('.lease-review-summary')).toContainText('Taylor Occupant · Occupant');
 await expect(page.locator('.lease-review-summary')).toContainText('November 1, 2026');
 await expect(page.getByText(/does not give you access to the lease’s financial information/)).toBeVisible();
 expect(state.writes).toHaveLength(0);
 await page.getByRole('button',{name:'Accept household invitation',exact:true}).click();
 await expect(page).toHaveURL(/\/resident$/);expect(state.writes[0]).toEqual({token:'isolated-test-token'});
 expect(await page.evaluate(()=>sessionStorage.getItem('pf-invitation'))).toBeNull();
 expect(await page.evaluate(()=>sessionStorage.getItem('pf-lease-invitation'))).toBeNull();
});

test('unavailable lease invitation cannot be accepted without a valid preview',async({page})=>{
 const state=await fixture(page,'resident');state.previewStatus=403;await page.goto('/invite?lease=1#unavailable-test-token');
 await expect(page.getByRole('alert')).toContainText('Invitation unavailable');
 await expect(page.getByRole('button',{name:'Accept household invitation',exact:true})).toHaveCount(0);expect(state.writes).toHaveLength(0);
});

test('owner review explicitly approves a copied renewal leaseholder before enabling portal access',async({page})=>{
 const state=await fixture(page);state.items.push({...state.items[0],id:'copied-holder',userId:'copied-user',name:'Cameron Co Tenant',portalApproved:false});
 await page.goto('/company/leases/shared?section=household');await expect(page.getByText(/Owner review required/)).toBeVisible();
 await page.getByRole('button',{name:'Manage resident Cameron Co Tenant',exact:true}).click();
 const approval=page.getByRole('checkbox',{name:/Approve this leaseholder’s portal access/});await expect(approval).not.toBeChecked();await approval.check();
 await page.getByRole('button',{name:'Save household resident',exact:true}).click();expect(state.writes[0].portalApproved).toBe(true);
 await expect(page.getByText(/Owner review required/)).toHaveCount(0);
});

test('owner attention queue opens the relevant approval section and preserves the return filter',async({page})=>{
 await fixture(page);await page.goto('/company/overview');await page.getByRole('link',{name:/Approve resident requests/}).click();
 await expect(page).toHaveURL(/\/company\/leases\?approvals=pending$/);await expect(page.getByLabel('Lease view',{exact:true})).toHaveValue('resident_approvals');
 await page.getByRole('link',{name:'Open lease workspace',exact:true}).click();await expect(page.getByRole('heading',{name:'Invite and approve residents',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'← All leases',exact:true}).click();await expect(page).toHaveURL(/\/company\/leases\?approvals=pending$/);
});
