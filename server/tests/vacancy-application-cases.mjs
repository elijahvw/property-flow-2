import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { registerSessions } from '../dist/sessions.js';
import { registerVacancyApplications } from '../dist/vacancy-applications.js';
import { companyDay } from '../dist/reports.js';

export async function vacancyApplicationCases(t, admin, call, app, db) {
  const ok = response => { assert.equal(response.statusCode,200,response.body); return response.json(); };
  const today=companyDay('America/New_York'), after=new Date(today+'T00:00:00Z');after.setUTCDate(after.getUTCDate()+30);const future=after.toISOString().slice(0,10);
  const unit=async label=>ok(await call('owner','POST','/api/company/properties/home/units',{label:'Admissions '+label,submissionKey:randomUUID()}));
  const vacant=await unit('vacant'), occupied=await unit('occupied'), forthcoming=await unit('future');
  const contact=ok(await call('owner','POST','/api/company/resident-contacts',{name:'Admissions occupancy resident',email:`occupancy-${randomUUID()}@test.invalid`,submissionKey:randomUUID()}));
  const lease=async(u,startsOn)=>ok(await call('owner','POST','/api/company/leases',{propertyId:'home',unitId:u.id,residentContactId:contact.id,startsOn,endsOn:null,monthlyRent:'1500.00',status:'active',submissionKey:randomUUID()}));
  const currentLease=await lease(occupied,today),futureLease=await lease(forthcoming,future);
  let lead,application,followUp;
  const prospectBody=(patch={})=>({propertyId:'home',unitId:vacant.id,name:'Admissions prospect',email:`prospect-${randomUUID()}@test.invalid`,phone:'555-0100',desiredMoveIn:future,notes:'PRIVATE admission management note',submissionKey:randomUUID(),...patch});
  const createProspect=async patch=>ok(await call('owner','POST','/api/company/prospects',prospectBody(patch)));
  const createApplication=async prospect=>ok(await call('owner','POST','/api/company/applications',{prospectId:prospect.id,unitId:vacant.id,notes:'PRIVATE application review',submissionKey:randomUUID()}));
  const action=async(row,verb,reason='Reviewed application evidence')=>ok(await call('owner','POST',`/api/company/applications/${row.id}/actions`,{action:verb,reason,expectedVersion:row.version,submissionKey:randomUUID()}));
  const approve=async row=>action(await action(await action(row,'submit'),'review'),'approve');
  const conversion=(row,patch={})=>({expectedVersion:row.version,contactId:null,startsOn:future,endsOn:null,monthlyRent:'1650.25',rentDueDay:5,graceDays:3,paymentInstructions:'Follow the lease instructions',submissionKey:randomUUID(),...patch});
  await t.test('availability separates real current/future occupancy from versioned operational availability',async()=>{
    const list=ok(await call('owner','GET','/api/company/vacancies?q=Admissions'));
    const current=list.items.find(row=>row.unitId===occupied.id),next=list.items.find(row=>row.unitId===forthcoming.id),empty=list.items.find(row=>row.unitId===vacant.id);
    assert.equal(current.occupancy,'occupied');assert.equal(current.currentLease.id,currentLease.id);assert.equal(next.occupancy,'future');assert.equal(next.nextLease.id,futureLease.id);assert.equal(empty.occupancy,'vacant');assert.equal(empty.version,0);assert.equal(empty.operationalStatus,'unreviewed');
    for(const row of [current,next,empty]){assert.equal(row.forRent,false);assert.equal(row.listedAt,null);}
    const payload={status:'turnover',availableOn:future,notes:'Painting before showing',expectedVersion:0,submissionKey:randomUUID()};
    const replies=await Promise.all([call('owner','POST',`/api/company/units/${occupied.id}/availability`,payload),call('owner','POST',`/api/company/units/${occupied.id}/availability`,payload)]);
    assert.equal(ok(replies[0]).id,ok(replies[1]).id);
    const saved=ok(await call('owner','GET',`/api/company/vacancies?unitId=${occupied.id}`)).items[0];assert.equal(saved.occupancy,'occupied');assert.equal(saved.operationalStatus,'turnover');assert.equal(saved.version,1);
    assert.equal((await call('owner','POST',`/api/company/units/${occupied.id}/availability`,{...payload,notes:'Different'})).statusCode,409);
    assert.equal((await call('manager','POST',`/api/company/units/${occupied.id}/availability`,{...payload,submissionKey:randomUUID()})).statusCode,409);
  });
  await t.test('exact unit handoff resolves beyond list pages and preserves staff property boundaries',async()=>{
    const detail=ok(await call('owner','GET',`/api/company/units/${vacant.id}`));assert.equal(detail.id,vacant.id);assert.equal(detail.propertyId,'home');assert.equal(detail.label,vacant.label);assert.equal(detail.status,'active');assert.equal(detail.version,1);
    assert.equal((await call('foreign','GET',`/api/company/units/${vacant.id}`)).statusCode,404);
    for(const actor of ['resident','platform'])assert.equal((await call(actor,'GET',`/api/company/units/${vacant.id}`)).statusCode,403);
    const before=ok(await call('owner','GET','/api/company/members/staff/property-access'));
    ok(await call('owner','PUT','/api/company/members/staff/property-access',{scope:'selected',propertyIds:['other-home'],maintenanceExecution:false,expectedVersion:before.expectedVersion}));
    try {assert.equal((await call('staff','GET',`/api/company/units/${vacant.id}`)).statusCode,404);}
    finally {const current=ok(await call('owner','GET','/api/company/members/staff/property-access'));ok(await call('owner','PUT','/api/company/members/staff/property-access',{scope:before.scope,propertyIds:before.scope==='selected'?before.propertyIds:[],maintenanceExecution:before.maintenanceExecution,expectedVersion:current.expectedVersion}));}
    assert.equal((await call('owner','GET',`/api/company/units/${vacant.id}?companyId=b`)).statusCode,400);
  });
  await t.test('vacancy totals and summary cover full filters independently of the page',async()=>{
    for(let i=0;i<27;i++)await unit(`page ${String(i).padStart(2,'0')}`);
    const one=ok(await call('owner','GET','/api/company/vacancies?q=Admissions%20page&page=1')),two=ok(await call('owner','GET','/api/company/vacancies?q=Admissions%20page&page=2'));
    assert.equal(one.total,27);assert.equal(one.items.length,25);assert.equal(two.items.length,2);assert.equal(one.summary.vacant,27);assert.equal(one.summary.unreviewed,27);assert.equal(one.summary.forRent,0);assert.equal(one.summary.notListed,27);assert.deepEqual(one.summary,two.summary);
    assert.equal(new Set([...one.items,...two.items].map(row=>row.unitId)).size,27);
    assert.equal((await call('foreign','GET',`/api/company/vacancies?unitId=${vacant.id}`)).statusCode,404);
    assert.equal((await call('owner','GET','/api/company/vacancies?propertyId=foreign-home')).statusCode,404);
  });
  await t.test('only an explicit owner decision lists a real unit and readiness edits retain that intent',async()=>{
    const target=await unit('listing readiness'),path=`/api/company/units/${target.id}`;
    const unitCount=(await admin.query('SELECT count(*)::int n FROM "Unit"')).rows[0].n;
    let row=ok(await call('manager','POST',`${path}/availability`,{status:'available',availableOn:null,notes:'Ready after inspection',expectedVersion:0,submissionKey:randomUUID()}));
    assert.equal(row.forRent,false);assert.equal(row.listedAt,null);
    const listing={forRent:true,expectedVersion:row.version,submissionKey:randomUUID()},responses=await Promise.all([call('owner','POST',`${path}/rental-listing`,listing),call('owner','POST',`${path}/rental-listing`,listing)]);
    row=ok(responses[0]);assert.equal(ok(responses[1]).version,row.version);assert.equal(row.version,2);assert.equal(row.forRent,true);assert.ok(row.listedAt);assert.equal(row.status,'available');
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AdmissionsEvent" WHERE "submissionKey"=$1',[listing.submissionKey])).rows[0].n,1);
    assert.equal((await call('owner','POST',`${path}/rental-listing`,{...listing,forRent:false})).statusCode,409);
    const listedAt=row.listedAt;
    row=ok(await call('manager','POST',`${path}/availability`,{status:'turnover',availableOn:future,notes:'Recheck the lock',expectedVersion:row.version,submissionKey:randomUUID()}));
    assert.equal(row.forRent,true);assert.equal(row.listedAt,listedAt);assert.equal(row.version,3);
    assert.equal((await call('manager','POST',`${path}/availability`,{status:'available',forRent:false,expectedVersion:row.version,submissionKey:randomUUID()})).statusCode,400);
    assert.equal((await call('owner','POST',`${path}/rental-listing`,{forRent:false,expectedVersion:2,submissionKey:randomUUID()})).statusCode,409);
    const unlisting={forRent:false,expectedVersion:row.version,submissionKey:randomUUID()};row=ok(await call('owner','POST',`${path}/rental-listing`,unlisting));assert.equal(row.forRent,false);assert.equal(row.listedAt,null);assert.equal(row.status,'turnover');assert.equal(ok(await call('owner','POST',`${path}/rental-listing`,unlisting)).version,row.version);
    const raced=await Promise.all([call('owner','POST',`${path}/rental-listing`,{forRent:true,expectedVersion:row.version,submissionKey:randomUUID()}),call('manager','POST',`${path}/availability`,{status:'unavailable',availableOn:null,notes:'Concurrent inspection',expectedVersion:row.version,submissionKey:randomUUID()})]);assert.deepEqual(raced.map(r=>r.statusCode).sort(),[200,409]);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "Unit"')).rows[0].n,unitCount);
  });
  await t.test('listing filters count every matching unit and owners can deliberately list occupied or future units',async()=>{
    const pages=ok(await call('owner','GET','/api/company/vacancies?q=Admissions%20page'));
    ok(await call('owner','POST',`/api/company/units/${pages.items[0].unitId}/rental-listing`,{forRent:true,expectedVersion:0,submissionKey:randomUUID()}));
    const one=ok(await call('manager','GET','/api/company/vacancies?q=Admissions%20page&listing=not_listed&page=1')),two=ok(await call('manager','GET','/api/company/vacancies?q=Admissions%20page&listing=not_listed&page=2')),listed=ok(await call('owner','GET','/api/company/vacancies?q=Admissions%20page&listing=for_rent'));
    assert.equal(one.total,26);assert.equal(one.items.length,25);assert.equal(two.items.length,1);assert.equal(listed.total,1);assert.equal(one.summary.forRent,1);assert.equal(one.summary.notListed,26);assert.deepEqual(one.summary,two.summary);assert.deepEqual(one.summary,listed.summary);assert.ok(one.items.every(r=>!r.forRent));assert.ok(listed.items.every(r=>r.forRent));
    for(const [target,occupancy,sourceId] of [[occupied,'occupied',currentLease.id],[forthcoming,'future',futureLease.id]]){
      const before=ok(await call('owner','GET',`/api/company/vacancies?unitId=${target.id}`)).items[0];
      ok(await call('owner','POST',`/api/company/units/${target.id}/rental-listing`,{forRent:true,expectedVersion:before.version,submissionKey:randomUUID()}));
      const after=ok(await call('owner','GET',`/api/company/vacancies?unitId=${target.id}&listing=for_rent`)).items[0];assert.equal(after.forRent,true);assert.equal(after.occupancy,occupancy);assert.equal((after.currentLease??after.nextLease).id,sourceId);
    }
    assert.equal((await call('owner','GET','/api/company/vacancies?listing=automatic')).statusCode,400);
  });
  await t.test('rental listing enforces fresh owner authority even for durable retries and rejects foreign sources',async()=>{
    const target=await unit('listing authority'),path=`/api/company/units/${target.id}/rental-listing`,payload={forRent:true,expectedVersion:0,submissionKey:randomUUID()};
    for(const actor of ['manager','staff','resident','platform'])assert.equal((await call(actor,'POST',path,payload)).statusCode,403);
    assert.equal((await call('foreign','POST',path,payload)).statusCode,404);
    for(const headers of [{origin:'https://evil.test'},{'x-csrf-token':'wrong'},{'x-company-id':'b'}])assert.equal((await call('owner','POST',path,payload,headers)).statusCode,403);
    for(const patch of [{forRent:'true'},{expectedVersion:-1},{expectedVersion:Number.MAX_SAFE_INTEGER+1},{notes:'An extra field'}])assert.equal((await call('owner','POST',path,{...payload,...patch})).statusCode,400);
    const saved=ok(await call('owner','POST',path,payload));assert.equal(saved.forRent,true);
    await admin.query('UPDATE "CompanyMembership" SET role=\'manager\' WHERE "userId"=\'owner\'');
    try {assert.equal((await call('owner','POST',path,payload)).statusCode,403);}
    finally {await admin.query('UPDATE "CompanyMembership" SET role=\'owner\' WHERE "userId"=\'owner\'');}
    const events=(await admin.query('SELECT action,snapshot FROM "AdmissionsEvent" WHERE "entityId"=$1 ORDER BY "createdAt",id',[saved.id])).rows;assert.equal(events.length,1);assert.equal(events[0].action,'listed');assert.equal(events[0].snapshot.forRent,true);
  });
  await t.test('listing and immutable history roll back with audit failure and the same request safely retries',async()=>{
    const target=await unit('listing rollback'),path=`/api/company/units/${target.id}/rental-listing`,payload={forRent:true,expectedVersion:0,submissionKey:randomUUID()};
    await admin.query(`CREATE FUNCTION reject_admissions_listing() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='admissions.availability.listed' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_admissions_listing BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_admissions_listing()`);
    try {assert.ok((await call('owner','POST',path,payload)).statusCode>=500);assert.equal((await admin.query('SELECT count(*)::int n FROM "UnitAvailability" WHERE "unitId"=$1',[target.id])).rows[0].n,0);assert.equal((await admin.query('SELECT count(*)::int n FROM "AdmissionsEvent" WHERE "submissionKey"=$1',[payload.submissionKey])).rows[0].n,0);}
    finally {await admin.query('DROP TRIGGER reject_admissions_listing ON "AuditEvent"; DROP FUNCTION reject_admissions_listing()');}
    const saved=ok(await call('owner','POST',path,payload));assert.equal(saved.forRent,true);assert.equal(saved.status,'unreviewed');assert.equal(saved.version,1);
    await assert.rejects(admin.query('UPDATE "UnitAvailability" SET "listedAt"=NULL WHERE id=$1',[saved.id]),/listing_timestamp_check/);
    assert.deepEqual(await db.unitAvailability.findMany(),[]);
  });
  await t.test('admissions denies default staff, residents and platform-only access and requires CSRF/company boundaries',async()=>{
    for(const actor of ['staff','resident','platform'])for(const path of ['/api/company/vacancies','/api/company/prospects','/api/company/applications'])assert.equal((await call(actor,'GET',path)).statusCode,403);
    for(const actor of ['staff','resident','platform'])assert.equal((await call(actor,'POST','/api/company/prospects',prospectBody())).statusCode,403);
    for(const headers of [{origin:'https://evil.test'},{'x-csrf-token':'wrong'},{'x-company-id':'b'}])assert.equal((await call('owner','POST','/api/company/prospects',prospectBody(),headers)).statusCode,403);
    assert.equal((await call('owner','POST','/api/company/prospects',prospectBody({propertyId:'foreign-home'}))).statusCode,404);
    assert.equal((await call('owner','POST','/api/company/prospects',prospectBody({dateOfBirth:'2000-01-01'}))).statusCode,400);
    assert.equal((await call('owner','POST','/api/company/prospects',prospectBody({ssn:'sensitive-value'}))).statusCode,400);
    assert.equal((await call('owner','POST','/api/company/prospects',prospectBody({desiredMoveIn:'2026-02-30'}))).statusCode,400);
  });
  await t.test('prospects and dated tours preserve retry identity, field versions and immutable histories',async()=>{
    const payload=prospectBody(),responses=await Promise.all([call('owner','POST','/api/company/prospects',payload),call('owner','POST','/api/company/prospects',payload)]);lead=ok(responses[0]);assert.equal(ok(responses[1]).id,lead.id);assert.equal((await call('owner','POST','/api/company/prospects',{...payload,name:'Changed'})).statusCode,409);
    assert.doesNotMatch(JSON.stringify(lead),/submissionKey|submissionHash|createdById|companyId/);
    const body={kind:'tour',title:'View the apartment',dueOn:future,notes:'Call before arrival',submissionKey:randomUUID()};followUp=ok(await call('owner','POST',`/api/company/prospects/${lead.id}/follow-ups`,body));assert.equal(ok(await call('owner','POST',`/api/company/prospects/${lead.id}/follow-ups`,body)).id,followUp.id);
    const patch={...body,status:'completed',expectedVersion:followUp.version,submissionKey:randomUUID()};delete patch.submissionHash;
    const changed=ok(await call('manager','PATCH',`/api/company/prospects/${lead.id}/follow-ups/${followUp.id}`,patch));assert.equal(changed.version,2);assert.equal((await call('owner','PATCH',`/api/company/prospects/${lead.id}/follow-ups/${followUp.id}`,{...patch,submissionKey:randomUUID()})).statusCode,409);
    const detail=ok(await call('owner','GET',`/api/company/prospects/${lead.id}`));assert.equal(detail.followUps[0].status,'completed');assert.ok(detail.history.some(event=>event.action==='edited'));
    assert.equal((await call('foreign','GET',`/api/company/prospects/${lead.id}`)).statusCode,404);
    assert.equal((await call('resident','GET',`/api/company/prospects/${lead.id}`)).statusCode,403);
    await assert.rejects(db.$executeRaw`UPDATE "AdmissionsEvent" SET action='changed'`,/permission denied|immutable/i);
    assert.deepEqual(await db.leasingProspect.findMany(),[]);
  });
  await t.test('prospect follow-up and history pages remain complete beyond the detail preview',async()=>{
    for(let i=0;i<26;i++)ok(await call('owner','POST',`/api/company/prospects/${lead.id}/follow-ups`,{kind:'task',title:`Leasing follow-up ${i}`,dueOn:future,notes:'Call the prospect',submissionKey:randomUUID()}));
    const detail=ok(await call('owner','GET',`/api/company/prospects/${lead.id}`));assert.equal(detail.followUps.length,25);assert.equal(detail.followUpTotal,27);assert.equal(detail.history.length,25);assert.ok(detail.historyTotal>25);
    const one=ok(await call('owner','GET',`/api/company/prospects/${lead.id}/follow-ups?page=1`)),two=ok(await call('owner','GET',`/api/company/prospects/${lead.id}/follow-ups?page=2`));assert.equal(one.total,27);assert.equal(two.items.length,2);assert.equal(new Set([...one.items,...two.items].map(row=>row.id)).size,27);
    const history=ok(await call('owner','GET',`/api/company/prospects/${lead.id}/history?page=2`));assert.equal(history.total,detail.historyTotal);assert.ok(history.items.length>0);
    const completed=ok(await call('owner','GET',`/api/company/prospects/${lead.id}/follow-ups?status=completed&kind=tour`));assert.equal(completed.total,1);
  });
  await t.test('application review is staged, reasoned, versioned and recoverable without creating access or money',async()=>{
    application=await createApplication(lead);assert.equal(application.status,'draft');
    assert.equal((await call('owner','POST',`/api/company/applications/${application.id}/actions`,{action:'approve',reason:'Too early',expectedVersion:1,submissionKey:randomUUID()})).statusCode,409);
    const submit={action:'submit',reason:'Application checked',expectedVersion:1,submissionKey:randomUUID()};application=ok(await call('owner','POST',`/api/company/applications/${application.id}/actions`,submit));assert.equal(application.status,'submitted');assert.equal(ok(await call('owner','POST',`/api/company/applications/${application.id}/actions`,submit)).version,2);
    const edits={unitId:lead.unitId,name:lead.name,email:lead.email,phone:lead.phone,desiredMoveIn:lead.desiredMoveIn?.slice(0,10),notes:lead.notes,status:'open',expectedVersion:lead.version,submissionKey:randomUUID()};assert.equal((await call('owner','PATCH',`/api/company/prospects/${lead.id}`,edits)).statusCode,409);
    application=await action(application,'review');
    const requests=await Promise.all(['approve','reject'].map(verb=>call('owner','POST',`/api/company/applications/${application.id}/actions`,{action:verb,reason:'Reviewed evidence',expectedVersion:application.version,submissionKey:randomUUID()})));
    assert.deepEqual(requests.map(r=>r.statusCode).sort(),[200,409]);application=requests.find(r=>r.statusCode===200).json();
    if(application.status==='rejected')application=await action(await action(application,'reopen'),'approve');
    const detail=ok(await call('manager','GET',`/api/company/applications/${application.id}`));assert.ok(detail.history.some(event=>event.reason==='Reviewed evidence'));assert.equal(detail.application.leaseId,null);assert.equal(detail.application.contactId,null);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "CompanyMembership" WHERE "userId" IN (SELECT id FROM "User" WHERE email=$1)',[lead.email])).rows[0].n,0);
  });
  await t.test('approved conversion creates one actual linked draft lease and exact account under response retries',async()=>{
    const payload=conversion(application),responses=await Promise.all([call('owner','POST',`/api/company/applications/${application.id}/convert`,payload),call('owner','POST',`/api/company/applications/${application.id}/convert`,payload)]);
    const first=ok(responses[0]),second=ok(responses[1]);assert.equal(first.leaseId,second.leaseId);assert.equal(first.contactId,second.contactId);application=first.application;
    const stored=(await admin.query('SELECT * FROM "Lease" WHERE id=$1',[first.leaseId])).rows[0];assert.equal(stored.status,'draft');assert.equal(stored.rentCents,165025);assert.equal(stored.residentContactId,first.contactId);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "Lease" WHERE "submissionKey"=$1',[payload.submissionKey])).rows[0].n,1);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "Identity" WHERE "userId"=$1',[stored.residentId])).rows[0].n,1);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "CompanyMembership" WHERE "userId"=$1',[stored.residentId])).rows[0].n,0);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ResidentPropertyAssignment" WHERE "userId"=$1',[stored.residentId])).rows[0].n,0);
    assert.equal((await admin.query('SELECT "portalApproved" FROM "LeaseParticipant" WHERE "leaseId"=$1',[first.leaseId])).rows[0].portalApproved,false);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1',[first.leaseId])).rows[0].n,0);
    assert.equal((await call('owner','POST',`/api/company/applications/${application.id}/convert`,{...payload,monthlyRent:'1800.00'})).statusCode,409);
    assert.equal((await call('owner','POST',`/api/company/applications/${application.id}/convert`,conversion(application))).statusCode,409);
    assert.equal((await call('owner','PATCH',`/api/company/applications/${application.id}`,{notes:'Rewrite completed decision',expectedVersion:application.version,submissionKey:randomUUID()})).statusCode,409);
    await assert.rejects(admin.query('UPDATE "RentalApplication" SET "leaseId"=NULL,"contactId"=NULL WHERE id=$1',[application.id]),/retain/i);
    assert.ok(first.leaseHref.includes(first.leaseId));assert.ok(first.contactHref.includes(first.contactId));
  });
  await t.test('explicit existing-contact selection exposes narrow candidates and preserves one exact mapped identity',async()=>{
    const existing=ok(await call('owner','POST','/api/company/resident-contacts',{name:'Existing admissions tenant',email:`existing-${randomUUID()}@test.invalid`,submissionKey:randomUUID()}));
    const parent=await createProspect({email:existing.email,name:'Returning applicant'});let row=await approve(await createApplication(parent));
    const candidates=ok(await call('manager','GET',`/api/company/applications/${row.id}/conversion-candidates`));assert.equal(candidates.items.length,1);assert.equal(candidates.items[0].id,existing.id);assert.doesNotMatch(JSON.stringify(candidates),/managementNotes|compatibilityProfile|emergency/);
    const payload=conversion(row,{contactId:existing.id,expectedContactVersion:existing.version});assert.equal((await call('owner','POST',`/api/company/applications/${row.id}/convert`,{...payload,expectedContactVersion:existing.version+1})).statusCode,409);
    const result=ok(await call('owner','POST',`/api/company/applications/${row.id}/convert`,payload));assert.equal(result.contactId,existing.id);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ResidentContact" WHERE "companyId"=\'a\' AND "userId"=$1',[existing.userId])).rows[0].n,1);
  });
  await t.test('audit failure rolls back all local conversion sources and the original request can safely retry',async()=>{
    const parent=await createProspect({name:'Rollback applicant'}),row=await approve(await createApplication(parent)),payload=conversion(row);
    await admin.query(`CREATE FUNCTION reject_admissions_conversion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='admissions.application.converted' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_admissions_conversion BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_admissions_conversion()`);
    try {
      assert.ok((await call('owner','POST',`/api/company/applications/${row.id}/convert`,payload)).statusCode>=500);
      assert.equal((await admin.query('SELECT count(*)::int n FROM "Lease" WHERE "submissionKey"=$1',[payload.submissionKey])).rows[0].n,0);
      assert.equal((await admin.query('SELECT count(*)::int n FROM "ResidentContact" WHERE email=$1',[parent.email])).rows[0].n,0);
      assert.equal(ok(await call('owner','GET',`/api/company/applications/${row.id}`)).application.leaseId,null);
    } finally {await admin.query('DROP TRIGGER reject_admissions_conversion ON "AuditEvent"; DROP FUNCTION reject_admissions_conversion()');}
    assert.ok(ok(await call('owner','POST',`/api/company/applications/${row.id}/convert`,payload)).leaseId);
  });
  await t.test('fresh suspension after provider account preparation blocks the final conversion without local grants',async()=>{
    const parent=await createProspect({name:'Authority race applicant'}),row=await approve(await createApplication(parent)),payload=conversion(row);
    let enteredResolve,releaseResolve;const entered=new Promise(r=>enteredResolve=r),release=new Promise(r=>releaseResolve=r);
    const isolated=Fastify();const auth=await registerSessions(isolated,db,{origin:'https://app.test',domain:'unused.auth0.com',clientId:'test',clientSecret:'test-only',secure:true});
    registerVacancyApplications(isolated,db,auth,'https://app.test',{issuer:'https://unused.auth0.com/',async create(email,name){enteredResolve();await release;return {user_id:'auth0|admissions-suspended-'+randomUUID(),email,name,email_verified:false};}});
    const pending=isolated.inject({method:'POST',url:`/api/company/applications/${row.id}/convert`,headers:{cookie:'__Host-pf-session=token-owner',origin:'https://app.test','x-csrf-token':'csrf'},payload});
    try {await Promise.race([entered,new Promise((_,reject)=>setTimeout(()=>reject(new Error("Provider preparation barrier not reached")),5000))]);await admin.query('UPDATE "Company" SET status=\'suspended\' WHERE id=\'a\'');releaseResolve();const result=await pending;assert.equal(result.statusCode,403,result.body);assert.equal((await admin.query('SELECT "leaseId" FROM "RentalApplication" WHERE id=$1',[row.id])).rows[0].leaseId,null);assert.equal((await admin.query('SELECT count(*)::int n FROM "Lease" WHERE "submissionKey"=$1',[payload.submissionKey])).rows[0].n,0);}
    finally {releaseResolve();await pending;await admin.query('UPDATE "Company" SET status=\'active\' WHERE id=\'a\'');await isolated.close();}
  });
  await t.test('application list counts full filters and cross-company IDs never reveal private admissions notes',async()=>{
    const own=ok(await call('owner','GET','/api/company/applications?propertyId=home')),foreign=ok(await call('foreign','GET','/api/company/applications'));assert.ok(own.total>=4);assert.equal(foreign.total,0);
    for(const actor of ['staff','resident','platform'])assert.equal((await call(actor,'GET',`/api/company/applications/${application.id}`)).statusCode,403);
    for(const path of [`/api/company/applications/${application.id}`,`/api/company/applications/${application.id}/history`,`/api/company/applications/${application.id}/conversion-candidates`]){const response=await call('foreign','GET',path);assert.equal(response.statusCode,404);assert.doesNotMatch(response.body,/PRIVATE/);}
    assert.deepEqual(await db.rentalApplication.findMany(),[]);assert.deepEqual(await db.admissionsEvent.findMany(),[]);
    const rls=(await admin.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])`,[['UnitAvailability','LeasingProspect','ProspectFollowUp','RentalApplication','AdmissionsEvent']])).rows;assert.equal(rls.length,5);for(const table of rls){assert.equal(table.relrowsecurity,true);assert.equal(table.relforcerowsecurity,true);}
  });
}
