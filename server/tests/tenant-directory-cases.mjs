// Fictional canonical people and historical relationships, used only by the
// existing fresh tmpfs finance runner and its actual restricted runtime API.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { digest } from '../dist/sessions.js';
import { safeReturnTo } from '../dist/access.js';
import { newFixturePage } from './browser-fixture.mjs';
import { tenantDirectoryCapCases } from './tenant-directory-cap-cases.mjs';

export async function tenantDirectoryCases(t, admin, call, app, db, providerCalls) {
  const company = 'td-company', foreignCompany = 'td-foreign', home = 'td-home', garden = 'td-garden';
  const today = new Date().toISOString().slice(0, 10);
  const shift = days => { const value = new Date(today + 'T00:00:00Z'); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  const query = values => { const params = new URLSearchParams(values); return params.size ? '?' + params : ''; };
  const directoryPath = (values = {}) => '/api/company/resident-profiles/directory' + query(values);
  const historyPath = (kind, id, values = {}) => `/api/company/${kind === 'contact' ? 'resident-contacts' : 'resident-profiles'}/${encodeURIComponent(id)}/rentals` + query(values);
  const contactPath = id => '/api/company/resident-contacts/' + encodeURIComponent(id);
  const identity = row => `${row.kind || (row.contactId ? 'contact' : 'resident')}:${row.id || row.contactId || row.userId}`;
  const oldIdentity = row => row.contactId ? 'contact:' + row.contactId : 'resident:' + row.userId;
  const portalState = row => row.portalState || (!row.user ? 'offline' : row.status !== 'active' || row.user.status !== 'active' ? 'disabled' : row.user.emailVerified ? 'active' : 'verification');
  const displayName = row => row.name || row.contactName || row.user?.name || row.email || row.user?.email || 'Tenant';
  const legacyFilter = (rows, filters = {}) => rows.filter(row =>
    `${row.contactName || row.name || ''} ${row.user?.name || ''} ${row.email || row.user?.email || ''} ${row.phone || row.contactPhone || ''} ${(row.rentals || []).map(r => `${r.propertyName} ${r.unitLabel}`).join(' ')}`.toLowerCase().includes((filters.q || '').trim().toLowerCase()) &&
    (!filters.access || filters.access === 'all' || portalState(row) === filters.access) &&
    (filters.rental === 'unassigned' ? !filters.propertyId && !row.rentals.length : (!filters.propertyId && (!filters.rental || filters.rental === 'all')) || row.rentals.some(r => (!filters.propertyId || r.propertyId === filters.propertyId) && (!filters.rental || filters.rental === 'all' || r.status === filters.rental))) &&
    (row.recordStatus || 'active') === (filters.records === 'archived' ? 'archived' : 'active'));
  const addUser = async (id, { companyId = company, role = null, name = id, verified = true, status = 'active', memberStatus = 'active', platformRole = null } = {}) => {
    const email = 'td-' + createHash('sha256').update(id).digest('hex').slice(0, 24) + '@test.invalid';
    await admin.query('INSERT INTO "User"(id,email,name,"emailVerified",status,"platformRole","updatedAt") VALUES($1,$2,$3,$4,$5,$6,NOW())', [id, email, name, verified, status, platformRole]);
    if (role) await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,status,"contactName","updatedAt") VALUES($1,$2,$3,$4,$5,NOW())', [id, companyId, role, memberStatus, name]);
    if (id.length < 100) await db.session.create({ data: { tokenHash: digest('token-' + id), csrfToken: 'csrf', userId: id, expiresAt: new Date(Date.now() + 3600000), idleExpiresAt: new Date(Date.now() + 3600000) } });
    return email;
  };
  const addContact = async (id, { userId = null, name = id, email = id + '@test.invalid', status = 'active' } = {}) => {
    await admin.query('INSERT INTO "ResidentContact"(id,"companyId","userId",name,email,phone,status,"managementNotes","emergencyContactName","createdById","submissionKey","submissionHash","updatedAt") VALUES($1,$2,$3,$4,$5,\'555-0100\',$6,\'PRIVATE DIRECTORY NOTE\',\'PRIVATE EMERGENCY CONTACT\',\'td-owner\',$1,\'fixture\',NOW())', [id, company, userId, name, email, status]);
    return id;
  };
  const addLease = async (id, { contactId = 'td-c-primary', userId = 'td-primary', propertyId = home, status = 'active', start = shift(-20), end = shift(20), label = id } = {}) => {
    const unitId = 'td-unit-' + id;
    await admin.query('INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") VALUES($1,$2,$3,$4,\'td-owner\',$1,\'fixture\',NOW())', [unitId, company, propertyId, label]);
    await admin.query('INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentContactId","residentId","createdById","submissionKey","submissionHash","startsOn","endsOn","rentCents",status,"updatedAt") VALUES($1,$2,$3,$4,$5,$6,\'td-owner\',$1,\'fixture\',$7,$8,123456,$9,NOW())', [id, company, propertyId, unitId, contactId, userId, start, end, status]);
  };
  const addParticipant = async (id, leaseId, { contactId = 'td-c-primary', userId = 'td-primary', propertyId = home, start = shift(-10), end = shift(10), removed = false } = {}) => {
    await admin.query('INSERT INTO "LeaseParticipant"(id,"companyId","propertyId","leaseId","contactId","userId",name,role,"startsOn","endsOn","removedAt","createdById","submissionKey","submissionHash","updatedAt") VALUES($1,$2,$3,$4,$5,$6,\'Fictional historical occupant\',\'occupant\',$7,$8,$9,\'td-owner\',$1,\'fixture\',NOW())', [id, company, propertyId, leaseId, contactId, userId, start, end, removed ? new Date() : null]);
  };
  for (const id of [company, foreignCompany]) await admin.query('INSERT INTO "Company"(id,name,timezone,"updatedAt") VALUES($1,$1,\'UTC\',NOW())', [id]);
  for (const [id, role] of [['td-owner', 'owner'], ['td-manager', 'manager'], ['td-staff', 'staff'], ['td-resident', 'resident']]) await addUser(id, { role });
  await addUser('td-support', { platformRole: 'support' }); await addUser('td-foreign-owner', { companyId: foreignCompany, role: 'owner' });
  for (const [id, name] of [[home, 'Directory Home'], [garden, 'Directory Garden'], ['td-empty-property', 'No rental associations']])
    await admin.query('INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES($1,$2,\'Fictional street\',\'Town\',\'NY\',\'12345\',$3,NOW())', [id, name, company]);
  await addUser('td-primary', { role: 'resident', name: 'Portal Display' }); await addContact('td-c-primary', { userId: 'td-primary', name: 'Directory primary', email: 'contact-primary@test.invalid' });
  await addUser('td-secondary', { role: 'resident', name: 'Other Exact Identity' }); await addContact('td-c-secondary', { userId: 'td-secondary', name: 'Directory secondary', email: 'contact-primary@test.invalid' });
  for (const [id, options] of [['td-disabled', { memberStatus: 'disabled' }], ['td-unverified', { verified: false }], ['td-user-disabled', { status: 'disabled' }], ['td-archived', {}]]) {
    await addUser(id, { role: 'resident', ...options }); await addContact(id + '-contact', { userId: id, name: 'Directory ' + id, status: id === 'td-archived' ? 'archived' : 'active' });
  }
  for (const id of ['td-c-offline', 'td-c-pending', 'td-c-many']) await addContact(id, { name: 'Directory ' + id });
  await admin.query('INSERT INTO "Invitation"(id,"companyId",email,role,"tokenHash","expiresAt","createdBy","contactId") VALUES(\'td-pending-invitation\',$1,\'td-c-pending@test.invalid\',\'resident\',\'td-fake-invitation-hash\',NOW()+interval \'1 day\',\'td-owner\',\'td-c-pending\')', [company]);
  await addUser('td-legacy', { role: 'resident', name: 'Directory legacy name' });
  await addUser('td-assigned-only', { role: 'resident', name: 'Directory assignment only' });
  await admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES($1,$2,\'td-assigned-only\')', [company, home]);
  await addUser('td-transferred', { companyId: foreignCompany, role: 'resident', name: 'PRIVATE FOREIGN PROFILE' });
  await addContact('td-c-transferred', { userId: 'td-transferred', name: 'Directory retained historical' });
  await addUser('td-nonresident', { role: 'manager', name: 'Nonresident role' }); await addContact('td-c-nonresident', { userId: 'td-nonresident', name: 'Directory historical nonresident' });
  await addContact('td-collision', { name: 'Paging tenant' }); await addUser('td-collision', { role: 'resident', name: 'Paging tenant' });
  await admin.query('INSERT INTO "ResidentContact"(id,"companyId",name,email,"updatedAt") SELECT \'td-page-\'||lpad(n::text,3,\'0\'),$1,\'Paging tenant\',\'page-\'||n||\'@test.invalid\',NOW() FROM generate_series(0,100) n', [company]);
  const longId = 'opaque|' + '身'.repeat(1000) + ':' + 'x'.repeat(1088);
  assert.equal(Buffer.byteLength(longId), 4096);
  await addUser(longId, { role: 'resident', name: 'Long anchor 049' });
  await admin.query('UPDATE "CompanyMembership" SET "contactName"=\'Opaque page target\' WHERE "userId"=$1', [longId]);
  for (let n = 0; n < 49; n++) await addUser('a-opaque-page-' + String(n).padStart(3, '0'), { role: 'resident', name: 'Opaque page target' });
  await addUser('zz-opaque-page-tail', { role: 'resident', name: 'Opaque page target' });
  await addLease('td-current-primary'); await addParticipant('td-primary-duplicate', 'td-current-primary');
  await addLease('td-legacy-primary', { contactId: null, propertyId: garden, end: null });
  await addLease('td-clamped-occupant', { contactId: 'td-c-secondary', userId: 'td-secondary', end: shift(10) });
  await addParticipant('td-clamped-party', 'td-clamped-occupant', { start: shift(2), end: shift(5) });
  await addLease('td-ended-future-date', { status: 'ended' });
  await addLease('td-draft-future', { status: 'draft', start: shift(30), end: shift(90) });
  await addLease('td-end-today', { end: today }); await addLease('td-start-today', { start: today });
  await addLease('td-removed-parent', { contactId: 'td-c-secondary', userId: 'td-secondary', propertyId: garden });
  await addParticipant('td-removed-party', 'td-removed-parent', { propertyId: garden, removed: true });
  // Legal denormalized legacy source: the present contact reference wins over
  // a different user's alias. No name/email/account guess may attach person B.
  await addLease('td-mismatch-primary', { userId: 'td-secondary' });
  await addLease('td-mismatch-participant', { contactId: 'td-c-many', userId: null, propertyId: garden });
  await addParticipant('td-mismatch-party', 'td-mismatch-participant', { userId: 'td-secondary', propertyId: garden });
  await addLease('td-long-source', { contactId: null, userId: longId, status: 'ended', end: shift(-1) });
  await addLease('td-legacy-member-source', { contactId: null, userId: 'td-legacy' });
  await addLease('td-transferred-source', { contactId: null, userId: 'td-transferred' });
  await addLease('td-archived-source', { contactId: null, userId: 'td-archived', status: 'ended' });
  for (let n = 0; n < 8; n++) await addLease('td-many-current-' + n, { contactId: 'td-c-many', userId: null, start: shift(-n - 1) });
  await addLease('td-hidden-former', { contactId: 'td-c-many', userId: null, propertyId: garden, status: 'ended', start: shift(-100), end: shift(-50), label: 'Needle %_ Café' });
  for (let n = 0; n <= 50; n++) {
    const suffix = String(n).padStart(3, '0'), id = 'td-return-' + suffix;
    await addContact(id, { name: 'Return browser tenant ' + suffix, status: 'archived' });
    await addLease('td-return-lease-' + suffix, { contactId: id, userId: null, status: 'ended', start: shift(-200), end: shift(-100), label: 'Return rental ' + suffix });
  }
  for (let n = 1; n <= 100; n++) await addLease('td-browser-history-' + String(n).padStart(3, '0'), { contactId: 'td-return-050', userId: null, status: 'ended', start: shift(-200 - n), end: shift(-100), label: 'Browser rental ' + String(n).padStart(3, '0') });

  const collect = async (path, filters = {}, actor = 'td-owner') => {
    const items = [], pages = []; let cursor;
    for (let n = 0; n < 100; n++) {
      const page = ok(await call(actor, 'GET', path({ ...filters, ...(cursor ? { cursor } : {}) })));
      assert.equal(page.companyId, company); assert.equal(page.pageSize, 50); assert.ok(page.items.length <= 50);
      if (pages.length) assert.equal(page.total, pages[0].total);
      items.push(...page.items); pages.push(page);
      if (!page.nextCursor) { assert.equal(items.length, page.total); return { items, pages }; }
      assert.notEqual(page.nextCursor, cursor); assert.match(page.nextCursor, /^[A-Za-z0-9_-]{1,512}$/); cursor = page.nextCursor;
    }
    assert.fail('tenant traversal did not terminate');
  };
  const snapshot = async () => {
    const results = await Promise.all(['ResidentContact', 'CompanyMembership', 'Unit', 'Lease', 'LeaseParticipant', 'Invitation', 'ResidentPropertyAssignment', 'LedgerEntry', 'RentCharge', 'RentSchedule', 'DepositAccount', 'DepositReceipt'].map(table => admin.query(`SELECT * FROM "${table}" AS fixture_record WHERE "companyId"=$1 ORDER BY to_jsonb(fixture_record)::text`, [company])));
    results.push(await admin.query('SELECT * FROM "User" ORDER BY id'), await admin.query('SELECT * FROM "Identity" ORDER BY id'));
    return results.map(result => result.rows);
  };
  const policy = overrides => admin.query('INSERT INTO "CompanySubscription"("companyId","updatedById","featureOverrides","updatedAt") VALUES($1,\'td-owner\',$2::jsonb,NOW()) ON CONFLICT("companyId") DO UPDATE SET "featureOverrides"=EXCLUDED."featureOverrides","updatedAt"=NOW()', [company, JSON.stringify(overrides)]);

  await t.test('paged canonical people preserve bounded legacy identities, portal projections, literal full-history filters and complete property metadata', async () => {
    const before = await snapshot(), providerBefore = providerCalls.length;
    const old = ok(await call('td-owner', 'GET', '/api/company/resident-profiles'));
    const properties = new Map(old.flatMap(row => row.rentals).map(row => [row.propertyId, row.propertyName]));
    const filters = [{}, { q: 'DIRECTORY PRIMARY' }, { q: 'Portal Display contact-primary@' }, { q: '%_' }, { q: '%X_' }, { q: "' OR true --" }, { q: 'PRIVATE FOREIGN PROFILE' }, { propertyId: home, rental: 'former' }, { propertyId: garden, rental: 'current' }, { rental: 'unassigned' }, { propertyId: home, rental: 'unassigned' }, { records: 'archived' }, ...['active', 'verification', 'disabled', 'pending', 'offline'].map(access => ({ access }))];
    for (const filter of filters) {
      const expected = legacyFilter(old, filter), { items, pages } = await collect(directoryPath, filter);
      assert.deepEqual(new Set(items.map(identity)), new Set(expected.map(oldIdentity)), JSON.stringify(filter));
      for (const page of pages) { assert.equal(page.total, expected.length); assert.deepEqual(new Map(page.properties.map(row => [row.id, row.name])), properties); }
      for (const row of items) {
        const previous = expected.find(item => oldIdentity(item) === identity(row));
        assert.equal(row.name, displayName(previous)); assert.equal(portalState(row), portalState(previous));
        assert.equal(row.email || row.user?.email || null, previous.email || previous.user?.email || null);
        assert.equal(row.rentalCount, previous.rentals.length); assert.equal(row.canArchive, previous.canArchive); assert.ok(row.rentals.length <= 3);
        for (const rental of row.rentals) assert.deepEqual(rental, previous.rentals.find(item => item.leaseId === rental.leaseId));
      }
    }
    const all = (await collect(directoryPath)).items;
    assert.equal(all.filter(row => row.contactId === 'td-c-primary').length, 1); assert.equal(all.filter(row => row.contactId === 'td-c-secondary').length, 1, 'equal contact email never merges exact people');
    assert.equal(all.some(row => row.userId === 'td-archived'), false, 'mapped archived contact suppresses active legacy fallback');
    assert.equal(all.find(row => row.contactId === 'td-c-transferred').portalState, 'offline');
    assert.equal(all.find(row => row.contactId === 'td-c-nonresident').portalState, 'offline');
    assert.doesNotMatch(JSON.stringify(all), /PRIVATE DIRECTORY NOTE|PRIVATE EMERGENCY CONTACT|PRIVATE FOREIGN PROFILE|submissionHash|submissionKey|tokenHash|acceptanceUrl|managementNotes|emergencyContactName/);
    assert.deepEqual(await snapshot(), before); assert.equal(providerCalls.length, providerBefore);
  });

  await t.test('independent rental history resolves exact legacy aliases, contact precedence, deduplication, effective dates and matched previews', async () => {
    const old = ok(await call('td-owner', 'GET', '/api/company/resident-profiles'));
    const expected = old.find(row => row.contactId === 'td-c-primary').rentals;
    const contactHistory = await collect(values => historyPath('contact', 'td-c-primary', values));
    assert.deepEqual(contactHistory.items, expected);
    assert.deepEqual((await collect(values => historyPath('resident', 'td-primary', values))).items, expected);
    assert.equal(contactHistory.pages[0].person.kind, 'contact'); assert.equal(contactHistory.pages[0].person.id, 'td-c-primary');
    const rental = id => contactHistory.items.find(row => row.leaseId === id);
    assert.equal(rental('td-current-primary').role, 'leaseholder'); assert.equal(expected.filter(row => row.leaseId === 'td-current-primary').length, 1);
    assert.equal(rental('td-clamped-occupant').startsOn, shift(2)); assert.equal(rental('td-clamped-occupant').endsOn, shift(5)); assert.equal(rental('td-clamped-occupant').status, 'upcoming');
    assert.equal(rental('td-draft-future').status, 'draft'); assert.equal(rental('td-ended-future-date').status, 'former'); assert.equal(rental('td-removed-parent').status, 'former');
    assert.equal(rental('td-end-today').status, 'current'); assert.equal(rental('td-start-today').status, 'current');
    const second = ok(await call('td-owner', 'GET', historyPath('contact', 'td-c-secondary')));
    assert.equal(second.items.some(row => row.leaseId.startsWith('td-mismatch-')), false, 'present contact reference wins over mismatched legacy user alias');
    const transferred = ok(await call('td-owner', 'GET', historyPath('resident', 'td-transferred')));
    assert.equal(transferred.person.id, 'td-c-transferred'); assert.equal(transferred.items[0].leaseId, 'td-transferred-source');
    const archived = ok(await call('td-owner', 'GET', historyPath('resident', 'td-archived')));
    assert.equal(archived.person.id, 'td-archived-contact'); assert.equal(archived.person.recordStatus, 'archived'); assert.equal(archived.items[0].leaseId, 'td-archived-source');
    const match = ok(await call('td-owner', 'GET', directoryPath({ q: 'Needle %_ Café', propertyId: garden, rental: 'former' })));
    assert.equal(match.total, 1); assert.equal(match.items[0].contactId, 'td-c-many'); assert.ok(match.items[0].rentalCount > 3);
    assert.equal(match.items[0].rentals[0].leaseId, 'td-hidden-former');
    assert.equal(ok(await call('td-owner', 'GET', historyPath('contact', 'td-c-many'))).total, match.items[0].rentalCount);
    assert.deepEqual((await collect(values => historyPath('contact', 'td-c-offline', values))).items, []);
    const first = ok(await call('td-owner', 'GET', historyPath('contact', 'td-return-050'))); assert.equal(first.total, 101);
    const next = ok(await call('td-owner', 'GET', historyPath('contact', 'td-return-050', { cursor: first.nextCursor })));
    const back = ok(await call('td-owner', 'GET', historyPath('contact', 'td-return-050', { before: next.previousCursor })));
    assert.deepEqual(back.items, first.items); assert.equal(back.total, 101);
    const anchor = first.items.at(-1);
    await admin.query('UPDATE "Lease" SET "startsOn"=$2,version=version+1 WHERE id=$1', [anchor.leaseId, shift(-999)]);
    try {
      const unavailable = await call('td-owner', 'GET', historyPath('contact', 'td-return-050', { cursor: first.nextCursor }));
      assert.equal(unavailable.statusCode, 404); assert.equal(unavailable.json().code, 'TENANT_CURSOR_UNAVAILABLE');
    } finally { await admin.query('UPDATE "Lease" SET "startsOn"=$2,version=version+1 WHERE id=$1', [anchor.leaseId, anchor.startsOn]); }
  });

  await t.test('tied people traverse both directions without duplicates and opaque full-subject anchors survive within bounded tokens', async () => {
    const { items, pages } = await collect(directoryPath, { q: 'Paging tenant' });
    assert.equal(items.length, 103); assert.equal(new Set(items.map(identity)).size, 103);
    assert.equal(items.filter(row => row.id === 'td-collision').length, 2); assert.deepEqual(new Set(items.filter(row => row.id === 'td-collision').map(row => row.kind)), new Set(['contact', 'resident']));
    for (let index = pages.length - 1; index > 0; index--) {
      const reverse = ok(await call('td-owner', 'GET', directoryPath({ q: 'Paging tenant', before: pages[index].previousCursor })));
      assert.deepEqual(reverse.items.map(identity), pages[index - 1].items.map(identity)); assert.equal(reverse.total, 103);
    }
    const first = ok(await call('td-owner', 'GET', directoryPath({ q: 'Opaque page target' })));
    assert.equal(first.total, 51); assert.equal(first.items.at(-1).userId, longId); assert.match(first.nextCursor, /^[A-Za-z0-9_-]{1,512}$/);
    assert.equal(Buffer.from(first.nextCursor, 'base64url').toString('utf8').includes(longId), false);
    const next = ok(await call('td-owner', 'GET', directoryPath({ q: 'Opaque page target', cursor: first.nextCursor })));
    assert.equal(next.items.length, 1); assert.equal(next.items[0].userId, 'zz-opaque-page-tail');
    const back = ok(await call('td-owner', 'GET', directoryPath({ q: 'Opaque page target', before: next.previousCursor })));
    assert.deepEqual(back.items.map(identity), first.items.map(identity));
  });

  await t.test('cursor scope, changed ordering, canonical member-to-contact transitions and malformed input recover explicitly', async () => {
    const first = ok(await call('td-owner', 'GET', directoryPath({ q: 'page-' }))), cursor = first.nextCursor;
    const denied = async (actor, values, status, code) => { const response = await call(actor, 'GET', directoryPath(values)); assert.equal(response.statusCode, status, response.body); assert.equal(response.json().code, code); assert.equal(Object.hasOwn(response.json(), 'items'), false); };
    for (const values of [{ cursor: '***' }, { cursor: 'a'.repeat(513) }, { cursor, before: cursor }]) await denied('td-owner', values, 400, 'INVALID_TENANT_CURSOR');
    for (const values of [{ q: 'Different query', cursor }, { q: 'page-', access: 'disabled', cursor }, { q: 'page-', records: 'archived', cursor }, { q: 'page-', propertyId: home, cursor }]) await denied('td-owner', values, 404, 'TENANT_CURSOR_UNAVAILABLE');
    await denied('td-manager', { q: 'page-', cursor }, 404, 'TENANT_CURSOR_UNAVAILABLE'); await denied('td-foreign-owner', { q: 'page-', cursor }, 404, 'TENANT_CURSOR_UNAVAILABLE');
    const anchor = first.items.at(-1);
    assert.equal(anchor.kind, 'contact');
    await admin.query('UPDATE "ResidentContact" SET name=\'Renamed outside paging query\',version=version+1 WHERE id=$1', [anchor.id]);
    try { await denied('td-owner', { q: 'page-', cursor }, 404, 'TENANT_CURSOR_UNAVAILABLE'); }
    finally { await admin.query('UPDATE "ResidentContact" SET name=\'Paging tenant\',version=version+1 WHERE id=$1', [anchor.id]); }
    const longFirst = ok(await call('td-owner', 'GET', directoryPath({ q: 'Opaque page target' })));
    await addContact('td-new-long-contact', { userId: longId, name: 'Opaque page target' });
    await denied('td-owner', { q: 'Opaque page target', cursor: longFirst.nextCursor }, 404, 'TENANT_CURSOR_UNAVAILABLE');
    const dayFirst = ok(await call('td-owner', 'GET', directoryPath({ q: 'page-' })));
    await admin.query('UPDATE "Company" SET timezone=\'Pacific/Kiritimati\' WHERE id=$1', [company]);
    try { await denied('td-owner', { q: 'page-', cursor: dayFirst.nextCursor }, 404, 'TENANT_CURSOR_UNAVAILABLE'); }
    finally { await admin.query('UPDATE "Company" SET timezone=\'UTC\' WHERE id=$1', [company]); }
    const crossed = await call('td-owner', 'GET', historyPath('contact', 'td-c-primary', { cursor })); assert.equal(crossed.statusCode, 404); assert.equal(crossed.json().code, 'TENANT_CURSOR_UNAVAILABLE');
    assert.equal((await call('td-owner', 'GET', historyPath('contact', 'td-missing-person'))).statusCode, 404);
    const invalid = await call('td-owner', 'GET', directoryPath({ companyId: foreignCompany })); assert.equal(invalid.statusCode, 400);
    assert.equal((await call('td-owner', 'GET', historyPath('contact', 'td-c-primary', { q: 'not-a-history-filter' }))).statusCode, 400);
  });

  await t.test('fresh runtime scope and leasing-only features govern directory and independent history before complete rows or counts', async () => {
    const paths = [directoryPath(), historyPath('contact', 'td-c-primary'), historyPath('resident', 'td-legacy')];
    for (const path of paths) {
      for (const actor of ['td-staff', 'td-resident', 'platform', 'td-support']) assert.equal((await call(actor, 'GET', path)).statusCode, 403);
      assert.equal((await call('td-owner', 'GET', path, undefined, { 'x-company-id': foreignCompany })).statusCode, 403);
    }
    assert.equal(ok(await call('td-foreign-owner', 'GET', directoryPath({ q: 'Directory primary' }))).total, 0);
    assert.equal((await call('td-foreign-owner', 'GET', historyPath('contact', 'td-c-primary'))).statusCode, 404);
    assert.deepEqual(await db.residentContact.findMany(), []);
    for (const overrides of [{ leasing: 'read_only' }, { properties: 'disabled', finances: 'disabled' }]) {
      await policy(overrides); try { for (const path of paths) assert.equal((await call('td-manager', 'GET', path)).statusCode, 200); }
      finally { await admin.query('DELETE FROM "CompanySubscription" WHERE "companyId"=$1', [company]); }
    }
    await policy({ leasing: 'disabled' }); try { for (const path of paths) assert.equal((await call('td-owner', 'GET', path)).statusCode, 403); }
    finally { await admin.query('DELETE FROM "CompanySubscription" WHERE "companyId"=$1', [company]); }
    await admin.query('UPDATE "Company" SET status=\'suspended\' WHERE id=$1', [company]); try { for (const path of paths) assert.equal((await call('td-owner', 'GET', path)).statusCode, 403); }
    finally { await admin.query('UPDATE "Company" SET status=\'active\' WHERE id=$1', [company]); }
    const leader = await admin.connect(); let pending;
    try {
      await leader.query('BEGIN'); await leader.query('UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=\'td-manager\'');
      pending = call('td-manager', 'GET', directoryPath());
      let blocked = false; for (let n = 0; n < 100; n++) { if ((await admin.query('SELECT 1 FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE \'%User%\'')).rows.length) { blocked = true; break; } await new Promise(resolve => setTimeout(resolve, 10)); } assert.ok(blocked);
      await leader.query('UPDATE "CompanyMembership" SET status=\'disabled\' WHERE "userId"=\'td-manager\''); await leader.query('COMMIT'); assert.equal((await pending).statusCode, 403);
    } finally { await leader.query('ROLLBACK'); leader.release(); if (pending) await pending; await admin.query('UPDATE "CompanyMembership" SET status=\'active\' WHERE "userId"=\'td-manager\''); }
    ok(await call('td-support', 'POST', '/api/impersonation', { userId: 'td-owner', reason: 'Fictional tenant directory support review' }));
    const context = ok(await call('td-support', 'GET', '/api/bootstrap'));
    const supportHeaders = { 'x-csrf-token': context.csrfToken, 'x-impersonation-id': context.impersonation.contextId };
    try {
      const stale = await call('td-support', 'GET', paths[0]); assert.equal(stale.statusCode, 409); assert.equal(stale.json().code, 'IMPERSONATION_CONTEXT_CHANGED'); assert.equal(Object.hasOwn(stale.json(), 'items'), false); assert.equal(Object.hasOwn(stale.json(), 'total'), false);
      for (const path of paths) ok(await call('td-support', 'GET', path, undefined, supportHeaders));
    } finally { ok(await call('td-support', 'DELETE', '/api/impersonation', undefined, supportHeaders)); }
  });

  await t.test('a queued authorized read uses the clock after its User fence when an invitation expires during the wait', async () => {
    const leader = await admin.connect(); let pending;
    await admin.query('UPDATE "Invitation" SET "expiresAt"=clock_timestamp()+interval \'2 seconds\' WHERE id=\'td-pending-invitation\'');
    const before = (await admin.query('SELECT * FROM "Invitation" WHERE id=\'td-pending-invitation\'')).rows[0];
    try {
      await leader.query('BEGIN'); await leader.query('SELECT id FROM "User" WHERE id=\'td-manager\' FOR UPDATE');
      pending = call('td-manager', 'GET', directoryPath({ q: 'Directory td-c-pending', access: 'pending' }));
      let blocked;
      for (let n = 0; n < 100; n++) {
        blocked = (await admin.query('SELECT a.pid,a.xact_start<i."expiresAt" AS "beforeExpiry" FROM pg_stat_activity a CROSS JOIN "Invitation" i WHERE a.datname=current_database() AND cardinality(pg_blocking_pids(a.pid))>0 AND a.query LIKE \'%User%\' AND i.id=\'td-pending-invitation\'')).rows[0];
        if (blocked) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(blocked); assert.equal(blocked.beforeExpiry, true, 'the blocked transaction began before expiry');
      assert.equal((await admin.query('SELECT clock_timestamp()<"expiresAt" AS fresh FROM "Invitation" WHERE id=\'td-pending-invitation\'')).rows[0].fresh, true);
      let expired = false;
      for (let n = 0; n < 300; n++) {
        expired = (await admin.query('SELECT clock_timestamp()>"expiresAt" AS expired FROM "Invitation" WHERE id=\'td-pending-invitation\'')).rows[0].expired;
        if (expired) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(expired, true); await leader.query('COMMIT');
      const result = ok(await pending); assert.equal(result.total, 0); assert.deepEqual(result.items, []);
      assert.deepEqual((await admin.query('SELECT * FROM "Invitation" WHERE id=\'td-pending-invitation\'')).rows[0], before, 'reading expiry does not mutate an invitation or grant');
      assert.equal((await admin.query('SELECT status FROM "CompanyMembership" WHERE "userId"=\'td-manager\'')).rows[0].status, 'active');
    } finally {
      await leader.query('ROLLBACK'); leader.release(); if (pending) await pending;
      await admin.query('UPDATE "Invitation" SET "expiresAt"=NOW()+interval \'1 day\' WHERE id=\'td-pending-invitation\'');
    }
  });

  const canReadCash = async () => (await admin.query('SELECT has_table_privilege(\'propertyflow_runtime\',\'"LedgerEntry"\',\'SELECT\') AS allowed')).rows[0].allowed;
  await t.test('leasing history remains complete when the disposable financial reader is unavailable', async () => {
    // A reversible failure injection restricts only this fresh fixture role.
    // Preserve cash-source constraints and restore precisely its original SELECT
    // grant. Independent leasing discovery must not depend on that cash reader.
    assert.equal(await canReadCash(), true);
    await admin.query('REVOKE SELECT ON "LedgerEntry" FROM propertyflow_runtime');
    try {
      assert.equal(await canReadCash(), false);
      const workspace = await call('td-owner', 'GET', contactPath('td-c-primary') + '/workspace'); assert.equal(workspace.statusCode, 500); assert.equal(Object.hasOwn(workspace.json(), 'rent'), false);
      const history = await collect(values => historyPath('contact', 'td-c-primary', values));
      assert.ok(history.items.some(row => row.leaseId === 'td-legacy-primary')); assert.ok(history.items.some(row => row.leaseId === 'td-current-primary'));
      assert.doesNotMatch(JSON.stringify(history.items), /amountCents|rentCents|deposit|receipt|PRIVATE/);
    } finally { await admin.query('GRANT SELECT ON "LedgerEntry" TO propertyflow_runtime'); }
    assert.equal(await canReadCash(), true);
  });

  await tenantDirectoryCapCases(t, { admin, call, db, ok, directoryPath, historyPath });

  const origin = process.env.TEST_FINANCES_BROWSER_URL;
  let handoffPath, sourceFilters, sourceMarker, directoryCursor, historyCursor;
  const businessWrites = [], authReturns = [];
  let browser;
  if (origin) {
    const target = new URL(origin); assert.equal(target.protocol, 'http:'); assert.equal(target.hostname, '127.0.0.1'); assert.match(target.port, /^\d+$/); assert.equal(origin, target.origin); assert.equal(target.username, ''); assert.equal(target.password, '');
    browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  }
  const fixturePage = async (actor = 'td-owner', options) => {
    const page = await newFixturePage(browser, options);
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (path === '/api/telemetry') return route.fulfill({ status: 202, json: { accepted: true } });
      if (path === '/api/auth/login') {
        authReturns.push(url.searchParams.get('returnTo'));
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Offline sign-in handoff captured.</p>' });
      }
      assert.ok(![...url.searchParams.keys()].some(key => /^prospect(?:Id|Q|Property|Stage|Due|Cursor)$|^tenant(?:Cursor|Before|HistoryCursor|HistoryBefore)$|^rental(?:Cursor|Before)$/.test(key)), 'navigation context stays out of API selectors');
      if (request.method() !== 'GET' && path !== '/api/account/guide') businessWrites.push({ method: request.method(), path });
      const response = await app.inject({ method: request.method(), url: path + url.search,
        headers: { ...request.headers(), origin: 'https://app.test', cookie: '__Host-pf-session=token-' + actor }, ...(request.postData() ? { payload: request.postData() } : {}) });
      return route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
    });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort('blockedbyclient'));
    return page;
  };

  await t.test('real copied directory and independent history pages follow a lease and return with exact filters despite unavailable financial overview', { skip: !origin }, async () => {
    sourceFilters = { q: 'Return browser', access: 'offline', propertyId: home, rental: 'former', records: 'archived' };
    sourceMarker = { prospectId: 'td-navigation-source', prospectQ: 'Independent source filter', prospectProperty: garden, prospectStage: 'approved', prospectDue: 'today', prospectCursor: 'independent-prospect-cursor' };
    const first = ok(await call('td-owner', 'GET', directoryPath(sourceFilters))); assert.equal(first.total, 51); directoryCursor = first.nextCursor;
    const second = ok(await call('td-owner', 'GET', directoryPath({ ...sourceFilters, cursor: directoryCursor }))); assert.equal(second.items.length, 1); assert.equal(second.items[0].id, 'td-return-050');
    const historyFirst = ok(await call('td-owner', 'GET', historyPath('contact', 'td-return-050'))); assert.equal(historyFirst.total, 101); historyCursor = historyFirst.nextCursor;
    const historySecond = ok(await call('td-owner', 'GET', historyPath('contact', 'td-return-050', { cursor: historyCursor })));
    const cleanLease = historySecond.items[0]; assert.notEqual(cleanLease.leaseId, historyFirst.items[0].leaseId);
    const guide = ok(await call('td-owner', 'GET', '/api/account/guide'));
    ok(await call('td-owner', 'PUT', '/api/account/guide', { guideKey: guide.guideKey, expectedVersion: guide.version, status: 'dismissed', step: guide.steps[0].id }));
    const before = await snapshot(), providerBefore = providerCalls.length;
    const page = await fixturePage('td-owner', { viewport: { width: 1440, height: 1000 } });
    const directoryParams = { ...sourceFilters, cursor: directoryCursor, ...sourceMarker };
    assert.equal(await canReadCash(), true); await admin.query('REVOKE SELECT ON "LedgerEntry" FROM propertyflow_runtime'); let financeRestricted = true;
    try {
      await page.goto(origin + '/company/residents' + query(directoryParams));
      await expect(page.getByRole('link', { name: 'View tenant Return browser tenant 050', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Tenant directory', exact: true }).locator('.directory-count')).toContainText('51 tenants');
      await page.getByRole('link', { name: 'View all rentals', exact: true }).click();
      const historyRegion = page.getByRole('region', { name: 'Rental history', exact: true });
      await expect(historyRegion).toContainText('101 recorded rentals');
      await expect(page.getByRole('alert').first()).toBeVisible();
      await historyRegion.getByRole('button', { name: 'Next rentals', exact: true }).click();
      await expect.poll(() => new URL(page.url()).searchParams.get('rentalCursor')).toBe(historyCursor);
      await page.reload();
      await expect(historyRegion.getByRole('link', { name: `${cleanLease.propertyName} · ${cleanLease.unitLabel}`, exact: true })).toBeVisible();
      assert.equal(new URL(page.url()).searchParams.get('cursor'), directoryCursor);
      assert.equal(new URL(page.url()).searchParams.get('prospectCursor'), sourceMarker.prospectCursor);
      assert.equal(await canReadCash(), false, 'independent history loaded while the actual financial reader was unavailable');
      await admin.query('GRANT SELECT ON "LedgerEntry" TO propertyflow_runtime'); financeRestricted = false;
      await historyRegion.getByRole('link', { name: `${cleanLease.propertyName} · ${cleanLease.unitLabel}`, exact: true }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe('/company/leases/' + cleanLease.leaseId);
      await expect(page.getByRole('heading', { name: `${cleanLease.propertyName} · ${cleanLease.unitLabel}`, exact: true })).toBeVisible();
      const context = new URL(page.url()).searchParams;
      assert.equal(context.get('tenantCursor'), directoryCursor); assert.equal(context.get('tenantHistoryCursor'), historyCursor); assert.equal(context.get('tenantQ'), sourceFilters.q); assert.equal(context.get('prospectCursor'), sourceMarker.prospectCursor);
      handoffPath = new URL(page.url()).pathname + new URL(page.url()).search;
      assert.ok(handoffPath.length <= 2048); assert.equal(safeReturnTo(handoffPath), handoffPath);
      await page.getByRole('link', { name: '← Back to tenant', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Return browser tenant 050', exact: true })).toBeVisible();
      assert.equal(new URL(page.url()).searchParams.get('rentalCursor'), historyCursor); assert.equal(new URL(page.url()).searchParams.get('cursor'), directoryCursor);
      await page.getByRole('link', { name: '← All tenants', exact: true }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe('/company/residents');
      assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams), directoryParams);
      await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
      await expect(page.getByRole('link', { name: 'View tenant Return browser tenant 050', exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const anchor = first.items.at(-1);
      await admin.query('UPDATE "ResidentContact" SET name=\'Changed stale browser anchor\',version=version+1 WHERE id=$1', [anchor.id]);
      try {
        await page.reload(); await page.getByRole('button', { name: 'Return to first tenant page', exact: true }).click();
        await expect.poll(() => new URL(page.url()).searchParams.has('cursor')).toBe(false);
        assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams), { ...sourceFilters, ...sourceMarker });
        await expect(page.getByRole('region', { name: 'Tenant directory', exact: true }).locator('.directory-count')).toContainText('50 tenants');
      } finally { await admin.query('UPDATE "ResidentContact" SET name=$2,version=version+1 WHERE id=$1', [anchor.id, anchor.name]); }
      assert.equal(businessWrites.length, 0); assert.equal(providerCalls.length, providerBefore);
      // The only fixture changes were the deliberate ordering correction above;
      // account links, source IDs, grants and money remain exactly unchanged.
      const after = await snapshot();
      const beforeContact = before[0].find(row => row.id === anchor.id), afterContact = after[0].find(row => row.id === anchor.id);
      assert.equal(afterContact.version, beforeContact.version + 2); afterContact.version = beforeContact.version;
      assert.deepEqual(after, before);
    } finally {
      try { await page.close(); } finally { if (financeRestricted) await admin.query('GRANT SELECT ON "LedgerEntry" TO propertyflow_runtime'); }
    }
  });

  await t.test('real expired-session handoff preserves directory, rental-history and prospect cursors through the existing redirect validator', { skip: !origin }, async sub => {
    if (!handoffPath) return sub.skip('source-return prerequisite did not finish');
    const before = await snapshot(), providerBefore = providerCalls.length;
    const page = await fixturePage('td-missing-session'); await page.goto(origin + handoffPath);
    await expect(page.getByRole('heading', { name: 'Sign in to continue', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in', exact: true }).last().click(); await expect.poll(() => authReturns.length).toBe(1);
    assert.equal(authReturns[0], handoffPath); assert.equal(safeReturnTo(authReturns[0]), handoffPath);
    await page.close();
    const restored = await fixturePage(); await restored.goto(origin + safeReturnTo(authReturns[0]));
    await restored.getByRole('link', { name: '← Back to tenant', exact: true }).click();
    await expect(restored.getByRole('heading', { name: 'Return browser tenant 050', exact: true })).toBeVisible();
    const params = new URL(restored.url()).searchParams;
    assert.equal(params.get('q'), sourceFilters.q); assert.equal(params.get('cursor'), directoryCursor); assert.equal(params.get('rentalCursor'), historyCursor); assert.equal(params.get('prospectCursor'), sourceMarker.prospectCursor);
    await restored.close(); assert.equal(businessWrites.length, 0); assert.equal(providerCalls.length, providerBefore); assert.deepEqual(await snapshot(), before);
  });
}
