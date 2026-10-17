// Test-only. Creates its own empty tmpfs database; accepts no target/database URL.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { registerApplication } from '../server/dist/application.js';
import { registerSessions, digest } from '../server/dist/sessions.js';
import { AccessError } from '../server/dist/access.js';
import { fixtureIdentities } from '../server/tests/fixture-identities.mjs';

const root = new URL('../', import.meta.url);
const docker = (...args) => execFileSync('docker', args, {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
export async function performanceFixture() {
  let container, admin, pool, db, app, build;
  const close = async () => {
    try {await app?.close();}
    finally {
      await Promise.allSettled([db?.$disconnect(),pool?.end(),admin?.end()]);
      try {if(container) {docker('rm','--force',container);container=null;}}
      finally {if(build)await rm(build,{recursive:true,force:true});}
    }
  };
  try {
    build=await mkdtemp(join(tmpdir(),'pf-performance-client-'));
    // Snapshot assets so another local build cannot change a run mid-measurement.
    const source=process.env.PF_PERFORMANCE_CLIENT_BUILD || fileURLToPath(new URL('client/dist/',root));
    assert.ok(source.endsWith('/client/dist')||source.endsWith('/client/dist/'),'Only a production client/dist build can be selected');
    await cp(source,build,{recursive:true});
    const image=docker('image','inspect','postgres:17-alpine','--format','{{.Id}}'), password=randomUUID();
    container=docker('run','--detach','--pull','never','--name',`pf-performance-${randomUUID()}`,
      '--tmpfs','/var/lib/postgresql/data:rw','--publish','127.0.0.1::5432',
      '--env',`POSTGRES_PASSWORD=${password}`,'--env','POSTGRES_DB=propertyflow_performance_test',image);
    const [info]=JSON.parse(docker('inspect',container));
    assert.equal(info.Mounts.length,0); assert.equal(info.HostConfig.Tmpfs['/var/lib/postgresql/data'],'rw');
    const [binding]=info.NetworkSettings.Ports['5432/tcp']; assert.equal(binding.HostIp,'127.0.0.1');
    for(let i=0;;i++) {
      try {docker('exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'); break;} catch {assert.ok(i<150,'PostgreSQL startup timeout'); await new Promise(r=>setTimeout(r,100));}
    }
    const url=`postgresql://postgres:${password}@127.0.0.1:${binding.HostPort}/propertyflow_performance_test`;
    admin=new pg.Pool({connectionString:url});
    assert.equal((await admin.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`)).rows[0].n,0);
    for(const name of (await readdir(new URL('server/prisma/migrations/',root))).filter(n=>/^\d/.test(n)).sort())
      await admin.query(await readFile(new URL(`server/prisma/migrations/${name}/migration.sql`,root),'utf8'));
    await admin.query(`ALTER ROLE propertyflow_runtime LOGIN PASSWORD '${password}'`);
    const runtime=new URL(url); runtime.username='propertyflow_runtime';
    pool=new pg.Pool({connectionString:runtime.href,max:8}); db=new PrismaClient({adapter:new PrismaPg(pool)});
    await admin.query(`
      INSERT INTO "Company"(id,name,"updatedAt") VALUES('perf-company','Performance fixtures',NOW()),('perf-foreign','Other test company',NOW());
      INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES('perf-owner','owner@performance.invalid','Performance Owner',true,NOW()),('perf-staff','staff@performance.invalid','Performance Staff',true,NOW());
      INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") SELECT 'perf-resident-'||i,'resident-'||i||'@performance.invalid','Test Tenant '||lpad(i::text,3,'0'),true,NOW() FROM generate_series(1,200) i;
      INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") SELECT id,'perf-company',CASE WHEN id='perf-owner' THEN 'owner' WHEN id='perf-staff' THEN 'staff' ELSE 'resident' END,NOW() FROM "User";
      INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") SELECT 'perf-property-'||i,'Test Property '||lpad(i::text,2,'0'),'Fixture Street','Test City','TS','00000','perf-company',NOW() FROM generate_series(1,20) i;
      INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") SELECT 'perf-unit-'||i,'perf-company','perf-property-'||((i-1)/10+1),'Unit '||i,'perf-owner','unit-'||i,'fixture',NOW() FROM generate_series(1,200) i;
      INSERT INTO "ResidentContact"(id,"companyId","userId",name,email,"updatedAt") SELECT 'perf-contact-'||i,'perf-company','perf-resident-'||i,'Test Tenant '||lpad(i::text,3,'0'),'resident-'||i||'@performance.invalid',NOW() FROM generate_series(1,200) i;
      INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") SELECT 'perf-company','perf-property-'||((i-1)/10+1),'perf-resident-'||i FROM generate_series(1,200) i;
      INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentId","residentContactId","createdById","submissionKey","submissionHash","startsOn","endsOn","rentCents",status,"updatedAt") SELECT 'perf-lease-'||i,'perf-company','perf-property-'||((i-1)/10+1),'perf-unit-'||i,'perf-resident-'||i,'perf-contact-'||i,'perf-owner','lease-'||i,'fixture',CURRENT_DATE-90,CURRENT_DATE+275,125000,'active',NOW() FROM generate_series(1,200) i;
      INSERT INTO "LeaseParticipant"(id,"companyId","propertyId","leaseId","userId","contactId",role,name,"startsOn","portalApproved","createdById","submissionKey","submissionHash","updatedAt") SELECT 'perf-participant-'||i,'perf-company','perf-property-'||((i-1)/10+1),'perf-lease-'||i,'perf-resident-'||i,'perf-contact-'||i,'leaseholder','Test Tenant '||lpad(i::text,3,'0'),CURRENT_DATE-90,true,'perf-owner','participant-'||i,'fixture',NOW() FROM generate_series(1,200) i;
      INSERT INTO "RentCharge"(id,"companyId","propertyId","leaseId","createdById","submissionKey","submissionHash","periodOn","dueOn","amountCents") SELECT 'perf-charge-'||i,'perf-company','perf-property-'||((i-1)/10+1),'perf-lease-'||i,'perf-owner','charge-'||i,'fixture',date_trunc('month',CURRENT_DATE)::date,date_trunc('month',CURRENT_DATE)::date,125000 FROM generate_series(1,200) i;
      INSERT INTO "LedgerEntry"(id,"companyId","propertyId","leaseId","createdById","submissionKey","submissionHash","occurredOn","amountCents",kind,category) SELECT 'perf-entry-'||i,'perf-company','perf-property-'||((i-1)/10+1),'perf-lease-'||i,'perf-owner','entry-'||i,'fixture',CURRENT_DATE,100000,'income','rent' FROM generate_series(1,200) i;
      INSERT INTO "RentAllocation"(id,"companyId","propertyId","leaseId","chargeId","entryId","amountCents") SELECT 'perf-allocation-'||i,'perf-company','perf-property-'||((i-1)/10+1),'perf-lease-'||i,'perf-charge-'||i,'perf-entry-'||i,100000 FROM generate_series(1,200) i;
      INSERT INTO "DepositAccount"(id,"companyId","propertyId","leaseId","createdById","submissionKey","submissionHash","requiredCents","dueOn") SELECT 'perf-deposit-'||i,'perf-company','perf-property-'||((i-1)/10+1),'perf-lease-'||i,'perf-owner','deposit-'||i,'fixture',125000,CURRENT_DATE-90 FROM generate_series(1,200) i;
      INSERT INTO "DepositRevision"(id,"companyId","accountId","createdById","submissionKey","submissionHash",version,"requiredCents","dueOn",reason) SELECT 'perf-deposit-revision-'||i,'perf-company','perf-deposit-'||i,'perf-owner','revision-'||i,'fixture',1,125000,CURRENT_DATE-90,'Initial fixture requirement' FROM generate_series(1,200) i;
      INSERT INTO "MaintenanceRequest"(id,"companyId","propertyId","unitId","requesterId",title,description,"updatedAt") SELECT 'perf-request-'||i,'perf-company','perf-property-'||((i-1)/10+1),'perf-unit-'||i,'perf-resident-'||i,'Test repair '||i,'Fictional performance fixture.',NOW() FROM generate_series(1,100) i;
    `);
    const provider=await fixtureIdentities(admin);
    app=Fastify({logger:false});
    app.setErrorHandler((error,request,reply)=>reply.code(error instanceof AccessError?error.statusCode:503).send({error:'Isolated performance request failed.',code:error instanceof AccessError?error.code:'PERFORMANCE_FAILURE'}));
    // Bind before registration to obtain a unique origin. Fastify registers routes before ready/listen.
    const {createServer}=await import('node:net');const {once}=await import('node:events');
    const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
    const origin=`http://127.0.0.1:${port}`;
    const auth=await registerSessions(app,db,{origin,domain:'unused.auth0.com',clientId:'test-only',clientSecret:'unused',secure:false});
    registerApplication(app,db,auth,origin,provider);
    const sessions={};
    for(const role of ['owner','staff','resident']) {
      const token=randomUUID(),csrf=randomUUID();sessions[role]={token,csrf};
      await db.session.create({data:{tokenHash:digest(token),csrfToken:csrf,userId:role==='resident'?'perf-resident-1':`perf-${role}`,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
    }
    // Serve the production build. Never proxy into or reuse the user's Vite preview.
    app.get('/*',async(request,reply)=>{
      const path=new URL(request.url,origin).pathname;
      if(path.startsWith('/api/'))return reply.code(404).send({error:'Unknown API'});
      const asset=path.startsWith('/assets/') && /^\/assets\/[A-Za-z0-9_.-]+$/.test(path);
      const file=join(build,asset?path.slice(1):'index.html');
      try {reply.type(asset?(path.endsWith('.js')?'application/javascript':'text/css'):'text/html');return await readFile(file);} catch {return reply.code(404).send();}
    });
    await app.listen({host:'127.0.0.1',port});
    const counts=async()=>Object.fromEntries(await Promise.all(['User','Lease','ResidentContact','LedgerEntry','RentCharge','RentAllocation','DepositAccount','MaintenanceRequest'].map(async table=>{
      const {rows}=await admin.query(`SELECT count(*)::int n,md5(string_agg(row_to_json(t)::text,'' ORDER BY id)) fingerprint FROM "${table}" t`);return [table,rows[0]];
    })));
    const clientFingerprint=createHash('sha256').update(await readFile(join(build,'index.html'))).digest('hex').slice(0,16);
    return {origin,sessions,close,counts,clientFingerprint,dataset:{properties:20,units:200,tenants:200,leases:200},root:fileURLToPath(root)};
  } catch(error) {await close();throw error;}
}
