import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { companyDay } from '../dist/reports.js';
export async function rentCases(t, admin, call, app, db) {
 const year=Number(companyDay('America/New_York').slice(0,4))-1,jan=`${year}-01-01`,feb=`${year}-02-01`,mar=`${year}-03-01`;
 const root='/api/company/rent';let lease,firstCharge,firstPayment,creditPayment;
 const charge=(periodOn=jan,extra={})=>({periodOn,dueOn:periodOn,amount:'1000.00',memo:null,expectedVersion:1,submissionKey:randomUUID(),...extra});
 const payment=(amount='400.00',extra={})=>({occurredOn:jan,amount,memo:'Internal payment note',submissionKey:randomUUID(),...extra});
 const get=async(user='owner')=>{const r=await call(user,'GET',`${root}?leaseId=${lease.id}`);assert.equal(r.statusCode,200,r.body);return r.json().accounts[0];};
 const post=async(suffix,body,user='owner')=>call(user,'POST',`${root}/${lease.id}/${suffix}`,body);
 const ok=r=>{assert.equal(r.statusCode,200,r.body);return r.json();};
 await t.test('setup lease; charge preview version, monthly uniqueness, concurrent replay and exact validation',async()=>{
  const unit=ok(await call('owner','POST','/api/company/properties/home/units',{label:'Rent workflow unit',submissionKey:randomUUID()}));
  lease=ok(await call('owner','POST','/api/company/leases',{propertyId:'home',unitId:unit.id,residentId:'resident',startsOn:jan,endsOn:null,monthlyRent:'1000.00',status:'active',submissionKey:randomUUID()}));
  const body=charge();const responses=await Promise.all([post('charges',body),post('charges',body)]);firstCharge=ok(responses[0]);assert.equal(ok(responses[1]).id,firstCharge.id);
  assert.equal((await post('charges',{...body,amount:'999.99'})).statusCode,409);
  assert.equal((await post('charges',charge())).statusCode,409);
  assert.equal((await post('charges',charge(feb,{expectedVersion:2}))).statusCode,409);
  for(const patch of [{amount:'0'},{amount:'0.001'},{amount:'-1'},{amount:'1e3'},{amount:'1000000.01'},{periodOn:`${year}-02-30`},{periodOn:`${year}-02-02`},{companyId:'b'},{memo:'x'.repeat(501)}])assert.equal((await post('charges',charge(jan,patch))).statusCode,400);
  assert.equal((await post('charges',charge(`${year-1}-01-01`))).statusCode,409);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1`,[lease.id])).rows[0].n,1);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='rent.charge.created' AND "targetId"=$1`,[firstCharge.id])).rows[0].n,1);
 });
 await t.test('partial payment concurrency records cash once and persists oldest-charge allocation',async()=>{
  const body=payment(),responses=await Promise.all([post('payments',body),post('payments',body)]);firstPayment=ok(responses[0]);assert.equal(ok(responses[1]).id,firstPayment.id);
  assert.equal((await post('payments',{...body,amount:'1.00'})).statusCode,409);
  const account=await get();assert.equal(account.summary.outstandingCents,'60000');assert.equal(account.summary.paidCents,'40000');assert.equal(account.summary.creditCents,'0');assert.equal(account.charges[0].appliedCents,'40000');assert.equal(account.allocations.length,1);assert.equal(account.allocations[0].entryId,firstPayment.id);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "LedgerEntry" WHERE "submissionKey"=$1`,[body.submissionKey])).rows[0].n,1);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='finance.created' AND "targetId"=$1`,[firstPayment.id])).rows[0].n,1);
  const cash=ok(await call('owner','GET',`/api/company/finances?propertyId=home&dateFrom=${jan}&dateTo=${jan}`));assert.equal(cash.items.filter(x=>x.id===firstPayment.id).length,1);assert.equal(cash.items.find(x=>x.id===firstPayment.id).leaseId,lease.id);
  const report=ok(await call('owner','GET',`/api/company/reports/cash?dateFrom=${jan}&dateTo=${jan}&propertyId=home`));assert.equal(report.summary.incomeCents,'40000');
 });
 await t.test('oldest charge allocations, excess credit and subsequent charges consume credit exactly once',async()=>{
  ok(await post('charges',charge(feb)));
  ok(await post('payments',payment('1400.00')));
  let account=await get();assert.equal(account.summary.outstandingCents,'20000');assert.equal(account.charges.find(c=>c.periodOn.startsWith(jan)).appliedCents,'100000');assert.equal(account.charges.find(c=>c.periodOn.startsWith(feb)).appliedCents,'80000');
  creditPayment=ok(await post('payments',payment('500.00')));account=await get();assert.equal(account.summary.outstandingCents,'0');assert.equal(account.summary.creditCents,'30000');
  ok(await post('charges',charge(mar)));account=await get();assert.equal(account.summary.outstandingCents,'70000');assert.equal(account.summary.creditCents,'0');assert.equal(account.summary.netCents,'70000');assert.equal(account.summary.paidCents,'230000');
 });
 await t.test('voids preserve history, reopen balances, forbid paid-charge deletion and allow explicit replacement',async()=>{
  assert.equal((await call('owner','POST',`${root}/charges/${firstCharge.id}/void`,{expectedVersion:1,reason:'Correction'})).statusCode,409);
  const payload={expectedVersion:1,reason:'Duplicate external receipt'};
  const result=await Promise.all(['owner','manager'].map(u=>call(u,'POST',`/api/company/finances/${creditPayment.id}/void`,payload)));result.forEach(ok);
  let account=await get();assert.equal(account.summary.outstandingCents,'120000');assert.equal(account.summary.paidCents,'180000');assert.equal(account.payments.find(p=>p.id===creditPayment.id).voidReason,payload.reason);
  const march=account.charges.find(c=>c.periodOn.startsWith(mar));ok(await call('owner','POST',`${root}/charges/${march.id}/void`,{expectedVersion:1,reason:'Wrong agreed amount'}));ok(await call('owner','POST',`${root}/charges/${march.id}/void`,{expectedVersion:1,reason:'Wrong agreed amount'}));assert.equal((await get()).summary.outstandingCents,'20000');
  ok(await post('charges',charge(mar,{amount:'900.00'})));account=await get();assert.equal(account.summary.outstandingCents,'110000');assert.equal(account.charges.length,4);assert.equal(account.charges.filter(c=>c.voidedAt).length,1);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='finance.voided' AND "targetId"=$1`,[creditPayment.id])).rows[0].n,1);
 });
 await t.test('residents see only own assigned lease and safe fields; roles, CSRF and foreign scope denied',async()=>{
  const r=ok(await call('resident','GET',`/api/resident/rent?leaseId=${lease.id}`)).accounts[0];assert.equal(r.summary.outstandingCents,'110000');assert.ok(!('memo' in r.payments[0]));assert.ok(!('voidReason' in r.payments[0]));assert.ok(!('resident' in r.lease));
  for(const u of ['resident2','foreign-resident'])assert.equal((await call(u,'GET',`/api/resident/rent?leaseId=${lease.id}`)).statusCode,404);
  for(const u of ['staff','resident','platform']){assert.equal((await call(u,'GET',root)).statusCode,403);assert.equal((await post('payments',payment(),u)).statusCode,403);assert.equal((await post('charges',charge(feb),u)).statusCode,403);}
  assert.equal((await post('payments',payment(),'foreign')).statusCode,404);
  for(const headers of [{origin:'https://evil.test'},{'x-csrf-token':'bad'},{'x-company-id':'b'}])assert.equal((await call('owner','POST',`${root}/${lease.id}/payments`,payment(),headers)).statusCode,403);
  assert.equal((await call('foreign','GET',root+'?leaseId='+lease.id)).statusCode,404);
  assert.equal((await call('owner','GET',root+'?propertyId=foreign-home')).statusCode,404);
  assert.equal((await call('owner','GET',root+'?companyId=b')).statusCode,400);
  await admin.query(`DELETE FROM "ResidentPropertyAssignment" WHERE "userId"='resident' AND "propertyId"='home'`);
  assert.equal((await call('resident','GET',`/api/resident/rent?leaseId=${lease.id}`)).statusCode,404);assert.deepEqual(ok(await call('resident','GET','/api/resident/rent')).accounts,[]);
  await admin.query(`INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','resident')`);
 });
 await t.test('transactional audits roll back charge, payment, allocation and retry identity together',async()=>{
  const period=`${year}-04-01`,body=charge(period);
  await admin.query(`CREATE FUNCTION reject_rent_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action LIKE 'rent.%' THEN RAISE EXCEPTION 'rent audit unavailable'; END IF; RETURN NEW; END$$; CREATE TRIGGER reject_rent_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_rent_audit()`);
  assert.equal((await post('charges',body)).statusCode,500);assert.equal((await admin.query(`SELECT count(*)::int n FROM "RentCharge" WHERE "submissionKey"=$1`,[body.submissionKey])).rows[0].n,0);
  const receipt=payment('11.11');assert.equal((await post('payments',receipt)).statusCode,500);assert.equal((await admin.query(`SELECT count(*)::int n FROM "LedgerEntry" WHERE "submissionKey"=$1`,[receipt.submissionKey])).rows[0].n,0);
  await admin.query(`DROP TRIGGER reject_rent_audit ON "AuditEvent";DROP FUNCTION reject_rent_audit()`);ok(await post('charges',body));ok(await post('payments',receipt));
 });
 await t.test('runtime RLS, cross-lease foreign keys, immutable amounts and allocation limits',async()=>{
  assert.deepEqual(await db.rentCharge.findMany(),[]);assert.deepEqual(await db.rentAllocation.findMany(),[]);
  for(const table of ['RentCharge','RentAllocation'])for(const priv of ['DELETE','UPDATE'])assert.equal((await admin.query(`SELECT has_table_privilege('propertyflow_runtime',$1,$2) allowed`,[`"${table}"`,priv])).rows[0].allowed,false);
  await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;await tx.rentCharge.update({where:{id:firstCharge.id},data:{amountCents:1}});}),/permission denied/i);
  await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;await tx.rentAllocation.create({data:{companyId:'a',propertyId:'home',leaseId:lease.id,chargeId:firstCharge.id,entryId:firstPayment.id,amountCents:1}});}),/overallocated/i);
  await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;await tx.rentCharge.create({data:{companyId:'a',propertyId:'foreign-home',leaseId:lease.id,createdById:'owner',periodOn:new Date(`${year}-06-01`),dueOn:new Date(`${year}-06-01`),amountCents:1,submissionKey:randomUUID(),submissionHash:'x'}});}),/foreign key/i);
 });
 await t.test('current company suspension and actor revocation block reads and durable replay',async()=>{
  const body=payment('12.34');ok(await post('payments',body));
  await admin.query(`UPDATE "Company" SET status='suspended' WHERE id='a'`);assert.equal((await post('payments',body)).statusCode,403);assert.equal((await call('owner','GET',root)).statusCode,403);await admin.query(`UPDATE "Company" SET status='active' WHERE id='a'`);
  await admin.query(`UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='owner'`);assert.equal((await post('payments',body)).statusCode,403);await admin.query(`UPDATE "CompanyMembership" SET status='active' WHERE "userId"='owner'`);
  assert.equal((await post('payments',payment('1.00',{occurredOn:`${year+2}-01-01`}))).statusCode,400);
 });
 await t.test('partial-month terms are explicit, drafts cannot post, and ended leases retain financial history',async()=>{
  const unit=ok(await call('owner','POST','/api/company/properties/home/units',{label:'Partial month rent unit',submissionKey:randomUUID()}));
  const term=ok(await call('owner','POST','/api/company/leases',{propertyId:'home',unitId:unit.id,residentId:'resident2',startsOn:`${year}-01-15`,endsOn:`${year}-02-10`,monthlyRent:'1000.00',status:'draft',submissionKey:randomUUID()}));
  const endpoint=`${root}/${term.id}/charges`,payload=charge(jan,{dueOn:`${year-1}-12-20`,amount:'500.00'});
  assert.equal((await call('owner','POST',endpoint,payload)).statusCode,409);
  assert.equal((await call('owner','POST',`${root}/${term.id}/payments`,payment())).statusCode,409);
  ok(await call('owner','PATCH',`/api/company/leases/${term.id}`,{startsOn:`${year}-01-15`,endsOn:`${year}-02-10`,monthlyRent:'1000.00',status:'active',expectedVersion:1}));
  const posted=ok(await call('owner','POST',endpoint,{...payload,expectedVersion:2}));assert.equal(posted.amountCents,50000);assert.equal(posted.dueOn.slice(0,10),`${year-1}-12-20`);
  assert.equal((await call('owner','POST',endpoint,charge(mar,{expectedVersion:2}))).statusCode,409);
  ok(await call('owner','PATCH',`/api/company/leases/${term.id}`,{startsOn:`${year}-01-15`,endsOn:`${year}-02-10`,monthlyRent:'1000.00',status:'ended',expectedVersion:2}));
  ok(await call('owner','POST',endpoint,charge(feb,{amount:'300.00',expectedVersion:3})));
  const receipt=ok(await call('owner','POST',`${root}/${term.id}/payments`,payment('1000.00')));
  let account=ok(await call('owner','GET',`${root}?leaseId=${term.id}`)).accounts[0];assert.equal(account.summary.creditCents,'20000');assert.equal(account.summary.outstandingCents,'0');
  // Voiding a payment reopens its charges; recording a replacement never duplicates cash.
  ok(await call('owner','POST',`/api/company/finances/${receipt.id}/void`,{expectedVersion:1,reason:'Wrong receipt'}));
  account=ok(await call('owner','GET',`${root}?leaseId=${term.id}`)).accounts[0];assert.equal(account.summary.outstandingCents,'80000');assert.equal(account.summary.creditCents,'0');
 });
 await t.test('different managers race to post the same month; only one creates a charge and audit',async()=>{
  const period=`${year}-07-01`,result=await Promise.all([post('charges',charge(period),'owner'),post('charges',charge(period),'manager')]);
  assert.deepEqual(result.map(r=>r.statusCode).sort(),[200,409]);assert.equal((await admin.query(`SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1 AND "periodOn"=$2`,[lease.id,period])).rows[0].n,1);
 });
 await t.test('queued permission downgrade blocks a stale authenticated read and payment',async()=>{
  for(const method of ['GET','POST']){
   const leader=await admin.connect();let pending;
   try{
    await leader.query('BEGIN');await leader.query(`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id='manager'`);
    pending=method==='GET'?call('manager','GET',root+'?leaseId='+lease.id):post('payments',payment('7.77'),'manager');
    let blocked=false;for(let i=0;i<100;i++){if((await admin.query(`SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%User%'`)).rows.length){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(blocked);
    await leader.query(`UPDATE "CompanyMembership" SET role='staff' WHERE "userId"='manager'`);await leader.query('COMMIT');assert.equal((await pending).statusCode,403);
   }finally{await leader.query('ROLLBACK');leader.release();if(pending)await pending;await admin.query(`UPDATE "CompanyMembership" SET role='manager' WHERE "userId"='manager'`);}
  }
 });
 await t.test('large rent scopes fail explicitly and individual lease filters recover without partial totals',async()=>{
  const unit=(await admin.query(`SELECT "unitId" FROM "Lease" WHERE id=$1`,[lease.id])).rows[0].unitId;
  await admin.query(`INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentId","createdById","submissionKey","submissionHash","startsOn","rentCents",status,"updatedAt") SELECT 'rent-limit-'||i,'a','home',$1,'resident','owner',gen_random_uuid()::text,'fixture',$2,1,'draft',NOW() FROM generate_series(1,1001) i`,[unit,jan]);
  const over=await call('owner','GET',root);assert.equal(over.statusCode,422);assert.equal(over.json().code,'RENT_SCOPE_TOO_LARGE');assert.ok(!('accounts' in over.json()));assert.equal((await get()).lease.id,lease.id);
  await admin.query(`DELETE FROM "Lease" WHERE id LIKE 'rent-limit-%'`);
 });
 await t.test('real browser committed charge and payment response loss retry once with preserved draft',{skip:!process.env.TEST_FINANCES_BROWSER_URL},async()=>{
  const browser=await chromium.launch({headless:true});try{
   const page=await browser.newPage(),lost=new Set(),keys={};
   await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url());const response=await app.inject({method:req.method(),url:u.pathname+u.search,headers:{...req.headers(),origin:'https://app.test',cookie:'__Host-pf-session=token-owner'},...(req.postData()?{payload:req.postData()}:{})});
    if(req.method()==='POST'&&u.pathname.startsWith(`${root}/${lease.id}/`)){const type=u.pathname.split('/').at(-1);(keys[type]??=[]).push(req.postDataJSON().submissionKey);assert.equal(response.statusCode,200,response.body);if(!lost.has(type)){lost.add(type);return route.abort('failed');}}
    await route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});
   });
   await page.goto(process.env.TEST_FINANCES_BROWSER_URL+`/company/rent?leaseId=${lease.id}`);
   await page.getByRole('button',{name:'Post monthly rent',exact:true}).click();await page.getByLabel('Rent month',{exact:true}).fill(`${year}-05`);await page.getByLabel('Charge amount (USD)').fill('876.54');await page.getByRole('button',{name:'Post rent charge',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.reload();await page.getByRole('button',{name:'Post monthly rent',exact:true}).click();await expect(page.getByLabel('Charge amount (USD)')).toHaveValue('876.54');await page.getByRole('button',{name:'Post rent charge',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();assert.equal(keys.charges[0],keys.charges[1]);
   await page.getByRole('button',{name:'Record payment',exact:true}).click();await page.getByLabel('Payment amount (USD)').fill('87.65');await page.getByLabel('Internal payment reference / memo (optional)').fill('Browser rent receipt');await page.getByRole('button',{name:'Record payment received',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.reload();await page.getByRole('button',{name:'Record payment',exact:true}).click();await expect(page.getByLabel('Payment amount (USD)')).toHaveValue('87.65');await page.getByRole('button',{name:'Record payment received',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();assert.equal(keys.payments[0],keys.payments[1]);
   assert.equal((await admin.query(`SELECT count(*)::int n FROM "LedgerEntry" WHERE memo='Browser rent receipt'`)).rows[0].n,1);assert.equal((await admin.query(`SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1 AND "periodOn"=$2`,[lease.id,`${year}-05-01`])).rows[0].n,1);
  }finally{await browser.close();}
 });
 await t.test('lease term edits preserve active charge validity and prohibit draft demotion with active rent',async()=>{
  const patch=extra=>({startsOn:jan,endsOn:null,monthlyRent:'1000.00',status:'active',expectedVersion:lease.version,...extra});
  for(const change of [{startsOn:feb},{endsOn:`${year}-01-15`},{status:'draft'}]){
   const response=await call('owner','PATCH',`/api/company/leases/${lease.id}`,patch(change));assert.equal(response.statusCode,409,response.body);assert.equal(response.json().code,'LEASE_RENT_CONFLICT');
  }
  const before=(await get()).summary;const valid=ok(await call('owner','PATCH',`/api/company/leases/${lease.id}`,patch({endsOn:`${year}-12-31`})));lease=valid;assert.equal(valid.endsOn.slice(0,10),`${year}-12-31`);assert.deepEqual((await get()).summary,before);
 });
 await t.test('concurrent lease-date edit and charge posting cannot leave a charge outside its term; voided charges permit correction',async()=>{
  const unit=ok(await call('owner','POST','/api/company/properties/home/units',{label:'Rent term race unit',submissionKey:randomUUID()}));
  let term=ok(await call('owner','POST','/api/company/leases',{propertyId:'home',unitId:unit.id,residentId:'resident2',startsOn:jan,endsOn:null,monthlyRent:'1000.00',status:'active',submissionKey:randomUUID()}));
  const changes={startsOn:feb,endsOn:null,monthlyRent:'1000.00',status:'active',expectedVersion:1};
  const results=await Promise.all([call('owner','POST',`${root}/${term.id}/charges`,charge()),call('manager','PATCH',`/api/company/leases/${term.id}`,changes)]);assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
  let account=ok(await call('owner','GET',`${root}?leaseId=${term.id}`)).accounts[0];assert.ok(account.charges.every(c=>c.periodOn.slice(0,7)>=account.lease.startsOn.slice(0,7)));
  if(account.charges.length){ok(await call('owner','POST',`${root}/charges/${account.charges[0].id}/void`,{expectedVersion:1,reason:'Corrected lease start'}));ok(await call('manager','PATCH',`/api/company/leases/${term.id}`,changes));}
  account=ok(await call('owner','GET',`${root}?leaseId=${term.id}`)).accounts[0];assert.equal(account.lease.startsOn.slice(0,10),feb);assert.ok(account.charges.every(c=>c.voidedAt));
 });

 await t.test('future rent can be billed before move-in with an independent due date and advance receipt',async()=>{
  const today=companyDay('America/New_York'),future=`${year+2}-01-01`,startsOn=`${year+2}-01-15`,due=new Date(today+'T00:00:00Z');due.setUTCDate(due.getUTCDate()+7);
  const unit=ok(await call('owner','POST','/api/company/properties/home/units',{label:'Advance rent unit',submissionKey:randomUUID()}));
  const term=ok(await call('owner','POST','/api/company/leases',{propertyId:'home',unitId:unit.id,residentId:'resident2',startsOn,endsOn:null,monthlyRent:'1000.00',status:'active',submissionKey:randomUUID()}));
  const posted=ok(await call('owner','POST',`${root}/${term.id}/charges`,charge(future,{dueOn:due.toISOString().slice(0,10)})));assert.ok(posted.dueOn<startsOn);
  ok(await call('owner','POST',`${root}/${term.id}/payments`,payment('500.00',{occurredOn:today})));
  const account=ok(await call('owner','GET',`${root}?leaseId=${term.id}`)).accounts[0];assert.equal(account.summary.outstandingCents,'50000');assert.equal(account.summary.overdueCents,'0');assert.equal(account.summary.paidCents,'50000');
  // A start-day correction within the same rent month is valid despite the earlier due date.
  ok(await call('owner','PATCH',`/api/company/leases/${term.id}`,{startsOn:`${year+2}-01-20`,endsOn:null,monthlyRent:'1000.00',status:'active',expectedVersion:1}));
 });

}
