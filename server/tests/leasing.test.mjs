import {fixtureIdentities} from "./fixture-identities.mjs";
import {renewalCases} from "./renewal-cases.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import pg from 'pg';
import Fastify from 'fastify';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {chromium,expect} from '@playwright/test';
import {registerApplication} from '../dist/application.js';
import {registerSessions,digest} from '../dist/sessions.js';
import {cents,date} from '../dist/operational.js';
const url=process.env.TEST_LEASING_DATABASE_URL;
test('money/date input preserves cents and rejects invalid calendar dates',()=>{
 assert.equal(cents('1234.56'),123456);assert.equal(cents('0.1'),10);assert.equal(cents('0'),0);
 for(const value of ['-1','1.001','1e3','NaN','01.00',1, '1000000.01'])assert.throws(()=>cents(value));
 assert.equal(date('2028-02-29','date').toISOString().slice(0,10),'2028-02-29');
 for(const value of ['2026-02-29','2026-04-31','2026-1-1','2026-10-14T00:00:00Z',null])assert.throws(()=>date(value,'date'));
});
test('units and leases real PostgreSQL isolation, history and concurrency',{skip:!url},async t=>{
 const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/propertyflow_leasing_test');assert.equal(process.env.LEASING_DISPOSABLE,'tmpfs-verified');
 const admin=new pg.Pool({connectionString:url});t.after(()=>admin.end());
 assert.equal((await admin.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`)).rows[0].n,0);
 for(const name of readdirSync(new URL('../prisma/migrations/',import.meta.url)).filter(n=>/^\d/.test(n)).sort())await admin.query(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`,import.meta.url),'utf8'));
 await admin.query(`ALTER ROLE propertyflow_runtime LOGIN PASSWORD 'leasing-test-only'`);
 const runtime=new URL(url);runtime.username='propertyflow_runtime';runtime.password='leasing-test-only';
 const pool=new pg.Pool({connectionString:runtime.href,max:8}),db=new PrismaClient({adapter:new PrismaPg(pool)});t.after(async()=>{await db.$disconnect();await pool.end();});
 for(const id of ['a','b'])await admin.query(`INSERT INTO "Company"(id,name,"updatedAt") VALUES($1,$1,NOW())`,[id]);
 for(const [id,company,role,platform] of [['owner','a','owner',null],['manager','a','manager',null],['staff','a','staff',null],['resident','a','resident',null],['resident2','a','resident',null],['foreign','b','owner',null],['foreign-resident','b','resident',null],['platform',null,null,'owner']]){
  await admin.query(`INSERT INTO "User"(id,email,"emailVerified","platformRole","updatedAt") VALUES($1,$2,true,$3,NOW())`,[id,`${id}@test.invalid`,platform]);
  if(company)await admin.query(`INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,$2,$3,NOW())`,[id,company,role]);
  await db.session.create({data:{tokenHash:digest(`token-${id}`),csrfToken:'csrf',userId:id,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
 }
 for(const [id,company] of [['home','a'],['other-home','a'],['foreign-home','b']])await admin.query(`INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES($1,$1,'street','city','state','zip',$2,NOW())`,[id,company]);
 await admin.query(`INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','resident'),('a','home','resident2'),('b','foreign-home','foreign-resident')`);
 const app=Fastify();t.after(()=>app.close());const auth=await registerSessions(app,db,{origin:'https://app.test',domain:'unused.auth0.com',clientId:'test',clientSecret:'test-only',secure:true});registerApplication(app,db,auth,'https://app.test',await fixtureIdentities(admin));
 const call=(user,method,path,payload,extra={})=>app.inject({method,url:path,headers:{...(user?{cookie:`__Host-pf-session=token-${user}`} : {}),origin:'https://app.test','x-csrf-token':'csrf',...extra},...(payload?{payload}:{})});
 const units='/api/company/properties/home/units',leases='/api/company/leases';
 let unit,lease;
 const terms={startsOn:'2026-10-01',endsOn:'2027-09-30',monthlyRent:'1500.01',status:'active'};
 const unitBody={label:'Unit 1',submissionKey:randomUUID()};
 const leaseBody=()=>({propertyId:'home',unitId:unit.id,residentId:'resident',...terms,submissionKey:randomUUID()});
 await t.test('unit create/replay, duplicate names, CSRF, roles and boundaries',async()=>{
  for(const user of ['resident','platform'])assert.equal((await call(user,'GET',units)).statusCode,403);
  for(const user of ['staff','resident','platform'])assert.equal((await call(user,'POST',units,unitBody)).statusCode,403);
  for(const extra of [{origin:'https://evil.test'},{'x-csrf-token':'bad'},{'x-company-id':'b'}])assert.equal((await call('owner','POST',units,unitBody,extra)).statusCode,403);
  assert.equal((await call('owner','POST','/api/company/properties/foreign-home/units',unitBody)).statusCode,404);
  for(const payload of [{label:''},{...unitBody,label:'x'.repeat(81)},{...unitBody,companyId:'b'},{...unitBody,submissionKey:'bad'}])assert.equal((await call('owner','POST',units,payload)).statusCode,400);
  const results=await Promise.all([call('owner','POST',units,unitBody),call('owner','POST',units,unitBody)]);
  for(const response of results)assert.equal(response.statusCode,200,response.body);
  unit=results[0].json();assert.equal(results[1].json().id,unit.id);
  assert.equal((await call('owner','POST',units,{...unitBody,label:'Different'})).statusCode,409);
  assert.equal((await call('manager','POST',units,{...unitBody,submissionKey:randomUUID()})).statusCode,409);
  assert.equal((await call('staff','GET',units)).json().items.length,1);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='unit.created'`)).rows[0].n,1);
 });
 await t.test('lease durable replay, same-key mismatch, rent cents and tenant/role validation',async()=>{
  const payload=leaseBody(),response=await call('manager','POST',leases,payload);assert.equal(response.statusCode,200,response.body);lease=response.json();assert.equal(lease.rentCents,150001);
  assert.equal((await call('manager','POST',leases,payload)).json().id,lease.id);
  assert.equal((await call('manager','POST',leases,{...payload,monthlyRent:'1600.00'})).statusCode,409);
  for(const user of ['staff','resident','platform']){assert.equal((await call(user,'GET',leases)).statusCode,403);assert.equal((await call(user,'POST',leases,leaseBody())).statusCode,403);}
  for(const extra of [{origin:'https://evil.test'},{'x-csrf-token':'bad'},{'x-company-id':'b'}])assert.equal((await call('owner','POST',leases,leaseBody(),extra)).statusCode,403);
  assert.deepEqual((await call('foreign','GET',leases)).json().items,[]);
  for(const patch of [{startsOn:'2026-02-30'},{endsOn:'2020-01-01'},{monthlyRent:'1.001'},{currency:'EUR'},{status:'signed'},{status:'ended',endsOn:null}])assert.equal((await call('owner','POST',leases,{...leaseBody(),...patch})).statusCode,400);
  for(const patch of [{propertyId:'foreign-home'},{unitId:'missing'},{residentId:'foreign-resident'},{propertyId:'other-home'}]){
   const result=await call('owner','POST',leases,{...leaseBody(),status:'draft',...patch});assert.ok([404,409].includes(result.statusCode),result.body);
  }
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='lease.created'`)).rows[0].n,1);
 });
 await t.test('lease search is scoped before pagination and current portfolio counts follow business dates',async()=>{
  for(const q of ['home','Unit 1','resident@test.invalid']){const result=await call('owner','GET',leases+'?q='+encodeURIComponent(q));assert.equal(result.statusCode,200,result.body);assert.equal(result.json().items.length,1);}
  assert.equal((await call('owner','GET',leases+'?q=unmatched')).json().items.length,0);
  assert.equal((await call('foreign','GET',leases+'?q=resident')).json().items.length,0);
  assert.equal((await call('owner','GET',leases+'?q='+ 'x'.repeat(201))).statusCode,400);
  const portfolio=(await call('owner','GET','/api/company/property-directory')).json();const home=portfolio.items.find(p=>p.id==='home');assert.equal(home.activeUnits,1);assert.equal(home.occupiedUnits,portfolio.today>=terms.startsOn&&portfolio.today<=terms.endsOn?1:0);
  const combined=await call('owner','GET',leases+'?q=unmatched&attention=in_effect');assert.equal(combined.json().items.length,0,'search AND date conditions must both apply');
 });
 await t.test('exact unit lease history is company-scoped and combines with property and search',async()=>{
  const response=await call('owner','GET',leases+'?unitId='+unit.id+'&propertyId=home');assert.equal(response.statusCode,200,response.body);assert.equal(response.json().unit.id,unit.id);assert.equal(response.json().unit.label,unit.label);assert.deepEqual(response.json().items.map(r=>r.id),[lease.id]);
  assert.equal((await call('owner','GET',leases+'?unitId='+unit.id+'&q=unmatched')).json().items.length,0);
  for(const propertyId of ['other-home','foreign-home'])assert.equal((await call('owner','GET',leases+'?unitId='+unit.id+'&propertyId='+propertyId)).statusCode,404);
  assert.equal((await call('foreign','GET',leases+'?unitId='+unit.id)).statusCode,404);
  assert.equal((await call('staff','GET',leases+'?unitId='+unit.id)).statusCode,403);
  assert.equal((await call('owner','GET',leases+'?unitId=missing')).statusCode,404);
 });
 await t.test('optimistic edits, archive/active guard and ended history after transfer',async()=>{
  assert.equal((await call('owner','PATCH',`/api/company/units/${unit.id}`,{label:unit.label,status:'archived',expectedVersion:unit.version})).statusCode,409);
  const changes=await Promise.all([call('owner','PATCH',`${leases}/${lease.id}`,{...terms,status:'ended',expectedVersion:lease.version}),call('manager','PATCH',`${leases}/${lease.id}`,{...terms,monthlyRent:'1600.00',expectedVersion:lease.version})]);
  assert.deepEqual(changes.map(r=>r.statusCode).sort(),[200,409]);
  lease=(await call('owner','GET',leases)).json().items.find(r=>r.id===lease.id);
  if(lease.status!=='ended'){const result=await call('owner','PATCH',`${leases}/${lease.id}`,{...terms,status:'ended',expectedVersion:lease.version});assert.equal(result.statusCode,200,result.body);lease=result.json();}
  const archived=await call('owner','PATCH',`/api/company/units/${unit.id}`,{label:'Unit renamed',status:'archived',expectedVersion:unit.version});assert.equal(archived.statusCode,200,archived.body);unit=archived.json();
  assert.equal((await call('owner','POST',units,unitBody)).json().id,unit.id,'replay after rename must not create another unit');
  assert.equal((await call('owner','POST',leases,leaseBody())).statusCode,409);
  const restored=await call('owner','PATCH',`/api/company/units/${unit.id}`,{label:unit.label,status:'active',expectedVersion:unit.version});assert.equal(restored.statusCode,200,restored.body);unit=restored.json();
  await admin.query(`DELETE FROM "ResidentPropertyAssignment" WHERE "userId"='resident'`);await admin.query(`UPDATE "CompanyMembership" SET "companyId"='b' WHERE "userId"='resident'`);
  const history=await call('owner','PATCH',`${leases}/${lease.id}`,{...terms,status:'ended',expectedVersion:lease.version});assert.equal(history.statusCode,200,history.body);lease=history.json();
  assert.equal((await call('owner','PATCH',`${leases}/${lease.id}`,{...terms,status:'active',expectedVersion:lease.version})).statusCode,404);
  assert.equal((await call('foreign','PATCH',`${leases}/${lease.id}`,{...terms,status:'ended',expectedVersion:lease.version})).statusCode,404);
  await admin.query(`UPDATE "CompanyMembership" SET "companyId"='a' WHERE "userId"='resident'`);await admin.query(`INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','resident')`);
 });
 await t.test('different managers race for one active unit; DB constraint independently enforces it',async()=>{
  const requests=await Promise.all([call('owner','POST',leases,leaseBody()),call('manager','POST',leases,leaseBody())]);assert.deepEqual(requests.map(r=>r.statusCode).sort(),[200,409]);
  const active=requests.find(r=>r.statusCode===200).json();
  await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;return tx.lease.create({data:{companyId:'a',propertyId:'home',unitId:unit.id,residentId:'resident',createdById:'owner',submissionKey:randomUUID(),submissionHash:'test',startsOn:new Date('2026-10-01'),endsOn:new Date('2027-09-30'),rentCents:150000,status:'active'}});}),/unique/i);
  assert.equal((await call('owner','PATCH',`${leases}/${active.id}`,{...terms,status:'ended',expectedVersion:active.version})).statusCode,200);
 });
 await t.test('forced RLS, composite boundaries and immutable retention grants',async()=>{
  for(const table of ['Unit','Lease']){
   assert.deepEqual((await admin.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=$1`,[table])).rows[0],{relrowsecurity:true,relforcerowsecurity:true});
   assert.equal((await admin.query(`SELECT has_table_privilege('propertyflow_runtime',$1,'DELETE') allowed`,[`"${table}"`])).rows[0].allowed,false);
  }
  assert.deepEqual(await db.unit.findMany(),[]);assert.deepEqual(await db.lease.findMany(),[]);
  await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;return tx.unit.create({data:{companyId:'a',propertyId:'foreign-home',label:'foreign',createdById:'owner',submissionKey:randomUUID(),submissionHash:'test'}});}),/foreign key/i);
 });
 await t.test('revocation-leading creation and replay deny writes/content after stale snapshot retry',async()=>{
  const leader=await admin.connect();let pending;try{
   await leader.query('BEGIN');await leader.query(`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id='resident'`);
   pending=call('owner','POST',leases,{...leaseBody(),status:'draft'});
   let blocked=false;for(let i=0;i<100;i++){if((await admin.query(`SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%User%'`)).rows.length){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(blocked);
   await leader.query(`DELETE FROM "ResidentPropertyAssignment" WHERE "userId"='resident'`);await leader.query('COMMIT');assert.equal((await pending).statusCode,409);
  }finally{await leader.query('ROLLBACK');leader.release();if(pending)await pending;}
  await admin.query(`INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','resident')`);
  const leader2=await admin.connect();let replay;try{
   await leader2.query('BEGIN');await leader2.query(`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id='owner'`);
   replay=call('owner','POST',units,unitBody);
   let blocked=false;for(let i=0;i<100;i++){if((await admin.query(`SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%User%'`)).rows.length){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(blocked);
   await leader2.query(`UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='owner'`);await leader2.query('COMMIT');assert.equal((await replay).statusCode,403);
  }finally{await leader2.query('ROLLBACK');leader2.release();if(replay)await replay;await admin.query(`UPDATE "CompanyMembership" SET status='active' WHERE "userId"='owner'`);}
 });
 await t.test('creation audit failure rolls back durable key and row',async()=>{
  await admin.query(`CREATE FUNCTION reject_record_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('unit.created','lease.created') THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_record_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_record_audit()`);
  const u={label:'Rollback unit',submissionKey:randomUUID()},l={...leaseBody(),status:'draft'};
  assert.equal((await call('owner','POST',units,u)).statusCode,500);assert.equal((await call('owner','POST',leases,l)).statusCode,500);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "Unit" WHERE "submissionKey"=$1`,[u.submissionKey])).rows[0].n,0);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "Lease" WHERE "submissionKey"=$1`,[l.submissionKey])).rows[0].n,0);
  await admin.query(`DROP TRIGGER reject_record_audit ON "AuditEvent"; DROP FUNCTION reject_record_audit()`);
  assert.equal((await call('owner','POST',units,u)).statusCode,200);assert.equal((await call('owner','POST',leases,l)).statusCode,200);
 });
 await t.test('company suspension fences unit and lease reads, creation and edits',async()=>{
  const operations=[['GET',units,null],['POST',units,{label:'Suspension unit',submissionKey:randomUUID()}],['GET',leases,null],['POST',leases,{...leaseBody(),status:'draft'}],['PATCH',`/api/company/units/${unit.id}`,{label:unit.label,status:'active',expectedVersion:unit.version}],['PATCH',`${leases}/${lease.id}`,{...terms,status:'ended',expectedVersion:lease.version}]];
  for(const [method,path,payload] of operations){
   const leader=await admin.connect();let pending;
   const before=(await admin.query(`SELECT count(*)::int n FROM "AuditEvent"`)).rows[0].n;
   try{
    await leader.query('BEGIN');await leader.query(`UPDATE "Company" SET status='suspended' WHERE id='a'`);pending=call('owner',method,path,payload);
    let blocked=false;for(let i=0;i<100;i++){if((await admin.query(`SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%Company%'`)).rows.length){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(blocked);
    await leader.query('COMMIT');assert.equal((await pending).statusCode,403,`${method} ${path}`);assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent"`)).rows[0].n,before);
   }finally{await leader.query('ROLLBACK');leader.release();if(pending)await pending;await admin.query(`UPDATE "Company" SET status='active' WHERE id='a'`);}
  }
 });
 await t.test('keyset pagination does not leak or duplicate records across pages',async()=>{
  for(let i=0;i<51;i++)await admin.query(`INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") VALUES($1,'a','home',$1,'owner',$2,'fixture',NOW())`,['paging-unit-'+String(i).padStart(3,'0'),randomUUID()]);
  const first=(await call('staff','GET',units)).json();assert.equal(first.items.length,50);assert.ok(first.nextCursor);
  const second=(await call('staff','GET',units+'?cursor='+first.nextCursor)).json();assert.equal(second.nextCursor,null);
  const ids=[...first.items,...second.items].map(r=>r.id);assert.equal(new Set(ids).size,ids.length);
  assert.equal(ids.length,(await admin.query(`SELECT count(*)::int n FROM "Unit" WHERE "companyId"='a' AND "propertyId"='home'`)).rows[0].n);
  assert.deepEqual((await call('foreign','GET',units)).statusCode,404);
  assert.equal((await call('owner','GET',units+'?companyId=b')).statusCode,400);
  await admin.query(`UPDATE "Unit" SET status='archived',floor='Garden' WHERE id='paging-unit-000'`);
  const search=(await call('staff','GET',units+'?q=PAGING-unit-000&status=archived')).json();assert.deepEqual(search.items.map(r=>r.id),['paging-unit-000']);assert.equal(search.nextCursor,null);
  assert.deepEqual((await call('staff','GET',units+'?q=Garden')).json().items.map(r=>r.id),['paging-unit-000']);
  assert.equal((await call('staff','GET',units+'?q=paging-unit-000&status=active')).json().items.length,0);
  assert.equal((await call('foreign','GET',units+'?q=Garden')).statusCode,404);
  for(const query of ['status=vacant','q='+ 'x'.repeat(201),'q=a&q=b','cursor=','q=%00'])assert.equal((await call('owner','GET',units+'?'+query)).statusCode,400,query);
  await admin.query(`DELETE FROM "Unit" WHERE id LIKE 'paging-unit-%'`);
 });
 await t.test('unit details persist exact amounts, clear unknowns, validate bounds and preserve old-client replay',async()=>{
  const payload={label:'Studio details',bedrooms:'0',bathrooms:'2.25',squareFeet:'750',marketRent:'1250.01',floor:'Ground',notes:'Accessible entry',submissionKey:randomUUID()};
  const response=await call('owner','POST',units,payload);assert.equal(response.statusCode,200,response.body);const row=response.json();assert.equal(row.bedrooms,0);assert.equal(row.bathroomsHundredths,225);assert.equal(row.marketRentCents,125001);assert.equal(row.squareFeet,750);
  assert.equal((await call('owner','POST',units,payload)).json().id,row.id);
  const oldEdit=await call('owner','PATCH',`/api/company/units/${row.id}`,{label:row.label,status:'active',expectedVersion:1});assert.equal(oldEdit.statusCode,200,oldEdit.body);assert.equal(oldEdit.json().marketRentCents,125001);
  const partial=await call('owner','PATCH',`/api/company/units/${row.id}`,{label:row.label,status:'active',expectedVersion:oldEdit.json().version,bedrooms:'1'});assert.equal(partial.statusCode,200,partial.body);assert.equal(partial.json().bedrooms,1);assert.equal(partial.json().marketRentCents,125001);assert.equal(partial.json().bathroomsHundredths,225);
  const blank=Object.fromEntries(['bedrooms','bathrooms','squareFeet','marketRent','floor','notes'].map(k=>[k,'']));
  const cleared=await call('owner','PATCH',`/api/company/units/${row.id}`,{...blank,label:row.label,status:'active',expectedVersion:partial.json().version});assert.equal(cleared.statusCode,200,cleared.body);for(const key of ['bedrooms','bathroomsHundredths','squareFeet','marketRentCents','floor','notes'])assert.equal(cleared.json()[key],null);
  for(const patch of [{bedrooms:'-1'},{bedrooms:'1.5'},{bathrooms:'1.1'},{bathrooms:'101'},{squareFeet:'0'},{marketRent:'1.001'},{floor:'x'.repeat(41)}])assert.equal((await call('owner','POST',units,{...payload,...patch,submissionKey:randomUUID()})).statusCode,400);
  const key=randomUUID(),hash=createHash('sha256').update(JSON.stringify(['home','Legacy unit'])).digest('hex');
  await admin.query(`INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") VALUES('legacy-retry','a','home','Legacy unit','owner',$1,$2,NOW())`,[key,hash]);
  const replay=await call('owner','POST',units,{label:'Legacy unit',submissionKey:key,...blank});assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().id,'legacy-retry');
 });
 await t.test('real browser units and lease commit-response-loss replay',{skip:!process.env.TEST_LEASING_BROWSER_URL},async()=>{
  const browser=await chromium.launch({headless:true});try{
   const page=await browser.newPage();let loseUnit=true,loseLease=true;const keys={unit:[],lease:[]};
   await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url());
    if(u.pathname==='/api/telemetry')return route.fulfill({status:202,json:{accepted:true}});
    const response=await app.inject({method:req.method(),url:u.pathname+u.search,headers:{...req.headers(),origin:'https://app.test',cookie:'__Host-pf-session=token-owner'},...(req.postData()?{payload:req.postData()}:{})});
    if(req.method()==='POST'&&(u.pathname===units||u.pathname===leases)){
     const type=u.pathname.endsWith('/units')?'unit':'lease';keys[type].push(req.postDataJSON().submissionKey);assert.equal(response.statusCode,200,response.body);
     if(type==='unit'&&loseUnit){loseUnit=false;return route.abort('failed');}if(type==='lease'&&loseLease){loseLease=false;return route.abort('failed');}
    }
    await route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});
   });
   await page.goto(process.env.TEST_LEASING_BROWSER_URL+'/company/properties/home/units');
   await page.evaluate(()=>fetch('/api/telemetry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operations:[]})}));assert.deepEqual(keys,{unit:[],lease:[]},'telemetry is never a business mutation');
   await page.getByRole('button',{name:'Add a unit',exact:true}).click();await page.getByLabel('Unit name',{exact:true}).fill('Browser unit');await page.getByRole('spinbutton',{name:/^Bedrooms/}).fill('0');await page.getByRole('spinbutton',{name:'Bathrooms',exact:true}).fill('2.25');await page.getByRole('spinbutton',{name:/^Market rent/}).fill('1250.01');
   await page.getByRole('button',{name:'Create unit',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Create unit',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();assert.equal(keys.unit[0],keys.unit[1]);
   const browserUnit=(await admin.query(`SELECT id,bedrooms,"bathroomsHundredths","marketRentCents" FROM "Unit" WHERE label='Browser unit'`)).rows;assert.equal(browserUnit.length,1);assert.equal(browserUnit[0].bedrooms,0);assert.equal(browserUnit[0].bathroomsHundredths,225);assert.equal(browserUnit[0].marketRentCents,125001);await expect(page.locator('.feedback-region')).toContainText('Unit created.');
   await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Leases',exact:true}).click();await page.getByRole('button',{name:'Record a lease',exact:true}).click();await page.getByLabel('Property for new lease').selectOption('home');await page.getByLabel('Unit for new lease').selectOption(browserUnit[0].id);
   const candidates=(await call('owner','GET','/api/company/properties/home/residents?includeContacts=true')).json();const primary=candidates.find(p=>p.userId==='resident');assert.ok(primary);await page.getByLabel('Primary resident').selectOption(primary.contactId||primary.userId);
   await page.getByLabel('New lease start date').fill('2026-11-01');await page.getByLabel('New lease end date',{exact:true}).fill('2027-10-31');await page.getByLabel('New lease monthly rent (USD)').fill('1250.50');
   await page.getByRole('button',{name:'Review lease',exact:true}).click();await page.getByRole('button',{name:'Create lease record',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Create lease record',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();assert.equal(keys.lease[0],keys.lease[1]);
   assert.equal((await admin.query(`SELECT count(*)::int n FROM "Lease" WHERE "unitId"=$1`,[browserUnit[0].id])).rows[0].n,1);
   assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='lease.created' AND "targetId" IN (SELECT id FROM "Lease" WHERE "unitId"=$1)`,[browserUnit[0].id])).rows[0].n,1);
  }finally{await browser.close();}
 });
 await t.test('linked lease renewals',async renewalTest=>renewalCases(renewalTest,admin,call,db));
});
