import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { registerSessions } from '../dist/sessions.js';
import { registerRentalApplications } from '../dist/rental-applications.js';
import { companyDay } from '../dist/reports.js';

// Fictional records inside the existing exclusive tmpfs leasing fixture only.
export async function acquisitionConsolidationCases(t, admin, call, db, app, providerCalls = []) {
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  const today = companyDay('America/New_York');
  const end = new Date(today + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 30); const future = end.toISOString().slice(0, 10);
  const unit = async label => ok(await call('owner', 'POST', '/api/company/properties/home/units', { label: `Consolidated ${label} ${randomUUID().slice(0, 8)}`, submissionKey: randomUUID() }));
  const lead = async (target, patch = {}) => ok(await call('owner', 'POST', '/api/company/prospects', { propertyId: 'home', unitId: target.id, name: 'Consolidated fictional applicant', email: `acquisition-${randomUUID()}@test.invalid`, phone: '555-0100', source: 'other', desiredMoveIn: future, followUpOn: future, notes: 'Private fixture inquiry', reason: 'Recorded fictional inquiry', submissionKey: randomUUID(), ...patch })).prospect;
  const currentLead = async id => ok(await call('owner', 'GET', `/api/company/prospects/${id}`)).prospect;
  const application = async (person, target, patch = {}) => ok(await call('owner', 'POST', '/api/company/applications', { prospectId: person.id, unitId: target.id, expectedProspectVersion: person.version, notes: 'Private fixture application', submissionKey: randomUUID(), ...patch }));
  const decision = async (row, action, patch = {}) => ok(await call('owner', 'POST', `/api/company/applications/${row.id}/actions`, { action, reason: 'Reviewed fictional application evidence', expectedVersion: row.version, expectedProspectVersion: (await currentLead(row.prospectId)).version, submissionKey: randomUUID(), ...patch }));
  const approve = async row => decision(await decision(await decision(row, 'submit'), 'review'), 'approve');
  const conversion = async row => ({ expectedVersion: row.version, expectedProspectVersion: (await currentLead(row.prospectId)).version, contactId: null, confirmedMatch: true, reason: 'Reviewed the exact fictional applicant and intended draft rental', startsOn: future, endsOn: null, monthlyRent: '1625.37', rentDueDay: 5, graceDays: 3, paymentInstructions: 'Fixture manual instructions', submissionKey: randomUUID() });
  const listing = (forRent, version = null, readiness = null) => ({ forRent, expectedVersion: version, expectedAvailabilityVersion: readiness, reason: 'Explicit fictional owner listing review', submissionKey: randomUUID() });
  const board = async id => ok(await call('owner', 'GET', `/api/company/availability?unitId=${id}`)).items[0];

  await t.test('listing intent starts false independently of current and future recorded occupancy', async () => {
    const tenant = ok(await call('owner', 'POST', '/api/company/resident-contacts', { name: 'Listing fixture resident', email: `listing-${randomUUID()}@test.invalid`, submissionKey: randomUUID() }));
    for (const start of [today, future]) {
      const target = await unit(start === today ? 'occupied' : 'future');
      const lease = ok(await call('owner', 'POST', '/api/company/leases', { propertyId: 'home', unitId: target.id, residentContactId: tenant.id, startsOn: start, endsOn: null, monthlyRent: '1200.00', status: 'active', submissionKey: randomUUID() }));
      const original = await board(target.id); assert.equal(original.listing.forRent, false); assert.equal(original.listing.version, null); assert.equal((original.currentLease || original.nextLease).id, lease.id);
      const payload = listing(true), row = ok(await call('owner', 'POST', `/api/company/units/${target.id}/rental-listing`, payload)); assert.equal(row.forRent, true); assert.ok(row.listedAt);
      const after = await board(target.id); assert.equal(after.state, original.state); assert.equal((after.currentLease || after.nextLease).id, lease.id); assert.equal(after.listing.forRent, true); assert.equal(after.availability, null);
      assert.equal(ok(await call('owner', 'POST', `/api/company/units/${target.id}/rental-listing`, payload)).version, row.version);
    }
  });
  await t.test('only a fresh owner can list and replay, with exact body, company and CSRF boundaries', async () => {
    const target = await unit('listing authority'), path = `/api/company/units/${target.id}/rental-listing`, payload = listing(true);
    for (const actor of ['manager', 'staff', 'resident', 'platform']) assert.equal((await call(actor, 'POST', path, payload)).statusCode, 403);
    assert.equal((await call('foreign', 'POST', path, payload)).statusCode, 404);
    for (const headers of [{ origin: 'https://evil.test' }, { 'x-csrf-token': 'wrong' }, { 'x-company-id': 'b' }]) assert.equal((await call('owner', 'POST', path, payload, headers)).statusCode, 403);
    for (const patch of [{ forRent: 'true' }, { expectedVersion: -1 }, { reason: '' }, { notes: 'Not an allowed field' }]) assert.equal((await call('owner', 'POST', path, { ...payload, ...patch })).statusCode, 400);
    const responses = await Promise.all([call('owner', 'POST', path, payload), call('owner', 'POST', path, payload)]); assert.equal(ok(responses[0]).version, ok(responses[1]).version);
    assert.equal((await call('owner', 'POST', path, { ...payload, forRent: false })).statusCode, 409);
    await admin.query('UPDATE "CompanyMembership" SET role=\'manager\',version=version+1 WHERE "userId"=\'owner\'');
    try { assert.equal((await call('owner', 'POST', path, payload)).statusCode, 403); }
    finally { await admin.query('UPDATE "CompanyMembership" SET role=\'owner\',version=version+1 WHERE "userId"=\'owner\''); }
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AdmissionsEvent" WHERE "submissionKey"=$1', [payload.submissionKey])).rows[0].n, 1);
  });
  await t.test('readiness and listing share the unit fence without overwriting independent state or versions', async () => {
    const target = await unit('readiness fence'), path = `/api/company/units/${target.id}`;
    const reviewed = ok(await call('manager', 'PUT', `${path}/availability`, { condition: 'ready', availableOn: today, reason: 'Fixture condition inspected', expectedVersion: null, submissionKey: randomUUID() })).availability;
    const saved = ok(await call('owner', 'POST', `${path}/rental-listing`, listing(true, null, reviewed.version)));
    const afterListing = await board(target.id); assert.equal(afterListing.availability.version, reviewed.version); assert.equal(afterListing.availability.reason, 'Fixture condition inspected'); assert.equal(afterListing.availability.updatedAt, reviewed.updatedAt);
    const changed = ok(await call('manager', 'PUT', `${path}/availability`, { condition: 'turnover', availableOn: future, reason: 'A later condition review', expectedVersion: reviewed.version, submissionKey: randomUUID() })).availability;
    const afterReadiness = await board(target.id); assert.equal(afterReadiness.listing.version, saved.version); assert.equal(afterReadiness.listing.forRent, true); assert.equal(afterReadiness.listing.listedAt, saved.listedAt);
    assert.equal((await call('owner', 'POST', `${path}/rental-listing`, listing(false, saved.version, reviewed.version))).statusCode, 409);
    const removed = ok(await call('owner', 'POST', `${path}/rental-listing`, listing(false, saved.version, changed.version))); assert.equal(removed.forRent, false); assert.equal(removed.listedAt, null);
    assert.equal((await board(target.id)).availability.version, changed.version);
    const history = ok(await call('manager', 'GET', `${path}/rental-listing/history`)); assert.deepEqual(history.items.map(row => row.action).sort(), ['listed', 'unlisted']);
  });
  await t.test('listing filters cover every matching unit before fifty-row seek pages', async () => {
    const prefix = `Consolidated pages ${randomUUID().slice(0, 8)}`; const rows = [];
    for (let i = 0; i < 52; i++) rows.push(ok(await call('owner', 'POST', '/api/company/properties/home/units', { label: `${prefix} ${String(i).padStart(2, '0')}`, submissionKey: randomUUID() })));
    ok(await call('owner', 'POST', `/api/company/units/${rows[0].id}/rental-listing`, listing(true)));
    const path = `/api/company/availability?q=${encodeURIComponent(prefix)}&listing=not_listed`;
    const first = ok(await call('manager', 'GET', path)), next = ok(await call('manager', 'GET', `${path}&cursor=${first.nextCursor}`));
    assert.equal(first.total, 51); assert.equal(first.items.length, 50); assert.equal(next.items.length, 1); assert.equal(next.total, 51); assert.equal(new Set([...first.items, ...next.items].map(row => row.unit.id)).size, 51); assert.ok([...first.items, ...next.items].every(row => row.listing.forRent === false));
    const listed = ok(await call('owner', 'GET', `/api/company/availability?q=${encodeURIComponent(prefix)}&listing=for_rent`)); assert.equal(listed.total, 1); assert.equal(listed.items[0].unit.id, rows[0].id);
  });
  await t.test('listing source and immutable event roll back together when audit recording fails', async () => {
    const target = await unit('listing rollback'), payload = listing(true), path = `/api/company/units/${target.id}/rental-listing`;
    await admin.query(`CREATE FUNCTION reject_consolidated_listing() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='admissions.unit_listing.listed' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_consolidated_listing BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_consolidated_listing()`);
    try { assert.ok((await call('owner', 'POST', path, payload)).statusCode >= 500); assert.equal((await admin.query('SELECT count(*)::int n FROM "UnitRentalListing" WHERE "unitId"=$1', [target.id])).rows[0].n, 0); assert.equal((await admin.query('SELECT count(*)::int n FROM "AdmissionsEvent" WHERE "submissionKey"=$1', [payload.submissionKey])).rows[0].n, 0); }
    finally { await admin.query('DROP TRIGGER reject_consolidated_listing ON "AuditEvent"; DROP FUNCTION reject_consolidated_listing()'); }
    const saved = ok(await call('owner', 'POST', path, payload)); assert.equal(saved.version, 1); assert.equal(saved.forRent, true);
    await assert.rejects(admin.query('UPDATE "UnitRentalListing" SET "propertyId"=\'other-home\' WHERE "unitId"=$1', [target.id]), /immutable/i);
  });
  await t.test('dated tour and task follow-ups retain full history, exact retry, paging and source scope', async () => {
    const target = await unit('followup'), person = await lead(target), path = `/api/company/prospects/${person.id}/follow-ups`;
    const payload = { kind: 'tour', title: 'Arrange a fictional property viewing', dueOn: future, notes: 'Private fixture follow-up', submissionKey: randomUUID() };
    const first = ok(await call('owner', 'POST', path, payload)); assert.equal(ok(await call('owner', 'POST', path, payload)).id, first.id); assert.equal((await call('owner', 'POST', path, { ...payload, title: 'Different intent' })).statusCode, 409);
    const patch = { kind: first.kind, title: first.title, dueOn: future, notes: first.notes, status: 'completed', expectedVersion: first.version, submissionKey: randomUUID() };
    const changed = ok(await call('manager', 'PATCH', `${path}/${first.id}`, patch)); assert.equal(changed.version, 2); assert.equal(ok(await call('manager', 'PATCH', `${path}/${first.id}`, patch)).version, 2);
    assert.equal(ok(await call('owner', 'GET', `${path}/${first.id}`)).followUp.status, 'completed');
    for (let i = 0; i < 26; i++) ok(await call('owner', 'POST', path, { ...payload, kind: 'task', title: `Fixture task ${i}`, submissionKey: randomUUID() }));
    const detail = ok(await call('owner', 'GET', `/api/company/prospects/${person.id}/acquisition`)); assert.equal(detail.followUps.length, 25); assert.equal(detail.followUpTotal, 27); assert.equal(detail.history.length, 25); assert.equal(detail.historyTotal, 28);
    const one = ok(await call('owner', 'GET', path + '?page=1')), two = ok(await call('owner', 'GET', path + '?page=2')); assert.equal(one.total, 27); assert.equal(two.items.length, 2); assert.equal(new Set([...one.items, ...two.items].map(row => row.id)).size, 27);
    assert.equal(ok(await call('owner', 'GET', path + '?status=completed&kind=tour')).total, 1);
    assert.ok(ok(await call('owner', 'GET', `/api/company/prospects/${person.id}/acquisition-history?page=2`)).items.length > 0);
    assert.equal((await call('foreign', 'GET', `${path}/${first.id}`)).statusCode, 404);
    for (const actor of ['staff', 'resident', 'platform']) assert.equal((await call(actor, 'GET', path)).statusCode, 403);
    await assert.rejects(admin.query('UPDATE "AdmissionsEvent" SET action=\'changed\' WHERE "entityId"=$1', [first.id]), /immutable/i);
    assert.deepEqual(await db.prospectFollowUp.findMany(), []);
  });
  await t.test('application review preserves canonical prospect versions, meaningful stages and access boundaries', async () => {
    const target = await unit('application review'), person = await lead(target), row = await application(person, target);
    assert.equal(row.status, 'draft'); assert.doesNotMatch(JSON.stringify(row), /submissionHash|submissionKey|createdById/);
    const tooEarly = { action: 'approve', reason: 'Cannot approve a draft directly', expectedVersion: row.version, expectedProspectVersion: person.version, submissionKey: randomUUID() };
    assert.equal((await call('owner', 'POST', `/api/company/applications/${row.id}/actions`, tooEarly)).statusCode, 409);
    assert.equal((await call('owner', 'POST', '/api/company/applications', { prospectId: person.id, unitId: target.id, expectedProspectVersion: person.version, submissionKey: randomUUID() })).statusCode, 409);
    let current = await decision(row, 'submit'); const exact = { action: 'review', reason: 'Explicit fixture review', expectedVersion: current.version, expectedProspectVersion: person.version, submissionKey: randomUUID() };
    current = ok(await call('manager', 'POST', `/api/company/applications/${row.id}/actions`, exact)); assert.equal(ok(await call('manager', 'POST', `/api/company/applications/${row.id}/actions`, exact)).version, current.version);
    const edit = { name: person.name, email: person.email, phone: person.phone, source: person.source, desiredMoveIn: future, followUpOn: future, unitId: target.id, notes: 'Changed source while under review', reason: 'Explicit source change', expectedVersion: person.version, submissionKey: randomUUID() };
    assert.equal((await call('owner', 'PATCH', `/api/company/prospects/${person.id}`, edit)).statusCode, 409);
    const raced = await Promise.all(['approve', 'reject'].map(action => call('owner', 'POST', `/api/company/applications/${row.id}/actions`, { ...exact, action, expectedVersion: current.version, submissionKey: randomUUID() })));
    assert.deepEqual(raced.map(response => response.statusCode).sort(), [200, 409]);
    for (const actor of ['staff', 'resident', 'platform']) for (const path of ['/api/company/applications', `/api/company/applications/${row.id}`]) assert.equal((await call(actor, 'GET', path)).statusCode, 403);
    assert.equal((await call('foreign', 'GET', `/api/company/applications/${row.id}`)).statusCode, 404);
    const other = await lead(target), oldVersion = other.version;
    ok(await call('owner', 'POST', `/api/company/prospects/${other.id}/stage`, { stage: 'tour', reason: 'New source review', expectedVersion: other.version, submissionKey: randomUUID() }));
    assert.equal((await call('owner', 'POST', '/api/company/applications', { prospectId: other.id, unitId: target.id, expectedProspectVersion: oldVersion, submissionKey: randomUUID() })).statusCode, 409);
  });
  await t.test('approved conversion creates one exact account-backed draft lease and canonical source history', async () => {
    const target = await unit('application conversion'), person = await lead(target), approved = await approve(await application(person, target)), payload = await conversion(approved);
    const beforeProvider = providerCalls.length;
    const responses = await Promise.all([call('owner', 'POST', `/api/company/applications/${approved.id}/convert`, payload), call('owner', 'POST', `/api/company/applications/${approved.id}/convert`, payload)]);
    const first = ok(responses[0]), second = ok(responses[1]); assert.equal(first.leaseId, second.leaseId); assert.equal(first.contactId, second.contactId);
    const stored = (await admin.query('SELECT * FROM "Lease" WHERE id=$1', [first.leaseId])).rows[0]; assert.equal(stored.status, 'draft'); assert.equal(stored.rentCents, 162537); assert.equal(stored.residentContactId, first.contactId);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "Lease" WHERE "submissionKey"=$1', [payload.submissionKey])).rows[0].n, 1);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "Identity" WHERE "userId"=$1', [stored.residentId])).rows[0].n, 1);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "CompanyMembership" WHERE "userId"=$1', [stored.residentId])).rows[0].n, 0);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ResidentPropertyAssignment" WHERE "userId"=$1', [stored.residentId])).rows[0].n, 0);
    assert.equal((await admin.query('SELECT "portalApproved" FROM "LeaseParticipant" WHERE "leaseId"=$1', [first.leaseId])).rows[0].portalApproved, false);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "RentCharge" WHERE "leaseId"=$1', [first.leaseId])).rows[0].n, 0);
    const linked = await currentLead(person.id); assert.equal(linked.stage, 'converted'); assert.equal(linked.leaseId, first.leaseId); assert.equal(linked.contactId, first.contactId);
    const audit = await admin.query('SELECT snapshot FROM "ProspectAction" WHERE "prospectId"=$1 AND action=\'converted\'', [person.id]); assert.equal(audit.rows.length, 1); assert.equal(audit.rows[0].snapshot.applicationId, approved.id);
    const afterProvider = providerCalls.length; assert.ok(afterProvider >= beforeProvider); assert.equal(ok(await call('owner', 'POST', `/api/company/applications/${approved.id}/convert`, payload)).leaseId, first.leaseId); assert.equal(providerCalls.length, afterProvider, 'Known committed receipt must return before another provider call');
    assert.equal((await call('owner', 'POST', `/api/company/applications/${approved.id}/convert`, { ...payload, monthlyRent: '1700.00' })).statusCode, 409);
    await assert.rejects(admin.query('UPDATE "RentalApplication" SET notes=\'changed\' WHERE id=$1', [approved.id]), /retain/i);
    assert.deepEqual(await db.rentalApplication.findMany(), []);
  });
  await t.test('application conversion requires explicit existing contact review and never merges by email', async () => {
    const target = await unit('existing person'), person = await lead(target);
    const contactRequest = { name: person.name, email: person.email, submissionKey: randomUUID() };
    // Earlier fictional conversions intentionally share this display name.
    // Review that directory warning before creating this distinct email/account.
    const duplicate = await call('owner', 'POST', '/api/company/resident-contacts', contactRequest);
    assert.equal(duplicate.statusCode, 409, duplicate.body); assert.equal(duplicate.json().code, 'POSSIBLE_DUPLICATE');
    const contact = ok(await call('owner', 'POST', '/api/company/resident-contacts', { ...contactRequest, duplicateReviewed: true }));
    const approved = await approve(await application(person, target)), payload = await conversion(approved), path = `/api/company/applications/${approved.id}/convert`;
    const implicit = await call('owner', 'POST', path, payload); assert.equal(implicit.statusCode, 409, implicit.body); assert.equal(implicit.json().code, 'CONTACT_REVIEW_REQUIRED');
    const choices = ok(await call('owner', 'GET', `/api/company/applications/${approved.id}/conversion-candidates`)); assert.ok(choices.items.some(row => row.id === contact.id));
    const explicit = { ...payload, contactId: contact.id, expectedContactVersion: contact.version, submissionKey: randomUUID() };
    const result = ok(await call('owner', 'POST', path, explicit)); assert.equal(result.contactId, contact.id);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ResidentContact" WHERE "companyId"=\'a\' AND lower(email)=lower($1)', [person.email])).rows[0].n, 1);
  });
  await t.test('conversion source records and canonical history roll back with a failed final audit', async () => {
    const target = await unit('conversion rollback'), person = await lead(target), row = await approve(await application(person, target)), payload = await conversion(row), path = `/api/company/applications/${row.id}/convert`;
    await admin.query(`CREATE FUNCTION reject_consolidated_conversion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='lease.created' AND NEW.detail->>'applicationId' IS NOT NULL THEN RAISE EXCEPTION 'fixture final audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_consolidated_conversion BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_consolidated_conversion()`);
    try { assert.ok((await call('owner', 'POST', path, payload)).statusCode >= 500); assert.equal((await admin.query('SELECT count(*)::int n FROM "Lease" WHERE "submissionKey"=$1', [payload.submissionKey])).rows[0].n, 0); assert.equal((await admin.query('SELECT count(*)::int n FROM "ResidentContact" WHERE email=$1', [person.email])).rows[0].n, 0); assert.equal((await currentLead(person.id)).stage, person.stage); assert.equal(ok(await call('owner', 'GET', `/api/company/applications/${row.id}`)).application.leaseId, null); }
    finally { await admin.query('DROP TRIGGER reject_consolidated_conversion ON "AuditEvent"; DROP FUNCTION reject_consolidated_conversion()'); }
    const recovered = ok(await call('owner', 'POST', path, payload)); assert.equal((await currentLead(person.id)).leaseId, recovered.leaseId);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AdmissionsEvent" WHERE "submissionKey"=$1', [payload.submissionKey])).rows[0].n, 1);
  });
  await t.test('fresh authority is rechecked after provider preparation before any account or lease is recorded', async scopeTest => {
    const target = await unit('provider authority'), person = await lead(target), row = await approve(await application(person, target)), payload = await conversion(row);
    let revoke = true, attempts = 0;
    const remote = { user_id: `auth0|acquisition-${randomUUID()}`, email: person.email, name: person.name, email_verified: false, identities: [{ connection: 'Username-Password-Authentication', provider: 'auth0' }] };
    const provider = { issuer: 'https://unused.auth0.com/', databaseConnection: 'Username-Password-Authentication', async create() { attempts++; if (revoke) { revoke = false; await admin.query('UPDATE "CompanyMembership" SET role=\'staff\',version=version+1 WHERE "userId"=\'owner\''); } return remote; }, async get() { return remote; } };
    const isolated = Fastify(); scopeTest.after(() => isolated.close()); const authenticate = await registerSessions(isolated, db, { origin: 'https://app.test', domain: 'unused.auth0.com', clientId: 'test', clientSecret: 'test-only', secure: true }); registerRentalApplications(isolated, db, authenticate, 'https://app.test', provider);
    const invoke = () => isolated.inject({ method: 'POST', url: `/api/company/applications/${row.id}/convert`, headers: { cookie: '__Host-pf-session=token-owner', origin: 'https://app.test', 'x-csrf-token': 'csrf', 'x-company-id': 'a' }, payload });
    try { const denied = await invoke(); assert.equal(denied.statusCode, 403, denied.body); assert.equal(attempts, 1); assert.equal((await admin.query('SELECT count(*)::int n FROM "User" WHERE id=$1', [remote.user_id])).rows[0].n, 0); assert.equal((await admin.query('SELECT count(*)::int n FROM "Lease" WHERE "submissionKey"=$1', [payload.submissionKey])).rows[0].n, 0); }
    finally { await admin.query('UPDATE "CompanyMembership" SET role=\'owner\',version=version+1 WHERE "userId"=\'owner\''); }
    try { const saved = ok(await invoke()); assert.ok(saved.leaseId); assert.equal(attempts, 2); assert.equal((await admin.query('SELECT count(*)::int n FROM "Identity" WHERE "userId"=$1', [remote.user_id])).rows[0].n, 1); assert.equal((await admin.query('SELECT count(*)::int n FROM "CompanyMembership" WHERE "userId"=$1', [remote.user_id])).rows[0].n, 0); }
    finally { await isolated.close(); }
  });
  await t.test('own prospect request lookups recover committed source IDs without disclosing another actor receipt', async () => {
    const target = await unit('prospect receipt'), payload = { propertyId: 'home', unitId: target.id, name: 'Recoverable fictional inquiry', email: `recover-${randomUUID()}@test.invalid`, source: 'email', reason: 'Fixture original request', submissionKey: randomUUID() };
    const person = ok(await call('owner', 'POST', '/api/company/prospects', payload)).prospect;
    const own = ok(await call('owner', 'GET', `/api/company/prospects/recovery/${payload.submissionKey}`)); assert.equal(own.receiptRecorded, true); assert.equal(own.prospect.id, person.id); assert.equal(own.request.id, payload.submissionKey); assert.doesNotMatch(JSON.stringify(own), /submissionHash/);
    const otherActor = ok(await call('manager', 'GET', `/api/company/prospects/recovery/${payload.submissionKey}`)); assert.equal(otherActor.receiptRecorded, false); assert.equal(otherActor.prospect, null);
    assert.equal((await call('owner', 'GET', '/api/company/prospects/recovery/not-a-uuid')).statusCode, 400);
  });
  await t.test('feature read-only and disabled modes govern the new nested routes and keep source reads distinct', async () => {
    const target = await unit('feature controls'), person = await lead(target), row = await application(person, target);
    const original = (await admin.query('SELECT "featureOverrides","overrideExpiresAt" FROM "CompanySubscription" WHERE "companyId"=\'a\'')).rows[0];
    try {
      await admin.query(`INSERT INTO "CompanySubscription"("companyId","updatedById","updatedAt","featureOverrides") VALUES('a','owner',NOW(),$1) ON CONFLICT("companyId") DO UPDATE SET "featureOverrides"=excluded."featureOverrides","overrideExpiresAt"=NULL`, [JSON.stringify({ leasing: 'read_only' })]);
      for (const [path, payload] of [[`/api/company/units/${target.id}/rental-listing`, listing(true)], [`/api/company/prospects/${person.id}/follow-ups`, { kind: 'task', title: 'Blocked write', dueOn: future, submissionKey: randomUUID() }], [`/api/company/applications/${row.id}/actions`, { action: 'submit', reason: 'Read-only test', expectedVersion: row.version, expectedProspectVersion: person.version, submissionKey: randomUUID() }]]) assert.equal((await call('owner', 'POST', path, payload)).statusCode, 403);
      assert.equal((await call('owner', 'GET', `/api/company/applications/${row.id}`)).statusCode, 200);
      await admin.query('UPDATE "CompanySubscription" SET "featureOverrides"=$1 WHERE "companyId"=\'a\'', [JSON.stringify({ leasing: 'disabled' })]);
      for (const path of [`/api/company/applications/${row.id}`, `/api/company/prospects/${person.id}/acquisition`, `/api/company/units/${target.id}/rental-listing/history`]) assert.equal((await call('owner', 'GET', path)).statusCode, 403);
    } finally {
      if (original) await admin.query('UPDATE "CompanySubscription" SET "featureOverrides"=$1,"overrideExpiresAt"=$2 WHERE "companyId"=\'a\'', [original.featureOverrides, original.overrideExpiresAt]);
      else await admin.query('DELETE FROM "CompanySubscription" WHERE "companyId"=\'a\'');
    }
  });
}
