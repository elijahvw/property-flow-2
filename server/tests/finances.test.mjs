import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import pg from 'pg';
import Fastify from 'fastify';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {chromium,expect} from '@playwright/test';
import {registerApplication} from '../dist/application.js';
import {registerSessions,digest} from '../dist/sessions.js';
import {cents,date} from '../dist/operational.js';
const url=process.env.TEST_FINANCES_DATABASE_URL;
test('manual finance isolation, replay, corrections and totals',{skip:!url},async t=>{
 const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/propertyflow_finances_test');assert.equal(process.env.FINANCES_DISPOSABLE,'tmpfs-verified');
 const admin=new pg.Pool({connectionString:url});t.after(()=>admin.end());
 assert.equal((await admin.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`)).rows[0].n,0);
 for(const name of readdirSync(new URL('../prisma/migrations/',import.meta.url)).filter(n=>/^\d/.test(n)).sort())await admin.query(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`,import.meta.url),'utf8'));
 await admin.query(`ALTER ROLE propertyflow_runtime LOGIN PASSWORD 'finances-test-only'`);
 const runtime=new URL(url);runtime.username='propertyflow_runtime';runtime.password='finances-test-only';
 const pool=new pg.Pool({connectionString:runtime.href,max:8}),db=new PrismaClient({adapter:new PrismaPg(pool)});t.after(async()=>{await db.$disconnect();await pool.end();});
 for(const id of ['a','b'])await admin.query(`INSERT INTO "Company"(id,name,"updatedAt") VALUES($1,$1,NOW())`,[id]);
 for(const [id,company,role,platform] of [['owner','a','owner',null],['manager','a','manager',null],['staff','a','staff',null],['resident','a','resident',null],['resident2','a','resident',null],['foreign','b','owner',null],['foreign-resident','b','resident',null],['platform',null,null,'owner']]){
  await admin.query(`INSERT INTO "User"(id,email,"emailVerified","platformRole","updatedAt") VALUES($1,$2,true,$3,NOW())`,[id,`${id}@test.invalid`,platform]);
  if(company)await admin.query(`INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,$2,$3,NOW())`,[id,company,role]);
  await db.session.create({data:{tokenHash:digest(`token-${id}`),csrfToken:'csrf',userId:id,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
 }
 for(const [id,company] of [['home','a'],['other-home','a'],['foreign-home','b']])await admin.query(`INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES($1,$1,'street','city','state','zip',$2,NOW())`,[id,company]);
 await admin.query(`INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','resident'),('a','home','resident2'),('b','foreign-home','foreign-resident')`);
 const app=Fastify();t.after(()=>app.close());const auth=await registerSessions(app,db,{origin:'https://app.test',domain:'unused.auth0.com',clientId:'test',clientSecret:'test-only',secure:true});registerApplication(app,db,auth,'https://app.test');
 const call=(user,method,path,payload,extra={})=>app.inject({method,url:path,headers:{...(user?{cookie:`__Host-pf-session=token-${user}`} : {}),origin:'https://app.test','x-csrf-token':'csrf',...extra},...(payload?{payload}:{})});
 const path='/api/company/finances';let entry;const body=(extra={})=>({propertyId:'home',occurredOn:'2026-10-14',amount:'1234.56',kind:'income',category:'rent',memo:null,submissionKey:randomUUID(),...extra});
 await t.test('durable concurrent replay, mismatches, validation and authority',async()=>{
  const payload=body();const results=await Promise.all([call('owner','POST',path,payload),call('owner','POST',path,payload)]);for(const r of results)assert.equal(r.statusCode,200,r.body);entry=results[0].json();assert.equal(entry.amountCents,123456);assert.equal(results[1].json().id,entry.id);
  assert.equal((await call('owner','POST',path,{...payload,amount:'9.99'})).statusCode,409);
  for(const user of ['staff','resident','platform']){assert.equal((await call(user,'GET',path)).statusCode,403);assert.equal((await call(user,'POST',path,body())).statusCode,403);assert.equal((await call(user,'POST',`${path}/${entry.id}/void`,{expectedVersion:1,reason:'Wrong'})).statusCode,403);}
  for(const patch of [{amount:'0'},{amount:'1.001'},{amount:'-1'},{amount:'1e3'},{amount:'1000000.01'},{occurredOn:'2026-02-30'},{kind:'income',category:'repairs'},{kind:'expense',category:'rent'},{currency:'EUR'},{memo:'x'.repeat(501)},{companyId:'b'},{createdById:'foreign'}])assert.equal((await call('manager','POST',path,body(patch))).statusCode,400);
  for(const extra of [{origin:'https://evil.test'},{'x-csrf-token':'bad'},{'x-company-id':'b'}])assert.equal((await call('manager','POST',path,body(),extra)).statusCode,403);
  assert.equal((await call('owner','POST',path,body({propertyId:'foreign-home'}))).statusCode,404);assert.deepEqual((await call('foreign','GET',path)).json().items,[]);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "LedgerEntry"`)).rows[0].n,1);assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='finance.created'`)).rows[0].n,1);
 });
 await t.test('void response replay retains history and one audit; conflicting corrections and foreign ids denied',async()=>{
  const payload={expectedVersion:1,reason:'Entered on wrong property'};const responses=await Promise.all([call('owner','POST',`${path}/${entry.id}/void`,payload),call('manager','POST',`${path}/${entry.id}/void`,payload)]);for(const r of responses)assert.equal(r.statusCode,200,r.body);assert.equal(responses[0].json().version,2);
  assert.equal((await call('owner','POST',`${path}/${entry.id}/void`,payload)).statusCode,200);assert.equal((await call('owner','POST',`${path}/${entry.id}/void`,{...payload,reason:'Different'})).statusCode,409);assert.equal((await call('foreign','POST',`${path}/${entry.id}/void`,payload)).statusCode,404);
  assert.equal((await call('owner','POST',`${path}/${entry.id}/void`,{reason:'',expectedVersion:1})).statusCode,400);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='finance.voided'`)).rows[0].n,1);const result=(await call('owner','GET',path)).json();assert.equal(result.items.length,1);assert.deepEqual(result.summary,{incomeCents:'0',expenseCents:'0',netCents:'0'});
 });
 await t.test('filtered totals include all pages, exact cents and void exclusion',async()=>{
  for(let i=0;i<51;i++)await admin.query(`INSERT INTO "LedgerEntry"(id,"companyId","propertyId","createdById","submissionKey","submissionHash","occurredOn","amountCents",kind,category) VALUES($1,'a','home','owner',$2,'fixture','2026-10-14',101,'income','rent')`,['paging-'+String(i).padStart(3,'0'),randomUUID()]);
  assert.equal((await call('manager','POST',path,body({kind:'expense',category:'repairs',amount:'100.00'}))).statusCode,200);assert.equal((await call('manager','POST',path,body({propertyId:'other-home',amount:'10.00'}))).statusCode,200);
  const filter='?propertyId=home&dateFrom=2026-10-14&dateTo=2026-10-14';const first=(await call('owner','GET',path+filter)).json(),second=(await call('owner','GET',path+filter+'&cursor='+first.nextCursor)).json();assert.equal(first.items.length,50);assert.ok(first.nextCursor);assert.equal(second.nextCursor,null);assert.deepEqual(first.summary,{incomeCents:'5151',expenseCents:'10000',netCents:'-4849'});assert.deepEqual(first.summary,second.summary);assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,53);
  assert.deepEqual((await call('manager','GET',path+'?dateTo=2026-10-13')).json().summary,{incomeCents:'0',expenseCents:'0',netCents:'0'});
  for(const query of ['?propertyId=foreign-home','?companyId=b','?dateFrom=2026-02-30','?dateFrom=2027-01-01&dateTo=2026-01-01'])assert.ok([400,404].includes((await call('owner','GET',path+query)).statusCode));
  await admin.query(`DELETE FROM "LedgerEntry" WHERE id LIKE 'paging-%'`);
 });
 await t.test('RLS, composite foreign key and immutable monetary columns enforced by runtime grants',async()=>{
  assert.deepEqual(await db.ledgerEntry.findMany(),[]);assert.deepEqual((await admin.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='LedgerEntry'`)).rows[0],{relrowsecurity:true,relforcerowsecurity:true});
  for(const privilege of ['DELETE','UPDATE'])assert.equal((await admin.query(`SELECT has_table_privilege('propertyflow_runtime','"LedgerEntry"',$1) allowed`,[privilege])).rows[0].allowed,false);
  await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;return tx.ledgerEntry.update({where:{id:entry.id},data:{amountCents:1}});}),/permission denied/i);
  await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;return tx.ledgerEntry.create({data:{companyId:'a',propertyId:'foreign-home',createdById:'owner',submissionKey:randomUUID(),submissionHash:'x',occurredOn:new Date('2026-10-14'),amountCents:1,kind:'income',category:'rent'}});}),/foreign key/i);
 });
 await t.test('audit failure rolls back creation identity and void status',async()=>{
  await admin.query(`CREATE FUNCTION reject_finance_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action LIKE 'finance.%' THEN RAISE EXCEPTION 'finance audit unavailable'; END IF; RETURN NEW; END$$; CREATE TRIGGER reject_finance_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_finance_audit()`);
  const payload=body();assert.equal((await call('owner','POST',path,payload)).statusCode,500);assert.equal((await admin.query(`SELECT count(*)::int n FROM "LedgerEntry" WHERE "submissionKey"=$1`,[payload.submissionKey])).rows[0].n,0);
  const active=(await call('owner','GET',path)).json().items.find(r=>!r.voidedAt);assert.equal((await call('owner','POST',`${path}/${active.id}/void`,{expectedVersion:active.version,reason:'Correction'})).statusCode,500);assert.equal((await admin.query(`SELECT "voidedAt" FROM "LedgerEntry" WHERE id=$1`,[active.id])).rows[0].voidedAt,null);
  await admin.query(`DROP TRIGGER reject_finance_audit ON "AuditEvent";DROP FUNCTION reject_finance_audit()`);assert.equal((await call('owner','POST',path,payload)).statusCode,200);
 });
 await t.test('stale void version and current suspension/revocation deny mutations and replay',async()=>{
  const payload=body(),row=(await call('owner','POST',path,payload)).json();assert.equal((await call('owner','POST',`${path}/${row.id}/void`,{expectedVersion:2,reason:'Wrong'})).statusCode,409);
  await admin.query(`UPDATE "Company" SET status='suspended' WHERE id='a'`);for(const [method,url,data] of [['GET',path],['POST',path,payload],['POST',`${path}/${row.id}/void`,{expectedVersion:1,reason:'Wrong'}]])assert.equal((await call('owner',method,url,data)).statusCode,403);await admin.query(`UPDATE "Company" SET status='active' WHERE id='a'`);
  await admin.query(`UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='owner'`);assert.equal((await call('owner','POST',path,payload)).statusCode,403);await admin.query(`UPDATE "CompanyMembership" SET status='active' WHERE "userId"='owner'`);
 });
 await t.test('real browser committed response loss retries one transaction and one audit',{skip:!process.env.TEST_FINANCES_BROWSER_URL},async()=>{
  const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();let lose=true;const keys=[];
   await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url());const response=await app.inject({method:req.method(),url:u.pathname+u.search,headers:{...req.headers(),origin:'https://app.test',cookie:'__Host-pf-session=token-owner'},...(req.postData()?{payload:req.postData()}:{})});if(req.method()==='POST'&&u.pathname===path){keys.push(req.postDataJSON().submissionKey);assert.equal(response.statusCode,200,response.body);if(lose){lose=false;return route.abort('failed');}}await route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});});
   await page.goto(process.env.TEST_FINANCES_BROWSER_URL+'/company/finances');await page.getByRole('button',{name:'Record a transaction',exact:true}).click();await page.getByLabel('Date received or paid').fill('2026-10-14');await page.getByLabel('Amount (USD)').fill('99.99');await page.getByLabel('Memo (optional)').fill('Browser receipt');await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Record a transaction',exact:true}).click();await expect(page.getByLabel('Amount (USD)')).toHaveValue('99.99');await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();assert.equal(keys[0],keys[1]);const rows=(await admin.query(`SELECT id,"amountCents" FROM "LedgerEntry" WHERE memo='Browser receipt'`)).rows;assert.equal(rows.length,1);assert.equal(rows[0].amountCents,9999);assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE "targetId"=$1`,[rows[0].id])).rows[0].n,1);
  }finally{await browser.close();}
 });
});
