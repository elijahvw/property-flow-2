import {test,expect,Page} from '@playwright/test';
async function fixture(page:Page,role='manager'){
 const state={company:'a',overviewStatus:200,requests:[] as string[],keys:[] as string[],lose:false,leases:[] as any[],properties:[{id:'home',name:'Maple House',address:'12 Maple Street',city:'Atlanta',state:'GA',zip:'30301',version:1},{id:'second',name:'Garden Apartments',address:'21 Garden Lane',city:'Atlanta',state:'GA',zip:'30302',version:1}]};
 await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url()),p=u.pathname,json=(v:unknown,status=200)=>route.fulfill({json:v,status});state.requests.push(u.pathname+u.search);
  const manager=['owner','manager'].includes(role),read=manager||role==='staff';
  if(p==='/api/bootstrap')return json({user:{id:role,email:role+'@test.invalid',name:'Taylor Morgan',status:'active',emailVerified:true},membership:{companyId:state.company,version:1,role,status:'active',company:{name:state.company==='a'?'FAP':'Company B',status:'active'}},permissions:manager?['property.read','property.write','lease.manage','finance.manage','maintenance.manage','resident.assignment.manage',...(role==='owner'?['members.manage','company.manage']:[])]:role==='staff'?['property.read']:role==='resident'?['resident.self']:['platform.manage'],destination:read?'/company/overview':role==='resident'?'/resident':'/platform/companies',csrfToken:'fixture'});
  if(p==='/api/company/properties')return json(state.properties);
  if(/^\/api\/company\/properties\/[^/]+$/.test(p))return json(state.properties.find(x=>p.endsWith('/'+x.id))||{},200);
  if(p==='/api/company/overview'){
   if(state.overviewStatus!==200)return json({error:'Overview temporarily unavailable'},state.overviewStatus);
   return json({company:{name:'FAP',timezone:'America/New_York'},today:'2026-10-15',generatedAt:'2026-10-15T15:30:00Z',property:u.searchParams.has('propertyId')?state.properties[0]:null,propertyCount:2,activeUnitCount:60,properties:state.properties.map(x=>({...x,_count:{units:x.id==='home'?50:10}})),...(manager?{leases:{inEffectCount:52,monthlyRentCents:'6500000',draftCount:3,endingSoonCount:2,pastEndCount:1,withoutCurrentLease:8,endingSoon:[{id:'l1',propertyId:'home',endsOn:'2026-10-31',property:{name:'Maple House'},unit:{label:'Apartment 1'}}]},maintenance:{openCount:4,highPriorityCount:1,latest:[]},cash:{dateFrom:'2026-10-01',dateTo:'2026-10-15',incomeCents:'6200000',expenseCents:'820000',netCents:'5380000'}}:{})});
  }
  if(p.endsWith('/units'))return json({items:[{id:'unit-'+p.split('/')[4],propertyId:p.split('/')[4],label:'Apartment 1',status:'active',version:1}],nextCursor:null});
  if(p.endsWith('/residents'))return json([{userId:'r1',membership:{user:{name:'Jordan Resident',email:'resident@test.invalid'}}}]);
  if(p==='/api/company/residents')return json([{userId:'r1',user:{name:'Jordan Resident',email:'resident@test.invalid'}}]);
  if(req.method()==='GET'&&/^\/api\/company\/leases\/[^/]+(?:\/participants)?$/.test(p)){
   const row=state.leases.find(x=>x.id===p.split('/')[4]);
   return p.endsWith('/participants')?json({lease:row,items:[],candidates:[]}):json(row);
  }
  if(p==='/api/company/leases'){
   if(req.method()==='POST'){const body=req.postDataJSON();state.keys.push(body.submissionKey);let row=state.leases.find(x=>x.submissionKey===body.submissionKey);if(!row){row={...body,id:'lease-'+state.leases.length,rentCents:120000,version:1,property:{name:state.properties.find(x=>x.id===body.propertyId)?.name},unit:{label:'Apartment 1'},resident:{name:'Jordan Resident',email:'resident@test.invalid'}};state.leases.push(row);}if(state.lose){state.lose=false;return route.abort('failed');}return json(row);}
   return json({items:state.leases.filter(l=>(!u.searchParams.get('propertyId')||l.propertyId===u.searchParams.get('propertyId'))&&(!u.searchParams.get('status')||l.status===u.searchParams.get('status'))),nextCursor:null});
  }
  if(p==='/api/company/reports/context')return json({name:'FAP',timezone:'America/New_York',today:'2026-10-15'});
  if(p==='/api/company/finances')return json({items:[],nextCursor:null,summary:{incomeCents:'0',expenseCents:'0',netCents:'0'}});
    if (p === "/api/company/rent")
      return json({ businessDate: "2026-10-15", accounts: [] });
    if (p === "/api/company/deposits")
      return json({
        businessDate: "2026-10-15",
        accounts: [],
        summary: {
          requiredCents: "0",
          heldCents: "0",
          outstandingCents: "0",
          excessHeldCents: "0",
          pastDueCents: "0",
        },
      });
    if (p === "/api/company/reports/cash")
      return json({
        kind: "cash",
        company: { name: "FAP", timezone: "America/New_York" },
        generatedAt: "2026-10-15T12:00:00Z",
        basis: "Recorded cash",
        filters: {
          propertyId: u.searchParams.get("propertyId"),
          dateFrom: u.searchParams.get("dateFrom"),
          dateTo: u.searchParams.get("dateTo"),
        },
        summary: {
          incomeCents: "0",
          expenseCents: "0",
          netCents: "0",
          depositReceivedCents: "0",
          cashMovementCents: "0",
          includedCount: 0,
          voidedCount: 0,
        },
        items: [],
        groups: [],
      });
  if(p==='/api/company/maintenance/directory')return json({companyId:state.company,items:[],total:0,statusCounts:{open:0,in_progress:0,resolved:0},pageSize:50,nextCursor:null,previousCursor:null});
  if(p==='/api/company/maintenance')return json([]);
  return json([]);
 });return state;
}
test('role overview is actionable, grouped and responsive; failed load never invents zeros',async({page})=>{
 const state=await fixture(page);await page.goto('/dashboard');await expect(page).toHaveURL(/\/company\/overview$/);await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Portfolio snapshot'})).toContainText('60');await expect(page.locator('.cash-summary')).toContainText('$53,800.00');
 await page.screenshot({path:'/tmp/pf-connected-overview-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/pf-connected-overview-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('navigation',{name:'Main navigation'})).not.toBeVisible();await page.getByRole('button',{name:'Menu',exact:true}).click();await expect(page.getByRole('navigation',{name:'Main navigation'})).toBeVisible();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Leases',exact:true}).click();await expect(page.getByRole('navigation',{name:'Main navigation'})).not.toBeVisible();
 await page.goto('/company/overview');state.overviewStatus=503;await page.reload();await expect(page.getByRole('alert')).toContainText('temporarily unavailable');await expect(page.getByRole('region',{name:'Portfolio snapshot'})).toHaveCount(0);state.overviewStatus=200;await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.getByRole('region',{name:'Portfolio snapshot'})).toBeVisible();
});
test('property tabs carry context through lease history, residents, finances, and reports without opening creation',async({page})=>{
 const state=await fixture(page);await page.goto('/company/properties/home/units');await page.getByRole('navigation',{name:'Property navigation'}).getByRole('link',{name:'Leases',exact:true}).click();await expect(page).toHaveURL(/\/company\/properties\/home\/leases$/);await expect(page.getByRole('heading',{name:'Maple House · Leases',exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Properties',exact:true})).toHaveAttribute('aria-current','page');await expect(page.getByRole('dialog')).not.toBeVisible();await expect.poll(()=>state.requests.some(x=>x.startsWith('/api/company/leases?')&&x.includes('propertyId=home'))).toBe(true);
 await page.getByRole('navigation',{name:'Property navigation'}).getByRole('link',{name:'Tenant access',exact:true}).click();await expect(page.getByRole('heading',{name:'Tenant access'})).toBeVisible();await expect(page.getByText('Jordan Resident',{exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'Property navigation'}).getByRole('link',{name:'Cash activity',exact:true}).click();await expect(page.getByLabel('Filter property')).toHaveValue('home');await page.getByRole('button',{name:'Record a transaction',exact:true}).click();await expect(page.getByLabel('Transaction property')).toHaveValue('home');await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('navigation',{name:'Property navigation'}).getByRole('link',{name:'Reports',exact:true}).click();await expect(page.getByLabel('Report property')).toHaveValue('home');
});
test('mobile property sections retain the selected property across operating workflows',async({page})=>{
 const runtimeErrors:string[]=[];
 const recordError=(kind:string,message:string)=>{if(runtimeErrors.length<12)runtimeErrors.push(`${kind} at ${page.url()}: ${message.slice(0,2400)}`);};
 page.on('pageerror',error=>recordError('pageerror',error.stack||error.message));
 page.on('console',message=>{if(message.type()==='error')recordError('console.error',message.text());});
 try{
  const state=await fixture(page);await page.setViewportSize({width:390,height:844});await page.goto('/company/properties/home/units');
  await expect(page.getByRole('combobox',{name:'Property section',exact:true})).toBeVisible();
  for(const module of ['leases','maintenance','rent','deposits','finances','reports']){
   await test.step(`Open the property's ${module} section`,async()=>{
    const target='/company/properties/home/'+module;
    await page.getByRole('combobox',{name:'Property section',exact:true}).selectOption(target);
    await expect(page).toHaveURL(new RegExp(target+'$'));
    await expect(page.getByRole('combobox',{name:'Property section',exact:true})).toHaveValue(target);
    await expect(page.getByRole('region',{name:'Property workspace'})).toContainText('Maple House');
    await expect(page.getByRole('heading',{name:'Something went wrong',exact:true})).toHaveCount(0);
   });
  }
  expect(state.requests.some(url=>url.startsWith('/api/company/leases?')&&url.includes('propertyId=home'))).toBe(true);
 }finally{
  if(runtimeErrors.length)await test.info().attach('property-sections-runtime-errors',{body:runtimeErrors.join('\n\n'),contentType:'text/plain'});
 }
});
test('saving is primary; draft discard is quiet and confirmed, and property switching retains ambiguous saves',async({page})=>{
 const state=await fixture(page);state.lose=true;
 const editor=page.getByRole('region',{name:'Record a lease',exact:true});
 const active=page.locator('.lease-property-draft:not([hidden])');
 await page.goto('/company/leases?propertyId=home&new=lease');
 await active.getByLabel('New lease start date').fill('2026-10-01');
 await active.getByLabel('New lease monthly rent (USD)').fill('1200.00');
 const save=active.getByRole('button',{name:'Review lease',exact:true}),reset=active.getByRole('button',{name:'Clear draft',exact:true});
 // Page intake scrolls with the document. Its primary action and quieter
 // discard action must remain reachable together at the end of the form.
 await save.scrollIntoViewIfNeeded();
 await expect(save).toBeInViewport({ratio:1});await expect(reset).toBeInViewport({ratio:1});
 const a=await save.boundingBox(),b=await reset.boundingBox();
 expect(b!.width).toBeLessThan(a!.width);expect(Math.abs(b!.y-a!.y)).toBeLessThan(12);
 await expect(reset).toHaveClass(/text-button/);await expect(save).toHaveAttribute('type','submit');
 await page.screenshot({path:'/tmp/pf-connected-lease-desktop.png',fullPage:true});
 await save.click();await active.getByRole('button',{name:'Create lease record',exact:true}).click();
 await expect(active.getByRole('alert')).toBeVisible();
 await page.getByLabel('Property for new lease').selectOption('second');
 await active.getByLabel('New lease monthly rent (USD)').fill('1350');
 await page.getByLabel('Property for new lease').selectOption('home');
 await expect(active.getByLabel('New lease monthly rent (USD)')).toHaveValue('1200.00');
 await active.getByRole('button',{name:'Create lease record',exact:true}).click();
 const recorded=active.getByRole('link',{name:'Open the recorded lease workspace',exact:true});
 await expect(recorded).toBeVisible();await expect(editor).toBeVisible();
 expect(state.keys[0]).toBe(state.keys[1]);expect(state.leases).toHaveLength(1);
 expect(state.leases[0].propertyId).toBe('home');expect(state.leases[0].monthlyRent).toBe('1200.00');
 await page.getByLabel('Property for new lease').selectOption('second');
 await expect(active.getByLabel('New lease monthly rent (USD)')).toHaveValue('1350');
 await page.getByLabel('Property for new lease').selectOption('home');
 page.once('dialog',async dialog=>{expect(dialog.type()).toBe('confirm');expect(dialog.message()).toContain('discard its unsaved changes');await dialog.dismiss();});
 await recorded.click();await expect(editor).toBeVisible();
 await page.getByLabel('Property for new lease').selectOption('second');
 await expect(active.getByLabel('New lease monthly rent (USD)')).toHaveValue('1350');
 await page.getByLabel('Property for new lease').selectOption('home');
 page.once('dialog',dialog=>dialog.accept());await recorded.click();
 await expect(page).toHaveURL(/\/company\/leases\/lease-0\?onboarding=household/);
 await expect(editor).not.toBeVisible();expect(state.leases).toHaveLength(1);
 await page.getByRole('link',{name:'← All leases',exact:true}).click();
 await page.getByRole('button',{name:'Record a lease',exact:true}).click();
 await page.getByLabel('Property for new lease').selectOption('home');
 await active.getByLabel('New lease monthly rent (USD)').fill('777');
 await reset.click();await page.getByRole('button',{name:'Keep editing',exact:true}).click();
 await expect(active.getByLabel('New lease monthly rent (USD)')).toHaveValue('777');
 await reset.click();await page.getByRole('button',{name:'Discard draft',exact:true}).click();
 await expect(active.getByLabel('New lease monthly rent (USD)')).toHaveValue('');
 await page.setViewportSize({width:390,height:844});
 await save.scrollIntoViewIfNeeded();await expect(save).toBeInViewport({ratio:1});await expect(reset).toBeInViewport({ratio:1});
 await expect(reset).toHaveClass(/text-button/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'/tmp/pf-connected-lease-mobile.png',fullPage:true});
});
test('attention links select matching views; staff never gets management data, and property search works by keyboard',async({page})=>{
 await fixture(page);await page.goto('/company/overview');await page.getByRole('link',{name:/Finish draft leases/}).click();await expect(page.getByRole('combobox',{name:'Lease view',exact:true})).toHaveValue('draft');await page.keyboard.press('Control+k');await expect(page.getByRole('dialog',{name:'Search workspace'})).toBeVisible();await page.getByRole('searchbox',{name:'Search workspace',exact:true}).fill('Garden');await page.getByRole('link',{name:/Garden Apartments/}).click();await expect(page).toHaveURL(/\/company\/properties\/second$/);
 await page.unroute('**/api/**');const state=await fixture(page,'staff');await page.goto('/dashboard');await expect(page.getByRole('region',{name:'Portfolio snapshot'})).toBeVisible();await expect(page.getByRole('heading',{name:'Month to date'})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Needs attention'})).toHaveCount(0);expect(state.requests.some(x=>/finances|reports|maintenance|leases/.test(x))).toBe(false);
});

test('company leases identify properties with the same unit label and property drilldowns stay scoped',async({page})=>{
 const state=await fixture(page);state.leases=state.properties.map((property,i)=>({id:'lease-'+i,propertyId:property.id,unit:{label:'101'},property:{name:property.name},resident:{name:'Resident '+i,email:'r'+i+'@test.invalid'},startsOn:'2026-01-01',endsOn:'2026-12-31',status:'active',rentCents:120000,version:1,renewals:[]}));
 await page.goto('/company/leases');await expect(page.getByRole('row').filter({hasText:'Maple House'}).filter({hasText:'101'})).toBeVisible();await expect(page.getByRole('row').filter({hasText:'Garden Apartments'}).filter({hasText:'101'})).toBeVisible();await page.getByRole('row').filter({hasText:'Maple House'}).filter({hasText:'101'}).getByRole('link',{name:'Maple House',exact:true}).click();await expect(page).toHaveURL(/\/company\/properties\/home\/leases$/);await expect(page.getByRole('row').filter({hasText:'Garden Apartments'}).filter({hasText:'101'})).toHaveCount(0);await page.getByRole('combobox',{name:'Lease view',exact:true}).selectOption('active');await expect(page).toHaveURL(/\/company\/properties\/home\/leases\?status=active$/);await page.reload();await expect(page.getByRole('heading',{name:'Maple House · Leases',exact:true})).toBeVisible();await page.getByRole('button',{name:'Record a lease',exact:true}).click();await expect(page.getByLabel('Property for new lease').locator('option')).toHaveText(['Choose a property','Maple House']);
});

for (const [module, title, endpoint] of [
  ["maintenance", "Maintenance", "maintenance"],
  ["rent", "Rent & payments", "rent"],
  ["finances", "Cash activity", "finances"],
  ["reports", "Reports", "reports/context"],
  ["deposits", "Deposits", "deposits"],
]) {
  test(`property ${module} tab stays nested, highlights the property and preserves context after reload`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await page.goto("/company/properties/home/leases");
    await page
      .getByRole("navigation", { name: "Property navigation" })
      .getByRole("link", { name: title, exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp("/company/properties/home/" + module + "$"),
    );
    await expect(
      page.getByRole("region", { name: "Property workspace" }),
    ).toContainText("Maple House");
    await expect(
      page
        .getByRole("navigation", { name: "Property navigation" })
        .getByRole("link", { name: title, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Properties", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    if (module === "maintenance")
      await page.getByLabel("Filter status").selectOption("resolved");
    if (module === "finances") {
      await page.getByLabel("From date").fill("2026-10-01");
      await page.getByRole("button", { name: "Apply filters" }).click();
    }
    if (module === "reports") {
      await page.getByLabel("From date").fill("2026-10-01");
      await page.getByRole("button", { name: "Generate report" }).click();
      await expect(
        page.getByRole("button", { name: "Download CSV" }),
      ).toBeVisible();
    }
    await page.reload();
    await expect(page).toHaveURL(
      new RegExp("/company/properties/home/" + module),
    );
    await expect(
      page.getByRole("region", { name: "Property workspace" }),
    ).toContainText("Maple House");
    if (module === "maintenance")
      await expect(page.getByLabel("Filter status")).toHaveValue("resolved");
    if (module === "finances" || module === "reports")
      await expect(page.getByLabel("From date")).toHaveValue("2026-10-01");
    if (["maintenance", "finances", "reports"].includes(module))
      await expect(
        page
          .getByLabel(
            module === "reports" ? "Report property" : "Filter property",
          )
          .locator("option"),
      ).toHaveText(["Maple House"]);
    await expect
      .poll(() =>
        state.requests.some(
          (x) =>
            x.startsWith("/api/company/" + endpoint) &&
            (module === "reports" || x.includes("propertyId=home")),
        ),
      )
      .toBe(true);
    const company = page.getByRole("link", {
      name: "All company " + title.toLowerCase(),
      exact: true,
    });
    await expect(company).toHaveAttribute("href", "/company/" + module);
    await company.click();
    await expect(page).toHaveURL(new RegExp("/company/" + module + "$"));
    await expect(
      page.getByRole("region", { name: "Property workspace" }),
    ).toHaveCount(0);
  });
}
test("staff cannot bypass permission gates through nested property money and maintenance routes", async ({
  page,
}) => {
  const state = await fixture(page, "staff");
  for (const module of [
    "rent",
    "deposits",
    "finances",
    "reports",
    "maintenance",
  ]) {
    await page.goto("/company/properties/home/" + module);
    await expect(
      page.getByRole("heading", { name: "Access unavailable" }),
    ).toBeVisible();
  }
  expect(
    state.requests.some((x) =>
      /\/api\/company\/(rent|deposits|finances|reports|maintenance)/.test(x),
    ),
  ).toBe(false);
});

test('property finance filter history restores dates without discarding an unsaved transaction',async({page})=>{
 await fixture(page);await page.goto('/company/properties/home/finances');await page.getByRole('button',{name:'Record a transaction',exact:true}).click();await page.getByLabel('Amount (USD)',{exact:true}).fill('123.45');await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Save draft & close',exact:true}).click();
 for(const day of ['2026-10-01','2026-10-02']){await page.getByLabel('From date').fill(day);await page.getByRole('button',{name:'Apply filters'}).click();await expect(page).toHaveURL(new RegExp('dateFrom='+day));}
 await page.goBack();await expect(page.getByLabel('From date')).toHaveValue('2026-10-01');await page.getByRole('button',{name:'Record a transaction',exact:true}).click();await expect(page.getByLabel('Amount (USD)',{exact:true})).toHaveValue('123.45');
});

for(const module of ['reports','finances'])test(`property ${module} API scope survives an unavailable property picker`,async({page})=>{
 const state=await fixture(page);await page.route('**/api/company/properties',route=>route.fulfill({status:503,json:{error:'Properties temporarily unavailable'}}));await page.goto('/company/properties/home/'+module);
 await page.getByRole('button',{name:module==='reports'?'Generate report':'Apply filters'}).click();await expect.poll(()=>state.requests.filter(x=>x.startsWith('/api/company/'+(module==='reports'?'reports/cash':'finances')+'?')).length).toBeGreaterThan(0);
 const calls=state.requests.filter(x=>x.startsWith('/api/company/'+(module==='reports'?'reports/cash':'finances')+'?'));expect(calls.every(x=>new URL('https://fixture.test'+x).searchParams.get('propertyId')==='home')).toBe(true);
 await expect(page).toHaveURL(new RegExp('/company/properties/home/'+module));
});
