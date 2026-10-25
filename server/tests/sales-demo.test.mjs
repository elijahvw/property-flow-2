import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { registerApplication } from '../dist/application.js';
import { registerSessions, digest } from '../dist/sessions.js';
import { registerRequestErrors } from '../dist/request-errors.js';
import { AccessError } from '../dist/access.js';
import { chromium, expect } from '@playwright/test';
import { newFixturePage } from './browser-fixture.mjs';
import { DEMO_BUNDLED_TEXT, DEMO_FEATURE_COVERAGE } from '../dist/sales-demo-scenarios.js';
import { FEATURE_CATALOG } from '../dist/company-features.js';

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
  const remote=new Map(),passwords=new Map();let normalCalls=0,created=0,ensureCalls=0,blockCalls=0,loseIdentity=false,failBlock=false,pauseEnsure=null;
  const unavailable=async()=>{normalCalls++;throw Error('Unexpected ordinary identity operation');};
  const provider={issuer:'https://unused.auth0.com/',databaseConnection:'test',get:unavailable,create:unavailable,rename:unavailable,verify:unavailable,setup:unavailable,list:unavailable,salesDemo:{
    async ensure(account){
      ensureCalls++;if(pauseEnsure)await pauseEnsure;
      if(!remote.has(account.email)){remote.set(account.email,{user_id:'auth0|demo-'+randomUUID(),email:account.email,name:account.name,email_verified:true,blocked:false});passwords.set(account.email,account.password);created++;}
      if(loseIdentity){loseIdentity=false;throw new AccessError(503,'DEMO_IDENTITY_RETRY','Retry setup');}
      return {...remote.get(account.email)};
    },
    async block(account,subject,beforeBlock){blockCalls++;if(failBlock){failBlock=false;throw Error('Provider temporarily unavailable');}const found=remote.get(account.email);if(found){if(subject)assert.equal(found.user_id,subject);await beforeBlock?.(found);found.blocked=true;}}
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
        former:await tx.residentContact.findUniqueOrThrow({where:{id:s.formerContactId}}),ended:await tx.lease.findUniqueOrThrow({where:{id:s.endedLeaseId}}),
        invite:await tx.invitation.findUniqueOrThrow({where:{id:s.invitationId}}),prorations:await tx.leaseProration.count({where:{leaseId:s.offlineLeaseId}}),
        settlement:await tx.leaseSettlement.findFirstOrThrow({where:{leaseId:s.endedLeaseId}}),refund:await tx.leaseMovement.findFirstOrThrow({where:{leaseId:s.endedLeaseId,kind:'deposit_refund'},include:{cashEntries:true}}),
        baseline:await tx.leaseInspection.findUniqueOrThrow({where:{id:s.baselineInspectionId}}),moveOut:await tx.leaseInspection.findUniqueOrThrow({where:{id:s.moveOutInspectionId}}),
        agreement:await tx.leaseAgreement.findUniqueOrThrow({where:{id:s.reviewedAgreementId}}),shared:await tx.leaseDocumentShare.findUniqueOrThrow({where:{id:s.receivedShareId}}),
        files:await tx.documentVersion.findMany(),archivedDoc:await tx.privateDocument.findUniqueOrThrow({where:{id:s.archivedDocumentId}}),archivedUnit:await tx.unit.findUniqueOrThrow({where:{id:s.archivedUnitId}}),
        voided:await tx.ledgerEntry.findUniqueOrThrow({where:{id:s.voidedExpenseId}}),schedule:await tx.rentSchedule.findUniqueOrThrow({where:{id:s.pausedScheduleId}}),
        imports:await tx.unitImportBatch.findMany(),expenses:await tx.expenseImportBatch.findMany(),applications:await tx.rentalApplication.findMany(),
      };
    });
    assert.equal(facts.offline.userId,users.offline.user_id);assert.equal(facts.offlineLease.residentContactId,facts.offline.id);assert.equal(facts.offlineLease.status,'active');
    assert.equal(facts.invite.acceptedAt,null);assert.equal(facts.invite.revokedAt,null);assert.equal(facts.invite.deliveryStatus,'not_requested');
    assert.equal(facts.former.status,'archived');assert.equal(facts.ended.status,'ended');assert.equal(facts.prorations,1);
    assert.equal(facts.refund.cashEntries.length,1);assert.equal(facts.refund.cashEntries[0].amountCents,facts.refund.amountCents);assert.equal(facts.refund.cashEntries[0].movementId,facts.refund.id);assert.equal(facts.refund.leaseId,facts.ended.id);
    assert.equal(facts.baseline.status,'completed');assert.equal(facts.moveOut.status,'awaiting_review');assert.ok(facts.moveOut.baselineRevisionId);
    assert.equal(facts.agreement.status,'reviewed');assert.ok(facts.shared.receivedAt);assert.equal(facts.shared.userId,users.resident.user_id);
    assert.ok(facts.files.some(f=>f.scanStatus==='pending'));assert.ok(facts.files.filter(f=>f.scanStatus==='clean').every(f=>Buffer.from(f.content).equals(Buffer.from(DEMO_BUNDLED_TEXT))));
    assert.ok(facts.archivedDoc.archivedAt);assert.equal(facts.archivedUnit.status,'archived');assert.ok(facts.voided.voidedAt);assert.equal(facts.schedule.status,'paused');
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
  await t.test('teardown is atomic locally, blocks generated Auth0 users, retries and preserves history',async()=>{
    assert.equal((await call('platform','POST',`${base}/${sheet.id}/teardown`,{expectedVersion:99})).statusCode,409);
    await admin.query(`CREATE FUNCTION reject_demo_retirement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sales_demo.retired' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_demo_retirement BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_demo_retirement()`);
    try{assert.equal((await call('platform','POST',`${base}/${sheet.id}/teardown`,{expectedVersion:1})).statusCode,503);}finally{await admin.query('DROP TRIGGER reject_demo_retirement ON "AuditEvent"; DROP FUNCTION reject_demo_retirement()');}
    assert.equal((await current(sheet.id)).status,'ready');
    failBlock=true;assert.equal((await call('platform','POST',`${base}/${sheet.id}/teardown`,{expectedVersion:1})).statusCode,503);
    const setup=await db.salesDemoSetup.findUniqueOrThrow({where:{id:sheet.id}});assert.equal(setup.status,'retiring');
    for(const account of Object.values(setup.accounts)){assert.equal((await db.user.findUniqueOrThrow({where:{id:account.user_id}})).status,'disabled');assert.equal((await call(account.user_id,'GET','/api/bootstrap')).statusCode,401);}
    assert.equal((await call('platform','POST',`${base}/${sheet.id}/credentials`,{})).statusCode,409);
    await ok('platform','POST',`${base}/${sheet.id}/teardown`,{expectedVersion:2});
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
    await ok('platform','POST',`${base}/${pending.id}/teardown`,{expectedVersion:1});
    for(const [email,row]of remote)if(email.includes(pending.id))assert.equal(row.blocked,true);
  });
  await t.test('an ambiguous identity transferred outside the demo is never blocked by cleanup',async()=>{
    loseIdentity=true;assert.equal((await call('platform','POST',base,{submissionKey:randomUUID()})).statusCode,503);
    const pending=(await ok('platform','GET',base)).setups[0],account=[...remote.values()].find(u=>u.email.includes(pending.id));
    await admin.query(`INSERT INTO "User"(id,email,"emailVerified","updatedAt") VALUES($1,$2,true,NOW());`,[account.user_id,account.email]);
    await db.companyMembership.create({data:{userId:account.user_id,companyId:'customer-company',role:'manager'}});
    assert.equal((await call('platform','POST',`${base}/${pending.id}/teardown`,{expectedVersion:1})).statusCode,409);
    assert.equal(remote.get(account.email).blocked,false);assert.equal((await db.user.findUniqueOrThrow({where:{id:account.user_id}})).status,'active');
    await db.companyMembership.delete({where:{userId:account.user_id}});
    await ok('platform','POST',`${base}/${pending.id}/teardown`,{expectedVersion:1});assert.equal(remote.get(account.email).blocked,true);
  });
  await t.test('legacy teardown preserves its pre-existing presenter identity',async()=>{
    await admin.query(`INSERT INTO "User"(id,email,"emailVerified","updatedAt") VALUES('legacy-owner','legacy@test.invalid',true,NOW()); INSERT INTO "Company"(id,name,"updatedAt") VALUES('legacy-company','Legacy demo',NOW()); INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES('legacy-owner','legacy-company','owner',NOW()); INSERT INTO "SalesDemo"(id,"companyId","ownerId","createdById","submissionKey","submissionHash","seedVersion",manifest) VALUES('legacy-demo','legacy-company','legacy-owner','platform','legacy','legacy',1,'{}')`);
    const before=blockCalls;await ok('platform','POST',`${base}/legacy-demo/teardown`,{expectedVersion:1});assert.equal(blockCalls,before);assert.equal((await db.user.findUniqueOrThrow({where:{id:'legacy-owner'}})).status,'active');assert.equal(await db.companyMembership.findUnique({where:{userId:'legacy-owner'}}),null);
  });
  await t.test('browser builds without account setup, recovers credentials after response loss and tears down', {skip:!process.env.TEST_SALES_DEMO_BROWSER_URL},async()=>{
    const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
    try{
      const page=await newFixturePage(browser);let lose=true;const keys=[];
      await page.route('**/api/**',async route=>{
        const req=route.request(),u=new URL(req.url()),r=await call('platform',req.method(),u.pathname+u.search,req.postDataJSON()||undefined);
        if(req.method()==='POST'&&u.pathname===base){keys.push(req.postDataJSON().submissionKey);assert.equal(r.statusCode,200,r.body);if(lose){lose=false;return route.abort('failed');}}
        await route.fulfill({status:r.statusCode,contentType:'application/json',body:r.body});
      });
      await page.goto(process.env.TEST_SALES_DEMO_BROWSER_URL+'/platform/companies');await page.getByRole('button',{name:'Manage sales demos',exact:true}).click();
      await expect(page.getByLabel('Dedicated demo account')).toHaveCount(0);
      await page.getByRole('button',{name:'Build sales demo',exact:true}).click();await expect(page.getByRole('alert').first()).toBeVisible();
      await page.getByRole('button',{name:'Build sales demo',exact:true}).click();
      const logins=page.getByRole('region',{name:'Demo login credentials',exact:true});await expect(logins).toBeVisible({timeout:15000});assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
      await expect(logins.getByLabel('Oak & Elm · DEMO Owner password')).toHaveAttribute('type','password');await page.getByRole('button',{name:'Show passwords',exact:true}).click();await expect(logins.getByLabel('Oak & Elm · DEMO Owner password')).toHaveAttribute('type','text');
      const email=await logins.getByLabel('Oak & Elm · DEMO Owner email').inputValue();await page.reload();await page.getByRole('button',{name:'Manage sales demos',exact:true}).click();await expect(page.getByRole('region',{name:'Demo login credentials'})).toHaveCount(0);
      const row=page.getByRole('listitem').filter({hasText:email});await row.getByRole('button',{name:'View role logins',exact:true}).click();await expect(page.getByRole('region',{name:'Demo login credentials'})).toBeVisible();
      await row.getByRole('button',{name:'Tear down demo',exact:true}).click();await row.getByRole('button',{name:'Confirm teardown',exact:true}).click();await expect(page.getByRole('region',{name:'Demo login credentials'})).toHaveCount(0);await expect(row).toContainText('Torn down');
    }finally{await browser.close();}
  });
});
