import {test,expect,Page} from '@playwright/test';
async function fixture(page:Page,role='owner'){
 const state={company:'a',actor:role,features:undefined as any,readStatus:200,audits:0,voidAudits:0,voidPosts:[] as any[],posts:[] as any[],entries:[] as any[],keys:[] as string[],lose:false,loseVoid:false,requests:[] as string[]};
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),path=url.pathname,json=(value:unknown,status=200)=>route.fulfill({json:value,status});
  if(path==='/api/bootstrap')return json({user:{id:state.actor,email:state.actor+'@test.invalid',status:'active'},membership:{companyId:state.company,version:1,role,status:'active',company:{name:state.company,status:'active'}},permissions:['owner','manager'].includes(role)?['property.read','finance.manage']:role==='staff'?['property.read']:role==='resident'?['resident.self']:['platform.manage'],csrfToken:'fixture',companyFeatures:state.features});
  if(path==='/api/company/properties')return json([{id:'home',name:'Home'},{id:'second',name:'Second'}]);
  if(path.startsWith('/api/company/finances')){
   state.requests.push(req.url());
   if(req.method()==='POST'){expect(req.headers()['x-csrf-token']).toBe('fixture');const data=req.postDataJSON();
    if(path.endsWith('/void')){state.voidPosts.push({body:data,companyId:req.headers()['x-company-id']});const row=state.entries.find(r=>path.includes('/'+r.id+'/'));if(row.version!==data.expectedVersion&&!row.voidedAt)return json({error:'This record changed. Reload the list before editing again.'},409);if(!row.voidedAt){row.voidedAt=new Date().toISOString();row.voidReason=data.reason;row.version=2;state.voidAudits++;}if(state.loseVoid){state.loseVoid=false;return route.abort('failed');}return json(row);}
    state.posts.push({body:data,companyId:req.headers()['x-company-id']});if(req.headers()['x-company-id']!==state.company)return json({code:'COMPANY_ACCESS_DENIED',error:'Company changed.'},403);state.keys.push(data.submissionKey);let row=state.entries.find(r=>r.submissionKey===data.submissionKey);if(!row){row={...data,id:'entry-'+state.entries.length,property:{name:data.propertyId==='home'?'Home':'Second'},amountCents:Math.round(Number(data.amount)*100),version:1,voidedAt:null,voidReason:null};state.entries.push(row);state.audits++;}if(state.lose){state.lose=false;return route.abort('failed');}return json(row);
   }
   if(state.readStatus!==200)return json({code:'ACCESS_DENIED',error:'Cash access unavailable.'},state.readStatus);
   const rows=state.entries.filter(r=>(!url.searchParams.get('propertyId')||r.propertyId===url.searchParams.get('propertyId'))&&(!url.searchParams.get('dateFrom')||r.occurredOn>=url.searchParams.get('dateFrom')!)&&(!url.searchParams.get('dateTo')||r.occurredOn<=url.searchParams.get('dateTo')!));
   const income=rows.filter(r=>!r.voidedAt&&r.kind==='income').reduce((a,r)=>a+r.amountCents,0),expense=rows.filter(r=>!r.voidedAt&&r.kind==='expense').reduce((a,r)=>a+r.amountCents,0),cursor=url.searchParams.get('cursor'),selected=rows.filter(r=>!cursor||r.id<cursor).sort((a,b)=>b.id.localeCompare(a.id));
   return json({items:selected.slice(0,50),nextCursor:selected.length>50?selected[49].id:null,summary:{incomeCents:String(income),expenseCents:String(expense),netCents:String(income-expense)}});
  }return json([]);
 });return state;
}
async function fill(page:Page){await page.getByRole('button',{name:'Record a transaction',exact:true}).click();await page.getByLabel('Date received or paid').fill('2026-10-14');await page.getByLabel('Amount (USD)').fill('1234.56');await page.getByLabel('Memo (optional)').fill('October receipt');}
test('committed cash response loss survives reload and retries the exact company/property/key once',async({page})=>{
 const state=await fixture(page);state.lose=true;await page.goto('/company/finances');await fill(page);
 await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
 const original=state.posts[0];expect(state.entries).toHaveLength(1);expect(state.audits).toBe(1);
 await page.reload();await page.getByRole('button',{name:'Review unfinished transaction',exact:true}).click();
 await expect(page.getByLabel('Amount (USD)',{exact:true})).toHaveValue('1234.56');await expect(page.getByLabel('Amount (USD)',{exact:true})).toBeDisabled();
 await expect(page.getByRole('textbox',{name:'Memo (optional)',exact:true})).toHaveValue('October receipt');await expect(page.getByRole('textbox',{name:'Memo (optional)',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 expect(state.posts).toEqual([original,original]);expect(state.entries).toHaveLength(1);expect(state.audits).toBe(1);
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('pf:finance-create:')))).toEqual([]);
});

