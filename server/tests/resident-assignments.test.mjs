import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerApplication, assignmentId, opaqueUserId, MAX_USER_ID_BYTES, serializable } from '../dist/application.js';
import { permissions } from '../dist/access.js';
const person = (id, role = 'resident', companyId = 'a') => ({ id, email: `${id}@test.invalid`, name: id, status: 'active', emailVerified: true, platformRole: null, membership: {userId:id, companyId, role, status:'active', version:1, company:{id:companyId,status:'active'}} });
async function fixture(t, actor = person('owner','owner')) {
  const users = new Map([actor,person('resident'),person('other'),person('foreign','resident','b'),person('staff','staff')].map(u=>[u.id,u]));
  const rows = [], locks = [], audits = [], contacts = []; let company;
  const properties = [{id:'home',companyId:'a',name:'Home',address:'1 Main',city:'private'}, {id:'foreign-home',companyId:'b',name:'Foreign',address:'2 Main'}];
  const tx = {
    $queryRaw: async (strings,...values) => { if(strings.join('').includes('UPDATE')) locks.push(values[0]); else company=values[0]; return []; },
    user: {findUnique:async({where})=>users.get(where.id), update:async({where,data})=>Object.assign(users.get(where.id),data)},
    company: {findUnique:async({where})=>({id:where.id,status:'active'})},
    residentContact: {
      findUnique:async({where})=>contacts.find(c=>c.companyId===where.companyId_userId.companyId&&c.userId===where.companyId_userId.userId),
      create:async({data})=>{assert.equal(company,data.companyId);const row={id:'contact-'+contacts.length,...data};contacts.push(row);return row;},
      update:async({where,data})=>Object.assign(contacts.find(c=>c.id===where.id),data),
    },
    companyMembership: {
      updateMany:async({where,data})=>{const member=users.get(where.userId)?.membership;if(member?.companyId!==where.companyId)return {count:0};Object.assign(member,data);return {count:1};},
      findFirst:async({where})=>{const u=users.get(where.userId);return u?.membership?.companyId===where.companyId&&(!where.role||u.membership.role===where.role)?{...u.membership,user:u}:null;},
      findUnique:async({where})=>{const u=users.get(where.userId); return u?.membership ? {...u.membership,user:u}:null;},
      findMany:async({where})=>[...users.values()].filter(u=>u.membership?.companyId===where.companyId && u.membership.role==='resident' && u.membership.status==='active' && u.status==='active').map(u=>({userId:u.id,user:{name:u.name,email:u.email}})),
      update:async({where,data})=>{const member=users.get(where.userId).membership;return Object.assign(member,{role:data.role,status:data.status,version:member.version+1});},
      upsert:async({where,update})=>{const member=users.get(where.userId).membership;return Object.assign(member,{companyId:update.companyId,role:update.role,status:update.status,version:member.version+1});},
    },
    property:{findFirst:async({where})=>properties.find(p=>p.id===where.id&&p.companyId===where.companyId&&company===p.companyId)},
    staffPropertyAccess:{deleteMany:async({where})=>{assert.equal(company,where.companyId);return {count:0};}},
    residentPropertyAssignment:{
      upsert:async({create})=>{ assert.equal(company,create.companyId); if(!rows.some(r=>r.propertyId===create.propertyId&&r.userId===create.userId)) rows.push(create); return create; },
      deleteMany:async({where})=>{assert.equal(company,where.companyId); for(let i=rows.length-1;i>=0;i--) if(rows[i].companyId===where.companyId&&rows[i].userId===where.userId&&(!where.propertyId||rows[i].propertyId===where.propertyId)) rows.splice(i,1); return {count:1};},
      findMany:async({where,select})=>rows.filter(r=>r.companyId===company&&r.companyId===where.companyId&&(!where.userId||r.userId===where.userId)&&(!where.propertyId||r.propertyId===where.propertyId)).map(r=>select.property?{property:Object.fromEntries(Object.entries(properties.find(p=>p.id===r.propertyId)).filter(([k])=>['id','name','address'].includes(k)))}:{userId:r.userId}),
    },
    auditEvent:{create:async({data})=>audits.push(data)},
  };
  const db={$transaction:async(run,options)=>{assert.equal(options.isolationLevel,'Serializable'); return run(tx);}};
  const app=Fastify({routerOptions:{maxParamLength:MAX_USER_ID_BYTES}}); t.after(()=>app.close());
  registerApplication(app,db,async request=>{request.principal=actor;},'https://example.test');
  const call=(method,url,payload,headers={})=>{
    if(payload&&!Object.hasOwn(payload,'expectedVersion')&&(url.endsWith('/membership')||url.startsWith('/api/company/members/'))){const userId=decodeURIComponent(url.split('/').at(url.endsWith('/membership')?-2:-1));payload={...payload,expectedVersion:users.get(userId)?.membership?.version??null};}
    return app.inject({method,url,headers,...(payload?{payload}:{})});};
  return {call,users,rows,locks,audits,actor,contacts};
}
test('assignment permission belongs only to active company owners/managers',()=>{
 for(const role of ['owner','manager','staff','resident',null]) assert.equal(permissions(person('u',role)).includes('resident.assignment.manage'),['owner','manager'].includes(role));
 const p=person('p');p.membership=null;p.platformRole='owner'; assert.deepEqual(permissions(p),['platform.manage']);
});
test('property identifiers retain their existing bounded grammar',()=>{
 for(const id of ['auth0|abc','google-oauth2|123','home']) assert.equal(assignmentId(id),id);
 for(const id of ['', ' a','a/b','a?b','a'.repeat(201),null]) assert.throws(()=>assignmentId(id),/identifier/);
});
test('forbidden roles, forged company and invalid IDs fail before database access',async t=>{
 for(const [role,url,headers,status] of [['resident','/api/company/residents',{},403],['staff','/api/company/properties/home/residents',{},403],['owner','/api/company/residents',{'x-company-id':'b'},403],['owner','/api/company/properties/bad%20id/residents',{},400]]) {
  const f=await fixture(t,person('actor',role)); assert.equal((await f.call('GET',url,undefined,headers)).statusCode,status);
 }
 const p=person('platform');p.membership=null;p.platformRole='owner';const f=await fixture(t,p); assert.equal((await f.call('GET','/api/company/residents')).statusCode,403);
});
test('assign/remove are idempotent; foreign and missing IDs have consistent 404; same-company ineligible returns 409',async t=>{
 const f=await fixture(t,person('manager','manager'));
 assert.deepEqual((await f.call('GET','/api/company/residents')).json().map(x=>x.userId),['resident','other']);
 for(const [property,user,status] of [['foreign-home','resident',404],['missing','resident',404],['home','foreign',404],['home','pending-invite',404],['home','staff',409]]) assert.equal((await f.call('PUT',`/api/company/properties/${property}/residents/${user}`)).statusCode,status);
 for(let i=0;i<2;i++) assert.equal((await f.call('PUT','/api/company/properties/home/residents/resident')).statusCode,200);
 assert.equal(f.rows.length,1);assert.ok(f.locks.includes('resident'));assert.equal(f.audits.length,2);
 for(let i=0;i<2;i++) assert.equal((await f.call('DELETE','/api/company/properties/home/residents/resident')).statusCode,200);
 assert.equal(f.rows.length,0);
 for(const change of [u=>u.status='disabled',u=>u.membership.status='disabled',u=>u.membership.company.status='suspended']) { const u=f.users.get('resident'); change(u); assert.equal((await f.call('PUT','/api/company/properties/home/residents/resident')).statusCode,409);u.status='active';u.membership.status='active';u.membership.company.status='active'; }
});
test('resident self route filters same-company residents and returns only id/name/address',async t=>{
 const f=await fixture(t,person('resident'));f.rows.push({companyId:'a',propertyId:'home',userId:'resident'},{companyId:'a',propertyId:'home',userId:'other'});
 assert.deepEqual((await f.call('GET','/api/resident/properties?userId=other')).json(),[{id:'home',name:'Home',address:'1 Main'}]);
 assert.equal((await f.call('GET','/api/resident/properties',undefined,{'x-company-id':'b'})).statusCode,403);
 f.rows.shift();assert.deepEqual((await f.call('GET','/api/resident/properties')).json(),[]);
 f.actor.membership.status='disabled';assert.equal((await f.call('GET','/api/resident/properties')).statusCode,403);
});
test('company and platform lifecycle mutations lock and clear assignments; reactivation does not restore them',async t=>{
 for(const [platform,path,body] of [[false,'/api/company/members/resident',{role:'resident',status:'disabled'}],[false,'/api/company/members/resident',{role:'staff',status:'active'}],[true,'/api/platform/users/resident/status',{status:'disabled'}],[true,'/api/platform/users/resident/membership',{companyId:'b',role:'resident',status:'active'}],[true,'/api/platform/users/resident/membership',{companyId:'a',role:'manager',status:'active'}]]) {
  const actor=person('owner','owner');if(platform)actor.platformRole='owner';const f=await fixture(t,actor);f.rows.push({companyId:'a',propertyId:'home',userId:'resident'});
  assert.equal((await f.call(path.endsWith('membership')?'PUT':'PATCH',path,body)).statusCode,200);assert.equal(f.rows.length,0);assert.deepEqual(f.locks,['owner','resident']);
  if(!platform) { assert.equal((await f.call('PATCH',path,{role:'resident',status:'active'})).statusCode,200);assert.equal(f.rows.length,0); }
 }
});
test('serialization failures retry boundedly and expose actionable 409 after exhaustion',async()=>{
 let tries=0; const db={$transaction:async()=>{tries++;if(tries<3)throw {code:'P2034'};return 'ok';}};assert.equal(await serializable(db,()=>{}),'ok');assert.equal(tries,3);
 tries=0;await assert.rejects(serializable({$transaction:async()=>{tries++;throw {code:'P2034'};}},()=>{}),e=>e.statusCode===409);assert.equal(tries,5);
 for (const code of ['40001','40P01']) { let rawTries=0; assert.equal(await serializable({$transaction:async()=>{if (++rawTries===1) throw {code:'P2010',meta:{code}};return 'ok';}},()=>{}),'ok');assert.equal(rawTries,2); }
 await assert.rejects(serializable({$transaction:async()=>{throw new Error('other');}},()=>{}),/other/);
});

