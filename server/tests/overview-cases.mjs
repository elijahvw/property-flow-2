import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest} from '../dist/sessions.js';
export async function overviewCases(t,admin,call,db){
 await admin.query(`INSERT INTO "Company"(id,name,timezone,"updatedAt") VALUES('overview-a','Overview A','America/Los_Angeles',NOW())`);
 for(const [id,role] of [['overview-owner','owner'],['overview-manager','manager'],['overview-staff','staff'],['overview-resident','resident']]){
  await admin.query(`INSERT INTO "User"(id,email,"emailVerified","updatedAt") VALUES($1,$2,true,NOW())`,[id,id+'@test.invalid']);
  await admin.query(`INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,'overview-a',$2,NOW())`,[id,role]);
  await db.session.create({data:{tokenHash:digest('token-'+id),csrfToken:'csrf',userId:id,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
 }
 for(const id of ['overview-home','overview-other'])await admin.query(`INSERT INTO "Property"(id,"companyId",name,address,city,state,zip,"updatedAt") VALUES($1,'overview-a',$1,'street','city','CA','12345',NOW())`,[id]);
 const base='/api/company/overview',leasePath='/api/company/leases';
 const initial=(await call('overview-owner','GET',base)).json(),today=initial.today,shift=n=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 await t.test('overview starts at real zero and isolates staff, resident and platform capabilities',async()=>{
  assert.equal(initial.propertyCount,2);assert.equal(initial.activeUnitCount,0);assert.equal(initial.cash.netCents,'0');assert.equal(initial.company.timezone,'America/Los_Angeles');
  const staff=(await call('overview-staff','GET',base)).json();assert.equal(staff.propertyCount,2);for(const key of ['cash','leases','maintenance'])assert.ok(!Object.hasOwn(staff,key));
  for(const user of ['overview-resident','platform'])assert.equal((await call(user,'GET',base)).statusCode,403);
  assert.equal((await call('foreign','GET',base+'?propertyId=overview-home')).statusCode,404);assert.equal((await call('overview-owner','GET',base+'?companyId=b')).statusCode,400);assert.equal((await call('overview-owner','GET',base,undefined,{'x-company-id':'b'})).statusCode,403);
 });
 await admin.query(`INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") SELECT 'overview-unit-'||i,'overview-a','overview-home','Unit '||i,'overview-owner',gen_random_uuid()::text,'fixture',NOW() FROM generate_series(1,60) i`);
 for(const [id,unit,status,start,end,rent] of [['current',1,'active',today,today,120001],['open',2,'active',shift(-1),null,99999],['future',3,'active',shift(1),shift(365),10],['past',4,'active',shift(-30),shift(-1),20],['draft',5,'draft',today,null,30]])await admin.query(`INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentId","createdById","submissionKey","submissionHash","startsOn","endsOn","rentCents",status,"updatedAt") VALUES($1,'overview-a','overview-home',$2,'overview-resident','overview-owner',$3,'fixture',$4,$5,$6,$7,NOW())`,['overview-lease-'+id,'overview-unit-'+unit,randomUUID(),start,end,rent,status]);
 for(const [id,status,priority] of [['one','open','high'],['two','in_progress','normal'],['done','resolved','high']])await admin.query(`INSERT INTO "MaintenanceRequest"(id,"companyId","propertyId","requesterId","submissionKey","submissionHash",title,description,status,priority,"updatedAt") VALUES($1,'overview-a','overview-home','overview-resident',$2,'fixture',$1,'fixture',$3,$4,NOW())`,['overview-request-'+id,randomUUID(),status,priority]);
 for(const [id,property,when,kind,category,amount,voided] of [['income','overview-home',today,'income','rent',100000,false],['expense','overview-home',today,'expense','repairs',12500,false],['void','overview-home',today,'income','rent',99999,true],['other','overview-other',today,'income','rent',1,false],['future','overview-home',shift(1),'income','rent',99999,false]])await admin.query(`INSERT INTO "LedgerEntry"(id,"companyId","propertyId","createdById","submissionKey","submissionHash","occurredOn","amountCents",kind,category,"voidedAt","voidReason") VALUES($1,'overview-a',$2,'overview-owner',$3,'fixture',$4,$5,$6,$7,$8,$9)`,['overview-cash-'+id,property,randomUUID(),when,amount,kind,category,voided?new Date():null,voided?'Mistake':null]);
 await t.test('overview counts all units and uses inclusive current terms and exact filtered month totals',async()=>{
  const response=await call('overview-manager','GET',base+'?propertyId=overview-home');assert.equal(response.statusCode,200,response.body);const d=response.json();assert.equal(d.propertyCount,1);assert.equal(d.activeUnitCount,60);assert.equal(d.properties[0]._count.units,60);assert.equal(d.leases.inEffectCount,2);assert.equal(d.leases.monthlyRentCents,'220000');assert.equal(d.leases.withoutCurrentLease,58);assert.equal(d.leases.endingSoonCount,1);assert.equal(d.leases.pastEndCount,1);assert.equal(d.leases.draftCount,1);assert.equal(d.maintenance.openCount,2);assert.equal(d.maintenance.highPriorityCount,1);assert.deepEqual(d.cash,{dateFrom:today.slice(0,7)+'-01',dateTo:today,incomeCents:'100000',expenseCents:'12500',netCents:'87500'});
  assert.equal((await call('overview-owner','GET',base)).json().cash.incomeCents,'100001');
  const source=(await call('overview-owner','GET',`/api/company/finances?propertyId=overview-home&dateFrom=${d.cash.dateFrom}&dateTo=${d.cash.dateTo}`)).json();assert.equal(source.summary.netCents,d.cash.netCents);
  assert.doesNotMatch(response.body,/submissionHash|submissionKey|emergencyContact|managementNotes/);
 });
 await admin.query(`INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") VALUES('overview-other-unit','overview-a','overview-other','Other unit','overview-owner',$1,'fixture',NOW())`,[randomUUID()]);
 await admin.query(`INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentId","createdById","submissionKey","submissionHash","startsOn","rentCents",status,"updatedAt") SELECT 'overview-other-lease-'||i,'overview-a','overview-other','overview-other-unit','overview-resident','overview-owner',gen_random_uuid()::text,'fixture',$1,1,'draft',NOW() FROM generate_series(1,51) i`,[today]);
 await t.test('dashboard links filter leases before pagination and match in-effect, draft, past-end and maintenance views',async()=>{
  for(const [filter,ids] of [['attention=in_effect',['open','current']],['status=draft',['draft']],['attention=ending_soon',['current']],['attention=past_end',['past']]]){
   const r=await call('overview-owner','GET',leasePath+'?propertyId=overview-home&'+filter);assert.equal(r.statusCode,200,r.body);assert.deepEqual(r.json().items.map(l=>l.id).sort(),ids.map(i=>'overview-lease-'+i).sort());
  }
  assert.equal((await call('overview-owner','GET',leasePath+'?propertyId=foreign-home')).statusCode,404);assert.equal((await call('overview-owner','GET',leasePath+'?status=draft&attention=in_effect')).statusCode,400);
  const requests=await call('overview-owner','GET','/api/company/maintenance?propertyId=overview-home&status=unresolved');assert.equal(requests.statusCode,200,requests.body);assert.equal(requests.json().length,2);assert.ok(requests.json().every(r=>r.status!=='resolved'));
  await admin.query(`UPDATE "CompanyMembership" SET role='staff' WHERE "userId"='overview-manager'`);const downgraded=(await call('overview-manager','GET',base)).json();assert.equal(downgraded.activeUnitCount,61);assert.ok(!Object.hasOwn(downgraded,'cash'));assert.ok(!Object.hasOwn(downgraded,'leases'));await admin.query(`UPDATE "CompanyMembership" SET role='manager' WHERE "userId"='overview-manager'`);
  await admin.query(`UPDATE "Company" SET status='suspended' WHERE id='overview-a'`);assert.equal((await call('overview-owner','GET',base)).statusCode,403);await admin.query(`UPDATE "Company" SET status='active' WHERE id='overview-a'`);
 });
 await t.test('a queued manager downgrade cannot expose management widgets through the basic overview capability',async()=>{
  const leader=await admin.connect();let pending;
  try{
   await leader.query('BEGIN');await leader.query(`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id='overview-manager'`);
   pending=call('overview-manager','GET',base+'?propertyId=overview-home');
   let blocked=false;for(let i=0;i<100;i++){if((await admin.query(`SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%User%'`)).rows.length){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(blocked);
   await leader.query(`UPDATE "CompanyMembership" SET role='staff' WHERE "userId"='overview-manager'`);await leader.query('COMMIT');
   const r=await pending;assert.equal(r.statusCode,200,r.body);assert.equal(r.json().activeUnitCount,60);for(const key of ['cash','leases','maintenance'])assert.ok(!Object.hasOwn(r.json(),key));
  }finally{await leader.query('ROLLBACK');leader.release();if(pending)await pending;await admin.query(`UPDATE "CompanyMembership" SET role='manager' WHERE "userId"='overview-manager'`);}
 });

}
