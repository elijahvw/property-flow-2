import { newDemoCredentials, sealDemoCredentials } from '../dist/sales-demo-credentials.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import Fastify from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { registerApplication } from '../dist/application.js';
import { registerSessions, digest } from '../dist/sessions.js';
import { registerRequestErrors } from '../dist/request-errors.js';
import { AccessError } from '../dist/access.js';
import { identityProvider, IdentityProviderError } from '../dist/identity-provider.js';
import { chromium, expect } from '@playwright/test';
import { newFixturePage } from './browser-fixture.mjs';
import { DEMO_BUNDLED_TEXT, DEMO_FEATURE_COVERAGE } from '../dist/sales-demo-scenarios.js';
import { FEATURE_CATALOG } from '../dist/company-features.js';
import { SALES_DEMO_SEED_VERSION } from '../dist/sales-demo-seed.js';

const url = process.env.TEST_SALES_DEMO_DATABASE_URL;
test('automatic sales demo identities, role access, recovery and teardown', { skip: !url }, async t => {
  const target = new URL(url);
  assert.equal(target.hostname,'127.0.0.1'); assert.equal(target.pathname,'/propertyflow_sales_demo_test');
  assert.equal(process.env.SALES_DEMO_DISPOSABLE,'tmpfs-verified');
  const admin = new pg.Pool({connectionString:url}); t.after(()=>admin.end());
  assert.equal((await admin.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n,0);
  for(const name of readdirSync(new URL('../prisma/migrations/',import.meta.url)).filter(n=>/^\d/.test(n)).sort()) await admin.query(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`,import.meta.url),'utf8'));
  await admin.query(`ALTER ROLE propertyflow_runtime LOGIN PASSWORD 'demo-test-only'`);
  const runtime=new URL(url);runtime.username='propertyflow_runtime';runtime.password='demo-test-only';
  const pool=new pg.Pool({connectionString:runtime.href}),db=new PrismaClient({adapter:new PrismaPg(pool)});
  t.after(async()=>{await db.$disconnect();await pool.end();});
  for(const id of ['platform','customer']) await admin.query(`INSERT INTO "User"(id,email,name,"emailVerified","platformRole","updatedAt") VALUES($1,$2,$1,true,$3,NOW())`,[id,`${id}@test.invalid`,id==='platform'?'owner':null]);
  await admin.query(`INSERT INTO "Company"(id,name,"updatedAt") VALUES('customer-company','Customer sentinel',NOW()); INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES('customer','customer-company','owner',NOW())`);
  const remote=new Map(),passwords=new Map(),providerBudgets=[];let normalCalls=0,created=0,ensureCalls=0,blockCalls=0,loseIdentity=false,failBlock=false,pauseEnsure=null,pauseBlock=null,limitedAccount=null;
  const unavailable=async()=>{normalCalls++;throw Error('Unexpected ordinary identity operation');};
  const provider={issuer:'https://unused.auth0.com/',databaseConnection:'test',get:unavailable,create:unavailable,rename:unavailable,verify:unavailable,setup:unavailable,list:unavailable,salesDemo:{
    async ensure(account,options){
      providerBudgets.push({action:'ensure',generation:account.demoId,deadline:options?.deadline});
      ensureCalls++;if(pauseEnsure)await pauseEnsure;
      if(account.accountKey===limitedAccount)throw new IdentityProviderError('lookup','rate_limit',429,30);
      if(!remote.has(account.email)){remote.set(account.email,{user_id:'auth0|demo-'+randomUUID(),email:account.email,name:account.name,email_verified:true,blocked:false});passwords.set(account.email,account.password);created++;}
      if(loseIdentity){loseIdentity=false;throw new AccessError(503,'DEMO_IDENTITY_RETRY','Retry setup');}
      return {...remote.get(account.email)};
    },
    async block(account,subject,beforeBlock,options){providerBudgets.push({action:'block',generation:account.demoId,deadline:options?.deadline});blockCalls++;if(failBlock){failBlock=false;throw Error('Provider temporarily unavailable');}const found=remote.get(account.email);if(found){if(subject)assert.equal(found.user_id,subject);await beforeBlock?.(found);if(pauseBlock)await pauseBlock(found);found.blocked=true;}}
  }};
  const app=Fastify();t.after(()=>app.close());registerRequestErrors(app);
  const auth=await registerSessions(app,db,{origin:'https://app.test',domain:'unused.auth0.com',clientId:'test',clientSecret:'test-only',secure:true});
  registerApplication(app,db,auth,'https://app.test',provider,{salesDemoCredentialSecret:'isolated-demo-test-encryption-secret'});
  const session=async id=>db.session.upsert({where:{tokenHash:digest(`token-${id}`)},update:{},create:{tokenHash:digest(`token-${id}`),csrfToken:'csrf',userId:id,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
  for(const id of ['platform','customer'])await session(id);
  const call=(user,method,path,payload,headers={})=>app.inject({method,url:path,headers:{cookie:`__Host-pf-session=token-${user}`,origin:'https://app.test','x-csrf-token':'csrf',...headers},...(payload?{payload}:{})});
  const ok=async(...args)=>{const r=await call(...args);assert.equal(r.statusCode,200,r.body);return r.json();};
  const base='/api/platform/sales-demos',payload={submissionKey:randomUUID()};let sheet,demo,setupId;
  const current=async id=>db.salesDemo.findUniqueOrThrow({where:{id}});
  await t.test('read-only blueprint is complete and has no provider, setup, company or audit effects',async()=>{
    const before={companies:await db.company.count(),users:await db.user.count(),setups:await db.salesDemoSetup.count(),audits:await db.auditEvent.count(),created,ensureCalls,blockCalls};
    const r=await call('platform','GET',base+'/blueprint');assert.equal(r.statusCode,200,r.body);assert.equal(r.headers['cache-control'],'no-store');const plan=r.json();
    assert.equal(plan.seedVersion,SALES_DEMO_SEED_VERSION);assert.match(plan.planHash,/^[a-f0-9]{64}$/);assert.equal(plan.effects.preparedAccounts,11);assert.equal(plan.effects.issuedLogins,8);assert.equal(plan.roles.filter(r=>!r.login).length,3);
    assert.deepEqual(plan.coverage.map(c=>c.key).sort(),FEATURE_CATALOG.map(c=>c.key).sort());assert.ok(!plan.roles.some(r=>r.password||r.email));
    assert.deepEqual({companies:await db.company.count(),users:await db.user.count(),setups:await db.salesDemoSetup.count(),audits:await db.auditEvent.count(),created,ensureCalls,blockCalls},before);
    assert.equal((await call('customer','GET',base+'/blueprint')).statusCode,403);
  });
  await t.test('platform, CSRF and generated-only input boundaries precede all provisioning',async()=>{
    for(const method of ['GET','POST'])assert.equal((await call('customer',method,base,method==='POST'?payload:undefined)).statusCode,403);
    for(const headers of [{origin:'https://evil.test'},{'x-csrf-token':'wrong'}])assert.equal((await call('platform','POST',base,payload,headers)).statusCode,403);
    for(const patch of [{ownerId:'customer'},{email:'customer@test.invalid'},{password:'supplied'},{emailVerified:false}])assert.equal((await call('platform','POST',base,{...payload,...patch})).statusCode,400);
    assert.equal(created,0);
  });
  await t.test('partial provider success is durable, encrypted and resumes without duplicate identities',async()=>{
    loseIdentity=true;assert.equal((await call('platform','POST',base,payload)).statusCode,503);
    assert.equal(created,1);assert.equal(await db.company.count(),1);assert.equal(await db.user.count(),2);
    const listing=await ok('platform','GET',base);assert.equal(listing.items.length,0);assert.equal(listing.setups.length,1);setupId=listing.setups[0].id;
    const setup=await db.salesDemoSetup.findUniqueOrThrow({where:{id:setupId}});
    assert.equal(setup.status,'pending');for(const password of passwords.values())assert.ok(!JSON.stringify(setup).includes(password));
    assert.ok(!JSON.stringify(listing).includes('credentialsCipher'));
  });
  await t.test('late seed audit failure rolls back business data while keeping resumable provider ownership',async()=>{
    await admin.query(`CREATE FUNCTION reject_demo_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sales_demo.created' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_demo_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_demo_audit()`);
    try{assert.equal((await call('platform','POST',`${base}/${setupId}/resume`,{})).statusCode,503);}finally{await admin.query('DROP TRIGGER reject_demo_audit ON "AuditEvent"; DROP FUNCTION reject_demo_audit()');}
    assert.equal(created,11);assert.equal(await db.company.count(),1);assert.equal(await db.user.count(),2);assert.equal(await db.salesDemo.count(),0);
  });
  await t.test('complete role logins use normal identity, membership, property and financial boundaries',async()=>{
    const response=await call('platform','POST',base,payload);assert.equal(response.statusCode,200,response.body);assert.equal(response.headers['cache-control'],'no-store');sheet=response.json();demo=await current(sheet.id);
    assert.equal(sheet.credentials.length,8);assert.equal(created,11);assert.equal(normalCalls,0);
    for(const c of sheet.credentials){assert.equal(passwords.get(c.email),c.password);assert.ok(c.password.length>=40);await session(remote.get(c.email).user_id);}
    assert.equal(new Set(sheet.credentials.map(c=>c.password)).size,8);
    const users=(await db.salesDemoSetup.findUniqueOrThrow({where:{id:sheet.id}})).accounts;
    for(const key of Object.keys(users)){
      if(['offline','pending','former'].includes(key)){assert.equal(await db.companyMembership.findUnique({where:{userId:users[key].user_id}}),null);assert.ok(!sheet.credentials.some(c=>c.email===users[key].email));continue;}
      const boot=await ok(users[key].user_id,'GET','/api/bootstrap');assert.equal(boot.user.emailVerified,true);assert.equal(boot.user.platformRole,null);
      assert.equal(boot.membership.companyId,demo.companyId);
    }
    assert.ok((await ok(users.owner.user_id,'GET','/api/bootstrap')).permissions.includes('members.manage'));
    assert.ok(!(await ok(users.manager.user_id,'GET','/api/bootstrap')).permissions.includes('members.manage'));
    assert.equal((await call(users.staff.user_id,'GET','/api/company/finances')).statusCode,403);
    assert.equal((await call(users.staff.user_id,'GET',`/api/company/properties/${demo.manifest.properties[1]}`)).statusCode,404);
    assert.equal((await call(users.resident.user_id,'GET','/api/resident/rent')).statusCode,200);
    const rent=await ok(users.occupant.user_id,'GET','/api/resident/rent');assert.ok(!JSON.stringify(rent).includes(demo.manifest.leases[0]));
    assert.equal((await call('customer','GET',`/api/company/leases/${demo.manifest.leases[0]}`)).statusCode,404);
    assert.deepEqual(await db.lease.findMany(),[]);
    const replay=await ok('platform','POST',base,payload);assert.equal(replay.id,sheet.id);assert.deepEqual(replay.credentials,sheet.credentials);assert.equal(created,11);
    const publicList=await ok('platform','GET',base);for(const c of sheet.credentials)assert.ok(!JSON.stringify(publicList).includes(c.password));
    const reveal=await call('platform','POST',`${base}/${sheet.id}/credentials`,{});assert.equal(reveal.statusCode,200);assert.equal(reveal.headers['cache-control'],'no-store');
    for(const key of ['customer',users.resident.user_id,users.staff.user_id])assert.equal((await call(key,'POST',`${base}/${sheet.id}/credentials`,{})).statusCode,403);
    await db.companyMembership.update({where:{userId:users.manager.user_id},data:{companyId:'customer-company'}});
    assert.equal((await call('platform','POST',`${base}/${sheet.id}/credentials`,{})).statusCode,409);
    assert.equal((await call('platform','POST',`${base}/${sheet.id}/teardown`,{expectedVersion:1})).statusCode,409);
    assert.equal(remote.get(users.manager.email).blocked,false);
    await db.companyMembership.update({where:{userId:users.manager.user_id},data:{companyId:demo.companyId}});
    const audits=await db.auditEvent.findMany();for(const c of sheet.credentials)assert.ok(!JSON.stringify(audits).includes(c.password));
  });
  await t.test('prepared issuer and connection receipts resume only missing accounts and verify legacy snapshots once',async()=>{
    const payload={submissionKey:randomUUID()},beforeCreated=created;limitedAccount='former';
    try{
      const stopped=await call('platform','POST',base,payload);assert.equal(stopped.statusCode,429,stopped.body);
      const saved=await db.salesDemoSetup.findUniqueOrThrow({where:{createdById_submissionKey:{createdById:'platform',submissionKey:payload.submissionKey}}});assert.equal(Object.keys(saved.accounts).length,10);assert.equal(created-beforeCreated,10);
      assert.ok(Object.values(saved.accounts).every(account=>account.issuer===provider.issuer&&account.connection===provider.databaseConnection));
      let before=ensureCalls;assert.equal((await call('platform','POST',`${base}/${saved.id}/resume`,{})).statusCode,429);assert.equal(ensureCalls-before,1,'prepared receipts must not consume quota again');
      for(const remove of [['connection'],['issuer','connection']]){
        const legacy=Object.fromEntries(Object.entries(saved.accounts).map(([key,account])=>[key,Object.fromEntries(Object.entries(account).filter(([field])=>!remove.includes(field)))]));
        await db.salesDemoSetup.update({where:{id:saved.id},data:{accounts:legacy}});before=ensureCalls;
        assert.equal((await call('platform','POST',`${base}/${saved.id}/resume`,{})).statusCode,429);assert.equal(ensureCalls-before,11,'legacy receipts must be verified before cache reuse');
        const upgraded=await db.salesDemoSetup.findUniqueOrThrow({where:{id:saved.id}});assert.ok(Object.values(upgraded.accounts).every(account=>account.issuer===provider.issuer&&account.connection===provider.databaseConnection));assert.equal(upgraded.credentialsCipher,saved.credentialsCipher);
      }
      limitedAccount=null;before=ensureCalls;const resumed=await ok('platform','POST',`${base}/${saved.id}/resume`,{});assert.equal(ensureCalls-before,1);assert.equal(created-beforeCreated,11);assert.equal(resumed.id,saved.id);
      const completed=await db.salesDemoSetup.findUniqueOrThrow({where:{id:saved.id}});assert.equal(completed.credentialsCipher,saved.credentialsCipher);
      for(const [key,account]of Object.entries(saved.accounts))assert.deepEqual(completed.accounts[key],account);
      for(const login of resumed.credentials)assert.equal(login.password,passwords.get(login.email));
      await ok('platform','POST',`${base}/${saved.id}/teardown`,{expectedVersion:1});
    }finally{limitedAccount=null;}
  });
  await t.test('concurrent resume and teardown cannot race an in-flight provider create',async()=>{
    let unblock;pauseEnsure=new Promise(resolve=>{unblock=resolve;});const another={submissionKey:randomUUID()},before=ensureCalls;
    const running=call('platform','POST',base,another);while(ensureCalls===before)await new Promise(resolve=>setTimeout(resolve,10));
    const pending=(await ok('platform','GET',base)).setups[0];
    assert.equal((await call('platform','POST',`${base}/${pending.id}/resume`,{})).statusCode,409);
    assert.equal((await call('platform','POST',`${base}/${pending.id}/teardown`,{expectedVersion:1})).statusCode,409);
    pauseEnsure=null;unblock();const r=await running;assert.equal(r.statusCode,200,r.body);
    await ok('platform','POST',`${base}/${pending.id}/teardown`,{expectedVersion:1});
  });
  await t.test('feature examples retain real sources, no-login tenants and honest workflow states',async()=>{
    assert.equal(demo.manifest.fixtureVersion,SALES_DEMO_SEED_VERSION);
    assert.deepEqual(demo.manifest.presentation,{anchorOn:demo.manifest.today,fictional:true,retainedHistory:true});
    assert.deepEqual(Object.keys(DEMO_FEATURE_COVERAGE).sort(),FEATURE_CATALOG.map(f=>f.key).sort());
    for(const paths of Object.values(DEMO_FEATURE_COVERAGE))for(const path of paths){const value=path.split('.').reduce((object,key)=>object?.[key],demo.manifest);assert.ok(Array.isArray(value)?value.length>0:typeof value==='string'&&value.length>0,`Missing demo coverage source: ${path}`);}
    const s=demo.manifest.scenarios,users=(await db.salesDemoSetup.findUniqueOrThrow({where:{id:sheet.id}})).accounts;
    assert.equal(await db.companyMembership.findUnique({where:{userId:users.offline.user_id}}),null);
    assert.equal((await db.user.findUniqueOrThrow({where:{id:users.offline.user_id}})).firstSignedInAt,null);
    assert.equal(await db.session.count({where:{userId:users.offline.user_id}}),0);
    const facts=await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.company_id',${demo.companyId},true)`;
      return {
        offline:await tx.residentContact.findUniqueOrThrow({where:{id:s.offlineContactId}}),offlineLease:await tx.lease.findUniqueOrThrow({where:{id:s.offlineLeaseId}}),
        former:await tx.residentContact.findUniqueOrThrow({where:{id:s.formerContactId}}),ended:await tx.lease.findUniqueOrThrow({where:{id:s.endedLeaseId}}),plannedMoveOut:await tx.leaseTransition.findUniqueOrThrow({where:{id:s.plannedMoveOutId}}),
        invite:await tx.invitation.findUniqueOrThrow({where:{id:s.invitationId}}),prorations:await tx.leaseProration.count({where:{leaseId:s.offlineLeaseId}}),
        settlement:await tx.leaseSettlement.findFirstOrThrow({where:{leaseId:s.endedLeaseId}}),refund:await tx.leaseMovement.findFirstOrThrow({where:{leaseId:s.endedLeaseId,kind:'deposit_refund'},include:{cashEntries:true}}),
        baseline:await tx.leaseInspection.findUniqueOrThrow({where:{id:s.baselineInspectionId}}),moveOut:await tx.leaseInspection.findUniqueOrThrow({where:{id:s.moveOutInspectionId}}),
        agreement:await tx.leaseAgreement.findUniqueOrThrow({where:{id:s.reviewedAgreementId}}),shared:await tx.leaseDocumentShare.findUniqueOrThrow({where:{id:s.receivedShareId}}),
        files:await tx.documentVersion.findMany(),scanAudits:await tx.auditEvent.count({where:{companyId:demo.companyId,action:'document.scanned'}}),archivedDoc:await tx.privateDocument.findUniqueOrThrow({where:{id:s.archivedDocumentId}}),units:await tx.unit.findMany({where:{companyId:demo.companyId},include:{leases:true,availability:true}}),
        voided:await tx.ledgerEntry.findUniqueOrThrow({where:{id:s.voidedExpenseId}}),schedule:await tx.rentSchedule.findUniqueOrThrow({where:{id:s.pausedScheduleId}}),
        imports:await tx.unitImportBatch.findMany(),expenses:await tx.expenseImportBatch.findMany(),applications:await tx.rentalApplication.findMany(),
      };
    });
    assert.equal(facts.offline.userId,users.offline.user_id);assert.equal(facts.offlineLease.residentContactId,facts.offline.id);assert.equal(facts.offlineLease.status,'active');
    assert.equal(facts.invite.acceptedAt,null);assert.equal(facts.invite.revokedAt,null);assert.equal(facts.invite.deliveryStatus,'not_requested');
    assert.equal(facts.former.status,'archived');assert.equal(facts.ended.status,'ended');assert.equal(facts.prorations,1);
    assert.equal(facts.refund.cashEntries.length,1);assert.equal(facts.refund.cashEntries[0].amountCents,facts.refund.amountCents);assert.equal(facts.refund.cashEntries[0].movementId,facts.refund.id);assert.equal(facts.refund.leaseId,facts.ended.id);
    assert.equal(facts.plannedMoveOut.kind,'plan_end');assert.equal(facts.plannedMoveOut.leaseId,s.offlineLeaseId);assert.equal(facts.offlineLease.status,'active');assert.ok(facts.offlineLease.endsOn.toISOString().slice(0,10)>demo.manifest.today);
    assert.equal(facts.baseline.status,'completed');assert.equal(facts.moveOut.status,'awaiting_review');assert.ok(facts.moveOut.baselineRevisionId);
    assert.equal(facts.agreement.status,'reviewed');assert.ok(facts.shared.receivedAt);assert.equal(facts.shared.userId,users.resident.user_id);
    assert.ok(facts.files.length>0);assert.ok(facts.files.every(f=>f.scanStatus==='unscanned'&&f.scannedAt==null));
    assert.equal(facts.scanAudits,0);assert.equal(facts.files.find(file=>file.id===facts.shared.documentVersionId).scanStatus,'unscanned');
    const source=`/api/company/leases/${demo.manifest.leases[0]}/documents/${facts.shared.documentId}/versions/${facts.shared.documentVersionId}`;
    assert.equal((await call(users.owner.user_id,'GET',source+'/download')).statusCode,200);
    assert.equal((await call(users.owner.user_id,'POST',source+'/scan',{})).statusCode,404);
    const residentOriginal=await call(users.resident.user_id,'GET',`/api/resident/documents/${facts.shared.id}/download`);assert.equal(residentOriginal.statusCode,200,residentOriginal.body);assert.equal(Buffer.from(residentOriginal.json().contentBase64,'base64').toString(),DEMO_BUNDLED_TEXT);
    assert.ok(facts.archivedDoc.archivedAt);assert.equal(facts.units.length,6);
    for(const propertyId of demo.manifest.properties)assert.equal(facts.units.filter(u=>u.propertyId===propertyId).length,3);
    assert.deepEqual(new Set(demo.manifest.units),new Set(facts.units.map(u=>u.id)));
    const occupied=facts.units.filter(u=>u.leases.some(l=>l.status==='active'&&l.startsOn.toISOString().slice(0,10)<=demo.manifest.today&&l.endsOn.toISOString().slice(0,10)>=demo.manifest.today));
    assert.equal(occupied.length,4);assert.ok(!occupied.some(u=>[s.readyUnitId,s.turnoverUnitId].includes(u.id)));
    assert.equal(facts.units.find(u=>u.id===s.readyUnitId).availability.condition,'ready');
    assert.equal(facts.units.find(u=>u.id===s.turnoverUnitId).availability.condition,'turnover');
    assert.equal(facts.units.find(u=>u.id===s.restoredUnitId).version,3);
    assert.equal(facts.ended.unitId,s.turnoverUnitId);assert.equal(facts.offlineLease.unitId,demo.manifest.units[4]);assert.ok(facts.voided.voidedAt);assert.equal(facts.schedule.status,'paused');
    assert.equal(facts.imports.find(b=>b.id===s.unitImportId).status,'committed');assert.ok(facts.imports.find(b=>b.id===s.invalidUnitImportId).preview.errorCount>0);
    assert.equal(facts.expenses.find(b=>b.id===s.expenseImportId).status,'committed');assert.ok(facts.expenses.find(b=>b.id===s.duplicateExpenseImportId).preview.errorCount>0);
    assert.equal(facts.applications.find(a=>a.id===s.approvedApplicationId).status,'approved');assert.equal(facts.applications.find(a=>a.id===s.rejectedApplicationId).status,'rejected');
    const rent=await ok(users.owner.user_id,'GET',`/api/company/rent?leaseId=${demo.manifest.leases[0]}`);assert.ok(BigInt(rent.accounts[0].summary.creditCents)>0n);assert.ok(rent.accounts[0].credits.some(c=>c.reversal));
    assert.equal((await call(users.occupant.user_id,'GET','/api/resident/documents')).json().items.length,0);
    const replies=await ok(users.resident.user_id,'GET',`/api/resident/maintenance/${demo.manifest.requests.at(-1)}/updates`);assert.ok(!JSON.stringify(replies).includes('DEMO INTERNAL'));assert.ok(JSON.stringify(replies).includes('weekday mornings'));
    const notices=await ok(users.manager.user_id,'GET','/api/account/notifications');assert.ok(notices.items.some(n=>n.readAt));assert.ok(notices.items.some(n=>!n.readAt));
    assert.equal((await ok(users.manager.user_id,'GET','/api/account/notifications/preferences')).settings.workEnabled,false);
    assert.equal((await call('customer','GET',`/api/company/resident-contacts/${s.offlineContactId}`)).statusCode,404);
  });
  await t.test('source walkthrough and disconnected plans read only and do not grant company authority',async()=>{
    const before={companies:await db.company.count(),users:await db.user.count(),setups:await db.salesDemoSetup.count(),audits:await db.auditEvent.count(),created,ensureCalls,blockCalls};
    const plan=await ok('platform','GET',`${base}/${sheet.id}/plan?intent=inspect`);
    assert.equal(plan.stops.length,10);assert.ok(plan.coverage.every(c=>c.complete));assert.ok(plan.stops.some(s=>s.path===`/company/leases/${demo.manifest.scenarios.offlineLeaseId}`));assert.ok(plan.stops.some(s=>s.path===`/resident/leases/${demo.manifest.leases[0]}/statement`));assert.ok(plan.stops.some(s=>s.path==='/resident'&&s.role.includes('occupant')));
    for(const c of sheet.credentials)assert.ok(!JSON.stringify(plan).includes(c.password));
    assert.equal((await call('customer','GET',`${base}/${sheet.id}/plan?intent=inspect`)).statusCode,403);
    const offline=Fastify();registerRequestErrors(offline);
    const offlineAuth=await registerSessions(offline,db,{origin:'https://app.test',domain:'unused.auth0.com',clientId:'test',clientSecret:'test-only',secure:true});
    registerApplication(offline,db,offlineAuth,'https://app.test',undefined,{salesDemoCredentialSecret:'isolated-demo-test-encryption-secret'});
    try{
      const r=await offline.inject({method:'GET',url:base+'/blueprint',headers:{cookie:'__Host-pf-session=token-platform'}});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().environment.provisioningAllowed,false);
      const existing=await offline.inject({method:'GET',url:`${base}/${sheet.id}/plan?intent=inspect`,headers:{cookie:'__Host-pf-session=token-platform'}});assert.equal(existing.statusCode,200,existing.body);assert.equal(existing.json().stops.length,10);assert.deepEqual(existing.json().blockers,[]);
    }finally{await offline.close();}
    assert.deepEqual({companies:await db.company.count(),users:await db.user.count(),setups:await db.salesDemoSetup.count(),audits:await db.auditEvent.count(),created,ensureCalls,blockCalls},before);
    await admin.query('UPDATE "User" SET "platformRole"=NULL WHERE id=\'platform\'');
    try{assert.equal((await call('platform','GET',`${base}/${sheet.id}/plan?intent=inspect`)).statusCode,403);}finally{await admin.query('UPDATE "User" SET "platformRole"=\'owner\' WHERE id=\'platform\'');}
  });
  await t.test('an unrelated member in a demo blocks retirement and rebuilding without changing any account',async()=>{
    await admin.query(`INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES('unrelated-demo-member','unrelated@test.invalid','Unrelated customer',true,NOW())`);
    await admin.query(`INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES('unrelated-demo-member',$1,'manager',NOW())`,[demo.companyId]);
    await session('unrelated-demo-member');const before={created,blockCalls,ensureCalls,version:(await current(sheet.id)).version};
    try{
      const plan=await ok('platform','GET',`${base}/${sheet.id}/plan?intent=rebuild`);assert.equal(plan.canRebuild,false);assert.ok(plan.blockers.some(b=>b.includes('not owned')));
      assert.equal((await call('platform','POST',`${base}/${sheet.id}/teardown`,{expectedVersion:demo.version})).statusCode,409);
      assert.equal((await call('platform','POST',`${base}/${sheet.id}/rebuild`,{submissionKey:randomUUID(),expectedVersion:plan.expectedVersion,planHash:plan.planHash,confirmed:true})).statusCode,409);
      assert.deepEqual({created,blockCalls,ensureCalls,version:(await current(sheet.id)).version},before);
      assert.equal((await db.user.findUniqueOrThrow({where:{id:'unrelated-demo-member'}})).status,'active');assert.equal((await db.companyMembership.findUniqueOrThrow({where:{userId:'unrelated-demo-member'}})).status,'active');assert.equal(await db.session.count({where:{userId:'unrelated-demo-member'}}),1);
      assert.equal((await db.company.findUniqueOrThrow({where:{id:demo.companyId}})).status,'active');
    }finally{await admin.query('DELETE FROM "CompanyMembership" WHERE "userId"=\'unrelated-demo-member\'');}
  });
  await t.test('blocked lifecycle names the added owner and generated support grant, then refreshes after existing access controls repair them',async()=>{
    const accounts=(await db.salesDemoSetup.findUniqueOrThrow({where:{id:sheet.id}})).accounts,changedId=accounts.resident3.user_id,extraId='additional-existing-owner';
    await db.user.create({data:{id:extraId,email:'existing-owner@test.invalid',name:'Existing owner',emailVerified:true,membership:{create:{companyId:demo.companyId,role:'owner'}}}});
    const changed=await db.user.findUniqueOrThrow({where:{id:changedId}});
    await ok('platform','PATCH',`/api/platform/users/${encodeURIComponent(changedId)}/support-access`,{enabled:true,updatedAt:changed.updatedAt.toISOString()});
    const callsBefore={created,blockCalls,ensureCalls};
    try{
      const plan=await ok('platform','GET',`${base}/${sheet.id}/plan?intent=retire`);
      assert.equal(plan.companyMembers,9);assert.equal(plan.blockers.length,2);
      assert.equal(plan.ownershipReview.foreignMembers.length,1);assert.equal(plan.ownershipReview.foreignMembers[0].userId,extraId);
      const issue=plan.ownershipReview.changedAccounts.find(a=>a.userId===changedId);assert.deepEqual(issue.reasons,['platform_authority']);assert.equal(issue.platformRole,'support');
      assert.equal(issue.supportPath,`/platform/impersonation?supportUserId=${encodeURIComponent(changedId)}`);assert.ok(!issue.reviewPath.includes('companyId'));
      assert.equal((await call('customer','GET',`${base}/${sheet.id}/plan?intent=retire`)).statusCode,403);
      assert.equal((await call('platform','POST',`${base}/${sheet.id}/teardown`,{expectedVersion:demo.version,planHash:plan.planHash})).statusCode,409);
      assert.deepEqual({created,blockCalls,ensureCalls},callsBefore);
      const membership=await db.companyMembership.findUniqueOrThrow({where:{userId:extraId}});
      await ok('platform','DELETE',`/api/platform/users/${extraId}/membership`,{expectedVersion:membership.version,expectedCompanyId:membership.companyId,expectedCreatedAt:membership.createdAt.toISOString()});
      const current=await db.user.findUniqueOrThrow({where:{id:changedId}});
      await ok('platform','PATCH',`/api/platform/users/${encodeURIComponent(changedId)}/support-access`,{enabled:false,updatedAt:current.updatedAt.toISOString()});
      const reviewed=await ok('platform','GET',`${base}/${sheet.id}/plan?intent=retire`);assert.deepEqual(reviewed.blockers,[]);assert.deepEqual(reviewed.ownershipReview,{foreignMembers:[],changedAccounts:[]});
      assert.notEqual(reviewed.planHash,plan.planHash);assert.equal((await db.user.findUniqueOrThrow({where:{id:extraId}})).status,'active');
      const stale=await call('platform','POST',`${base}/${sheet.id}/teardown`,{expectedVersion:demo.version,planHash:plan.planHash});assert.equal(stale.statusCode,409);assert.equal(stale.json().code,'DEMO_PLAN_CHANGED');
      assert.deepEqual({created,blockCalls,ensureCalls},callsBefore);
    }finally{
      await db.user.update({where:{id:changedId},data:{platformRole:null}});await db.companyMembership.deleteMany({where:{userId:extraId}});
    }
  });
  await t.test('manual demo passwords invalidate the original login sheet and uncertain attempts remain reviewable before cleanup',async()=>{
    const get=provider.get,setPassword=provider.setPassword;
    try{
      for(const uncertain of [false,true]){
        const built=await ok('platform','POST',base,{submissionKey:randomUUID()}),accounts=(await db.salesDemoSetup.findUniqueOrThrow({where:{id:built.id}})).accounts,userId=accounts.owner.user_id;
        provider.get=async id=>({...remote.get(Object.values(accounts).find(a=>a.user_id===id).email),identities:[{provider:'auth0',connection:provider.databaseConnection}]});
        provider.setPassword=async(id,password)=>{passwords.set(Object.values(accounts).find(a=>a.user_id===id).email,password);if(uncertain)throw Error('Lost fictional provider response');};
        const path=`/api/platform/users/${encodeURIComponent(userId)}/password`,review=await ok('platform','GET',path),password='Fictional-administrator-password-123!';
        const result=await call('platform','POST',path,{password,confirmation:password,reviewHash:review.reviewHash,submissionKey:randomUUID()});assert.equal(result.statusCode,uncertain?503:200,result.body);
        assert.ok((await db.user.findUniqueOrThrow({where:{id:userId}})).credentialChangedAt);
        const stale=await call('platform','POST',`${base}/${built.id}/credentials`,{});assert.equal(stale.statusCode,409);assert.equal(stale.json().code,'DEMO_PASSWORD_CHANGED');
        if(uncertain){
          const plan=await ok('platform','GET',`${base}/${built.id}/plan?intent=retire`);assert.ok(plan.ownershipReview.changedAccounts.some(a=>a.userId===userId&&a.reasons.includes('password_change_pending')));
          const stopped=await call('platform','POST',`${base}/${built.id}/teardown`,{expectedVersion:1,planHash:plan.planHash});assert.equal(stopped.statusCode,409);
          const attempt=(await ok('platform','GET',path)).operation;assert.equal(attempt.status,'uncertain');
          await db.manualPasswordOperation.update({where:{id:attempt.id},data:{leaseUntil:new Date(Date.now()-1000)}});
          await ok('platform','POST',path+'/release',{operationId:attempt.id,confirmed:true});
        }
        const plan=await ok('platform','GET',`${base}/${built.id}/plan?intent=retire`);assert.deepEqual(plan.blockers,[]);
        await ok('platform','POST',`${base}/${built.id}/teardown`,{expectedVersion:1,planHash:plan.planHash});assert.equal(remote.get(accounts.owner.email).blocked,true);
      }
    }finally{provider.get=get;provider.setPassword=setPassword;}
  });
  await t.test('legacy hashless create and teardown retain auth, environment, stale-version and non-demo boundaries',async()=>{
    const saved=await db.salesDemoSetup.findUniqueOrThrow({where:{id:sheet.id}});
    assert.equal(saved.blueprint.seedVersion,SALES_DEMO_SEED_VERSION);assert.equal(saved.blueprint.anchorOn,demo.manifest.today);
    assert.deepEqual(saved.blueprint.environment,{name:'disposable_test',origin:'https://app.test',identityIssuer:provider.issuer,provisioningAllowed:true});
    const snapshot=async()=>({companies:await db.company.count(),users:await db.user.count(),setups:await db.salesDemoSetup.count(),audits:await db.auditEvent.count(),created,ensureCalls,blockCalls,demo:await current(sheet.id),customer:await db.company.findUniqueOrThrow({where:{id:'customer-company'}})});
    const before=await snapshot(),path=`${base}/${sheet.id}/teardown`,teardown={expectedVersion:demo.version};
    for(const user of ['customer','missing-session']){
      const denied=await call(user,'POST',path,teardown);assert.equal(denied.statusCode,user==='customer'?403:401,denied.body);
    }
    for(const headers of [{origin:'https://evil.test'},{'x-csrf-token':'wrong'}]){
      const denied=await call('platform','POST',path,teardown,headers);assert.equal(denied.statusCode,403,denied.body);assert.equal(denied.json().code,'CSRF_REJECTED');
    }
    const nonDemo=await call('platform','POST',`${base}/customer-company/teardown`,{expectedVersion:1});assert.equal(nonDemo.statusCode,404,nonDemo.body);
    const stale=await call('platform','POST',path,{expectedVersion:demo.version+10});assert.equal(stale.statusCode,409,stale.body);assert.equal(stale.json().code,'RECORD_CHANGED');
    const invalidReview=await call('platform','POST',path,{...teardown,planHash:'0'.repeat(64)});assert.equal(invalidReview.statusCode,409,invalidReview.body);assert.equal(invalidReview.json().code,'DEMO_PLAN_CHANGED');
    const prior={app:process.env.APP_ENV,disposable:process.env.SALES_DEMO_DISPOSABLE};
    try{
      delete process.env.SALES_DEMO_DISPOSABLE;process.env.APP_ENV='production';
      const create=await call('platform','POST',base,{submissionKey:randomUUID()});assert.equal(create.statusCode,503,create.body);assert.equal(create.json().code,'DEMO_ENVIRONMENT_UNAVAILABLE');
      const cleanup=await call('platform','POST',path,teardown);assert.equal(cleanup.statusCode,409,cleanup.body);assert.equal(cleanup.json().code,'DEMO_ENVIRONMENT_CHANGED');
    }finally{
      for(const [key,value]of [['APP_ENV',prior.app],['SALES_DEMO_DISPOSABLE',prior.disposable]])value===undefined?delete process.env[key]:process.env[key]=value;
    }
    assert.deepEqual(await snapshot(),before);
    // Other named lifecycle cases exercise successful hashless create/retry,
    // moved generated identities, foreign members, failed-provider recovery,
    // completed cleanup and legacy-presenter preservation without another seed.
  });
  await t.test('nine-account provider throttling resumes cleanup without replaying confirmed lookups or touching a ready demo',async()=>{
    let clock=Date.now(),creationLimited=false,patchAttempts=0,patchLimited=false;const owned=new Map(),lookups=new Map();let fetches=0;
    const realProvider=identityProvider({AUTH0_DOMAIN:'unused.auth0.com',AUTH0_MANAGEMENT_CLIENT_ID:'fixture',AUTH0_MANAGEMENT_CLIENT_SECRET:'fixture-only'},async(raw,options)=>{
      fetches++;const url=new URL(raw);
      if(url.pathname==='/oauth/token')return Response.json({access_token:'fixture-only-token',expires_in:3600});
      if(url.pathname==='/api/v2/users-by-email'){
        const email=url.searchParams.get('email');lookups.set(email,(lookups.get(email)||0)+1);
        if(owned.size===9&&!creationLimited){creationLimited=true;return new Response('PRIVATE upstream quota body',{status:429,headers:{'retry-after':'30'}});}
        return Response.json(owned.has(email)?[owned.get(email)]:[]);
      }
      if(url.pathname==='/api/v2/users'&&options.method==='POST'){
        const input=JSON.parse(options.body),row={user_id:'auth0|quota-'+randomUUID(),email:input.email,email_verified:true,blocked:false,identities:[{provider:'auth0',connection:'Username-Password-Authentication'}],app_metadata:input.app_metadata};owned.set(row.email,row);return Response.json(row);
      }
      if(options.method==='PATCH'){
        const subject=decodeURIComponent(url.pathname.slice('/api/v2/users/'.length)),row=[...owned.values()].find(row=>row.user_id===subject);assert.ok(row);assert.deepEqual(JSON.parse(options.body),{blocked:true});patchAttempts++;
        if(patchAttempts===4&&!patchLimited){patchLimited=true;return new Response('PRIVATE update quota body',{status:429,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':String((clock+30000)/1000)}});}
        row.blocked=true;return Response.json(row);
      }
      throw Error('Unexpected fixture provider operation');
    },{now:()=>clock,wait:async milliseconds=>{clock+=milliseconds;}});
    const isolated=Fastify();registerRequestErrors(isolated);const isolatedAuth=await registerSessions(isolated,db,{origin:'https://app.test',domain:'unused.auth0.com',clientId:'test',clientSecret:'test-only',secure:true});registerApplication(isolated,db,isolatedAuth,'https://app.test',realProvider,{salesDemoCredentialSecret:'isolated-demo-test-encryption-secret'});
    const invoke=(path,payload)=>isolated.inject({method:'POST',url:path,headers:{cookie:'__Host-pf-session=token-platform',origin:'https://app.test','x-csrf-token':'csrf'},payload});
    const readyBefore=await current(sheet.id),customerBefore=await db.company.findUniqueOrThrow({where:{id:'customer-company'}}),key=randomUUID();
    try{
      const create=await invoke(base,{submissionKey:key});assert.equal(create.statusCode,429,create.body);assert.ok(!create.body.includes('PRIVATE'));assert.equal(owned.size,9);
      const unfinished=await db.salesDemoSetup.findUniqueOrThrow({where:{createdById_submissionKey:{createdById:'platform',submissionKey:key}}});assert.equal(Object.keys(unfinished.accounts).length,9);assert.equal(unfinished.salesDemoId,null);
      clock+=31000;const path=`${base}/${unfinished.id}/teardown`;
      const partial=await invoke(path,{expectedVersion:1});assert.equal(partial.statusCode,429,partial.body);assert.ok(Number(partial.headers['retry-after'])>=30);assert.ok(!partial.body.includes('PRIVATE'));
      const progress=await db.salesDemoSetup.findUniqueOrThrow({where:{id:unfinished.id}}),confirmed=Object.values(progress.accounts).filter(account=>account.cleanupConfirmedSubject===account.user_id);assert.equal(progress.status,'retiring');assert.equal(confirmed.length,3);
      const counts=new Map(confirmed.map(account=>[account.email,lookups.get(account.email)])),beforeCooldown=fetches;
      const early=await invoke(path,{expectedVersion:1});assert.equal(early.statusCode,429,early.body);assert.equal(fetches,beforeCooldown,'cooldown retry must not hammer the provider');
      clock+=31000;const finished=await invoke(path,{expectedVersion:1});assert.equal(finished.statusCode,200,finished.body);assert.equal((await db.salesDemoSetup.findUniqueOrThrow({where:{id:unfinished.id}})).status,'retired');
      for(const [email,count]of counts)assert.equal(lookups.get(email),count,'acknowledged subjects must not spend another provider lookup');
      assert.equal(patchAttempts,10);assert.ok([...owned.values()].every(row=>row.blocked));assert.deepEqual(await current(sheet.id),readyBefore);assert.deepEqual(await db.company.findUniqueOrThrow({where:{id:'customer-company'}}),customerBefore);
    }finally{await isolated.close();}
  });
  await t.test('known legacy account or local identity issuer mismatches reject cleanup before all claim effects',async()=>{
    const original=await db.salesDemoSetup.findUniqueOrThrow({where:{id:sheet.id}}),originalIssuer=provider.issuer,originalConnection=provider.databaseConnection;
    const snapshot=async()=>({setup:await db.salesDemoSetup.findUniqueOrThrow({where:{id:sheet.id}}),demo:await current(sheet.id),company:await db.company.findUniqueOrThrow({where:{id:sheet.companyId}}),users:await db.user.findMany({where:{id:{in:Object.values(original.accounts).map(account=>account.user_id)}},orderBy:{id:'asc'}}),members:await db.companyMembership.findMany({where:{companyId:sheet.companyId},orderBy:{userId:'asc'}}),sessions:await db.session.count(),audits:await db.auditEvent.count(),ensureCalls,blockCalls});
    try{
      for(const variant of ['persisted-issuer','persisted-connection','local-identity']){
        const accounts=variant==='local-identity'?Object.fromEntries(Object.entries(original.accounts).map(([key,{issuer,connection,...account}])=>[key,account])):original.accounts;
        await db.salesDemoSetup.update({where:{id:sheet.id},data:{blueprint:Prisma.DbNull,accounts}});
        if(variant==='persisted-connection')provider.databaseConnection='other-connection';else provider.issuer='https://other.auth0.com/';
        const before=await snapshot(),result=await call('platform','POST',`${base}/${sheet.id}/teardown`,{expectedVersion:demo.version});assert.equal(result.statusCode,409,result.body);assert.equal(result.json().code,'DEMO_PROVIDER_CHANGED');assert.deepEqual(await snapshot(),before);
        provider.issuer=originalIssuer;provider.databaseConnection=originalConnection;
      }
    }finally{provider.issuer=originalIssuer;provider.databaseConnection=originalConnection;await db.salesDemoSetup.update({where:{id:sheet.id},data:{blueprint:original.blueprint,accounts:original.accounts}});}
  });
  await t.test('teardown is atomic locally, blocks generated Auth0 users, retries and preserves history',async()=>{
    await admin.query(`CREATE FUNCTION reject_demo_retirement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sales_demo.retired' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_demo_retirement BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_demo_retirement()`);
    try{assert.equal((await call('platform','POST',`${base}/${sheet.id}/teardown`,{expectedVersion:1})).statusCode,503);}finally{await admin.query('DROP TRIGGER reject_demo_retirement ON "AuditEvent"; DROP FUNCTION reject_demo_retirement()');}
    assert.equal((await current(sheet.id)).status,'ready');
    failBlock=true;assert.equal((await call('platform','POST',`${base}/${sheet.id}/teardown`,{expectedVersion:1})).statusCode,503);
    const setup=await db.salesDemoSetup.findUniqueOrThrow({where:{id:sheet.id}});assert.equal(setup.status,'retiring');
    for(const account of Object.values(setup.accounts)){assert.equal((await db.user.findUniqueOrThrow({where:{id:account.user_id}})).status,'disabled');assert.equal((await call(account.user_id,'GET','/api/bootstrap')).statusCode,401);}
    assert.equal((await call('platform','POST',`${base}/${sheet.id}/credentials`,{})).statusCode,409);
    // Pause exactly after beforeBlock committed its fresh ownership check and
    // local disable, before the external PATCH. No database lock spans this
    // await: unrelated customer administration must still complete promptly.
    const manager=setup.accounts.manager;let reached,releaseBlock;
    const atProvider=new Promise(resolve=>{reached=resolve;}),continueProvider=new Promise(resolve=>{releaseBlock=resolve;});
    pauseBlock=async account=>{if(account.user_id===manager.user_id){reached();await continueProvider;throw new IdentityProviderError('update','rate_limit',429,30);}};
    const retirement=call('platform','POST',`${base}/${sheet.id}/teardown`,{expectedVersion:2});
    try{
      await Promise.race([atProvider,retirement.then(response=>{throw Error('Cleanup finished before provider pause: '+response.body);})]);
      assert.equal(remote.get(manager.email).blocked,false);
      const active=await call('platform','PATCH',`/api/platform/users/${encodeURIComponent(manager.user_id)}/status`,{status:'active'});
      assert.equal(active.statusCode,409,active.body);assert.equal(active.json().code,'DEMO_OPERATION_IN_PROGRESS');
      const member=await db.companyMembership.findUniqueOrThrow({where:{userId:manager.user_id}});
      const transfer=await call('platform','PUT',`/api/platform/users/${encodeURIComponent(manager.user_id)}/membership`,{companyId:'customer-company',role:'manager',status:'active',expectedVersion:member.version});
      assert.equal(transfer.statusCode,409,transfer.body);assert.equal(transfer.json().code,'DEMO_OPERATION_IN_PROGRESS');
      const managerUser=await db.user.findUniqueOrThrow({where:{id:manager.user_id}});
      const support=await call('platform','PATCH',`/api/platform/users/${encodeURIComponent(manager.user_id)}/support-access`,{enabled:true,updatedAt:managerUser.updatedAt.toISOString()});
      assert.equal(support.statusCode,409,support.body);assert.equal(support.json().code,'DEMO_OPERATION_IN_PROGRESS');
      // Company-scoped callers cannot discover a foreign reservation. Their
      // normal missing/foreign-target result must remain indistinguishable.
      for(const target of [manager.user_id,'missing-demo-user']){
        const companyEdit=await call('customer','PATCH',`/api/company/members/${encodeURIComponent(target)}`,{role:'manager',status:'active',expectedVersion:member.version});
        assert.equal(companyEdit.statusCode,404,companyEdit.body);assert.equal(companyEdit.json().code,'NOT_FOUND');
        const ownerTransfer=await call('customer','POST','/api/company/transfer-ownership',{userId:target});
        assert.equal(ownerTransfer.statusCode,403,ownerTransfer.body);assert.equal(ownerTransfer.json().code,'INVALID_OWNER');
      }
      assert.equal((await db.user.findUniqueOrThrow({where:{id:manager.user_id}})).status,'disabled');
      assert.equal((await db.companyMembership.findUniqueOrThrow({where:{userId:manager.user_id}})).companyId,sheet.companyId);
      await ok('platform','PATCH','/api/platform/users/customer/status',{status:'active'});
      const customerMember=await db.companyMembership.findUniqueOrThrow({where:{userId:'customer'}});
      await ok('platform','PUT','/api/platform/users/customer/membership',{companyId:'customer-company',role:'owner',status:'active',expectedVersion:customerMember.version});
    }finally{pauseBlock=null;releaseBlock();}
    const interrupted=await retirement;assert.equal(interrupted.statusCode,429,interrupted.body);
    assert.equal((await db.salesDemoSetup.findUniqueOrThrow({where:{id:sheet.id}})).status,'retiring');
    const stillReserved=await call('platform','PATCH',`/api/platform/users/${encodeURIComponent(manager.user_id)}/status`,{status:'active'});assert.equal(stillReserved.statusCode,409,stillReserved.body);assert.equal(stillReserved.json().code,'DEMO_OPERATION_IN_PROGRESS');
    const stillAssigned=await db.companyMembership.findUniqueOrThrow({where:{userId:manager.user_id}}),stillTransfer=await call('platform','PUT',`/api/platform/users/${encodeURIComponent(manager.user_id)}/membership`,{companyId:'customer-company',role:'manager',status:'active',expectedVersion:stillAssigned.version});assert.equal(stillTransfer.statusCode,409,stillTransfer.body);assert.equal(stillTransfer.json().code,'DEMO_OPERATION_IN_PROGRESS');
    await ok('platform','POST',`${base}/${sheet.id}/teardown`,{expectedVersion:2});
    // The reservation ends only after all provider cleanup is confirmed.
    await ok('platform','PATCH',`/api/platform/users/${encodeURIComponent(manager.user_id)}/status`,{status:'active'});
    await ok('platform','PATCH',`/api/platform/users/${encodeURIComponent(manager.user_id)}/status`,{status:'disabled'});
    for(const c of sheet.credentials)assert.equal(remote.get(c.email).blocked,true);
    assert.equal((await db.salesDemoSetup.findUniqueOrThrow({where:{id:sheet.id}})).credentialsCipher,'');
    assert.equal((await call('platform','POST',base,payload)).statusCode,409);
    const fresh=await ok('platform','POST',base,{submissionKey:randomUUID()});assert.notEqual(fresh.companyId,sheet.companyId);assert.ok(fresh.credentials.every(c=>!sheet.credentials.some(old=>old.email===c.email)));
    await ok('platform','POST',`${base}/${sheet.id}/teardown`,{expectedVersion:1});assert.equal((await current(fresh.id)).status,'ready');
    assert.equal((await db.company.findUniqueOrThrow({where:{id:'customer-company'}})).status,'active');
  });
  await t.test('pending cleanup includes an ambiguous Auth0 success whose subject was not recorded',async()=>{
    loseIdentity=true;const p={submissionKey:randomUUID()};assert.equal((await call('platform','POST',base,p)).statusCode,503);
    const pending=(await ok('platform','GET',base)).setups[0];assert.equal(pending.accountsPrepared,0);
    // New-format ambiguous creates retain their pinned blueprint; the legacy
    // null-blueprint path has a separate old-address regression below.
    pauseBlock=async()=>{throw new IdentityProviderError('update','rate_limit',429,30);};
    try{const interrupted=await call('platform','POST',`${base}/${pending.id}/teardown`,{expectedVersion:1});assert.equal(interrupted.statusCode,429,interrupted.body);}finally{pauseBlock=null;}
    const recorded=await db.salesDemoSetup.findUniqueOrThrow({where:{id:pending.id}});assert.equal(Object.keys(recorded.accounts).length,1);assert.ok(Object.values(recorded.accounts).every(account=>account.issuer===provider.issuer&&account.connection===provider.databaseConnection&&!account.cleanupConfirmedSubject));
    const originalIssuer=provider.issuer,beforeCalls=blockCalls,beforeAudit=await db.auditEvent.count();provider.issuer='https://other.auth0.com/';
    try{const rejected=await call('platform','POST',`${base}/${pending.id}/teardown`,{expectedVersion:1});assert.equal(rejected.statusCode,409,rejected.body);assert.equal(rejected.json().code,'DEMO_PROVIDER_CHANGED');assert.equal(blockCalls,beforeCalls);assert.equal(await db.auditEvent.count(),beforeAudit);assert.deepEqual(await db.salesDemoSetup.findUniqueOrThrow({where:{id:pending.id}}),recorded);}finally{provider.issuer=originalIssuer;}
    await ok('platform','POST',`${base}/${pending.id}/teardown`,{expectedVersion:1});
    for(const [email,row]of remote)if(newDemoCredentials(pending.id).some(c=>c.email===email))assert.equal(row.blocked,true);
  });
  await t.test('an ambiguous identity transferred outside the demo is never blocked by cleanup',async()=>{
    loseIdentity=true;assert.equal((await call('platform','POST',base,{submissionKey:randomUUID()})).statusCode,503);
    const pending=(await ok('platform','GET',base)).setups[0],account=[...remote.values()].find(u=>u.email===newDemoCredentials(pending.id).find(c=>c.accountKey==='owner').email);
    await admin.query(`INSERT INTO "User"(id,email,"emailVerified","updatedAt") VALUES($1,$2,true,NOW());`,[account.user_id,account.email]);
    await db.companyMembership.create({data:{userId:account.user_id,companyId:'customer-company',role:'manager'}});
    assert.equal((await call('platform','POST',`${base}/${pending.id}/teardown`,{expectedVersion:1})).statusCode,409);
    assert.equal(remote.get(account.email).blocked,false);assert.equal((await db.user.findUniqueOrThrow({where:{id:account.user_id}})).status,'active');
    await db.companyMembership.delete({where:{userId:account.user_id}});
    await ok('platform','POST',`${base}/${pending.id}/teardown`,{expectedVersion:1});assert.equal(remote.get(account.email).blocked,true);
  });
  await t.test('unfinished legacy email generation cleans up exact saved addresses after the email format change',async()=>{
    const id=randomUUID(), credentials=newDemoCredentials(id).map(c=>({...c,email:`${c.accountKey}.${id}@sales-demo.invalid`}));
    // This models an older ambiguous provider create whose subject was never saved.
    const legacy=credentials[0],subject='auth0|legacy-email-'+randomUUID();
    remote.set(legacy.email,{user_id:subject,email:legacy.email,name:legacy.name,email_verified:true,blocked:false});
    await db.salesDemoSetup.create({data:{id,createdById:'platform',submissionKey:randomUUID(),submissionHash:'legacy-email-fixture',credentialsCipher:sealDemoCredentials(id,credentials,'former-application-secret')}});
    await ok('platform','POST',`${base}/${id}/teardown`,{expectedVersion:1});
    assert.equal(remote.get(legacy.email).blocked,true);
    const retired=await db.salesDemoSetup.findUniqueOrThrow({where:{id}});assert.equal(retired.status,'retired');assert.equal(retired.credentialsCipher,'');
  });
  await t.test('new-format ambiguous identity cleanup survives an unavailable credential encryption key',async()=>{
    const submissionKey=randomUUID();loseIdentity=true;
    assert.equal((await call('platform','POST',base,{submissionKey})).statusCode,503);
    const pending=await db.salesDemoSetup.findUniqueOrThrow({where:{createdById_submissionKey:{createdById:'platform',submissionKey}}});
    assert.equal(Object.keys(pending.accounts).length,0);assert.equal(pending.blueprint.seedVersion,SALES_DEMO_SEED_VERSION);
    await db.salesDemoSetup.update({where:{id:pending.id},data:{credentialsCipher:sealDemoCredentials(pending.id,newDemoCredentials(pending.id),'former-application-secret')}});
    const ownerEmail=newDemoCredentials(pending.id).find(c=>c.accountKey==='owner').email;
    assert.equal(remote.get(ownerEmail).blocked,false);
    await ok('platform','POST',`${base}/${pending.id}/teardown`,{expectedVersion:1});
    assert.equal(remote.get(ownerEmail).blocked,true);
    assert.equal((await db.salesDemoSetup.findUniqueOrThrow({where:{id:pending.id}})).status,'retired');
  });
  await t.test('legacy teardown preserves its pre-existing presenter identity',async()=>{
    await admin.query(`INSERT INTO "User"(id,email,"emailVerified","updatedAt") VALUES('legacy-owner','legacy@test.invalid',true,NOW()); INSERT INTO "Company"(id,name,"updatedAt") VALUES('legacy-company','Legacy demo',NOW()); INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES('legacy-owner','legacy-company','owner',NOW()); INSERT INTO "SalesDemo"(id,"companyId","ownerId","createdById","submissionKey","submissionHash","seedVersion",manifest) VALUES('legacy-demo','legacy-company','legacy-owner','platform','legacy','legacy',1,'{}')`);
    const before=blockCalls;await ok('platform','POST',`${base}/legacy-demo/teardown`,{expectedVersion:1});assert.equal(blockCalls,before);assert.equal((await db.user.findUniqueOrThrow({where:{id:'legacy-owner'}})).status,'active');assert.equal(await db.companyMembership.findUnique({where:{userId:'legacy-owner'}}),null);
  });
  await t.test('legacy retirement leaves a presenter now assigned to a customer company and their sessions untouched',async()=>{
    await admin.query(`INSERT INTO "User"(id,email,"emailVerified","updatedAt") VALUES('moved-presenter','moved-presenter@test.invalid',true,NOW()); INSERT INTO "Company"(id,name,"updatedAt") VALUES('old-presentation-company','Older fictional company',NOW()); INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES('moved-presenter','customer-company','staff',NOW()); INSERT INTO "SalesDemo"(id,"companyId","ownerId","createdById","submissionKey","submissionHash","seedVersion",manifest) VALUES('moved-presenter-demo','old-presentation-company','moved-presenter','platform','moved-presenter','moved-presenter',1,'{}')`);
    await session('moved-presenter');const before=blockCalls;
    await ok('platform','POST',`${base}/moved-presenter-demo/teardown`,{expectedVersion:1});assert.equal(blockCalls,before);assert.equal((await db.user.findUniqueOrThrow({where:{id:'moved-presenter'}})).status,'active');assert.equal((await db.companyMembership.findUniqueOrThrow({where:{userId:'moved-presenter'}})).companyId,'customer-company');assert.equal(await db.session.count({where:{userId:'moved-presenter'}}),1);
  });
  await t.test('reviewed rebuild keeps old sources and reserves one resumable replacement after a failed seed',async()=>{
    const source=await ok('platform','POST',base,{submissionKey:randomUUID()}),original=await current(source.id),before=await db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id',${source.companyId},true)`;return {leases:await tx.lease.findMany({where:{companyId:source.companyId},orderBy:{id:'asc'}}),cash:await tx.ledgerEntry.findMany({where:{companyId:source.companyId},orderBy:{id:'asc'}})};});
    const executionReview=await ok('platform','GET',`${base}/${source.id}/plan?intent=rebuild`),beforeExecution={created,blockCalls};
    await admin.query(`CREATE FUNCTION change_rebuild_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."sourceDemoId" IS NOT NULL THEN UPDATE "Company" SET version=version+1 WHERE id=(SELECT "companyId" FROM "SalesDemo" WHERE id=NEW."sourceDemoId"); END IF; RETURN NEW; END $$; CREATE TRIGGER change_rebuild_source AFTER INSERT ON "SalesDemoSetup" FOR EACH ROW EXECUTE FUNCTION change_rebuild_source()`);
    try{const rejected=await call('platform','POST',`${base}/${source.id}/rebuild`,{submissionKey:randomUUID(),expectedVersion:executionReview.expectedVersion,planHash:executionReview.planHash,confirmed:true});assert.equal(rejected.statusCode,409,rejected.body);assert.equal(rejected.json().code,'DEMO_REBUILD_REVIEW_CHANGED');}finally{await admin.query('DROP TRIGGER change_rebuild_source ON "SalesDemoSetup"; DROP FUNCTION change_rebuild_source()');}
    assert.equal((await current(source.id)).status,'ready');assert.deepEqual({created,blockCalls},beforeExecution);
    const abandoned=await db.salesDemoSetup.findFirstOrThrow({where:{sourceDemoId:source.id,status:'pending'}});await ok('platform','POST',`${base}/${abandoned.id}/teardown`,{expectedVersion:1});
    const stale=await ok('platform','GET',`${base}/${source.id}/plan?intent=rebuild`),count=created;
    await db.company.update({where:{id:source.companyId},data:{version:{increment:1}}});
    assert.equal((await call('platform','POST',`${base}/${source.id}/rebuild`,{submissionKey:randomUUID(),expectedVersion:stale.expectedVersion,planHash:stale.planHash,confirmed:true})).statusCode,409);assert.equal(created,count);
    const plan=await ok('platform','GET',`${base}/${source.id}/plan?intent=rebuild`),body={submissionKey:randomUUID(),expectedVersion:plan.expectedVersion,planHash:plan.planHash,confirmed:true};
    await admin.query(`CREATE FUNCTION reject_rebuild_seed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sales_demo.created' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_rebuild_seed BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_rebuild_seed()`);
    const budgetStart=providerBudgets.length;
    try{assert.equal((await call('platform','POST',`${base}/${source.id}/rebuild`,body)).statusCode,503);}finally{await admin.query('DROP TRIGGER reject_rebuild_seed ON "AuditEvent"; DROP FUNCTION reject_rebuild_seed()');}
    const replacement=await db.salesDemoSetup.findFirstOrThrow({where:{sourceDemoId:source.id,status:'pending'}});assert.equal(replacement.sourceVersion,original.version);assert.equal(replacement.blueprint.seedVersion,SALES_DEMO_SEED_VERSION);assert.ok(replacement.blueprint.anchorOn);
    const budgets=providerBudgets.slice(budgetStart);assert.ok(budgets.some(step=>step.action==='block'&&step.generation===source.id));assert.ok(budgets.some(step=>step.action==='ensure'&&step.generation===replacement.id));assert.ok(budgets.every(step=>Number.isFinite(step.deadline)));assert.equal(new Set(budgets.map(step=>step.deadline)).size,1,'predecessor cleanup and replacement creation share one absolute provider deadline');
    assert.equal((await current(source.id)).status,'retired');assert.equal((await db.company.findUniqueOrThrow({where:{id:source.companyId}})).status,'suspended');
    assert.deepEqual((await current(source.id)).manifest,original.manifest);
    const after=await db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id',${source.companyId},true)`;return {leases:await tx.lease.findMany({where:{companyId:source.companyId},orderBy:{id:'asc'}}),cash:await tx.ledgerEntry.findMany({where:{companyId:source.companyId},orderBy:{id:'asc'}})};});assert.deepEqual(after,before);
    const fresh=await ok('platform','POST',`${base}/${source.id}/rebuild`,body);assert.equal(fresh.id,replacement.id);assert.notEqual(fresh.companyId,source.companyId);assert.ok(fresh.credentials.every(c=>!source.credentials.some(old=>old.email===c.email)));
    const replay=await ok('platform','POST',`${base}/${source.id}/rebuild`,body);assert.equal(replay.id,fresh.id);assert.deepEqual(replay.credentials,fresh.credentials);
    assert.equal(await db.salesDemoSetup.count({where:{sourceDemoId:source.id,status:{not:'retired'}}}),1);
    const newest=await ok('platform','GET',`${base}/${source.id}/plan?intent=rebuild`);assert.ok(newest.replacement);assert.equal(newest.canRebuild,false);
    assert.equal((await call('platform','POST',`${base}/${source.id}/rebuild`,{...body,submissionKey:randomUUID(),expectedVersion:newest.expectedVersion,planHash:newest.planHash})).statusCode,409);
    assert.equal((await db.company.findUniqueOrThrow({where:{id:'customer-company'}})).status,'active');assert.equal((await db.user.findUniqueOrThrow({where:{id:'unrelated-demo-member'}})).status,'active');
  });
  await t.test('browser builds without account setup, recovers credentials after response loss and tears down', {skip:!process.env.TEST_SALES_DEMO_BROWSER_URL},async()=>{
    const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
    try{
      const page=await newFixturePage(browser);let lose=true;const keys=[],responses=[],navigations=[],pageErrors=[],viteUpdates=[];
      const startedAt=Date.now();
      page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations.push(new URL(frame.url()).pathname);});
      page.on('pageerror',error=>{pageErrors.push(error.message.slice(0,300));});
      page.on('console',message=>{if(message.text().startsWith('[vite]'))viteUpdates.push(message.text().slice(0,300));});
      await page.route('**/api/**',async route=>{
        const req=route.request(),u=new URL(req.url()),r=await call('platform',req.method(),u.pathname+u.search,req.postDataJSON()||undefined);
        // Bounded diagnostics contain operation paths/status only, never bodies,
        // request keys, credential sheets, query values or generated passwords.
        responses.push({method:req.method(),path:u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi,':id'),status:r.statusCode,elapsedMs:Date.now()-startedAt});
        if(req.method()==='POST'&&u.pathname===base){keys.push(req.postDataJSON().submissionKey);assert.equal(r.statusCode,200,r.body);if(lose){lose=false;return route.abort('failed');}}
        await route.fulfill({status:r.statusCode,contentType:'application/json',body:r.body});
      });
      await page.goto(process.env.TEST_SALES_DEMO_BROWSER_URL+'/platform/companies');await page.getByRole('button',{name:'Manage sales demos',exact:true}).click();
      await expect(page.getByLabel('Dedicated demo account')).toHaveCount(0);
      await expect(page.getByRole('region',{name:'Sales demo blueprint'})).toContainText('Preview only');await page.getByRole('checkbox',{name:'I reviewed the fictional company, role accounts and example states above.',exact:true}).check();
      await page.getByRole('button',{name:'Build sales demo',exact:true}).click();
      // The real fixture graph must commit before the proxy can lose its reply.
      // Wait for that receipt within the declared setup budget, rather than
      // timing a multi-step seed with a five-second UI assertion.
      const logins=page.getByRole('region',{name:'Demo login credentials',exact:true});
      try{
        await expect.poll(()=>keys.length,{timeout:180000}).toBe(1);
        const buildForm=page.getByRole('region',{name:'Sales demo blueprint'}).locator('form');
        await expect(buildForm.getByRole('alert')).toContainText('Retry with the original details');
        await buildForm.getByRole('button',{name:'Build sales demo',exact:true}).click();
        await expect(logins).toBeVisible({timeout:15000});assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
      }catch(error){
        // This stage precedes password reveal. Visible text excludes input
        // values, and the screenshot cannot contain a revealed password.
        const screenshot='/tmp/pf-sales-demo-response-loss-failure.png';
        await page.screenshot({path:screenshot,fullPage:false}).catch(()=>{});
        const visible=(await page.locator('body').innerText().catch(()=>''))
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[fictional email]')
          .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi,'[generation]').slice(0,6000);
        t.diagnostic(JSON.stringify({stage:'lost-build-response',screenshot,buildPostCount:keys.length,responses:responses.slice(-35),navigations,pageErrors,viteUpdates:viteUpdates.slice(-15),visible}));
        throw error;
      }
      await expect(logins.getByLabel('Oak & Elm · DEMO Owner password')).toHaveAttribute('type','password');await page.getByRole('button',{name:'Show passwords',exact:true}).click();await expect(logins.getByLabel('Oak & Elm · DEMO Owner password')).toHaveAttribute('type','text');
      const email=await logins.getByLabel('Oak & Elm · DEMO Owner email').inputValue();await page.reload();await page.getByRole('button',{name:'Manage sales demos',exact:true}).click();await expect(page.getByRole('region',{name:'Demo login credentials'})).toHaveCount(0);
      const row=page.getByRole('listitem').filter({hasText:email});await row.getByRole('button',{name:'View role logins',exact:true}).click();await expect(page.getByRole('region',{name:'Demo login credentials'})).toBeVisible();
      await row.getByRole('button',{name:'Presentation walkthrough',exact:true}).click();await expect(row.getByRole('region',{name:'Demo presentation walkthrough'})).toContainText('Offline tenant with an active lease');
      await row.getByRole('button',{name:'Tear down demo',exact:true}).click();await row.getByRole('checkbox',{name:'I reviewed this demo and the accounts affected by teardown.',exact:true}).check();await row.getByRole('button',{name:'Confirm teardown',exact:true}).click();await expect(page.getByRole('region',{name:'Demo login credentials'})).toHaveCount(0);await expect(row).toContainText('Torn down');
    }finally{await browser.close();}
  });
  await t.test('browser accepts future move-out and preserves date/reason through the real planned-end review', {skip:!process.env.TEST_SALES_DEMO_BROWSER_URL},async()=>{
    const built=await ok('platform','POST',base,{submissionKey:randomUUID()}),fixture=await current(built.id),leaseId=fixture.manifest.leases[0];
    const ownerId=remote.get(built.credentials.find(c=>c.role==='Owner').email).user_id;await session(ownerId);
    const before=await admin.query(`SELECT (SELECT count(*) FROM "LeaseMovement" WHERE "leaseId"=$1)::int movements,(SELECT count(*) FROM "RentCharge" WHERE "leaseId"=$1)::int charges,(SELECT status FROM "RentSchedule" WHERE "leaseId"=$1 LIMIT 1) billing`,[leaseId]);
    const end=new Date(fixture.manifest.today+'T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+9,0);const future=end.toISOString().slice(0,10),reason='Future departure agreed with tenant';
    const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
    try{
      const page=await newFixturePage(browser),settlementWrites=[];
      await page.route('**/api/**',async route=>{
        const req=route.request(),u=new URL(req.url());
        if(req.method()==='POST'&&u.pathname.includes('/settlement'))settlementWrites.push(u.pathname);
        const r=await call(ownerId,req.method(),u.pathname+u.search,req.postDataJSON()||undefined);
        await route.fulfill({status:r.statusCode,contentType:'application/json',body:r.body});
      });
      await page.goto(`${process.env.TEST_SALES_DEMO_BROWSER_URL}/company/leases/${leaseId}?section=settlement`);
      await page.getByRole('button',{name:'Prepare settlement',exact:true}).click();
      const date=page.getByLabel('Move-out date',{exact:true});await expect(date).not.toHaveAttribute('max',/.+/);await date.fill(future);
      await page.getByLabel('Reason shown to the tenant',{exact:true}).fill(reason);
      await page.getByRole('button',{name:'Review planned move-out',exact:true}).click();
      await expect(page.getByLabel('Lease action',{exact:true})).toHaveValue('plan_end');
      await expect(page.getByLabel('Current lease end date',{exact:true})).toHaveValue(future);
      await expect(page.getByRole('dialog').locator('textarea[name="reason"]')).toHaveValue(reason);
      assert.deepEqual(settlementWrites,[]);
      assert.notEqual((await ok(ownerId,'GET',`/api/company/leases/${leaseId}`)).endsOn.slice(0,10),future,'navigation makes no write');
      await page.getByRole('button',{name:'Review changes',exact:true}).click();
      await page.getByLabel('These dates and charges match the lease agreement.',{exact:true}).check();
      await page.getByRole('button',{name:'Save end date',exact:true}).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const lease=await ok(ownerId,'GET',`/api/company/leases/${leaseId}`);assert.equal(lease.status,'active');assert.equal(lease.endsOn.slice(0,10),future);
      const history=await ok(ownerId,'GET',`/api/company/leases/${leaseId}/transition`);assert.equal(history.history[0].kind,'plan_end');assert.equal(history.history[0].reason,reason);
      const after=await admin.query(`SELECT (SELECT count(*) FROM "LeaseMovement" WHERE "leaseId"=$1)::int movements,(SELECT count(*) FROM "RentCharge" WHERE "leaseId"=$1)::int charges,(SELECT status FROM "RentSchedule" WHERE "leaseId"=$1 LIMIT 1) billing`,[leaseId]);
      assert.deepEqual(after.rows,before.rows,'month-end planning creates no deposit application, charge or billing pause');assert.deepEqual(settlementWrites,[]);
      await page.reload();await page.getByRole('button',{name:'Move-out & settlement',exact:true}).click();
      await expect(page.getByRole('button',{name:'Prepare settlement',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Prepare settlement',exact:true}).click();
      await page.getByLabel('Move-out date',{exact:true}).fill(fixture.manifest.today);
      await page.getByLabel('Reason shown to the tenant',{exact:true}).fill('Actual move-out review');
      await page.getByRole('button',{name:'Continue',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Forwarding details',exact:true})).toBeVisible();assert.deepEqual(settlementWrites,[]);
    }finally{await browser.close();}
    await ok('platform','POST',`${base}/${built.id}/teardown`,{expectedVersion:1});
  });

});
