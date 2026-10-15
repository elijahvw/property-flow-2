import {test,expect,Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function fixture(page:Page,role='owner'){
 const state={company:'a',status:200,requests:[] as string[],income:'5151',count:51};
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname,json=(v:unknown,status=200)=>route.fulfill({json:v,status});
  if(path==='/api/bootstrap')return json({user:{id:role,email:role+'@test.invalid',status:'active'},membership:{companyId:state.company,role,version:1,status:'active',company:{name:state.company,status:'active'}},permissions:['owner','manager'].includes(role)?['property.read','finance.manage','lease.manage']:role==='staff'?['property.read']:['resident.self'],csrfToken:'fixture'});
  if(path==='/api/company/properties')return json([{id:'home',name:'Garden House'}]);
  if(path==='/api/company/reports/context')return json({name:state.company,timezone:'America/New_York',today:'2026-10-15'});
  if(path.startsWith('/api/company/reports/')){
   state.requests.push(route.request().url());if(state.status!==200)return json({error:'More than 10,000 records match. Narrow filters; no partial report was generated.'},state.status);
   const common={generatedAt:'2026-10-15T16:00:00Z',company:{name:'FAP',timezone:'America/New_York'},currency:'USD',basis:'Saved records at generation time.',filters:{propertyId:'home',propertyName:'Garden House',dateFrom:'2026-01-01',dateTo:'2026-10-15',status:null}};
   if(path.endsWith('/leases'))return json({...common,kind:'leases',today:'2026-10-15',summary:{recordCount:1,currentCount:1,monthlyRentCents:'150001',futureActiveCount:0,expiredActiveCount:0},items:[{id:'lease-1',property:{name:'Garden House'},unit:{label:'Unit 1'},resident:{name:'Jane Resident',email:'jane@test.invalid'},status:'active',startsOn:'2026-10-01',endsOn:null,rentCents:'150001',inEffect:true}]});
   return json({...common,kind:'cash',summary:{incomeCents:state.income,expenseCents:'0',netCents:state.income,includedCount:state.count,voidedCount:0},groups:[{month:'2026-10',propertyId:'home',property:'Garden House',kind:'income',category:'rent',amountCents:state.income,count:state.count}],items:Array.from({length:state.count},(_,i)=>({id:'row-'+i,reference:'TX-'+(i+1),property:{name:i===50?'Last source property':'Garden House'},occurredOn:'2026-10-14',kind:'income',category:'rent',amountCents:'101',memo:i===50?'=SUM(1,2)':null,voidedAt:null,voidReason:null}))});
  }return json([]);
 });return state;
}
test('complete report paginates for display and exports all rows from unchanged snapshot',async({page})=>{
 const state=await fixture(page);await page.goto('/company/reports');await expect(page.getByRole('heading',{name:'Start with a report'})).toBeVisible();await page.getByLabel('Report property').selectOption('home');await page.getByRole('button',{name:'Generate report'}).click();await expect(page.getByText('Page 1 of 2',{exact:true})).toBeVisible();await expect(page.locator('.metric-grid')).toContainText('$51.51');expect(state.requests[0]).toContain('propertyId=home');
 await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.getByText('Last source property',{exact:true})).toBeVisible();state.income='99999';
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download CSV'}).click();const file=await (await downloading).path();const csv=await readFile(file!,'utf8');expect(csv).toContain('"Income (USD)",51.51');expect(csv).toContain('"row-50"');expect(csv).toContain('"\'=SUM(1,2)"');expect(csv.match(/"row-\d+"/g)).toHaveLength(51);expect(csv.match(/"TX-\d+"/g)).toHaveLength(51);expect(csv).not.toContain('999.99');
 await page.screenshot({path:'/tmp/pf-reports-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'/tmp/pf-reports-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Generate report'}).click();await expect(page.locator('.metric-grid')).toContainText('$999.99');await expect(page.getByText('Page 1 of 2',{exact:true})).toBeVisible();
});
test('report errors never expose old totals; empty reports and lease register are meaningful',async({page})=>{
 const state=await fixture(page,'manager');await page.goto('/company/reports');await page.getByRole('button',{name:'Generate report'}).click();await expect(page.getByRole('button',{name:'Download CSV'})).toBeVisible();state.status=422;await page.getByRole('button',{name:'Generate report'}).click();await expect(page.getByRole('alert')).toContainText('no partial report');await expect(page.getByRole('button',{name:'Download CSV'})).toHaveCount(0);
 state.status=200;state.count=0;state.income='0';await page.getByRole('button',{name:'Generate report'}).click();await expect(page.getByText("No records match the generated report's filters.")).toBeVisible();await expect(page.locator('.metric-grid')).toContainText('$0.00');
 await page.getByLabel('Report type').selectOption('leases');await page.getByLabel('Lease status').selectOption('active');await page.getByRole('button',{name:'Generate report'}).click();await expect(page.getByRole('cell',{name:'Jane Resident'})).toBeVisible();await expect(page.locator('.metric-grid')).toContainText('$1,500.01');expect(state.requests.at(-1)).toContain('status=active');
});
test('report snapshot disappears on company change and staff/residents cannot query reports',async({page})=>{
 const state=await fixture(page);await page.goto('/company/reports');await page.getByRole('button',{name:'Generate report'}).click();await expect(page.getByRole('button',{name:'Download CSV'})).toBeVisible();state.company='b';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('button',{name:'Download CSV'})).toHaveCount(0);
 for(const role of ['staff','resident']){await page.unroute('**/api/**');const denied=await fixture(page,role);await page.goto('/company/reports');await expect(page.getByRole('heading',{name:'Access unavailable'})).toBeVisible();expect(denied.requests).toHaveLength(0);}
});

test('date range fields show month names, preserve ISO submissions and reject an inverted range',async({page})=>{
 const state=await fixture(page);await page.goto('/company/reports?dateFrom=2026-10-01&dateTo=2026-10-15');
 await expect(page.locator('.date-field-display')).toHaveText(['October 1, 2026','October 15, 2026']);
 const from=page.getByLabel('From date',{exact:true}),through=page.getByLabel('Through date',{exact:true});
 await expect(from).toHaveValue('2026-10-01');await expect(through).toHaveValue('2026-10-15');
 await from.fill('2026-10-20');await through.blur();
 expect(await through.evaluate((input:HTMLInputElement)=>input.validity.rangeUnderflow)).toBe(true);
 await page.getByRole('button',{name:'Generate report'}).click();expect(state.requests).toHaveLength(0);
 await from.fill('2026-10-01');await through.fill('2026-10-31');await through.blur();
 await expect(page.locator('.date-field-display')).toHaveText(['October 1, 2026','October 31, 2026']);
 await page.getByRole('button',{name:'Generate report'}).click();
 await expect(page.getByRole('button',{name:'Download CSV'})).toBeVisible();
 expect(state.requests[0]).toContain('dateFrom=2026-10-01');expect(state.requests[0]).toContain('dateTo=2026-10-31');
 await page.screenshot({path:'/tmp/propertyflow-readable-date-range.png',fullPage:true});
});
