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
import { seedTenantCapacity } from './tenant-capacity-fixture.mjs';

const root = new URL('../', import.meta.url);
const docker = (...args) => execFileSync('docker', args, {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const canonicalTenantRead = query => /^WITH contacts AS MATERIALIZED\s*\(\s*SELECT c\.id,c\."userId",c\.name,c\.email,c\.phone,c\.status,c\.version\s+FROM "ResidentContact" c WHERE c\."companyId"=\$\d+\s*\), members AS MATERIALIZED\s*\(/.test(query);
export async function performanceFixture(options = {}) {
  assert.ok(options && typeof options === 'object' && !Array.isArray(options));
  assert.ok(Object.keys(options).every(key => ['maintenanceScale','tenantScale'].includes(key)), 'No target or database options are accepted');
  const maintenanceCapacity = options.maintenanceScale !== undefined, tenantCapacity = options.tenantScale !== undefined;
  assert.ok(!(maintenanceCapacity&&tenantCapacity),'Choose one fixed synthetic dataset');
  if (maintenanceCapacity) assert.ok([1000, 10000, 50000].includes(options.maintenanceScale), 'Only fixed synthetic maintenance scales are permitted');
  if (tenantCapacity) assert.ok([1000, 2000, 2001].includes(options.tenantScale), 'Only fixed synthetic tenant scales are permitted');
  const capacity = maintenanceCapacity||tenantCapacity;
  let capture = null, responseCompleted, markResponseCompleted, lastApplicationFailure=null;
  const beginQueryCapture = () => { assert.equal(capture, null); capture = []; responseCompleted=new Promise(resolve=>markResponseCompleted=resolve); };
  const endQueryCapture = async () => {
    // onResponse usage recording is part of the real request's database work.
    // The final hook below runs after it, so counts do not spill into a sample.
    let responseTimeout;
    try {await Promise.race([responseCompleted,new Promise((_,reject)=>{responseTimeout=setTimeout(()=>reject(new Error('Fixture response hooks timed out')),5000);})]);}
    finally {clearTimeout(responseTimeout);}
    assert.ok(capture); const queries = capture; capture = null;
    return { count: queries.length, databaseMs: queries.reduce((sum, row) => sum + row.duration, 0),
      commits:queries.filter(row=>/^\s*COMMIT\b/i.test(row.query)).length,rollbacks:queries.filter(row=>/^\s*ROLLBACK\b/i.test(row.query)).length,
      maintenanceQueries: queries.filter(row => /FROM\s+(?:"public"\.)?"MaintenanceRequest"/.test(row.query)),
      tenantQueries:queries.flatMap(row=>{
        const table=row.query.match(/FROM\s+(?:"public"\.)?"(ResidentContact|CompanyMembership|LeaseParticipant|Lease|Invitation)"/)?.[1];
        const area={ResidentContact:'contacts',CompanyMembership:'members',LeaseParticipant:'participants',Lease:'leases',Invitation:'invitations'}[table];
        return area?[{...row,area}]:[];
      }) };
  };
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
    pool=new pg.Pool({connectionString:runtime.href,max:8}); db=new PrismaClient({adapter:new PrismaPg(pool), ...(capacity ? {log:[{emit:'event',level:'query'}]} : {})});
    if (capacity) db.$on('query', event => { if (capture) capture.push({ query:event.query, params:event.params, duration:event.duration }); });
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
    let capacityExpectations;
    if (maintenanceCapacity) {
      await admin.query('DELETE FROM "MaintenanceRequest" WHERE "companyId"=\'perf-company\'');
      await admin.query(`UPDATE "Company" SET timezone='America/New_York' WHERE id='perf-company';
        UPDATE "Property" SET name='Capacity property sentinel' WHERE id='perf-property-20';
        UPDATE "Unit" SET label='Capacity unit sentinel' WHERE id='perf-unit-200';
        UPDATE "CompanyMembership" SET "maintenanceExecution"=true,"staffPropertyScope"='all' WHERE "userId"='perf-staff'`);
      await admin.query(`WITH source AS (
        SELECT n,((n-1)%200)+1 resident,(((n-1)/200)+((n-1)%200)*7+9)%10 bucket,
          (n*3+(n-1)/200)%10 priority_bucket,((n-1)/7)%4 due_bucket
        FROM generate_series(1,$1::int) n
      ), rows AS (
        SELECT *,CASE WHEN bucket<7 THEN 'resolved' WHEN bucket<9 THEN 'open' ELSE 'in_progress' END state FROM source
      ) INSERT INTO "MaintenanceRequest"(id,"companyId","propertyId","unitId","requesterId",title,description,priority,status,"targetOn","assigneeId","executionStatus","createdAt","updatedAt")
      SELECT 'capacity-request-'||lpad(n::text,6,'0'),'perf-company','perf-property-'||((resident-1)/10+1),'perf-unit-'||resident,'perf-resident-'||resident,
        'Fictional capacity repair '||lpad(n::text,6,'0'),
        CASE WHEN n%100=0 THEN left(repeat('Fictional capacity fixture text. ',140),3900) ELSE repeat('Fictional capacity fixture. ',8) END || CASE WHEN n%997=0 THEN ' capacity-description-sentinel' ELSE '' END,
        CASE WHEN priority_bucket<2 THEN 'high' WHEN priority_bucket<8 THEN 'normal' ELSE 'low' END,state,
        CASE due_bucket WHEN 0 THEN NULL WHEN 1 THEN (NOW() AT TIME ZONE 'America/New_York')::date-5 WHEN 2 THEN (NOW() AT TIME ZONE 'America/New_York')::date ELSE (NOW() AT TIME ZONE 'America/New_York')::date+5 END,
        CASE WHEN n%4=0 THEN 'perf-staff' ELSE NULL END,
        CASE WHEN n%4<>0 THEN 'unassigned' WHEN state='resolved' THEN 'complete' WHEN state='open' THEN 'assigned' WHEN n%8=0 THEN 'pending_review' ELSE 'accepted' END,
        '2026-01-01'::timestamp+((n-1)/20)*interval '1 minute','2026-01-01'::timestamp+((n-1)/20)*interval '1 minute'
      FROM rows`, [options.maintenanceScale]);
      await admin.query('ANALYZE');
      capacityExpectations = Object.fromEntries(['all','unresolved','property_unresolved','description_search','property_search','unit_search','due_overdue','assignee','resident_all'].map(key => [key,{total:0,statusCounts:{open:0,in_progress:0,resolved:0}}]));
      for (let n=1;n<=options.maintenanceScale;n++) {
        const resident=(n-1)%200+1, property=Math.floor((resident-1)/10)+1,
          bucket=(Math.floor((n-1)/200)+((n-1)%200)*7+9)%10,
          state=bucket<7?'resolved':bucket<9?'open':'in_progress', dueBucket=Math.floor((n-1)/7)%4;
        const matches={all:true,unresolved:state!=='resolved',property_unresolved:property===1&&state!=='resolved',description_search:n%997===0,property_search:property===20,unit_search:resident===200,due_overdue:dueBucket===1&&state!=='resolved',assignee:n%4===0,resident_all:resident===1};
        for (const [key,match] of Object.entries(matches)) if(match) {capacityExpectations[key].total++;capacityExpectations[key].statusCounts[state]++;}
      }
    }
    const tenantFixture=tenantCapacity?await seedTenantCapacity(admin,options.tenantScale):null;
    const provider=await fixtureIdentities(admin);
    app=Fastify({logger:false});
    app.setErrorHandler((error,request,reply)=>{
      if(capacity) lastApplicationFailure={name:/^[A-Za-z][A-Za-z0-9]{0,80}$/.test(error.name||'')?error.name:'Error',code:/^[A-Z0-9_]{1,40}$/.test(error.code||'')?error.code:'UNCLASSIFIED',
        ...(/^[A-Za-z][A-Za-z0-9]{0,80}$/.test(error.cause?.kind||'')?{kind:error.cause.kind}:{}),
        ...(/^[A-Z0-9]{5}$/.test(error.cause?.originalCode||'')?{sqlState:error.cause.originalCode}:{})};
      return reply.code(error instanceof AccessError?error.statusCode:503).send({error:'Isolated performance request failed.',code:error instanceof AccessError?error.code:'PERFORMANCE_FAILURE'});
    });
    // Bind before registration to obtain a unique origin. Fastify registers routes before ready/listen.
    const {createServer}=await import('node:net');const {once}=await import('node:events');
    const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
    const origin=`http://127.0.0.1:${port}`;
    const auth=await registerSessions(app,db,{origin,domain:'unused.auth0.com',clientId:'test-only',clientSecret:'unused',secure:false});
    registerApplication(app,db,auth,origin,provider);
    if (capacity) app.addHook('onResponse',async()=>{markResponseCompleted?.();markResponseCompleted=null;});
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
    const countTables=['User','Lease','ResidentContact','LedgerEntry','RentCharge','RentAllocation','DepositAccount','MaintenanceRequest',...(tenantCapacity?['CompanyMembership','ResidentPropertyAssignment','LeaseParticipant','Invitation','Identity','Property','Unit']:[])];
    const counts=async()=>Object.fromEntries(await Promise.all(countTables.map(async table=>{
      const order=tenantCapacity?'row_to_json(t)::text':'id';
      const {rows}=await admin.query(`SELECT count(*)::int n,md5(string_agg(row_to_json(t)::text,'' ORDER BY ${order})) fingerprint FROM "${table}" t`);return [table,rows[0]];
    })));
    const clientFingerprint=createHash('sha256').update(await readFile(join(build,'index.html'))).digest('hex').slice(0,16);
    const explainMaintenance = async queries => {
      assert.ok(capacity && queries.length, 'Capture a maintenance query first');
      const client=await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        await client.query("SELECT set_config('app.company_id','perf-company',true)");
        const role=(await client.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
        assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
        const plans=[];
        for (const query of queries) {
          // Only the application's captured tenant canonical read may start
          // with WITH. It still runs under this restricted READ ONLY session.
          assert.ok(/^SELECT\s/i.test(query.query) ||
            tenantCapacity && canonicalTenantRead(query.query),
            'Only captured source reads may be explained');
          const result=await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+query.query,JSON.parse(query.params));
          plans.push(result.rows[0]['QUERY PLAN'][0]);
        }
        return plans;
      } finally {await client.query('ROLLBACK');client.release();}
    };
    const compareTenantDedup = async (queries,variant='qualified') => {
      assert.ok(tenantCapacity && options.tenantScale===2000 && Array.isArray(queries) && queries.length>0 && queries.length<=12);
      assert.ok(['qualified','unqualified'].includes(variant));
      const originalWinner='SELECT r.*,row_number() OVER(PARTITION BY person_kind,person_id,lease_id ORDER BY precedence,link_created,link_id COLLATE "C") AS choice\n    FROM resolved r WHERE person_id IS NOT NULL';
      const distinctWinner='SELECT DISTINCT ON(person_kind,person_id,lease_id) r.*,1::bigint AS choice\n    FROM resolved r WHERE person_id IS NOT NULL\n    ORDER BY person_kind,person_id,lease_id,precedence,link_created,link_id COLLATE "C"';
      const client=await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout='30s'");
        await client.query("SELECT set_config('app.company_id','perf-company',true)");
        const role=(await client.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
        assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
        const compared=[];
        for(const query of queries) {
          assert.ok(canonicalTenantRead(query.query));
          assert.equal(query.query.split(originalWinner).length,2,'Exactly the captured winner selection may change');
          let candidate=query.query.replace(originalWinner,distinctWinner);
          if(variant==='unqualified') {
            const qualifier='FROM ranked r WHERE choice=1';
            assert.equal(candidate.split(qualifier).length,2,'Exactly the redundant synthetic-choice qualifier may be removed');
            candidate=candidate.replace(qualifier,'FROM ranked r');
          }
          const params=JSON.parse(query.params);
          assert.ok(Array.isArray(params));
          const equality=(await client.query(`SELECT
            (SELECT count(*)::int FROM ((${query.query}) EXCEPT ALL (${candidate})) d) AS original_only,
            (SELECT count(*)::int FROM ((${candidate}) EXCEPT ALL (${query.query})) d) AS candidate_only`,params)).rows[0];
          assert.equal(equality.original_only,0);assert.equal(equality.candidate_only,0);
          const original=await client.query(query.query,params),changed=await client.query(candidate,params);
          // Compare ordered complete projections as well as multiset equality.
          // Raw results/SQL/parameters never leave this owned fixture method.
          assert.deepEqual(changed.rows,original.rows);
          const plans=[];
          for(const sql of [query.query,candidate]) plans.push((await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,params)).rows[0]['QUERY PLAN'][0]);
          compared.push({equal:true,orderedEqual:true,projectedRows:original.rows.length,originalOnly:0,candidateOnly:0,plans});
        }
        return {runtimeRls:true,readOnly:true,comparisons:compared};
      } finally {await client.query('ROLLBACK');client.release();}
    };
    const verifyBuiltinSha256=async()=>{
      const values=['auth0|fictional.user+tag@example.invalid','exact/subject:?#@[]_-','名e\u0301🙂','x'.repeat(4092)+'🙂'];
      assert.equal(Math.max(...values.map(value=>Buffer.byteLength(value))),4096);
      const client=await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        const role=(await client.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
        assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
        for(const value of values) {
          const actual=(await client.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') AS hash",[value])).rows[0].hash;
          assert.equal(actual,createHash('sha256').update(value,'utf8').digest('hex'));
        }
        return {available:true,nodeCompatible:true,cases:values.length,maxUtf8Bytes:4096,runtimeRls:true};
      } finally {await client.query('ROLLBACK');client.release();}
    };
    return {origin,sessions,close,counts,clientFingerprint,dataset:tenantFixture?.dataset??{properties:20,units:200,tenants:200,leases:200,...(maintenanceCapacity?{maintenanceRequests:options.maintenanceScale}:{})},root:fileURLToPath(root),
      verifyBuiltinSha256,
      transactionState:async()=>(await pool.query("SELECT count(*)::int AS idle_transactions FROM pg_stat_activity WHERE usename=current_user AND state='idle in transaction' AND pid<>pg_backend_pid()")).rows[0],
      ...(capacity?{beginQueryCapture,endQueryCapture,explainMaintenance,capacityExpectations,applicationFailure:()=>lastApplicationFailure}:{}),
      ...(tenantFixture?{tenantExpectations:tenantFixture.expectations,prepareTenantUnionLimit:tenantFixture.prepareUnionLimit,
        compareTenantDedup,
        explainTenants:async queries=>(await explainMaintenance(queries)).map((plan,index)=>({area:queries[index].area,plan}))}:{})};
  } catch(error) {await close();throw error;}
}
