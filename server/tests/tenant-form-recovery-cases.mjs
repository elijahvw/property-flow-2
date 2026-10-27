// Existing users runner: fictional accounts, offline identity provider/mailer,
// real sessions and restricted runtime handlers in its own fresh tmpfs database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { digest } from '../dist/sessions.js';
import { newFixturePage, launchFixtureBrowser } from './browser-fixture.mjs';
import { tenantAdminCompatCases } from './tenant-admin-compat-cases.mjs';

export async function tenantFormRecoveryCases(t, { admin, db, call, app, provider, remote, counts, invitationDeliveries }) {
  const company = 'tf-company', otherCompany = 'tf-company-b', actor = 'tf-owner', base = '/api/company/resident-contacts';
  const origin = process.env.TEST_USERS_BROWSER_URL, target = new URL(origin);
  assert.equal(target.protocol, 'http:'); assert.equal(target.hostname, '127.0.0.1'); assert.match(target.port, /^\d+$/); assert.equal(origin, target.origin); assert.equal(target.username, ''); assert.equal(target.password, '');
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  const dismissGuide = async user => {
    const guide = ok(await call(user, 'GET', '/api/account/guide'));
    ok(await call(user, 'PUT', '/api/account/guide', { guideKey: guide.guideKey, expectedVersion: guide.version, status: 'dismissed', step: guide.steps[0].id }));
  };
  for (const id of [company, otherCompany]) await admin.query('INSERT INTO "Company"(id,name,"updatedAt") VALUES($1,$1,NOW())', [id]);
  for (const [id, role, platform] of [[actor, 'owner', null], ['tf-manager', 'manager', null], ['tf-staff', 'staff', null], ['tf-support', null, 'support']]) {
    await admin.query('INSERT INTO "User"(id,email,name,"emailVerified","platformRole","updatedAt") VALUES($1,$1||\'@test.invalid\',$1,true,$2,NOW())', [id, platform]);
    await admin.query('INSERT INTO "Identity"(id,issuer,subject,"userId") VALUES($1,$2,$3,$3)', ['tf-identity-' + id, provider.issuer, id]);
    if (role) await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,$2,$3,NOW())', [id, company, role]);
    await db.session.create({ data: { tokenHash: digest('token-' + id), csrfToken: 'csrf', userId: id, expiresAt: new Date(Date.now() + 3600000), idleExpiresAt: new Date(Date.now() + 3600000) } });
    remote.set(id, { user_id: id, email: id + '@test.invalid', name: id, email_verified: true, identities: [{ connection: provider.databaseConnection, provider: 'auth0' }] });
    if (role) await dismissGuide(id);
  }
  const policy = overrides => admin.query('INSERT INTO "CompanySubscription"("companyId","updatedById","featureOverrides","updatedAt") VALUES($1,$2,$3::jsonb,NOW()) ON CONFLICT("companyId") DO UPDATE SET "featureOverrides"=EXCLUDED."featureOverrides","updatedAt"=NOW()', [company, actor, JSON.stringify(overrides)]);
  const clearPolicy = () => admin.query('DELETE FROM "CompanySubscription" WHERE "companyId"=$1', [company]);
  const storageKey = (id = 'new') => `pf:tenant-draft:${actor}:${company}:${id}`;
  const create = (name, email) => call(actor, 'POST', base, { name, email, submissionKey: randomUUID() }).then(ok);
  const current = id => call(actor, 'GET', base + '/' + id).then(ok);
  const auditCount = async (id, action) => (await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE "targetId"=$1 AND action=$2', [id, action])).rows[0].n;
  const providerEvents = [], physicalCreates = [], originals = {};
  for (const action of ['create', 'get', 'rename', 'setup', 'verify']) {
    originals[action] = provider[action];
    provider[action] = async (...args) => {
      providerEvents.push({ action, args });
      const existingIds = action === 'create' ? new Set(remote.keys()) : null;
      const result = await originals[action].apply(provider, args);
      // Count the fake remote's actual new accounts separately from calls to
      // its lookup/reuse wrapper. Receipt replay must perform neither action.
      if (existingIds) for (const [id, account] of remote) if (!existingIds.has(id)) physicalCreates.push({ id, email: account.email });
      return result;
    };
  }
  t.after(() => { for (const [action, method] of Object.entries(originals)) provider[action] = method; });
  const actions = (action, value) => providerEvents.filter(event => event.action === action && event.args[0] === value).length;
  const assertPerson = async (email, { name, created = 1, updated = 0, profileUpdated = 0 } = {}) => {
    const users = (await admin.query('SELECT * FROM "User" WHERE lower(email)=lower($1)', [email])).rows; assert.equal(users.length, 1);
    const user = users[0], identities = (await admin.query('SELECT * FROM "Identity" WHERE "userId"=$1', [user.id])).rows;
    assert.equal(identities.length, 1); assert.equal(identities[0].issuer, provider.issuer); assert.equal(identities[0].subject, user.id); assert.equal(user.firstSignedInAt, null);
    const contacts = (await admin.query('SELECT * FROM "ResidentContact" WHERE "userId"=$1', [user.id])).rows; assert.equal(contacts.length, 1); assert.equal(contacts[0].companyId, company);
    if (name) { assert.equal(contacts[0].name, name); assert.equal(user.name, name); }
    const grants = (await admin.query(`SELECT
      (SELECT count(*)::int FROM "CompanyMembership" WHERE "userId"=$1) AS memberships,
      (SELECT count(*)::int FROM "ResidentPropertyAssignment" WHERE "userId"=$1) AS assignments,
      (SELECT count(*)::int FROM "LeaseParticipant" WHERE "userId"=$1 OR "contactId"=$2) AS parties,
      (SELECT count(*)::int FROM "Invitation" WHERE "accountId"=$1 OR "contactId"=$2) AS invitations`, [user.id, contacts[0].id])).rows[0];
    assert.deepEqual(grants, { memberships: 0, assignments: 0, parties: 0, invitations: 0 });
    assert.equal(await auditCount(user.id, 'user.preprovisioned'), created); assert.equal(await auditCount(contacts[0].id, 'resident.contact.created'), created);
    assert.equal(await auditCount(contacts[0].id, 'resident.contact.updated'), updated); assert.equal(await auditCount(user.id, 'user.profile.updated'), profileUpdated);
    assert.equal(remote.has(user.id), true); assert.equal(actions('create', email), 1); assert.equal(actions('setup', email), 0); assert.equal(actions('verify', user.id), 0);
    assert.deepEqual(physicalCreates.filter(row => row.email === email), [{ id: user.id, email }]);
    assert.equal([...remote.values()].filter(row => row.email === email).length, 1);
    return { user, contact: contacts[0] };
  };
  const browser = await launchFixtureBrowser({ headless: true }); t.after(() => browser.close());
  const mutations = [], reads = [];
  const pageDiagnostics = new WeakMap();
  const bounded = (items, value) => { items.push(value); if (items.length > 10) items.shift(); };
  const captureFailure = async (page, label) => {
    // Only this isolated fictional test owns these pages. Exclude headers,
    // tokens, request payloads and provider credentials from diagnostics.
    const body = await page.locator('body').innerText().catch(() => 'Page body unavailable');
    console.error('Tenant access fixture diagnostic', JSON.stringify({ label, url: page.url(), ...pageDiagnostics.get(page), body: body.slice(0, 8000) }));
    const safeLabel = label.replace(/[^a-z0-9-]/gi, '-').slice(0, 70);
    await page.screenshot({ path: `/tmp/propertyflow-${safeLabel}-failure.png`, fullPage: true }).catch(() => {});
  };
  const fixturePage = async ({ user = actor, lose, loseBefore, maskContext = false } = {}) => {
    const page = await newFixturePage(browser); let lost = false, lostBefore = false, masked = false;
    const diagnostic = { pageErrors: [], consoleErrors: [], failedRequests: [], hmr: [], bootstrap: [] };
    pageDiagnostics.set(page, diagnostic);
    page.on('pageerror', error => bounded(diagnostic.pageErrors, String(error.message).slice(0, 500)));
    page.on('console', message => { if (message.type() === 'error') bounded(diagnostic.consoleErrors, message.text().slice(0, 500)); });
    page.on('requestfailed', request => bounded(diagnostic.failedRequests, { method: request.method(), path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
    page.on('websocket', socket => {
      socket.on('framereceived', frame => {
        try {
          const message = JSON.parse(String(frame.payload));
          if (['connected', 'update', 'full-reload', 'error'].includes(message.type))
            bounded(diagnostic.hmr, { type: message.type, paths: message.updates?.slice(0, 10).map(update => update.path), at: Date.now() });
        } catch { /* Non-JSON frames are not relevant to Vite HMR evidence. */ }
      });
    });
    await page.addInitScript(() => window.addEventListener('impersonation-context-changed', () => sessionStorage.setItem('tf-context-change-observed', 'true')));
    await page.context().route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (path === '/api/telemetry') return route.fulfill({ status: 202, json: { accepted: true } });
      const body = request.postData() ? request.postDataJSON() : undefined;
      if (loseBefore && !lostBefore && request.method() === loseBefore.method && path === loseBefore.path && body?.email === loseBefore.email) {
        lostBefore = true;
        // This owned fault happens before injection, so the browser sees an
        // uncertain network failure while no server/provider action executes.
        mutations.push({ method: request.method(), path, body, status: 0, code: 'FIXTURE_ABORTED_BEFORE_HANDLER', company: request.headers()['x-company-id'] });
        return route.abort('failed');
      }
      const response = await app.inject({ method: request.method(), url: path + url.search,
        headers: { ...request.headers(), origin: 'https://app.test', cookie: '__Host-pf-session=token-' + user }, ...(body ? { payload: body } : {}) });
      if (path === '/api/bootstrap') {
        const bootstrap = response.json();
        bounded(diagnostic.bootstrap, { status: response.statusCode, code: bootstrap.code, userId: bootstrap.user?.id, role: bootstrap.membership?.role, companyId: bootstrap.membership?.companyId, permissions: bootstrap.permissions, impersonating: !!bootstrap.impersonation, at: Date.now() });
      }
      if (request.method() === 'GET') reads.push({ path, status: response.statusCode, code: response.json().code, company: request.headers()['x-company-id'] });
      if (request.method() !== 'GET' && path !== '/api/account/guide') mutations.push({ method: request.method(), path, body, status: response.statusCode, code: response.json().code, reply: response.json(), company: request.headers()['x-company-id'] });
      const matches = lose && request.method() === lose.method && path === lose.path && (!lose.email || body?.email === lose.email);
      if (matches && response.statusCode === 200 && !lost) { lost = true; return route.abort('failed'); }
      if (maskContext && !masked && request.method() === 'POST' && path === base && response.statusCode === 200) {
        masked = true;
        // Use the public API context setter to model an in-flight identity
        // change after the real handler committed, before its200 is delivered.
        await page.evaluate(async () => { const api = await import('/src/api.ts'); api.setImpersonationContext('tf-interrupted-context'); });
      }
      return route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
    });
    await page.context().route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort('blockedbyclient'));
    return page;
  };
  const focus = page => page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const holdBootstrap = async page => {
    let release, holding = true;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route(origin + '/api/bootstrap', async route => { if (holding) await gate; return route.fallback(); });
    return { release: () => { holding = false; release(); } };
  };
  const journal = (page, id = 'new') => page.evaluate(key => sessionStorage.getItem(key), storageKey(id));
  const add = async (page, name, email, invite = false) => {
    await page.goto(origin + '/company/residents');
    await page.getByRole('button', { name: invite ? 'Invite tenant' : 'Add tenant', exact: true }).click();
    await page.getByLabel('Full name *', { exact: true }).fill(name); await page.getByLabel('Contact email', { exact: true }).fill(email);
    await page.getByLabel('Management notes', { exact: true }).fill('PRIVATE TF DRAFT ' + email);
    await page.getByRole('button', { name: 'Review tenant', exact: true }).click();
  };
  const reviewVisible = page => expect(page.getByRole('heading', { name: 'Review tenant details', exact: true })).toBeVisible();
  const deniedRecovery = page => expect(page.getByText('Tenant access is unavailable. The original interrupted request is kept for recovery; its private details are hidden.', { exact: true })).toBeVisible();
  const privateAbsent = (page, email) => expect(page.locator('body')).not.toContainText('PRIVATE TF DRAFT ' + email);
  const captureReview = async (page, name) => {
    for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: `/tmp/propertyflow-${name}-${device}-viewport.png`, fullPage: false });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  };

  await t.test('leasing read_only blocks tenant write entry without changing actual owner/manager/support role projection', async () => {
    const person = await create('Readonly existing tenant', 'tf-readonly@test.invalid');
    const before = mutations.length, countsBefore = counts(), deliveryBefore = invitationDeliveries.length;
    await policy({ leasing: 'read_only' });
    try {
      for (const user of [actor, 'tf-manager']) {
        const page = await fixturePage({ user });
        try { await page.goto(origin + '/company/residents');
        await expect(page.getByRole('button', { name: 'Add tenant', exact: true })).toBeDisabled();
        if (user === actor) await expect(page.getByRole('button', { name: 'Invite tenant', exact: true })).toBeDisabled();
        else await expect(page.getByRole('button', { name: 'Invite tenant', exact: true })).toHaveCount(0);
        await page.goto(origin + '/company/tenants/' + person.id);
        await expect(page.getByRole('button', { name: 'Edit tenant details', exact: true })).toBeDisabled();
        await page.getByText('More tenant actions', { exact: true }).click(); await expect(page.getByRole('button', { name: 'Archive tenant', exact: true })).toBeDisabled();
        } catch (error) { await captureFailure(page, `readonly-${user}`); throw error; }
        finally { await page.close(); }
      }
      for (const targetUser of [actor, 'tf-manager']) {
        const session = await db.session.findUniqueOrThrow({ where: { tokenHash: digest('token-tf-support') } });
        ok(await call('tf-support', 'POST', '/api/impersonation', { userId: targetUser, reason: 'Fictional tenant role projection review' }, { 'x-csrf-token': session.csrfToken }));
        try {
          const page = await fixturePage({ user: 'tf-support' });
          try { await page.goto(origin + '/company/residents');
          await expect(page.getByRole('button', { name: 'Add tenant', exact: true })).toBeDisabled();
          await expect(page.getByRole('button', { name: 'Invite tenant', exact: true })).toHaveCount(targetUser === actor ? 1 : 0);
          } catch (error) { await captureFailure(page, `readonly-support-${targetUser}`); throw error; }
          finally { await page.close(); }
        } finally { const fresh = await db.session.findUniqueOrThrow({ where: { tokenHash: digest('token-tf-support') } }); ok(await call('tf-support', 'DELETE', '/api/impersonation', undefined, { 'x-csrf-token': fresh.csrfToken })); }
      }
      assert.equal(mutations.length, before); assert.deepEqual(counts(), countsBefore); assert.equal(invitationDeliveries.length, deliveryBefore);
    } finally { await clearPolicy(); }
    await assertPerson('tf-readonly@test.invalid', { name: person.name });
  });

  await t.test('same-authority policy refresh keeps the ordinary draft and original edit baseline when newer saved data arrives', async () => {
    const email = 'tf-draft@test.invalid', name = 'Ordinary retained draft';
    const page = await fixturePage(); await add(page, name, email); const before = mutations.length;
    await policy({ leasing: 'read_only' });
    try {
      await focus(page); await expect(page.getByRole('button', { name: 'Save tenant', exact: true })).toBeDisabled(); await reviewVisible(page);
      await expect(page.getByRole('dialog', { name: 'Add tenant', exact: true })).toContainText('PRIVATE TF DRAFT ' + email); assert.equal(mutations.length, before);
    } finally { await clearPolicy(); }
    let completion = null;
    try {
      await focus(page);
      const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === base && response.request().postDataJSON()?.email === email, { timeout: 5000 });
      const [response] = await Promise.all([responsePromise, page.getByRole('button', { name: 'Save tenant', exact: true }).click()]);
      const reply = await response.json();
      completion = { status: response.status(), code: reply?.code };
      assert.equal(response.status(), 200, JSON.stringify(completion));
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    } catch (error) {
      // These are owned fictional fixtures only. Keep evidence bounded and
      // retain actual request outcomes without printing mutation payloads.
      const recent = mutations.filter(item => item.path === base).slice(-2).map(({ method, path, status, code }) => ({ method, path, status, code }));
      const body = await page.locator('body').innerText().catch(() => 'Page body unavailable');
      console.error('Ordinary tenant save diagnostic', JSON.stringify({ url: page.url(), completion, recent, body: body.slice(0, 8000) }));
      await page.screenshot({ path: '/tmp/propertyflow-ordinary-tenant-save-failure.png', fullPage: true }).catch(() => {});
      throw error;
    }
    const saved = await assertPerson(email, { name });
    await page.getByRole('button', { name: 'Edit tenant details', exact: true }).click();
    await page.getByLabel('Full name *', { exact: true }).fill('Uncommitted private edit'); await page.getByRole('button', { name: 'Review tenant', exact: true }).click();
    ok(await call('tf-manager', 'PATCH', base + '/' + saved.contact.id, { name, email, phone: '555-0198', expectedVersion: saved.contact.version, status: 'active' }));
    await focus(page); await reviewVisible(page);
    await page.getByRole('button', { name: 'Save tenant details', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
    const attempt = mutations.at(-1); assert.equal(attempt.status, 409); assert.equal(attempt.code, 'RECORD_CHANGED'); assert.equal(attempt.body.expectedVersion, saved.contact.version); assert.equal(attempt.body.name, 'Uncommitted private edit');
    await reviewVisible(page); assert.equal(await journal(page, saved.contact.id), null, 'a fresh definitive version rejection is not an uncertain saved request');
    const fresh = await current(saved.contact.id); assert.equal(fresh.name, name); assert.equal(fresh.phone, '555-0198'); assert.equal(fresh.version, saved.contact.version + 1);
    assert.equal(actions('rename', saved.user.id), 0); await page.close();
  });

  await t.test('an uncommitted legacy create can explicitly review a new duplicate without replacing its original retry identity or details', async () => {
    const email = 'tf-late-duplicate@test.invalid', peerEmail = 'tf-late-peer@test.invalid', name = 'Late separate person recovery';
    const page = await fixturePage({ loseBefore: { method: 'POST', path: base, email }, lose: { method: 'POST', path: base, email } });
    const cashBefore = (await admin.query('SELECT count(*)::int n FROM "LedgerEntry" WHERE "companyId"=$1', [company])).rows[0].n;
    await page.goto(origin + '/company/residents'); await page.getByRole('button', { name: 'Add tenant', exact: true }).click();
    await page.getByText('Mailing address · optional', { exact: true }).click();
    await page.getByText('Emergency contact · optional', { exact: true }).click();
    for (const [label, value] of [
      ['Full name *', name], ['Contact email', email], ['Preferred name', 'Kept nickname'], ['Primary phone', '555-0139'], ['Alternate phone', '555-0141'],
      ['Address line 1', '17 Fixture Way'], ['Address line 2', 'Unit Fiction'], ['City', 'Fiction City'], ['State / region', 'NY'], ['Postal code', '10001'], ['Country', 'US'],
      ['Emergency contact name', 'Fictional emergency contact'], ['Relationship to tenant', 'Sibling'], ['Emergency contact phone', '555-0140'], ['Management notes', 'PRIVATE TF DRAFT ' + email],
    ]) await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole('combobox', { name: /^Preferred contact method\b/ }).selectOption('phone');
    await page.getByRole('button', { name: 'Review tenant', exact: true }).click();
    await page.getByRole('button', { name: 'Save tenant', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
    const first = mutations.at(-1); assert.equal(first.status, 0); assert.equal(first.code, 'FIXTURE_ABORTED_BEFORE_HANDLER'); assert.equal(first.company, company); assert.equal(first.body.duplicateReviewed, false);
    const original = JSON.parse(await journal(page)); assert.deepEqual(original.payload, first.body); assert.equal(original.key, first.body.submissionKey); assert.equal(original.companyId, company);
    const noOriginal = async () => {
      assert.equal(actions('create', email), 0); assert.equal(physicalCreates.filter(row => row.email === email).length, 0);
      assert.equal([...remote.values()].filter(row => row.email === email).length, 0);
      assert.equal((await admin.query('SELECT count(*)::int n FROM "User" WHERE email=$1', [email])).rows[0].n, 0);
      assert.equal((await admin.query('SELECT count(*)::int n FROM "ResidentContact" WHERE "companyId"=$1 AND (email=$2 OR "submissionKey"=$3)', [company, email, first.body.submissionKey])).rows[0].n, 0);
    };
    await noOriginal();
    const featureGate = await holdBootstrap(page);
    try {
      await policy({ leasing: 'disabled' });
      // Keep bootstrap stale until the real save denial has hidden the private
      // request. Read-only denials below deliberately remain readable.
      await page.getByRole('button', { name: 'Save tenant', exact: true }).click();
      await deniedRecovery(page); await privateAbsent(page, email);
      assert.equal(mutations.at(-1).status, 403); assert.equal(mutations.at(-1).code, 'FEATURE_DISABLED'); assert.deepEqual(mutations.at(-1).body, first.body);
      assert.deepEqual(JSON.parse(await journal(page)), original); await noOriginal();
      await clearPolicy();
      const readStart = reads.length, beforeRecheck = mutations.length;
      await page.getByRole('button', { name: 'Reload workspace', exact: true }).click(); featureGate.release();
      await reviewVisible(page);
      assert.deepEqual(reads.slice(readStart).find(read => read.path === '/api/company/resident-profiles/directory' && read.company === company), { path: '/api/company/resident-profiles/directory', status: 200, code: undefined, company });
      assert.equal(mutations.length, beforeRecheck); assert.deepEqual(JSON.parse(await journal(page)), original); await noOriginal();
    } finally { await clearPolicy(); featureGate.release(); }
    // Older journals retained draft/review/key without a payload snapshot.
    // Remove only that field; the real retry must reconstruct the same body.
    await page.evaluate(key => { const saved = JSON.parse(sessionStorage.getItem(key)); delete saved.payload; sessionStorage.setItem(key, JSON.stringify(saved)); }, storageKey());
    await page.reload(); await page.getByRole('button', { name: 'Add tenant', exact: true }).click(); await reviewVisible(page);
    const peer = ok(await call('tf-manager', 'POST', base, { name: name.toUpperCase(), email: peerEmail, submissionKey: randomUUID() }));
    await assertPerson(peerEmail, { name: peer.name });
    await page.getByRole('button', { name: 'Save tenant', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
    assert.equal(mutations.at(-1).status, 409); assert.equal(mutations.at(-1).code, 'POSSIBLE_DUPLICATE'); assert.deepEqual(mutations.at(-1).body, first.body); assert.equal(mutations.at(-1).company, company);
    await noOriginal();
    const awaitingConsent = await journal(page); assert.deepEqual(JSON.parse(awaitingConsent).payload, first.body);
    const beforeReview = mutations.length;
    const confirm = page.getByRole('button', { name: 'Confirm separate person for original retry', exact: true }); await expect(confirm).toBeDisabled();
    const reviewMatches = async (label, archived) => {
      const opened = page.context().waitForEvent('page');
      await page.getByRole('link', { name: label, exact: true }).click(); const tab = await opened;
      await expect(tab).toHaveURL(url => url.origin === origin && url.pathname === '/company/residents' && url.searchParams.get('q') === name && (archived ? url.searchParams.get('records') === 'archived' : url.searchParams.get('records') !== 'archived') && !url.searchParams.has('cursor') && !url.searchParams.has('before'));
      await expect(tab.getByRole('row').filter({ hasText: peerEmail })).toContainText(peer.name);
      await tab.close(); await reviewVisible(page); assert.equal(await journal(page), awaitingConsent); assert.equal(mutations.length, beforeReview);
    };
    await reviewMatches('Active name matches', false);
    const archivedPeer = ok(await call('tf-manager', 'PATCH', base + '/' + peer.id, { name: peer.name, email: peerEmail, expectedVersion: peer.version, status: 'archived' }));
    assert.equal(archivedPeer.status, 'archived'); assert.equal(archivedPeer.version, peer.version + 1);
    await reviewMatches('Archived name matches', true);
    await noOriginal();
    await page.getByRole('checkbox', { name: /^I reviewed the existing tenants and confirm this is a separate person/ }).check();
    await expect(confirm).toBeEnabled(); await confirm.click();
    assert.equal(mutations.length, beforeReview, 'separate-person consent changes only the saved retry modifier');
    const approved = { ...first.body, duplicateReviewed: true }, approvedJournal = JSON.parse(await journal(page));
    assert.deepEqual(approvedJournal, { ...JSON.parse(awaitingConsent), payload: approved });
    assert.equal(approvedJournal.key, original.key); assert.equal(approvedJournal.companyId, company); await noOriginal();
    await page.getByRole('button', { name: 'Save tenant', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
    assert.equal(mutations.at(-1).status, 200); assert.deepEqual(mutations.at(-1).body, approved); assert.equal(mutations.at(-1).company, company);
    const saved = await assertPerson(email, { name });
    assert.notEqual(saved.contact.id, peer.id); assert.notEqual(saved.user.id, peer.userId);
    for (const [field, value] of Object.entries(first.body)) if (!['submissionKey', 'duplicateReviewed'].includes(field)) assert.equal(saved.contact[field] ?? null, value === '' ? null : value, field);
    await page.getByRole('button', { name: 'Save tenant', exact: true }).click(); await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    assert.equal(await journal(page), null);
    const attempts = mutations.filter(row => row.path === base && row.body?.email === email);
    assert.deepEqual(attempts.map(row => row.status), [0, 403, 409, 200, 200]);
    assert.deepEqual(attempts.map(row => row.body), [first.body, first.body, first.body, approved, approved]); assert.ok(attempts.every(row => row.company === company));
    const receipt = ok(await call(actor, 'POST', base, first.body)); assert.equal(receipt.id, saved.contact.id);
    await assertPerson(email, { name }); await assertPerson(peerEmail, { name: peer.name, updated: 1 });
    assert.equal((await admin.query('SELECT count(*)::int n FROM "LedgerEntry" WHERE "companyId"=$1', [company])).rows[0].n, cashBefore);
    await page.close();
  });

  await t.test('duplicate-approved committed creation survives actual403 and reload with an exact original receipt and one account/contact', async () => {
    const email = 'tf-duplicate@test.invalid', name = 'Duplicate approved recovery'; await create(name, 'tf-original-duplicate@test.invalid');
    const page = await fixturePage({ lose: { method: 'POST', path: base, email } }); await add(page, name, email);
    await page.getByRole('button', { name: 'Save tenant', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
    assert.equal(mutations.at(-1).code, 'POSSIBLE_DUPLICATE'); assert.equal(actions('create', email), 0);
    await page.getByRole('checkbox', { name: /^I reviewed the existing tenants/ }).check();
    await page.getByRole('button', { name: 'Save tenant', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
    const committed = mutations.at(-1); assert.equal(committed.status, 200); assert.equal(committed.body.duplicateReviewed, true); assert.equal(committed.company, company);
    const original = await journal(page); assert.ok(original); assert.deepEqual(JSON.parse(original).payload, committed.body);
    await expect(page.getByRole('button', { name: 'Back to contact details', exact: true })).toHaveCount(0);
    await policy({ leasing: 'read_only' });
    try {
      await page.getByRole('button', { name: 'Save tenant', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
      const denied = mutations.at(-1); assert.equal(denied.status, 403); assert.equal(denied.code, 'SUBSCRIPTION_READ_ONLY'); assert.deepEqual(denied.body, committed.body); assert.equal(await journal(page), original);
      await reviewVisible(page);
      await page.reload(); await expect(page.getByRole('button', { name: 'Add tenant', exact: true })).toBeDisabled(); assert.equal(await journal(page), original);
      await page.getByRole('button', { name: 'Resume tenant setup', exact: true }).click(); await reviewVisible(page); await expect(page.getByRole('button', { name: 'Save tenant', exact: true })).toBeDisabled();
      await captureReview(page, 'tenant-write-controls-authority-final');
      await assertPerson(email, { name });
    } finally { await clearPolicy(); }
    await focus(page); await page.getByRole('button', { name: 'Save tenant', exact: true }).click(); await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    assert.deepEqual(mutations.at(-1).body, committed.body); assert.equal(mutations.at(-1).status, 200); assert.equal(await journal(page), null);
    await assertPerson(email, { name }); await page.close();
  });

  await t.test('interrupted contact PATCH keeps its original baseline through403/409 and resolves only through explicit current-record acknowledgment', async () => {
    const email = 'tf-edit@test.invalid', person = await create('Edit recovery before', email), name = 'Edit recovery saved';
    const path = base + '/' + person.id, page = await fixturePage({ lose: { method: 'PATCH', path } }); await page.goto(origin + '/company/tenants/' + person.id);
    await page.getByRole('button', { name: 'Edit tenant details', exact: true }).click(); await page.getByLabel('Full name *', { exact: true }).fill(name); await page.getByRole('button', { name: 'Review tenant', exact: true }).click();
    await page.getByRole('button', { name: 'Save tenant details', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
    const committed = mutations.at(-1), original = await journal(page, person.id); assert.equal(committed.status, 200); assert.equal(committed.body.expectedVersion, person.version); assert.equal(committed.company, company); assert.ok(original);
    await policy({ leasing: 'read_only' });
    try {
      await page.getByRole('button', { name: 'Save tenant details', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
      assert.equal(mutations.at(-1).status, 403); assert.equal(mutations.at(-1).code, 'SUBSCRIPTION_READ_ONLY'); assert.deepEqual(mutations.at(-1).body, committed.body); assert.equal(await journal(page, person.id), original);
      await reviewVisible(page);
      await page.reload(); await expect(page.getByRole('button', { name: 'Edit tenant details', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Resume tenant details', exact: true }).click(); await reviewVisible(page); assert.equal(await journal(page, person.id), original);
    } finally { await clearPolicy(); }
    await focus(page); await page.getByRole('button', { name: 'Save tenant details', exact: true }).click(); await expect(page.getByRole('alert').first()).toBeVisible();
    assert.equal(mutations.at(-1).status, 409); assert.equal(mutations.at(-1).code, 'RECORD_CHANGED'); assert.deepEqual(mutations.at(-1).body, committed.body); assert.equal(await journal(page, person.id), original);
    const patchGate = await holdBootstrap(page), updateAudits = await auditCount(person.id, 'resident.contact.updated');
    try {
      await admin.query('UPDATE "CompanyMembership" SET role=\'staff\',version=version+1 WHERE "userId"=$1', [actor]);
      try {
        await dismissGuide(actor);
        await page.getByRole('button', { name: 'Save tenant details', exact: true }).click(); await deniedRecovery(page);
        assert.equal(mutations.at(-1).status, 403); assert.equal(mutations.at(-1).code, 'ACCESS_DENIED'); assert.deepEqual(mutations.at(-1).body, committed.body);
        await expect(page.getByRole('heading', { name: 'Review tenant details', exact: true })).toHaveCount(0);
        assert.equal(await journal(page, person.id), original); assert.equal(await auditCount(person.id, 'resident.contact.updated'), updateAudits);
      } finally { await admin.query('UPDATE "CompanyMembership" SET role=\'owner\',version=version+1 WHERE "userId"=$1', [actor]); }
      await page.getByRole('button', { name: 'Reload workspace', exact: true }).click(); patchGate.release();
      await page.getByRole('button', { name: 'Edit tenant details', exact: true }).click(); await reviewVisible(page);
      assert.equal(await journal(page, person.id), original);
    } finally { patchGate.release(); }
    const before = mutations.length, comparisonGate = await holdBootstrap(page);
    try {
      await admin.query('UPDATE "CompanyMembership" SET role=\'staff\',version=version+1 WHERE "userId"=$1', [actor]);
      try {
      // Keep the authorized page stale until its explicit fresh comparison
      // read. A denied read must hide the private edit without discarding it.
      const readStart = reads.length;
      await page.getByRole('button', { name: 'Review current tenant record', exact: true }).click();
      await deniedRecovery(page);
      await expect(page.getByRole('heading', { name: 'Review tenant details', exact: true })).toHaveCount(0);
      assert.deepEqual(reads.slice(readStart).find(read => read.path === path && read.company === company), { path, status: 403, code: 'ACCESS_DENIED', company });
      assert.equal(await journal(page, person.id), original); assert.equal(mutations.length, before);
      } finally { await admin.query('UPDATE "CompanyMembership" SET role=\'owner\',version=version+1 WHERE "userId"=$1', [actor]); }
      await page.getByRole('button', { name: 'Reload workspace', exact: true }).click(); comparisonGate.release();
      await page.getByRole('button', { name: 'Edit tenant details', exact: true }).click(); await reviewVisible(page);
    } finally { comparisonGate.release(); }
    const readStart = reads.length;
    await page.getByRole('button', { name: 'Review current tenant record', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Review current tenant record', exact: true })).toContainText('Current saved version 2');
    assert.deepEqual(reads.slice(readStart).find(read => read.path === path && read.company === company), { path, status: 200, code: undefined, company });
    await expect(page.getByRole('heading', { name: 'Review tenant details', exact: true })).not.toBeVisible();
    // Hiding the original review must not unregister its uncertainty from the
    // editor. Closing still keeps the exact interrupted request, never a draft.
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const closeRecovery = page.getByRole('alertdialog', { name: 'Recover the submitted request', exact: true });
    await expect(closeRecovery).toBeVisible();
    await closeRecovery.getByRole('button', { name: 'Close & keep recovery', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Edit tenant details', exact: true })).not.toBeVisible();
    assert.equal(await journal(page, person.id), original); assert.equal(mutations.length, before);
    await page.getByRole('button', { name: 'Edit tenant details', exact: true }).click();
    const comparison = page.getByRole('region', { name: 'Review current tenant record', exact: true });
    await expect(comparison).toContainText('Current saved version 2');
    await expect(comparison).toContainText('The proposed tenant fields match the current saved values.');
    await expect(page.getByRole('heading', { name: 'Review tenant details', exact: true })).not.toBeVisible();
    await expect(page.locator('details').filter({ hasText: 'Original interrupted edit and retry' })).not.toHaveAttribute('open', '');
    const fullFields = comparison.locator('details').filter({ hasText: 'Review all fields' });
    await expect(fullFields).not.toHaveAttribute('open', '');
    await captureReview(page, 'tenant-edit-recovery-authority-final');
    await fullFields.locator('summary').click();
    const field = label => fullFields.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) });
    await expect(field('Full name')).toContainText('Current saved: ' + name);
    await expect(field('Full name')).toContainText('Your proposed: ' + name);
    await expect(field('Preferred contact')).toContainText('Not supplied');
    await expect(field('Management notes')).toContainText('Not supplied');
    await expect(field('Tenant record status')).toContainText('Current saved: active');
    await expect(field('Tenant record status')).toContainText('Original reviewed: active');
    await expect(page.getByRole('button', { name: 'Back to contact details', exact: true })).toHaveCount(0);
    assert.equal(await journal(page, person.id), original); assert.equal(mutations.length, before);
    const originalSaved = await assertPerson(email, { name, updated: 1, profileUpdated: 1 });
    assert.equal(originalSaved.contact.version, 2); assert.equal(actions('rename', originalSaved.user.id), 1);
    // A separate, explicit peer edit changes the fresh comparison only. The
    // interrupted request's body, original version and journal remain pinned.
    const peerNotes = 'Independent manager note after interrupted edit';
    const auditBeforePeer = await auditCount(person.id, 'resident.contact.updated');
    const peer = ok(await call('tf-manager', 'PATCH', path, { name, email, managementNotes: peerNotes, expectedVersion: 2, status: 'active' }));
    assert.equal(peer.version, 3); assert.equal(peer.managementNotes, peerNotes);
    assert.equal(await auditCount(person.id, 'resident.contact.updated'), auditBeforePeer + 1);
    assert.equal(actions('rename', originalSaved.user.id), 1);
    assert.equal(await journal(page, person.id), original); assert.deepEqual(JSON.parse(original).payload, committed.body);
    const freshReadStart = reads.length;
    await comparison.getByRole('button', { name: 'Refresh current tenant record', exact: true }).click();
    await expect(comparison).toContainText('Current saved version 3');
    await expect(comparison).toContainText('Original reviewed version 1');
    assert.deepEqual(reads.slice(freshReadStart).find(read => read.path === path && read.company === company), { path, status: 200, code: undefined, company });
    await expect(comparison).toContainText('1 submitted field differs from the current saved values.');
    await expect(comparison.getByText('The proposed tenant fields match the current saved values.', { exact: true })).toHaveCount(0);
    const changedNotes = comparison.locator(':scope > dl > div').filter({ has: page.getByText('Management notes', { exact: true }) });
    await expect(changedNotes).toContainText('Current saved: ' + peerNotes);
    await expect(changedNotes).toContainText('Your proposed: Not supplied');
    await expect(fullFields).not.toHaveAttribute('open', '');
    await expect(page.getByRole('heading', { name: 'Review tenant details', exact: true })).not.toBeVisible();
    await captureReview(page, 'tenant-edit-recovery-difference-authority-final');
    await fullFields.locator('summary').click();
    await expect(field('Management notes')).toContainText('Current saved: ' + peerNotes);
    await expect(field('Management notes')).toContainText('Your proposed: Not supplied');
    assert.equal(await journal(page, person.id), original); assert.equal(mutations.length, before);
    const auditBeforeAck = await auditCount(person.id, 'resident.contact.updated');
    await expect(page.getByRole('button', { name: 'Use current record', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'I reviewed the current saved details. Stop retrying my earlier edit and use the record as it is.', exact: true }).check();
    await page.getByRole('button', { name: 'Use current record', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Edit tenant details', exact: true })).not.toBeVisible();
    assert.equal(mutations.length, before); assert.equal(await journal(page, person.id), null);
    assert.equal(await auditCount(person.id, 'resident.contact.updated'), auditBeforeAck);
    const saved = await assertPerson(email, { name, updated: 2, profileUpdated: 1 }); assert.equal(saved.contact.version, 3); assert.equal(saved.contact.managementNotes, peerNotes); assert.equal(actions('rename', saved.user.id), 1);
    await page.close();
  });

  await t.test('real role/company denial clears private editor UI while pinned pending recovery never creates a companyB contact', async () => {
    const email = 'tf-scope@test.invalid', name = 'Private scope recovery';
    const page = await fixturePage({ lose: { method: 'POST', path: base, email } }); await add(page, name, email);
    await page.getByRole('button', { name: 'Save tenant', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible(); const committed = mutations.at(-1), original = await journal(page);
    const roleGate = await holdBootstrap(page);
    await admin.query('UPDATE "CompanyMembership" SET role=\'staff\',version=version+1 WHERE "userId"=$1', [actor]);
    try {
      // Guide progress is specific to each real role/company. Dismiss the
      // transient staff guide before its unrelated dialog can race restoration.
      await dismissGuide(actor);
      await page.getByRole('button', { name: 'Save tenant', exact: true }).click(); await deniedRecovery(page); await privateAbsent(page, email);
      assert.equal(mutations.at(-1).status, 403); assert.equal(mutations.at(-1).code, 'ACCESS_DENIED'); assert.deepEqual(mutations.at(-1).body, committed.body);
      assert.equal(await journal(page), original); await assertPerson(email, { name });
      roleGate.release();
      await focus(page); await expect(page.getByRole('heading', { name: 'Access unavailable', exact: true })).toBeVisible(); await privateAbsent(page, email); assert.equal(await journal(page), original);
    } finally { await admin.query('UPDATE "CompanyMembership" SET role=\'owner\',version=version+1 WHERE "userId"=$1', [actor]); roleGate.release(); }
    await focus(page); await page.getByRole('button', { name: 'Add tenant', exact: true }).click(); await reviewVisible(page);
    const companyGate = await holdBootstrap(page);
    await admin.query('UPDATE "CompanyMembership" SET "companyId"=$2,version=version+1 WHERE "userId"=$1', [actor, otherCompany]);
    try {
      await dismissGuide(actor);
      const creates = actions('create', email);
      // Do not refresh the old A tab before this request: the opening scope pin
      // must reject the newly authorized B company rather than use its rights.
      await page.getByRole('button', { name: 'Save tenant', exact: true }).click(); await deniedRecovery(page); await privateAbsent(page, email);
      const denied = mutations.at(-1); assert.equal(denied.status, 403); assert.equal(denied.code, 'COMPANY_ACCESS_DENIED'); assert.equal(denied.company, company); assert.deepEqual(denied.body, committed.body); assert.equal(actions('create', email), creates);
      assert.equal((await admin.query('SELECT count(*)::int n FROM "ResidentContact" WHERE "companyId"=$1', [otherCompany])).rows[0].n, 0);
      const bootstraps = reads.filter(read => read.path === '/api/bootstrap').length;
      // Resource-only visibility refresh discovers B while bootstrap still
      // describes A. The mismatched response cannot keep A's editor visible.
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await expect(page.getByText('Your company workspace changed. Reload before viewing this tenant directory.', { exact: true })).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Add tenant', exact: true })).toHaveCount(0); await privateAbsent(page, email); assert.equal(await journal(page), original);
      await expect(page.getByRole('button', { name: 'Add tenant', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Invite tenant', exact: true })).toBeDisabled();
      assert.equal(reads.filter(read => read.path === '/api/bootstrap').length, bootstraps);
      await page.getByRole('button', { name: 'Reload workspace', exact: true }).click(); companyGate.release();
      await page.getByRole('button', { name: 'Add tenant', exact: true }).click(); await expect(page.getByLabel('Full name *', { exact: true })).toHaveValue(''); await expect(page.getByLabel('Contact email', { exact: true })).toHaveValue('');
      await page.getByRole('button', { name: 'Close', exact: true }).click(); assert.equal(await journal(page), original);
    } finally { await admin.query('UPDATE "CompanyMembership" SET "companyId"=$2,role=\'owner\',version=version+1 WHERE "userId"=$1', [actor, company]); companyGate.release(); }
    await page.reload(); await page.getByRole('button', { name: 'Add tenant', exact: true }).click(); await reviewVisible(page);
    await page.getByRole('button', { name: 'Save tenant', exact: true }).click(); await expect(page.getByRole('heading', { name, exact: true })).toBeVisible(); assert.deepEqual(mutations.at(-1).body, committed.body);
    await assertPerson(email, { name }); await page.close();
  });

  await t.test('a real committed200 masked by the API context validator keeps its first-attempt journal and recovers one receipt', async () => {
    const email = 'tf-context@test.invalid', name = 'Context interrupted creation';
    const page = await fixturePage({ maskContext: true }); await add(page, name, email);
    const reloaded = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() });
    await page.getByRole('button', { name: 'Save tenant', exact: true }).click(); await reloaded;
    await expect(page.getByRole('button', { name: 'Add tenant', exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('tf-context-change-observed')), 'true');
    const committed = mutations.at(-1); assert.equal(committed.status, 200); const original = await journal(page); assert.ok(original); assert.equal(JSON.parse(original).pending, true); assert.deepEqual(JSON.parse(original).payload, committed.body);
    await page.getByRole('button', { name: 'Add tenant', exact: true }).click(); await reviewVisible(page);
    await page.getByRole('button', { name: 'Save tenant', exact: true }).click(); await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    assert.deepEqual(mutations.at(-1).body, committed.body); await assertPerson(email, { name }); await page.close();
  });

  await t.test('saved-account Continue remains available when invitation creation becomes read_only and portal policy stays independent', async () => {
    const email = 'tf-continue@test.invalid', name = 'Saved account continue';
    await policy({ resident_portal: 'disabled' });
    const page = await fixturePage();
    try {
      await add(page, name, email, true); await page.getByRole('button', { name: 'Save tenant', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Continue to tenant record', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create invitation link', exact: true })).toBeEnabled();
      const before = mutations.length;
      await policy({ leasing: 'read_only', resident_portal: 'disabled' }); await focus(page);
      await expect(page.getByRole('button', { name: 'Create invitation link', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Continue to tenant record', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Continue to tenant record', exact: true }).click(); await expect(page.getByRole('heading', { name, exact: true })).toBeVisible(); assert.equal(mutations.length, before);
      await assertPerson(email, { name });
    } finally { await page.close(); await clearPolicy(); }
  });

  await tenantAdminCompatCases(t, { admin, db, call, provider, remote, counts, invitationDeliveries });
}
