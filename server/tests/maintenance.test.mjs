import { notificationCases } from "./notification-cases.mjs";
import { publishNotification } from "../dist/notification-events.js";
import { newFixturePage } from "./browser-fixture.mjs";
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {chromium, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import pg from 'pg';
import Fastify from 'fastify';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {registerApplication} from '../dist/application.js';
import {registerSessions,digest} from '../dist/sessions.js';
import {permissions} from '../dist/access.js';
import {maintenanceUpdateCases} from './maintenance-update-cases.mjs';
import {residentMaintenanceUpdateCases} from './resident-maintenance-update-cases.mjs';
import {notificationPreferenceCases} from './notification-preference-cases.mjs';
import {maintenanceDirectoryCases} from './maintenance-directory-cases.mjs';
import {privateDocumentCases} from './private-document-cases.mjs';
import {workOrderCases} from './work-order-cases.mjs';
import {documentLibraryCases} from './document-library-cases.mjs';
import {calendarCases} from './calendar-cases.mjs';
import {preventiveCases} from './preventive-cases.mjs';
import {vendorCases} from './vendor-cases.mjs';
import {inspectionCases} from './inspection-cases.mjs';
import {agreementCases} from './agreement-cases.mjs';
import {AccessError} from '../dist/access.js';
import {maintenanceCostCases} from './maintenance-cost-cases.mjs';
const url=process.env.TEST_MAINTENANCE_DATABASE_URL;
test('maintenance grants only active company owners/managers',()=>{
 for(const role of ['owner','manager','staff','resident']) for(const status of ['active','disabled']) assert.equal(permissions({id:'u',status,platformRole:null,membership:{companyId:'a',role,status:'active',company:{status:'active'}}}).includes('maintenance.manage'),status==='active'&&['owner','manager'].includes(role));
});
test('maintenance real PostgreSQL API, isolation and revocation', {skip:!url}, async t=>{
 const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/propertyflow_maintenance_test');assert.equal(process.env.MAINTENANCE_DISPOSABLE,'tmpfs-verified');
 const admin=new pg.Pool({connectionString:url});t.after(()=>admin.end());
 assert.equal((await admin.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n,0,'requires empty disposable database');
 for(const name of readdirSync(new URL('../prisma/migrations/',import.meta.url)).filter(n=>/^\d/.test(n)).sort())await admin.query(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`,import.meta.url),'utf8'));
 await admin.query("ALTER ROLE propertyflow_runtime LOGIN PASSWORD 'maintenance-test-only'");
 const runtime=new URL(url);runtime.username='propertyflow_runtime';runtime.password='maintenance-test-only';
 const pool=new pg.Pool({connectionString:runtime.href,max:6});const db=new PrismaClient({adapter:new PrismaPg(pool)});t.after(async()=>{await db.$disconnect();await pool.end();});
 for(const id of ['a','b'])await admin.query('INSERT INTO "Company" (id,name,"updatedAt") VALUES ($1,$1,NOW())',[id]);
 for(const [id,company,role] of [['owner','a','owner'],['manager','a','manager'],['resident','a','resident'],['other','a','resident'],['staff','a','staff'],['foreign','b','owner']]){
 await admin.query('INSERT INTO "User" (id,email,"emailVerified","updatedAt") VALUES ($1,$2,true,NOW())',[id,`${id}@test.invalid`]);
 await admin.query('INSERT INTO "CompanyMembership" ("userId","companyId",role,"updatedAt") VALUES ($1,$2,$3,NOW())',[id,company,role]);
 await db.session.create({data:{tokenHash:digest(`token-${id}`),csrfToken:'csrf',userId:id,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
 }
 for(const [id,company] of [['home','a'],['foreign-home','b']])await admin.query('INSERT INTO "Property" (id,name,address,city,state,zip,"companyId","updatedAt") VALUES ($1,$1,\'street\',\'city\',\'state\',\'zip\',$2,NOW())',[id,company]);
 await admin.query('INSERT INTO "ResidentPropertyAssignment" ("companyId","propertyId","userId") VALUES (\'a\',\'home\',\'resident\'),(\'a\',\'home\',\'other\')');
 const scanControl={fail:false};
 const notificationControl={enabled:false};
 const app=Fastify();
 // Match production's safe AccessError envelope so browser recovery tests see
 // the actual actionable message instead of Fastify's generic HTTP label.
 app.setErrorHandler((error,_request,reply)=>error instanceof AccessError?reply.code(error.statusCode).send({error:error.message,code:error.code}):reply.send(error));
 t.after(()=>app.close());const auth=await registerSessions(app,db,{origin:'https://app.test',domain:'unused.auth0.com',clientId:'test',clientSecret:'test-only',secure:true});registerApplication(app,db,auth,'https://app.test',undefined,{notificationPublisher:async(tx,input)=>{if(notificationControl.enabled)await publishNotification(tx,input);},documentScanner:async bytes=>{if(scanControl.gate)await scanControl.gate();if(scanControl.fail)throw new AccessError(503,'SCANNER_UNAVAILABLE','Test scanner unavailable');return bytes.includes(Buffer.from('EICAR'))?'rejected':'clean';}});
 const call=async(user,method,path,payload,extra={})=>{
 if(payload&&method==='PATCH'&&path.startsWith('/api/company/maintenance/')&&!Object.hasOwn(payload,'expectedVersion'))payload={...payload,expectedVersion:(await admin.query('SELECT version FROM "MaintenanceRequest" WHERE id=$1',[path.split('/').pop()])).rows[0]?.version||1};
 if(payload&&method==='PATCH'&&path.startsWith('/api/platform/companies/')&&!Object.hasOwn(payload,'expectedVersion'))payload={...payload,expectedVersion:(await db.company.findUnique({where:{id:path.split('/').pop()}}))?.version};
 return app.inject({method,url:path,headers:{...(user?{cookie:`__Host-pf-session=token-${user}`} : {}),origin:'https://app.test','x-csrf-token':'csrf',...extra},...(payload?{payload}:{})});};
 const valid={submissionKey:randomUUID(),propertyId:'home',title:'Leaking tap',description:'Kitchen tap leaks.',priority:'normal'};

 await t.test('durable replay, concurrent attempts, mismatch, requester/company scopes and rollback',async()=>{
 const key=randomUUID(),payload={...valid,submissionKey:key,title:'Idempotency regression'};
 const results=await Promise.all(Array.from({length:3},()=>call('resident','POST','/api/resident/maintenance',payload)));
 for(const result of results)assert.equal(result.statusCode,200,result.body);
 assert.equal(new Set(results.map(r=>r.json().id)).size,1);
 const first=results[0].json();
 assert.equal((await call('resident','POST','/api/resident/maintenance',{...payload,submissionKey:key.toUpperCase()})).json().id,first.id);
 assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='maintenance.created'`)).rows[0].n,1);
 await assert.rejects(admin.query(`INSERT INTO "MaintenanceRequest" (id,"companyId","propertyId","requesterId",title,description,priority,status,"createdAt","updatedAt","submissionKey","submissionHash") SELECT 'duplicate-id', "companyId", "propertyId", "requesterId", title, description, priority, status, "createdAt", "updatedAt", "submissionKey", "submissionHash" FROM "MaintenanceRequest" WHERE id=$1`,[first.id]),/unique constraint/);
 await call('manager','PATCH',`/api/company/maintenance/${first.id}`,{status:'resolved'});
 assert.equal((await call('resident','POST','/api/resident/maintenance',payload)).json().status,'resolved');
 for(const patch of [{title:'Changed'},{description:'Changed'},{priority:'high'},{propertyId:'foreign-home'}])assert.equal((await call('resident','POST','/api/resident/maintenance',{...payload,...patch})).statusCode,409);
 assert.notEqual((await call('other','POST','/api/resident/maintenance',payload)).json().id,first.id);
 await admin.query(`DELETE FROM "ResidentPropertyAssignment" WHERE "userId"='resident'`);
 assert.equal((await call('resident','POST','/api/resident/maintenance',payload)).statusCode,404);
 await admin.query(`UPDATE "CompanyMembership" SET "companyId"='b' WHERE "userId"='resident'`);
 await admin.query(`INSERT INTO "ResidentPropertyAssignment" ("companyId","propertyId","userId") VALUES ('b','foreign-home','resident')`);
 const foreign=await call('resident','POST','/api/resident/maintenance',{...payload,propertyId:'foreign-home'});assert.equal(foreign.statusCode,200,foreign.body);assert.notEqual(foreign.json().id,first.id);
 assert.equal((await admin.query(`SELECT count(*)::int n FROM "MaintenanceRequest" WHERE "submissionKey"=$1`,[key])).rows[0].n,3);
 assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='maintenance.created'`)).rows[0].n,3);
 await admin.query(`DELETE FROM "ResidentPropertyAssignment" WHERE "userId"='resident'`);
 await admin.query(`UPDATE "CompanyMembership" SET "companyId"='a' WHERE "userId"='resident'`);
 await admin.query(`INSERT INTO "ResidentPropertyAssignment" ("companyId","propertyId","userId") VALUES ('a','home','resident')`);
 await admin.query(`DELETE FROM "AuditEvent"`);await admin.query(`DELETE FROM "MaintenanceRequest"`);
 const failedKey=randomUUID();
 await admin.query(`CREATE FUNCTION reject_maintenance_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='maintenance.created' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_maintenance_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_maintenance_audit()`);
 assert.equal((await call('resident','POST','/api/resident/maintenance',{...valid,submissionKey:failedKey})).statusCode,500);
 assert.equal((await admin.query(`SELECT count(*)::int n FROM "MaintenanceRequest"`)).rows[0].n,0);
 await admin.query(`DROP TRIGGER reject_maintenance_audit ON "AuditEvent"; DROP FUNCTION reject_maintenance_audit()`);
 assert.equal((await call('resident','POST','/api/resident/maintenance',{...valid,submissionKey:failedKey})).statusCode,200);
 await admin.query(`DELETE FROM "AuditEvent"`);await admin.query(`DELETE FROM "MaintenanceRequest"`);
 });
 await t.test('real browser committed response loss replays one row and audit', {skip:!process.env.TEST_MAINTENANCE_BROWSER_URL},async()=>{
 const browser=await chromium.launch({headless:true});try{
 const page=await newFixturePage(browser);let lose=true;const keys=[];
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url());
 const response=await app.inject({method:req.method(),url:path.pathname+path.search,headers:{...req.headers(),origin:'https://app.test',cookie:'__Host-pf-session=token-resident'},...(req.postData()?{payload:req.postData()}:{})});
 if(req.method()==='POST'){keys.push(req.postDataJSON().submissionKey);assert.equal(response.statusCode,200,response.body);if(lose){lose=false;return route.abort('failed');}}
 await route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});});
 await page.goto(process.env.TEST_MAINTENANCE_BROWSER_URL+'/resident/maintenance');
 await page.getByRole('button',{name:'Submit a request',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Lost response regression');await page.getByLabel('Description',{exact:true}).fill('Committed before transport loss');
 await page.getByRole('button',{name:'Submit request',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:/^(Save draft & close|Close & keep recovery)$/,exact:true}).click();await page.getByRole('button',{name:'Submit a request',exact:true}).click();await expect(page.getByLabel('Title',{exact:true})).toHaveValue('Lost response regression');
 await page.getByRole('button',{name:'Submit request',exact:true}).click();await expect(page.getByText('Request submitted.',{exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Lost response regression'})).toHaveCount(1);
 assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
 assert.equal((await admin.query(`SELECT count(*)::int n FROM "MaintenanceRequest"`)).rows[0].n,1);assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='maintenance.created'`)).rows[0].n,1);
 await page.getByRole('button',{name:'Submit a request',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Deliberate second request');await page.getByLabel('Description',{exact:true}).fill('New submission');await page.getByRole('button',{name:'Submit request',exact:true}).click();await expect(page.getByText('Request submitted.',{exact:true})).toBeVisible();assert.notEqual(keys[2],keys[0]);
 }finally{await browser.close();}
 await admin.query(`DELETE FROM "AuditEvent"`);await admin.query(`DELETE FROM "MaintenanceRequest"`);
 });
 let id;
 await t.test('creation validates identities, assigned property, bounded fields and CSRF',async()=>{
 for(const payload of [{...valid,companyId:'b'},{...valid,requesterId:'other'},{...valid,title:' '},{...valid,title:'x'.repeat(161)},{...valid,description:'x'.repeat(4001)},{...valid,priority:'urgent'}, {...valid,submissionKey:undefined}, {...valid,submissionKey:'invalid'}, {...valid,submissionKey:42}])assert.equal((await call('resident','POST','/api/resident/maintenance',payload)).statusCode,400);
 for(const propertyId of ['foreign-home','missing'])assert.equal((await call('resident','POST','/api/resident/maintenance',{...valid,propertyId})).statusCode,404);
 for(const extra of [{origin:'https://evil.test'},{'x-csrf-token':'bad'}])assert.equal((await call('resident','POST','/api/resident/maintenance',valid,extra)).statusCode,403);
 for(const role of ['owner','manager','staff','foreign'])assert.equal((await call(role,'POST','/api/resident/maintenance',valid)).statusCode,403);
 assert.equal((await call(null,'GET','/api/resident/maintenance')).statusCode,401);
 const response=await call('resident','POST','/api/resident/maintenance',valid);assert.equal(response.statusCode,200);id=response.json().id;
 assert.deepEqual(Object.keys(response.json()).sort(),['id','propertyId','unitId','unit','category','targetOn','version','title','description','priority','status','createdAt','updatedAt','property'].sort());
 assert.equal((await call('other','POST','/api/resident/maintenance',{...valid,title:'Other request',priority:'high'})).statusCode,200);
 });
 await t.test('same-company ownership, filters, status transitions and audits',async()=>{
 assert.equal((await call('resident','GET','/api/resident/maintenance')).json().length,1);
 assert.equal((await call('other','GET','/api/resident/maintenance')).json()[0].title,'Other request');
 for(const actor of ['owner','manager'])assert.equal((await call(actor,'GET','/api/company/maintenance')).json().length,2);
 for(const actor of ['staff','resident'])assert.equal((await call(actor,'GET','/api/company/maintenance')).statusCode,403);
 assert.deepEqual((await call('foreign','GET','/api/company/maintenance')).json(),[]);
 assert.equal((await call('foreign','PATCH',`/api/company/maintenance/${id}`,{status:'resolved'})).statusCode,404);
 assert.equal((await call('manager','GET','/api/company/maintenance',null,{'x-company-id':'b'})).statusCode,403);
 for(const status of ['in_progress','resolved','open','resolved'])assert.equal((await call('manager','PATCH',`/api/company/maintenance/${id}`,{status})).json().status,status);
 for(const extra of [{origin:'https://evil.test'},{'x-csrf-token':'bad'}])assert.equal((await call('manager','PATCH',`/api/company/maintenance/${id}`,{status:'open'},extra)).statusCode,403);
 assert.equal((await call('resident','PATCH',`/api/company/maintenance/${id}`,{status:'open'})).statusCode,403);
 assert.equal((await call('manager','PATCH',`/api/company/maintenance/${id}`,{status:'closed'})).statusCode,400);
 assert.equal((await call('manager','GET','/api/company/maintenance?status=resolved&propertyId=home')).json().length,1);
 assert.equal((await call('manager','GET','/api/company/maintenance?status=bad')).statusCode,400);
 assert.equal((await call('manager','GET','/api/company/maintenance?propertyId=foreign-home')).statusCode,404);
 assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'maintenance.created\'')).rows[0].n,2);
 assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'maintenance.status.changed\'')).rows[0].n,4);
 });
 await t.test('management work orders validate unit scope, preserve replay and reject stale edits atomically',async()=>{
  for(const [unitId,property,company,creator] of [['unit-a','home','a','owner'],['foreign-unit','foreign-home','b','foreign']])await admin.query(`INSERT INTO "Unit" (id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") VALUES ($1,$2,$3,CASE $1 WHEN 'unit-a' THEN 'Apartment 1' ELSE 'Foreign suite' END,$4,$1,'fixture',NOW())`,[unitId,company,property,creator]);
  const payload={...valid,submissionKey:randomUUID(),title:'Boiler inspection',unitId:'unit-a',category:'hvac',targetOn:'2026-11-20'};
  for(const actor of ['staff','resident'])assert.equal((await call(actor,'POST','/api/company/maintenance',payload)).statusCode,403);
  assert.equal((await call('owner','POST','/api/company/maintenance',{...payload,unitId:'foreign-unit'})).statusCode,404);
  assert.equal((await call('owner','POST','/api/company/maintenance',{...payload,propertyId:'foreign-home'})).statusCode,404);
  assert.equal((await call('owner','POST','/api/company/maintenance',{...payload,companyId:'b'})).statusCode,400);
  assert.equal((await call('resident','POST','/api/resident/maintenance',{...valid,submissionKey:randomUUID(),unitId:'unit-a'})).statusCode,400);
  const results=await Promise.all([call('owner','POST','/api/company/maintenance',payload),call('owner','POST','/api/company/maintenance',payload)]);
  for(const result of results)assert.equal(result.statusCode,200,result.body);
  const row=results[0].json();assert.equal(row.id,results[1].json().id);assert.equal(row.unit.label,'Apartment 1');assert.equal(row.version,1);assert.equal(row.category,'hvac');
  assert.equal((await call('owner','POST','/api/company/maintenance',{...payload,title:'Different'})).statusCode,409);
  const detail=(await call('owner','GET',`/api/company/maintenance/${row.id}`)).json();assert.equal(detail.activity.length,1);assert.equal(detail.activity[0].action,'maintenance.created');
  assert.equal((await call('foreign','GET',`/api/company/maintenance/${row.id}`)).statusCode,404);
  assert.equal((await call('resident','GET',`/api/resident/maintenance/${row.id}`)).statusCode,404);
  const updates=await Promise.all(['in_progress','resolved'].map(status=>call('manager','PATCH',`/api/company/maintenance/${row.id}`,{status,expectedVersion:1,priority:'high'})));
  assert.deepEqual(updates.map(r=>r.statusCode).sort(),[200,409]);
  const updated=(await call('owner','GET',`/api/company/maintenance/${row.id}`)).json();assert.equal(updated.version,2);assert.equal(updated.activity.length,2);assert.ok(updated.activity[0].changes.priority);
  assert.equal((await call('owner','PATCH',`/api/company/maintenance/${row.id}`,{status:'open',expectedVersion:1})).statusCode,409);
  assert.equal((await call('manager','GET','/api/company/maintenance?q=boiler&priority=high')).json().length,1);
  assert.equal((await call('manager','GET','/api/company/maintenance?q='+ 'x'.repeat(201))).statusCode,400);
  const own=(await call('resident','GET',`/api/resident/maintenance/${id}`)).json();assert.equal(own.title,valid.title);assert.ok(own.activity.length);assert.ok(!('recordedBy' in own));assert.ok(!JSON.stringify(own).includes('actorId'));assert.ok(!JSON.stringify(own).includes('changes'));
  assert.equal((await call('other','GET',`/api/resident/maintenance/${id}`)).statusCode,404);
  // Existing resolved history is preserved; no-op saves add neither version nor event.
  await assert.rejects(admin.query('UPDATE "MaintenanceRequest" SET "unitId"=$1 WHERE id=$2',['foreign-unit',row.id]),/foreign key/);
  await admin.query(`CREATE FUNCTION reject_work_order_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='maintenance.updated' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_work_order_update BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_work_order_update()`);
  try{assert.equal((await call('owner','PATCH',`/api/company/maintenance/${row.id}`,{status:updated.status,expectedVersion:2,title:'Must roll back'})).statusCode,500);const after=(await call('owner','GET',`/api/company/maintenance/${row.id}`)).json();assert.equal(after.version,2);assert.equal(after.title,'Boiler inspection');assert.equal(after.activity.length,2);}finally{await admin.query(`DROP TRIGGER reject_work_order_update ON "AuditEvent"; DROP FUNCTION reject_work_order_update()`);}
  const before=updated.activity.length;
  const noOp=await call('owner','PATCH',`/api/company/maintenance/${row.id}`,{status:updated.status,expectedVersion:updated.version});assert.equal(noOp.json().version,2);
  assert.equal((await call('owner','GET',`/api/company/maintenance/${row.id}`)).json().activity.length,before);
  assert.equal((await call('owner','PATCH',`/api/company/maintenance/${row.id}`,{status:updated.status,expectedVersion:2,unitId:null})).statusCode,200);
  const relocated=(await call('owner','GET',`/api/company/maintenance/${row.id}`)).json();assert.equal(relocated.version,3);assert.deepEqual(relocated.activity[0].changes.unitId,{from:'Apartment 1',to:'Property-wide'});
 });
 await t.test('maintenance progress updates',async updateTest=>maintenanceUpdateCases(updateTest,admin,db,call,app,id));
 await t.test('maintenance paid expense sources',async costTest=>maintenanceCostCases(costTest,admin,db,call,app,id));
 await t.test('portfolio counts use complete company records and respect role boundaries',async()=>{
  const owner=(await call('owner','GET','/api/company/property-directory')).json();assert.equal(owner.items.length,1);assert.equal(owner.items[0].id,'home');assert.equal(owner.items[0].activeUnits,1);assert.equal(owner.items[0].occupiedUnits,0);assert.equal(owner.items[0].openMaintenance,(await admin.query(`SELECT count(*)::int n FROM "MaintenanceRequest" WHERE "companyId"='a' AND status IN ('open','in_progress')`)).rows[0].n);
  const staff=(await call('staff','GET','/api/company/property-directory')).json();assert.deepEqual(staff.items,[{id:'home',activeUnits:1}]);
  assert.equal((await call('resident','GET','/api/company/property-directory')).statusCode,403);
  assert.equal((await call('owner','GET','/api/company/property-directory',null,{'x-company-id':'b'})).statusCode,403);
 });
 await t.test('overdue and assignee views match their company attention counts and stay management-only',async()=>{
  const original=(await admin.query(`SELECT status,"targetOn","assigneeId" FROM "MaintenanceRequest" WHERE id=$1`,[id])).rows[0];
  try {
   await admin.query(`UPDATE "MaintenanceRequest" SET status='open',"targetOn"='2000-01-01',"assigneeId"=NULL WHERE id=$1`,[id]);
   const overdue=await call('manager','GET','/api/company/maintenance?due=overdue&assignee=unassigned');assert.equal(overdue.statusCode,200,overdue.body);assert.ok(overdue.json().some(row=>row.id===id));
   assert.equal((await call('manager','GET','/api/company/maintenance?due=upcoming')).json().some(row=>row.id===id),false);
   const overview=(await call('owner','GET','/api/company/overview')).json();assert.ok(overview.maintenance.overdueCount>=1);
   assert.equal((await call('resident','GET','/api/resident/maintenance?due=overdue')).statusCode,400);
   assert.equal((await call('manager','GET','/api/company/maintenance?due=invalid')).statusCode,400);
   assert.equal((await call('foreign','GET','/api/company/maintenance?due=overdue')).json().some(row=>row.id===id),false);
  } finally {await admin.query(`UPDATE "MaintenanceRequest" SET status=$2,"targetOn"=$3,"assigneeId"=$4 WHERE id=$1`,[id,original.status,original.targetOn,original.assigneeId]);}
 });
 await t.test('company suspension orders before and after maintenance create/replay/read/status',async()=>{
  await admin.query(`UPDATE "User" SET "platformRole"='owner' WHERE id='owner'`);
  const operations=[
   ['create','resident','POST','/api/resident/maintenance',{...valid,submissionKey:randomUUID(),title:'Suspension race'}],
   ['replay','resident','POST','/api/resident/maintenance',valid],
   ['resident read','resident','GET','/api/resident/maintenance',null],
   ['manager read','manager','GET','/api/company/maintenance',null],
   ['status','manager','PATCH',`/api/company/maintenance/${id}`,{status:'open'}],
   ['resident updates','resident','GET',`/api/resident/maintenance/${id}/updates`,null],
   ['management update','manager','POST',`/api/company/maintenance/${id}/updates`,{content:'Suspension update regression',visibility:'internal',submissionKey:randomUUID()}],
  ];
  const waitBlocked=async()=>{
   for(let attempt=0;attempt<200;attempt++){
    if((await admin.query(`SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%Company%'`)).rows.length)return;
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   assert.fail('operation did not reach the shared Company lock');
  };
  // Suspension-leading operations must retry their older snapshots and deny access.
  for(const [label,user,method,path,payload] of operations){
   const leader=await admin.connect();let pending;
   const before=(await admin.query(`SELECT count(*)::int n FROM "AuditEvent"`)).rows[0].n;
   try{
    await leader.query('BEGIN');await leader.query(`UPDATE "Company" SET status='suspended' WHERE id='a'`);
    pending=call(user,method,path,payload);await waitBlocked();
    await leader.query('COMMIT');assert.equal((await pending).statusCode,403,label);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent"`)).rows[0].n,before,label+' must not write audit');
   }finally{await leader.query('ROLLBACK');leader.release();if(pending)await pending;await admin.query(`UPDATE "Company" SET status='active' WHERE id='a'`);}
  }
  // Pause each real maintenance route AFTER authorization, before its data access.
  // The actual platform suspension API must wait until that transaction commits.
  for(const [label,user,method,path,payload] of operations){
   let entered,release;
   const reached=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
   let armed=true;
   const gatedDb=new Proxy(db,{get(target,key){
    if(key==='$transaction')return (run,options)=>target.$transaction(tx=>run(new Proxy(tx,{get(transaction,field){
     if(field==='maintenanceRequest')return new Proxy(transaction.maintenanceRequest,{get(delegate,operation){
      const fn=Reflect.get(delegate,operation);
      if(typeof fn!=='function')return fn;
      return async(...args)=>{if(armed){armed=false;entered();await gate;}return fn.apply(delegate,args);};
     }});
     const value=Reflect.get(transaction,field);return typeof value==='function'?value.bind(transaction):value;
    }})),options);
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
   }});
   const gatedApp=Fastify();const gatedAuth=await registerSessions(gatedApp,gatedDb,{origin:'https://app.test',domain:'unused.auth0.com',clientId:'test',clientSecret:'test-only',secure:true});registerApplication(gatedApp,gatedDb,gatedAuth,'https://app.test',undefined,{notificationPublisher:async()=>{}});
   let maintenance,suspension;
   try{
    const reviewedPayload=method==='PATCH'&&path.startsWith('/api/company/maintenance/')?{...payload,expectedVersion:(await admin.query('SELECT version FROM "MaintenanceRequest" WHERE id=$1',[id])).rows[0].version}:payload;
    maintenance=gatedApp.inject({method,url:path,headers:{cookie:`__Host-pf-session=token-${user}`,origin:'https://app.test','x-csrf-token':'csrf'},...(reviewedPayload?{payload:reviewedPayload}:{})});
    // inject is lazy unless its thenable is consumed.
    maintenance=Promise.resolve(maintenance);
    await Promise.race([reached,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('maintenance gate timed out')),3000);timer.unref();})]);
    suspension=call('owner','PATCH','/api/platform/companies/a',{name:'a',status:'suspended'});
    await waitBlocked();
    assert.equal((await admin.query(`SELECT status FROM "Company" WHERE id='a'`)).rows[0].status,'active',label+' suspension must not commit first');
    release();assert.equal((await maintenance).statusCode,200,label);
    assert.equal((await suspension).statusCode,200,label+' suspension');
    assert.equal((await call(user,method,path,payload)).statusCode,403,label+' after suspension');
   }finally{release();if(maintenance)await maintenance;if(suspension)await suspension;await gatedApp.close();await admin.query(`UPDATE "Company" SET status='active' WHERE id='a'`);}
  }
  // Restore the established fixture and its audit counts for subsequent regressions.
  await admin.query(`DELETE FROM "AuditEvent" WHERE "targetId" IN (SELECT id FROM "MaintenanceRequest" WHERE title='Suspension race')`);
  await admin.query(`DELETE FROM "MaintenanceRequest" WHERE title='Suspension race'`);
  await admin.query(`UPDATE "User" SET "platformRole"=NULL WHERE id='owner'`);
 });
 await t.test('forced RLS and composite property boundary',async()=>{
 assert.deepEqual((await admin.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='MaintenanceRequest'")).rows[0],{relrowsecurity:true,relforcerowsecurity:true});
 assert.deepEqual(await db.maintenanceRequest.findMany(),[]);
 await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id', 'a', true)`;return tx.maintenanceRequest.create({data:{...valid,submissionKey:null,companyId:'b',requesterId:'resident'}});}),/row-level security|foreign key/i);
 await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id', 'a', true)`;return tx.maintenanceRequest.create({data:{...valid,submissionKey:null,propertyId:'foreign-home',companyId:'a',requesterId:'resident'}});}),/foreign key/i);
 });
 await t.test('revocation locks block creation/read; manager history survives removal and transfer',async()=>{
 const leader=await admin.connect();try{
 await leader.query('BEGIN');await leader.query('UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=\'resident\'');
 const pending=call('resident','POST','/api/resident/maintenance',valid); // injection begins immediately
 let blocked=false;for(let i=0;i<100;i++){const rows=(await admin.query("SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0 AND query LIKE '%User%'" )).rows;if(rows.length){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(blocked,'resident operation reached shared lock');
 await leader.query('DELETE FROM "ResidentPropertyAssignment" WHERE "userId"=\'resident\'');await leader.query('COMMIT');assert.equal((await pending).statusCode,404);
 }finally{await leader.query('ROLLBACK');leader.release();}
 assert.deepEqual((await call('resident','GET','/api/resident/maintenance')).json(),[]);
 assert.equal((await call('manager','GET','/api/company/maintenance')).json().length,3);
 // Explicit reassignment restores own history, never another resident's requests.
 assert.equal((await call('manager','PUT','/api/company/properties/home/residents/resident')).statusCode,200);
 assert.equal((await call('resident','GET','/api/resident/maintenance')).json().length,1);
 for(const change of [{role:'resident',status:'disabled'},{role:'staff',status:'active'}]) {
   assert.equal((await call('owner','PATCH','/api/company/members/resident',change)).statusCode,200);
   assert.equal((await call('resident','GET','/api/resident/maintenance')).statusCode,403);
   assert.equal((await call('owner','PATCH','/api/company/members/resident',{role:'resident',status:'active'})).statusCode,200);
   assert.deepEqual((await call('resident','GET','/api/resident/maintenance')).json(),[]);
   assert.equal((await call('manager','PUT','/api/company/properties/home/residents/resident')).statusCode,200);
 }
 // Reads use the same lock and must discard pre-revocation snapshots too.
 const readerLeader=await admin.connect();try {
   await readerLeader.query('BEGIN');await readerLeader.query('UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=\'resident\'');
   const pending=call('resident','GET','/api/resident/maintenance');
   let blocked=false;for(let i=0;i<100;i++){if((await admin.query("SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0 AND query LIKE '%User%'" )).rows.length){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(blocked);
   await readerLeader.query('DELETE FROM "ResidentPropertyAssignment" WHERE "userId"=\'resident\'');await readerLeader.query('COMMIT');assert.deepEqual((await pending).json(),[]);
 } finally {await readerLeader.query('ROLLBACK');readerLeader.release();}
 await admin.query('UPDATE "CompanyMembership" SET "companyId"=\'b\' WHERE "userId"=\'resident\'');
 assert.deepEqual((await call('resident','GET','/api/resident/maintenance')).json(),[]);
 assert.equal((await call('manager','PATCH',`/api/company/maintenance/${id}`,{status:'in_progress'})).statusCode,200);
 await admin.query('UPDATE "User" SET "platformRole"=\'owner\' WHERE id=\'owner\'');
 assert.equal((await call('owner','PATCH','/api/platform/users/resident/status',{status:'disabled'})).statusCode,200);
 assert.equal((await call('resident','GET','/api/resident/maintenance')).statusCode,403);
 assert.equal((await call('owner','PATCH','/api/platform/users/resident/status',{status:'active'})).statusCode,200);
 assert.deepEqual((await call('resident','GET','/api/resident/maintenance')).json(),[]);
 await admin.query('UPDATE "Company" SET status=\'suspended\' WHERE id=\'a\'');
 assert.equal((await call('manager','GET','/api/company/maintenance')).statusCode,403);
 await admin.query('UPDATE "Company" SET status=\'active\' WHERE id=\'a\'');
 assert.equal((await call('manager','GET','/api/company/maintenance')).json().length,3);
 assert.equal((await admin.query('SELECT count(*)::int n FROM "MaintenanceRequest"')).rows[0].n,3);
 });
 await t.test('private document foundation',async sub=>privateDocumentCases(sub,admin,db,call,id,scanControl));
 await t.test('delegated maintenance workflow',async sub=>workOrderCases(sub,admin,db,call,app));
 await t.test('management vendor contacts',async sub=>vendorCases(sub,admin,db,call,app));
 await t.test('preventive maintenance schedules',async sub=>preventiveCases(sub,admin,db,call,app));
 await t.test('connected work calendar',async sub=>calendarCases(sub,admin,call,app));
 await t.test('private document library',async sub=>documentLibraryCases(sub,admin,call,app));
 await t.test('lease inspections and retained comparison',async sub=>inspectionCases(sub,admin,db,call,app));
 await t.test('unsigned agreement preparation and review',async sub=>agreementCases(sub,admin,db,call,app));
 await t.test('durable scoped in-app notifications',async sub=>{notificationControl.enabled=true;await notificationCases(sub,admin,db,call,app);});
 await t.test('requester-authored shared maintenance replies',async sub=>residentMaintenanceUpdateCases(sub,admin,db,call));
 await t.test('personal future notification preferences',async sub=>notificationPreferenceCases(sub,admin,db,call));
 await t.test('bounded complete maintenance directories',async sub=>maintenanceDirectoryCases(sub,admin,db,call,app));
});
