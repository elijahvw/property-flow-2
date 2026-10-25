import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { registerApplication } from '../dist/application.js';
import { registerSessions, digest } from '../dist/sessions.js';
import { chromium, expect } from '@playwright/test';
import { newFixturePage } from './browser-fixture.mjs';

const url = process.env.TEST_SALES_DEMO_DATABASE_URL;
test('sales demo source integrity, access, atomic setup and teardown/rebuild', { skip: !url }, async t => {
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.pathname, '/propertyflow_sales_demo_test');
  assert.equal(process.env.SALES_DEMO_DISPOSABLE, 'tmpfs-verified');
  const admin = new pg.Pool({ connectionString: url }); t.after(() => admin.end());
  assert.equal((await admin.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n, 0);
  for (const name of readdirSync(new URL('../prisma/migrations/', import.meta.url)).filter(n => /^\d/.test(n)).sort()) await admin.query(readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
  await admin.query(`ALTER ROLE propertyflow_runtime LOGIN PASSWORD 'demo-test-only'`);
  const runtime = new URL(url); runtime.username = 'propertyflow_runtime'; runtime.password = 'demo-test-only';
  const pool = new pg.Pool({ connectionString: runtime.href });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) }); t.after(async () => { await db.$disconnect(); await pool.end(); });
  for (const id of ['platform','sales','customer','unverified','wrong-issuer']) {
    await admin.query(`INSERT INTO "User"(id,email,name,"emailVerified","platformRole","updatedAt") VALUES($1,$2,$1,$3,$4,NOW())`, [id, `${id}@test.invalid`, id !== 'unverified', id === 'platform' ? 'owner' : null]);
    await admin.query(`INSERT INTO "Identity"(id,issuer,subject,"userId") VALUES($1,$2,$1,$1)`, [id, id === 'wrong-issuer' ? 'https://other.invalid/' : 'https://unused.auth0.com/']);
  }
  await admin.query(`INSERT INTO "Company"(id,name,"updatedAt") VALUES('customer-company','Real company sentinel',NOW()); INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES('customer','customer-company','owner',NOW())`);
  const app = Fastify(); t.after(() => app.close());
  const auth = await registerSessions(app, db, { origin: 'https://app.test', domain: 'unused.auth0.com', clientId: 'test', clientSecret: 'test-only', secure: true });
  let providerCalls = 0;
  const unavailable = async () => { providerCalls++; throw Error('No external provider calls expected'); };
  registerApplication(app, db, auth, 'https://app.test', { issuer: 'https://unused.auth0.com/', databaseConnection: 'test', get: unavailable, create: unavailable, rename: unavailable, verify: unavailable, setup: unavailable, list: unavailable });
  const session = async id => db.session.upsert({ where: { tokenHash: digest(`token-${id}`) }, update: {}, create: { tokenHash: digest(`token-${id}`), csrfToken: 'csrf', userId: id, expiresAt: new Date(Date.now()+3600000), idleExpiresAt: new Date(Date.now()+3600000) } });
  for (const id of ['platform','sales','customer']) await session(id);
  const call = (user, method, path, payload, headers = {}) => app.inject({ method, url: path, headers: { cookie: `__Host-pf-session=token-${user}`, origin: 'https://app.test', 'x-csrf-token': 'csrf', ...headers }, ...(payload ? { payload } : {}) });
  const ok = async (...args) => { const r = await call(...args); assert.equal(r.statusCode,200,r.body); return r.json(); };
  const base = '/api/platform/sales-demos', payload = { ownerId:'sales', submissionKey:randomUUID() };
  let demo;
  await t.test('fresh platform authority, CSRF and dedicated identity boundaries', async () => {
    for (const user of ['sales','customer']) for (const method of ['GET','POST']) assert.equal((await call(user,method,base,method === 'POST' ? payload : undefined)).statusCode,403);
    for (const headers of [{origin:'https://evil.test'},{'x-csrf-token':'wrong'}]) assert.equal((await call('platform','POST',base,payload,headers)).statusCode,403);
    for (const ownerId of ['customer','platform','unverified','wrong-issuer']) assert.equal((await call('platform','POST',base,{ownerId,submissionKey:randomUUID()})).statusCode,409);
    assert.equal((await call('platform','POST',base,{...payload,companyId:'customer-company'})).statusCode,400);
    assert.equal((await call('platform','POST',base+'/customer-company/teardown',{expectedVersion:1})).statusCode,404);
  });
  await t.test('late audit failure rolls back the entire linked graph', async () => {
    await admin.query(`CREATE FUNCTION reject_demo_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sales_demo.created' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_demo_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_demo_audit()`);
    try { const r = await call('platform','POST',base,payload); assert.equal(r.statusCode,500,r.body); }
    finally { await admin.query('DROP TRIGGER reject_demo_audit ON "AuditEvent"; DROP FUNCTION reject_demo_audit()'); }
    assert.equal(await db.company.count(),1); assert.equal(await db.salesDemo.count(),0); assert.equal(await db.user.count(),5);
    assert.equal(await db.companyMembership.findUnique({where:{userId:'sales'}}),null);
  });
  await t.test('one complete linked portfolio, exact replay and normal company RLS', async () => {
    const concurrent = await Promise.all([ok('platform','POST',base,payload),ok('platform','POST',base,payload)]);
    assert.equal(concurrent[0].id,concurrent[1].id);
    demo = concurrent[0];
    const replay = await ok('platform','POST',base,payload); assert.equal(replay.id,demo.id);
    assert.equal((await call('platform','POST',base,{...payload,ownerId:'customer'})).statusCode,409);
    assert.equal((await call('platform','POST',base,{...payload,submissionKey:randomUUID()})).statusCode,409);
    assert.equal(demo.manifest.properties.length,2); assert.equal(demo.manifest.units.length,6); assert.equal(demo.manifest.leases.length,4);
    assert.equal((await ok('sales','GET','/api/company/properties')).length,2);
    assert.equal((await call('customer','GET',`/api/company/leases/${demo.manifest.leases[0]}`)).statusCode,404);
    assert.equal((await call('platform','GET','/api/company/properties',undefined,{'x-company-id':demo.companyId})).statusCode,403);
    assert.deepEqual(await db.lease.findMany(),[]);
    const facts = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.company_id',${demo.companyId},true)`;
      await tx.$queryRaw`SELECT set_config('app.notification_user_id','sales',true)`;
      return { leases:await tx.lease.count(), charges:await tx.rentCharge.count(), deposits:await tx.depositReceipt.count(), costs:await tx.maintenanceCost.findMany({include:{entry:true,request:true}}), files:await tx.documentVersion.findMany(), notifications:await tx.inboxNotification.count(), participants:await tx.leaseParticipant.findMany() };
    });
    assert.equal(facts.leases,5); assert.equal(facts.charges,13); assert.equal(facts.deposits,4);
    assert.equal(facts.costs.length,1); assert.equal(facts.costs[0].entry.propertyId,facts.costs[0].request.propertyId);
    assert.equal(facts.files[0].scanStatus,'pending'); assert.ok(facts.notifications > 0);
    const fictional = await db.user.findMany({where:{id:{in:demo.manifest.residents}},include:{identities:true}});
    assert.ok(fictional.every(u => !u.emailVerified && u.identities.every(i => i.issuer === 'https://sales-demo.invalid/')));
    assert.equal(await db.session.count({where:{userId:{in:demo.manifest.residents}}}),0);
    assert.equal(providerCalls,0);
    assert.equal((await admin.query(`SELECT count(*)::int n FROM "AuditEvent" WHERE action='sales_demo.created'`)).rows[0].n,1);
  });
  await t.test('teardown revokes sessions, retains sources and permits a new generation', async () => {
    assert.equal((await call('platform','POST',`${base}/${demo.id}/teardown`,{expectedVersion:99})).statusCode,409);
    await admin.query(`CREATE FUNCTION reject_demo_retirement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sales_demo.retired' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_demo_retirement BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_demo_retirement()`);
    try {assert.equal((await call('platform','POST',`${base}/${demo.id}/teardown`,{expectedVersion:1})).statusCode,500);}
    finally {await admin.query('DROP TRIGGER reject_demo_retirement ON "AuditEvent"; DROP FUNCTION reject_demo_retirement()');}
    assert.equal((await db.company.findUnique({where:{id:demo.companyId}})).status,'active');
    assert.equal((await db.companyMembership.findUnique({where:{userId:'sales'}})).companyId,demo.companyId);
    assert.equal((await call('sales','GET','/api/bootstrap')).statusCode,200);
    const retired = await ok('platform','POST',`${base}/${demo.id}/teardown`,{expectedVersion:1}); assert.equal(retired.status,'retired');
    assert.equal((await call('sales','GET','/api/bootstrap')).statusCode,401);
    assert.equal(await db.companyMembership.findUnique({where:{userId:'sales'}}),null);
    assert.equal((await db.company.findUnique({where:{id:demo.companyId}})).status,'suspended');
    assert.equal((await call('platform','POST',base,payload)).statusCode,409);
    const fresh = await ok('platform','POST',base,{...payload,submissionKey:randomUUID()}); assert.notEqual(fresh.companyId,demo.companyId);
    await ok('platform','POST',`${base}/${demo.id}/teardown`,{expectedVersion:1});
    assert.equal((await db.company.findUnique({where:{id:fresh.companyId}})).status,'active');
    assert.equal((await db.companyMembership.findUnique({where:{userId:'sales'}})).companyId,fresh.companyId);
    assert.equal((await db.company.findUnique({where:{id:'customer-company'}})).status,'active');
    assert.equal((await db.companyMembership.findUnique({where:{userId:'customer'}})).companyId,'customer-company');
  });
  await t.test('platform browser can build, recover a lost response and tear down', {skip:!process.env.TEST_SALES_DEMO_BROWSER_URL}, async () => {
    await admin.query(`INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES('browser-sales','browser-sales@test.invalid','Browser Sales',true,NOW()); INSERT INTO "Identity"(id,issuer,subject,"userId") VALUES('browser-sales','https://unused.auth0.com/','browser-sales','browser-sales')`);
    const browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {})});
    try {
      const page = await newFixturePage(browser); let lose=true; const keys=[];
      await page.route('**/api/**',async route => {
        const req=route.request(), u=new URL(req.url());
        const r=await call('platform',req.method(),u.pathname+u.search,req.postDataJSON() || undefined);
        if(req.method()==='POST' && u.pathname===base){keys.push(req.postDataJSON().submissionKey);assert.equal(r.statusCode,200,r.body);if(lose){lose=false;return route.abort('failed');}}
        await route.fulfill({status:r.statusCode,contentType:'application/json',body:r.body});
      });
      await page.goto(process.env.TEST_SALES_DEMO_BROWSER_URL+'/platform/companies');
      await page.getByRole('button',{name:'Manage sales demos',exact:true}).click();
      await page.getByLabel('Dedicated demo account').selectOption('browser-sales');
      await page.getByRole('button',{name:'Build sales demo',exact:true}).click();
      await expect(page.getByRole('alert').first()).toBeVisible();
      await page.getByRole('button',{name:'Build sales demo',exact:true}).click();
      await expect(page.getByRole('button',{name:'Tear down demo for browser-sales@test.invalid',exact:true})).toBeVisible({timeout:15000});
      assert.equal(keys.length,2); assert.equal(keys[0],keys[1]);
      await page.getByRole('button',{name:'Tear down demo for browser-sales@test.invalid',exact:true}).click();
      await page.getByRole('button',{name:'Confirm teardown',exact:true}).click();
      await expect(page.getByRole('button',{name:'Tear down demo for browser-sales@test.invalid',exact:true})).toHaveCount(0);
    } finally {await browser.close();}
  });
});
