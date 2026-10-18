import { newFixturePage } from "./browser-fixture.mjs";
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest} from '../dist/sessions.js';
import {companyDay} from '../dist/reports.js';
import {chromium,expect} from '@playwright/test';

export async function householdCases(t,admin,call,app){
 const ok=r=>{assert.equal(r.statusCode,200,r.body);return r.json();},today=companyDay('America/New_York');
 let lease,co,occupant;
 const details=(extra={})=>({name:'Additional Resident',email:`additional-${randomUUID()}@test.invalid`,phone:null,role:'occupant',startsOn:'2020-01-01',endsOn:null,...extra});
 let root;
 await t.test('household setup retains one lease and the existing rent/deposit sources',async()=>{
  await admin.query(`INSERT INTO "Company"(id,name,"updatedAt") VALUES('hh-company','Household Company',NOW())`);
  for(const [id,role] of [['hh-owner','owner'],['hh-manager','manager'],['hh-primary','resident'],['hh-co','resident'],['hh-occupant','resident']]){
   await admin.query(`INSERT INTO "User"(id,email,"emailVerified",name,"updatedAt") VALUES($1,$2,true,$1,NOW())`,[id,id+'@test.invalid']);
   await admin.query(`INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,'hh-company',$2,NOW())`,[id,role]);
   await admin.query(`INSERT INTO "Session"("tokenHash","csrfToken","userId","expiresAt","idleExpiresAt") VALUES($1,'csrf',$2,NOW()+interval '1 hour',NOW()+interval '1 hour')`,[digest('token-'+id),id]);
  }
  await admin.query(`INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES('hh-home','Oak House','1 Oak Lane','City','NC','00000','hh-company',NOW())`);
  for(const id of ['hh-primary','hh-co','hh-occupant'])await admin.query(`INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('hh-company','hh-home',$1)`,[id]);
  const unit=ok(await call('hh-owner','POST','/api/company/properties/hh-home/units',{label:'Shared apartment',submissionKey:randomUUID()}));
  lease=ok(await call('hh-owner','POST','/api/company/leases',{propertyId:'hh-home',unitId:unit.id,residentId:'hh-primary',startsOn:'2020-01-01',endsOn:null,monthlyRent:'1000.01',status:'active',submissionKey:randomUUID()}));
  root=`/api/company/leases/${lease.id}/participants`;
  ok(await call('hh-owner','POST',`/api/company/rent/${lease.id}/charges`,{periodOn:'2020-01-01',dueOn:'2020-01-01',amount:'1000.01',memo:null,expectedVersion:1,submissionKey:randomUUID()}));
  ok(await call('hh-owner','POST',`/api/company/deposits/${lease.id}`,{amount:'1500.00',dueOn:today,expectedLeaseVersion:1,submissionKey:randomUUID()}));
  const payload={...details({name:'Record-only occupant'}),userId:null,submissionKey:randomUUID()};
  const rows=await Promise.all([call('hh-owner','POST',root,payload),call('hh-owner','POST',root,payload)]);assert.equal(ok(rows[0]).id,ok(rows[1]).id);
  co=ok(await call('hh-owner','POST',root,{...details({name:'Co Tenant',role:'leaseholder'}),userId:'hh-co',submissionKey:randomUUID()}));
  occupant=ok(await call('hh-owner','POST',root,{...details({name:'Occupant'}),userId:'hh-occupant',submissionKey:randomUUID()}));
  assert.equal(ok(await call('hh-owner','GET',root)).items.length,4);
  const accounts=ok(await call('hh-owner','GET',`/api/company/rent?leaseId=${lease.id}`)).accounts;
  assert.equal(accounts.length,1);assert.equal(accounts[0].summary.outstandingCents,'100001');
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1`,[lease.id])).rows[0].n,1);
 });
 await t.test('shared leaseholders reconcile to the same balances; occupants gain no finance authority',async()=>{
  const primary=ok(await call('hh-primary','GET',`/api/resident/rent?leaseId=${lease.id}`));
  const secondary=ok(await call('hh-co','GET',`/api/resident/rent?leaseId=${lease.id}`));
  assert.equal(secondary.businessDate,primary.businessDate);assert.deepEqual(secondary.accounts,primary.accounts);
  const {generatedAt:_coGenerated,...coDeposit}=ok(await call('hh-co','GET',`/api/resident/deposits/${lease.id}`)),{generatedAt:_primaryGenerated,...primaryDeposit}=ok(await call('hh-primary','GET',`/api/resident/deposits/${lease.id}`));assert.deepEqual(coDeposit,primaryDeposit);
  assert.equal((await call('hh-occupant','GET',`/api/resident/rent?leaseId=${lease.id}`)).statusCode,404);
  assert.equal((await call('hh-occupant','GET',`/api/resident/deposits/${lease.id}`)).statusCode,404);
  assert.equal(ok(await call('hh-owner','GET','/api/company/resident-profiles/hh-co/workspace')).leases.length,1);
  for(const actor of ['hh-primary','hh-co','hh-occupant','staff','platform'])assert.equal((await call(actor,'GET',root)).statusCode,403);
  assert.equal((await call('foreign','GET',root)).statusCode,404);
 });
 await t.test('owners alone manage household records; dates, stale changes and current access are enforced',async()=>{
  const payload={...details(),userId:null,submissionKey:randomUUID()};
  for(const actor of ['hh-manager','hh-primary','hh-co'])assert.equal((await call(actor,'POST',root,payload)).statusCode,403);
  for(const patch of [{startsOn:'2026-02-30'},{endsOn:'2019-01-01'},{email:'bad'},{role:'owner'},{phone:'x'.repeat(41)},{companyId:'b'}])assert.equal((await call('hh-owner','POST',root,{...payload,...patch})).statusCode,400);
  assert.equal((await call('hh-owner','POST',root,{...payload,userId:'foreign-resident'})).statusCode,409);
  assert.equal((await call('hh-owner','POST',root,{...payload,userId:'hh-primary'})).statusCode,409);
  co=ok(await call('hh-owner','PATCH',`${root}/${co.id}`,{...details({name:co.name,role:'leaseholder',endsOn:'2020-01-02'}),expectedVersion:co.version}));
  assert.equal((await call('hh-co','GET',`/api/resident/rent?leaseId=${lease.id}`)).statusCode,404);
  assert.equal(ok(await call('hh-owner','GET',root)).items.find(i=>i.id===co.id).endsOn.slice(0,10),'2020-01-02');
  assert.equal((await call('hh-owner','PATCH',`${root}/${co.id}`,{...details(),expectedVersion:1})).statusCode,409);
  co=ok(await call('hh-owner','PATCH',`${root}/${co.id}`,{...details({name:co.name,role:'leaseholder'}),expectedVersion:co.version}));
  await admin.query(`UPDATE "User" SET "emailVerified"=false WHERE id='hh-co'`);
  assert.equal((await call('hh-co','GET',`/api/resident/rent?leaseId=${lease.id}`)).statusCode,403);
  await admin.query(`UPDATE "User" SET "emailVerified"=true WHERE id='hh-co'`);
  await admin.query(`DELETE FROM "ResidentPropertyAssignment" WHERE "userId"='hh-co'`);
  assert.equal((await call('hh-co','GET',`/api/resident/rent?leaseId=${lease.id}`)).statusCode,404);
  await admin.query(`INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('hh-company','hh-home','hh-co')`);
 });
 await t.test('approved upcoming leaseholders can review deposits while only management requests residents',async()=>{
  co=ok(await call('hh-owner','PATCH',`${root}/${co.id}`,{...details({name:co.name,role:'leaseholder',startsOn:'2028-01-01'}),expectedVersion:co.version}));
  assert.equal((await call('hh-co','GET',`/api/resident/rent?leaseId=${lease.id}`)).statusCode,200);
  assert.equal((await call('hh-co','GET',`/api/resident/deposits/${lease.id}`)).statusCode,200);
  const unit=ok(await call('hh-owner','POST','/api/company/properties/hh-home/units',{label:'Upcoming apartment',submissionKey:randomUUID()}));
  const future=ok(await call('hh-owner','POST','/api/company/leases',{propertyId:'hh-home',unitId:unit.id,residentId:'hh-co',startsOn:'2028-01-01',endsOn:null,monthlyRent:'1200.00',status:'active',submissionKey:randomUUID()}));
  assert.ok(ok(await call('hh-co','GET','/api/resident/leases')).some(l=>l.id===future.id));
  const invite=ok(await call('hh-manager','POST',`/api/company/leases/${future.id}/invitations`,{name:'Upcoming Occupant',email:'upcoming-occupant@test.invalid',role:'occupant',startsOn:'2028-01-01'}));assert.equal(invite.approvedAt,null);assert.equal(invite.acceptanceUrl,null);
  const approved=ok(await call('hh-owner','POST',`/api/company/leases/${future.id}/invitations/${invite.id}/approve`,{}));
  const invitedAccount=(await admin.query(`SELECT "accountId" FROM "Invitation" WHERE id=$1`,[invite.id])).rows[0].accountId;
  await admin.query(`UPDATE "User" SET "emailVerified"=true WHERE id=$1`,[invitedAccount]);
  await admin.query(`INSERT INTO "Session"("tokenHash","csrfToken","userId","expiresAt","idleExpiresAt") VALUES($1,'csrf',$2,NOW()+interval '1 hour',NOW()+interval '1 hour')`,[digest('token-upcoming-occupant'),invitedAccount]);
  ok(await call('hh-owner','PATCH',`/api/company/leases/${future.id}`,{startsOn:'2028-01-01',endsOn:'2028-12-31',monthlyRent:'1200.00',status:'ended',expectedVersion:future.version}));
  assert.equal((await call('upcoming-occupant','POST','/api/invitations/accept',{token:new URL(approved.acceptanceUrl).hash.slice(1)})).statusCode,409);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "CompanyMembership" WHERE "userId"='upcoming-occupant'`)).rows[0].n,0);
  assert.equal((await call('hh-owner','POST',`/api/company/leases/${future.id}/invitations`,{name:'Too late',email:'late@test.invalid',role:'occupant',startsOn:'2028-01-01'})).statusCode,409);
  co=ok(await call('hh-owner','PATCH',`${root}/${co.id}`,{...details({name:co.name,role:'leaseholder'}),expectedVersion:co.version}));
 });
 await t.test('management invitations require owner approval for occupants and leaseholders before verified acceptance',async()=>{
  for(const [id,role] of [['hh-new-occupant','occupant'],['hh-new-holder','leaseholder']]){
   await admin.query(`INSERT INTO "User"(id,email,"emailVerified",name,"updatedAt") VALUES($1,$2,true,$1,NOW())`,[id,id+'@test.invalid']);
   await admin.query(`INSERT INTO "Session"("tokenHash","csrfToken","userId","expiresAt","idleExpiresAt") VALUES($1,'csrf',$2,NOW()+interval '1 hour',NOW()+interval '1 hour')`,[digest('token-'+id),id]);
   const invited=ok(await call('hh-manager','POST',`/api/company/leases/${lease.id}/invitations`,{name:id,email:id+'@test.invalid',role,startsOn:today}));
   assert.equal(invited.approvedAt,null);assert.equal(invited.acceptanceUrl,null);
   await admin.query(`UPDATE "Invitation" SET "tokenHash"=$1 WHERE id=$2`,[digest('pending-'+id),invited.id]);
   assert.equal((await call(id,'POST','/api/invitations/preview',{token:'pending-'+id})).statusCode,403);
   assert.equal((await call(id,'POST','/api/invitations/accept',{token:'pending-'+id})).statusCode,403);
   const approval=`/api/company/leases/${lease.id}/invitations/${invited.id}/approve`;
   assert.equal((await call('hh-manager','POST',approval,{})).statusCode,403);
   assert.equal((await call('hh-owner','POST',approval,{expectedVersion:invited.version+1})).statusCode,409);
   const approved=ok(await call('hh-owner','POST',approval,{expectedVersion:invited.version})),token=new URL(approved.acceptanceUrl).hash.slice(1);
   const profileBefore=(await admin.query(`SELECT c.id,c."userId" FROM "ResidentContact" c JOIN "Invitation" i ON i."contactId"=c.id WHERE i.id=$1`,[invited.id])).rows[0];assert.ok(profileBefore.id);assert.equal(profileBefore.userId,id,'owner approval reuses the same canonical account before login');
   assert.equal((await call(null,'POST','/api/invitations/setup-account',{token})).statusCode,200);

   const preview=ok(await call(id,'POST','/api/invitations/preview',{token}));assert.equal(preview.role,role);assert.equal(preview.property,'Oak House');assert.equal(preview.unit,'Shared apartment');assert.equal(JSON.stringify(preview).includes(token),false);
   assert.equal((await call('resident2','POST','/api/invitations/preview',{token})).statusCode,403);
   assert.equal((await call('resident2','POST','/api/invitations/accept',{token})).statusCode,403);
   if(role==='occupant'&&process.env.TEST_FINANCES_BROWSER_URL){
    const browser=await chromium.launch({headless:true});try{
     const page=await newFixturePage(browser, {viewport:{width:1280,height:1000}});
     await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),response=await app.inject({method:req.method(),url:url.pathname+url.search,headers:{...req.headers(),origin:'https://app.test',cookie:`__Host-pf-session=token-${id}`},...(req.postData()?{payload:req.postData()}:{})});await route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});});
     await page.goto(process.env.TEST_FINANCES_BROWSER_URL+`/invite?lease=1#${token}`);
     await expect(page).toHaveURL(/\/invite$/);await expect(page.locator('.lease-review-summary')).toContainText('Oak House · Shared apartment');
     await expect(page.getByText(/does not give you access to the lease’s financial information/)).toBeVisible();
     assert.equal((await admin.query(`SELECT count(*)::int n FROM "CompanyMembership" WHERE "userId"=$1`,[id])).rows[0].n,0,'preview alone cannot create membership');
     await page.screenshot({path:'/tmp/propertyflow-resident-invitation-preview.png',fullPage:true});
     await page.getByRole('button',{name:'Accept household invitation',exact:true}).click();await expect(page).toHaveURL(/\/resident$/);
     assert.equal(await page.evaluate(()=>sessionStorage.getItem('pf-invitation')),null);
    }finally{await browser.close();}
   }
   ok(await call(id,'POST','/api/invitations/accept',{token}));
   assert.equal((await admin.query(`SELECT "userId" FROM "ResidentContact" WHERE id=$1`,[profileBefore.id])).rows[0].userId,id);
   assert.equal((await admin.query(`SELECT count(*)::int n FROM "ResidentContact" WHERE "companyId"='hh-company' AND email=$1`,[id+'@test.invalid'])).rows[0].n,1);

   ok(await call(id,'POST','/api/invitations/accept',{token}));
   assert.equal((await admin.query(`SELECT role FROM "LeaseParticipant" WHERE "leaseId"=$1 AND "userId"=$2`,[lease.id,id])).rows[0].role,role);
   assert.equal((await call(id,'GET',`/api/resident/rent?leaseId=${lease.id}`)).statusCode,role==='leaseholder'?200:404);
   assert.equal((await call(id,'GET',`/api/resident/deposits/${lease.id}`)).statusCode,role==='leaseholder'?200:404);
  }
  assert.equal((await call('hh-occupant','POST',`/api/resident/leases/${lease.id}/invitations`,{name:'Blocked',email:'blocked@test.invalid',role:'occupant',startsOn:today})).statusCode,403);
 });
 await t.test('household tenant boundaries and retention are enforced independently by PostgreSQL',async()=>{
  const flags=(await admin.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='LeaseParticipant'`)).rows[0];assert.deepEqual(flags,{relrowsecurity:true,relforcerowsecurity:true});
  assert.equal((await admin.query(`SELECT has_table_privilege('propertyflow_runtime','"LeaseParticipant"','DELETE') allowed`)).rows[0].allowed,false);
  assert.equal((await admin.query(`SELECT has_column_privilege('propertyflow_runtime','"LeaseParticipant"','userId','UPDATE') allowed`)).rows[0].allowed,true);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname='lease_participant_identity_guard' AND NOT tgisinternal`)).rows[0].n,1);
 });
 await t.test('only owners control approved invitations and the approval queue; residents cannot create or cancel requests',async()=>{
  const companyRoot=`/api/company/leases/${lease.id}/invitations`,residentRoot=`/api/resident/leases/${lease.id}/invitations`;
  const body=email=>({name:'Approval Resident',email,role:'occupant',startsOn:today});
  const ownerInvite=ok(await call('hh-owner','POST',companyRoot,body('owner-link@test.invalid')));
  assert.equal((await call('hh-manager','POST',`${companyRoot}/${ownerInvite.id}/revoke`,{})).statusCode,404);
  assert.equal(ok(await call('hh-manager','GET',companyRoot)).some(i=>i.id===ownerInvite.id),false);
  const ownRequest=ok(await call('hh-manager','POST',companyRoot,body('manager-request@test.invalid')));assert.equal(ownRequest.approvedAt,null);
  assert.equal((await call('hh-manager','POST',`${companyRoot}/${ownRequest.id}/revoke`,{expectedVersion:ownRequest.version+1})).statusCode,409);
  ok(await call('hh-manager','POST',`${companyRoot}/${ownRequest.id}/revoke`,{expectedVersion:ownRequest.version}));
  ok(await call('hh-manager','POST',`${companyRoot}/${ownRequest.id}/revoke`,{expectedVersion:ownRequest.version}));
  assert.equal((await call('hh-primary','POST',residentRoot,body('resident-blocked@test.invalid'))).statusCode,403);
  // Retain a request made before the portal became read-only.
  const residentRequest=ok(await call('hh-manager','POST',companyRoot,body('resident-approved@test.invalid')));
  await admin.query(`UPDATE "Invitation" SET "createdBy"='hh-primary' WHERE id=$1`,[residentRequest.id]);
  assert.ok(ok(await call('hh-primary','GET',residentRoot)).some(i=>i.id===residentRequest.id));
  assert.equal((await call('hh-primary','POST',`${residentRoot}/${residentRequest.id}/revoke`,{})).statusCode,403);
  ok(await call('hh-owner','POST',`${companyRoot}/${residentRequest.id}/approve`,{}));
  assert.equal((await call('hh-primary','POST',`${residentRoot}/${residentRequest.id}/revoke`,{})).statusCode,403);
  assert.equal((await call('hh-manager','POST',`${companyRoot}/${residentRequest.id}/revoke`,{})).statusCode,404);
  ok(await call('hh-owner','POST',`${companyRoot}/${residentRequest.id}/revoke`,{}));
  const pending=ok(await call('hh-manager','POST',companyRoot,body('queue-request@test.invalid')));
  const overview=ok(await call('hh-owner','GET','/api/company/overview'));assert.equal(overview.residentApprovals.pendingCount,1);
  assert.equal(ok(await call('hh-manager','GET','/api/company/overview')).residentApprovals,undefined);
  const queue=ok(await call('hh-owner','GET','/api/company/leases?approvals=pending'));assert.deepEqual(queue.items.map(l=>l.id),[lease.id]);
  assert.equal((await call('hh-manager','GET','/api/company/leases?approvals=pending')).statusCode,403);
  assert.equal((await call('foreign','POST',`${companyRoot}/${pending.id}/approve`,{})).statusCode,404);
 });
 await t.test('owner revocation fences an already-approved invitation before it can grant access',async()=>{
  const id='hh-revoked-invite';
  await admin.query(`INSERT INTO "User"(id,email,"emailVerified","updatedAt") VALUES($1,$2,true,NOW())`,[id,id+'@test.invalid']);
  await admin.query(`INSERT INTO "Session"("tokenHash","csrfToken","userId","expiresAt","idleExpiresAt") VALUES($1,'csrf',$2,NOW()+interval '1 hour',NOW()+interval '1 hour')`,[digest('token-'+id),id]);
  const invite=ok(await call('hh-owner','POST',`/api/company/leases/${lease.id}/invitations`,{name:id,email:id+'@test.invalid',role:'leaseholder',startsOn:today})),token=new URL(invite.acceptanceUrl).hash.slice(1);
  const leader=await admin.connect();let pending;
  try{
   await leader.query('BEGIN');await leader.query(`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id='hh-owner'`);
   pending=call(id,'POST','/api/invitations/accept',{token});
   let blocked=false;for(let i=0;i<150;i++){if((await admin.query(`SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%User%'`)).rows.length){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(blocked,'acceptance must wait on current approving-owner authority');
   await leader.query(`UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='hh-owner'`);await leader.query('COMMIT');
   assert.equal((await pending).statusCode,403);
   assert.equal((await admin.query(`SELECT count(*)::int n FROM "CompanyMembership" WHERE "userId"=$1`,[id])).rows[0].n,0);
   assert.equal((await admin.query(`SELECT "acceptedAt" FROM "Invitation" WHERE id=$1`,[invite.id])).rows[0].acceptedAt,null);
  }finally{await leader.query('ROLLBACK');leader.release();if(pending)await pending;await admin.query(`UPDATE "CompanyMembership" SET status='active' WHERE "userId"='hh-owner'`);}
 });
 await t.test('household and invitation audit failures roll back membership, access, roster and lease versions',async()=>{
  const id='hh-audit-invite';
  await admin.query(`INSERT INTO "User"(id,email,"emailVerified","updatedAt") VALUES($1,$2,true,NOW())`,[id,id+'@test.invalid']);
  await admin.query(`INSERT INTO "Session"("tokenHash","csrfToken","userId","expiresAt","idleExpiresAt") VALUES($1,'csrf',$2,NOW()+interval '1 hour',NOW()+interval '1 hour')`,[digest('token-'+id),id]);
  const invite=ok(await call('hh-owner','POST',`/api/company/leases/${lease.id}/invitations`,{name:id,email:id+'@test.invalid',role:'occupant',startsOn:today})),token=new URL(invite.acceptanceUrl).hash.slice(1),before=ok(await call('hh-owner','GET',`/api/company/leases/${lease.id}`));
  await admin.query(`CREATE FUNCTION reject_household_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'lease.participant.%' OR NEW.action LIKE 'lease.invitation.%' THEN RAISE EXCEPTION 'household audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_household_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_household_audit()`);
  try{
   assert.equal((await call('hh-owner','POST',root,{...details({name:'Audit rollback occupant'}),userId:null,submissionKey:randomUUID()})).statusCode,500);
   assert.equal((await call(id,'POST','/api/invitations/accept',{token})).statusCode,500);
   assert.equal(ok(await call('hh-owner','GET',`/api/company/leases/${lease.id}`)).version,before.version);
   assert.equal((await admin.query(`SELECT count(*)::int n FROM "CompanyMembership" WHERE "userId"=$1`,[id])).rows[0].n,0);
   assert.equal((await admin.query(`SELECT count(*)::int n FROM "LeaseParticipant" WHERE "leaseId"=$1 AND ("userId"=$2 OR name='Audit rollback occupant')`,[lease.id,id])).rows[0].n,0);
   assert.equal((await admin.query(`SELECT "acceptedAt" FROM "Invitation" WHERE id=$1`,[invite.id])).rows[0].acceptedAt,null);
  }finally{await admin.query(`DROP TRIGGER reject_household_audit ON "AuditEvent"; DROP FUNCTION reject_household_audit()`);}
  ok(await call(id,'POST','/api/invitations/accept',{token}));
 });
 await t.test('owner primary-contact changes and immediate removal preserve lease and source identities',async()=>{
  const sourceIds=(await admin.query(`SELECT id FROM "RentCharge" WHERE "leaseId"=$1 ORDER BY id`,[lease.id])).rows;
  const current=ok(await call('hh-owner','GET',`/api/company/leases/${lease.id}`));
  ok(await call('hh-owner','POST',`/api/company/leases/${lease.id}/primary-resident`,{participantId:co.id,expectedVersion:current.version}));
  const primary=ok(await call('hh-owner','GET',root)).items.find(p=>p.userId==='hh-primary');
  const removal=`${root}/${primary.id}/remove`;
  assert.equal((await call('hh-manager','POST',removal,{expectedVersion:primary.version})).statusCode,403);
  const removed=ok(await call('hh-owner','POST',removal,{expectedVersion:primary.version}));assert.ok(removed.removedAt);
  assert.equal(ok(await call('hh-owner','POST',removal,{expectedVersion:primary.version})).id,primary.id);
  assert.equal((await call('hh-primary','GET',`/api/resident/rent?leaseId=${lease.id}`)).statusCode,404);
  assert.equal(ok(await call('hh-co','GET',`/api/resident/rent?leaseId=${lease.id}`)).accounts[0].summary.outstandingCents,'100001');
  assert.deepEqual((await admin.query(`SELECT id FROM "RentCharge" WHERE "leaseId"=$1 ORDER BY id`,[lease.id])).rows,sourceIds);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='lease.participant.removed' AND detail->>'participantId'=$1`,[primary.id])).rows[0].n,1);
 });
 await t.test('linked renewals carry the reviewed current household without copying money or removed residents',async()=>{
  let current=ok(await call('hh-owner','GET',`/api/company/leases/${lease.id}`));
  current=ok(await call('hh-owner','PATCH',`/api/company/leases/${lease.id}`,{startsOn:'2020-01-01',endsOn:'2026-12-31',monthlyRent:'1000.01',status:'active',expectedVersion:current.version}));
  const payload={propertyId:'hh-home',unitId:current.unitId,residentId:'hh-co',startsOn:'2027-01-01',endsOn:null,monthlyRent:'1100.01',status:'draft',previousLeaseId:lease.id,expectedPreviousVersion:current.version,submissionKey:randomUUID()};
  const renewal=ok(await call('hh-owner','POST','/api/company/leases',payload));
  assert.equal(ok(await call('hh-owner','POST','/api/company/leases',payload)).id,renewal.id);
  const members=ok(await call('hh-owner','GET',`/api/company/leases/${renewal.id}/participants`)).items;
  assert.ok(members.some(p=>p.name==='Record-only occupant'));assert.ok(members.some(p=>p.userId==='hh-new-holder'));assert.equal(members.some(p=>p.userId==='hh-primary'),false);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1`,[renewal.id])).rows[0].n,0);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "DepositAccount" WHERE "leaseId"=$1`,[renewal.id])).rows[0].n,0);
  assert.equal((await call('hh-new-holder','GET',`/api/resident/rent?leaseId=${renewal.id}`)).statusCode,404);
  const copied=members.find(p=>p.userId==='hh-new-holder');assert.equal(copied.portalApproved,false);
  assert.equal(ok(await call('hh-new-holder','GET','/api/resident/leases')).some(l=>l.id===renewal.id),false);
  const request={name:'New term occupant',email:'new-term-occupant@test.invalid',role:'occupant',startsOn:'2027-01-01'};
  assert.equal((await call('hh-new-holder','POST',`/api/resident/leases/${renewal.id}/invitations`,request)).statusCode,403);
  const approvalBody={...details({name:copied.name,role:'leaseholder',startsOn:copied.startsOn.slice(0,10)}),portalApproved:true,expectedVersion:copied.version};
  assert.equal((await call('hh-manager','PATCH',`/api/company/leases/${renewal.id}/participants/${copied.id}`,approvalBody)).statusCode,403);
  ok(await call('hh-owner','PATCH',`/api/company/leases/${renewal.id}/participants/${copied.id}`,approvalBody));
  assert.equal(ok(await call('hh-new-holder','GET','/api/resident/leases')).some(l=>l.id===renewal.id),true);
  assert.equal((await call('hh-new-holder','POST',`/api/resident/leases/${renewal.id}/invitations`,request)).statusCode,403);
  assert.equal((await call('hh-new-holder','GET',`/api/resident/rent?leaseId=${renewal.id}`)).statusCode,404,'owner review does not activate draft finances');
 });
 await t.test('real browser follows the lease workspace, household and invitation workflow', {skip:!process.env.TEST_FINANCES_BROWSER_URL},async()=>{
  const browser=await chromium.launch({headless:true});try{
   const page=await newFixturePage(browser, {viewport:{width:1440,height:1000}});
   await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url()),response=await app.inject({method:req.method(),url:url.pathname+url.search,headers:{...req.headers(),origin:'https://app.test',cookie:'__Host-pf-session=token-hh-owner'},...(req.postData()?{payload:req.postData()}:{})});await route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});});
   await page.goto(process.env.TEST_FINANCES_BROWSER_URL+`/company/leases/${lease.id}`);
   await expect(page.getByRole('heading',{name:'Oak House · Shared apartment',exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Review household',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Co Tenant',exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Add resident',exact:true}).click();
   await page.getByLabel('Resident full name',{exact:true}).fill('New Household Occupant');
   await page.getByLabel('Resident contact email',{exact:true}).fill('browser-household@test.invalid');
   await page.getByRole('button',{name:'Add to household',exact:true}).click();
   await expect(page.getByRole('heading',{name:'New Household Occupant',exact:true})).toBeVisible();
   const dismiss=page.getByRole('button',{name:'Dismiss',exact:true});if(await dismiss.isVisible())await dismiss.click();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'/tmp/propertyflow-lease-household-desktop.png',fullPage:true});
   await page.getByRole('button',{name:'Overview',exact:true}).click();
   await page.getByRole('link',{name:'Open rent & billing',exact:true}).click();
   await page.getByRole('link',{name:'← Back to lease workspace',exact:true}).click();
   await expect(page).toHaveURL(new RegExp(`/company/leases/${lease.id}$`));
   await expect(page.getByRole('heading',{name:'Oak House · Shared apartment',exact:true})).toBeVisible();await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:'/tmp/propertyflow-lease-workspace-mobile.png',fullPage:true});
  }finally{await browser.close();}
 });
 await t.test('owner adds an existing company tenant without prior property access, reusing all source identities',async()=>{
  const userId='hh-existing-tenant';
  await admin.query(`INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES($1,$2,'Existing Tenant',true,NOW())`,[userId,userId+'@test.invalid']);
  await admin.query(`INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,'hh-company','resident',NOW())`,[userId]);
  const tenant=ok(await call('hh-owner','POST','/api/company/resident-contacts',{name:'Existing Tenant',email:userId+'@test.invalid',submissionKey:randomUUID()}));
  assert.equal(tenant.userId,userId);
  const source=await admin.query('SELECT id,"amountCents" FROM "RentCharge" WHERE "leaseId"=$1 ORDER BY id',[lease.id]);
  const deposit=await admin.query('SELECT * FROM "DepositAccount" WHERE "leaseId"=$1',[lease.id]);
  const before=(await admin.query('SELECT count(*)::int n FROM "User"')).rows[0].n;
  assert.ok(ok(await call('hh-owner','GET',root)).contacts.some(c=>c.id===tenant.id),'an existing resident needs no earlier property assignment to be selected');
  const payload={...details({name:tenant.name,email:tenant.email,role:'leaseholder'}),contactId:tenant.id,portalApproved:false,submissionKey:randomUUID()};
  for(const actor of ['hh-manager','hh-primary','staff','platform','foreign'])assert.ok([403,404].includes((await call(actor,'POST',root,payload)).statusCode));
  assert.equal((await admin.query('SELECT count(*)::int n FROM "ResidentPropertyAssignment" WHERE "userId"=$1',[userId])).rows[0].n,0);
  await admin.query(`UPDATE "User" SET status='disabled' WHERE id=$1`,[userId]);
  assert.ok(!ok(await call('hh-owner','GET',root)).contacts.some(c=>c.id===tenant.id));
  assert.equal((await call('hh-owner','POST',root,payload)).statusCode,409);
  await admin.query(`UPDATE "User" SET status='active' WHERE id=$1`,[userId]);
  await admin.query(`CREATE FUNCTION hh_existing_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='lease.participant.added' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER hh_existing_audit_guard BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION hh_existing_audit_guard()`);
  try {
   assert.equal((await call('hh-owner','POST',root,payload)).statusCode,500);
   assert.equal((await admin.query('SELECT count(*)::int n FROM "ResidentPropertyAssignment" WHERE "userId"=$1',[userId])).rows[0].n,0,'a failed household write cannot leave a property grant');
   assert.equal((await admin.query('SELECT count(*)::int n FROM "LeaseParticipant" WHERE "userId"=$1',[userId])).rows[0].n,0);
  }finally{await admin.query('DROP TRIGGER hh_existing_audit_guard ON "AuditEvent"; DROP FUNCTION hh_existing_audit_guard()');}
  const added=ok(await call('hh-owner','POST',root,payload));
  assert.equal(added.userId,userId);assert.equal(added.contactId,tenant.id);assert.equal(added.portalApproved,false);
  assert.equal(ok(await call('hh-owner','POST',root,payload)).id,added.id);
  assert.equal((await admin.query('SELECT count(*)::int n FROM "ResidentPropertyAssignment" WHERE "userId"=$1 AND "propertyId"=$2',[userId,'hh-home'])).rows[0].n,1);
  assert.equal((await admin.query('SELECT count(*)::int n FROM "User"')).rows[0].n,before);
  assert.deepEqual((await admin.query('SELECT id,"amountCents" FROM "RentCharge" WHERE "leaseId"=$1 ORDER BY id',[lease.id])).rows,source.rows);
  assert.deepEqual((await admin.query('SELECT * FROM "DepositAccount" WHERE "leaseId"=$1',[lease.id])).rows,deposit.rows);
  assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=$2 AND "targetId"=$1',[userId,'resident.assignment.assigned'])).rows[0].n,1);
 });

}
