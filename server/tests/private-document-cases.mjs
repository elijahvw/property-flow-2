import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {historicalDocument} from './historical-document-fixture.mjs';
export async function privateDocumentCases(t,admin,db,call,id){
 const base=`/api/company/maintenance/${id}/documents`, payload=()=>({title:'Repair report',filename:'repair.txt',mediaType:'text/plain',contentBase64:Buffer.from('Fictional isolated repair report.').toString('base64'),submissionKey:randomUUID()});
 let documentId,versionId;
 await t.test('private uploads validate content, scope, roles, size and request integrity',async()=>{
  for(const role of ['staff','other'])assert.equal((await call(role,'GET',base)).statusCode,403);
  assert.equal((await call('foreign','GET',base)).statusCode,404);
  assert.equal((await call('manager','GET',base,null,{'x-company-id':'b'})).statusCode,403);
  for(const patch of [{filename:'../file.txt'},{filename:'file.html'},{mediaType:'text/html'},{contentBase64:'not base64'},{contentBase64:''},{contentBase64:Buffer.from([0,1,2]).toString('base64')},{filename:'file.pdf',mediaType:'application/pdf'},{visibility:'public'}])assert.equal((await call('manager','POST',base,{...payload(),...patch})).statusCode,400);
  assert.equal((await call('manager','POST',base,payload(),{'x-csrf-token':'bad'})).statusCode,403);
  const first=payload(), attempts=await Promise.all(Array.from({length:3},()=>call('manager','POST',base,first)));
  for(const result of attempts)assert.equal(result.statusCode,200,result.body);
  assert.equal(new Set(attempts.map(r=>r.json().versionId)).size,1);({documentId,versionId}=attempts[0].json());
  assert.equal((await call('manager','POST',base,{...first,title:'Changed'})).statusCode,409);
  const list=(await call('manager','GET',base)).json();assert.equal(list.items.length,1);assert.equal(list.items[0].versions[0].scanStatus,'unscanned');assert.ok(!JSON.stringify(list).includes('contentBase64'));assert.ok(!JSON.stringify(list).includes('submission'));
  assert.equal((await call('manager','GET',`${base}/${documentId}/versions/${versionId}/download`)).statusCode,200);
  assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'document.uploaded\' AND "targetId"=$1',[documentId])).rows[0].n,1);
 });
 await t.test('uploads are honestly unscanned, downloadable and audited without a scanner',async()=>{
  const download=await call('manager','GET',`${base}/${documentId}/versions/${versionId}/download`);
  assert.equal(download.statusCode,200);assert.equal(Buffer.from(download.json().contentBase64,'base64').toString(),'Fictional isolated repair report.');assert.match(download.headers['cache-control'],/no-store/);assert.equal(download.headers['x-content-type-options'],'nosniff');
  assert.equal((await call('manager','POST',`${base}/${documentId}/versions/${versionId}/scan`,{})).statusCode,404);
  const stored=(await admin.query('SELECT "scanStatus","scannedAt" FROM "DocumentVersion" WHERE id=$1',[versionId])).rows[0];
  assert.deepEqual(stored,{scanStatus:'unscanned',scannedAt:null});
  assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'document.scanned\' AND "targetId"=$1',[documentId])).rows[0].n,0);
  for(const actor of ['staff','other'])assert.equal((await call(actor,'GET',`${base}/${documentId}/versions/${versionId}/download`)).statusCode,403);
  assert.equal((await call('manager','POST',base,{...payload(),scanStatus:'clean'})).statusCode,400);
  await assert.rejects(admin.query('UPDATE "DocumentVersion" SET "scanStatus"=\'clean\',"scannedAt"=NOW() WHERE id=$1',[versionId]),/immutable/);
 });
 await t.test('historical verdicts stay unchanged; known rejected originals remain blocked',async()=>{
  for(const status of ['pending','clean','rejected']){
   const file=await historicalDocument(admin,{sourceId:id,status});
   assert.equal((await call('owner','GET',`${base}/${file.documentId}/versions/${file.versionId}/download`)).statusCode,status==='rejected'?409:200);
   assert.equal((await admin.query('SELECT "scanStatus" FROM "DocumentVersion" WHERE id=$1',[file.versionId])).rows[0].scanStatus,status);
  }
 });
 await t.test('the reconciled schema defaults originals to unscanned and rejects a fabricated scan timestamp',async()=>{
  const defaultDocumentId=randomUUID(),defaultVersionId=randomUUID();
  await admin.query('INSERT INTO "PrivateDocument" (id,"companyId","requestId",title) VALUES($1,\'a\',$2,\'Isolated default-status original\')',[defaultDocumentId,id]);
  const created=await admin.query('INSERT INTO "DocumentVersion" (id,"companyId","documentId",number,filename,"mediaType","byteLength",sha256,content,"createdById","submissionKey","submissionHash") SELECT $1,"companyId",$2,1,filename,"mediaType","byteLength",sha256,content,"createdById",$1,\'isolated-default-status\' FROM "DocumentVersion" WHERE id=$3 RETURNING "scanStatus","scannedAt"',[defaultVersionId,defaultDocumentId,versionId]);
  assert.deepEqual(created.rows,[{scanStatus:'unscanned',scannedAt:null}]);
  await assert.rejects(admin.query('INSERT INTO "DocumentVersion" (id,"companyId","documentId",number,filename,"mediaType","byteLength",sha256,content,"createdById","submissionKey","submissionHash","scanStatus","scannedAt") SELECT $1,"companyId","documentId",2,filename,"mediaType","byteLength",sha256,content,"createdById",$1,\'isolated-invalid-timestamp\',\'unscanned\',NOW() FROM "DocumentVersion" WHERE id=$2',[randomUUID(),defaultVersionId]),error=>error.code==='23514'&&error.constraint==='DocumentVersion_unscanned_timestamp_check');
  assert.equal((await call('manager','GET',`${base}/${defaultDocumentId}/versions/${defaultVersionId}/download`)).statusCode,200);
 });
 await t.test('versions, archive and originals survive retries, conflicts and direct mutation attempts',async()=>{
  const newer={...payload(),documentId,expectedVersion:1,contentBase64:Buffer.from('Version two isolated report').toString('base64')};
  const attempts=await Promise.all([call('manager','POST',base,newer),call('owner','POST',base,{...newer,submissionKey:randomUUID()})]);assert.deepEqual(attempts.map(r=>r.statusCode).sort(),[200,409]);
  const doc=(await call('owner','GET',base)).json().items.find(d=>d.id===documentId);assert.equal(doc.versions.length,2);assert.equal(doc.version,2);
  assert.equal((await call('manager','PATCH',`${base}/${documentId}`,{archived:true,expectedVersion:1})).statusCode,409);
  assert.equal((await call('manager','PATCH',`${base}/${documentId}`,{archived:true,expectedVersion:2})).statusCode,200);
  assert.equal((await call('manager','POST',base,{...newer,expectedVersion:3,submissionKey:randomUUID()})).statusCode,409);
  assert.equal((await call('manager','GET',`${base}/${documentId}/versions/${versionId}/download`)).statusCode,200,'archiving retains management retrieval');
  assert.equal((await call('manager','PATCH',`${base}/${documentId}`,{archived:false,expectedVersion:3})).statusCode,200);
  await assert.rejects(admin.query('UPDATE "DocumentVersion" SET content=$1 WHERE id=$2',[Buffer.from('tampered'),versionId]),/immutable/);
  await assert.rejects(admin.query('DELETE FROM "DocumentVersion" WHERE id=$1',[versionId]),/retained/);
  assert.deepEqual(await db.privateDocument.findMany(),[]);assert.deepEqual(await db.documentVersion.findMany(),[]);
  await assert.rejects(db.$transaction(async tx=>{await tx.$queryRaw`SELECT set_config('app.company_id','b',true)`;return tx.documentVersion.create({data:{id:'forged',companyId:'a',documentId,number:3,filename:'x.txt',mediaType:'text/plain',byteLength:1,sha256:'x',content:Buffer.from('x'),createdById:'manager',submissionKey:randomUUID(),submissionHash:'x'}});}),/row-level security/);
 });
 await t.test('failed audit rolls back upload and source IDs cannot be substituted',async()=>{
  const before=(await admin.query('SELECT count(*)::int n FROM "DocumentVersion"')).rows[0].n;
  await admin.query(`CREATE FUNCTION fail_document_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='document.uploaded' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_document_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION fail_document_audit()`);
  try{assert.equal((await call('manager','POST',base,payload())).statusCode,500);}finally{await admin.query('DROP TRIGGER fail_document_audit ON "AuditEvent"; DROP FUNCTION fail_document_audit()');}
  assert.equal((await admin.query('SELECT count(*)::int n FROM "DocumentVersion"')).rows[0].n,before);
  assert.equal((await call('manager','GET',`/api/company/maintenance/missing/documents/${documentId}/versions/${versionId}/download`)).statusCode,404);
  await admin.query(`UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='manager'`);
  assert.equal((await call('manager','GET',`${base}/${documentId}/versions/${versionId}/download`)).statusCode,403);
  await admin.query(`UPDATE "CompanyMembership" SET status='active' WHERE "userId"='manager'`);
 });
 await t.test('lease documents remain source-bound and residents never inherit sharing from upload',async()=>{
  await admin.query(`INSERT INTO "Lease" (id,"companyId","propertyId","unitId","createdById","residentId","startsOn","rentCents","submissionKey","submissionHash","updatedAt") VALUES ('document-lease','a','home','unit-a','owner','other','2026-10-01',100000,'document-lease','fixture',NOW())`);
  const leaseBase='/api/company/leases/document-lease/documents',upload=await call('owner','POST',leaseBase,payload());assert.equal(upload.statusCode,200,upload.body);const file=upload.json();
  assert.equal((await call('manager','GET',leaseBase)).json().items.length,1);
  for(const role of ['staff','other'])assert.equal((await call(role,'GET',leaseBase)).statusCode,403);
  assert.equal((await call('foreign','GET',leaseBase)).statusCode,404);
  assert.equal((await call('owner','GET',`${base}/${file.documentId}/versions/${file.versionId}/download`)).statusCode,404);
  assert.equal((await call('owner','GET',`${leaseBase}/${documentId}/versions/${versionId}/download`)).statusCode,404);
  assert.equal((await call('owner','POST',leaseBase,{...payload(),documentId,expectedVersion:4})).statusCode,404);
 });

}
