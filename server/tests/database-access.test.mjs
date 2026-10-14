import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { registerApplication, tenantTransaction } from '../dist/application.js';
import { registerSessions, digest } from '../dist/sessions.js';

const url = process.env.TEST_DATABASE_URL;
test('PostgreSQL migration, session and authorization integration', { skip: !url }, async t => {
  const target = new URL(url);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && target.pathname === '/propertyflow_access_test' && process.env.NODE_ENV !== 'production', 'Integration tests require the isolated local test database');
  const admin = new pg.Pool({ connectionString: url });
  t.after(() => admin.end());
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  for (const migration of readdirSync(new URL('../prisma/migrations/', import.meta.url)).filter(n => /^\d/.test(n)).sort()) {
    await admin.query(readFileSync(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), 'utf8'));
    if (migration === '202603030001_init') {
      await admin.query(`INSERT INTO "Company" (id,name,"updatedAt") VALUES ('legacy','Existing company',NOW());
        INSERT INTO "User" (id,email,role,"companyId","updatedAt") VALUES ('legacy-admin','legacy@test.invalid','admin','legacy',NOW());
        INSERT INTO "Property" (id,name,address,city,state,zip,"companyId","updatedAt") VALUES ('legacy-property','Existing property','Existing street','Existing city','Existing state','Existing code','legacy',NOW())`);
    }
  }
  await admin.query("ALTER ROLE propertyflow_runtime LOGIN PASSWORD 'isolated-runtime-test-password'");
  const runtimeUrl = new URL(url); runtimeUrl.username = 'propertyflow_runtime'; runtimeUrl.password = 'isolated-runtime-test-password';
  const runtimePool = new pg.Pool({ connectionString: runtimeUrl.href, max: 1 });
  const db = new PrismaClient({ adapter: new PrismaPg(runtimePool) });
  t.after(() => db.$disconnect());
  for (const id of ['a', 'b']) await admin.query('INSERT INTO "Company" (id,name,"updatedAt") VALUES ($1,$1,NOW())', [id]);
  const users = [['platform',null,null,'owner'], ['owner-a','a','owner',null], ['manager-a','a','manager',null], ['resident-a','a','resident',null], ['owner-b','b','owner',null], ['unassigned',null,null,null], ['invitee',null,null,null]];
  for (const [id, companyId, role, platformRole] of users) {
    await admin.query('INSERT INTO "User" (id,email,name,"platformRole","emailVerified","updatedAt") VALUES ($1,$2,$1,$3,true,NOW())', [id, `${id}@test.invalid`, platformRole]);
    if (companyId) await admin.query('INSERT INTO "CompanyMembership" ("userId","companyId",role,"updatedAt") VALUES ($1,$2,$3,NOW())', [id,companyId,role]);
    await db.session.create({ data: { tokenHash: digest(`token-${id}`), csrfToken: 'test-csrf', userId: id, expiresAt: new Date(Date.now()+3600000), idleExpiresAt: new Date(Date.now()+3600000) } });
  }
  const app = Fastify(); t.after(() => app.close());
  const auth = await registerSessions(app, db, { origin: 'https://app.test', domain: 'unused.auth0.com', clientId: 'test-web', clientSecret: 'test-only', secure: true });
  registerApplication(app, db, auth, 'https://app.test');
  const call = (user, method, path, body, extra = {}) => app.inject({ method, url: path, headers: { ...(user ? { cookie: `__Host-pf-session=token-${user}` } : {}), origin: 'https://app.test', 'x-csrf-token': 'test-csrf', ...extra }, ...(body === undefined ? {} : { payload: body }) });
  const property = { name:'Test property', address:'Test street',city:'Test city',state:'Test state',zip:'Test code' };
  await t.test('populated legacy records survive migrations without automatic privilege grants', async () => {
    const legacy = await db.user.findUnique({where:{id:'legacy-admin'}});
    assert.equal(legacy.role,'admin'); assert.equal(legacy.companyId,'legacy'); assert.equal(legacy.platformRole,null);
    assert.equal(await db.companyMembership.count({where:{userId:legacy.id}}),0);
    assert.equal((await tenantTransaction(db,'legacy',tx=>tx.property.findMany()))[0].name,'Existing property');
  });
  await t.test('existing schema remains, runtime cannot bypass RLS or create tables', async () => {
    const role = (await runtimePool.query('SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
    assert.deepEqual(role,{rolsuper:false,rolbypassrls:false,rolcreaterole:false});
    await assert.rejects(runtimePool.query('CREATE TABLE unauthorized(id int)'), /permission denied/);
  });
  await t.test('manager creates only within own company; resident and outsider are denied', async () => {
    assert.equal((await call('manager-a','POST','/api/company/properties',property)).statusCode,200);
    assert.equal((await call('resident-a','POST','/api/company/properties',property)).statusCode,403);
    assert.equal((await call('owner-b','GET','/api/company/properties',undefined,{'x-company-id':'a'})).statusCode,403);
    assert.equal((await call('platform','GET','/api/company/properties')).statusCode,403);
    assert.equal((await call(null,'GET','/api/company/properties')).statusCode,401);
  });
  await t.test('row policies deny unscoped reads/writes and never leak pooled company context', async () => {
    assert.equal((await db.property.findMany()).length,0);
    assert.equal((await tenantTransaction(db,'a',tx=>tx.property.findMany())).length,1);
    assert.equal((await tenantTransaction(db,'b',tx=>tx.property.findMany())).length,0);
    assert.equal((await db.property.findMany()).length,0);
    await assert.rejects(tenantTransaction(db,'a',tx=>tx.property.create({data:{...property,companyId:'b'}})), /row-level security/);
    assert.equal((await db.property.findMany()).length,0);
  });
  await t.test('company suspension revokes an existing session’s access immediately', async () => {
    assert.equal((await call('platform','PATCH','/api/platform/companies/a',{name:'a',status:'suspended'})).statusCode,200);
    assert.equal((await call('manager-a','GET','/api/company/properties')).statusCode,403);
    assert.deepEqual((await call('manager-a','GET','/api/bootstrap')).json().permissions,[]);
    await call('platform','PATCH','/api/platform/companies/a',{name:'a',status:'active'});
  });
  await t.test('company owners cannot grant platform roles or remove the last owner', async () => {
    assert.equal((await call('owner-a','PUT','/api/platform/users/resident-a/membership',{companyId:'a',role:'owner',status:'active'})).statusCode,403);
    assert.equal((await call('owner-a','PATCH','/api/company/members/resident-a',{role:'admin',status:'active'})).statusCode,400);
    assert.equal((await call('platform','PUT','/api/platform/users/owner-a/membership',{companyId:'b',role:'manager',status:'active'})).statusCode,409);
    assert.equal((await call('platform','PATCH','/api/platform/users/owner-a/status',{status:'disabled'})).statusCode,409);
  });
  await t.test('ownership transfer is atomic and preserves a valid owner', async () => {
    assert.equal((await call('owner-a','POST','/api/company/transfer-ownership',{userId:'owner-b'})).statusCode,403);
    assert.equal((await call('owner-a','POST','/api/company/transfer-ownership',{userId:'manager-a'})).statusCode,200);
    assert.equal((await call('owner-a','GET','/api/company/members')).statusCode,403);
    assert.equal((await call('manager-a','GET','/api/company/members')).statusCode,200);
  });
  await t.test('membership transfer removes old-company visibility and remains unique per user', async () => {
    assert.equal((await call('platform','PUT','/api/platform/users/resident-a/membership',{companyId:'b',role:'manager',status:'active'})).statusCode,200);
    assert.deepEqual((await call('resident-a','GET','/api/company/properties')).json(),[]);
    assert.equal((await call('resident-a','GET','/api/company/properties',undefined,{'x-company-id':'a'})).statusCode,403);
    assert.equal(await db.companyMembership.count({where:{userId:'resident-a'}}),1);
    assert.equal(await db.auditEvent.count({where:{action:'membership.transferred',targetId:'resident-a'}}),1);
  });
  let acceptanceToken;
  await t.test('invitation acceptance rejects wrong email, unverified email and forged tokens', async () => {
    const invite = await call('platform','POST','/api/invitations',{companyId:'a',role:'staff',email:'invitee@test.invalid'});
    assert.equal(invite.statusCode,200,invite.body); acceptanceToken = new URL(invite.json().acceptanceUrl).hash.slice(1);
    assert.equal((await call('unassigned','POST','/api/invitations/accept',{token:acceptanceToken})).statusCode,403);
    assert.equal((await call('invitee','POST','/api/invitations/accept',{token:'forged'})).statusCode,403);
    await db.user.update({where:{id:'invitee'},data:{emailVerified:false}});
    assert.equal((await call('invitee','POST','/api/invitations/accept',{token:acceptanceToken})).statusCode,403);
    await db.user.update({where:{id:'invitee'},data:{emailVerified:true}});
  });
  await t.test('invitation is single use and cannot restore a disabled membership', async () => {
    assert.equal((await call('invitee','POST','/api/invitations/accept',{token:acceptanceToken})).statusCode,200);
    assert.equal((await call('invitee','POST','/api/invitations/accept',{token:acceptanceToken})).statusCode,403);
    await call('manager-a','PATCH','/api/company/members/invitee',{role:'staff',status:'disabled'});
    const invite = await call('platform','POST','/api/invitations',{companyId:'b',role:'owner',email:'invitee@test.invalid'});
    const token = new URL(invite.json().acceptanceUrl).hash.slice(1);
    assert.equal((await call('invitee','POST','/api/invitations/accept',{token})).statusCode,409);
    assert.equal((await db.companyMembership.findUnique({where:{userId:'invitee'}})).status,'disabled');
  });
  await t.test('revoked and expired invitations cannot be accepted', async () => {
    for (const revoked of [true,false]) {
      const invitation = (await call('platform','POST','/api/invitations',{companyId:'a',role:'resident',email:'unassigned@test.invalid'})).json();
      if (revoked) await call('platform','POST',`/api/invitations/${invitation.id}/revoke`,{});
      else await db.invitation.update({where:{id:invitation.id},data:{expiresAt:new Date(0)}});
      assert.equal((await call('unassigned','POST','/api/invitations/accept',{token:new URL(invitation.acceptanceUrl).hash.slice(1)})).statusCode,403);
    }
  });
  await t.test('runtime cannot rewrite audit history', async () => { await assert.rejects(runtimePool.query('DELETE FROM "AuditEvent"'), /permission denied/); });
  await t.test('bad callback binding cannot consume a login transaction', async () => {
    await db.loginTransaction.create({data:{stateHash:digest('state'),bindingHash:digest('binding'),verifier:'verifier',nonce:'nonce',returnTo:'/dashboard',expiresAt:new Date(Date.now()+60000)}});
    const result = await app.inject({url:'/api/auth/callback?state=state&code=unused',headers:{cookie:'__Host-pf-login=wrong'}});
    assert.equal(result.statusCode,302); assert.equal(await db.loginTransaction.count(),1);
  });
  await t.test('logout revokes the persisted session and API responses stay JSON/no-store', async () => {
    assert.equal((await call('unassigned','POST','/api/auth/logout',{})).statusCode,200);
    const response = await call('unassigned','GET','/api/bootstrap');
    assert.equal(response.statusCode,401); assert.match(response.headers['content-type'], /application\/json/); assert.equal(response.headers['cache-control'],'no-store');
  });
});
