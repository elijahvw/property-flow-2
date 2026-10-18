import assert from 'node:assert/strict';
export async function workspaceGuideCases(t,db,call){
 const ok=r=>{assert.equal(r.statusCode,200,r.body);return r.json();};
 await t.test('role guidance exposes real destinations without granting authority',async()=>{
  for(const [actor,path,forbidden] of [['owner','/company/leases','/platform/users'],['manager','/company/leases','/company/members'],['resident','/resident','/company/rent'],['staff','/company/properties','/company/rent'],['platform','/platform/companies','/company/properties']]){
   const guide=ok(await call(actor,'GET','/api/account/guide'));assert.equal(guide.eligible,true);assert.ok(guide.steps.some(step=>step.path===path));assert.ok(!guide.steps.some(step=>step.path===forbidden));
  }
 });
 await t.test('progress is private, versioned, idempotent and preserved across account reloads',async()=>{
  const before=ok(await call('owner','GET','/api/account/guide')),body={guideKey:before.guideKey,expectedVersion:before.version,step:before.steps[1].id,status:'in_progress'};
  const saved=ok(await call('owner','PUT','/api/account/guide',body));assert.equal(saved.version,before.version+1);assert.equal(saved.step,body.step);
  assert.equal(ok(await call('owner','PUT','/api/account/guide',body)).version,saved.version);
  assert.equal(ok(await call('owner','GET','/api/account/guide')).step,body.step);
  assert.equal((await call('owner','PUT','/api/account/guide',{...body,step:before.steps[2].id})).statusCode,409);
  const other=ok(await call('manager','GET','/api/account/guide'));assert.equal(other.status,'new');
  assert.equal((await call('manager','PUT','/api/account/guide',{...body,guideKey:before.guideKey})).statusCode,409);
  assert.equal((await call('resident','PUT','/api/account/guide',{...body,userId:'owner'})).statusCode,400);
  assert.equal((await db.companyMembership.findUniqueOrThrow({where:{userId:'resident'}})).role,'resident');
 });
}
