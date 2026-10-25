import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function historicalCashCases(t, admin, call, app, db) {
  const root = '/api/company/reports/historical-cash';
  const query = (extra = {}) => `${root}?${new URLSearchParams({ dateFrom: '2026-01-01', dateTo: '2026-01-31', asOf: '2026-01-31', propertyId: 'home', ...extra })}`;
  const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json(); };
  async function insert(id, occurredOn, recordedAt, amount = 100, kind = 'income', propertyId = 'home', companyId = 'a') {
    return admin.query('INSERT INTO "LedgerEntry"(id,"companyId","propertyId","createdById","submissionKey","submissionHash","occurredOn","amountCents",kind,category,"createdAt") VALUES($1,$2,$3,$4,$5,\'historical-fixture\',$6,$7,$8,$9,$10)', [`hiscash-${id}`, companyId, propertyId, companyId === 'a' ? 'owner' : 'foreign', randomUUID(), occurredOn, amount, kind, kind === 'income' ? 'other' : 'repairs', recordedAt]);
  }
  await t.test('recorded cash uses original creation/correction instants and reconciles complete period comparisons', async () => {
    await insert('income', '2026-01-05', '2026-01-05T12:00:00Z', 10001);
    await insert('expense', '2026-01-06', '2026-01-06T12:00:00Z', 3000, 'expense');
    await insert('void-before', '2026-01-10', '2026-01-10T12:00:00Z', 999);
    await insert('void-after', '2026-01-11', '2026-01-11T12:00:00Z', 2000);
    await insert('void-boundary', '2026-01-12', '2026-01-12T12:00:00Z', 3000);
    await insert('created-boundary', '2026-01-13', '2026-02-01T05:00:00Z', 8000);
    await insert('late-backdated', '2026-01-14', '2026-02-02T12:00:00Z', 9000);
    await insert('previous-period', '2025-12-20', '2025-12-20T12:00:00Z', 5000);
    await insert('other-property', '2026-01-15', '2026-01-15T12:00:00Z', 7000, 'income', 'other-home');
    await insert('foreign-property', '2026-01-15', '2026-01-15T12:00:00Z', 7000, 'income', 'foreign-home', 'b');
    await admin.query('UPDATE "LedgerEntry" SET "voidedAt"=$1,"voidReason"=$2,version=2 WHERE id=$3', ['2026-01-31T15:00:00Z', 'Known duplicate', 'hiscash-void-before']);
    await admin.query('UPDATE "LedgerEntry" SET "voidedAt"=$1,"voidReason"=$2,version=2 WHERE id=$3', ['2026-02-02T15:00:00Z', 'Later private correction', 'hiscash-void-after']);
    await admin.query('UPDATE "LedgerEntry" SET "voidedAt"=$1,"voidReason"=$2,version=2 WHERE id=$3', ['2026-02-01T05:00:00Z', 'Next company day correction', 'hiscash-void-boundary']);
    const report = ok(await call('owner', 'GET', query({ compareFrom: '2025-12-01', compareTo: '2025-12-31' })));
    assert.equal(report.knowledgeCutoffExclusive, '2026-02-01T05:00:00.000Z');
    assert.equal(report.company.timezone, 'America/New_York');
    assert.equal(report.primary.summary.incomeCents, '15001');
    assert.equal(report.primary.summary.expenseCents, '3000');
    assert.equal(report.primary.summary.netCents, '12001');
    assert.equal(report.primary.summary.includedCount, 4);
    assert.equal(report.primary.summary.voidedCount, 1);
    assert.equal(report.comparison.summary.netCents, '5000');
    assert.equal(report.delta.netCents, '7001');
    assert.equal(report.primary.items.length, 5);
    assert.equal(report.primary.groups.reduce((total, group) => total + group.count, 0), 4);
    assert.equal(report.primary.items.filter(item => item.included && item.kind === 'income').reduce((sum, item) => sum + BigInt(item.amountCents), 0n), 15001n);
    assert.equal(report.primary.items.find(item => item.id === 'hiscash-void-before').voidReason, 'Known duplicate');
    for (const id of ['hiscash-void-after', 'hiscash-void-boundary']) {
      const row = report.primary.items.find(item => item.id === id);
      assert.equal(row.included, true); assert.equal(row.voidedAt, null); assert.equal(row.voidReason, null);
    }
    assert.equal(JSON.stringify(report).includes('Later private correction'), false);
    assert.equal(JSON.stringify(report).includes('submissionHash'), false);
    assert.equal(JSON.stringify(report).includes('createdById'), false);
    const later = ok(await call('manager', 'GET', query({ asOf: '2026-02-03' })));
    assert.equal(later.primary.summary.incomeCents, '27001');
    assert.equal(later.primary.summary.voidedCount, 3);
    assert.equal(later.primary.summary.netCents, '24001');
    const repeat = ok(await call('owner', 'GET', query()));
    assert.deepEqual(repeat.primary, report.primary, 'later corrections do not rewrite an earlier recorded-state report');
    const all = ok(await call('owner', 'GET', query({ propertyId: '' })));
    assert.equal(all.primary.summary.incomeCents, '22001');
    assert.equal(all.primary.items.some(item => item.id === 'hiscash-foreign-property'), false);
    const empty = ok(await call('owner', 'GET', query({ dateFrom: '2023-01-01', dateTo: '2023-01-31', compareFrom: '2023-02-01', compareTo: '2023-02-28' })));
    assert.equal(empty.primary.summary.netCents, '0'); assert.equal(empty.delta.netCents, '0');
  });

  await t.test('company-day recording boundaries follow daylight saving changes and today is not future knowledge', async () => {
    await insert('dst-before', '2026-03-08', '2026-03-09T03:59:59.999Z', 101);
    await insert('dst-at', '2026-03-08', '2026-03-09T04:00:00Z', 999);
    const changed = ok(await call('owner', 'GET', query({ dateFrom: '2026-03-08', dateTo: '2026-03-08', asOf: '2026-03-08' })));
    assert.equal(changed.knowledgeCutoffExclusive, '2026-03-09T04:00:00.000Z');
    assert.equal(changed.primary.summary.incomeCents, '101');
    const before = ok(await call('owner', 'GET', query({ dateFrom: '2026-03-07', dateTo: '2026-03-07', asOf: '2026-03-07' })));
    assert.equal(before.knowledgeCutoffExclusive, '2026-03-08T05:00:00.000Z');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const current = ok(await call('owner', 'GET', query({ asOf: today })));
    assert.equal(current.knowledgeCutoffExclusive, current.generatedAt);
    assert.ok(Date.parse(current.generatedAt) <= Date.now());
  });

  await t.test('historical reports preserve company, role, feature and filter boundaries', async () => {
    for (const user of [null, 'staff', 'resident', 'platform', 'support']) assert.equal((await call(user, 'GET', query())).statusCode, user === null ? 401 : 403);
    assert.equal((await call('foreign', 'GET', query())).statusCode, 404);
    assert.equal((await call('owner', 'GET', query(), undefined, { 'x-company-id': 'b' })).statusCode, 403);
    for (const changes of [{ asOf: '2026-02-30' }, { asOf: '9999-01-01' }, { dateFrom: '2026-02-01' }, { compareFrom: '2025-12-01' }, { compareFrom: '2025-12-31', compareTo: '2025-12-01' }, { companyId: 'b' }]) assert.equal((await call('owner', 'GET', query(changes))).statusCode, 400);
    await db.companySubscription.create({ data: { companyId: 'a', status: 'active', featureOverrides: { reports: 'disabled' }, updatedById: 'platform' } });
    try { assert.equal((await call('owner', 'GET', query())).json().code, 'FEATURE_DISABLED'); }
    finally { await admin.query('DELETE FROM "CompanySubscription" WHERE "companyId"=\'a\''); }
    await admin.query('UPDATE "Company" SET status=\'suspended\' WHERE id=\'a\'');
    try { assert.equal((await call('owner', 'GET', query())).statusCode, 403); }
    finally { await admin.query('UPDATE "Company" SET status=\'active\' WHERE id=\'a\''); }
    await assert.rejects(db.$transaction(async tx => { await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`; return tx.ledgerEntry.update({ where: { id: 'hiscash-income' }, data: { createdAt: new Date() } }); }), /permission denied/i);
  });

  await t.test('large exact totals and oversize comparison periods fail without partial results', async () => {
    await admin.query('INSERT INTO "LedgerEntry"(id,"companyId","propertyId","createdById","submissionKey","submissionHash","occurredOn","amountCents",kind,category,"createdAt") SELECT \'hiscash-large-\'||i,\'a\',\'home\',\'owner\',gen_random_uuid()::text,\'fixture\',\'2024-01-31\',100000000,\'income\',\'other\',\'2024-01-31T12:00:00Z\' FROM generate_series(1,60) i');
    const large = ok(await call('owner', 'GET', query({ dateFrom: '2024-01-31', dateTo: '2024-01-31', asOf: '2024-01-31' })));
    assert.equal(large.primary.summary.incomeCents, '6000000000');
    assert.equal(large.primary.items.length, 60);
    await admin.query('INSERT INTO "LedgerEntry"(id,"companyId","propertyId","createdById","submissionKey","submissionHash","occurredOn","amountCents",kind,category,"createdAt") SELECT \'hiscash-limit-\'||i,\'a\',\'home\',\'owner\',gen_random_uuid()::text,\'fixture\',\'2024-02-01\',1,\'income\',\'other\',\'2024-02-01T12:00:00Z\' FROM generate_series(1,10001) i');
    const excessive = await call('owner', 'GET', query({ dateFrom: '2023-01-01', dateTo: '2023-01-31', compareFrom: '2024-02-01', compareTo: '2024-02-01', asOf: '2024-02-01' }));
    assert.equal(excessive.statusCode, 422); assert.equal(excessive.json().code, 'REPORT_TOO_LARGE');
    assert.equal(Object.hasOwn(excessive.json(), 'primary'), false);
    const earlier = ok(await call('owner', 'GET', query({ dateFrom: '2024-02-01', dateTo: '2024-02-01', asOf: '2024-01-31' })));
    assert.equal(earlier.primary.items.length, 0, 'later-recorded rows neither appear nor trigger the size limit');
    await admin.query('DELETE FROM "LedgerEntry" WHERE id LIKE \'hiscash-limit-%\'');
  });
}