test('ownership transfer removes former resident associations under the shared lock',async t=>{
 const f=await fixture(t);f.rows.push({companyId:'a',propertyId:'home',userId:'resident'});
 assert.equal((await f.call('POST','/api/company/transfer-ownership',{userId:'resident'})).statusCode,200);assert.equal(f.rows.length,0);assert.deepEqual(f.locks,['owner','resident']);
 assert.equal(f.contacts.length,1);assert.equal(f.contacts[0].userId,'resident');assert.equal(f.contacts[0].companyId,'a');
});

const opaqueSubjects = ['auth0|abc+def', 'auth0|' + 'x'.repeat(240), 'samlp|directory|!@£$%^&*()+}{:;|P9/opaque?#%', 'oidc|provider|CaseSensitive'];
test('opaque subjects round-trip verbatim; only empty, NUL and oversized user IDs are invalid',()=>{
 for(const id of [...opaqueSubjects,' auth0|preserve ']) assert.equal(opaqueUserId(id),id);
 for(const id of ['',null,undefined,42,'abc\0def','a'.repeat(MAX_USER_ID_BYTES+1),'£'.repeat(MAX_USER_ID_BYTES)]) assert.throws(()=>opaqueUserId(id),/user identifier/);
});
test('eligible opaque IDs including plus, long and external provider subjects can be assigned and removed',async t=>{
 const f=await fixture(t);
 for(const id of opaqueSubjects) {
  f.users.set(id,person(id));
  assert.ok((await f.call('GET','/api/company/residents')).json().some(row=>row.userId===id));
  const path=`/api/company/properties/home/residents/${encodeURIComponent(id)}`;
  assert.equal((await f.call('PUT',path)).statusCode,200,id);
  assert.ok(f.rows.some(row=>row.userId===id));assert.equal(f.locks.at(-1),id);
  assert.equal((await f.call('DELETE',path)).statusCode,200,id);assert.equal(f.rows.length,0);assert.equal(f.audits.at(-1).targetId,id);
 }
 assert.equal((await f.call('PUT','/api/company/properties/home/residents/%00')).statusCode,400);
 assert.equal((await f.call('PUT','/api/company/properties/home/residents/')).statusCode,400);
});
test('access lifecycle and ownership routes preserve opaque user IDs',async t=>{
 for(const id of opaqueSubjects) {
  const actor=person('owner','owner');actor.platformRole='owner';const f=await fixture(t,actor);f.users.set(id,person(id));
  const path=`/api/platform/users/${encodeURIComponent(id)}/membership`;
  assert.equal((await f.call('PUT',path,{companyId:'a',role:'resident',status:'active'})).statusCode,200,id);
  assert.equal((await f.call('PATCH',`/api/platform/users/${encodeURIComponent(id)}/status`,{status:'active'})).statusCode,200,id);
  assert.equal((await f.call('PATCH',`/api/company/members/${encodeURIComponent(id)}`,{role:'resident',status:'active'})).statusCode,200,id);
  assert.equal((await f.call('POST','/api/company/transfer-ownership',{userId:id})).statusCode,200,id);
 }
 const f=await fixture(t);assert.equal((await f.call('POST','/api/company/transfer-ownership',{userId:''})).statusCode,400);
});