test('cash recovery is hidden until a fresh authorized read and denied reads keep its journal',async({page})=>{
 const state=await fixture(page);state.lose=true;await page.goto('/company/finances');await fill(page);await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/company/finances?*',async route=>{await gate;return route.fallback();});
 try {
  await page.reload();await expect(page.getByText('Checking current access to the original property…')).toBeVisible();
  await expect(page.getByLabel('Amount (USD)',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Memo (optional)',{exact:true})).toHaveCount(0);
  state.readStatus=403;release();await expect(page.getByRole('region',{name:'Unfinished cash transaction'}).getByRole('alert')).toContainText(/cash access.*unavailable/i);
  await expect(page.getByLabel('Memo (optional)',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Record a transaction',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('pf:finance-create:')))).toHaveLength(1);expect(state.posts).toHaveLength(1);
 } finally {release();}
});

test('cash recovery stays in its actor/company scope and cannot be rebased onto another property',async({page})=>{
 const state=await fixture(page);state.lose=true;await page.goto('/company/properties/home/finances');await fill(page);await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
 await page.goto('/company/properties/second/finances');await expect(page.getByRole('link',{name:'Open original property to recover'})).toHaveAttribute('href','/company/properties/home/finances');
 await expect(page.getByRole('button',{name:'Record a transaction',exact:true})).toBeDisabled();await expect(page.getByLabel('Memo (optional)',{exact:true})).toHaveCount(0);
 state.company='b';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('link',{name:'Open original property to recover'})).toHaveCount(0);await page.getByRole('button',{name:'Record a transaction',exact:true}).click();
 await expect(page.getByLabel('Amount (USD)',{exact:true})).toHaveValue('');expect(state.posts).toHaveLength(1);
 state.company='a';state.actor='another-owner';await page.reload();
 await expect(page.getByRole('heading',{name:'Cash activity',exact:true})).toBeVisible();await page.getByRole('button',{name:'Record a transaction',exact:true}).click();
 await expect(page.getByLabel('Memo (optional)',{exact:true})).toHaveValue('');expect(state.posts).toHaveLength(1);
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('pf:finance-create:owner:a')))).toHaveLength(1);
});

test('read-only cash policy preserves authorized recovery review and blocks retry writes',async({page})=>{
 const state=await fixture(page);state.lose=true;await page.goto('/company/finances');await fill(page);await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
 state.features={finances:'read_only',leasing:'enabled'};await page.reload();await page.getByRole('button',{name:'Review unfinished transaction',exact:true}).click();
 await expect(page.getByLabel('Amount (USD)',{exact:true})).toHaveValue('1234.56');await expect(page.getByRole('button',{name:'Record transaction',exact:true})).toBeDisabled();expect(state.posts).toHaveLength(1);
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('pf:finance-create:')))).toHaveLength(1);
});

