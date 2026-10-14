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
import {synchronizeIdentity} from '../dist/identity-sync.js';
const url=process.env.TEST_USERS_DATABASE_URL;
test('pre-login identity setup, boundaries and verification',{skip:!url},async t=>{
 const target=new URL(url);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.pathname,'/propertyflow_users_test');assert.equal(process.env.USERS_DISPOSABLE,'tmpfs-verified');
 const admin=new pg.Pool({connectionString:url});t.after(()=>admin.end());
 assert.equal((await admin.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`)).rows[0].n,0);
 for(const name of readdirSync(new URL('../prisma/migrations/',import.meta.url)).filter(n=>/^\d/.test(n)).sort())await admin.query(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`,import.meta.url),'utf8'));
 await admin.query(`ALTER ROLE propertyflow_runtime LOGIN PASSWORD 'users-test-only'`);
 const runtime=new URL(url);runtime.username='propertyflow_runtime';runtime.password='users-test-only';
 const pool=new pg.Pool({connectionString:runtime.href,max:8}),db=new PrismaClient({adapter:new PrismaPg(pool)});t.after(async()=>{await db.$disconnect();await pool.end();});
 for(const id of ['a','b'])await admin.query(`INSERT INTO "Company"(id,name,"updatedAt") VALUES($1,$1,NOW())`,[id]);
 for(const [id,company,role,platform] of [['owner','a','owner',null],['manager','a','manager',null],['staff','a','staff',null],['resident','a','resident',null],['resident2','a','resident',null],['foreign','b','owner',null],['foreign-resident','b','resident',null],['platform',null,null,'owner']]){
  await admin.query(`INSERT INTO "User"(id,email,"emailVerified","platformRole","updatedAt") VALUES($1,$2,true,$3,NOW())`,[id,`${id}@test.invalid`,platform]);
  if(company)await admin.query(`INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,$2,$3,NOW())`,[id,company,role]);
  await db.session.create({data:{tokenHash:digest(`token-${id}`),csrfToken:'csrf',userId:id,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
 }
 for(const [id,company] of [['home','a'],['other-home','a'],['foreign-home','b']])await admin.query(`INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES($1,$1,'street','city','state','zip',$2,NOW())`,[id,company]);
 await admin.query(`INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','resident'),('a','home','resident2'),('b','foreign-home','foreign-resident')`);
 const remote=new Map();let createCalls=0,verificationCalls=0,setupCalls=0;let providerError=false;
 const provider={issuer:'https://unused.auth0.com/',async list(page,email){return {users:[...remote.values()].filter(u=>!email||u.email===email).slice(page*50,page*50+50),nextPage:null};},async get(id){if(providerError)throw Error('provider unavailable');const row=remote.get(id);if(!row)throw Error('provider missing');return {...row};},async create(email,name){createCalls++;let row=[...remote.values()].find(u=>u.email===email);if(!row){row={user_id:'auth0|'+randomUUID(),email,email_verified:false,name,identities:[{connection:'Username-Password-Authentication',provider:'auth0'}]};remote.set(row.user_id,row);}return {...row};},async verify(){verificationCalls++;},async setup(){setupCalls++;}};
 const app=Fastify();t.after(()=>app.close());const auth=await registerSessions(app,db,{origin:'https://app.test',domain:'unused.auth0.com',clientId:'test',clientSecret:'test-only',secure:true});registerApplication(app,db,auth,'https://app.test',provider);
 const call=(user,method,path,payload,extra={})=>app.inject({method,url:path,headers:{...(user?{cookie:`__Host-pf-session=token-${user}`} : {}),origin:'https://app.test','x-csrf-token':'csrf',...extra},...(payload?{payload}:{})});
 const directory='/api/platform/identity-users',identity={user_id:'auth0|prelogin',email:'prelogin@test.invalid',email_verified:false,name:'Prelogin',identities:[{connection:'Username-Password-Authentication',provider:'auth0'}]};remote.set(identity.user_id,identity);
 await t.test('platform-only identity directory and batch setup before first login',async()=>{
  for(const actor of ['owner','manager','staff','resident']){assert.equal((await call(actor,'GET',directory)).statusCode,403);assert.equal((await call(actor,'POST',directory+'/import',{userIds:[identity.user_id]})).statusCode,403);}
  assert.equal((await call('platform','GET',directory)).json().users.length,1);
  for(const extra of [{origin:'https://evil.test'},{'x-csrf-token':'bad'}])assert.equal((await call('platform','POST',directory+'/import',{userIds:[identity.user_id]},extra)).statusCode,403);
  const result=await call('platform','POST',directory+'/import',{userIds:[identity.user_id]});assert.equal(result.statusCode,200,result.body);assert.equal(result.json().items[0].emailVerified,false);
  const local=await db.user.findUnique({where:{id:identity.user_id},include:{identities:true}});assert.equal(local.firstSignedInAt,null);assert.equal(local.platformRole,null);assert.equal(local.identities[0].issuer,provider.issuer);assert.equal(local.identities[0].subject,identity.user_id);assert.ok(local.accessInitializedAt);
  assert.equal((await call('platform','PUT',`/api/platform/users/${encodeURIComponent(identity.user_id)}/membership`,{companyId:'a',role:'manager',status:'active'})).statusCode,200);
  assert.equal((await db.companyMembership.findUnique({where:{userId:identity.user_id}})).role,'manager');
  await call('platform','POST',directory+'/import',{userIds:[identity.user_id]});assert.equal((await db.companyMembership.findUnique({where:{userId:identity.user_id}})).role,'manager');assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='user.preprovisioned' AND "targetId"=$1`,[identity.user_id])).rows[0].n,1);
 });
 await t.test('preconfigured unverified account has profile and verification flow, but no protected API access',async()=>{
  await db.session.create({data:{tokenHash:digest('token-prelogin'),csrfToken:'csrf',userId:identity.user_id,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
  const bootstrap=await call('prelogin','GET','/api/bootstrap');assert.equal(bootstrap.statusCode,200);assert.equal(bootstrap.json().user.emailVerified,false);assert.equal(bootstrap.json().membership.role,'manager');
  for(const path of ['/api/company/properties','/api/company/leases','/api/company/finances'])assert.equal((await call('prelogin','GET',path)).statusCode,403);
  assert.equal((await call('prelogin','POST','/api/account/verification',{})).statusCode,200);assert.equal(verificationCalls,1);assert.equal((await call('prelogin','POST','/api/account/verification',{})).statusCode,429);
  assert.equal((await call('prelogin','POST','/api/account/verification-status',{})).json().emailVerified,false);
  identity.email_verified=true;const updated=await call('prelogin','POST','/api/account/verification-status',{});assert.equal(updated.statusCode,200,updated.body);assert.equal(updated.json().emailVerified,true);assert.equal((await call('prelogin','GET','/api/company/properties')).statusCode,200);
  assert.equal((await call('platform','GET','/api/platform/users')).json().find(u=>u.id===identity.user_id).emailVerified,true);
 });
 await t.test('creation durable key replay and mismatch, exact identity reuse and blocked status preservation',async()=>{
  const body={email:'new@test.invalid',name:'New User',submissionKey:randomUUID()},path='/api/platform/users/provision';
  const first=await call('platform','POST',path,body);assert.equal(first.statusCode,200,first.body);const row=first.json();assert.equal(row.platformRole,null);assert.equal(row.emailVerified,false);assert.equal(verificationCalls,1);assert.equal(setupCalls,0);
  const replay=await call('platform','POST',path,body);assert.equal(replay.json().id,row.id);assert.equal(createCalls,1);
  assert.equal((await call('platform','POST',path,{...body,name:'Changed'})).statusCode,409);assert.equal(createCalls,1);
  await db.user.update({where:{id:row.id},data:{status:'disabled'}});assert.equal((await call('platform','POST',path,{...body,submissionKey:randomUUID()})).json().status,'disabled');
  assert.equal((await call('platform','POST',`/api/platform/users/${encodeURIComponent(row.id)}/password-setup`,{})).statusCode,200);assert.equal(setupCalls,1);assert.equal((await call('platform','POST',`/api/platform/users/${encodeURIComponent(row.id)}/password-setup`,{})).statusCode,429);
 });
 await t.test('audit failure rolls back imported account; email collision never links a different subject',async()=>{
  const candidate={...identity,user_id:'auth0|rollback',email:'rollback@test.invalid'};remote.set(candidate.user_id,candidate);
  await admin.query(`CREATE FUNCTION reject_setup_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='user.preprovisioned' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END$$; CREATE TRIGGER reject_setup_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_setup_audit()`);
  assert.equal((await call('platform','POST',directory+'/import',{userIds:[candidate.user_id]})).statusCode,500);assert.equal(await db.user.findUnique({where:{id:candidate.user_id}}),null);
  await admin.query(`DROP TRIGGER reject_setup_audit ON "AuditEvent";DROP FUNCTION reject_setup_audit()`);assert.equal((await call('platform','POST',directory+'/import',{userIds:[candidate.user_id]})).statusCode,200);
  const duplicate={...identity,user_id:'google-oauth2|different'};remote.set(duplicate.user_id,duplicate);assert.notEqual((await call('platform','POST',directory+'/import',{userIds:[duplicate.user_id]})).statusCode,200);assert.equal(await db.identity.findUnique({where:{issuer_subject:{issuer:provider.issuer,subject:duplicate.user_id}}}),null);
 });
 await t.test('first callback retains preconfigured membership, exact identity and local disabled status',async()=>{
  const before=await db.user.findUnique({where:{id:identity.user_id}});assert.equal(before.firstSignedInAt,null);
  const result=await db.$transaction(tx=>synchronizeIdentity(tx,provider.issuer,{sub:identity.user_id,email:identity.email,email_verified:true,name:'Provider name','https://propertyflow.com/roles':['admin']}));assert.equal(result.user.id,identity.user_id);assert.equal(result.user.platformRole,null);assert.ok(result.user.firstSignedInAt);assert.equal((await db.companyMembership.findUnique({where:{userId:identity.user_id}})).role,'manager');
  await assert.rejects(db.$transaction(tx=>synchronizeIdentity(tx,'https://different.auth0.com/',{sub:identity.user_id,email:identity.email,email_verified:true})),/issuer mismatch/);
  await db.user.update({where:{id:identity.user_id},data:{status:'disabled'}});const disabled=await db.$transaction(tx=>synchronizeIdentity(tx,provider.issuer,{sub:identity.user_id,email:identity.email,email_verified:true}));assert.equal(disabled.user.status,'disabled');await db.user.update({where:{id:identity.user_id},data:{status:'active'}});
 });
 await t.test('unverified session can log out and switch accounts',async()=>{
  await db.user.update({where:{id:identity.user_id},data:{emailVerified:false}});const result=await call('prelogin','POST','/api/auth/logout',{});assert.equal(result.statusCode,200,result.body);assert.equal(await db.session.findUnique({where:{tokenHash:digest('token-prelogin')}}),null);assert.match(result.headers['set-cookie'],/Expires=Thu, 01 Jan 1970/);await db.user.update({where:{id:identity.user_id},data:{emailVerified:true}});
 });
 await t.test('directory/config failures and revoked actor do not mutate local accounts',async()=>{
  const noProvider=Fastify();const authMissing=await registerSessions(noProvider,db,{origin:'https://app.test',domain:'unused.auth0.com',clientId:'test',clientSecret:'test-only',secure:true});registerApplication(noProvider,db,authMissing,'https://app.test');try{const result=await noProvider.inject({url:directory,headers:{cookie:'__Host-pf-session=token-platform'}});assert.equal(result.statusCode,503);assert.equal(result.json().code,'IDENTITY_NOT_CONFIGURED');}finally{await noProvider.close();}
  const target={...identity,user_id:'auth0|revoked',email:'revoked@test.invalid'};remote.set(target.user_id,target);
  const original=provider.get;provider.get=async id=>{await db.user.update({where:{id:'platform'},data:{platformRole:null}});return original(id);};assert.equal((await call('platform','POST',directory+'/import',{userIds:[target.user_id]})).statusCode,403);assert.equal(await db.user.findUnique({where:{id:target.user_id}}),null);provider.get=original;await db.user.update({where:{id:'platform'},data:{platformRole:'owner'}});
 });
 await t.test('verification downgrade wins over queued operational and maintenance authorization',async()=>{
  const operations=[['manager','/api/company/finances',{propertyId:'home',occurredOn:'2026-10-14',amount:'1.00',kind:'income',category:'rent',memo:null,submissionKey:randomUUID()}],['resident','/api/resident/maintenance',{propertyId:'home',title:'Verification race',description:'Must not be saved',priority:'normal',submissionKey:randomUUID()}]];
  for(const [actor,path,body] of operations){const leader=await admin.connect();let pending;const count=(await admin.query(`SELECT count(*)::int n FROM "AuditEvent"`)).rows[0].n;
   try{await leader.query('BEGIN');await leader.query(`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=$1`,[actor]);pending=call(actor,'POST',path,body);let blocked=false;for(let i=0;i<100;i++){if((await admin.query(`SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%User%'`)).rows.length){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(blocked,path);await leader.query(`UPDATE "User" SET "emailVerified"=false WHERE id=$1`,[actor]);await leader.query('COMMIT');assert.equal((await pending).statusCode,403,path);assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent"`)).rows[0].n,count);
   }finally{await leader.query('ROLLBACK');leader.release();if(pending)await pending;await admin.query(`UPDATE "User" SET "emailVerified"=true WHERE id=$1`,[actor]);}
  }
 });
 await t.test('real browser can add an Auth0 account without any target-user sign-in',{skip:!process.env.TEST_USERS_BROWSER_URL},async()=>{
  const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url());const response=await app.inject({method:req.method(),url:u.pathname+u.search,headers:{...req.headers(),origin:'https://app.test',cookie:'__Host-pf-session=token-platform'},...(req.postData()?{payload:req.postData()}:{})});await route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});});
   const candidate={...identity,user_id:'auth0|browser',email:'browser@test.invalid',name:'Browser Before Login',email_verified:false};remote.set(candidate.user_id,candidate);
   await page.goto(process.env.TEST_USERS_BROWSER_URL+'/platform/users');await page.getByLabel('Exact email (optional)').fill(candidate.email);await page.getByRole('button',{name:'Find sign-in accounts',exact:true}).click();await page.getByRole('button',{name:'Add all accounts on this page'}).click();await expect(page.getByRole('row').filter({hasText:candidate.email})).toContainText('Awaiting first sign-in');const local=await db.user.findUnique({where:{id:candidate.user_id}});assert.equal(local.firstSignedInAt,null);
  }finally{await browser.close();}
 });
});
