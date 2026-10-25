import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function documentAcknowledgmentCases(t, { admin, db, call, sharingBase, residentDocuments, sharePayload, policy, today, shift }) {
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  const context = () => call('owner', 'GET', `${sharingBase}?userId=resident&documentVersionId=share-version-1`).then(ok);
  const grant = async () => {
    const current = await context();
    return ok(await call('owner', 'POST', sharingBase, sharePayload({ expectedVersion: current.items[0]?.version ?? null, expectedDocumentVersion: current.document.version, reason: 'Owner reviewed this receipt-test access grant' }))).share;
  };
  const receiptPath = id => `${residentDocuments}/${id}/received`;
  const payload = version => ({ expectedVersion: version, submissionKey: randomUUID() });
  const receiptCount = id => admin.query('SELECT count(*)::int n FROM "LeaseDocumentShareAction" WHERE "shareId"=$1 AND action=\'received\'', [id]).then(result => result.rows[0].n);
  let share, firstPayload, firstReceipt;

  await t.test('shared-file search and exact status reads retain current recipient scope and complete filtered totals', async () => {
    share = await grant();
    assert.equal(share.receivedAt, null);
    const row = ok(await call('resident', 'GET', `${residentDocuments}/${share.id}`));
    assert.equal(row.companyId, 'a');
    assert.equal(row.document.id, share.id);
    assert.equal(row.document.version, share.version);
    assert.equal(row.document.receivedAt, null);
    for (const search of ['share', 'HOME', 'share-unit']) {
      const result = ok(await call('resident', 'GET', `${residentDocuments}?q=${encodeURIComponent(search)}`));
      assert.equal(result.total, 1, search);
      assert.equal(result.items[0].id, share.id);
      assert.equal(result.nextCursor, null);
      assert.doesNotMatch(JSON.stringify(result), /submissionHash|submissionKey|reason|contentBase64|pros-other-resident/);
    }
    for (const search of ['no such original', '%', '_']) assert.equal(ok(await call('resident', 'GET', `${residentDocuments}?q=${encodeURIComponent(search)}`)).total, 0, search);
    for (const suffix of [`?q=${'a'.repeat(161)}`, '?q=a&q=b', '?q=%00', '?unknown=1']) assert.equal((await call('resident', 'GET', residentDocuments + suffix)).statusCode, 400, suffix);
    for (const user of ['pros-other-resident', 'share-occupant', 'share-foreign-resident']) assert.equal((await call(user, 'GET', `${residentDocuments}/${share.id}`)).statusCode, 404, user);
    assert.equal((await call('resident', 'GET', `${residentDocuments}/${share.id}`, undefined, { 'x-company-id': 'b' })).statusCode, 403);
  });

  await t.test('explicit receipt is atomic, versioned and exactly replayable without signing, downloading or changing a lease', async () => {
    firstPayload = payload(share.version);
    const leaseBefore = (await admin.query('SELECT version,status,"rentCents" FROM "Lease" WHERE id=\'share-lease\'')).rows[0];
    const auditBefore = (await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'document.share.received\'')).rows[0].n;
    const replies = await Promise.all([call('resident', 'POST', receiptPath(share.id), firstPayload), call('resident', 'POST', receiptPath(share.id), firstPayload)]);
    for (const response of replies) assert.equal(response.statusCode, 200, response.body);
    firstReceipt = replies[0].json();
    assert.deepEqual(replies[1].json(), firstReceipt);
    assert.equal(firstReceipt.version, share.version + 1);
    assert.ok(firstReceipt.receivedAt);
    assert.equal(await receiptCount(share.id), 1);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'document.share.received\'')).rows[0].n, auditBefore + 1);
    assert.deepEqual((await admin.query('SELECT version,status,"rentCents" FROM "Lease" WHERE id=\'share-lease\'')).rows[0], leaseBefore);
    assert.equal(ok(await call('resident', 'GET', residentDocuments)).items[0].receivedAt, firstReceipt.receivedAt);
    assert.equal((await call('resident', 'POST', receiptPath(share.id), { ...firstPayload, expectedVersion: firstReceipt.version })).json().code, 'SUBMISSION_MISMATCH');
    assert.equal((await call('resident', 'POST', receiptPath(share.id), payload(share.version))).json().code, 'RECORD_CHANGED');
    assert.equal((await call('resident', 'POST', receiptPath(share.id), payload(firstReceipt.version))).json().code, 'ALREADY_RECEIVED');
    const management = await context();
    assert.equal(management.items[0].receivedAt, firstReceipt.receivedAt);
    const history = ok(await call('manager', 'GET', `${sharingBase}/${share.id}/history`));
    assert.ok(history.items.some(event => event.action === 'received'));
    assert.ok(history.items.some(event => event.action === 'downloaded'));
    assert.doesNotMatch(JSON.stringify(history), /submissionHash|submissionKey/);
    assert.equal(await db.leaseDocumentShareAction.count(), 0, 'unscoped runtime reads do not expose receipt history');
  });

  await t.test('receipt replays recheck access and never acknowledge a later owner-reviewed grant', async () => {
    const current = (await context()).items[0];
    const revoked = ok(await call('owner', 'POST', `${sharingBase}/${share.id}/revoke`, { expectedVersion: current.version, reason: 'Owner withdrew the receipt-test grant', submissionKey: randomUUID() })).share;
    assert.equal((await call('resident', 'POST', receiptPath(share.id), firstPayload)).statusCode, 404);
    assert.equal(await receiptCount(share.id), 1);
    share = await grant();
    assert.equal(share.id, revoked.id);
    assert.equal(share.receivedAt, null);
    const replay = ok(await call('resident', 'POST', receiptPath(share.id), firstPayload));
    assert.equal(replay.version, share.version);
    assert.equal(replay.receivedAt, null, 'old receipt cannot confirm the new grant');
    assert.deepEqual(replay.receipt, firstReceipt.receipt);
    assert.equal(await receiptCount(share.id), 1);
    const next = ok(await call('resident', 'POST', receiptPath(share.id), payload(share.version)));
    assert.equal(next.version, share.version + 1);
    assert.ok(next.receivedAt);
    assert.equal(await receiptCount(share.id), 2);
  });

  await t.test('receipt recording rolls back with its audit and the original interrupted request remains retryable', async () => {
    share = await grant();
    const request = payload(share.version), before = await receiptCount(share.id);
    await admin.query("CREATE FUNCTION reject_document_receipt_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='document.share.received' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_document_receipt_audit BEFORE INSERT ON \"AuditEvent\" FOR EACH ROW EXECUTE FUNCTION reject_document_receipt_audit()");
    try { assert.equal((await call('resident', 'POST', receiptPath(share.id), request)).statusCode, 500); }
    finally { await admin.query('DROP TRIGGER reject_document_receipt_audit ON "AuditEvent"; DROP FUNCTION reject_document_receipt_audit()'); }
    const unchanged = ok(await call('resident', 'GET', `${residentDocuments}/${share.id}`)).document;
    assert.equal(unchanged.version, share.version);
    assert.equal(unchanged.receivedAt, null);
    assert.equal(await receiptCount(share.id), before);
    const saved = ok(await call('resident', 'POST', receiptPath(share.id), request));
    assert.equal(saved.version, share.version + 1);
    assert.equal(await receiptCount(share.id), before + 1);
    assert.deepEqual(ok(await call('resident', 'POST', receiptPath(share.id), request)), saved);
  });

  await t.test('receipt writes retain role, exact recipient, company, CSRF, expiry and feature boundaries', async () => {
    share = await grant();
    const request = payload(share.version), before = await receiptCount(share.id);
    for (const user of ['owner', 'manager', 'staff', 'platform', 'support']) assert.equal((await call(user, 'POST', receiptPath(share.id), request)).statusCode, 403, user);
    for (const user of ['pros-other-resident', 'share-occupant', 'share-foreign-resident']) assert.equal((await call(user, 'POST', receiptPath(share.id), request)).statusCode, 404, user);
    for (const extra of [{ 'x-company-id': 'b' }, { 'x-csrf-token': 'wrong' }, { origin: 'https://untrusted.test' }]) assert.equal((await call('resident', 'POST', receiptPath(share.id), request, extra)).statusCode, 403);
    for (const invalid of [{ ...request, expectedVersion: '1' }, { ...request, submissionKey: 'not-a-uuid' }, { ...request, signed: true }]) assert.equal((await call('resident', 'POST', receiptPath(share.id), invalid)).statusCode, 400);
    try {
      for (const feature of ['documents', 'leasing', 'resident_portal']) {
        await policy({ [feature]: 'read_only' });
        assert.equal((await call('resident', 'POST', receiptPath(share.id), request)).json().code, 'SUBSCRIPTION_READ_ONLY', feature);
        assert.equal((await call('resident', 'GET', `${residentDocuments}/${share.id}`)).statusCode, 200, feature);
      }
    } finally { await policy(); }
    await admin.query('UPDATE "LeaseDocumentShare" SET "expiresOn"=$1 WHERE id=$2', [shift(-1), share.id]);
    try { assert.equal((await call('resident', 'POST', receiptPath(share.id), request)).statusCode, 404); }
    finally { await admin.query('UPDATE "LeaseDocumentShare" SET "expiresOn"=$1 WHERE id=$2', [today, share.id]); }
    await admin.query('UPDATE "LeaseParticipant" SET "portalApproved"=false WHERE id=\'share-participant-resident\'');
    try { assert.equal((await call('resident', 'POST', receiptPath(share.id), request)).statusCode, 404); }
    finally { await admin.query('UPDATE "LeaseParticipant" SET "portalApproved"=true WHERE id=\'share-participant-resident\''); }
    assert.equal(await receiptCount(share.id), before);
    assert.equal(ok(await call('resident', 'GET', `${residentDocuments}/${share.id}`)).document.receivedAt, null);
  });
}