test('lost transaction response retains draft and key through filtering; explicit new action resets',async({page})=>{
 const state=await fixture(page);state.lose=true;await page.goto('/company/finances');await fill(page);await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:/^(Save draft & close|Close & keep recovery)$/,exact:true}).click();await page.getByLabel('Filter property').selectOption('home');await page.getByRole('button',{name:'Apply filters'}).click();await page.getByRole('button',{name:'Record a transaction',exact:true}).click();await expect(page.getByLabel('Amount (USD)')).toHaveValue('1234.56');await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();expect(state.entries.length).toBe(1);expect(state.keys[0]).toBe(state.keys[1]);await expect(page.getByRole('region',{name:'All matching active entries'})).toContainText('$1,234.56');await fill(page);await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect.poll(()=>state.keys.length).toBe(3);expect(state.keys[2]).not.toBe(state.keys[0]);
});
test('void response loss preserves reason and retry removes amount from totals while retaining history',async({page})=>{
 const state=await fixture(page);await page.goto('/company/finances');await fill(page);await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect(page.getByRole('heading',{name:'Home · income · $1,234.56'})).toBeVisible();state.loseVoid=true;await page.getByRole('button',{name:'Void transaction',exact:true}).click();await page.getByLabel('Correction reason').fill('Wrong property');await page.getByRole('dialog').getByRole('button',{name:'Void transaction',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'Void transaction',exact:true}).click();await expect(page.getByText('Voided: Wrong property')).toBeVisible();await expect(page.locator('.metric-grid')).toContainText('Net recorded$0.00');await expect(page.getByRole('heading',{name:'Home · income · $1,234.56'})).toBeVisible();
});

for (const denial of [403,404]) test(`a ${denial} history read conceals an uncertain cash correction until a fresh authorized read`,async({page})=>{
 const state=await fixture(page);
 state.entries.push({id:'correction-source',propertyId:'home',property:{name:'Private source property'},occurredOn:'2026-10-14',amountCents:1000,kind:'expense',category:'repairs',memo:null,version:1,voidedAt:null});
 await page.goto('/company/finances');await page.getByRole('button',{name:'Void transaction',exact:true}).click();
 await page.getByLabel('Correction reason').fill('Original correction reason');state.loseVoid=true;
 const editor=page.getByRole('dialog',{name:'Void transaction',exact:true});
 await editor.getByRole('button',{name:'Void transaction',exact:true}).click();await expect(editor.getByRole('alert')).toBeVisible();
 expect(state.voidPosts).toHaveLength(1);expect(state.voidAudits).toBe(1);
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/company/finances?*',async route=>{if(new URL(route.request().url()).searchParams.get('dateFrom')==='2026-10-01'&&!new URL(route.request().url()).searchParams.has('dateTo'))await gate;return route.fallback();});
 const changeHistory=async(key:string,value:string)=>page.evaluate(({key,value})=>{const url=new URL(location.href);url.searchParams.set(key,value);history.replaceState(history.state,'',url);dispatchEvent(new PopStateEvent('popstate',{state:history.state}));},{key,value});
 try {
  state.readStatus=denial;await changeHistory('dateFrom','2026-10-01');
  await expect(editor.getByRole('button',{name:'Void transaction',exact:true})).toBeDisabled();
  release();await expect(editor).not.toBeVisible();await expect(page.getByRole('alert')).toContainText(/cash access.*unavailable/i);
  await expect(page.getByText('Private source property · $10.00 · October 14, 2026',{exact:true})).toHaveCount(0);
  expect(state.voidPosts).toHaveLength(1);
  state.readStatus=200;await changeHistory('dateTo','2026-10-31');
  await expect(editor).toBeVisible();await expect(editor.getByLabel('Correction reason')).toHaveValue('Original correction reason');
  await expect(editor.getByLabel('Correction reason')).toBeDisabled();
  await expect(editor.getByRole('button',{name:'Void transaction',exact:true})).toBeEnabled();
  await editor.getByRole('button',{name:'Void transaction',exact:true}).click();await expect(editor).not.toBeVisible();
  expect(state.voidPosts).toEqual([{body:{expectedVersion:1,reason:'Original correction reason'},companyId:'a'},{body:{expectedVersion:1,reason:'Original correction reason'},companyId:'a'}]);
  expect(state.voidAudits).toBe(1);
 } finally {release();}
});

