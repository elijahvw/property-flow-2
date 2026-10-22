import { test, expect, Page } from '@playwright/test';

async function fixture(page: Page, role = 'owner') {
  const rent = {outstandingCents:'75001',afterGraceCents:'75001',creditCents:'3002',upcomingCents:'0',withinGraceCents:'0',dueTodayCents:'0'};
  const deposits = {requiredCents:'150000',heldCents:'75050',outstandingCents:'74950',excessHeldCents:'0',pastDueCents:'0'};
  const profile = {userId:'auth0|tenant',status:'active',version:1,contactName:'Jordan Rivera',contactPhone:'555-0142',emergencyContactName:'Alex Rivera',emergencyContactPhone:'555-0143',managementNotes:'Private management note',user:{name:'Jordan Rivera',email:'jordan@test.invalid',status:'active',emailVerified:true},assignments:[{property:{id:'home',name:'Maple House',address:'14 Maple Lane'}}],activity:[]};
  const lease = {id:'lease-a',propertyId:'home',startsOn:'2026-01-01',endsOn:'2026-12-31',status:'active',rentCents:100001,rentDueDay:1,graceDays:5,property:{name:'Maple House'},unit:{label:'Apartment 1'},rent,deposit:{...deposits,id:'deposit-a',reference:'DA-101',dueOn:'2026-01-01'}};
  const state = {profileStatus:200,financialStatus:200,role,profile,workspace:{businessDate:'2026-10-15',timezone:'America/New_York',generatedAt:'2026-10-15T12:00:00Z',rent,deposits,leases:[lease,{...lease,id:'lease-ended',status:'ended',startsOn:'2025-01-01',endsOn:'2025-12-31',unit:{label:'Former apartment'},rent:{...rent,outstandingCents:'0',afterGraceCents:'0'},deposit:null}] as any[]},requests:[] as string[],writes:[] as any[],otherProfiles:[] as typeof profile[]};
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),p=url.pathname,json=(v:unknown,status=200)=>route.fulfill({json:v,status});
    state.requests.push(p+url.search);
    if(p==='/api/bootstrap')return json({user:{id:role,email:role+'@test.invalid',status:'active',emailVerified:true},membership:{companyId:'a',role:state.role,status:'active',version:1,company:{name:'Oak & Elm Properties',status:'active'}},permissions:['owner','manager'].includes(state.role)?['property.read','resident.assignment.manage','lease.manage','finance.manage',...(state.role==='owner'?['members.manage']:[])]:state.role==='staff'?['property.read']:state.role==='resident'?['resident.self']:['platform.manage'],csrfToken:'fixture'});
    if(p==='/api/company/properties')return json([{id:'home',name:'Maple House'}]);
    if(p==='/api/company/properties/home')return json({id:'home',name:'Maple House'});
    if(p==='/api/company/resident-profiles')return json([profile,...state.otherProfiles]);
    if(p.endsWith('/workspace'))return state.financialStatus===200?json(state.workspace):json({error:'Tenant financial information unavailable'},state.financialStatus);
    if(p==='/api/company/resident-profiles/auth0%7Ctenant'||p==='/api/company/resident-profiles/auth0|tenant'){
      if(state.profileStatus!==200)return json({error:'Tenant access unavailable'},state.profileStatus);
      if(req.method()==='PATCH'){
        const b=req.postDataJSON();state.writes.push(b);
        if(b.expectedVersion!==profile.version)return json({error:'This record changed. Reload before editing.'},409);
        Object.assign(profile,b,{version:profile.version+1});
      }
      return json(profile);
    }
    if(p==='/api/company/rent')return json({businessDate:'2026-10-15',generatedAt:'2026-10-15T12:00:00Z',accounts:[{lease:{...lease,version:1,resident:profile.user},summary:{...rent,chargedCents:'100001',paidCents:'25000',overdueCents:'75001',netCents:'75001',age1To30Cents:'75001',age31To60Cents:'0',age61To90Cents:'0',age91PlusCents:'0'},charges:[],payments:[],allocations:[]}]});
    if(/^\/api\/company\/deposits\//.test(p))return json({businessDate:'2026-10-15',lease:{...lease,version:1},account:null});
    if(p==='/api/company/deposits')return json({businessDate:'2026-10-15',accounts:[],summary:deposits});
    if(p==='/api/invitations')return json([]);
    return json([]);
  });
  return state;
}

