import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
export async function reportCases(t, admin, call, app, db) {
 const cash='/api/company/reports/cash?dateFrom=2026-01-31&dateTo=2026-02-01',leases='/api/company/reports/leases';
 await t.test('cash reports reconcile every source row, void, date and company with exact large totals', async()=>{
  await admin.query(`INSERT INTO "LedgerEntry"(id,"companyId","propertyId","createdById","submissionKey","submissionHash","occurredOn","amountCents",kind,category) SELECT 'report-'||i,'a','home','owner',gen_random_uuid()::text,'fixture','2026-01-31',100000000,'income','rent' FROM generate_series(1,60) i`);
  for(const [id,company,property,creator,when,amount,kind,category] of [
   ['expense','a','home','owner','2026-02-01',115,'expense','repairs'],['other','a','other-home','owner','2026-01-31',101,'income','rent'],
   ['before','a','home','owner','2026-01-30',500,'income','rent'],['after','a','home','owner','2026-02-02',500,'income','rent'],
   ['foreign','b','foreign-home','foreign','2026-01-31',500,'income','rent'],['void','a','home','owner','2026-01-31',999,'income','rent']]){
    await admin.query(`INSERT INTO "LedgerEntry"(id,"companyId","propertyId","createdById","submissionKey","submissionHash","occurredOn","amountCents",kind,category) VALUES($1,$2,$3,$4,$5,'fixture',$6,$7,$8,$9)`,['report-'+id,company,property,creator,randomUUID(),when,amount,kind,category]);
  }
  await admin.query(`UPDATE "LedgerEntry" SET "voidedAt"=NOW(),"voidReason"='Duplicate entry',version=2 WHERE id='report-void'`);
  const result=await call('manager','GET',cash);assert.equal(result.statusCode,200,result.body);const r=result.json();
  assert.deepEqual(r.summary,{incomeCents:'6000000101',expenseCents:'115',netCents:'5999999986',depositReceivedCents:'0',cashMovementCents:'5999999986',includedCount:62,voidedCount:1});assert.equal(r.items.length,63);
  assert.equal(r.groups.filter(g=>g.kind==='income').reduce((a,g)=>a+BigInt(g.amountCents),0n),6000000101n);
  assert.equal(r.groups.reduce((a,g)=>a+g.count,0),r.summary.includedCount);
  assert.equal(r.items.filter(i=>!i.voidedAt&&i.kind==='income').reduce((a,i)=>a+BigInt(i.amountCents),0n),BigInt(r.summary.incomeCents));
  assert.equal(r.items.find(i=>i.id==='report-void').voidReason,'Duplicate entry');assert.equal(r.company.name,'a');assert.match(r.generatedAt,/Z$/);assert.equal(r.filters.dateTo,'2026-02-01');
  assert.ok(!r.items.some(i=>['report-before','report-after','report-foreign'].includes(i.id)));assert.doesNotMatch(result.body,/submissionHash|createdById|emergencyContact/);
  const filtered=(await call('owner','GET',cash+'&propertyId=home')).json();assert.equal(filtered.summary.incomeCents,'6000000000');assert.equal(filtered.items.length,62);
  for(const user of ['staff','resident','platform']){assert.equal((await call(user,'GET',cash)).statusCode,403);assert.equal((await call(user,'GET',leases)).statusCode,403);assert.equal((await call(user,'GET','/api/company/reports/context')).statusCode,403);}
  assert.equal((await call('foreign','GET',cash+'&propertyId=home')).statusCode,404);
  assert.equal((await call('owner','GET',cash,undefined,{'x-company-id':'b'})).statusCode,403);
  for(const query of ['dateFrom=2026-02-29&dateTo=2026-03-01','dateFrom=2026-02-02&dateTo=2026-02-01','dateFrom=2026-01-01','dateFrom=2026-01-01&dateTo=2026-01-31&companyId=b'])assert.equal((await call('owner','GET','/api/company/reports/cash?'+query)).statusCode,400);
  await admin.query(`UPDATE "Company" SET status='suspended' WHERE id='a'`);assert.equal((await call('owner','GET',cash)).statusCode,403);await admin.query(`UPDATE "Company" SET status='active' WHERE id='a'`);
  await admin.query(`UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='manager'`);assert.equal((await call('manager','GET',cash)).statusCode,403);await admin.query(`UPDATE "CompanyMembership" SET status='active' WHERE "userId"='manager'`);
 });
 await t.test('reports refuse oversized results rather than returning partial totals; narrower filters recover',async()=>{
  await admin.query(`INSERT INTO "LedgerEntry"(id,"companyId","propertyId","createdById","submissionKey","submissionHash","occurredOn","amountCents",kind,category) SELECT 'limit-'||i,'a','home','owner',gen_random_uuid()::text,'fixture','2025-01-01',1,'income','rent' FROM generate_series(1,10001) i`);
  const r=await call('owner','GET','/api/company/reports/cash?dateFrom=2025-01-01&dateTo=2025-01-01');assert.equal(r.statusCode,422,r.body);assert.equal(r.json().code,'REPORT_TOO_LARGE');assert.ok(!Object.hasOwn(r.json(),'summary'));
  const empty=(await call('owner','GET','/api/company/reports/cash?dateFrom=2025-01-01&dateTo=2025-01-01&propertyId=other-home')).json();assert.equal(empty.summary.netCents,'0');assert.deepEqual(empty.items,[]);
  await admin.query(`DELETE FROM "LedgerEntry" WHERE id LIKE 'limit-%'`);
 });
 await t.test('lease register uses company business date and inclusive current terms, not cash receipts or historical balances',async reportTest=>{
  const originalTimezone=(await admin.query(`SELECT timezone FROM "Company" WHERE id='a'`)).rows[0].timezone;
  reportTest.after(()=>admin.query(`UPDATE "Company" SET timezone=$1 WHERE id='a'`,[originalTimezone]));
  await admin.query(`UPDATE "Company" SET timezone='America/Los_Angeles' WHERE id='a'`);
  const ctx=(await call('owner','GET','/api/company/reports/context')).json();assert.equal(ctx.timezone,'America/Los_Angeles');
  const today=ctx.today,shift=n=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  for(const [id,status,start,end,unitStatus,rent] of [['current','active',today,today,'active',150001],['open','active',shift(-1),null,'active',99999],['future','active',shift(1),shift(365),'active',10],['expired','active',shift(-30),shift(-1),'active',20],['draft','draft',today,null,'active',30],['ended','ended',shift(-2),today,'active',40],['archived','ended',shift(-2),today,'archived',50]]){
   await admin.query(`INSERT INTO "Unit"(id,"companyId","propertyId",label,status,"createdById","submissionKey","submissionHash","updatedAt") VALUES($1,'a','home',$1,$2,'owner',$3,'fixture',NOW())`,['report-unit-'+id,unitStatus,randomUUID()]);
   await admin.query(`INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentId","createdById","submissionKey","submissionHash","startsOn","endsOn","rentCents",status,"updatedAt") VALUES($1,'a','home',$2,'resident','owner',$3,'fixture',$4,$5,$6,$7,NOW())`,['report-lease-'+id,'report-unit-'+id,randomUUID(),start,end,rent,status]);
  }
  const response=await call('owner','GET',leases);assert.equal(response.statusCode,200,response.body);const r=response.json();assert.deepEqual(r.summary,{recordCount:7,currentCount:2,monthlyRentCents:'250000',futureActiveCount:1,expiredActiveCount:1});
  assert.equal(r.today,today);assert.deepEqual(r.items.filter(i=>i.inEffect).map(i=>i.id).sort(),['report-lease-current','report-lease-open']);assert.doesNotMatch(response.body,/phone|notes|submissionHash|createdById/);
  assert.equal((await call('manager','GET',leases+'?status=active')).json().items.length,4);assert.deepEqual((await call('foreign','GET',leases)).json().items,[]);
  await admin.query(`INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentId","createdById","submissionKey","submissionHash","startsOn","rentCents",status,"updatedAt") SELECT 'limit-lease-'||i,'a','home','report-unit-current','resident','owner',gen_random_uuid()::text,'fixture','2026-01-01',1,'draft',NOW() FROM generate_series(1,10001) i`);
  const tooMany=await call('owner','GET',leases);assert.equal(tooMany.statusCode,422,tooMany.body);assert.equal(tooMany.json().code,'REPORT_TOO_LARGE');assert.equal((await call('owner','GET',leases+'?status=active')).statusCode,200);await admin.query(`DELETE FROM "Lease" WHERE id LIKE 'limit-lease-%'`);
  assert.equal((await call('owner','GET',leases+'?propertyId=foreign-home')).statusCode,404);assert.equal((await call('owner','GET',leases+'?status=invalid')).statusCode,400);
 });
 await t.test('complete property details have durable replay, atomic audit and stale-edit protection',async()=>{
  const path='/api/company/properties',payload={name:'Detailed house',address:'1 Main',city:'Town',state:'CA',zip:'12345',propertyType:'single_family',yearBuilt:'1990',countryCode:'us',parcelId:'LOT-1',notes:'Gate code handled privately',submissionKey:randomUUID()};
  const replies=await Promise.all([call('owner','POST',path,payload),call('owner','POST',path,payload)]);for(const r of replies)assert.equal(r.statusCode,200,r.body);const row=replies[0].json();assert.equal(row.id,replies[1].json().id);assert.equal(row.yearBuilt,1990);assert.equal(row.countryCode,'US');assert.doesNotMatch(replies[0].body,/submissionHash|submissionKey|createdById/);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='property.created' AND "targetId"=$1`,[row.id])).rows[0].n,1);
  assert.equal((await call('owner','POST',path,{...payload,name:'Different'})).statusCode,409);
  const {submissionKey,...details}=payload,changes=await Promise.all([call('owner','PATCH',path+'/'+row.id,{...details,name:'Owner edit',expectedVersion:1}),call('manager','PATCH',path+'/'+row.id,{...details,name:'Manager edit',expectedVersion:1})]);assert.deepEqual(changes.map(r=>r.statusCode).sort(),[200,409]);
  await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;return tx.property.updateMany({where:{id:row.id},data:{submissionKey:randomUUID()}});}),/permission denied/i);
  await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;return tx.property.deleteMany({where:{id:row.id}});}),/permission denied/i);
  assert.equal((await call('foreign','GET',path+'/'+row.id)).statusCode,404);assert.equal((await call('staff','PATCH',path+'/'+row.id,{...details,expectedVersion:2})).statusCode,403);
  for(const patch of [{yearBuilt:'999'},{yearBuilt:'2000.5'},{propertyType:'castle'},{countryCode:'USA'},{notes:'x'.repeat(2001)}])assert.equal((await call('owner','POST',path,{...payload,...patch,submissionKey:randomUUID()})).statusCode,400);
  await admin.query(`CREATE FUNCTION reject_property_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='property.created' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END$$;CREATE TRIGGER reject_property_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_property_audit()`);
  const rollback={...payload,submissionKey:randomUUID()};assert.equal((await call('owner','POST',path,rollback)).statusCode,500);assert.equal((await admin.query(`SELECT count(*)::int n FROM "Property" WHERE "submissionKey"=$1`,[rollback.submissionKey])).rows[0].n,0);await admin.query(`DROP TRIGGER reject_property_audit ON "AuditEvent";DROP FUNCTION reject_property_audit()`);assert.equal((await call('owner','POST',path,rollback)).statusCode,200);
 });
 await t.test('real browser property commit-response loss retains complete draft and one creation identity',{skip:!process.env.TEST_FINANCES_BROWSER_URL},async()=>{
  const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();let lose=true;const keys=[];
   await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url()),r=await app.inject({method:req.method(),url:u.pathname+u.search,headers:{...req.headers(),origin:'https://app.test',cookie:'__Host-pf-session=token-owner'},...(req.postData()?{payload:req.postData()}:{})});if(req.method()==='POST'&&u.pathname==='/api/company/properties'){keys.push(req.postDataJSON().submissionKey);assert.equal(r.statusCode,200,r.body);if(lose){lose=false;return route.abort('failed');}}await route.fulfill({status:r.statusCode,contentType:'application/json',body:r.body});});
   await page.goto(process.env.TEST_FINANCES_BROWSER_URL+'/company/properties');await page.getByRole('button',{name:'Add property',exact:true}).first().click();
   for(const [label,value] of [['Property name','Browser house'],['Street address','1 Browser St'],['City','Town'],['State / region','CA'],['Postal code','12345'],['Year built','2001'],['Country code','US'],['Property notes','Retained after response loss']])await page.getByLabel(label,{exact:true}).fill(value);
   await page.getByRole('button',{name:'Create property',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Add property',exact:true}).first().click();await expect(page.getByLabel('Property notes',{exact:true})).toHaveValue('Retained after response loss');await page.getByRole('button',{name:'Create property',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();assert.equal(keys[0],keys[1]);const rows=(await admin.query(`SELECT id,"yearBuilt" FROM "Property" WHERE name='Browser house'`)).rows;assert.equal(rows.length,1);assert.equal(rows[0].yearBuilt,2001);
  }finally{await browser.close();}
 });
}