test('cash source paths and filter reset retain property and maintenance context and honor disabled leasing',async({page})=>{
 const state=await fixture(page);await page.goto('/company/properties/home/finances?maintenanceReturn=request-1&dateFrom=2026-10-01&dateTo=2026-10-31');
 const paths=page.getByRole('region',{name:'Choose financial workflow'});
 await expect(paths.getByRole('link',{name:/^Lease rent & balances/})).toHaveAttribute('href','/company/properties/home/rent');
 await expect(paths.getByRole('link',{name:/^Security deposits/})).toHaveAttribute('href','/company/properties/home/deposits');
 await page.getByRole('button',{name:'Clear transaction filters',exact:true}).click();
 const url=new URL(page.url());expect(url.pathname).toBe('/company/properties/home/finances');expect(url.searchParams.get('maintenanceReturn')).toBe('request-1');expect(url.searchParams.has('dateFrom')).toBe(false);expect(url.searchParams.has('dateTo')).toBe(false);
 await expect(page.getByRole('link',{name:'← Back to maintenance request'})).toHaveAttribute('href','/company/maintenance/request-1?propertyId=home&nested=true');
 state.features={finances:'enabled',leasing:'disabled'};await page.reload();await expect(page.getByRole('heading',{name:'Feature unavailable',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:/^Lease rent & balances/})).toHaveCount(0);await expect(page.getByRole('link',{name:/^Security deposits/})).toHaveCount(0);
});

test('finance authority restricted to owner and manager',async({page})=>{
 for(const role of ['staff','resident','platform']){await page.unroute('**/api/**');const state=await fixture(page,role);await page.goto('/company/finances');await expect(page.getByRole('heading',{name:'Access unavailable'})).toBeVisible();expect(state.requests.length).toBe(0);}
});
test('pagination preserves a pending transaction and whole-filter totals; expenses show negative net',async({page})=>{
 const state=await fixture(page,'manager');for(let i=0;i<51;i++)state.entries.push({id:'seed-'+String(i).padStart(3,'0'),propertyId:'home',property:{name:'Home'},kind:'expense',category:'repairs',occurredOn:'2026-10-14',amountCents:101,memo:null,version:1,voidedAt:null});await page.goto('/company/finances');await fill(page);await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:/^(Save draft & close|Close & keep recovery)$/,exact:true}).click();await expect(page.getByText('50 transactions on this page')).toBeVisible();await page.getByRole('button',{name:'Next page'}).click();await expect(page.getByText('1 transactions on this page')).toBeVisible();await expect(page.locator('.metric-grid')).toContainText('-$51.51');await page.getByRole('button',{name:'First page'}).click();await expect(page.getByText('50 transactions on this page')).toBeVisible();await page.getByRole('button',{name:'Record a transaction',exact:true}).click();await expect(page.getByLabel('Amount (USD)')).toHaveValue('1234.56');await page.getByLabel('What are you recording?',{exact:true}).selectOption('expense');await page.getByLabel('Category',{exact:true}).selectOption('utilities');await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect.poll(()=>state.keys.length).toBe(1);expect(state.entries.at(-1).category).toBe('utilities');
});
test('company refresh discards transaction drafts',async({page})=>{
 const state=await fixture(page);await page.goto('/company/finances');await fill(page);state.company='b';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('dialog')).not.toBeVisible();await page.getByRole('button',{name:'Record a transaction',exact:true}).click();await expect(page.getByLabel('Amount (USD)')).toHaveValue('');await expect(page.getByLabel('Memo (optional)')).toHaveValue('');
});

