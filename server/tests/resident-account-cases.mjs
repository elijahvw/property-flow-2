import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest} from '../dist/sessions.js';
import {synchronizeIdentity} from '../dist/identity-sync.js';
export async function residentAccountCases(t,db,admin,call,provider,remote,counts){
 const ok=r=>{assert.equal(r.statusCode,200,r.body);return r.json();};
 const root='/api/company/resident-contacts';
 const person=ok(await call('owner','POST',root,{name:'Prepared Resident',email:'prepared-resident@test.invalid',submissionKey:randomUUID()}));
 const unit=ok(await call('owner','POST','/api/company/properties/home/units',{label:'Prepared account unit',submissionKey:randomUUID()}));
 const leaseBody={propertyId:'home',unitId:unit.id,residentContactId:person.id,startsOn:'2026-10-01',endsOn:'2027-09-30',monthlyRent:'1000',status:'draft',submissionKey:randomUUID()};
 let lease,accountId,invitation;
 await t.test('a tenant with a prepared account is selectable for a lease before portal activation',async()=>{
  assert.ok(person.userId,'saving the tenant prepared its account');
  const before=counts().create;
  const choices=ok(await call('owner','GET','/api/company/properties/home/residents?includeContacts=true'));
  assert.ok(choices.some(c=>c.contactId===person.id && c.userId===person.userId));
  assert.equal(await db.companyMembership.findUnique({where:{userId:person.userId}}),null);
  assert.equal(counts().create,before,'loading the picker never provisions another account');
  await admin.query(`UPDATE "User" SET status='disabled' WHERE id=$1`,[person.userId]);
  assert.ok(!ok(await call('owner','GET','/api/company/properties/home/residents?includeContacts=true')).some(c=>c.contactId===person.id));
  await admin.query(`UPDATE "User" SET status='active' WHERE id=$1`,[person.userId]);
 });
 await t.test('saving a lease prepares Auth0 and its local mirror before first sign-in without granting portal access',async()=>{
  lease=ok(await call('owner','POST','/api/company/leases',leaseBody));
  const contact=(await admin.query('SELECT * FROM "ResidentContact" WHERE id=$1',[person.id])).rows[0];accountId=contact.userId;
  assert.ok(remote.has(accountId));assert.equal(contact.userId,accountId);
  const local=await db.user.findUniqueOrThrow({where:{id:accountId},include:{identities:true,membership:true}});
  assert.equal(local.identities[0].subject,accountId);assert.equal(local.firstSignedInAt,null);assert.equal(local.membership,null);
  const household=ok(await call('owner','GET','/api/company/leases/'+lease.id+'/participants'));
  assert.ok(household.contacts.some(c=>c.id===person.id),'accounts awaiting first sign-in remain selectable');
  const before=counts().create;assert.equal(ok(await call('owner','POST','/api/company/leases',leaseBody)).id,lease.id);assert.equal(counts().create,before);
 });
 await t.test('draft activation and edits use the prepared tenant without granting portal access',async()=>{
  const update={startsOn:leaseBody.startsOn,endsOn:leaseBody.endsOn,monthlyRent:leaseBody.monthlyRent,status:'active',expectedVersion:lease.version};
  lease=ok(await call('owner','PATCH','/api/company/leases/'+lease.id,update));
  assert.equal(lease.status,'active');
  assert.equal(await db.companyMembership.findUnique({where:{userId:accountId}}),null);
  assert.equal((await admin.query('SELECT count(*)::int n FROM "ResidentPropertyAssignment" WHERE "userId"=$1',[accountId])).rows[0].n,0);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:accountId}})).firstSignedInAt,null);
  await admin.query(`UPDATE "User" SET status='disabled' WHERE id=$1`,[accountId]);
  try {
   const blocked=await call('owner','PATCH','/api/company/leases/'+lease.id,{...update,monthlyRent:'1100',expectedVersion:lease.version});
   assert.equal(blocked.statusCode,409);assert.equal(blocked.json().code,'RESIDENT_INELIGIBLE');
   assert.equal((await admin.query('SELECT "rentCents" FROM "Lease" WHERE id=$1 AND "companyId"=$2',[lease.id,'a'])).rows[0].rentCents,100000);
  } finally { await admin.query(`UPDATE "User" SET status='active' WHERE id=$1`,[accountId]); }
 });
 await t.test('editing the current tenant name updates the same Auth0 account and local mirror',async()=>{
  const current=ok(await call('owner','GET',root+'/'+person.id));
  const before=counts().create;
  const changed=ok(await call('owner','PATCH',root+'/'+person.id,{name:'Prepared Resident Updated',email:person.email,status:'active',expectedVersion:current.version}));
  assert.equal(changed.userId,accountId);assert.equal(remote.get(accountId).name,'Prepared Resident Updated');
  assert.equal((await db.user.findUniqueOrThrow({where:{id:accountId}})).name,'Prepared Resident Updated');assert.equal(counts().create,before);
  for(const actor of ['resident','staff','foreign','platform']) assert.ok([403,404].includes((await call(actor,'PATCH',root+'/'+person.id,{name:'Unauthorized Name',email:person.email,status:'active',expectedVersion:changed.version})).statusCode));
  assert.equal(remote.get(accountId).name,'Prepared Resident Updated');
  const rename=provider.rename;provider.rename=async()=>{throw Error('simulated unavailable identity service');};
  try {
   assert.equal((await call('owner','PATCH',root+'/'+person.id,{name:'Unconfirmed Name',email:person.email,status:'active',expectedVersion:changed.version})).statusCode,500);
   assert.equal((await db.user.findUniqueOrThrow({where:{id:accountId}})).name,'Prepared Resident Updated');
   assert.equal(ok(await call('owner','GET',root+'/'+person.id)).version,changed.version);
  }finally{provider.rename=rename;}
 });
 await t.test('invitations bind the prepared subject and password setup cannot create another user',async()=>{
  const current=ok(await call('owner','GET',root+'/'+person.id));
  invitation=ok(await call('owner','POST',root+'/'+person.id+'/invitations',{expectedVersion:current.version,approvals:current.leases.map(p=>({id:p.id,leaseId:p.leaseId,role:p.role,version:p.version,leaseVersion:p.lease.version}))}));
  const row=await db.invitation.findUniqueOrThrow({where:{id:invitation.id}});assert.equal(row.accountId,accountId);
  await assert.rejects(db.invitation.update({where:{id:row.id},data:{accountId:null}}),/immutable|constraint/i);
  const before=counts();const token=new URL(invitation.acceptanceUrl).hash.slice(1);
  ok(await call(null,'POST','/api/invitations/setup-account',{token}));
  assert.equal(counts().create,before.create);assert.equal(counts().setup,before.setup+1);
  assert.equal((await call(null,'POST','/api/invitations/setup-account',{token})).statusCode,429);
  const wrong='auth0|wrong-'+randomUUID();
  await admin.query('INSERT INTO "User"(id,email,"emailVerified","updatedAt") VALUES($1,$2,true,NOW())',[wrong,'PREPARED-RESIDENT@test.invalid']);
  await db.session.create({data:{tokenHash:digest('token-'+wrong),csrfToken:'csrf',userId:wrong,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
  assert.equal((await call(wrong,'POST','/api/invitations/accept',{token})).statusCode,403,'same email cannot substitute a different identity');
  const identity=remote.get(accountId);identity.email_verified=true;
  const synced=await db.$transaction(tx=>synchronizeIdentity(tx,provider.issuer,{sub:identity.user_id,email:identity.email,email_verified:true}));
  assert.equal(synced.user.id,accountId,'first callback reuses the pre-created mirror');
  await db.session.create({data:{tokenHash:digest('token-'+accountId),csrfToken:'csrf',userId:accountId,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
  ok(await call(accountId,'POST','/api/invitations/accept',{token}));
  const linked=(await admin.query('SELECT * FROM "ResidentContact" WHERE id=$1',[person.id])).rows[0];assert.equal(linked.userId,accountId);
  assert.equal((await admin.query('SELECT "contactId","userId" FROM "LeaseParticipant" WHERE "leaseId"=$1',[lease.id])).rows[0].contactId,person.id);
  ok(await call(accountId,'POST','/api/invitations/accept',{token}));
 });
 await t.test('every occupant requires an account and email; no anonymous household can bypass the policy',async()=>{
  const path='/api/company/leases/'+lease.id+'/participants';
  const body={name:'Prepared Occupant',email:null,phone:null,role:'occupant',startsOn:'2026-10-01',endsOn:null,submissionKey:randomUUID()};
  assert.equal((await call('owner','POST',path,body)).statusCode,422);
  const added=ok(await call('owner','POST',path,{...body,email:'prepared-occupant@test.invalid'}));
  const contact=(await admin.query('SELECT "userId" FROM "ResidentContact" WHERE id=$1',[added.contactId])).rows[0];
  assert.ok(remote.has(contact.userId));assert.equal(added.userId,contact.userId);
  assert.equal(await db.companyMembership.count({where:{userId:contact.userId}}),0);
  const before=counts().create;
  assert.equal((await call('resident','POST',path,{...body,email:'unauthorized@test.invalid',submissionKey:randomUUID()})).statusCode,403);
  assert.equal(counts().create,before,'authorization happens before Auth0 creation');
 });
 await t.test('owners reset the existing account inside Property Flow, with scope, cooldown and no user creation',async()=>{
  const target='/api/company/resident-contacts/'+person.id+'/password-reset';
  await admin.query('UPDATE "User" SET "passwordSetupSentAt"=NULL WHERE id=$1',[accountId]);
  const before=counts();
  for(const actor of ['staff','resident','foreign','platform'])assert.ok([403,404].includes((await call(actor,'POST',target,{})).statusCode));
  assert.equal((await call('owner','POST',target,{email:'somebody-else@test.invalid'})).statusCode,400);
  ok(await call('owner','POST',target,{}));assert.equal(counts().setup,before.setup+1);assert.equal(counts().create,before.create);
  assert.equal((await call('owner','POST',target,{})).statusCode,429);
  assert.equal(counts().setup,before.setup+1);
  assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=$2 AND "targetId"=$1',[accountId,'user.password_reset.requested'])).rows[0].n,1);
 });

}
