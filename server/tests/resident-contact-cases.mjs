import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serializable } from '../dist/application.js';
import { linkedResidentContact } from '../dist/resident-contacts.js';

const sources = ['User','CompanyMembership','Lease','LeaseParticipant','LedgerEntry','RentCharge','RentAllocation','DepositAccount','DepositRevision','DepositReceipt','AuditEvent'];
async function snapshot(admin, bridged = false) {
  const result = {};
  for (const table of sources) {
    const omit = bridged && table === 'Lease' ? `-'residentContactId'` : bridged && table === 'LeaseParticipant' ? `-'contactId'` : '';
    const order = table === 'CompanyMembership' ? '"userId"' : 'id';
    result[table] = (await admin.query(`SELECT to_jsonb(t)${omit} AS row FROM "${table}" t ORDER BY ${order}`)).rows;
  }
  return result;
}

export async function seedContactMigration(admin) {
  await admin.query(`
    INSERT INTO "Company"(id,name,"updatedAt") VALUES('contact-new-company','Another company',NOW());
    INSERT INTO "CompanyMembership"("userId","companyId",role,"contactName","contactPhone","managementNotes","updatedAt")
      VALUES('migration-resident','contact-new-company','resident','New company private name','555-9999','New company private notes',NOW());
    INSERT INTO "User"(id,email,name,"updatedAt") VALUES('migration-current','current@test.invalid','Account name',NOW());
    INSERT INTO "CompanyMembership"("userId","companyId",role,"contactName","contactPhone","emergencyContactName","emergencyContactPhone","managementNotes","updatedAt")
      VALUES('migration-current','migration-company','manager','Current contact','555-0100','Emergency person','555-0101','Private contact notes',NOW());
    INSERT INTO "LeaseParticipant"(id,"companyId","propertyId","leaseId","userId",name,email,role,"startsOn","createdById","submissionKey","submissionHash","updatedAt")
      VALUES('migration-linked','migration-company','migration-property','migration-lease','migration-current','Lease-specific name','current@test.invalid','occupant','2019-01-01','migration-owner','linked','original',NOW());
    INSERT INTO "LeaseParticipant"(id,"companyId","propertyId","leaseId",name,email,phone,role,"startsOn","removedAt","createdById","submissionKey","submissionHash","updatedAt")
      VALUES('migration-offline-1','migration-company','migration-property','migration-lease','Same name','current@test.invalid','555-0200','occupant','2019-01-01',NULL,'migration-owner','offline-1','original',NOW()),
      ('migration-offline-2','migration-company','migration-property','migration-lease','Same name','current@test.invalid','555-0200','occupant','2019-01-01',NOW(),'migration-owner','offline-2','original',NOW());
    INSERT INTO "RentCharge"(id,"companyId","propertyId","leaseId","createdById","submissionKey","submissionHash","periodOn","dueOn","amountCents")
      VALUES('migration-charge','migration-company','migration-property','migration-lease','migration-owner','charge','original','2019-01-01','2019-01-01',123456);
    INSERT INTO "LedgerEntry"(id,"companyId","propertyId","leaseId","createdById","submissionKey","submissionHash","occurredOn","amountCents",kind,category)
      VALUES('migration-rent-cash','migration-company','migration-property','migration-lease','migration-owner','cash','original','2019-01-02',45678,'income','rent');
    INSERT INTO "RentAllocation"(id,"companyId","propertyId","leaseId","chargeId","entryId","amountCents")
      VALUES('migration-allocation','migration-company','migration-property','migration-lease','migration-charge','migration-rent-cash',45678);
    INSERT INTO "DepositAccount"(id,"companyId","propertyId","leaseId","createdById","submissionKey","submissionHash","requiredCents","dueOn")
      VALUES('migration-deposit','migration-company','migration-property','migration-lease','migration-owner','deposit','original',150000,'2019-01-01');
    INSERT INTO "DepositRevision"(id,"companyId","accountId","createdById","submissionKey","submissionHash",version,"requiredCents","dueOn",reason)
      VALUES('migration-deposit-revision','migration-company','migration-deposit','migration-owner','deposit-revision','original',1,150000,'2019-01-01','Initial requirement');
    INSERT INTO "DepositReceipt"(id,"companyId","propertyId","leaseId","accountId","createdById","submissionKey","submissionHash","occurredOn","amountCents",method)
      VALUES('migration-deposit-receipt','migration-company','migration-property','migration-lease','migration-deposit','migration-owner','deposit-receipt','original','2019-01-01',150000,'check');
    INSERT INTO "LedgerEntry"(id,"companyId","propertyId","depositReceiptId","createdById","submissionKey","submissionHash","occurredOn","amountCents",kind,category)
      VALUES('migration-deposit-cash','migration-company','migration-property','migration-deposit-receipt','migration-owner','deposit-cash','original','2019-01-01',150000,'deposit','security_deposit');
    INSERT INTO "AuditEvent"(id,"actorId","companyId",action,"targetId","requestId")
      VALUES('migration-audit','migration-owner','migration-company','lease.created','migration-lease','original');
  `);
  return snapshot(admin);
}