test('cash entry chooses the source once and preserves its draft when changing intent',async({page})=>{
 const state=await fixture(page);await page.goto('/company/finances?propertyId=home');await fill(page);const intent=page.getByLabel('What are you recording?',{exact:true});await expect(page.getByLabel('Category',{exact:true})).toHaveValue('other');await expect(page.getByLabel('Transaction type')).toHaveCount(0);
 await intent.selectOption('rent');await expect(page.getByRole('link',{name:'Choose a rent account'})).toHaveAttribute('href','/company/properties/home/rent');await expect(page.getByRole('button',{name:'Record transaction',exact:true})).not.toBeVisible();expect(state.keys).toHaveLength(0);
 await intent.selectOption('income');await expect(page.getByLabel('Amount (USD)')).toHaveValue('1234.56');await intent.selectOption('deposit');await expect(page.getByRole('link',{name:'Choose a deposit account'})).toHaveAttribute('href','/company/properties/home/deposits');expect(state.keys).toHaveLength(0);
});


test('changed editors confirm close and Escape; discard removes unfinished values',async({page})=>{
 const state=await fixture(page);await page.goto('/company/finances');await fill(page);
 await page.getByRole('button',{name:'Close',exact:true}).click();
 const confirmation=page.getByRole('alertdialog',{name:'Close without saving changes?'});
 await expect(confirmation).toBeVisible();await expect(confirmation.getByRole('button',{name:'Keep editing'})).toBeFocused();
 await page.setViewportSize({width:390,height:844});expect(await page.getByRole('dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
 await page.screenshot({path:'/tmp/pf_explicit_draft_close_mobile.png',fullPage:false});
 await page.keyboard.press('Escape');await expect(confirmation).not.toBeVisible();
 await expect(page.getByLabel('Amount (USD)')).toHaveValue('1234.56');
 await page.keyboard.press('Escape');await expect(confirmation).toBeVisible();
 await confirmation.getByRole('button',{name:'Keep editing'}).click();
 await expect(page.getByLabel('Memo (optional)')).toHaveValue('October receipt');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await confirmation.getByRole('button',{name:'Close without saving',exact:true}).click();
 await expect(page.getByRole('dialog')).not.toBeVisible();expect(state.keys).toHaveLength(0);
 await page.getByRole('button',{name:'Record a transaction',exact:true}).click();
 await expect(page.getByLabel('Amount (USD)')).toHaveValue('');await expect(page.getByLabel('Memo (optional)')).toHaveValue('');
 await page.getByRole('button',{name:'Close',exact:true}).click();await expect(confirmation).not.toBeVisible();await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('explicit drafts remain on this page but disappear on refresh without creating records',async({page})=>{
 const state=await fixture(page);await page.goto('/company/finances');await fill(page);
 await page.getByRole('button',{name:'Save as draft',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 await page.getByRole('button',{name:'Record a transaction',exact:true}).click();await expect(page.getByLabel('Amount (USD)')).toHaveValue('1234.56');
 await expect(page.getByText('Saved draft · available only while this page stays open.')).toBeVisible();
 await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('pf-')||key.startsWith('pf:')))).toEqual([]);
 await page.reload();await page.getByRole('button',{name:'Record a transaction',exact:true}).click();
 await expect(page.getByLabel('Amount (USD)')).toHaveValue('');await expect(page.getByLabel('Memo (optional)')).toHaveValue('');expect(state.entries).toHaveLength(0);expect(state.keys).toHaveLength(0);
});

test('a saved correction stays bound to its original source and never carries input into another transaction',async({page})=>{
 const state=await fixture(page);
 for(const [id,name] of [['first','First property'],['second','Second property']])state.entries.push({id,propertyId:id,property:{name},kind:'expense',category:'repairs',occurredOn:'2026-10-14',amountCents:1000,version:1,voidedAt:null});
 await page.goto('/company/finances');
 const first=page.locator('.record-list > li').filter({has:page.getByRole('heading',{name:'First property · expense · $10.00',exact:true})});
 const second=page.locator('.record-list > li').filter({has:page.getByRole('heading',{name:'Second property · expense · $10.00',exact:true})});
 await first.getByRole('button',{name:'Void transaction',exact:true}).click();await page.getByLabel('Correction reason').fill('Original source correction');await page.getByRole('button',{name:'Save as draft',exact:true}).click();
 state.entries[0].version=2;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await first.getByRole('button',{name:'Void transaction',exact:true}).click();
 await expect(page.getByLabel('Correction reason')).toHaveValue('Original source correction');await page.getByRole('dialog').getByRole('button',{name:'Void transaction',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('This record changed');
 await page.getByRole('button',{name:'Save as draft',exact:true}).click();
 page.once('dialog',dialog=>dialog.dismiss());await second.getByRole('button',{name:'Void transaction',exact:true}).click();
 await expect(page.getByRole('dialog')).not.toBeVisible();await first.getByRole('button',{name:'Void transaction',exact:true}).click();await expect(page.getByLabel('Correction reason')).toHaveValue('Original source correction');
 await page.getByRole('button',{name:'Close',exact:true}).click();
 page.once('dialog',dialog=>dialog.accept());await second.getByRole('button',{name:'Void transaction',exact:true}).click();
 await expect(page.getByLabel('Correction reason')).toHaveValue('');await expect(page.getByText('Saved draft · available only while this page stays open.')).toHaveCount(0);expect(state.entries.every(row=>!row.voidedAt)).toBe(true);
});

test('an uncertain submitted transaction cannot be discarded or given a fresh key on close',async({page})=>{
 const state=await fixture(page);state.lose=true;await page.goto('/company/finances');await fill(page);
 await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
 await expect(page.getByLabel('Amount (USD)')).toBeDisabled();await expect(page.getByLabel('What are you recording?',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Clear draft',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Close',exact:true}).click();
 const recovery=page.getByRole('alertdialog',{name:'Recover the submitted request'});await expect(recovery).toBeVisible();await expect(recovery.getByRole('button',{name:'Close without saving',exact:true})).toHaveCount(0);
 await recovery.getByRole('button',{name:'Close & keep recovery',exact:true}).click();await page.getByRole('button',{name:'Record a transaction',exact:true}).click();
 await expect(page.getByLabel('Amount (USD)')).toHaveValue('1234.56');await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 expect(state.keys).toHaveLength(2);expect(state.keys[0]).toBe(state.keys[1]);expect(state.entries).toHaveLength(1);
});

test('cash entry pairs money details, marks native requirements and retains exact recovery after rejection',async({page})=>{
 const state=await fixture(page);let reject=true,releaseRejection=()=>{};
 const rejectionGate=new Promise<void>(resolve=>{releaseRejection=resolve;});
 await page.route('**/api/company/finances',async route=>{
  if(route.request().method()!=='POST'||!reject)return route.fallback();
  await rejectionGate;return route.fulfill({status:400,json:{error:'Review the amount in this fictional fixture.'}});
 });
 await page.goto('/company/finances');await page.getByRole('button',{name:'Record a transaction',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Record a transaction',exact:true});
 await editor.getByLabel('What are you recording?',{exact:true}).selectOption('expense');
 await editor.getByLabel('Transaction property',{exact:true}).selectOption('second');
 await editor.getByLabel('Date received or paid',{exact:true}).fill('2026-10-14');
 await editor.getByLabel('Amount (USD)',{exact:true}).fill('123.45');
 await editor.getByLabel('Category',{exact:true}).selectOption('utilities');
 await editor.getByLabel('Memo (optional)',{exact:true}).fill('Fictional paid utility bill');
 await expect(editor.locator('.financial-required')).toHaveCount(3);
 await expect(editor.getByLabel('Amount (USD)',{exact:true})).toHaveJSProperty('required',true);
 await expect(editor.locator('label[for="finance-category"] select')).toHaveCount(1);
 for(const [size,width,height] of [['desktop',1365,900],['mobile',390,844]] as const){
  await page.setViewportSize({width,height});
  const date=await editor.getByLabel('Date received or paid',{exact:true}).boundingBox(),amount=await editor.getByLabel('Amount (USD)',{exact:true}).boundingBox();
  expect(date).not.toBeNull();expect(amount).not.toBeNull();
  if(size==='desktop')expect(Math.abs(date!.y-amount!.y)).toBeLessThan(2);else expect(amount!.y).toBeGreaterThan(date!.y+date!.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(editor.getByRole('button',{name:'Record transaction',exact:true})).toBeInViewport({ratio:1});
  await page.screenshot({path:`/tmp/propertyflow-cash-entry-${size}-after.png`});
  if(size==='desktop'){
   await editor.getByLabel('Memo (optional)',{exact:true}).focus();
   await page.keyboard.press('Tab');await page.keyboard.press('Tab');await page.keyboard.press('Tab');
   const draft=editor.getByRole('button',{name:'Save as draft',exact:true});
   await expect(draft).toBeFocused();await expect(draft).toBeInViewport({ratio:1});
   const bounds=await editor.boundingBox(),draftBounds=await draft.boundingBox();
   expect(draftBounds!.y+draftBounds!.height).toBeLessThanOrEqual(bounds!.y+bounds!.height);
   await page.screenshot({path:'/tmp/propertyflow-cash-entry-desktop-draft-focused.png'});
   await page.keyboard.press('Enter');await expect(editor).not.toBeVisible();expect(state.entries).toHaveLength(0);
   await page.getByRole('button',{name:'Record a transaction',exact:true}).click();
   await expect(editor.getByLabel('Amount (USD)',{exact:true})).toHaveValue('123.45');
   await expect(editor.getByLabel('Memo (optional)',{exact:true})).toHaveValue('Fictional paid utility bill');
  }
 }
 await editor.getByRole('button',{name:'Record transaction',exact:true}).click();
 await expect(editor.getByLabel('What are you recording?',{exact:true})).toBeDisabled();
 await expect(editor.getByLabel('What are you recording?',{exact:true})).toHaveValue('expense');releaseRejection();
 await expect(editor.getByRole('alert')).toContainText('Review the amount');await expect(editor.getByRole('alert')).toBeFocused();
 await expect(editor.getByLabel('Amount (USD)',{exact:true})).toHaveValue('123.45');
 await expect(editor.getByLabel('Memo (optional)',{exact:true})).toHaveValue('Fictional paid utility bill');
 for(const [size,width,height] of [['desktop',1365,900],['mobile',390,844]] as const){
  await page.setViewportSize({width,height});await expect(editor.getByRole('alert')).toBeInViewport({ratio:1});
  await page.screenshot({path:`/tmp/propertyflow-cash-entry-${size}-error-after.png`});
 }
 reject=false;state.lose=true;await editor.getByRole('button',{name:'Record transaction',exact:true}).click();
 await expect(editor.getByRole('alert')).toBeVisible();await expect(editor.getByLabel('Amount (USD)',{exact:true})).toBeDisabled();
 await expect(editor.getByLabel('What are you recording?',{exact:true})).toBeDisabled();
 await editor.getByRole('button',{name:'Record transaction',exact:true}).click();await expect(editor).not.toBeVisible();
 expect(state.entries).toHaveLength(1);expect(state.keys).toHaveLength(2);expect(state.keys[0]).toBe(state.keys[1]);
 expect(state.entries[0]).toMatchObject({propertyId:'second',occurredOn:'2026-10-14',amount:'123.45',kind:'expense',category:'utilities',memo:'Fictional paid utility bill'});
});


test('browser history restores the displayed property filter before applying it again', async ({ page }) => {
 const state = await fixture(page);
 await page.goto('/company/finances?propertyId=home');
 await expect(page.getByRole('combobox', { name: 'Filter property', exact: true })).toHaveValue('home');
 await page.getByRole('combobox', { name: 'Filter property', exact: true }).selectOption('second');
 await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
 await expect(page).toHaveURL(/propertyId=second/);
 await page.goBack();
 await expect(page).toHaveURL(/propertyId=home/);
 await expect(page.getByRole('combobox', { name: 'Filter property', exact: true })).toHaveValue('home');
 await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
 await expect(page).toHaveURL(/propertyId=home/);
 await expect.poll(() => new URL(state.requests.at(-1)!).searchParams.get('propertyId')).toBe('home');
});
