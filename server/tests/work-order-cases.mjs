import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
export async function workOrderCases(t,admin,db,call,app){
 let id,version=1;const detail=()=>`/api/company/work-orders/${id}`,act=(action,extra={})=>({action,note:`Fictional ${action} note`,expectedVersion:version,submissionKey:randomUUID(),...extra});
 const grant=async(user,enabled=true)=>{const v=(await admin.query('SELECT version FROM "CompanyMembership" WHERE "userId"=$1',[user])).rows[0].version;return call('owner','PUT',`/api/company/members/${user}/maintenance-access`,{enabled,expectedVersion:v});};
 await t.test('staff execution is default off and only owners grant it with version/audit protection',async()=>{
  assert.equal((await call('staff','GET','/api/company/work-orders')).statusCode,403);
  assert.equal((await call('manager','PUT','/api/company/members/staff/maintenance-access',{enabled:true,expectedVersion:1})).statusCode,403);
  for(const payload of [{enabled:'true',expectedVersion:1},{enabled:true,expectedVersion:0},{enabled:true,expectedVersion:1,role:'manager'}])assert.equal((await call('owner','PUT','/api/company/members/staff/maintenance-access',payload)).statusCode,400);
  assert.equal((await call('owner','PUT','/api/company/members/staff/maintenance-access',{enabled:true,expectedVersion:999})).statusCode,409);
  assert.equal((await grant('staff')).statusCode,200);assert.equal((await call('staff','GET','/api/company/work-orders')).statusCode,200);
  for(const path of ['/api/company/maintenance','/api/company/leases','/api/company/finances','/api/company/residents'])assert.equal((await call('staff','GET',path)).statusCode,403,path);
  await admin.query(`UPDATE "CompanyMembership" SET role='staff' WHERE "userId"='other'`);assert.equal((await grant('other')).statusCode,200);
  const created=await call('manager','POST','/api/company/maintenance',{propertyId:'home',title:'Delegated repair',description:'Fictional work order',priority:'normal',submissionKey:randomUUID()});assert.equal(created.statusCode,200,created.body);id=created.json().id;
  assert.equal((await call('staff','GET',detail())).statusCode,404);
  assert.equal((await call('foreign','GET',detail())).statusCode,404);
 });
 await t.test('assignment requires current same-company capability/property scope and removes old access',async()=>{
  for(const assigneeId of ['foreign','resident','manager','missing'])assert.equal((await call('manager','POST',detail()+'/actions',act('assign',{assigneeId}))).statusCode,409);
  await admin.query(`UPDATE "CompanyMembership" SET "staffPropertyScope"='selected' WHERE "userId"='staff'`);
  assert.equal((await call('manager','POST',detail()+'/actions',act('assign',{assigneeId:'staff'}))).statusCode,409);
  await admin.query(`INSERT INTO "StaffPropertyAccess" ("companyId","propertyId","userId") VALUES ('a','home','staff')`);
  const assign=act('assign',{assigneeId:'staff'});assert.equal((await call('manager','POST',detail()+'/actions',assign)).statusCode,200);version++;
  assert.equal((await call('manager','POST',detail()+'/actions',assign)).statusCode,200,'lost response retry');
  const own=(await call('staff','GET',detail())).json();assert.equal(own.executionStatus,'assigned');for(const key of ['assigneeId','eligible','requesterId','recordedBy','costs','updates'])assert.ok(!(key in own),key);
  assert.equal((await call('staff','GET','/api/company/work-orders')).json().items.length,1);
  assert.equal((await call('manager','PATCH',`/api/company/maintenance/${id}`,{status:'resolved',expectedVersion:version})).statusCode,409,'old status endpoint cannot bypass review');
  assert.equal((await call('staff','POST',detail()+'/actions',act('approve'))).statusCode,403);
  assert.equal((await call('manager','POST',detail()+'/actions',act('assign',{assigneeId:'other'}))).statusCode,200);version++;
  assert.equal((await call('staff','GET',detail())).statusCode,404);assert.equal((await call('staff','POST',detail()+'/actions',act('accept'))).statusCode,404);
  assert.equal((await call('manager','POST',detail()+'/actions',act('assign',{assigneeId:'staff'}))).statusCode,200);version++;
 });
 await t.test('acceptance, progress, submission, reviewed completion and reopen preserve finances',async()=>{
  const moneyBefore=(await admin.query('SELECT count(*)::int n FROM "LedgerEntry"')).rows[0].n;
  assert.equal((await call('staff','POST',detail()+'/actions',act('submit'))).statusCode,409);
  const accepted=act('accept');const attempts=await Promise.all([call('staff','POST',detail()+'/actions',accepted),call('staff','POST',detail()+'/actions',accepted)]);for(const result of attempts)assert.equal(result.statusCode,200,result.body);version++;
  assert.equal((await call('staff','POST',detail()+'/actions',act('progress'))).statusCode,200);version++;
  const submit=act('submit');assert.equal((await call('staff','POST',detail()+'/actions',submit)).statusCode,200);version++;
  assert.equal((await call('manager','GET',`/api/company/maintenance/${id}`)).json().status,'in_progress');
  const reviewQueue=await call('manager','GET','/api/company/maintenance?workStatus=pending_review');assert.equal(reviewQueue.statusCode,200);assert.ok(reviewQueue.json().some(row=>row.id===id&&row.executionStatus==='pending_review'));
  assert.equal((await call('other','GET','/api/company/maintenance?workStatus=pending_review')).statusCode,403);
  assert.equal((await call('staff','POST',detail()+'/actions',act('approve'))).statusCode,403);
  assert.equal((await call('manager','POST',detail()+'/actions',act('approve'))).statusCode,200);version++;
  assert.equal((await call('manager','GET',`/api/company/maintenance/${id}`)).json().status,'resolved');
  assert.equal((await call('manager','POST',detail()+'/actions',act('reopen'))).statusCode,200);version++;
  assert.equal((await call('staff','GET',detail())).json().executionStatus,'assigned');
  assert.equal((await admin.query('SELECT count(*)::int n FROM "LedgerEntry"')).rows[0].n,moneyBefore);
  assert.deepEqual(await db.workOrderAction.findMany(),[]);
  const event=(await admin.query('SELECT id FROM "WorkOrderAction" WHERE "requestId"=$1 LIMIT 1',[id])).rows[0];await assert.rejects(admin.query('DELETE FROM "WorkOrderAction" WHERE id=$1',[event.id]),/immutable/);
 });
 await t.test('atomic audit failure, scope revocation and role changes stop execution and retries',async()=>{
  await admin.query(`CREATE FUNCTION fail_work_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='maintenance.work.changed' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_work_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION fail_work_audit()`);
  try{assert.equal((await call('staff','POST',detail()+'/actions',act('accept'))).statusCode,500);assert.equal((await call('staff','GET',detail())).json().version,version);}finally{await admin.query('DROP TRIGGER fail_work_audit ON "AuditEvent"; DROP FUNCTION fail_work_audit()');}
  const accepted=act('accept');assert.equal((await call('staff','POST',detail()+'/actions',accepted)).statusCode,200);version++;
  assert.equal((await grant('staff',false)).statusCode,200);assert.equal((await call('staff','POST',detail()+'/actions',accepted)).statusCode,403);assert.equal((await call('staff','GET',detail())).statusCode,403);
  assert.equal((await grant('staff')).statusCode,200);await admin.query(`DELETE FROM "StaffPropertyAccess" WHERE "userId"='staff'`);assert.equal((await call('staff','GET',detail())).statusCode,404);assert.deepEqual((await call('staff','GET','/api/company/work-orders')).json().items,[]);
  assert.equal((await call('owner','PATCH','/api/company/members/staff',{role:'staff',status:'disabled'})).statusCode,200);assert.equal((await admin.query(`SELECT "maintenanceExecution" FROM "CompanyMembership" WHERE "userId"='staff'`)).rows[0].maintenanceExecution,false);
 });
 await t.test('real browser completes assigned work and privately uploads/scans/downloads a job original',{skip:!process.env.TEST_MAINTENANCE_BROWSER_URL},async()=>{
  assert.equal((await call('owner','PATCH','/api/company/members/staff',{role:'staff',status:'active'})).statusCode,200);
  const propertyVersion=(await admin.query(`SELECT version FROM "CompanyMembership" WHERE "userId"='staff'`)).rows[0].version;
  assert.equal((await call('owner','PUT','/api/company/members/staff/property-access',{scope:'all',propertyIds:[],expectedVersion:propertyVersion})).statusCode,200);assert.equal((await grant('staff')).statusCode,200);
  const work=(await call('manager','POST','/api/company/maintenance',{propertyId:'home',title:'Browser fixture repair',description:'Fictional isolated browser repair.',priority:'normal',submissionKey:randomUUID()})).json();
  assert.equal((await call('manager','POST',`/api/company/work-orders/${work.id}/actions`,{action:'assign',assigneeId:'staff',note:'Please inspect this fixture.',expectedVersion:1,submissionKey:randomUUID()})).statusCode,200);
  const browser=await chromium.launch({headless:true});
  try{
   const page=await browser.newPage();let actor='staff';
   await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url());if(u.pathname==='/api/telemetry')return route.fulfill({status:202,json:{accepted:true}});const response=await app.inject({method:req.method(),url:u.pathname+u.search,headers:{...req.headers(),origin:'https://app.test',cookie:`__Host-pf-session=token-${actor}`},...(req.postData()?{payload:req.postData()}:{})});await route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});});
   await page.goto(process.env.TEST_MAINTENANCE_BROWSER_URL+`/company/work-orders/${work.id}`);
   await page.getByRole('button',{name:'Accept work',exact:true}).click();await page.getByLabel('Work note',{exact:true}).fill('Accepted isolated fixture.');await page.getByRole('button',{name:'Confirm acceptance',exact:true}).click();
   await page.getByRole('button',{name:'Submit completion for review',exact:true}).click();await page.getByLabel('Work note',{exact:true}).fill('Fixture repair completed, review requested.');await page.getByRole('button',{name:'Submit for review',exact:true}).click();await expect(page.getByText('Completion awaiting review',{exact:true})).toBeVisible();
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/pf-delegated-maintenance-mobile.png',fullPage:true});
   actor='manager';await page.setViewportSize({width:1280,height:900});await page.goto(process.env.TEST_MAINTENANCE_BROWSER_URL+`/company/maintenance/${work.id}`);
   await page.getByRole('button',{name:'Approve completion',exact:true}).click();await page.getByLabel('Work note',{exact:true}).fill('Reviewed fixture completion.');await page.getByRole('button',{name:'Confirm completion approval',exact:true}).click();await expect(page.getByRole('button',{name:'Reopen work',exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Upload document',exact:true}).click();await page.getByLabel('Document title',{exact:true}).fill('Browser fixture report');await page.getByLabel('Document file',{exact:true}).setInputFiles({name:'browser-fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Fictional browser report')});await page.getByRole('button',{name:'Upload to quarantine',exact:true}).click();
   await page.getByRole('button',{name:'Scan file',exact:true}).click();await expect(page.getByRole('button',{name:'Download version 1',exact:true})).toBeVisible();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download version 1',exact:true}).click();assert.equal((await download).suggestedFilename(),'browser-fixture.txt');
   await page.getByRole('heading',{name:'Private documents',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/pf-private-documents-desktop.png'});
   const record=(await call('manager','GET',`/api/company/maintenance/${work.id}/documents`)).json().items[0];assert.equal(record.versions[0].scanStatus,'clean');assert.equal((await call('staff','GET',`/api/company/maintenance/${work.id}/documents`)).statusCode,403);
   assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='document.downloaded' AND "targetId"=$1`,[record.id])).rows[0].n,1);
  }finally{await browser.close();}
 });

}
