import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function expenseImportCases(t, admin, call, app, db, pool) {
  const base = '/api/company/imports/expenses';
  const headers = ['sourceId', 'propertyId', 'occurredOn', 'amount', 'category', 'memo'];
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  const today = ok(await call('owner', 'GET', '/api/company/reports/context')).today;
  const shift = days => { const value = new Date(`${today}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
  const csv = rows => rows.map(row => row.map(value => /[",\r\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : value).join(',')).join('\r\n');
  const source = (id, extra = []) => [id, 'home', '2001-01-01', '123.45', 'repairs', 'Fictional paid expense', ...extra];
  const previewBody = (namespace, rows, extra = {}) => ({ sourceNamespace: namespace, fileName: 'fictional-paid-expenses.csv', csv: csv([headers, ...rows]), submissionKey: randomUUID(), ...extra });
  const preview = async (namespace, rows, extra = {}, user = 'owner') => ok(await call(user, 'POST', `${base}/preview`, previewBody(namespace, rows, extra)));
  const commit = (batch, extra = {}) => ({ expectedVersion: batch.version, confirmedPaid: true, confirmedNotRecorded: true, submissionKey: randomUUID(), ...extra });
  const policy = (featureOverrides = {}, status = 'active') => db.companySubscription.upsert({ where: { companyId: 'a' }, create: { companyId: 'a', status, featureOverrides, updatedById: 'platform' }, update: { status, planId: null, featureOverrides, trialEndsAt: null, overrideExpiresAt: null } });
  let basicBatch, basicPayload, basicResult;

  await t.test('paid expense preview reports every row issue and an explicitly incomplete valid-row subtotal without posting money', async () => {
    const before = (await admin.query('SELECT count(*)::int n FROM "LedgerEntry"')).rows[0].n;
    const batch = await preview('expimp.invalid', [
      ['good-001', 'home', '2001-01-01', '100.01', 'repairs', 'Quoted, operational memo\nSecond line'],
      ['duplicate', 'home', '2001-01-01', '1.00', 'utilities', ''],
      ['duplicate', 'other-home', '2001-01-01', '2.00', 'utilities', ''],
      ['wrong-property', 'foreign-home', '2001-01-01', '1.00', 'other', ''],
      ['negative', 'home', '2001-01-01', '-5.00', 'repairs', ''],
      ['zero', 'home', '2001-01-01', '0.00', 'repairs', ''],
      ['future', 'home', shift(1), '5.00', 'repairs', ''],
      ['reserved-rent', 'home', '2001-01-01', '5.00', 'rent', ''],
      ['reserved-deposit', 'home', '2001-01-01', '5.00', 'security_deposit', ''],
      ['invalid-date', 'home', '2026-02-29', '1.00', 'other', ''],
      [' source-spaces ', 'home', '2001-01-01', '1.00', 'other', ''],
    ]);
    assert.equal(batch.preview.rowCount, 11);
    assert.equal(batch.preview.validCount, 1);
    assert.equal(batch.preview.errorCount, 10);
    assert.equal(batch.preview.totalsComplete, false);
    assert.equal(batch.preview.totalCents, '10001');
    assert.equal(batch.preview.rows[0].memo, 'Quoted, operational memo\nSecond line');
    assert.equal(batch.preview.rows[3].property, null);
    assert.equal((await call('owner', 'POST', `${base}/${batch.id}/commit`, commit(batch))).json().code, 'EXPENSE_IMPORT_INVALID');
    assert.equal((await admin.query('SELECT count(*)::int n FROM "LedgerEntry"')).rows[0].n, before);
    assert.doesNotMatch(JSON.stringify(batch), /submissionHash|submissionKey|sourceHash|sourceRows/);
    const batchesBefore = (await admin.query('SELECT count(*)::int n FROM "ExpenseImportBatch"')).rows[0].n;
    for (const namespace of ['Not-Lowercase', ' leading-space', 'bank/source', '']) assert.equal((await call('owner', 'POST', `${base}/preview`, previewBody(namespace, [source('valid-id')]))).statusCode, 400);
    for (const data of ['sourceId,propertyId,occurredOn,amount,category,createdAt\n1,home,2001-01-01,1,other,2001-01-01', 'sourceId,propertyId,occurredOn,amount,category,kind\n1,home,2001-01-01,1,other,income', 'sourceId,sourceId,propertyId,occurredOn,amount,category\n1,1,home,2001-01-01,1,other', 'sourceId,propertyId,occurredOn,amount,category\n1,home,2001-01-01,1,"unfinished']) assert.equal((await call('owner', 'POST', `${base}/preview`, previewBody('expimp.malformed', [], { csv: data }))).statusCode, 400);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ExpenseImportBatch"')).rows[0].n, batchesBefore);
    for (const user of ['staff', 'resident', 'platform', 'support']) {
      assert.equal((await call(user, 'GET', base)).statusCode, 403, user);
      assert.equal((await call(user, 'POST', `${base}/preview`, previewBody('expimp.denied', [source('denied')]))).statusCode, 403, user);
    }
    assert.equal((await call('owner', 'GET', base, undefined, { 'x-company-id': 'b' })).statusCode, 403);
    assert.equal((await call('owner', 'POST', `${base}/preview`, previewBody('expimp.csrf', [source('denied')]), { 'x-csrf-token': 'bad' })).statusCode, 403);
    assert.equal((await call('owner', 'POST', `${base}/preview`, previewBody('expimp.origin', [source('denied')]), { origin: 'https://untrusted.test' })).statusCode, 403);
  });

  await t.test('confirmed paid expense imports create exact cash/provenance/audits once and preserve committed retries after correction', async () => {
    const rows = [['paid-001', 'home', '2001-01-01', '123.45', 'repairs', 'Fictional paid repair'], ['paid-002', 'other-home', '2001-01-02', '500.01', 'insurance', 'Fictional paid policy']];
    const body = previewBody('expimp.basic', rows);
    basicBatch = ok(await call('manager', 'POST', `${base}/preview`, body));
    assert.equal(basicBatch.preview.totalCents, '62346');
    assert.equal(basicBatch.preview.totalsComplete, true);
    assert.equal(basicBatch.preview.groups.reduce((total, group) => total + BigInt(group.amountCents), 0n), 62346n);
    assert.equal(ok(await call('owner', 'POST', `${base}/preview`, body)).id, basicBatch.id);
    assert.equal((await call('owner', 'POST', `${base}/preview`, { ...body, fileName: 'changed-source.csv' })).statusCode, 409);
    basicPayload = commit(basicBatch);
    for (const extra of [{ confirmedPaid: false }, { confirmedNotRecorded: false }, { confirmedPaid: undefined }]) {
      const denied = await call('owner', 'POST', `${base}/${basicBatch.id}/commit`, { ...basicPayload, ...extra });
      assert.equal(denied.statusCode, 400, denied.body);
      assert.equal(denied.json().code, 'EXPENSE_CONFIRMATION_REQUIRED');
    }
    const nonExpense = (await admin.query('SELECT count(*)::int n FROM "LedgerEntry" WHERE kind<>\'expense\'')).rows[0].n;
    const attempts = await Promise.all([call('owner', 'POST', `${base}/${basicBatch.id}/commit`, basicPayload), call('manager', 'POST', `${base}/${basicBatch.id}/commit`, basicPayload)]);
    for (const response of attempts) assert.equal(response.statusCode, 200, response.body);
    basicResult = attempts[0].json();
    assert.equal(basicResult.status, 'committed');
    assert.equal(basicResult.result.createdCount, 2);
    assert.equal(basicResult.result.totalCents, '62346');
    assert.deepEqual(attempts[1].json().result, basicResult.result);
    const entries = (await admin.query('SELECT id,"propertyId",kind,category,currency,"amountCents","leaseId",memo FROM "LedgerEntry" WHERE id=ANY($1::text[])', [basicResult.result.items.map(row => row.ledgerEntryId)])).rows;
    assert.equal(entries.length, 2);
    for (const item of basicResult.result.items) {
      const row = rows.find(source => source[0] === item.sourceId), entry = entries.find(entry => entry.id === item.ledgerEntryId);
      assert.equal(item.propertyId, row[1]);
      assert.equal(entry.kind, 'expense'); assert.equal(entry.currency, 'USD'); assert.equal(entry.leaseId, null);
      assert.equal(entry.category, row[4]); assert.equal(entry.memo, row[5]); assert.equal(entry.propertyId, row[1]);
      assert.equal(item.amountCents, entry.amountCents); assert.match(item.reference, /^TX-/);
    }
    assert.equal((await admin.query('SELECT count(*)::int n FROM "LedgerEntry" WHERE kind<>\'expense\'')).rows[0].n, nonExpense);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ImportedExpenseSource" WHERE "batchId"=$1', [basicBatch.id])).rows[0].n, 2);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'finance.created\' AND detail->>\'importBatchId\'=$1', [basicBatch.id])).rows[0].n, 2);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'expense.import.committed\' AND "targetId"=$1', [basicBatch.id])).rows[0].n, 1);
    const first = basicResult.result.items.find(row => row.sourceId === 'paid-001');
    ok(await call('owner', 'POST', `/api/company/finances/${first.ledgerEntryId}/void`, { expectedVersion: 1, reason: 'Fictional imported cash source requires correction' }));
    await admin.query('UPDATE "Property" SET version=version+1 WHERE id=\'home\'');
    assert.deepEqual(ok(await call('manager', 'POST', `${base}/${basicBatch.id}/commit`, basicPayload)).result, basicResult.result);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ImportedExpenseSource" WHERE "sourceNamespace"=\'expimp.basic\'')).rows[0].n, 2);
    const cash = ok(await call('owner', 'GET', `/api/company/finances?entryId=${first.ledgerEntryId}`));
    assert.equal(cash.items[0].importedExpense.sourceNamespace, 'expimp.basic');
    assert.equal(cash.items[0].importedExpense.sourceId, 'paid-001');
    assert.equal(cash.items[0].importedExpense.batchId, basicBatch.id);
    assert.ok(cash.items[0].voidedAt);
    assert.equal((await call('foreign', 'GET', `${base}/${basicBatch.id}`)).statusCode, 404);
  });

  await t.test('expense source identities remain deduplicated across files, changed payloads and voided cash while companies stay separate', async () => {
    const original = await preview('expimp.basic', [source('paid-001')]);
    assert.equal(original.preview.errorCount, 1);
    assert.equal(original.preview.rows[0].existingSource.samePayload, false, 'changed memo is a changed source payload');
    assert.ok(original.preview.rows[0].existingSource.voidedAt);
    const exact = await preview('expimp.basic', [['paid-001', 'home', '2001-01-01', '123.45', 'repairs', 'Fictional paid repair']]);
    assert.equal(exact.preview.rows[0].existingSource.samePayload, true);
    assert.equal(exact.preview.rows[0].existingSource.ledgerEntryId, basicResult.result.items.find(row => row.sourceId === 'paid-001').ledgerEntryId);
    assert.equal((await call('owner', 'POST', `${base}/${exact.id}/commit`, commit(exact))).json().code, 'EXPENSE_IMPORT_INVALID');
    const foreign = await preview('expimp.basic', [['paid-001', 'foreign-home', '2001-01-01', '20.01', 'other', 'Fictional separate company source']], {}, 'foreign');
    assert.equal(foreign.preview.errorCount, 0);
    ok(await call('foreign', 'POST', `${base}/${foreign.id}/commit`, commit(foreign)));
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ImportedExpenseSource" WHERE "sourceNamespace"=\'expimp.basic\' AND "sourceId"=\'paid-001\'')).rows[0].n, 2);
    assert.equal((await call('owner', 'GET', `${base}/${foreign.id}`)).statusCode, 404);
  });

  await t.test('overlapping concurrent expense batches return a review conflict with no partial cash or provenance', async () => {
    const first = await preview('expimp.overlap', [source('shared-source'), source('first-only')]);
    const second = await preview('expimp.overlap', [source('shared-source'), source('second-only')]);
    const results = await Promise.all([call('owner', 'POST', `${base}/${first.id}/commit`, commit(first)), call('manager', 'POST', `${base}/${second.id}/commit`, commit(second))]);
    assert.deepEqual(results.map(response => response.statusCode).sort(), [200, 409], results.map(response => response.body).join('\n'));
    const conflict = results.find(response => response.statusCode === 409);
    assert.equal(conflict.json().code, 'EXPENSE_IMPORT_REVIEW_CHANGED');
    const winner = results.find(response => response.statusCode === 200).json(), loser = winner.id === first.id ? second : first;
    const sources = (await admin.query('SELECT "sourceId","ledgerEntryId" FROM "ImportedExpenseSource" WHERE "companyId"=\'a\' AND "sourceNamespace"=\'expimp.overlap\'')).rows;
    assert.equal(sources.length, 2);
    assert.equal(sources.filter(source => source.sourceId === 'shared-source').length, 1);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "LedgerEntry" WHERE id=ANY($1::text[])', [sources.map(source => source.ledgerEntryId)])).rows[0].n, 2);
    assert.equal(ok(await call('owner', 'GET', `${base}/${loser.id}`)).status, 'preview');
    assert.equal(ok(await call('owner', 'GET', `${base}/${loser.id}`)).result, null);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'finance.created\' AND detail->>\'importBatchId\'=$1', [loser.id])).rows[0].n, 0);
  });

  await t.test('expense commits reject stale property previews and roll back cash, source mappings and history when audit fails', async () => {
    const stale = await preview('expimp.stale', [source('stale-property'), ['other-property-row', 'other-home', '2001-01-01', '10.00', 'utilities', '']]);
    await admin.query('UPDATE "Property" SET version=version+1 WHERE id=\'home\'');
    assert.equal((await call('owner', 'POST', `${base}/${stale.id}/commit`, commit(stale))).json().code, 'EXPENSE_IMPORT_REVIEW_CHANGED');
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ImportedExpenseSource" WHERE "sourceNamespace"=\'expimp.stale\'')).rows[0].n, 0);
    const batch = await preview('expimp.rollback', [source('rollback-one'), ['rollback-two', 'other-home', '2001-01-01', '2.00', 'other', '']]);
    const payload = commit(batch), before = (await admin.query('SELECT count(*)::int n FROM "LedgerEntry"')).rows[0].n;
    await admin.query("CREATE FUNCTION reject_expense_import_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='expense.import.committed' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_expense_import_audit BEFORE INSERT ON \"AuditEvent\" FOR EACH ROW EXECUTE FUNCTION reject_expense_import_audit()");
    try { assert.equal((await call('owner', 'POST', `${base}/${batch.id}/commit`, payload)).statusCode, 500); }
    finally { await admin.query('DROP TRIGGER reject_expense_import_audit ON "AuditEvent"; DROP FUNCTION reject_expense_import_audit()'); }
    assert.equal((await admin.query('SELECT count(*)::int n FROM "LedgerEntry"')).rows[0].n, before);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ImportedExpenseSource" WHERE "batchId"=$1', [batch.id])).rows[0].n, 0);
    assert.equal(ok(await call('owner', 'GET', `${base}/${batch.id}`)).status, 'preview');
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ExpenseImportAction" WHERE "batchId"=$1 AND action=\'commit\'', [batch.id])).rows[0].n, 0);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'finance.created\' AND detail->>\'importBatchId\'=$1', [batch.id])).rows[0].n, 0);
    assert.equal(ok(await call('owner', 'POST', `${base}/${batch.id}/commit`, payload)).result.createdCount, 2);
  });

  await t.test('the full 500-row paid-expense import preserves exact large totals and every immutable source-to-cash mapping', async () => {
    const categories = ['repairs', 'utilities', 'insurance', 'property_tax', 'other'];
    const rows = Array.from({ length: 500 }, (_, index) => [`bulk-${String(index).padStart(3, '0')}`, index % 2 ? 'other-home' : 'home', '2000-01-01', '1000000.00', categories[index % categories.length], 'Fictional maximum-batch expense fixture']);
    const batch = await preview('expimp.bulk-500', rows);
    assert.equal(batch.preview.rowCount, 500); assert.equal(batch.preview.validCount, 500); assert.equal(batch.preview.totalsComplete, true);
    assert.equal(batch.preview.totalCents, '50000000000');
    assert.equal(batch.preview.groups.reduce((sum, group) => sum + BigInt(group.amountCents), 0n), 50000000000n);
    const payload = commit(batch), committed = ok(await call('owner', 'POST', `${base}/${batch.id}/commit`, payload));
    assert.equal(committed.result.createdCount, 500); assert.equal(committed.result.items.length, 500); assert.equal(committed.result.totalCents, '50000000000');
    assert.equal(new Set(committed.result.items.map(item => item.ledgerEntryId)).size, 500);
    const actual = new Map((await admin.query('SELECT s."sourceId",s."sourceRow",s."propertyId",s."ledgerEntryId",l."amountCents",l.category,l.kind FROM "ImportedExpenseSource" s JOIN "LedgerEntry" l ON l.id=s."ledgerEntryId" WHERE s."batchId"=$1', [batch.id])).rows.map(row => [row.sourceId, row]));
    for (const item of committed.result.items) {
      const original = rows[item.row - 2], saved = actual.get(item.sourceId);
      assert.equal(item.sourceId, original[0]); assert.equal(item.propertyId, original[1]); assert.equal(item.amountCents, 100000000);
      assert.equal(saved.ledgerEntryId, item.ledgerEntryId); assert.equal(saved.sourceRow, item.row); assert.equal(saved.propertyId, item.propertyId); assert.equal(saved.category, original[4]); assert.equal(saved.kind, 'expense'); assert.equal(saved.amountCents, item.amountCents);
    }
    assert.deepEqual(ok(await call('manager', 'POST', `${base}/${batch.id}/commit`, payload)).result, committed.result);
    assert.equal((await admin.query('SELECT count(*)::int n FROM "ImportedExpenseSource" WHERE "batchId"=$1', [batch.id])).rows[0].n, 500);
    assert.equal((await admin.query('SELECT SUM(l."amountCents")::text n FROM "LedgerEntry" l JOIN "ImportedExpenseSource" s ON s."ledgerEntryId"=l.id WHERE s."batchId"=$1', [batch.id])).rows[0].n, '50000000000');
    assert.equal((await admin.query('SELECT count(*)::int n FROM "AuditEvent" WHERE action=\'finance.created\' AND detail->>\'importBatchId\'=$1', [batch.id])).rows[0].n, 500);
  });

  await t.test('backdated expense import records become known now and do not rewrite an earlier recorded-state cash report', async () => {
    const batch = await preview('expimp.asof', [['historical-paid-source', 'home', '2002-01-15', '71.09', 'property_tax', 'Fictional source paid earlier, recorded only now']]);
    ok(await call('owner', 'POST', `${base}/${batch.id}/commit`, commit(batch)));
    const query = asOf => `/api/company/reports/historical-cash?dateFrom=2002-01-01&dateTo=2002-01-31&propertyId=home&asOf=${asOf}`;
    const original = ok(await call('owner', 'GET', query('2002-01-31')));
    assert.equal(original.primary.summary.expenseCents, '0');
    assert.equal(original.primary.items.length, 0);
    const known = ok(await call('owner', 'GET', query(today)));
    assert.equal(known.primary.summary.expenseCents, '7109');
    assert.equal(known.primary.items.length, 1);
    assert.equal(known.primary.items[0].category, 'property_tax');
    assert.equal(known.primary.items[0].occurredOn, '2002-01-15');
  });

  await t.test('expense import cancellation, current role/feature checks and immutable provenance preserve operating boundaries', async () => {
    const batch = await preview('expimp.controls', [source('controls-one')]);
    await policy({ finances: 'read_only' });
    assert.equal((await call('owner', 'GET', `${base}/${batch.id}`)).statusCode, 200);
    assert.equal((await call('owner', 'POST', `${base}/${batch.id}/commit`, commit(batch))).json().code, 'SUBSCRIPTION_READ_ONLY');
    for (const feature of ['finances', 'leasing', 'properties']) {
      await policy({ [feature]: 'disabled' });
      assert.equal((await call('owner', 'GET', `${base}/${batch.id}`)).json().code, 'FEATURE_DISABLED', feature);
    }
    await policy();
    await admin.query('UPDATE "CompanyMembership" SET status=\'disabled\' WHERE "userId"=\'manager\'');
    try { assert.equal((await call('manager', 'POST', `${base}/${batch.id}/commit`, commit(batch))).statusCode, 403); }
    finally { await admin.query('UPDATE "CompanyMembership" SET status=\'active\' WHERE "userId"=\'manager\''); }
    const cancel = { expectedVersion: batch.version, reason: 'Superseded fictional import file', submissionKey: randomUUID() };
    const cancelled = ok(await call('owner', 'POST', `${base}/${batch.id}/cancel`, cancel));
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(ok(await call('manager', 'POST', `${base}/${batch.id}/cancel`, cancel)).version, cancelled.version);
    assert.equal((await call('owner', 'POST', `${base}/${batch.id}/commit`, commit(batch))).statusCode, 409);
    assert.equal(await db.expenseImportBatch.count(), 0);
    assert.equal(await db.importedExpenseSource.count(), 0);
    await assert.rejects(pool.query('DELETE FROM "ImportedExpenseSource" WHERE false'), /permission denied/);
    await assert.rejects(pool.query('UPDATE "ImportedExpenseSource" SET "sourceId"=\'changed\' WHERE false'), /permission denied/);
    await assert.rejects(pool.query('UPDATE "ExpenseImportBatch" SET "sourceRows"=\'[]\'::jsonb WHERE false'), /permission denied/);
    await assert.rejects(pool.query('DELETE FROM "ExpenseImportAction" WHERE false'), /permission denied/);
    await assert.rejects(pool.query('UPDATE "ExpenseImportAction" SET detail=\'{}\'::jsonb WHERE false'), /permission denied/);
  });
}
