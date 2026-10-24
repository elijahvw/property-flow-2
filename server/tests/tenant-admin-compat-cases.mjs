import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '../dist/sessions.js';

// Isolated fictional fixtures. Memberships below are explicit test setup;
// preparing an invitation account never grants company or resident access.
export async function tenantAdminCompatCases(t, { admin, db, call, provider, remote, counts, invitationDeliveries }) {
  const company = 'tfadmin-company', email = 'tfadmin-invited@test.invalid';
  const owner = 'tfadmin-owner', platform = 'tfadmin-platform';
  const limitedActors = ['tfadmin-manager', 'tfadmin-staff', 'tfadmin-resident'];
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  const denied = (response, status, code) => {
    assert.equal(response.statusCode, status, response.body);
    assert.equal(response.json().code, code, response.body);
  };
  const deliveries = () => invitationDeliveries.filter(message => message.to === email);
  await admin.query(`INSERT INTO "Company"(id,name,"updatedAt") VALUES
    ('tfadmin-company','Fictional admin compatibility company',NOW()),
    ('tfadmin-foreign-company','Fictional foreign admin compatibility company',NOW())`);
  for (const [id, companyId, role, platformRole] of [
    [owner, company, 'owner', null],
    ['tfadmin-manager', company, 'manager', null],
    ['tfadmin-staff', company, 'staff', null],
    ['tfadmin-resident', company, 'resident', null],
    ['tfadmin-foreign', 'tfadmin-foreign-company', 'owner', null],
    [platform, null, null, 'owner'],
  ]) {
    await admin.query('INSERT INTO "User"(id,email,"emailVerified","platformRole","updatedAt") VALUES($1,$2,true,$3,NOW())', [id, `${id}@test.invalid`, platformRole]);
    if (companyId) await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,$2,$3,NOW())', [id, companyId, role]);
    await db.session.create({ data: { tokenHash: digest(`token-${id}`), csrfToken: 'csrf', userId: id, expiresAt: new Date(Date.now() + 3600000), idleExpiresAt: new Date(Date.now() + 3600000) } });
  }
  await admin.query('INSERT INTO "CompanySubscription"("companyId","featureOverrides","updatedById","updatedAt") VALUES($1,$2::jsonb,$3,NOW())', [company, JSON.stringify({ leasing: 'read_only' }), owner]);
  let accountId;

  await t.test('leasing read-only preserves generic invitation links, email delivery and revocation under existing company roles', async () => {
    const before = counts(), beforeDeliveries = deliveries().length;
    const body = { name: 'Fictional admin compatibility invitee', email, role: 'staff', submissionKey: randomUUID() };
    for (const actor of limitedActors) {
      denied(await call(actor, 'POST', '/api/invitations', body), 403, 'ACCESS_DENIED');
      denied(await call(actor, 'GET', '/api/invitations/delivery'), 403, 'ACCESS_DENIED');
    }
    denied(await call(owner, 'POST', '/api/invitations', { ...body, role: 'owner' }), 403, 'OWNER_PROTECTED');
    assert.equal(counts().create, before.create, 'role denials happen before account provisioning');
    const initial = ok(await call(owner, 'POST', '/api/invitations', body));
    assert.ok(initial.acceptanceUrl);
    const source = await db.invitation.findUniqueOrThrow({ where: { id: initial.id } });
    accountId = source.accountId;
    assert.ok(accountId);
    assert.equal(source.contactId, null);
    assert.equal(source.leaseId, null);
    assert.equal(remote.get(accountId).email, email);
    assert.equal((await db.identity.findUniqueOrThrow({ where: { issuer_subject: { issuer: provider.issuer, subject: accountId } } })).userId, accountId);
    assert.equal(ok(await call(owner, 'GET', '/api/invitations/delivery')).emailAvailable, true);
    assert.ok(ok(await call(owner, 'GET', '/api/invitations?audience=team')).some(row => row.id === initial.id));
    for (const actor of [...limitedActors, 'tfadmin-foreign']) {
      const code = actor === 'tfadmin-foreign' ? 'COMPANY_ACCESS_DENIED' : 'ACCESS_DENIED';
      denied(await call(actor, 'POST', `/api/invitations/${initial.id}/replace`, { expectedVersion: initial.version, submissionKey: randomUUID(), delivery: 'link' }), 403, code);
      denied(await call(actor, 'POST', `/api/invitations/${initial.id}/revoke`, { expectedVersion: initial.version }), 403, code);
    }
    const linked = ok(await call(owner, 'POST', `/api/invitations/${initial.id}/replace`, { expectedVersion: initial.version, submissionKey: randomUUID(), delivery: 'link' }));
    assert.ok(linked.acceptanceUrl);
    assert.notEqual(linked.id, initial.id);
    assert.ok((await db.invitation.findUniqueOrThrow({ where: { id: initial.id } })).revokedAt);
    const sendBody = { expectedVersion: linked.version, submissionKey: randomUUID(), delivery: 'email' };
    const sent = ok(await call(owner, 'POST', `/api/invitations/${linked.id}/replace`, sendBody));
    assert.equal(sent.deliveryStatus, 'accepted');
    assert.equal(deliveries().length, beforeDeliveries + 1);
    assert.equal(deliveries().at(-1).acceptanceUrl, sent.acceptanceUrl);
    const replay = ok(await call(owner, 'POST', `/api/invitations/${linked.id}/replace`, sendBody));
    assert.equal(replay.id, sent.id);
    assert.equal(replay.acceptanceUrl, null);
    assert.equal(deliveries().length, beforeDeliveries + 1, 'retry does not send another fake email');
    ok(await call(owner, 'POST', `/api/invitations/${sent.id}/revoke`, { expectedVersion: sent.version }));
    const revoked = await db.invitation.findUniqueOrThrow({ where: { id: sent.id } });
    assert.ok(revoked.revokedAt);
    assert.equal(revoked.accountId, accountId);
    assert.equal(await db.companyMembership.findUnique({ where: { userId: accountId } }), null);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ResidentPropertyAssignment" WHERE "userId"=$1', [accountId])).rows[0].n, 0);
    assert.equal(counts().create, before.create + 1);
    assert.equal(counts().setup, before.setup);
  });

  await t.test('leasing read-only preserves member administration and platform password reset while contact recovery remains leasing governed', async () => {
    // Reuse the prepared account; the contact fixture creates no membership or portal grant.
    await admin.query('INSERT INTO "ResidentContact"(id,"companyId","userId",name,email,"createdById","updatedAt") VALUES($1,$2,$3,$4,$5,$6,NOW())', ['tfadmin-contact', company, accountId, 'Fictional admin compatibility invitee', email, owner]);
    const before = counts(), beforeDeliveries = deliveries().length;
    const contactRoot = '/api/company/resident-contacts/tfadmin-contact';
    const contact = ok(await call(owner, 'GET', contactRoot));
    const invitationsBefore = await db.invitation.count({ where: { accountId } });
    denied(await call(owner, 'POST', `${contactRoot}/invitations`, { expectedVersion: contact.version, approvals: [], submissionKey: randomUUID() }), 403, 'SUBSCRIPTION_READ_ONLY');
    denied(await call(owner, 'POST', `${contactRoot}/password-reset`, {}), 403, 'SUBSCRIPTION_READ_ONLY');
    assert.equal(await db.invitation.count({ where: { accountId } }), invitationsBefore);
    assert.equal(counts().create, before.create);
    assert.equal(counts().setup, before.setup);
    const memberPath = '/api/company/members/tfadmin-staff';
    const members = ok(await call(owner, 'GET', '/api/company/members'));
    assert.ok(members.some(member => member.userId === 'tfadmin-staff'));
    assert.ok(members.every(member => member.companyId === company));
    const member = members.find(row => row.userId === 'tfadmin-staff');
    const change = { role: 'staff', status: 'disabled', expectedVersion: member.version };
    for (const actor of [...limitedActors, platform]) {
      denied(await call(actor, 'GET', '/api/company/members'), 403, 'ACCESS_DENIED');
      denied(await call(actor, 'PATCH', memberPath, change), 403, 'ACCESS_DENIED');
    }
    denied(await call('tfadmin-foreign', 'PATCH', memberPath, change), 404, 'NOT_FOUND');
    denied(await call(owner, 'PATCH', `/api/company/members/${owner}`, { role: 'staff', status: 'active' }), 403, 'OWNER_PROTECTED');
    denied(await call(owner, 'PATCH', memberPath, { ...change, expectedVersion: member.version + 1 }), 409, 'STALE_MEMBERSHIP');
    const changed = ok(await call(owner, 'PATCH', memberPath, change));
    assert.equal(changed.status, 'disabled');
    assert.equal(changed.role, 'staff');
    assert.equal(changed.version, member.version + 1);
    assert.equal((await db.companyMembership.findUniqueOrThrow({ where: { userId: 'tfadmin-staff' } })).status, 'disabled');
    assert.equal(await db.auditEvent.count({ where: { companyId: company, targetId: 'tfadmin-staff', action: 'membership.updated' } }), 1);
    const resetPath = `/api/platform/users/${encodeURIComponent(accountId)}/password-reset`;
    for (const actor of [owner, ...limitedActors, 'tfadmin-foreign']) denied(await call(actor, 'POST', resetPath, {}), 403, 'ACCESS_DENIED');
    ok(await call(platform, 'POST', resetPath, {}));
    denied(await call(platform, 'POST', resetPath, {}), 429, 'SETUP_COOLDOWN');
    assert.equal(counts().setup, before.setup + 1);
    assert.equal(counts().create, before.create);
    assert.equal(deliveries().length, beforeDeliveries);
    assert.equal(remote.get(accountId).email, email);
    assert.equal(await db.companyMembership.findUnique({ where: { userId: accountId } }), null);
    assert.equal(ok(await call(owner, 'GET', contactRoot)).version, contact.version);
    assert.equal(await db.auditEvent.count({ where: { targetId: accountId, action: 'user.password_setup.requested' } }), 1);
  });
}
