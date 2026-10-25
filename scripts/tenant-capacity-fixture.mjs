// Test-only expansion of performanceFixture's existing 200-person sources.
// Call only inside its verified, empty-at-start, owned tmpfs database.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const company='perf-company', owner='perf-owner';
const shift=(value,days)=>{const d=new Date(value+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
const countValues=rows=>Object.fromEntries(Object.entries(rows).map(([key,value])=>[key,Number(value)]));
async function grains(admin) {
  const row=(await admin.query(`SELECT
    (SELECT count(*) FROM "ResidentContact" WHERE "companyId"=$1) AS "contactRows",
    (SELECT count(*) FROM "CompanyMembership" WHERE "companyId"=$1 AND role='resident') AS "residentMembershipRows",
    (SELECT count(*) FROM "CompanyMembership" m WHERE m."companyId"=$1 AND m.role='resident' AND EXISTS(SELECT 1 FROM "ResidentContact" c WHERE c."companyId"=m."companyId" AND c."userId"=m."userId")) AS "mappedResidentMemberships",
    (SELECT count(*) FROM "CompanyMembership" m WHERE m."companyId"=$1 AND m.role='resident' AND NOT EXISTS(SELECT 1 FROM "ResidentContact" c WHERE c."companyId"=m."companyId" AND c."userId"=m."userId")) AS "unmatchedResidentMemberships",
    (SELECT count(*) FROM "Lease" WHERE "companyId"=$1) AS "leaseRows",
    (SELECT count(*) FROM "LeaseParticipant" WHERE "companyId"=$1) AS "participantRows"`,[company])).rows[0];
  const result=countValues(row);
  return {...result,logicalRows:result.contactRows+result.unmatchedResidentMemberships};
}
export async function seedTenantCapacity(admin,scale) {
  assert.ok([1000,2000,2001].includes(scale));
  const clock=(await admin.query(`SELECT CURRENT_DATE::text AS utc,(NOW() AT TIME ZONE 'America/New_York')::date::text AS local`)).rows[0];
  const expected=new Map(), users=[],members=[],contacts=[],assignments=[],invitations=[];
  for(let n=1;n<=scale;n++) {
    const base=n<=200, bucket=n%10, hasUser=base||![0,9].includes(bucket), member=base||bucket>=1&&bucket<=6;
    const contactId=base?'perf-contact-'+n:'tenant-capacity-contact-'+String(n).padStart(4,'0');
    const userId=base?'perf-resident-'+n:hasUser?'tenant-capacity-user-'+String(n).padStart(4,'0'):null;
    const name=base?'Test Tenant '+String(n).padStart(3,'0'):'Fictional Tenant '+String(n).padStart(4,'0');
    const email=base?'resident-'+n+'@performance.invalid':'tenant-'+n+'@capacity.invalid';
    const recordStatus=!base&&bucket===0?'archived':'active';
    const portalState=base?'active':member?[5,6].includes(bucket)?'disabled':bucket===3?'verification':'active':bucket===7?'pending':'offline';
    const status=member?(!base&&bucket===5?'disabled':'active'):'offline';
    expected.set(contactId,{contactId,userId,contactName:name,recordStatus,portalState,status,rentals:[],canArchive:true});
    if(base) {
      const propertyId='perf-property-'+(Math.floor((n-1)/10)+1);
      expected.get(contactId).rentals.push({leaseId:'perf-lease-'+n,propertyId,propertyName:'Test Property '+String(Math.floor((n-1)/10)+1).padStart(2,'0'),unitLabel:'Unit '+n,role:'leaseholder',status:'current',startsOn:shift(clock.utc,-90),endsOn:shift(clock.utc,275),blocksArchive:true});
      continue;
    }
    contacts.push({id:contactId,userId,name,email,phone:'555-'+String(n).padStart(7,'0'),status:recordStatus});
    if(userId)users.push({id:userId,email,name,emailVerified:bucket!==3,status:bucket===6?'disabled':'active'});
    if(member) {
      members.push({userId,status});
      assignments.push({userId,propertyId:'perf-property-'+((n-201)%20+1)});
    }
    if(bucket===7)invitations.push({id:'tenant-capacity-invite-'+n,contactId,accountId:userId,email,tokenHash:createHash('sha256').update('fictional-capacity-invite-'+n).digest('hex')});
  }
  const insert=async(sql,rows)=>{if(rows.length)await admin.query(sql,[JSON.stringify(rows)]);};
  await insert(`INSERT INTO "User"(id,email,name,"emailVerified",status,"updatedAt") SELECT id,email,name,"emailVerified",status,NOW() FROM jsonb_to_recordset($1::jsonb) AS x(id text,email text,name text,"emailVerified" boolean,status text)`,users);
  await insert(`INSERT INTO "CompanyMembership"("userId","companyId",role,status,"updatedAt") SELECT "userId",'perf-company','resident',status,NOW() FROM jsonb_to_recordset($1::jsonb) AS x("userId" text,status text)`,members);
  await insert(`INSERT INTO "ResidentContact"(id,"companyId","userId",name,email,phone,status,"updatedAt") SELECT id,'perf-company',"userId",name,email,phone,status,NOW() FROM jsonb_to_recordset($1::jsonb) AS x(id text,"userId" text,name text,email text,phone text,status text)`,contacts);
  await insert(`INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") SELECT 'perf-company',"propertyId","userId" FROM jsonb_to_recordset($1::jsonb) AS x("propertyId" text,"userId" text)`,assignments);
  await insert(`INSERT INTO "Invitation"(id,"companyId","contactId","accountId",email,role,"tokenHash","expiresAt","createdBy") SELECT id,'perf-company',"contactId","accountId",email,'resident',"tokenHash",NOW()+interval '1 day','perf-owner' FROM jsonb_to_recordset($1::jsonb) AS x(id text,"contactId" text,"accountId" text,email text,"tokenHash" text)`,invitations);

  const newUnits=[],newLeases=[],participants=[];let serial=0,legacyAliasLeaseRows=0;
  const rows=[...expected.values()], extra=rows.slice(200);
  function household(kind,people,forceLegacy=false) {
    const number=++serial, suffix=String(number).padStart(5,'0'), id='tenant-capacity-lease-'+suffix,unitId='tenant-capacity-unit-'+suffix;
    const propertyNumber=(number-1)%20+1,propertyId='perf-property-'+propertyNumber,propertyName='Test Property '+String(propertyNumber).padStart(2,'0'),unitLabel='Fictional household '+suffix;
    const legacy=(forceLegacy||number%4===0)&&people.every(person=>person.userId);
    if(legacy)legacyAliasLeaseRows++;
    const leaseStatus=kind==='draft'?'draft':kind==='former'?'ended':'active';
    const startsOn=shift(clock.local,kind==='upcoming'?30:kind==='draft'?60:kind==='former'?-730:kind==='removed'?-365:-90);
    const endsOn=shift(clock.local,kind==='former'?-400:kind==='upcoming'?395:kind==='draft'?425:365);
    const primary=people[0];
    newUnits.push({id:unitId,propertyId,label:unitLabel});
    newLeases.push({id,propertyId,unitId,residentContactId:legacy?null:primary.contactId,residentId:primary.userId,startsOn,endsOn,status:leaseStatus});
    people.forEach((person,index)=>{
      const primaryRole=index===0,removed=kind==='removed'&&!primaryRole;
      const participantStart=primaryRole?startsOn:shift(startsOn,7),participantEnd=primaryRole?endsOn:removed?shift(clock.local,-10):shift(endsOn,-10);
      participants.push({id:'tenant-capacity-participant-'+suffix+'-'+index,propertyId,leaseId:id,contactId:legacy?null:person.contactId,userId:person.userId,name:person.contactName,role:primaryRole?'leaseholder':'occupant',startsOn:participantStart,endsOn:participantEnd,removedAt:removed?shift(clock.local,-10)+'T12:00:00Z':null});
      // Expected associations come from the explicit seed plan, not the
      // production directory transformation. Primary+participant dedup is one.
      const state=kind==='former'||removed?'former':kind==='draft'?'draft':kind==='upcoming'?'upcoming':'current';
      person.rentals.push({leaseId:id,propertyId,propertyName,unitLabel,role:primaryRole?'leaseholder':'occupant',status:state,startsOn:primaryRole?startsOn:participantStart,endsOn:primaryRole?endsOn:participantEnd,blocksArchive:state!=='former'});
    });
  }
  function groups(kind,people) {let offset=0;while(offset<people.length){const size=2+(serial%3);household(kind,people.slice(offset,offset+size));offset+=size;}}
  for(const [mod,kind] of [[1,'current'],[2,'upcoming'],[3,'draft'],[4,'former']])groups(kind,extra.filter(person=>Number(person.contactId.slice(-4))%5===mod));
  groups('former',extra.filter(person=>{const n=Number(person.contactId.slice(-4));return n%5!==0&&n%3===0;}));
  groups('removed',extra.filter(person=>{const n=Number(person.contactId.slice(-4));return n%5!==0&&n%7===0;}));
  // An exact mapped-contact/user-only primary AND user-only occupant source.
  // Their financial-workspace interpretation is deliberately not asserted.
  household('former',rows.slice(0,3),true);
  await insert(`INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") SELECT id,'perf-company',"propertyId",label,'perf-owner',id,'fixture',NOW() FROM jsonb_to_recordset($1::jsonb) AS x(id text,"propertyId" text,label text)`,newUnits);
  await insert(`INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentContactId","residentId","startsOn","endsOn",status,"rentCents","createdById","submissionKey","submissionHash","updatedAt") SELECT id,'perf-company',"propertyId","unitId","residentContactId","residentId","startsOn"::date,"endsOn"::date,status,125000,'perf-owner',id,'fixture',NOW() FROM jsonb_to_recordset($1::jsonb) AS x(id text,"propertyId" text,"unitId" text,"residentContactId" text,"residentId" text,"startsOn" text,"endsOn" text,status text)`,newLeases);
  await insert(`INSERT INTO "LeaseParticipant"(id,"companyId","propertyId","leaseId","contactId","userId",name,role,"startsOn","endsOn","removedAt","portalApproved","createdById","submissionKey","submissionHash","updatedAt") SELECT id,'perf-company',"propertyId","leaseId","contactId","userId",name,role,"startsOn"::date,"endsOn"::date,"removedAt"::timestamptz,false,'perf-owner',id,'fixture',NOW() FROM jsonb_to_recordset($1::jsonb) AS x(id text,"propertyId" text,"leaseId" text,"contactId" text,"userId" text,name text,role text,"startsOn" text,"endsOn" text,"removedAt" text)`,participants);
  await admin.query('ANALYZE');
  const actual=await grains(admin);assert.equal(actual.logicalRows,scale);assert.equal(actual.contactRows,scale);assert.equal(actual.unmatchedResidentMemberships,0);
  assert.ok(actual.residentMembershipRows<2000&&actual.leaseRows<10000&&actual.participantRows<10000);
  const rank={current:0,upcoming:1,draft:2,former:3};
  const portalCounts={},recordCounts={},rentalStatusCounts={};let rentalAssociationCount=0;
  for(const row of rows) {
    assert.ok(row.rentals.length<=3);assert.equal(new Set(row.rentals.map(r=>r.leaseId)).size,row.rentals.length);
    row.rentals.sort((a,b)=>rank[a.status]-rank[b.status]||b.startsOn.localeCompare(a.startsOn)||a.leaseId.localeCompare(b.leaseId));
    row.canArchive=!row.rentals.some(r=>r.blocksArchive);
    portalCounts[row.portalState]=(portalCounts[row.portalState]||0)+1;recordCounts[row.recordStatus]=(recordCounts[row.recordStatus]||0)+1;
    for(const rental of row.rentals){rentalAssociationCount++;rentalStatusCounts[rental.status]=(rentalStatusCounts[rental.status]||0)+1;}
  }
  assert.equal(rows.length,actual.logicalRows);assert.ok(legacyAliasLeaseRows>0);
  return {
    expectations:{...actual,rentalAssociationCount,portalCounts,recordCounts,rentalStatusCounts,legacyAliasLeaseRows,rows},
    dataset:{properties:20,units:200+newUnits.length,tenants:scale,contacts:scale,leases:actual.leaseRows},
    prepareUnionLimit:async()=>{
      assert.equal(scale,2000,'Union probe requires exactly2000 baseline contacts');
      await admin.query(`INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES('tenant-capacity-unmatched','unmatched@capacity.invalid','Fictional unmatched resident',true,NOW());
        INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES('tenant-capacity-unmatched','perf-company','resident',NOW())`);
      const after=await grains(admin);assert.equal(after.contactRows,2000);assert.ok(after.residentMembershipRows<=2000);assert.equal(after.logicalRows,2001);assert.equal(after.unmatchedResidentMemberships,1);
      return {...after,firstExceededGuard:'merged_rows'};
    },
  };
}
