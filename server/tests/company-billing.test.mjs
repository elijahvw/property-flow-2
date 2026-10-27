import { documentedInject } from './api-contract-assertions.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { registerApplication } from '../dist/application.js';
import { registerSessions, digest } from '../dist/sessions.js';
import { billingSweep } from '../dist/rent-billing-worker.js';

const url = process.env.TEST_COMPANY_BILLING_DATABASE_URL;
test('company controls, usage and SaaS billing preserve authority and financial history', { skip: !url }, async t => {
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/propertyflow_company_billing_test');
  assert.equal(process.env.COMPANY_BILLING_DISPOSABLE, 'tmpfs-verified');
  const admin = new pg.Pool({ connectionString: url });
  t.after(() => admin.end());
  assert.equal((await admin.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n, 0);
  for (const name of readdirSync(new URL('../prisma/migrations/', import.meta.url)).filter(n => /^\d/.test(n)).sort())
    await admin.query(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
  await admin.query("ALTER ROLE propertyflow_runtime LOGIN PASSWORD 'company-billing-test-only'");
  const runtime = new URL(url);
  runtime.username = 'propertyflow_runtime';
  runtime.password = 'company-billing-test-only';
  const pool = new pg.Pool({ connectionString: runtime.href, max: 10 });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  t.after(async () => { await db.$disconnect(); await pool.end(); });
  const now = new Date(), month = `${now.toISOString().slice(0, 7)}-01`;
  const nextMonth = new Date(`${month}T00:00:00.000Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  for (const id of ['a', 'b', 'suspended'])
    await admin.query('INSERT INTO "Company"(id,name,"legalName","contactEmail","addressLine1","adminNotes",status,timezone,"updatedAt") VALUES($1,$2,$3,$4,\'Fictional street\',\'Private platform note\',$5,\'UTC\',NOW())', [id, `Fictional company ${id}`, `Fictional legal ${id}`, `billing-${id}@test.invalid`, id === 'suspended' ? 'suspended' : 'active']);
  for (const [id, company, role, platform] of [
    ['platform', null, null, 'owner'], ['support', null, null, 'support'],
    ['owner', 'a', 'owner', null], ['manager', 'a', 'manager', null], ['staff', 'a', 'staff', null], ['resident', 'a', 'resident', null],
    ['foreign', 'b', 'owner', null], ['suspended-owner', 'suspended', 'owner', null],
  ]) {
    await admin.query('INSERT INTO "User"(id,email,name,"emailVerified","platformRole","updatedAt") VALUES($1,$2,$1,true,$3,NOW())', [id, `${id}@test.invalid`, platform]);
    await db.identity.create({ data: { issuer: 'https://unused.auth0.com/', subject: id, userId: id } });
    if (company) await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,$2,$3,NOW())', [id, company, role]);
    await db.session.create({ data: { tokenHash: digest(`token-${id}`), csrfToken: 'csrf', userId: id, expiresAt: new Date(Date.now() + 3600000), idleExpiresAt: new Date(Date.now() + 3600000) } });
  }
  for (const [id, company] of [['home', 'a'], ['foreign-home', 'b']])
    await admin.query('INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES($1,$1,\'street\',\'city\',\'state\',\'zip\',$2,NOW())', [id, company]);
  for (const [id, status] of [['active-unit', 'active'], ['draft-unit', 'active'], ['archived-unit', 'archived']])
    await admin.query('INSERT INTO "Unit"(id,"companyId","propertyId",label,status,"createdById","submissionKey","submissionHash","updatedAt") VALUES($1,\'a\',\'home\',$1,$2,\'owner\',$1,\'fixture\',NOW())', [id, status]);
  for (const [id, unit, status] of [['active-lease', 'active-unit', 'active'], ['draft-lease', 'draft-unit', 'draft'], ['ended-lease', 'archived-unit', 'ended']])
    await admin.query('INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentId","createdById","submissionKey","submissionHash","startsOn","endsOn","rentCents",status,"updatedAt") VALUES($1,\'a\',\'home\',$2,\'resident\',\'owner\',$1,\'fixture\',$3::date,($3::date+interval \'1 year\')::date,100000,$4,NOW())', [id, unit, month, status]);
  await admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES(\'a\',\'home\',\'resident\')');
  const bytes = Buffer.from('Isolated fictional company document.');
  await admin.query('INSERT INTO "PrivateDocument"(id,"companyId","leaseId",title,"archivedAt") VALUES(\'document\',\'a\',\'active-lease\',\'Fictional document\',NOW())');
  await admin.query('INSERT INTO "DocumentVersion"(id,"companyId","documentId",number,filename,"mediaType","byteLength",sha256,content,"createdById","submissionKey","submissionHash","scanStatus") VALUES(\'document-version\',\'a\',\'document\',1,\'fixture.txt\',\'text/plain\',$1,$2,$3,\'owner\',\'document-fixture\',\'fixture\',\'pending\')', [bytes.length, createHash('sha256').update(bytes).digest('hex'), bytes]);
  await admin.query('INSERT INTO "RentSchedule"(id,"companyId","propertyId","leaseId","createdById","submissionKey","submissionHash","firstPeriodOn","nextPeriodOn","amountCents","dueDay","graceDays","leadDays") VALUES(\'rent-schedule\',\'a\',\'home\',\'active-lease\',\'owner\',\'schedule-fixture\',\'fixture\',$1::date,$1::date,100000,1,0,0)', [month]);

  const app = Fastify();
  t.after(() => app.close());
  const auth = await registerSessions(app, db, { origin: 'https://app.test', domain: 'unused.auth0.com', clientId: 'test', clientSecret: 'test-only', secure: true });
  registerApplication(app, db, auth, 'https://app.test');
  const contexts = new Map();
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  const call = (user, method, path, payload, extra = {}) => documentedInject(app,{ method, url: path, headers: {
    ...(user ? { cookie: `__Host-pf-session=token-${user}` } : {}), origin: 'https://app.test', 'x-csrf-token': 'csrf',
    ...(contexts.has(user) ? { 'x-impersonation-id': contexts.get(user) } : {}), ...extra,
  }, ...(payload === undefined ? {} : { payload }) });
  const bootstrap = async user => { const body = ok(await call(user, 'GET', '/api/bootstrap')); contexts.set(user, body.impersonation?.contextId ?? ''); return body; };
  const scoped = run => db.$transaction(async tx => { await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`; return run(tx); });
  const policy = (features = {}, status = 'active', extra = {}) => db.companySubscription.upsert({
    where: { companyId: 'a' }, create: { companyId: 'a', updatedById: 'platform', status, featureOverrides: features, ...extra },
    update: { planId: null, status, trialEndsAt: null, overrideExpiresAt: null, featureOverrides: features, ...extra },
  });
  const features = ['properties', 'leasing', 'maintenance', 'documents', 'finances', 'reports', 'inspections', 'agreements', 'notifications', 'resident_portal'];
  const subscriptionPath = '/api/platform/companies/a/subscription', billingPath = '/api/platform/companies/a/billing';
  const subscribe = async (planId, patch = {}) => {
    const current = await db.companySubscription.findUnique({ where: { companyId: 'a' } });
    const payload = { expectedVersion: current?.version ?? null, planId, status: 'active', billingEmail: 'accounts@test.invalid', featureOverrides: {}, reason: 'Fictional company subscription configuration', submissionKey: randomUUID(), ...patch };
    return { payload, response: await call('platform', 'PUT', subscriptionPath, payload) };
  };
  let planOne, planTwo, invoiceOne, replacement;

  await t.test('migrations preserve runtime RLS and immutable billing history privileges', async () => {
    const role = (await pool.query('SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
    assert.deepEqual(role, { rolsuper: false, rolbypassrls: false, rolcreaterole: false });
    assert.equal(await db.property.count(), 0);
    assert.equal(await scoped(tx => tx.property.count()), 1);
    await assert.rejects(pool.query('CREATE TABLE forbidden_billing_table(id int)'), /permission denied/);
    for (const table of ['PlatformPlan', 'CompanySubscriptionRevision', 'SaaSInvoice', 'SaaSPayment', 'SaaSPaymentReversal', 'SaaSInvoiceEvent'])
      await assert.rejects(pool.query(`DELETE FROM "${table}"`), /permission denied/);
  });

  await t.test('billing is owner-only, company-scoped and recoverable while a company is suspended', async () => {
    assert.equal((await call(null, 'GET', '/api/platform/plans')).statusCode, 401);
    for (const user of ['support', 'owner', 'manager', 'staff', 'resident', 'foreign'])
      assert.equal((await call(user, 'GET', subscriptionPath)).statusCode, 403);
    for (const user of ['support', 'platform', 'manager', 'staff', 'resident']) {
      assert.equal((await call(user, 'GET', '/api/company/subscription')).statusCode, 403);
      assert.equal((await call(user, 'GET', '/api/company/billing')).statusCode, 403);
      assert.equal((await call(user, 'GET', '/api/company/usage')).statusCode, 403);
    }
    const legacy = ok(await call('owner', 'GET', '/api/company/subscription'));
    assert.equal(legacy.subscription, null);
    assert.ok(Object.values(legacy.effectiveFeatures).every(mode => mode === 'enabled'));
    assert.equal((await call('owner', 'GET', '/api/company/billing', undefined, { 'x-company-id': 'b' })).statusCode, 403);
    for (const path of ['/api/company/subscription', '/api/company/billing', '/api/company/usage'])
      assert.equal((await call('suspended-owner', 'GET', path)).statusCode, 200, path);
    assert.equal((await call('suspended-owner', 'GET', '/api/company/properties')).statusCode, 403);
    assert.equal(ok(await call('platform', 'GET', '/api/platform/plans')).items.length, 0, 'no invented plan prices are seeded');
  });

  await t.test('published monthly plans are immutable, versioned and replay-safe', async () => {
    const body = { name: 'Fictional monthly plan', monthlyPrice: '25.00', features, submissionKey: randomUUID() };
    for (const monthlyPrice of ['-1', '1.005', '1000000.01'])
      assert.equal((await call('platform', 'POST', '/api/platform/plans', { ...body, monthlyPrice, submissionKey: randomUUID() })).statusCode, 400);
    for (const extra of [{ origin: 'https://evil.test' }, { 'x-csrf-token': 'bad' }])
      assert.equal((await call('platform', 'POST', '/api/platform/plans', body, extra)).statusCode, 403);
    assert.equal((await call('support', 'POST', '/api/platform/plans', body)).statusCode, 403);
    planOne = ok(await call('platform', 'POST', '/api/platform/plans', body));
    assert.equal(planOne.version, 1);
    assert.equal(planOne.monthlyPriceCents, 2500);
    assert.equal(planOne.submissionHash, undefined);
    assert.equal(ok(await call('platform', 'POST', '/api/platform/plans', body)).id, planOne.id);
    assert.equal((await call('platform', 'POST', '/api/platform/plans', { ...body, monthlyPrice: '30.00' })).statusCode, 409);
    planTwo = ok(await call('platform', 'POST', '/api/platform/plans', { ...body, monthlyPrice: '30.00', submissionKey: randomUUID() }));
    assert.equal(planTwo.version, 2);
    assert.notEqual(planTwo.id, planOne.id);
    assert.equal((await db.platformPlan.findUniqueOrThrow({ where: { id: planOne.id } })).monthlyPriceCents, 2500);
    await assert.rejects(pool.query('UPDATE "PlatformPlan" SET "monthlyPriceCents"=999 WHERE id=$1', [planOne.id]), /permission denied/);
    assert.equal(await db.auditEvent.count({ where: { targetId: planOne.id, action: 'subscription.plan.published' } }), 1);
  });

  await t.test('company settings use optimistic versions, durable replay and atomic private history', async () => {
    const first = await subscribe(planOne.id, { featureOverrides: { notifications: 'read_only' }, overrideReason: 'Internal platform-only test reason' });
    const saved = ok(first.response);
    assert.equal(saved.subscription.version, 1);
    assert.equal(saved.subscription.plan.monthlyPriceCents, 2500);
    assert.equal(saved.effectiveFeatures.notifications, 'read_only');
    const replay = ok(await call('platform', 'PUT', subscriptionPath, first.payload));
    assert.equal(replay.subscription.version, 1);
    assert.equal(await db.companySubscriptionRevision.count({ where: { companyId: 'a' } }), 1);
    assert.equal((await call('platform', 'PUT', subscriptionPath, { ...first.payload, status: 'cancelled' })).statusCode, 409);
    assert.equal((await call('platform', 'PUT', subscriptionPath, { ...first.payload, submissionKey: randomUUID() })).statusCode, 409);
    const owner = ok(await call('owner', 'GET', '/api/company/subscription'));
    assert.equal(owner.plans, undefined);
    assert.equal(owner.subscription.overrideReason, undefined);
    assert.equal(owner.subscription.updatedById, undefined);
    assert.equal(JSON.stringify(owner).includes('Internal platform-only test reason'), false);
    assert.equal(JSON.stringify(owner).includes('Private platform note'), false);
    const history = ok(await call('platform', 'GET', `${subscriptionPath}/history`));
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].snapshot.overrideReason, 'Internal platform-only test reason');
    await admin.query("CREATE FUNCTION reject_subscription_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='subscription.updated' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_subscription_audit BEFORE INSERT ON \"AuditEvent\" FOR EACH ROW EXECUTE FUNCTION reject_subscription_audit()");
    try {
      const failed = await subscribe(planTwo.id);
      assert.equal(failed.response.statusCode, 500);
    } finally { await admin.query('DROP TRIGGER reject_subscription_audit ON "AuditEvent"; DROP FUNCTION reject_subscription_audit()'); }
    assert.equal((await db.companySubscription.findUniqueOrThrow({ where: { companyId: 'a' } })).planId, planOne.id);
    assert.equal(await db.companySubscriptionRevision.count({ where: { companyId: 'a' } }), 1);
    await policy();
  });

  await t.test('feature controls enforce direct APIs while preserving existing role and company boundaries', async () => {
    await policy({ maintenance: 'disabled', documents: 'disabled' });
    const denied = await call('owner', 'GET', '/api/company/maintenance');
    assert.equal(denied.statusCode, 403, denied.body);
    assert.equal(denied.json().code, 'FEATURE_DISABLED');
    const nested = await call('owner', 'GET', '/api/company/leases/active-lease/documents');
    assert.equal(nested.statusCode, 403, nested.body);
    assert.equal(nested.json().code, 'FEATURE_DISABLED');
    assert.equal((await call('owner', 'GET', '/api/company/properties')).statusCode, 200);
    assert.equal((await call('resident', 'GET', '/api/company/properties')).statusCode, 403);
    assert.equal((await call('owner', 'GET', '/api/company/properties', undefined, { 'x-company-id': 'b' })).statusCode, 403);
    assert.equal((await call('support', 'GET', '/api/company/properties')).statusCode, 403);
    const b = await bootstrap('owner');
    assert.equal(b.companyFeatures.maintenance, 'disabled');
    await policy();
  });

  await t.test('read-only and expired trial settings reject mutations before payload handling but preserve reads', async () => {
    const before = await admin.query('SELECT id,name,version FROM "Property" ORDER BY id');
    for (const [status, extra] of [['active', { featureOverrides: { properties: 'read_only' } }], ['trial', { trialEndsAt: new Date(Date.now() - 1000) }], ['cancelled', {}]]) {
      await policy({}, status, extra);
      const read = await call('owner', 'GET', '/api/company/properties');
      assert.equal(read.statusCode, 200, read.body);
      const write = await call('owner', 'POST', '/api/company/properties', {});
      assert.equal(write.statusCode, 403, write.body);
      assert.equal(write.json().code, 'SUBSCRIPTION_READ_ONLY');
    }
    assert.deepEqual((await admin.query('SELECT id,name,version FROM "Property" ORDER BY id')).rows, before.rows);
    await policy();
  });

  await t.test('overview and related pages omit disabled-area projections without losing permitted records', async () => {
    await policy({ finances: 'disabled', maintenance: 'disabled' });
    const overview = ok(await call('owner', 'GET', '/api/company/overview'));
    assert.equal(overview.cash, undefined);
    assert.equal(overview.rentCollections, undefined);
    assert.equal(overview.billingIssues, undefined);
    assert.equal(overview.leases.monthlyRentCents, undefined);
    assert.equal(overview.maintenance, undefined);
    const lease = ok(await call('owner', 'GET', '/api/company/leases/active-lease'));
    assert.equal(lease.id, 'active-lease');
    assert.equal(lease.overview.financeAvailable, false);
    assert.equal(lease.overview.scheduleStatus, undefined);
    assert.equal(lease.overview.depositRecorded, undefined);
    await policy({ leasing: 'disabled' });
    const property = ok(await call('owner', 'GET', '/api/company/property-directory'));
    assert.equal(property.items[0].activeUnits, 2);
    assert.equal(property.items[0].occupiedUnits, undefined);
    assert.equal(property.items[0].draftLeases, undefined);
    assert.equal(ok(await call('owner', 'GET', '/api/company/overview')).leases, undefined);
    await policy({ resident_portal: 'disabled' });
    const inbox = await call('resident', 'GET', '/api/account/notifications');
    assert.equal(inbox.statusCode, 403, inbox.body);
    assert.equal(inbox.json().code, 'FEATURE_DISABLED');
    await policy();
  });

  await t.test('expired overrides stop granting features and subscription changes are immediately visible', async () => {
    const plan = await db.platformPlan.create({ data: { name: 'Fictional disabled-feature fixture', monthlyPriceCents: 1700, features: ['properties'], createdById: 'platform', submissionKey: randomUUID(), submissionHash: 'fixture' } });
    await policy({ maintenance: 'enabled' }, 'active', { planId: plan.id, overrideReason: 'Fictional temporary test grant', overrideExpiresAt: new Date(Date.now() + 60000) });
    assert.equal((await call('owner', 'GET', '/api/company/maintenance')).statusCode, 200);
    await db.companySubscription.update({ where: { companyId: 'a' }, data: { overrideExpiresAt: new Date(Date.now() - 1000) } });
    const response = await call('owner', 'GET', '/api/company/maintenance');
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().code, 'FEATURE_DISABLED');
    await policy();
  });

  await t.test('recurring rent stops under disabled finance and resumes without duplicated rent when restored', async () => {
    await policy({ finances: 'disabled' });
    const before = await scoped(tx => tx.rentSchedule.findUniqueOrThrow({ where: { id: 'rent-schedule' } }));
    await billingSweep(db, {}, { now, budgetMs: 5000 });
    assert.equal(await scoped(tx => tx.rentCharge.count()), 0);
    const paused = await scoped(tx => tx.rentSchedule.findUniqueOrThrow({ where: { id: 'rent-schedule' } }));
    assert.equal(paused.nextPeriodOn.toISOString(), before.nextPeriodOn.toISOString());
    assert.equal(paused.lastErrorCode, before.lastErrorCode);
    await policy();
    await billingSweep(db, {}, { now, budgetMs: 5000 });
    const count = await scoped(tx => tx.rentCharge.count());
    assert.equal(count, 1);
    await billingSweep(db, {}, { now, budgetMs: 5000 });
    assert.equal(await scoped(tx => tx.rentCharge.count()), count);
  });

  await t.test('usage measures successful real company requests, excludes support and failures, and counts real resources', async () => {
    const readCount = async () => (await db.companyFeatureUsage.aggregate({ where: { companyId: 'a', area: 'properties' }, _sum: { successfulReads: true } }))._sum.successfulReads ?? 0;
    const writeCount = async () => (await db.companyFeatureUsage.aggregate({ where: { companyId: 'a', area: 'properties' }, _sum: { successfulWrites: true } }))._sum.successfulWrites ?? 0;
    const eventually = async (read, expected) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await read() === expected) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(await read(), expected, 'best-effort usage did not finish recording within the bounded local deadline');
    };
    const before = await readCount();
    assert.equal((await call('owner', 'GET', '/api/company/properties')).statusCode, 200);
    await eventually(readCount, before + 1);
    const writesBefore = await writeCount();
    const version = (await admin.query('SELECT version FROM "Property" WHERE id=\'home\'')).rows[0].version;
    const saved = await call('owner', 'PATCH', '/api/company/properties/home', { name: 'Fictional updated property', address: 'street', city: 'city', state: 'state', zip: 'zip', expectedVersion: version });
    assert.equal(saved.statusCode, 200, saved.body);
    await eventually(writeCount, writesBefore + 1);
    assert.equal((await call('resident', 'GET', '/api/company/properties')).statusCode, 403);
    assert.equal((await call('owner', 'GET', '/api/company/properties/missing')).statusCode, 404);
    assert.equal((await call('owner', 'GET', '/api/company/properties', undefined, { 'x-company-id': 'b' })).statusCode, 403);
    assert.equal(await readCount(), before + 1);
    ok(await call('platform', 'POST', '/api/impersonation', { userId: 'owner', reason: 'Fictional support usage exclusion check' }));
    await bootstrap('platform');
    assert.equal((await call('platform', 'GET', '/api/company/properties')).statusCode, 200);
    assert.equal(await readCount(), before + 1);
    ok(await call('platform', 'DELETE', '/api/impersonation'));
    await bootstrap('platform');
    const usage = ok(await call('owner', 'GET', '/api/company/usage'));
    assert.equal(usage.companyId, 'a');
    assert.deepEqual(usage.resources, { properties: 1, activeUnits: 2, activeLeases: 1, activeMembers: 4, documentVersions: 1, documentBytes: bytes.length });
    assert.equal(usage.areas.find(area => area.key === 'properties').successfulReads, before + 1);
    assert.equal(usage.areas.find(area => area.key === 'properties').successfulWrites, writesBefore + 1);
    assert.match(usage.definition, /do not determine monthly subscription charges/);
    assert.equal(await readCount(), before + 1, 'opening usage does not inflate feature activity');
    assert.equal(JSON.stringify(usage).includes('fixture.txt'), false);
    assert.equal(JSON.stringify(usage).includes('Private platform note'), false);
    const foreign = ok(await call('foreign', 'GET', '/api/company/usage'));
    assert.equal(foreign.companyId, 'b');
    assert.equal(foreign.resources.properties, 1);
    assert.equal(foreign.resources.documentBytes, 0);
    assert.equal((await call('platform', 'GET', '/api/platform/companies/missing/usage')).statusCode, 404);
    assert.equal((await call('owner', 'GET', '/api/company/usage?from=2026-02-30')).statusCode, 400);
    assert.equal((await call('owner', 'GET', '/api/company/usage?from=2020-01-01&to=2026-01-01')).statusCode, 400);
  });

  await t.test('invoice issuance snapshots a configured company plan and period with replay and cross-company protection', async () => {
    const unconfigured = ok(await call('platform', 'GET', subscriptionPath));
    const noPlan = await call('platform', 'POST', `${billingPath}/invoices`, { period: month.slice(0, 7), dueOn: month, expectedSubscriptionVersion: unconfigured.subscription?.version ?? 1, expectedCompanyVersion: unconfigured.billingProfile.companyVersion, submissionKey: randomUUID() });
    assert.equal(noPlan.statusCode, 409, noPlan.body);
    assert.equal(noPlan.json().code, 'BILLING_NOT_CONFIGURED');
    ok((await subscribe(planOne.id)).response);
    const reviewed = ok(await call('platform', 'GET', subscriptionPath));
    const stalePrice = { period: month.slice(0, 7), dueOn: now.toISOString().slice(0, 10), expectedSubscriptionVersion: reviewed.subscription.version, expectedCompanyVersion: reviewed.billingProfile.companyVersion, submissionKey: randomUUID() };
    assert.equal(reviewed.subscription.plan.monthlyPriceCents, 2500);
    assert.equal(reviewed.billingProfile.name, 'Fictional legal a');
    assert.equal(reviewed.billingProfile.address.addressLine1, 'Fictional street');
    const beforeCount = await db.saaSInvoice.count({ where: { companyId: 'a' } });
    const beforeAudit = await db.auditEvent.count({ where: { companyId: 'a', action: 'subscription.invoice.issued' } });
    ok((await subscribe(planTwo.id)).response);
    const stalePriceResult = await call('platform', 'POST', `${billingPath}/invoices`, stalePrice);
    assert.equal(stalePriceResult.statusCode, 409, stalePriceResult.body);
    assert.equal(stalePriceResult.json().code, 'BILLING_REVIEW_CHANGED');
    const priceReview = ok(await call('platform', 'GET', subscriptionPath));
    const staleAddress = { ...stalePrice, expectedSubscriptionVersion: priceReview.subscription.version, expectedCompanyVersion: priceReview.billingProfile.companyVersion, submissionKey: randomUUID() };
    await admin.query('UPDATE "Company" SET "addressLine1"=\'Concurrent fictional billing address\',version=version+1 WHERE id=\'a\'');
    const staleAddressResult = await call('platform', 'POST', `${billingPath}/invoices`, staleAddress);
    assert.equal(staleAddressResult.statusCode, 409, staleAddressResult.body);
    assert.equal(staleAddressResult.json().code, 'BILLING_REVIEW_CHANGED');
    assert.equal(await db.saaSInvoice.count({ where: { companyId: 'a' } }), beforeCount);
    assert.equal(await db.auditEvent.count({ where: { companyId: 'a', action: 'subscription.invoice.issued' } }), beforeAudit);
    await admin.query('UPDATE "Company" SET "addressLine1"=\'Fictional street\',version=version+1 WHERE id=\'a\'');
    ok((await subscribe(planOne.id)).response);
    const freshReview = ok(await call('platform', 'GET', subscriptionPath));
    const body = { period: month.slice(0, 7), dueOn: now.toISOString().slice(0, 10), expectedSubscriptionVersion: freshReview.subscription.version, expectedCompanyVersion: freshReview.billingProfile.companyVersion, submissionKey: randomUUID() };
    assert.equal((await call('platform', 'POST', `${billingPath}/invoices`, { ...body, monthlyPriceCents: 1 })).statusCode, 400);
    for (const user of ['support', 'owner', 'manager', 'resident']) assert.equal((await call(user, 'POST', `${billingPath}/invoices`, body)).statusCode, 403);
    invoiceOne = ok(await call('platform', 'POST', `${billingPath}/invoices`, body));
    assert.equal(invoiceOne.invoice.monthlyPriceCents, 2500);
    assert.equal(invoiceOne.invoice.planVersion, 1);
    assert.equal(invoiceOne.invoice.billingName, 'Fictional legal a');
    assert.equal(invoiceOne.invoice.billingEmail, 'accounts@test.invalid');
    assert.equal(invoiceOne.invoice.billingAddress.addressLine1, 'Fictional street');
    assert.equal(invoiceOne.invoice.periodStart.slice(0, 10), month);
    assert.equal(invoiceOne.invoice.periodEnd.slice(0, 10), nextMonth.toISOString().slice(0, 10));
    assert.equal(invoiceOne.invoice.balanceCents, 2500);
    assert.match(invoiceOne.invoice.reference, /^INV-\d+$/);
    assert.equal(invoiceOne.invoice.submissionHash, undefined);
    assert.equal(ok(await call('platform', 'POST', `${billingPath}/invoices`, body)).invoice.id, invoiceOne.invoice.id);
    assert.equal((await call('platform', 'POST', `${billingPath}/invoices`, { ...body, submissionKey: randomUUID() })).statusCode, 409);
    const owner = ok(await call('owner', 'GET', `/api/company/billing/invoices/${invoiceOne.invoice.id}`));
    assert.equal(owner.invoice.id, invoiceOne.invoice.id);
    assert.equal((await call('foreign', 'GET', `/api/company/billing/invoices/${invoiceOne.invoice.id}`)).statusCode, 404);
    assert.equal((await call('platform', 'GET', `/api/platform/companies/b/billing/invoices/${invoiceOne.invoice.id}`)).statusCode, 404);
    assert.equal(JSON.stringify(owner).includes('Private platform note'), false);
    assert.equal(owner.invoice.createdById, undefined);
    await admin.query('UPDATE "Company" SET "legalName"=\'Changed legal fixture\',"addressLine1"=\'Changed street fixture\',version=version+1 WHERE id=\'a\'');
    ok((await subscribe(planTwo.id)).response);
    assert.equal(ok(await call('platform', 'POST', `${billingPath}/invoices`, body)).invoice.id, invoiceOne.invoice.id, 'a committed issuance remains replayable after company and plan versions change');
    const retained = ok(await call('platform', 'GET', `${billingPath}/invoices/${invoiceOne.invoice.id}`));
    assert.equal(retained.invoice.billingName, 'Fictional legal a');
    assert.equal(retained.invoice.billingAddress.addressLine1, 'Fictional street');
    assert.equal(retained.invoice.monthlyPriceCents, 2500);
    assert.equal(retained.invoice.planVersion, 1);
    await assert.rejects(pool.query('UPDATE "SaaSInvoice" SET "monthlyPriceCents"=1 WHERE id=$1', [invoiceOne.invoice.id]), /permission denied/);
  });

  await t.test('actual receipts cannot overpay or race, and response-loss replay survives subsequent changes', async () => {
    const path = `${billingPath}/invoices/${invoiceOne.invoice.id}/payments`;
    const first = { expectedVersion: invoiceOne.invoice.version, amount: '10.00', receivedOn: now.toISOString().slice(0, 10), paymentReference: 'Fictional bank receipt A', submissionKey: randomUUID() };
    assert.equal((await call('owner', 'POST', path, first)).statusCode, 403);
    const part = ok(await call('platform', 'POST', path, first));
    assert.equal(part.invoice.paidCents, 1000);
    assert.equal(part.invoice.balanceCents, 1500);
    assert.equal(part.invoice.paymentState, 'partially_paid');
    const second = { ...first, expectedVersion: part.invoice.version, amount: '15.00', paymentReference: 'Fictional bank receipt B', submissionKey: randomUUID() };
    assert.equal((await call('platform', 'POST', path, { ...second, amount: '15.01' })).statusCode, 409);
    const future = new Date(now); future.setUTCDate(future.getUTCDate() + 2);
    assert.equal((await call('platform', 'POST', path, { ...second, receivedOn: future.toISOString().slice(0, 10) })).statusCode, 400);
    const attempts = await Promise.all([second, { ...second, submissionKey: randomUUID() }].map(body => call('platform', 'POST', path, body)));
    assert.equal(attempts.filter(result => result.statusCode === 200).length, 1, attempts.map(result => result.body).join('\n'));
    assert.ok(attempts.every(result => [200, 409].includes(result.statusCode)));
    const paid = ok(attempts.find(result => result.statusCode === 200));
    assert.equal(paid.invoice.paidCents, 2500);
    assert.equal(paid.invoice.balanceCents, 0);
    assert.equal(paid.invoice.paymentState, 'paid');
    for (const payment of paid.payments) {
      assert.equal(payment.submissionKey, undefined);
      assert.equal(payment.submissionHash, undefined);
      assert.equal(payment.createdById, undefined);
    }
    const replay = ok(await call('platform', 'POST', path, first));
    assert.equal(replay.payments.length, 2);
    assert.equal(replay.invoice.version, paid.invoice.version);
    assert.equal((await call('platform', 'POST', path, { ...first, amount: '10.01' })).statusCode, 409);
    assert.equal(await db.saaSPayment.count({ where: { companyId: 'a', invoiceId: invoiceOne.invoice.id } }), 2);
    assert.equal(await db.auditEvent.count({ where: { targetId: invoiceOne.invoice.id, action: 'subscription.payment.recorded' } }), 2);
    invoiceOne = replay;
  });

  await t.test('receipt corrections and invoice void/reissue preserve immutable history and separate company debt', async () => {
    const path = `${billingPath}/invoices/${invoiceOne.invoice.id}`;
    assert.equal((await call('platform', 'POST', `${path}/void`, { expectedVersion: invoiceOne.invoice.version, reason: 'Fictional correction', submissionKey: randomUUID() })).statusCode, 409);
    let detail = invoiceOne;
    for (const payment of invoiceOne.payments) {
      const body = { expectedVersion: detail.invoice.version, reason: 'Fictional receipt was recorded in error', submissionKey: randomUUID() };
      const reverse = `${path}/payments/${payment.id}/reverse`;
      detail = ok(await call('platform', 'POST', reverse, body));
      assert.equal(ok(await call('platform', 'POST', reverse, body)).invoice.version, detail.invoice.version);
    }
    assert.equal(detail.invoice.paidCents, 0);
    assert.equal(detail.invoice.balanceCents, 2500);
    assert.equal(detail.payments.length, 2);
    assert.ok(detail.payments.every(payment => payment.reversal));
    const voidBody = { expectedVersion: detail.invoice.version, reason: 'Fictional replacement after plan review', submissionKey: randomUUID() };
    const cancelled = ok(await call('platform', 'POST', `${path}/void`, voidBody));
    assert.equal(cancelled.invoice.status, 'void');
    assert.equal(cancelled.invoice.balanceCents, 0);
    assert.equal(ok(await call('platform', 'POST', `${path}/void`, voidBody)).invoice.version, cancelled.invoice.version);
    const replacementReview = ok(await call('platform', 'GET', subscriptionPath));
    replacement = ok(await call('platform', 'POST', `${billingPath}/invoices`, { period: month.slice(0, 7), dueOn: now.toISOString().slice(0, 10), expectedSubscriptionVersion: replacementReview.subscription.version, expectedCompanyVersion: replacementReview.billingProfile.companyVersion, submissionKey: randomUUID() }));
    assert.notEqual(replacement.invoice.id, invoiceOne.invoice.id);
    assert.equal(replacement.invoice.monthlyPriceCents, 3000);
    assert.equal(replacement.invoice.planVersion, 2);
    assert.equal(replacement.invoice.billingName, 'Changed legal fixture');
    const list = ok(await call('owner', 'GET', '/api/company/billing'));
    assert.equal(list.total, 2);
    assert.equal(list.totalOutstandingCents, 3000);
    assert.equal(await scoped(tx => tx.ledgerEntry.count()), 0, 'SaaS receipts never post to customer rent/cash ledger');
    assert.equal(await scoped(tx => tx.rentCharge.count()), 1, 'only the explicit rent-worker test created tenant debt');
    assert.equal(await db.saaSPaymentReversal.count({ where: { companyId: 'a' } }), 2);
    assert.ok(cancelled.events.some(event => event.action === 'invoice.voided'));
  });

  await t.test('payment failures roll back receipts, versions, event history and totals atomically', async () => {
    const id = replacement.invoice.id, path = `${billingPath}/invoices/${id}`;
    const priorEvents = await db.saaSInvoiceEvent.count({ where: { invoiceId: id } });
    await admin.query("CREATE FUNCTION reject_payment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='subscription.payment.recorded' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_payment_audit BEFORE INSERT ON \"AuditEvent\" FOR EACH ROW EXECUTE FUNCTION reject_payment_audit()");
    try {
      const result = await call('platform', 'POST', `${path}/payments`, { expectedVersion: replacement.invoice.version, amount: '1.00', receivedOn: now.toISOString().slice(0, 10), paymentReference: 'Fictional rollback check', submissionKey: randomUUID() });
      assert.equal(result.statusCode, 500, result.body);
    } finally { await admin.query('DROP TRIGGER reject_payment_audit ON "AuditEvent"; DROP FUNCTION reject_payment_audit()'); }
    const after = ok(await call('platform', 'GET', path));
    assert.equal(after.invoice.version, replacement.invoice.version);
    assert.equal(after.invoice.balanceCents, 3000);
    assert.equal(after.payments.length, 0);
    assert.equal(await db.saaSInvoiceEvent.count({ where: { invoiceId: id } }), priorEvents);
    assert.equal(ok(await call('owner', 'GET', '/api/company/billing')).totalOutstandingCents, 3000);
  });
});