export async function verifyContactMigration(admin, before) {
  const after = await snapshot(admin, true);
  for (const table of sources) {
    const key = table === 'CompanyMembership' ? 'userId' : 'id';
    const ids = new Set(before[table].map(r => r.row[key]));
    after[table] = after[table].filter(r => ids.has(r.row[key])).map(r=>{
      // Later additive migrations may add columns; compare every original field.
      const original=before[table].find(item=>item.row[key]===r.row[key]).row;
      return {row:Object.fromEntries(Object.keys(original).map(field=>[field,r.row[field]]))};
    });
  }
  assert.deepEqual(after, before, 'every original source field, ID and audit remains unchanged');
  const rows = (await admin.query(`SELECT * FROM "ResidentContact" ORDER BY id`)).rows;
  assert.equal(rows.length, 5);
  const current = rows.find(r => r.userId === 'migration-current');
  assert.equal(current.name, 'Current contact');
  assert.equal(current.phone, '555-0100');
  assert.equal(current.emergencyContactName, 'Emergency person');
  assert.equal(current.managementNotes, 'Private contact notes');
  const former = rows.find(r => r.userId === 'migration-resident' && r.companyId === 'migration-company');
  assert.equal(former.name, 'Existing resident');
  assert.equal(former.managementNotes, null);
  assert.equal(former.phone, null);
  const other = rows.find(r => r.userId === 'migration-resident' && r.companyId === 'contact-new-company');
  assert.notEqual(former.id, other.id);
  assert.equal(other.managementNotes, 'New company private notes');
  const lease = (await admin.query(`SELECT "residentContactId" FROM "Lease" WHERE id='migration-lease'`)).rows[0];
  assert.equal(lease.residentContactId, former.id);
  const participants = (await admin.query(`SELECT id,"userId","contactId" FROM "LeaseParticipant" ORDER BY id`)).rows;
  assert.equal(participants.find(p => p.userId === 'migration-resident').contactId, former.id);
  assert.equal(participants.find(p => p.id === 'migration-linked').contactId, current.id);
  const offline = participants.filter(p => p.userId === null);
  assert.equal(new Set(offline.map(p => p.contactId)).size, 2);
  assert.equal(rows.filter(r => r.userId === null && r.email === current.email).length, 2);
}