test('tenant deep links, source ledgers and directory filters survive refresh and return',async({page})=>{
  await fixture(page);
  await page.goto('/company/residents?residentId=auth0%7Ctenant&q=Jordan&access=active');
  await expect(page).toHaveURL(/residents\/auth0%7Ctenant\?q=Jordan&access=active/);
  await expect(page.getByRole('heading',{name:'Jordan Rivera',exact:true})).toBeVisible();
  const metrics=page.getByRole('region',{name:'Tenant balance overview'});
  for(const amount of ['$750.01','$30.02','$750.50','$749.50'])await expect(metrics).toContainText(amount);
  await expect(metrics).toContainText('October 15, 2026');
  await expect(page.getByRole('region',{name:'Tenant leases'})).toContainText('January 1, 2026');
  await page.getByRole('link',{name:'View rent and payments for Apartment 1'}).click();
  await expect(page.getByRole('heading',{name:'Rent & payments',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Back to tenant'}).click();
  await page.reload();
  await page.getByRole('link',{name:'All tenants',exact:true}).click();
  await expect(page.getByLabel('Find resident')).toHaveValue('Jordan');
  await expect(page.getByLabel('Portal access', {exact:true})).toHaveValue('active');
});

test('financial errors hide old totals and recover independently from contact details',async({page})=>{
  const state=await fixture(page);await page.goto('/company/residents/auth0%7Ctenant');
  await expect(page.getByRole('region',{name:'Tenant balance overview'})).toBeVisible();
  state.financialStatus=422;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading',{name:'Balances and leases unavailable'})).toBeVisible();
  await expect(page.getByRole('region',{name:'Tenant balance overview'})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Jordan Rivera',exact:true})).toBeVisible();
  await expect(page.getByText('Private management note',{exact:true})).toBeVisible();
  state.financialStatus=200;await page.getByRole('button',{name:'Try balances again'}).click();
  await expect(page.getByRole('region',{name:'Tenant balance overview'})).toContainText('$750.01');
});

test('contact drafts survive dismissal and do not absorb background record versions',async({page})=>{
  const state=await fixture(page);await page.goto('/company/residents/auth0%7Ctenant');
  const edit=page.getByRole('button',{name:'Edit resident profile',exact:true});await edit.click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Contact phone',{exact:true}).fill('555-9999');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Save draft & close',exact:true}).click();
  state.profile.version++;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await edit.click();await expect(dialog.getByLabel('Contact phone',{exact:true})).toHaveValue('555-9999');
  await dialog.getByRole('button',{name:'Save resident profile',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('record changed');
  expect(state.writes[0].expectedVersion).toBe(1);
  await dialog.getByRole('button',{name:'Discard edits'}).click();
  await dialog.getByRole('button',{name:'Edit resident profile',exact:true}).click();
  await expect(dialog.getByLabel('Contact phone',{exact:true})).toHaveValue('555-0142');
});

test('revoked profile clears private content and closes an open editor',async({page})=>{
  const state=await fixture(page);await page.goto('/company/residents/auth0%7Ctenant');
  await page.getByRole('button',{name:'Edit resident profile',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  state.profileStatus=403;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading',{name:'Tenant unavailable'})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Private management note',{exact:true})).toHaveCount(0);
});

test('management history filters and mobile layouts remain usable without portal access',async({page})=>{
  const state=await fixture(page,'manager');state.profile.status='disabled';state.profile.assignments=[];
  await page.setViewportSize({width:390,height:844});await page.goto('/company/residents/auth0%7Ctenant');
  await expect(page.getByText('Portal disabled',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Edit tenant access'})).toHaveCount(0);
  await page.getByLabel('Lease status',{exact:true}).selectOption('ended');
  await expect(page.getByRole('heading',{name:'Former apartment',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Apartment 1',exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('link',{name:'All tenants',exact:true}).click();
  await expect(page.getByRole('link',{name:'View tenant Jordan Rivera',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const role of ['staff','resident','platform'])test(`${role} cannot fetch a tenant management deep link`,async({page})=>{
  const state=await fixture(page,role);await page.goto('/company/residents/auth0%7Ctenant');
  await expect(page.getByRole('heading',{name:'Access unavailable'})).toBeVisible();
  expect(state.requests.some(p=>p.startsWith('/api/company/resident-profiles'))).toBe(false);
});

test('empty rental history offers a real next step and an unavailable tenant has a safe exit',async({page})=>{
 const state=await fixture(page);state.workspace.leases=[];
 for(const key of Object.keys(state.workspace.rent))state.workspace.rent[key as keyof typeof state.workspace.rent]='0';
 for(const key of Object.keys(state.workspace.deposits))state.workspace.deposits[key as keyof typeof state.workspace.deposits]='0';
 await page.goto('/company/residents/auth0%7Ctenant');
 await expect(page.getByRole('heading',{name:'No lease recorded yet'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Record a lease',exact:true})).toHaveAttribute('href','/company/leases?new=lease');
 state.profileStatus=404;await page.reload();await expect(page.getByRole('heading',{name:'Tenant unavailable'})).toBeVisible();
 await expect(page.getByRole('link',{name:'All tenants',exact:true})).toHaveAttribute('href','/company/residents');
});


test('active, unverified and disabled portal filters remain distinct and survive a ledger round trip',async({page})=>{
 const state=await fixture(page);
 state.otherProfiles.push({...state.profile,userId:'pending',contactName:'Pending Tenant',user:{...state.profile.user,emailVerified:false}}, {...state.profile,userId:'disabled',contactName:'Disabled Tenant',status:'disabled'});
 await page.goto('/company/residents');
 const filter=page.getByLabel('Portal access',{exact:true});
 await filter.selectOption('active');
 await expect(page.getByRole('link',{name:/View tenant/})).toHaveCount(1);
 await expect(page.getByRole('link',{name:'View tenant Jordan Rivera',exact:true})).toBeVisible();
 await filter.selectOption('verification');
 await expect(page.getByRole('link',{name:/View tenant/})).toHaveCount(1);
 await expect(page.getByRole('link',{name:'View tenant Pending Tenant',exact:true})).toBeVisible();
 await page.reload();await expect(filter).toHaveValue('verification');
 await filter.selectOption('disabled');
 await expect(page.getByRole('link',{name:/View tenant/})).toHaveCount(1);
 await expect(page.getByRole('link',{name:'View tenant Disabled Tenant',exact:true})).toBeVisible();
 state.profile.user.emailVerified=false;
 await page.goto('/company/residents/auth0%7Ctenant?access=verification');
 await expect(page.getByText('Verification needed',{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'View rent and payments for Apartment 1'}).click();
 await page.getByRole('link',{name:'Back to tenant'}).click();
 await page.getByRole('link',{name:'All tenants',exact:true}).click();
 await expect(filter).toHaveValue('verification');
 await expect(page.getByRole('link',{name:/View tenant/})).toHaveCount(2);
});

test('property and rental filters match the same association and survive a tenant-ledger return',async({page})=>{
 const state=await fixture(page);
 const relationship={leaseId:'old',propertyId:'home',propertyName:'Maple House',unitLabel:'Former apartment',role:'leaseholder',status:'former',startsOn:'2025-01-01',endsOn:'2025-12-31'};
 (state.profile as any).rentals=[relationship,{...relationship,leaseId:'current',propertyId:'garden',propertyName:'Garden Apartments',unitLabel:'Unit 2',status:'current',startsOn:'2026-01-01',endsOn:null}];
 state.otherProfiles.push({...state.profile,userId:'tenant-2',contactName:'Taylor Smith',user:{...state.profile.user,name:'Taylor Smith',email:'taylor@test.invalid'},rentals:[{...relationship,leaseId:'home-current',status:'current',startsOn:'2026-01-01',endsOn:null}]} as any);
 await page.goto('/company/residents');await page.getByLabel('Property',{exact:true}).selectOption('home');await page.getByLabel('Rental relationship',{exact:true}).selectOption('current');
 await expect(page.getByRole('link',{name:'Jordan Rivera',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Taylor Smith',exact:true})).toBeVisible();
 await page.getByLabel('Property',{exact:true}).selectOption('garden');await expect(page.getByRole('link',{name:'Garden Apartments Unit 2',exact:true})).toHaveAttribute('href',/tenantProperty=garden.*tenantRental=current/);await page.getByRole('link',{name:'Jordan Rivera',exact:true}).click();await page.getByRole('link',{name:'View rent and payments for Apartment 1'}).click();await page.getByRole('link',{name:'Back to tenant'}).click();await page.getByRole('link',{name:'All tenants',exact:true}).click();
 await expect(page.getByLabel('Property',{exact:true})).toHaveValue('garden');await expect(page.getByLabel('Rental relationship',{exact:true})).toHaveValue('current');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});
