// Fictional records in the existing fresh tmpfs leasing fixture. Every browser
// API request goes through the actual restricted-runtime handler; the identity
// provider remains the leasing fixture's offline stub.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { digest } from '../dist/sessions.js';
import { safeReturnTo } from '../dist/access.js';
import { newFixturePage } from './browser-fixture.mjs';

export async function prospectSourceReturnCases(t, admin, call, db, app, providerCalls) {
  const company = 'return-company', property = 'return-home', chosenUser = 'return-person';
  const origin = process.env.TEST_LEASING_BROWSER_URL;
  const target = new URL(origin);
  assert.equal(target.protocol, 'http:'); assert.equal(target.hostname, '127.0.0.1'); assert.match(target.port, /^\d+$/);
  assert.equal(origin, target.origin, 'browser fixture must be an exact local origin without path, query, credentials or fragment');
  assert.equal(target.username, ''); assert.equal(target.password, '');
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  await admin.query('INSERT INTO "Company"(id,name,timezone,"updatedAt") VALUES($1,\'Fictional source-return company\',\'UTC\',NOW())', [company]);
  for (const [id, role, platform, email, name] of [
    ['return-owner', 'owner', null, 'owner.return@test.invalid', 'Return Owner'],
    ['return-manager', 'manager', null, 'manager.return@test.invalid', 'Return Manager'],
    ['return-staff', 'staff', null, 'staff.return@test.invalid', 'Return Staff'],
    ['return-resident', 'resident', null, 'resident.return@test.invalid', 'Return Resident'],
    ['return-support', null, 'support', 'support.return@test.invalid', 'Return Support'],
    [chosenUser, null, null, 'chosen.return@test.invalid', 'Prepared Return Person'],
    ['return-email-match', null, null, 'inquiry.return@test.invalid', 'Another Exact Identity'],
  ]) {
    await admin.query('INSERT INTO "User"(id,email,name,"emailVerified","platformRole","updatedAt") VALUES($1,$2,$3,true,$4,NOW())', [id, email, name, platform]);
    if (role) await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,$2,$3,NOW())', [id, company, role]);
    await db.session.create({ data: { tokenHash: digest(`token-${id}`), csrfToken: 'csrf', userId: id, expiresAt: new Date(Date.now() + 3600000), idleExpiresAt: new Date(Date.now() + 3600000) } });
  }
  await admin.query('INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES($1,\'Fictional return property\',\'Test street\',\'Town\',\'NY\',\'12345\',$2,NOW())', [property, company]);
  for (const [id, label] of [['return-other-unit', 'A - unrelated unit'], ['return-chosen-unit', 'Z - reviewed unit']])
    await admin.query('INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") VALUES($1,$2,$3,$4,\'return-owner\',$1,\'fixture\',NOW())', [id, company, property, label]);
  const today = ok(await call('return-owner', 'GET', '/api/company/reports/context')).today;
  const source = ok(await call('return-owner', 'POST', '/api/company/prospects', {
    propertyId: property, unitId: 'return-chosen-unit', name: 'Return fixture main inquiry', email: 'inquiry.return@test.invalid', phone: null,
    source: 'phone', desiredMoveIn: null, followUpOn: today, notes: 'Fictional manual handoff', reason: 'Record the fictional source-return inquiry', submissionKey: randomUUID(),
  })).prospect;
  const approved = ok(await call('return-owner', 'POST', `/api/company/prospects/${source.id}/stage`, {
    expectedVersion: source.version, stage: 'approved', reason: 'Fictional manual approval without account or access changes', submissionKey: randomUUID(),
  })).prospect;
  // Real paging, with a selected source on page two and independent destination
  // filters. Controlled fixture IDs put all 50 other matching inquiries first.
  await admin.query('INSERT INTO "Prospect"(id,"companyId","propertyId",name,email,source,"followUpOn",stage,"createdById","updatedAt") SELECT \'zz-return-\'||lpad(n::text,3,\'0\'),$1,$2,\'Return fixture filler \'||n,\'filler-\'||n||\'@test.invalid\',\'phone\',$3::date,\'approved\',\'return-owner\',NOW() FROM generate_series(1,50) n', [company, property, today]);
  const filters = { q: 'Return fixture', propertyId: property, stage: 'approved', due: 'today' };
  const first = ok(await call('return-owner', 'GET', '/api/company/prospects?' + new URLSearchParams(filters)));
  assert.equal(first.total, 51); assert.equal(first.items.length, 50); assert.ok(first.nextCursor);
  const sourceParams = new URLSearchParams({ ...filters, cursor: first.nextCursor, prospectId: source.id });
  const sourcePath = '/company/prospects?' + sourceParams;
  const marker = new URLSearchParams({ prospectId: source.id, prospectQ: filters.q, prospectProperty: property, prospectStage: 'approved', prospectDue: 'today', prospectCursor: first.nextCursor });
  const actualSource = () => call('return-owner', 'GET', `/api/company/prospects/${source.id}`).then(ok).then(row => row.prospect);
  const domainSnapshot = async () => (await admin.query(`SELECT
    (SELECT count(*)::int FROM "User") AS users,
    (SELECT count(*)::int FROM "Identity") AS identities,
    (SELECT count(*)::int FROM "CompanyMembership" WHERE "companyId"=$1) AS memberships,
    (SELECT count(*)::int FROM "ResidentPropertyAssignment" WHERE "companyId"=$1) AS assignments,
    (SELECT count(*)::int FROM "Invitation" WHERE "companyId"=$1) AS invitations,
    (SELECT count(*)::int FROM "ResidentContact" WHERE "companyId"=$1) AS contacts,
    (SELECT count(*)::int FROM "Lease" WHERE "companyId"=$1) AS leases,
    (SELECT count(*)::int FROM "LeaseParticipant" WHERE "companyId"=$1) AS participants,
    (SELECT count(*)::int FROM "LedgerEntry" WHERE "companyId"=$1) AS cash,
    (SELECT count(*)::int FROM "RentCharge" WHERE "companyId"=$1) AS charges,
    (SELECT count(*)::int FROM "RentSchedule" WHERE "companyId"=$1) AS schedules`, [company])).rows[0];
  const mutationCalls = () => providerCalls.filter(([action]) => action !== 'get' && action !== 'list');
  const assertNoPortalAccess = async contactId => {
    const access = (await admin.query(`SELECT
      EXISTS(SELECT 1 FROM "CompanyMembership" WHERE "userId"=$1) AS membership,
      EXISTS(SELECT 1 FROM "ResidentPropertyAssignment" WHERE "userId"=$1) AS assignment,
      EXISTS(SELECT 1 FROM "Invitation" WHERE "accountId"=$1 OR "contactId"=$2) AS invitation`, [chosenUser, contactId])).rows[0];
    assert.deepEqual(access, { membership: false, assignment: false, invitation: false });
    assert.equal((await call(chosenUser, 'GET', '/api/resident/leases')).statusCode, 403);
  };
  const sourceRecords = async () => {
    const rows = await Promise.all([
      admin.query('SELECT * FROM "ResidentContact" WHERE "companyId"=$1 ORDER BY id', [company]),
      admin.query('SELECT * FROM "Lease" WHERE "companyId"=$1 ORDER BY id', [company]),
      admin.query('SELECT * FROM "LeaseParticipant" WHERE "companyId"=$1 ORDER BY id', [company]),
      admin.query('SELECT * FROM "User" WHERE id IN (\'return-person\',\'return-email-match\') ORDER BY id'),
      admin.query('SELECT * FROM "Identity" WHERE "userId" IN (\'return-person\',\'return-email-match\') ORDER BY id'),
    ]);
    return rows.map(result => result.rows);
  };
  const assertMarker = page => {
    const params = new URL(page.url()).searchParams;
    for (const [key, value] of marker) assert.equal(params.get(key), value, key);
  };
  const assertSourceURL = async page => {
    await expect.poll(() => new URL(page.url()).pathname).toBe('/company/prospects');
    const params = new URL(page.url()).searchParams;
    assert.deepEqual(Object.fromEntries(params), Object.fromEntries(sourceParams));
    await expect(page.getByRole('heading', { name: approved.name, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '← Back to prospect', exact: true })).toHaveCount(0);
  };
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const writes = [], apiReads = [], authReturnPaths = [];
  let loseLeaseResponse = true;
  async function fixturePage(actor = 'return-owner') {
    const page = await newFixturePage(browser);
    await page.route('**/api/**', async route => {
      const request = route.request(), parsed = new URL(request.url()), path = parsed.pathname;
      // Telemetry is bookkeeping, never a source mutation or external send.
      if (path === '/api/telemetry') return route.fulfill({ status: 202, json: { accepted: true } });
      assert.ok(![...parsed.searchParams.keys()].some(key => /^prospect(?:Id|Q|Property|Stage|Due|Cursor)$/.test(key)), 'navigation envelope must not enter API selectors');
      if (request.method() === 'GET') apiReads.push(path + parsed.search);
      else if (path !== '/api/account/guide') {
        const body = request.postDataJSON();
        assert.ok(!Object.keys(body || {}).some(key => /^prospect(?:Id|Q|Property|Stage|Due|Cursor)$/.test(key)), 'navigation envelope must not enter domain bodies');
        writes.push({ method: request.method(), path, body });
      }
      if (path === '/api/auth/login') {
        // Capture the real browser sign-in intent and apply the actual compiled
        // return-path validator. OAuth discovery/callback is outside this local
        // navigation regression and must never contact a real provider.
        authReturnPaths.push(parsed.searchParams.get('returnTo'));
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Offline sign-in handoff captured.</p>' });
      }
      const response = await app.inject({ method: request.method(), url: path + parsed.search,
        headers: { ...request.headers(), origin: 'https://app.test', cookie: `__Host-pf-session=token-${actor}` },
        ...(request.postData() ? { payload: request.postData() } : {}) });
      if (request.method() === 'POST' && path === '/api/company/leases' && loseLeaseResponse) {
        assert.equal(response.statusCode, 200, response.body);
        loseLeaseResponse = false;
        return route.abort('failed');
      }
      return route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
    });
    // Every browser request stays on the fixture origin, including forged raw
    // return URL parameters. No provider, customer host or external navigation.
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort('blockedbyclient'));
    return page;
  }
  let contact, lease, converted;

  await t.test('manual saved tenant and draft lease return to the exact approved prospect before explicit conversion', async () => {
    const page = await fixturePage();
    const initial = await domainSnapshot(), initialProviderCalls = mutationCalls().length;
    await page.goto(origin + sourcePath);
    await expect(page.getByRole('heading', { name: approved.name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Review tenant & lease link', exact: true }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Tenants', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tenants', exact: true })).toBeVisible();
    assertMarker(page); assert.equal(writes.length, 0); assert.deepEqual(await domainSnapshot(), initial);
    await page.getByRole('searchbox', { name: 'Find resident', exact: true }).fill('Independent tenant filter');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Independent tenant filter');
    assertMarker(page);
    await page.getByRole('button', { name: 'Add tenant', exact: true }).click();
    await expect(page.getByLabel('Full name *', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Contact email', { exact: true })).toHaveValue('');
    await expect(page.getByRole('combobox', { name: /^Portal invitation/ })).toHaveValue('no');
    await page.getByLabel('Full name *', { exact: true }).fill('Prepared Return Person');
    // The inquiry's matching email belongs to a different exact Identity. The
    // operator deliberately prepares the actual person's different account.
    await page.getByLabel('Contact email', { exact: true }).fill('chosen.return@test.invalid');
    await page.getByRole('button', { name: 'Review tenant', exact: true }).click();
    assert.deepEqual(await domainSnapshot(), initial, 'review is not a save');
    await page.getByRole('button', { name: 'Save tenant', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Prepared Return Person', exact: true })).toBeVisible();
    contact = (await admin.query('SELECT id,"userId",version,email FROM "ResidentContact" WHERE "companyId"=$1', [company])).rows[0];
    assert.equal(contact.userId, chosenUser); assert.equal(contact.email, 'chosen.return@test.invalid');
    assert.equal(new URL(page.url()).pathname, '/company/tenants/' + contact.id); assertMarker(page);
    const afterContact = await domainSnapshot();
    assert.deepEqual(afterContact, { ...initial, contacts: 1 });
    await assertNoPortalAccess(contact.id);
    assert.deepEqual(await actualSource(), approved, 'saving a tenant does not link or change the prospect');
    const contactWrites = writes.filter(row => row.path === '/api/company/resident-contacts');
    assert.equal(contactWrites.length, 1);
    assert.equal(mutationCalls().length, initialProviderCalls + 1, 'only explicit tenant save invokes the offline account preparation');
    assert.equal(mutationCalls().at(-1)[0], 'create');

    await page.getByRole('link', { name: 'Record a lease for Prepared Return Person', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Record a lease', exact: true })).toBeVisible(); assertMarker(page);
    await page.getByLabel('Property for new lease').selectOption(property);
    await expect(page.getByLabel('Unit for new lease')).toHaveValue('return-other-unit');
    await page.getByLabel('Unit for new lease').selectOption('return-chosen-unit');
    await page.getByLabel('Primary resident').selectOption(contact.id);
    await page.getByLabel('New lease start date').fill('2026-11-01');
    await page.getByLabel('New lease end date', { exact: true }).fill('2027-10-31');
    await page.getByLabel('New lease monthly rent (USD)').fill('1234.56');
    await page.getByLabel('New lease status').selectOption('draft');
    await page.getByRole('button', { name: 'Review lease', exact: true }).click();
    assert.deepEqual(await domainSnapshot(), afterContact);
    await page.getByRole('button', { name: 'Create lease record', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Create lease record', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByLabel('Lease section', { exact: true })).toHaveValue('household');
    lease = (await admin.query('SELECT id,"residentContactId","residentId","unitId",status,version FROM "Lease" WHERE "companyId"=$1', [company])).rows[0];
    assert.equal(new URL(page.url()).pathname, '/company/leases/' + lease.id);
    assert.equal(new URL(page.url()).searchParams.get('onboarding'), 'household'); assertMarker(page);
    assert.equal(lease.residentContactId, contact.id); assert.equal(lease.residentId, chosenUser); assert.equal(lease.status, 'draft');
    assert.equal(lease.unitId, 'return-chosen-unit');
    const leaseWrites = writes.filter(row => row.path === '/api/company/leases');
    assert.equal(leaseWrites.length, 2); assert.deepEqual(leaseWrites[1].body, leaseWrites[0].body, 'lost response retains exact reviewed body and durable key');
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'lease.created\' AND "targetId"=$1', [lease.id])).rows[0].n, 1);
    const afterLease = await domainSnapshot();
    assert.deepEqual(afterLease, { ...afterContact, leases: 1, participants: 1 }, 'manual draft lease does not grant account, assignment, portal invitation or billing access');
    await assertNoPortalAccess(contact.id);
    assert.equal((await call(chosenUser, 'GET', `/api/resident/leases/${lease.id}/terms`)).statusCode, 403);
    assert.deepEqual(await actualSource(), approved);
    await page.getByRole('navigation', { name: 'Lease sections', exact: true }).getByRole('button', { name: 'Overview', exact: true }).click(); assertMarker(page);
    await expect(page.getByRole('link', { name: '← Back to prospect', exact: true })).toHaveCount(1);
    const readsBefore = apiReads.filter(path => path.includes('/conversion-options')).length;
    await page.getByRole('link', { name: '← Back to prospect', exact: true }).click(); await assertSourceURL(page);
    await page.getByRole('button', { name: 'Review tenant & lease link', exact: true }).click();
    await expect(page.getByRole('combobox', { name: /^Tenant account/ })).toHaveValue('');
    await expect.poll(() => apiReads.filter(path => path.includes('/conversion-options')).length).toBeGreaterThan(readsBefore);
    await page.getByRole('combobox', { name: /^Tenant account/ }).selectOption(contact.id);
    await expect(page.getByRole('combobox', { name: /^Existing lease/ })).toHaveValue('');
    await page.getByRole('combobox', { name: /^Existing lease/ }).selectOption(lease.id);
    await page.getByLabel('Reason for linking these existing records').fill('Manually confirmed the exact fictional account and reviewed primary lease');
    const beforeConfirmation = writes.length;
    await page.getByRole('button', { name: 'Confirm tenant & lease link', exact: true }).click();
    assert.equal(writes.length, beforeConfirmation, 'manual identity confirmation is required');
    await page.getByRole('checkbox', { name: /^I reviewed the sources and confirm/ }).check();
    await page.getByRole('button', { name: 'Confirm tenant & lease link', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Open linked tenant', exact: true })).toBeVisible();
    converted = await actualSource();
    assert.equal(converted.stage, 'converted'); assert.equal(converted.version, approved.version + 1);
    assert.equal(converted.contactId, contact.id); assert.equal(converted.leaseId, lease.id);
    assert.equal((await admin.query('SELECT version FROM "ResidentContact" WHERE id=$1', [contact.id])).rows[0].version, contact.version);
    assert.equal((await admin.query('SELECT version FROM "Lease" WHERE id=$1', [lease.id])).rows[0].version, lease.version);
    assert.deepEqual(await domainSnapshot(), afterLease);
    assert.equal(writes.filter(row => row.path.endsWith('/convert')).length, 1);
    assert.equal(mutationCalls().length, initialProviderCalls + 1, 'lease setup and explicit conversion never send invitations or merge email identities');
    await page.close();
  });

  await t.test('current and immutable historical sources round-trip without any further source or access writes', async sub => {
    if (!converted) return sub.skip('manual handoff prerequisite did not finish');
    const page = await fixturePage();
    const before = await domainSnapshot(), recordsBefore = await sourceRecords(), beforeWrites = writes.length, beforeProvider = mutationCalls().length;
    await page.goto(origin + sourcePath);
    for (const label of ['Open linked tenant', 'Open linked lease', 'Tenant source from this review', 'Lease source from this review']) {
      await page.getByRole('link', { name: label, exact: true }).first().click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(label.toLowerCase().includes('tenant') ? '/company/tenants/' + contact.id : '/company/leases/' + lease.id);
      assertMarker(page);
      await page.getByRole('link', { name: '← Back to prospect', exact: true }).click(); await assertSourceURL(page);
    }
    assert.equal(writes.length, beforeWrites); assert.equal(mutationCalls().length, beforeProvider);
    assert.deepEqual(await domainSnapshot(), before); assert.deepEqual(await actualSource(), converted);
    // An explicit correction creates new retained history, never undoes the
    // tenant, lease or its account/access sources.
    const reopened = ok(await call('return-owner', 'POST', `/api/company/prospects/${source.id}/reopen-conversion`, {
      expectedVersion: converted.version, confirmedUnlink: true, reason: 'Explicit fictional correction of the handoff reference', submissionKey: randomUUID(),
    })).prospect;
    await page.reload();
    for (const label of ['Previous tenant source', 'Previous lease source']) {
      await page.getByRole('link', { name: label, exact: true }).click(); assertMarker(page);
      await page.getByRole('link', { name: '← Back to prospect', exact: true }).click(); await assertSourceURL(page);
    }
    assert.equal(reopened.stage, 'review'); assert.equal(reopened.contactId, null); assert.equal(reopened.leaseId, null);
    assert.deepEqual(await domainSnapshot(), before); assert.deepEqual(await actualSource(), reopened);
    assert.deepEqual(await sourceRecords(), recordsBefore);
    assert.equal(writes.length, beforeWrites); assert.equal(mutationCalls().length, beforeProvider);
    const history = ok(await call('return-owner', 'GET', `/api/company/prospects/${source.id}/history`)).items;
    assert.equal(history.find(row => row.action === 'converted').snapshot.contactId, contact.id);
    assert.equal(history.find(row => row.action === 'conversion.reopened').snapshot.previousLeaseId, lease.id);
    await page.close();
  });

  await t.test('unavailable and forged navigation context recovers locally while current access gates the return action', async sub => {
    if (!lease) return sub.skip('manual handoff prerequisite did not finish');
    const before = await domainSnapshot(), recordsBefore = await sourceRecords(), sourceBefore = await actualSource(), beforeWrites = writes.length, beforeProvider = mutationCalls().length;
    const page = await fixturePage();
    for (const [path, heading] of [['/company/tenants/missing-return-tenant', 'Tenant unavailable'], ['/company/leases/missing-return-lease', 'Lease unavailable']]) {
      await page.goto(origin + path + '?' + marker);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await page.getByRole('link', { name: '← Back to prospect', exact: true }).click(); await assertSourceURL(page);
    }
    // A marker cannot choose a destination account or become a raw return URL.
    const forged = new URLSearchParams(marker); forged.set('prospectId', 'missing-return-prospect'); forged.set('returnTo', 'https://outside.test/forged'); forged.set('prospectReturnTo', '//outside.test/forged');
    await page.goto(origin + '/company/tenants/' + contact.id + '?' + forged);
    await expect(page.getByRole('heading', { name: 'Prepared Return Person', exact: true })).toBeVisible();
    await page.getByRole('link', { name: '← Back to prospect', exact: true }).click();
    assert.equal(new URL(page.url()).origin, origin); assert.equal(new URL(page.url()).pathname, '/company/prospects');
    assert.equal(new URL(page.url()).searchParams.get('prospectId'), 'missing-return-prospect');
    assert.equal(new URL(page.url()).searchParams.has('returnTo'), false);
    await page.getByRole('button', { name: '← Prospect list', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Prospects & applications', exact: true })).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get('q'), filters.q);
    await page.close();

    const policy = value => admin.query('INSERT INTO "CompanySubscription"("companyId","updatedById","featureOverrides","updatedAt") VALUES($1,\'return-owner\',$2::jsonb,NOW()) ON CONFLICT("companyId") DO UPDATE SET "featureOverrides"=EXCLUDED."featureOverrides","updatedAt"=NOW()', [company, JSON.stringify(value)]);
    for (const actor of ['return-staff', 'return-resident']) {
      const denied = await fixturePage(actor);
      await denied.goto(origin + '/company/leases/' + lease.id + '?' + marker);
      await expect(denied.getByRole('heading', { name: 'Access unavailable', exact: true })).toBeVisible();
      await expect(denied.getByRole('link', { name: '← Back to prospect', exact: true })).toHaveCount(0);
      assert.equal((await call(actor, 'GET', `/api/company/prospects/${source.id}`)).statusCode, 403);
      await denied.close();
    }
    for (const [feature, mode] of [['leasing', 'read_only'], ['leasing', 'disabled'], ['properties', 'disabled']]) {
      await policy({ [feature]: mode });
      try {
        const restricted = await fixturePage();
        await restricted.goto(origin + '/company/leases/' + lease.id + '?' + marker);
        if (mode === 'read_only') {
          await expect(restricted.getByRole('link', { name: '← Back to prospect', exact: true })).toHaveCount(1);
          await restricted.getByRole('link', { name: '← Back to prospect', exact: true }).click(); await assertSourceURL(restricted);
          await expect(restricted.getByRole('button', { name: 'Review stage', exact: true })).toHaveCount(0);
        } else {
          await expect(restricted.getByRole('heading', { name: feature === 'leasing' ? 'Feature unavailable' : 'Fictional return property · Z - reviewed unit', exact: true })).toBeVisible();
          await expect(restricted.getByRole('link', { name: '← Back to prospect', exact: true })).toHaveCount(0);
          assert.equal((await call('return-owner', 'GET', `/api/company/prospects/${source.id}`)).statusCode, 403);
        }
        await restricted.close();
      } finally { await admin.query('DELETE FROM "CompanySubscription" WHERE "companyId"=$1', [company]); }
    }
    ok(await call('return-support', 'POST', '/api/impersonation', { userId: 'return-owner', reason: 'Fictional source navigation support review' }));
    try {
      const support = await fixturePage('return-support');
      await support.goto(origin + '/company/leases/' + lease.id + '?' + marker);
      await expect(support.getByRole('link', { name: '← Back to prospect', exact: true })).toHaveCount(1);
      await support.getByRole('link', { name: '← Back to prospect', exact: true }).click(); await assertSourceURL(support);
      await expect(support.getByRole('button', { name: 'Review stage', exact: true })).toHaveCount(0);
      const bootstrap = ok(await call('return-support', 'GET', '/api/bootstrap'));
      const denied = await call('return-support', 'POST', `/api/company/prospects/${source.id}/stage`, { expectedVersion: sourceBefore.version, stage: 'approved', reason: 'Must remain read-only', submissionKey: randomUUID() }, { 'x-csrf-token': bootstrap.csrfToken, 'x-impersonation-id': bootstrap.impersonation.contextId });
      assert.equal(denied.statusCode, 403);
      await support.close();
    } finally {
      const session = await db.session.findUniqueOrThrow({ where: { tokenHash: digest('token-return-support') } });
      ok(await call('return-support', 'DELETE', '/api/impersonation', undefined, { 'x-csrf-token': session.csrfToken }));
    }
    assert.equal(writes.length, beforeWrites); assert.equal(mutationCalls().length, beforeProvider);
    assert.deepEqual(await domainSnapshot(), before); assert.deepEqual(await actualSource(), sourceBefore);
    assert.deepEqual(await sourceRecords(), recordsBefore);
  });

  await t.test('expired-session sign-in intent preserves the closed saved-lease handoff without contacting OAuth', async sub => {
    if (!lease) return sub.skip('manual handoff prerequisite did not finish');
    const before = await domainSnapshot(), recordsBefore = await sourceRecords(), sourceBefore = await actualSource(), beforeWrites = writes.length;
    const destination = '/company/leases/' + lease.id + '?' + new URLSearchParams({ onboarding: 'household', ...Object.fromEntries(marker) });
    const page = await fixturePage('missing-session');
    await page.goto(origin + destination);
    await expect(page.getByRole('heading', { name: 'Sign in to continue', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
    await expect.poll(() => authReturnPaths.length).toBe(1);
    assert.equal(authReturnPaths[0], destination);
    const accepted = safeReturnTo(authReturnPaths[0]);
    assert.equal(accepted, destination, 'server accepts only the validated local handoff including onboarding and closed source filters');
    await page.close();
    const restored = await fixturePage();
    await restored.goto(origin + accepted);
    await expect(restored.getByLabel('Lease section', { exact: true })).toHaveValue('household'); assertMarker(restored);
    await restored.getByRole('link', { name: '← Back to prospect', exact: true }).click(); await assertSourceURL(restored);
    await restored.close();
    assert.equal(writes.length, beforeWrites); assert.deepEqual(await domainSnapshot(), before);
    assert.deepEqual(await sourceRecords(), recordsBefore); assert.deepEqual(await actualSource(), sourceBefore);
  });
}
