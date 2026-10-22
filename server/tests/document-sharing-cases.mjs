import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '../dist/sessions.js';

export async function documentSharingCases(t,admin,db,call){
 const ok=async(...args)=>{const r=await call(...args);assert.equal(r.statusCode,200,r.body);return r.json();};
 for(const id of ['share-resident','share-occupant','share-pending']){
  await admin.query(`INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES($1,$2,$1,true,NOW())`,[id,`${id}@test.invalid`]);
  await admin.query(`INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,'a','resident',NOW())`,[id]);
  await admin.query(`INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home',$1)`,[id]);
  await db.session.create({data:{tokenHash:digest(`token-${id}`),csrfToken:'csrf',userId:id,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
 }
 await admin.query(`INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") VALUES('share-unit','a','home','Shared-document unit','owner','share-unit','fixture',NOW());
 INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentId","createdById","submissionKey","submissionHash","startsOn","rentCents",status,"updatedAt") VALUES('share-lease','a','home','share-unit','share-resident','owner','share-lease','fixture',CURRENT_DATE-30,100000,'active',NOW());
 INSERT INTO "LeaseParticipant"(id,"companyId","propertyId","leaseId","userId",name,role,"startsOn","portalApproved","createdById","submissionKey","submissionHash","updatedAt") VALUES
 ('share-primary','a','home','share-lease','share-resident','Fictional leaseholder','leaseholder',CURRENT_DATE-30,true,'owner','share-primary','fixture',NOW()),
 ('share-occupant-part','a','home','share-lease','share-occupant','Fictional occupant','occupant',CURRENT_DATE-30,true,'owner','share-occupant-part','fixture',NOW()),
 ('share-pending-part','a','home','share-lease','share-pending','Pending approval','leaseholder',CURRENT_DATE-30,false,'owner','share-pending-part','fixture',NOW())`);
 const source='/api/company/leases/share-lease/documents',resident='/api/resident/documents';
 const upload=async(title='Fictional shared instructions',extra={})=>ok('manager','POST',source,{title,filename:'instructions.txt',mediaType:'text/plain',contentBase64:Buffer.from('Exact first shared original.').toString('base64'),submissionKey:randomUUID(),...extra});
 const original=await upload(),base=`${source}/${original.documentId}/shares`,body=(extra={})=>({documentVersionId:original.versionId,participantId:'share-primary',expectedDocumentVersion:1,submissionKey:randomUUID(),...extra});
 let primary,occupant,newerPrimary,newer;
 await t.test('private-by-default, named approved recipients, clean exact versions and request boundaries',async()=>{
  assert.equal((await ok('share-resident','GET',resident)).total,0);
  const settings=await ok('manager','GET',base);assert.deepEqual(settings.eligible.map(p=>p.id).sort(),['share-occupant-part','share-primary']);
  assert.equal((await call('manager','POST',base,body())).statusCode,409,'quarantine prevents sharing');
  for(const actor of ['staff','share-resident','share-occupant'])assert.equal((await call(actor,'GET',base)).statusCode,403);
  assert.equal((await call('foreign','GET',base)).statusCode,404);
  assert.equal((await call('manager','GET',base,null,{'x-company-id':'b'})).statusCode,403);
  assert.equal((await call('manager','POST',base,body(),{'x-csrf-token':'bad'})).statusCode,403);
  assert.equal((await call('manager','POST',base,{...body(),recipientId:'share-occupant'})).statusCode,400);
  assert.equal((await call('manager','POST',base,body({participantId:'share-pending-part'}))).statusCode,409);
  assert.equal((await call('share-resident','GET',source)).statusCode,403);
  assert.equal((await call('share-resident','GET',resident+'?companyId=b')).statusCode,400);
  await ok('manager','POST',`${source}/${original.documentId}/versions/${original.versionId}/scan`,{});
 });
 let originalBody;
 await t.test('concurrent share replay creates one pinned grant and one audit; duplicate and mismatched submissions fail',async()=>{
  originalBody=body();const results=await Promise.all(Array.from({length:3},()=>call('manager','POST',base,originalBody)));
  results.forEach(r=>assert.equal(r.statusCode,200,r.body));primary=results[0].json();assert.equal(new Set(results.map(r=>r.json().id)).size,1);
  assert.equal((await call('manager','POST',base,{...originalBody,participantId:'share-occupant-part'})).statusCode,409);
  assert.equal((await call('owner','POST',base,body())).statusCode,409);
  const competing=await Promise.all(['manager','owner'].map(actor=>call(actor,'POST',base,body({participantId:'share-occupant-part'}))));assert.deepEqual(competing.map(r=>r.statusCode).sort(),[200,409]);occupant=competing.find(r=>r.statusCode===200).json();
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "DocumentShare" WHERE "documentId"=$1`,[original.documentId])).rows[0].n,2);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='document.shared' AND "targetId"=$1`,[primary.id])).rows[0].n,1);
  for(const actor of ['share-resident','share-occupant']){const list=await ok(actor,'GET',resident);assert.equal(list.total,1);assert.equal(list.items[0].number,1);for(const key of ['contentBase64','sha256','createdById','recipientId','participantId','leaseId','submissionKey','submissionHash','author'])assert.ok(!Object.hasOwn(list.items[0],key),key);}
  assert.equal((await ok('share-pending','GET',resident)).total,0);
  for(const actor of ['share-occupant','share-pending'])assert.equal((await call(actor,'GET',`${resident}/${primary.id}/download`)).statusCode,404);
  assert.equal((await call('share-resident','GET',`${resident}/missing-share/download`)).statusCode,404);
  assert.equal((await call('foreign','GET',`${resident}/${primary.id}/download`)).statusCode,403);
  const file=await call('share-resident','GET',`${resident}/${primary.id}/download`);assert.equal(file.statusCode,200,file.body);assert.equal(Buffer.from(file.json().contentBase64,'base64').toString(),'Exact first shared original.');assert.match(file.headers['cache-control'],/no-store/);assert.equal(file.headers['x-content-type-options'],'nosniff');
 });
 await t.test('later uploads remain private and do not replace the exact shared original',async()=>{
  newer=await upload('Fictional shared instructions',{documentId:original.documentId,expectedVersion:1,filename:'later-private.txt',contentBase64:Buffer.from('Second original remains private until selected.').toString('base64')});
  await ok('manager','POST',`${source}/${original.documentId}/versions/${newer.versionId}/scan`,{});
  const before=await ok('share-resident','GET',resident);assert.equal(before.total,1);assert.equal(before.items[0].filename,'instructions.txt');
  assert.equal(Buffer.from((await ok('share-resident','GET',`${resident}/${primary.id}/download`)).contentBase64,'base64').toString(),'Exact first shared original.');
  newerPrimary=await ok('manager','POST',base,body({documentVersionId:newer.versionId,expectedDocumentVersion:2}));
  const after=await ok('share-resident','GET',resident);assert.equal(after.total,2);assert.deepEqual(after.items.map(x=>x.number).sort(),[1,2]);assert.equal((await ok('share-resident','GET',resident+'?q=Shared-document')).total,2);assert.equal((await ok('share-resident','GET',resident+'?q=no-match')).total,0);
  assert.equal((await ok('share-occupant','GET',resident)).total,1,'no automatic share of a newer version with other recipients');
 });
 await t.test('receipt is versioned, durable, private and explicitly separate from a signature',async()=>{
  const payload={expectedVersion:1,submissionKey:randomUUID()},path=`${resident}/${primary.id}/received`,results=await Promise.all([call('share-resident','POST',path,payload),call('share-resident','POST',path,payload)]);
  results.forEach(r=>assert.equal(r.statusCode,200,r.body));assert.equal(results[0].json().version,2);assert.ok(results[0].json().receivedAt);
  assert.equal((await call('share-resident','POST',path,{...payload,expectedVersion:2})).statusCode,409);
  assert.equal((await call('share-occupant','POST',path,payload)).statusCode,404);
  assert.equal((await call('share-resident','POST',path,payload,{'x-csrf-token':'bad'})).statusCode,403);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "DocumentShareAction" WHERE "shareId"=$1 AND action='received'`,[primary.id])).rows[0].n,1);
  const management=await ok('manager','GET',base);assert.ok(management.items.find(x=>x.id===primary.id).receivedAt);assert.ok(management.items.find(x=>x.id===primary.id).history.some(x=>x.action==='downloaded'));
 });
 await t.test('explicit revoke is durable and cannot be undone by replaying an earlier share',async()=>{
  const payload={expectedVersion:2,submissionKey:randomUUID()},path=`${base}/${primary.id}/revoke`,results=await Promise.all([call('manager','POST',path,payload),call('manager','POST',path,payload)]);results.forEach(r=>assert.equal(r.statusCode,200,r.body));assert.equal(results[0].json().version,3);
  assert.equal((await call('share-resident','GET',`${resident}/${primary.id}/download`)).statusCode,404);assert.equal((await call('share-resident','POST',`${resident}/${primary.id}/received`,{expectedVersion:3,submissionKey:randomUUID()})).statusCode,404);
  const replay=await ok('manager','POST',base,originalBody);assert.equal(replay.id,primary.id);assert.ok(replay.revokedAt);assert.equal((await ok('manager','GET',base)).items.find(x=>x.id===primary.id).available,false);assert.equal((await ok('share-resident','GET',resident)).total,1);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "DocumentShareAction" WHERE "shareId"=$1 AND action='revoked'`,[primary.id])).rows[0].n,1);
  assert.equal((await call('manager','POST',`${base}/${occupant.id}/revoke`,{expectedVersion:99,submissionKey:randomUUID()})).statusCode,409);
 });
 await t.test('current assignment, household approval/dates/removal, membership and archive control list counts and each download',async()=>{
  const download=()=>call('share-resident','GET',`${resident}/${newerPrimary.id}/download`),denied=async()=>{assert.equal((await ok('share-resident','GET',resident)).total,0);assert.equal((await download()).statusCode,404);};
  await admin.query(`DELETE FROM "ResidentPropertyAssignment" WHERE "userId"='share-resident' AND "propertyId"='home'`);await denied();await admin.query(`INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','share-resident')`);
  for(const change of [`"portalApproved"=false`,`"removedAt"=NOW()`,`"endsOn"=(SELECT (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date-1 FROM "Company" WHERE id='a')`]){await admin.query(`UPDATE "LeaseParticipant" SET ${change} WHERE id='share-primary'`);await denied();await admin.query(`UPDATE "LeaseParticipant" SET "portalApproved"=true,"removedAt"=NULL,"endsOn"=NULL WHERE id='share-primary'`);}
  await admin.query(`UPDATE "LeaseParticipant" SET "endsOn"=(SELECT (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date FROM "Company" WHERE id='a') WHERE id='share-primary'`);assert.equal((await download()).statusCode,200,'participation end date is inclusive in company timezone');await admin.query(`UPDATE "LeaseParticipant" SET "endsOn"=NULL WHERE id='share-primary'`);
  await admin.query(`UPDATE "CompanyMembership" SET role='staff' WHERE "userId"='share-resident'`);assert.equal((await call('share-resident','GET',resident)).statusCode,403);await admin.query(`UPDATE "CompanyMembership" SET role='resident' WHERE "userId"='share-resident'`);
  await ok('manager','PATCH',`${source}/${original.documentId}`,{archived:true,expectedVersion:2});await denied();await ok('manager','PATCH',`${source}/${original.documentId}`,{archived:false,expectedVersion:3});assert.equal((await download()).statusCode,200);
  const c=await admin.connect();try{await c.query('BEGIN');await c.query(`UPDATE "PrivateDocument" SET "archivedAt"=NOW(),version=version+1 WHERE id=$1`,[original.documentId]);const pending=download();await new Promise(resolve=>setTimeout(resolve,30));await c.query('COMMIT');assert.equal((await pending).statusCode,404,'an archive committed before blocked download is rechecked after the document fence');}finally{await c.query('ROLLBACK');c.release();await admin.query(`UPDATE "PrivateDocument" SET "archivedAt"=NULL,version=version+1 WHERE id=$1`,[original.documentId]);}
 });
 await t.test('contact-linked legacy participation is fenced against roster revocation before download',async()=>{
  // A retained direct account mapping cannot be removed. Create a legitimate
  // contact-only legacy participant instead of weakening its identity trigger.
  await admin.query(`INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES('share-legacy','share-legacy@test.invalid','Legacy mapped resident',true,NOW());
  INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES('share-legacy','a','resident',NOW());
  INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','share-legacy');
  INSERT INTO "ResidentContact"(id,"companyId","userId",name,email,"createdById","updatedAt") VALUES('share-contact','a','share-legacy','Legacy mapped resident','share-legacy@test.invalid','owner',NOW());
  INSERT INTO "LeaseParticipant"(id,"companyId","propertyId","leaseId","userId","contactId",name,role,"startsOn","portalApproved","createdById","submissionKey","submissionHash","updatedAt") VALUES('share-legacy-part','a','home','share-lease',NULL,'share-contact','Legacy mapped resident','leaseholder',CURRENT_DATE-30,true,'owner','share-legacy-part','fixture',NOW())`);
  await db.session.create({data:{tokenHash:digest('token-share-legacy'),csrfToken:'csrf',userId:'share-legacy',expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
  const file=await upload('Legacy mapped sharing');await ok('manager','POST',`${source}/${file.documentId}/versions/${file.versionId}/scan`,{});
  const shared=await ok('manager','POST',`${source}/${file.documentId}/shares`,{documentVersionId:file.versionId,participantId:'share-legacy-part',expectedDocumentVersion:1,submissionKey:randomUUID()});
  const c=await admin.connect();let pending;try{
   await c.query('BEGIN');await c.query(`UPDATE "LeaseParticipant" SET "portalApproved"=false,version=version+1 WHERE id='share-legacy-part'`);
   pending=call('share-legacy','GET',`${resident}/${shared.id}/download`);
   let waiting=false;for(let i=0;i<150;i++){const result=await admin.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%LeaseParticipant%' AND query LIKE '%FOR SHARE%'`);if(result.rows[0].n){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
   assert.ok(waiting,'download must wait on the exact participant row, including legacy contact-only mappings');await c.query('COMMIT');assert.equal((await pending).statusCode,404);assert.equal((await admin.query(`SELECT count(*)::int n FROM "DocumentShareAction" WHERE "shareId"=$1 AND action='downloaded'`,[shared.id])).rows[0].n,0);
  }finally{await c.query('ROLLBACK');c.release();if(pending)await pending;await admin.query(`UPDATE "LeaseParticipant" SET "portalApproved"=true,version=version+1 WHERE id='share-legacy-part'`);}
 });
 await t.test('forced RLS, retained exact identities, append-only history and atomic audit rollback',async()=>{
  assert.deepEqual(await db.documentShare.findMany(),[]);assert.deepEqual(await db.documentShareAction.findMany(),[]);
  for(const table of ['DocumentShare','DocumentShareAction']){const flags=(await admin.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=$1`,[table])).rows[0];assert.deepEqual(flags,{relrowsecurity:true,relforcerowsecurity:true});}
  await assert.rejects(admin.query(`UPDATE "DocumentShare" SET "recipientId"='share-occupant' WHERE id=$1`,[newerPrimary.id]),/immutable/);await assert.rejects(admin.query(`UPDATE "DocumentShare" SET "revokedAt"=NULL WHERE id=$1`,[primary.id]),/restored/);await assert.rejects(admin.query(`DELETE FROM "DocumentShareAction" WHERE "shareId"=$1`,[primary.id]),/immutable/);
  const pending=await upload('Audit rollback original');await ok('manager','POST',`${source}/${pending.documentId}/versions/${pending.versionId}/scan`,{});
  await assert.rejects(admin.query(`INSERT INTO "DocumentShare"(id,"companyId","leaseId","documentId","documentVersionId","participantId","recipientId","createdById","submissionKey","submissionHash") VALUES('bad-share-scope','a','share-lease',$1,$2,'share-primary','share-resident','owner',$3,'fixture')`,[pending.documentId,original.versionId,randomUUID()]),/foreign key/);
  await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','b',true)`;return tx.documentShare.create({data:{companyId:'a',leaseId:'share-lease',documentId:original.documentId,documentVersionId:original.versionId,participantId:'share-pending-part',recipientId:'share-pending',createdById:'owner',submissionKey:randomUUID(),submissionHash:'fixture'}});}),/row-level security/);
  const count=(await admin.query(`SELECT count(*)::int n FROM "DocumentShare"`)).rows[0].n;
  await admin.query(`CREATE FUNCTION reject_share_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'document.shar%' THEN RAISE EXCEPTION 'sharing audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_share_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_share_audit()`);
  try{assert.equal((await call('manager','POST',`${source}/${pending.documentId}/shares`,{documentVersionId:pending.versionId,participantId:'share-primary',expectedDocumentVersion:1,submissionKey:randomUUID()})).statusCode,500);assert.equal((await call('share-resident','POST',`${resident}/${newerPrimary.id}/received`,{expectedVersion:1,submissionKey:randomUUID()})).statusCode,500);assert.equal((await call('manager','POST',`${base}/${newerPrimary.id}/revoke`,{expectedVersion:1,submissionKey:randomUUID()})).statusCode,500);assert.equal((await call('share-resident','GET',`${resident}/${newerPrimary.id}/download`)).statusCode,500);}finally{await admin.query(`DROP TRIGGER reject_share_audit ON "AuditEvent"; DROP FUNCTION reject_share_audit()`);}
  assert.equal((await admin.query(`SELECT count(*)::int n FROM "DocumentShare"`)).rows[0].n,count);const unchanged=(await admin.query(`SELECT version,"receivedAt","revokedAt" FROM "DocumentShare" WHERE id=$1`,[newerPrimary.id])).rows[0];assert.deepEqual(unchanged,{version:1,receivedAt:null,revokedAt:null});
  assert.equal((await call('foreign','POST',`${base}/${newerPrimary.id}/revoke`,{expectedVersion:1,submissionKey:randomUUID()})).statusCode,404);
 });
}
