import { newFixturePage, launchFixtureBrowser } from "./browser-fixture.mjs";
import {residentPortalCases} from "./resident-portal-cases.mjs";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {expect} from "@playwright/test";
import {companyDay} from "../dist/reports.js";
export async function leaseMovementCases(t,admin,call,app,db){
 const ok=r=>{assert.equal(r.statusCode,200,r.body);return r.json();},today=companyDay('America/New_York'),month=today.slice(0,7)+'-01';
 const make=async label=>{const unit=ok(await call('owner','POST','/api/company/properties/home/units',{label,submissionKey:randomUUID()}));return ok(await call('owner','POST','/api/company/leases',{propertyId:'home',unitId:unit.id,residentId:'resident',startsOn:month,endsOn:null,monthlyRent:'1500.00',status:'active',submissionKey:randomUUID()}));};
 const lease=await make('Applications and actual refunds'),root=`/api/company/lease-movements/${lease.id}`,rentRoot=`/api/company/rent/${lease.id}`,depRoot=`/api/company/deposits/${lease.id}`;
 const read=async()=>ok(await call('owner','GET',root));
 const ledger=async()=>ok(await call('owner','GET',`/api/company/rent?leaseId=${lease.id}`)).accounts[0];
 let charge,receipt,payment,application,refund,rentRefund;
 const body=async(kind,amount,extra={})=>{const d=await read(),p=d.payments.find(p=>BigInt(p.availableCents)>0n),c=d.charges.find(c=>BigInt(c.remainingCents)>0n);return{kind,amount,effectiveOn:today,reason:'Reviewed manual disposition',expectedLeaseVersion:d.lease.version,expectedAvailableCents:kind==='rent_refund'?p?.availableCents:d.deposit?.heldCents,confirmed:true,submissionKey:randomUUID(),...(kind==='rent_refund'?{paymentId:p?.id,expectedSourceVersion:p?.version}: {expectedAccountVersion:d.deposit?.version}),...(kind==='deposit_application'?{chargeId:c?.id,expectedSourceVersion:c?.version,expectedRemainingCents:c?.remainingCents}:{payee:'Jordan Resident',method:'bank_transfer',paymentReference:'PRIVATE RETURN REFERENCE'}),...extra};};
 const reverse=(row,extra={})=>call('owner','POST',root+`/${row.id}/reverse`,{effectiveOn:today,reason:'Corrected original record; no new cash received',expectedLeaseVersion:lease.version,confirmed:true,submissionKey:randomUUID(),...extra});
 await t.test('seed linked cash sources and preserve exact identities across additive migration',async()=>{
  charge=ok(await call('owner','POST',rentRoot+'/one-time-charges',{category:'damage',effectiveOn:today,dueOn:today,amount:'400.01',description:'Reviewed repair charge',expectedLeaseVersion:lease.version,submissionKey:randomUUID()}));
  ok(await call('owner','POST',depRoot,{amount:'1500.00',dueOn:month,expectedLeaseVersion:lease.version,submissionKey:randomUUID()}));
  receipt=ok(await call('owner','POST',depRoot+'/receipts',{amount:'1500.00',occurredOn:month,method:'bank_transfer',memo:'PRIVATE DEPOSIT NOTE',expectedVersion:1,expectedLeaseVersion:lease.version,submissionKey:randomUUID()}));
  payment=ok(await call('owner','POST',rentRoot+'/payments',{occurredOn:month,amount:'100.00',memo:'PRIVATE PAYMENT NOTE',submissionKey:randomUUID()}));
  assert.equal((await read()).deposit.heldCents,'150000');assert.equal((await ledger()).summary.outstandingCents,'30001');
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "LedgerEntry" WHERE "movementId" IS NOT NULL`)).rows[0].n,0);
 });
 await t.test('concurrent application retries create one noncash transfer, shared balance reduction and audit without new cash',async()=>{
  const b=await body('deposit_application','200.01'),before=await ledger(),replies=await Promise.all([call('manager','POST',root,b),call('manager','POST',root,b)]);application=ok(replies[0]);assert.equal(ok(replies[1]).id,application.id);
  const data=await read(),after=await ledger();assert.equal(data.deposit.heldCents,'129999');assert.equal(data.deposit.appliedCents,'20001');assert.equal(data.deposit.receivedCents,'150000');assert.equal(data.deposit.outstandingCents,'0');
  assert.equal(after.summary.outstandingCents,'10000');assert.equal(after.summary.depositAppliedCents,'20001');assert.equal(after.summary.paidCents,before.summary.paidCents);assert.deepEqual(after.allocations,before.allocations);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "LedgerEntry" WHERE "movementId"=$1`,[application.id])).rows[0].n,0);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE "targetId"=$1 AND action='lease.deposit_application.recorded'`,[application.id])).rows[0].n,1);
  const statement=ok(await call('resident','GET',`/api/resident/statements/${lease.id}`));assert.equal(statement.items.find(r=>r.id===application.id).effectCents,'-20001');assert.equal(statement.current.netCents,'10000');assert.equal(statement.period.closingNetCents,statement.current.netCents);assert.equal(statement.deposit.appliedCents,'20001');
 });
 await t.test('actual partial deposit refund creates one linked cash outflow and keeps collection progress separate from held funds',async()=>{
  const b=await body('deposit_refund','500.02'),replies=await Promise.all([call('owner','POST',root,b),call('owner','POST',root,b)]);refund=ok(replies[0]);assert.equal(ok(replies[1]).id,refund.id);
  const d=await read();assert.equal(d.deposit.heldCents,'79997');assert.equal(d.deposit.returnedCents,'50002');assert.equal(d.deposit.outstandingCents,'0');
  const cash=(await admin.query(`SELECT id,kind,category,"amountCents","leaseId" FROM "LedgerEntry" WHERE "movementId"=$1`,[refund.id])).rows;assert.equal(cash.length,1);assert.equal(cash[0].kind,'refund');assert.equal(cash[0].category,'security_deposit');assert.equal(cash[0].amountCents,50002);assert.equal(cash[0].leaseId,null);
  const finance=ok(await call('owner','GET','/api/company/finances?propertyId=home'));const report=ok(await call('owner','GET',`/api/company/reports/cash?propertyId=home&dateFrom=${month}&dateTo=${today}`));assert.ok(BigInt(finance.summary.depositRefundCents)>=50002n);assert.equal(report.items.find(r=>r.movement?.id===refund.id).amountCents,'50002');
  const own=ok(await call('resident','GET',root.replace('/company/','/resident/')));assert.equal(own.deposit.heldCents,'79997');assert.doesNotMatch(JSON.stringify(own),/PRIVATE|paymentReference|memo|submissionHash|createdById/);
  assert.equal((await call('owner','POST',`/api/company/finances/${cash[0].id}/void`,{expectedVersion:1,reason:'Bypass refund history'})).statusCode,409);
 });
 await t.test('refund source and available cents are reviewed; cash refund of unapplied payment reconciles exactly once',async()=>{
  ok(await call('owner','POST',rentRoot+'/payments',{occurredOn:today,amount:'300.00',memo:'Extra received',submissionKey:randomUUID()}));
  const before=await ledger(),b=await body('rent_refund','75.03');rentRefund=ok(await call('owner','POST',root,b));const after=await ledger();assert.equal(before.summary.creditCents,'20000');assert.equal(after.summary.creditCents,'12497');assert.equal(after.summary.refundedCents,'7503');assert.equal(after.summary.paidCents,before.summary.paidCents);assert.equal(after.summary.depositAppliedCents,'20001');
  const s=ok(await call('owner','GET',`/api/company/statements/${lease.id}`));assert.equal(s.period.refundedCents,'7503');assert.equal(s.period.closingNetCents,after.summary.netCents);assert.equal(s.items.find(r=>r.id===rentRefund.id).effectCents,'7503');
  assert.equal((await call('owner','POST',root,{...b,submissionKey:randomUUID()})).statusCode,409);
  assert.equal((await call('owner','POST',`/api/company/finances/${rentRefund.paymentId}/void`,{expectedVersion:1,reason:'Wrong receipt'})).statusCode,409);
  const overview=ok(await call('owner','GET','/api/company/overview?propertyId=home'));const report=ok(await call('owner','GET',`/api/company/reports/cash?propertyId=home&dateFrom=${month}&dateTo=${today}`));assert.equal(overview.cash.netCents,report.summary.netCents);
 });
 await residentPortalCases(t,admin,call,app,{lease,today});
 await t.test('simultaneous deposit refund/application reviews cannot spend the same held funds twice',async()=>{
  const c=ok(await call('owner','POST',rentRoot+'/one-time-charges',{category:'other',effectiveOn:today,dueOn:today,amount:'2000.00',description:'Second reviewed obligation',expectedLeaseVersion:1,submissionKey:randomUUID()}));
  const [a,b]=await Promise.all([body('deposit_refund','700.00'),body('deposit_application','700.00',{chargeId:c.id,expectedSourceVersion:1,expectedRemainingCents:(await ledger()).charges.find(x=>x.id===c.id).remainingCents})]);
  const replies=await Promise.all([call('owner','POST',root,a),call('manager','POST',root,b)]);assert.deepEqual(replies.map(r=>r.statusCode).sort(),[200,409]);
  const d=await read();assert.equal(d.deposit.heldCents,'9997');for(const c of d.charges)assert.ok(BigInt(c.remainingCents)>=0n);
  // Reverse whichever concurrent action won so subsequent examples are deterministic.
  const winner=ok(replies.find(r=>r.statusCode===200));ok(await reverse(winner));assert.equal((await read()).deposit.heldCents,'79997');
 });
 await t.test('correction/reversal history restores funds and reopens debt without changing original allocations or manufacturing another receipt',async()=>{
  const before=await ledger(),reversalKey=randomUUID();const replies=await Promise.all([reverse(application,{submissionKey:reversalKey}),reverse(application,{submissionKey:reversalKey})]);assert.equal(ok(replies[0]).id,ok(replies[1]).id);
  const d=await read(),after=await ledger();assert.equal(d.deposit.heldCents,'99998');assert.equal(after.summary.depositAppliedCents,'0');assert.deepEqual(after.allocations.filter(a=>before.allocations.some(b=>b.id===a.id)),before.allocations);
  ok(await reverse(refund));assert.equal((await read()).deposit.heldCents,'150000');const cash=(await admin.query(`SELECT "voidedAt" FROM "LedgerEntry" WHERE "movementId"=$1`,[refund.id])).rows[0];assert.ok(cash.voidedAt);
  ok(await reverse(rentRefund));const s=ok(await call('owner','GET',`/api/company/statements/${lease.id}`));assert.equal(s.period.closingNetCents,s.current.netCents);assert.equal(s.current.refundedCents,'0');assert.equal(s.items.find(r=>r.id===rentRefund.id).effectCents,'0');
  assert.equal((await reverse(refund)).statusCode,409);
 });
 await t.test('consumed source corrections, invalid dates, missing review, wrong roles, foreign leases and audit failures are atomic',async()=>{
  const b=await body('deposit_refund','1.00');for(const user of ['staff','resident','platform'])assert.equal((await call(user,'POST',root,b)).statusCode,403);assert.equal((await call('foreign','POST',root,b)).statusCode,404);
  assert.equal((await call('owner','POST',root,{...b,confirmed:false})).statusCode,400);assert.equal((await call('owner','POST',root,{...b,effectiveOn:'2099-01-01'})).statusCode,400);assert.equal((await call('owner','POST',root,{...b,effectiveOn:'2000-01-01'})).statusCode,409);
  const m=ok(await call('owner','POST',root,await body('deposit_refund','1400.00')));
  assert.equal((await call('owner','POST',`/api/company/deposit-receipts/${receipt.id}/void`,{expectedVersion:1,reason:'Wrong receipt'})).statusCode,409);
  await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;return tx.ledgerEntry.update({where:{id:receipt.cashEntry.id},data:{voidedAt:new Date(),voidReason:'Direct correction'}});}),/Reverse deposit movements/i);ok(await reverse(m));
  await admin.query(`CREATE FUNCTION reject_movement_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='lease.deposit_refund.recorded' THEN RAISE EXCEPTION 'Audit offline'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_movement_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_movement_audit()`);
  const retry=await body('deposit_refund','12.34');assert.ok((await call('owner','POST',root,retry)).statusCode>=500);assert.equal((await admin.query(`SELECT count(*)::int n FROM "LeaseMovement" WHERE "submissionKey"=$1`,[retry.submissionKey])).rows[0].n,0);
  await admin.query(`DROP TRIGGER reject_movement_audit ON "AuditEvent";DROP FUNCTION reject_movement_audit()`);const saved=ok(await call('owner','POST',root,retry));await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;return tx.leaseMovement.update({where:{id:saved.id},data:{amountCents:1}});}),/permission denied/i);assert.deepEqual(await db.leaseMovement.findMany(),[]);
 });
 await t.test('direct concurrent runtime writers obey the same held-fund limits and deferred refund source/correction guards',async()=>{
  const data=await read(),target=data.charges.filter(c=>BigInt(c.remainingCents)>=100000n).at(-1);assert.ok(target);
  const create=()=>db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;return tx.leaseMovement.create({data:{companyId:'a',propertyId:'home',leaseId:lease.id,accountId:data.deposit.id,chargeId:target.id,kind:'deposit_application',effectiveOn:new Date(today),amountCents:100000,reason:'Direct runtime concurrency probe',createdById:'owner',submissionKey:randomUUID(),submissionHash:'probe'}});});
  const replies=await Promise.allSettled([create(),create()]);assert.equal(replies.filter(r=>r.status==='fulfilled').length,1);assert.ok(BigInt((await read()).deposit.heldCents)>=0n);const winner=replies.find(r=>r.status==='fulfilled').value;ok(await reverse(winner));
  await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;return tx.leaseMovement.create({data:{companyId:'a',propertyId:'home',leaseId:lease.id,accountId:data.deposit.id,kind:'deposit_refund',effectiveOn:new Date(today),amountCents:1,reason:'Missing cash source probe',payee:'Resident',method:'cash',createdById:'owner',submissionKey:randomUUID(),submissionHash:'probe'}});}),/requires linked cash outflow/i);
  const active=(await read()).movements.find(m=>m.kind==='deposit_refund'&&!m.reversal);
  await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;return tx.ledgerEntry.update({where:{id:active.cashEntries[0].id},data:{voidedAt:new Date(),voidReason:'Bypass correction probe'}});}),/requires linked reversal/i);
 });
 await t.test('real browser reviews an actual refund and recovers a lost commit after reload using the same source identity',{skip:!process.env.TEST_FINANCES_BROWSER_URL},async()=>{
  const browser=await launchFixtureBrowser({headless:true});try{const page=await newFixturePage(browser);let lose=true;const keys=[];
   await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),response=await app.inject({method:req.method(),url:url.pathname+url.search,headers:{...req.headers(),origin:'https://app.test',cookie:'__Host-pf-session=token-owner'},...(req.postData()?{payload:req.postData()}: {})});if(req.method()==='POST'&&url.pathname===root){keys.push(req.postDataJSON().submissionKey);assert.equal(response.statusCode,200,response.body);if(lose){lose=false;return route.abort('failed');}}return route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});});
   await page.goto(process.env.TEST_FINANCES_BROWSER_URL+`/company/deposits?leaseId=${lease.id}`);
   await page.getByRole('button',{name:'Record deposit refund',exact:true}).click();await page.getByLabel('Amount (USD)',{exact:true}).fill('9.87');await page.getByLabel('Person paid',{exact:true}).fill('Jordan Resident');await page.getByLabel('Reason shown to the tenant',{exact:true}).fill('Browser tested return');await page.getByRole('button',{name:'Review money movement',exact:true}).click();await page.getByRole('button',{name:'Back to details',exact:true}).click();await expect(page.getByLabel('Amount (USD)',{exact:true})).toHaveValue('9.87');await expect(page.getByLabel('Person paid',{exact:true})).toHaveValue('Jordan Resident');await page.getByRole('button',{name:'Review money movement',exact:true}).click();
   await page.getByRole('checkbox',{name:'I confirm this money has already been returned outside Property Flow.'}).check();await page.getByRole('button',{name:'Record money returned',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.reload();await page.getByRole('button',{name:'Resume money review',exact:true}).click();await page.getByRole('checkbox',{name:'I confirm this money has already been returned outside Property Flow.'}).check();await page.getByRole('button',{name:'Record money returned',exact:true}).click();await expect(page.getByRole('heading',{name:'Review money movement',exact:true})).toHaveCount(0);assert.equal(keys[0],keys[1]);
   assert.equal((await admin.query(`SELECT count(*)::int n FROM "LeaseMovement" WHERE reason='Browser tested return'`)).rows[0].n,1);
   await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Apply deposit to a charge',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/propertyflow-deposit-application-mobile.png',fullPage:false});
  }finally{await browser.close();}
 });
}
