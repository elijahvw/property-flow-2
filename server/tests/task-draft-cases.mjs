import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function taskDraftCases(t,admin,call,db){
 const base='/api/company/task-drafts';
 await admin.query(`INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") VALUES('draft-unit','a','home','Draft unit','owner','draft-unit','fixture',NOW())`);
 await admin.query(`INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentId","createdById","startsOn","endsOn","rentCents",status,"submissionKey","submissionHash","updatedAt") VALUES('draft-source','a','home','draft-unit','resident','owner','2026-01-01','2026-12-31',100000,'active','draft-source','fixture',NOW())`);
 const make=(patch={})=>({kind:'lease_create',propertyId:'home',values:{unitId:'draft-unit',residentId:'resident',startsOn:'',monthlyRent:'1250.',paymentInstructions:'Private fictional draft text'},context:{leaseListQ:'Draft',leaseListProperty:'home'},submissionKey:randomUUID(),...patch});
 const ok=async(...args)=>{const response=await call(...args);assert.equal(response.statusCode,200,response.body);return response.json();};
 let row;
 await t.test('only author with fresh management/company/source authority can access saved tasks',async()=>{
  for(const role of ['staff','resident','platform'])for(const method of ['GET','POST'])assert.equal((await call(role,method,base,method==='POST'?make():undefined)).statusCode,403);
  for(const headers of [{origin:'https://evil.test'},{'x-csrf-token':'bad'},{'x-company-id':'b'}])assert.equal((await call('owner','POST',base,make(),headers)).statusCode,403);
  assert.equal((await call('owner','POST',base,make({propertyId:'foreign-home'}))).statusCode,404);
  assert.equal((await call('owner','POST',base,make({values:{unitId:'foreign-unit'}}))).statusCode,404);
  row=await ok('owner','POST',base,make());
  for(const other of ['manager','foreign'])assert.equal((await call(other,'GET',base+'/'+row.id)).statusCode,404);
  assert.equal((await ok('manager','GET',base)).items.some(item=>item.id===row.id),false);
  await admin.query(`UPDATE "CompanyMembership" SET role='staff' WHERE "userId"='owner'`);
  try{assert.equal((await call('owner','GET',base+'/'+row.id)).statusCode,403);}finally{await admin.query(`UPDATE "CompanyMembership" SET role='owner' WHERE "userId"='owner'`);}
 });
 await t.test('typed task payload rejects secrets, arbitrary URLs, files and pending finance jobs',async()=>{
  for(const payload of [make({kind:'rent_payment'}),make({values:{...make().values,accessToken:'private'}}),make({context:{returnTo:'https://evil.test'}}),make({values:{file:{contentBase64:'private'}}}),make({values:{notes:'unregistered'}}),make({values:{startsOn:'x'.repeat(201)}})])assert.equal((await call('owner','POST',base,payload)).statusCode,400);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE detail::text LIKE '%Private fictional draft text%'`)).rows[0].n,0);
 });
 await t.test('create and update retries retain one task/action key; stale versions never overwrite',async()=>{
  const payload=make(),results=await Promise.all([call('owner','POST',base,payload),call('owner','POST',base,payload)]);
  for(const result of results)assert.equal(result.statusCode,200,result.body);
  const first=results[0].json();assert.equal(results[1].json().id,first.id);
  assert.equal((await call('owner','POST',base,{...payload,values:{...payload.values,monthlyRent:'999'}})).statusCode,409);
  const update={values:{...payload.values,monthlyRent:'1300.00'},context:payload.context,expectedVersion:first.version,submissionKey:randomUUID()};
  const changed=await ok('owner','PATCH',base+'/'+first.id,update),replay=await ok('owner','PATCH',base+'/'+first.id,update);
  assert.equal(changed.version,2);assert.equal(replay.version,2);assert.equal(changed.actionKey,first.actionKey);
  assert.equal((await call('owner','PATCH',base+'/'+first.id,{...update,submissionKey:randomUUID()})).statusCode,409);
  assert.equal((await call('owner','PATCH',base+'/'+first.id,{...update,values:{monthlyRent:'different'}})).statusCode,409);
  assert.equal((await ok('owner','GET',base+'/'+first.id)).values.monthlyRent,'1300.00');
 });
 await t.test('source changes are reported until explicitly reviewed; draft saves never commit work',async()=>{
  const before=(await admin.query(`SELECT (SELECT count(*) FROM "Lease")::int leases,(SELECT count(*) FROM "RentCharge")::int charges,(SELECT count(*) FROM "LedgerEntry")::int money`)).rows[0];
  assert.equal((await ok('owner','GET',base+'/'+row.id)).stale,false);
  await admin.query(`UPDATE "Property" SET name='Draft renamed home',version=version+1 WHERE id='home'`);
  assert.equal((await ok('owner','GET',base+'/'+row.id)).stale,true);
  const saved=await ok('owner','PATCH',base+'/'+row.id,{values:row.values,context:row.context,expectedVersion:row.version,submissionKey:randomUUID()});assert.equal(saved.stale,true);
  row=await ok('owner','PATCH',base+'/'+row.id,{values:row.values,context:row.context,expectedVersion:saved.version,submissionKey:randomUUID(),reviewSources:true});assert.equal(row.stale,false);
  assert.deepEqual((await admin.query(`SELECT (SELECT count(*) FROM "Lease")::int leases,(SELECT count(*) FROM "RentCharge")::int charges,(SELECT count(*) FROM "LedgerEntry")::int money`)).rows[0],before);
 });
 await t.test('renewal and inspection text drafts keep current source IDs and reject foreign/extra evidence data',async()=>{
  const renewal=await ok('owner','POST',base,make({kind:'lease_renewal',sourceId:'draft-source',values:{startsOn:'2027-01-01',monthlyRent:'1400.00'}}));
  assert.equal(renewal.sourceVersions.lease.id,'draft-source');
  const inspection=make({kind:'inspection',sourceId:'draft-source',values:{leaseId:'draft-source',kind:'move_in',inspectedOn:'',items:[{key:randomUUID(),area:'Kitchen',item:'Sink',condition:'good',notes:'Unfinished fictional observation'}]}});
  const draft=await ok('owner','POST',base,inspection);assert.equal(draft.values.items[0].notes,'Unfinished fictional observation');
  assert.equal((await call('owner','POST',base,{...inspection,submissionKey:randomUUID(),values:{...inspection.values,items:[{...inspection.values.items[0],evidenceVersionIds:['private-original']}]}})).statusCode,400);
  assert.equal((await call('owner','POST',base,{...inspection,submissionKey:randomUUID(),sourceId:'different-lease'})).statusCode,400);
 });
 await t.test('RLS requires both company and personal task context; deletion preserves sources and checks version',async()=>{
  await db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;assert.equal(await tx.taskDraft.count(),0);await tx.$queryRaw`SELECT set_config('app.task_draft_user_id','manager',true)`;assert.equal(await tx.taskDraft.count(),0);await tx.$queryRaw`SELECT set_config('app.task_draft_user_id','owner',true)`;assert.ok(await tx.taskDraft.count()>0);});
  assert.equal((await call('owner','DELETE',base+'/'+row.id,{expectedVersion:1})).statusCode,409);
  await ok('owner','DELETE',base+'/'+row.id,{expectedVersion:row.version});
  await ok('owner','DELETE',base+'/'+row.id,{expectedVersion:row.version});
  assert.equal((await call('owner','GET',base+'/'+row.id)).statusCode,404);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "Unit" WHERE id='draft-unit'`)).rows[0].n,1);
 });
 await t.test('expired tasks return no values and are physically cleared on the next owner save',async()=>{
  await admin.query(`INSERT INTO "TaskDraft"(id,"companyId","userId","propertyId",kind,"sourceVersions",values,context,title,"actionKey","submissionKey","submissionHash","createdAt","updatedAt","expiresAt") VALUES('expired-draft','a','owner','home','lease_create','{}','{}','{}','Expired fictional task',$1,$2,'fixture',NOW()-INTERVAL '40 days',NOW()-INTERVAL '40 days',NOW()-INTERVAL '1 day')`,[randomUUID(),randomUUID()]);
  assert.equal((await call('owner','GET',base+'/expired-draft')).statusCode,404);
  assert.equal((await ok('owner','GET',base)).items.some(item=>item.id==='expired-draft'),false);
  await ok('owner','POST',base,make());assert.equal((await admin.query(`SELECT count(*)::int n FROM "TaskDraft" WHERE id='expired-draft'`)).rows[0].n,0);
 });
}