export async function residentContactCases(t, admin, call, db) {
  const ok = r => { assert.equal(r.statusCode, 200, r.body); return r.json(); };
  await t.test('forced RLS and company foreign keys retain private contact history', async () => {
    assert.deepEqual(await db.residentContact.findMany(), []);
    assert.deepEqual((await admin.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='ResidentContact'`)).rows[0], { relrowsecurity: true, relforcerowsecurity: true });
    assert.equal((await admin.query(`SELECT has_table_privilege('propertyflow_runtime','"ResidentContact"','DELETE') allowed`)).rows[0].allowed, false);
    await assert.rejects(db.residentContact.create({ data: { companyId: 'a', name: 'No context' } }), /row-level security/i);
    await assert.rejects(db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
      return tx.residentContact.create({ data: { companyId: 'b', name: 'Wrong company' } });
    }), /row-level security/i);
    await assert.rejects(db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.company_id','migration-company',true)`;
      return tx.lease.update({ where: { id: 'migration-lease' }, data: { residentContactId: (await admin.query(`SELECT id FROM "ResidentContact" WHERE "companyId"='contact-new-company'`)).rows[0].id } });
    }), /foreign key/i);
    await assert.rejects(db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.company_id','migration-company',true)`;
      return tx.residentContact.update({ where: { companyId_userId: { companyId: 'migration-company', userId: 'migration-current' } }, data: { userId: null } });
    }), /identity mapping is retained|permission denied/i);
  });
  await t.test('concurrent exact-identity bridging creates one contact and never overwrites curated details', async () => {
    const resolve = () => serializable(db, async tx => {
      await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id='resident2' RETURNING id`;
      return linkedResidentContact(tx, 'a', 'resident2');
    });
    const rows = await Promise.all([resolve(), resolve()]);
    assert.equal(rows[0].id, rows[1].id);
    await admin.query(`UPDATE "ResidentContact" SET name='Curated business name' WHERE id=$1`, [rows[0].id]);
    await admin.query(`UPDATE "User" SET name='Changed login name',email='changed-contact@test.invalid' WHERE id='resident2'`);
    const again = await resolve();
    assert.equal(again.id, rows[0].id);
    assert.equal(again.name, 'Curated business name');
    assert.equal(again.email, 'resident2@test.invalid');
    await admin.query(`UPDATE "User" SET name=NULL,email='resident2@test.invalid' WHERE id='resident2'`);
  });
  await t.test('new leases, record-only household retries and renewals keep stable contact identities', async () => {
    const unit = ok(await call('owner','POST','/api/company/properties/home/units',{ label:'Contact bridge unit',submissionKey:randomUUID() }));
    const body = { propertyId:'home',unitId:unit.id,residentId:'resident',startsOn:'2018-01-01',endsOn:'2018-12-31',monthlyRent:'100.01',status:'ended',submissionKey:randomUUID() };
    const lease = ok(await call('owner','POST','/api/company/leases',body));
    const root = `/api/company/leases/${lease.id}/participants`;
    const details = { name:'Record only',email:'record-only@test.invalid',phone:'555-0300',role:'occupant',startsOn:'2018-01-01',endsOn:null,userId:null,submissionKey:randomUUID() };
    const offline = ok(await call('owner','POST',root,details));
    assert.equal(ok(await call('owner','POST',root,details)).contactId, offline.contactId);
    assert.equal((await call('owner','POST',root,{...details,submissionKey:randomUUID()})).statusCode,409,'One Auth0 account cannot become duplicate tenant profiles');
    const second = ok(await call('owner','POST',root,{ ...details,email:'second-record@test.invalid',submissionKey:randomUUID() }));
    assert.notEqual(second.contactId, offline.contactId);
    const primary = ok(await call('owner','GET',root)).items.find(p => p.userId === 'resident');
    assert.equal(primary.contactId, lease.residentContactId);
    assert.notEqual(offline.contactId, primary.contactId);
    assert.equal(ok(await call('owner','POST','/api/company/leases',body)).residentContactId, lease.residentContactId);
    // A previous-version application can still write a null bridge during
    // rollout, followed by a membership transfer before the new app takes over.
    await admin.query(`INSERT INTO "LeaseParticipant"(id,"companyId","propertyId","leaseId","userId",name,email,role,"startsOn","createdById","submissionKey","submissionHash","updatedAt")
      VALUES('contact-rollout-party','a','home',$1,'foreign-resident','Historical roster name','historical@test.invalid','leaseholder','2018-01-01','owner','rollout-party','original',NOW())`,[lease.id]);
    const renewal = ok(await call('owner','POST','/api/company/leases',{ ...body,startsOn:'2019-01-01',endsOn:'2019-12-31',status:'draft',previousLeaseId:lease.id,expectedPreviousVersion:3,submissionKey:randomUUID() }));
    assert.equal(renewal.residentContactId, lease.residentContactId);
    const copied = ok(await call('owner','GET',`/api/company/leases/${renewal.id}/participants`)).items;
    assert.ok(copied.some(p => p.contactId === offline.contactId));
    assert.ok(copied.some(p => p.contactId === second.contactId));
    const rollout = (await admin.query(`SELECT "contactId" FROM "LeaseParticipant" WHERE id='contact-rollout-party'`)).rows[0];
    const historical = copied.find(p => p.userId === 'foreign-resident');
    assert.equal(historical.contactId, rollout.contactId);assert.equal(historical.portalApproved,false);
    const contact = (await admin.query(`SELECT "companyId",name,email FROM "ResidentContact" WHERE id=$1`,[rollout.contactId])).rows[0];
    assert.deepEqual(contact,{companyId:'a',name:'Historical roster name',email:'historical@test.invalid'});
    assert.equal((await admin.query(`SELECT count(*)::int n FROM "ResidentContact" WHERE id IN ($1,$2)`,[offline.contactId,second.contactId])).rows[0].n,2);
    // Renewal roster edits are lease-specific. They cannot silently overwrite
    // the shared contact through independent participant versions.
    const {userId:_user,submissionKey:_key,...partyDetails}=details;
    ok(await call('owner','PATCH',`${root}/${offline.id}`,{...partyDetails,name:'Source lease name',expectedVersion:offline.version}));
    const renewalParty=copied.find(p=>p.contactId===offline.contactId);
    ok(await call('owner','PATCH',`/api/company/leases/${renewal.id}/participants/${renewalParty.id}`,{...partyDetails,name:'Renewal lease name',startsOn:renewalParty.startsOn.slice(0,10),expectedVersion:renewalParty.version}));
    assert.equal((await admin.query(`SELECT name FROM "ResidentContact" WHERE id=$1`,[offline.contactId])).rows[0].name,'Record only');
    const names=(await admin.query(`SELECT name FROM "LeaseParticipant" WHERE id IN ($1,$2) ORDER BY name`,[offline.id,renewalParty.id])).rows.map(p=>p.name);
    assert.deepEqual(names,['Renewal lease name','Source lease name']);
  });
  await t.test('failed audit rolls back contact creation together with its lease', async () => {
    await admin.query(`INSERT INTO "User"(id,email,"updatedAt") VALUES('contact-rollback','rollback@test.invalid',NOW());
      INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES('contact-rollback','a','resident',NOW());
      INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','contact-rollback')`);
    const unit = ok(await call('owner','POST','/api/company/properties/home/units',{ label:'Contact rollback unit',submissionKey:randomUUID() }));
    const body = { propertyId:'home',unitId:unit.id,residentId:'contact-rollback',startsOn:'2018-01-01',endsOn:null,monthlyRent:'1.00',status:'draft',submissionKey:randomUUID() };
    await admin.query(`CREATE FUNCTION reject_contact_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='lease.created' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_contact_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_contact_audit()`);
    try {
      assert.equal((await call('owner','POST','/api/company/leases',body)).statusCode,500);
      assert.equal((await admin.query(`SELECT count(*)::int n FROM "ResidentContact" WHERE "userId"='contact-rollback'`)).rows[0].n,0);
    } finally { await admin.query(`DROP TRIGGER reject_contact_audit ON "AuditEvent";DROP FUNCTION reject_contact_audit()`); }
    ok(await call('owner','POST','/api/company/leases',body));
    assert.equal((await admin.query(`SELECT count(*)::int n FROM "ResidentContact" WHERE "userId"='contact-rollback'`)).rows[0].n,1);
  });
}
