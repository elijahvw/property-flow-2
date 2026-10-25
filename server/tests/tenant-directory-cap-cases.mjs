import assert from 'node:assert/strict';
import { digest } from '../dist/sessions.js';

// These fictional fixtures are private to the disposable finance runner. Bulk
// historical rows deliberately have no account/contact identity where allowed;
// a large old roster must not manufacture people in the tenant directory.
export async function tenantDirectoryCapCases(t, {
  admin, call, ok, directoryPath, historyPath,
}) {
  const legacyPath = '/api/company/resident-profiles';
  const contactPath = id => '/api/company/resident-contacts/' + encodeURIComponent(id);
  const leaseId = (prefix, n) => prefix + '-' + String(n).padStart(5, '0');

  const fixture = async group => {
    const prefix = 'tdcap-' + group;
    const f = {
      prefix, company: prefix + '-company', owner: prefix + '-owner',
      property: prefix + '-property', unit: prefix + '-unit',
    };
    await admin.query('INSERT INTO "Company"(id,name,timezone,"updatedAt") VALUES($1,$2,\'America/New_York\',NOW())', [f.company, 'Fictional tenant cap ' + group]);
    await admin.query('INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES($1,$2,$3,true,NOW())', [f.owner, f.owner + '@test.invalid', 'Fictional tenant cap owner']);
    await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,$2,\'owner\',NOW())', [f.owner, f.company]);
    await admin.query('INSERT INTO "Session"("tokenHash","csrfToken","userId","expiresAt","idleExpiresAt") VALUES($1,\'csrf\',$2,NOW()+interval \'1 hour\',NOW()+interval \'1 hour\')', [digest('token-' + f.owner), f.owner]);
    await admin.query('INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES($1,$2,\'Fictional street\',\'Fictional town\',\'NY\',\'12345\',$3,NOW())', [f.property, 'Fictional cap property ' + group, f.company]);
    await admin.query('INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") VALUES($1,$2,$3,\'Fictional cap unit\',$4,$1,\'fixture\',NOW())', [f.unit, f.company, f.property, f.owner]);
    return f;
  };
  const member = async (f, suffix, name) => {
    const id = f.prefix + '-' + suffix;
    await admin.query('INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES($1,$2,$3,true,NOW())', [id, id + '@test.invalid', name]);
    await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,$2,\'resident\',NOW())', [id, f.company]);
    return id;
  };
  const contact = async (f, suffix, name, userId = null) => {
    const id = f.prefix + '-' + suffix;
    await admin.query('INSERT INTO "ResidentContact"(id,"companyId","userId",name,email,"createdById","submissionKey","submissionHash","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$1,\'fixture\',NOW())', [id, f.company, userId, name, id + '@test.invalid', f.owner]);
    return id;
  };
  const leases = async (f, prefix, count, { contactId, userId = null, status = 'ended', start = 1 } = {}) => {
    await admin.query(`INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentContactId","residentId","createdById","submissionKey","submissionHash","startsOn","endsOn","rentCents",status,"updatedAt")
      SELECT $1||'-'||lpad(n::text,5,'0'),$2,$3,$4,$5,$6,$7,$1||'-key-'||n,'fixture','2020-01-01',
        CASE WHEN $8='ended' THEN '2020-12-31'::date ELSE NULL END,100,$8,NOW()
      FROM generate_series($10::int,$10::int+$9::int-1) n`, [prefix, f.company, f.property, f.unit, contactId, userId, f.owner, status, count, start]);
  };
  const participants = async (f, prefix, count, {
    leasePrefix, perLease = 1000, contactId = null, userId = null, start = 1,
  }) => {
    await admin.query(`INSERT INTO "LeaseParticipant"(id,"companyId","propertyId","leaseId","contactId","userId",name,role,"startsOn","createdById","submissionKey","submissionHash","portalApproved","updatedAt")
      SELECT $1||'-'||lpad(n::text,5,'0'),$2,$3,$4||'-'||lpad((((n-1)/$5::int)+1)::text,5,'0'),$6,$7,
        'Fictional historical participant '||n,'occupant','2020-01-01',$8,$1||'-key-'||n,'fixture',false,NOW()
      FROM generate_series($10::int,$10::int+$9::int-1) n`, [prefix, f.company, f.property, leasePrefix, perLease, contactId, userId, f.owner, count, start]);
  };
  const limited = async (f, path, code) => {
    const response = await call(f.owner, 'GET', path);
    assert.equal(response.statusCode, 422, response.body);
    const body = response.json();
    assert.equal(body.code, code);
    for (const key of ['items', 'rentals', 'rent', 'deposits', 'leases']) assert.equal(Object.hasOwn(body, key), false, key);
  };
  const traverse = async (f, path, total, identity) => {
    const items = [], cursors = new Set();
    let cursor;
    for (let pageNumber = 0; pageNumber <= Math.ceil(total / 50); pageNumber++) {
      const body = ok(await call(f.owner, 'GET', path(cursor ? { cursor } : {})));
      assert.equal(body.companyId, f.company);
      assert.equal(body.total, total);
      assert.equal(body.pageSize, 50);
      assert.ok(body.items.length <= 50);
      if (!pageNumber) assert.equal(body.previousCursor, null);
      items.push(...body.items);
      if (!body.nextCursor) {
        assert.equal(body.nextCursor, null);
        assert.equal(items.length, total);
        assert.equal(new Set(items.map(identity)).size, total);
        return items;
      }
      assert.equal(body.items.length, 50);
      assert.equal(cursors.has(body.nextCursor), false, 'a continuation must advance');
      cursors.add(body.nextCursor);
      cursor = body.nextCursor;
    }
    assert.fail('tenant pagination did not terminate at the complete total');
  };
  const ordinary = async group => {
    const f = await fixture(group);
    f.person = await member(f, 'ordinary-user', 'Fictional ordinary tenant ' + group);
    f.contact = await contact(f, 'ordinary-contact', 'Fictional ordinary tenant ' + group, f.person);
    f.otherContact = await contact(f, 'historical-contact', 'Fictional historical tenant ' + group);
    f.ordinaryLeasePrefix = f.prefix + '-ordinary-lease';
    await leases(f, f.ordinaryLeasePrefix, 1, { contactId: f.contact, userId: f.person });
    return f;
  };
  const available = async f => {
    const directory = ok(await call(f.owner, 'GET', directoryPath({ q: 'Fictional ordinary tenant' })));
    assert.equal(directory.companyId, f.company);
    assert.equal(directory.total, 1);
    assert.equal(directory.items[0].kind, 'contact');
    assert.equal(directory.items[0].id, f.contact);
    assert.equal(directory.items[0].rentalCount, 1);
    const history = ok(await call(f.owner, 'GET', historyPath('contact', f.contact, {})));
    assert.equal(history.total, 1);
    assert.equal(history.items[0].leaseId, leaseId(f.ordinaryLeasePrefix, 1));
    assert.equal(history.nextCursor, null);
    const detail = ok(await call(f.owner, 'GET', contactPath(f.contact)));
    assert.equal(detail.id, f.contact);
    const workspace = ok(await call(f.owner, 'GET', contactPath(f.contact) + '/workspace'));
    assert.equal(workspace.leases.length, 1);
    assert.equal(workspace.leases[0].id, leaseId(f.ordinaryLeasePrefix, 1));
  };

  await t.test('legacy 2,000 logical people remain complete while merged and contact overflow fail explicitly and the paginated directory stays complete', async () => {
    const f = await fixture('people');
    const linkedUser = await member(f, 'linked-user', 'Fictional cap threshold tenant 0001');
    await admin.query(`INSERT INTO "ResidentContact"(id,"companyId","userId",name,email,"createdById","submissionKey","submissionHash","updatedAt")
      SELECT $1||'-contact-'||lpad(n::text,4,'0'),$2,CASE WHEN n=1 THEN $3 ELSE NULL END,
        'Fictional cap threshold tenant '||lpad(n::text,4,'0'),$1||'-contact-'||n||'@test.invalid',$4,$1||'-contact-key-'||n,'fixture',NOW()
      FROM generate_series(1,2000) n`, [f.prefix, f.company, linkedUser, f.owner]);
    const legacy = ok(await call(f.owner, 'GET', legacyPath));
    assert.equal(legacy.length, 2000);
    assert.equal(new Set(legacy.map(row => row.contactId ?? row.userId)).size, 2000);
    assert.equal(legacy.filter(row => row.userId === linkedUser).length, 1, 'linked membership and contact are one logical person');

    const unmatched = await member(f, 'unmatched-user', 'Fictional cap threshold tenant 2001');
    await limited(f, legacyPath, 'TENANT_DIRECTORY_TOO_LARGE');
    const all = await traverse(f, query => directoryPath(query), 2001, row => row.kind + ':' + row.id);
    const expected = new Set(Array.from({ length: 2000 }, (_, index) => 'contact:' + f.prefix + '-contact-' + String(index + 1).padStart(4, '0')));
    expected.add('resident:' + unmatched);
    assert.deepEqual(new Set(all.map(row => row.kind + ':' + row.id)), expected);

    // The logical count stays 2,001 after mapping the unmatched membership,
    // while the independent legacy contact-source cap is now exceeded too.
    const added = await contact(f, 'contact-2001', 'Fictional cap threshold tenant 2001', unmatched);
    await limited(f, legacyPath, 'TENANT_DIRECTORY_TOO_LARGE');
    const complete = ok(await call(f.owner, 'GET', directoryPath({})));
    assert.equal(complete.total, 2001);
    const tail = ok(await call(f.owner, 'GET', directoryPath({ q: 'Fictional cap threshold tenant 2001' })));
    assert.equal(tail.total, 1);
    assert.equal(tail.items[0].id, added);
    assert.equal(tail.items[0].kind, 'contact');
  });

  await t.test('10,001 company leases retain the legacy limit without blocking an ordinary tenant directory, history, detail or workspace', async () => {
    const f = await ordinary('company-leases');
    await leases(f, f.prefix + '-unrelated-lease', 10000, { contactId: f.otherContact });
    await limited(f, legacyPath, 'TENANT_DIRECTORY_TOO_LARGE');
    await available(f);
  });

  await t.test('10,001 company participants retain the legacy limit independently of each lease while ordinary tenant reads stay available', async () => {
    const f = await ordinary('company-participants');
    const prefix = f.prefix + '-unrelated-lease';
    await leases(f, prefix, 11, { contactId: f.otherContact });
    // Unlinked historical roster rows stay below 1,001 on each lease. Only
    // their company-wide sum crosses the legacy association limit.
    await participants(f, f.prefix + '-historical-participant', 10001, { leasePrefix: prefix });
    await limited(f, legacyPath, 'TENANT_DIRECTORY_TOO_LARGE');
    await available(f);
  });

  await t.test('1,001 participants on one unrelated lease retain the legacy limit without capping ordinary tenant reads', async () => {
    const f = await ordinary('lease-participants');
    const prefix = f.prefix + '-unrelated-lease';
    await leases(f, prefix, 1, { contactId: f.otherContact });
    await participants(f, f.prefix + '-historical-participant', 1001, { leasePrefix: prefix, perLease: 1001 });
    await limited(f, legacyPath, 'TENANT_DIRECTORY_TOO_LARGE');
    await available(f);
  });

  await t.test('per-person invitation and financial workspace limits remain explicit while independent leasing history paginates all 1,001 leases', async () => {
    const f = await fixture('person');
    const person = await member(f, 'person-user', 'Fictional person cap tenant');
    const personContact = await contact(f, 'person-contact', 'Fictional person cap tenant', person);
    const prefix = f.prefix + '-person-lease';
    // Drafts qualify for invitation review without violating the one active
    // lease per unit rule. The remaining ended leases are financial history.
    await leases(f, prefix, 100, { contactId: personContact, userId: person, status: 'draft' });
    await participants(f, f.prefix + '-person-participant', 100, { leasePrefix: prefix, perLease: 1, contactId: personContact, userId: person });
    assert.equal(ok(await call(f.owner, 'GET', contactPath(personContact))).leases.length, 100);
    await leases(f, prefix, 1, { contactId: personContact, userId: person, status: 'draft', start: 101 });
    await participants(f, f.prefix + '-person-participant', 1, { leasePrefix: prefix, perLease: 1, contactId: personContact, userId: person, start: 101 });
    await limited(f, contactPath(personContact), 'INVITATION_SCOPE_TOO_LARGE');
    assert.equal(ok(await call(f.owner, 'GET', historyPath('contact', personContact, {}))).total, 101);

    await leases(f, prefix, 899, { contactId: personContact, userId: person, start: 102 });
    const exact = ok(await call(f.owner, 'GET', contactPath(personContact) + '/workspace'));
    assert.equal(exact.leases.length, 1000);
    await leases(f, prefix, 1, { contactId: personContact, userId: person, start: 1001 });
    await limited(f, contactPath(personContact) + '/workspace', 'RESIDENT_WORKSPACE_TOO_LARGE');
    await limited(f, '/api/company/resident-profiles/' + encodeURIComponent(person) + '/workspace', 'RESIDENT_WORKSPACE_TOO_LARGE');
    const all = await traverse(f, query => historyPath('contact', personContact, query), 1001, row => row.leaseId);
    assert.deepEqual(new Set(all.map(row => row.leaseId)), new Set(Array.from({ length: 1001 }, (_, index) => leaseId(prefix, index + 1))));
    const directory = ok(await call(f.owner, 'GET', directoryPath({ q: 'Fictional person cap tenant' })));
    assert.equal(directory.total, 1);
    assert.equal(directory.items[0].rentalCount, 1001);
    assert.equal(directory.items[0].rentals.length, 3);
    assert.equal(ok(await call(f.owner, 'GET', historyPath('resident', person, {}))).total, 1001);
  });
}
