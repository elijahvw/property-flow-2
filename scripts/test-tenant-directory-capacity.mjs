// Test-only, fixed synthetic scales in the existing owned tmpfs fixture.
// Source identities, bodies, SQL, parameters and session material stay in memory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

if (process.argv.length !== 3 || !['baseline', 'paged'].includes(process.argv[2])) {
  console.error('Use only baseline or paged; targets, URLs and database options are not accepted.');
  process.exit(1);
}
const root = new URL('../', import.meta.url), startedAt = new Date().toISOString();
const mode = process.argv[2], scales = [1000, 2000, 2001], measurements = [];
const pagedRequestCounts = { warmup: 0, measured: 0, integrity: 0 };
const portalStates = ['active', 'verification', 'disabled', 'offline', 'pending'];
const recordStates = ['active', 'archived'], rentalStates = ['current', 'upcoming', 'draft', 'former'];
const areas = new Map([
  ['contacts', 'contacts'], ['ResidentContact', 'contacts'],
  ['members', 'members'], ['CompanyMembership', 'members'],
  ['leases', 'leases'], ['Lease', 'leases'],
  ['participants', 'participants'], ['LeaseParticipant', 'participants'],
  ['invitations', 'invitations'], ['Invitation', 'invitations'],
]);
const relations = new Set(['ResidentContact', 'CompanyMembership', 'Lease', 'LeaseParticipant', 'Invitation', 'User', 'Company', 'Property', 'Unit']);
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const round = value => Math.round(value * 100) / 100;
const number = value => { assert.ok(Number.isFinite(value) && value >= 0); return value; };
const integer = value => { assert.ok(Number.isSafeInteger(value) && value >= 0); return value; };
const fingerprint = async () => {
  const hash = createHash('sha256');
  for (const file of (await readdir(new URL('server/dist/', root))).filter(name => name.endsWith('.js')).sort()) {
    hash.update(file); hash.update(await readFile(new URL('server/dist/' + file, root)));
  }
  return hash.digest('hex');
};
const clientFingerprint = async () => createHash('sha256').update(await readFile(new URL('client/dist/index.html', root))).digest('hex').slice(0, 16);
const measurementFingerprint = async () => {
  const hash = createHash('sha256');
  for (const file of ['scripts/test-tenant-directory-capacity.mjs', 'scripts/performance-fixture.mjs', 'scripts/tenant-capacity-fixture.mjs']) {
    hash.update(file); hash.update(await readFile(new URL(file, root)));
  }
  return hash.digest('hex');
};
const countMap = (value, allowed) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.ok(Object.keys(value).every(key => allowed.includes(key)));
  return Object.fromEntries(allowed.map(key => [key, integer(value[key] ?? 0)]));
};
const tally = (rows, key, allowed) => {
  const result = Object.fromEntries(allowed.map(value => [value, 0]));
  for (const row of rows) { assert.ok(allowed.includes(row[key])); result[row[key]]++; }
  return result;
};
const groundTruthSummary = expected => ({
  logicalRows: integer(expected.logicalRows), contactRows: integer(expected.contactRows),
  residentMembershipRows: integer(expected.residentMembershipRows), mappedResidentMemberships: integer(expected.mappedResidentMemberships),
  unmatchedResidentMemberships: integer(expected.unmatchedResidentMemberships), leaseRows: integer(expected.leaseRows),
  participantRows: integer(expected.participantRows), rentalAssociationCount: integer(expected.rentalAssociationCount),
  portalCounts: countMap(expected.portalCounts, portalStates), recordCounts: countMap(expected.recordCounts, recordStates),
  rentalStatusCounts: countMap(expected.rentalStatusCounts, rentalStates),
});
const firstExceededGuard = expected => expected.contactRows > 2000 ? 'contacts'
  : expected.residentMembershipRows > 2000 ? 'members' : expected.logicalRows > 2000 ? 'merged_rows' : null;
const sourceSnapshot = value => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([table, row]) => {
    assert.match(table, /^[A-Z][A-Za-z]{0,79}$/);
    assert.ok(row && (row.fingerprint === null || /^[a-f0-9]{32}$/.test(row.fingerprint)));
    return [table, { count: integer(row.n), fingerprint: row.fingerprint }];
  }));
};
const rental = row => ({
  leaseId: row.leaseId, propertyId: row.propertyId, propertyName: row.propertyName, unitLabel: row.unitLabel,
  role: row.role, status: row.status, startsOn: row.startsOn, endsOn: row.endsOn, blocksArchive: row.blocksArchive,
});
const normalizeRentals = rows => {
  assert.ok(Array.isArray(rows));
  assert.equal(new Set(rows.map(row => row.leaseId)).size, rows.length);
  return rows.map(rental).sort((a, b) => a.leaseId.localeCompare(b.leaseId));
};
const validateDirectory = (body, expected) => {
  assert.ok(Array.isArray(body)); assert.equal(body.length, expected.logicalRows);
  assert.equal(expected.rows.length, expected.logicalRows);
  const expectedRows = new Map(expected.rows.map(row => [row.contactId, row]));
  assert.equal(expectedRows.size, expected.logicalRows);
  assert.equal(new Set(body.map(row => row.contactId)).size, body.length);
  const boundUsers = body.filter(row => row.userId != null).map(row => row.userId);
  assert.equal(new Set(boundUsers).size, boundUsers.length);
  for (const row of body) {
    const source = expectedRows.get(row.contactId);
    assert.ok(source); assert.equal(row.id, row.contactId);
    assert.deepEqual({
      contactId: row.contactId, userId: row.userId, contactName: row.contactName, recordStatus: row.recordStatus,
      portalState: row.portalState, status: row.status, rentals: normalizeRentals(row.rentals), canArchive: row.canArchive,
    }, {
      contactId: source.contactId, userId: source.userId, contactName: source.contactName, recordStatus: source.recordStatus,
      portalState: source.portalState, status: source.status, rentals: normalizeRentals(source.rentals), canArchive: source.canArchive,
    });
  }
  const rentals = body.flatMap(row => row.rentals);
  assert.equal(rentals.length, expected.rentalAssociationCount);
  assert.deepEqual(tally(body, 'portalState', portalStates), countMap(expected.portalCounts, portalStates));
  assert.deepEqual(tally(body, 'recordStatus', recordStates), countMap(expected.recordCounts, recordStates));
  assert.deepEqual(tally(rentals, 'status', rentalStates), countMap(expected.rentalStatusCounts, rentalStates));
};
const validateLimit = body => {
  assert.ok(body && typeof body === 'object' && !Array.isArray(body));
  assert.equal(body.code, 'TENANT_DIRECTORY_TOO_LARGE'); assert.equal(typeof body.error, 'string');
  // Neither a truncated array nor a partial-data envelope is an acceptable limit response.
  assert.ok(Object.keys(body).every(key => ['error', 'code'].includes(key)));
};
const validateDefaultDirectory = body => {
  assert.ok(Array.isArray(body)); assert.equal(body.length, 200);
  assert.equal(new Set(body.map(row => row.contactId)).size, 200);
  assert.equal(new Set(body.map(row => row.userId)).size, 200);
  const expected = new Map(Array.from({ length: 200 }, (_, index) => {
    const ordinal = index + 1;
    return [`perf-contact-${ordinal}`, { userId: `perf-resident-${ordinal}`, leaseId: `perf-lease-${ordinal}`,
      propertyId: `perf-property-${Math.floor(index / 10) + 1}`, unitLabel: `Unit ${ordinal}` }];
  }));
  for (const row of body) {
    const source = expected.get(row.contactId); assert.ok(source);
    assert.equal(row.id, row.contactId); assert.equal(row.userId, source.userId);
    assert.equal(row.recordStatus, 'active'); assert.equal(row.portalState, 'active'); assert.equal(row.status, 'active');
    assert.equal(row.canArchive, false); assert.ok(Array.isArray(row.rentals)); assert.equal(row.rentals.length, 1);
    const association = row.rentals[0];
    assert.equal(association.leaseId, source.leaseId); assert.equal(association.propertyId, source.propertyId);
    assert.equal(association.unitLabel, source.unitLabel); assert.equal(association.role, 'leaseholder');
    assert.equal(association.status, 'current'); assert.equal(association.blocksArchive, true);
  }
};
const planNode = node => {
  assert.ok(node && /^[A-Za-z ]{1,80}$/.test(node['Node Type']));
  if (node['Relation Name']) assert.ok(relations.has(node['Relation Name']));
  if (node['Index Name']) assert.match(node['Index Name'], /^[A-Za-z][A-Za-z0-9_]{0,127}$/);
  return {
    nodeType: node['Node Type'], ...(node['Relation Name'] ? { relation: node['Relation Name'] } : {}),
    ...(node['Index Name'] ? { index: node['Index Name'] } : {}),
    ...(node['Scan Direction'] ? { scanDirection: node['Scan Direction'] } : {}),
    estimatedRows: number(node['Plan Rows']), actualRows: number(node['Actual Rows']), loops: number(node['Actual Loops']), totalMs: number(node['Actual Total Time']),
    ...(node['Rows Removed by Filter'] !== undefined ? { rowsRemoved: number(node['Rows Removed by Filter']) } : {}),
    ...(node['Shared Hit Blocks'] !== undefined ? { sharedHitBlocks: number(node['Shared Hit Blocks']) } : {}),
    ...(node['Shared Read Blocks'] !== undefined ? { sharedReadBlocks: number(node['Shared Read Blocks']) } : {}),
    ...(node['Sort Method'] ? { sortMethod: node['Sort Method'], sortSpaceKb: number(node['Sort Space Used']), sortSpaceType: node['Sort Space Type'] } : {}),
    ...(node.Plans ? { children: node.Plans.map(planNode) } : {}),
  };
};
const sanitizePlans = explained => {
  assert.ok(Array.isArray(explained) && explained.length > 0);
  return explained.map(({ area, plan }) => {
    assert.ok(areas.has(area));
    return { area: areas.get(area), planningMs: number(plan['Planning Time']), executionMs: number(plan['Execution Time']), plan: planNode(plan.Plan) };
  });
};
const hasRelation = (node, relation) => node.relation === relation || node.children?.some(child => hasRelation(child, relation));
const summary = samples => ({
  samples: samples.length, httpMedianMs: round(percentile(samples.map(row => row.httpMs), .5)), httpP95Ms: round(percentile(samples.map(row => row.httpMs), .95)),
  responseBytesMin: Math.min(...samples.map(row => row.bytes)), responseBytesMax: Math.max(...samples.map(row => row.bytes)),
  sqlQueriesMin: Math.min(...samples.map(row => row.sqlQueries)), sqlQueriesMax: Math.max(...samples.map(row => row.sqlQueries)),
  databaseMedianMs: round(percentile(samples.map(row => row.databaseMs), .5)), databaseP95Ms: round(percentile(samples.map(row => row.databaseMs), .95)),
  commitsMin: Math.min(...samples.map(row => row.commits)), commitsMax: Math.max(...samples.map(row => row.commits)), commitsTotal: samples.reduce((sum, row) => sum + row.commits, 0),
  rollbacksMin: Math.min(...samples.map(row => row.rollbacks)), rollbacksMax: Math.max(...samples.map(row => row.rollbacks)), rollbacksTotal: samples.reduce((sum, row) => sum + row.rollbacks, 0),
});

let fixture, startup, closing, interrupted = false, sourceBefore, stage = 'build fingerprints';
let serverFingerprint = null, initialClientFingerprint = null, revision = null, measurementSourceFingerprint = null;
let defaultFixtureSmoke = null, builtinSha256 = null;
const cleanup = () => closing ??= (async () => {
  let owned = fixture;
  if (!owned && startup) try { owned = await startup; } catch { /* Startup owns its failure cleanup. */ }
  try { await owned?.close(); } finally { fixture = null; startup = null; }
})();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (interrupted) return;
  interrupted = true;
  void cleanup().then(() => process.exit(1), () => { console.error('Isolated fixture cleanup failed.'); process.exit(1); });
});
const checkBuilds = async () => {
  assert.equal(await fingerprint(), serverFingerprint);
  assert.equal(await clientFingerprint(), initialClientFingerprint);
  if (mode === 'paged') assert.equal(await measurementFingerprint(), measurementSourceFingerprint);
};
const writeReport = async (complete, suffix) => {
  await checkBuilds();
  if (complete && mode === 'paged') {
    assert.equal(measurements.length, scales.length);
    assert.ok(measurements.every(row => row.complete && row.scenarios.length === 8 && row.scenarios.every(scenario => scenario.successfulResponses === 10 && scenario.unexpectedResponses === 0 && scenario.warmupUnexpectedResponses === 0)));
  }
  const report = {
    schemaVersion: 1, kind: 'tenant-directory-capacity', mode, complete, startedAt, finishedAt: new Date().toISOString(),
    environment: 'isolated-loopback-tmpfs-postgresql17', revision, serverFingerprint, clientFingerprint: initialClientFingerprint,
    defaultFixtureSmoke, builtinSha256,
    ...(mode === 'paged' ? { measurementSourceFingerprint } : {}),
    methodology: mode === 'baseline' ? {
      scales, warmupPerScale: 2, samplesPerScale: 10, concurrency: 1, statistics: 'ANALYZE before measurement', runtimeRls: true,
      requestBudget: { defaultFixtureSmoke: 1, scaledWarmupAndMeasured: 36, untimedUnionProbe: 1, total: 38 },
      request: 'authenticated tenant directory read without URL filters',
      semantics: 'complete logical arrays through 2000; explicit limit response at 2001; no partial tenant or rental associations',
      timingPopulations: ['successful_complete_arrays', 'expected_limit'],
      sqlCount: 'real Prisma query events through final response hook, including authentication, transaction and usage bookkeeping',
      plans: 'actual captured contact, member, lease, participant and invitation SELECTs under restricted runtime role and company RLS; query text and constants omitted',
    } : {
      scales, warmupPerScenario: 2, samplesPerScenario: 10, concurrency: 1, statistics: 'ANALYZE before measurement', runtimeRls: true,
      directoryScenariosPerScale: 7, rentalHistoryScenariosPerScale: 1,
      requestBudget: { defaultFixtureSmoke: 1, plannedWarmup: 48, plannedMeasured: 240, attempted: { ...pagedRequestCounts },
        integrityUpperBound: scales.length * 2 * (7 * (Math.ceil(Math.max(...scales) / 50) - 1)),
        integrity: 'complete forward and reverse directory traversal using the fixed expected populations; history contains at most three associations' },
      request: 'authenticated fixed-scenario bounded tenant directories and independent rental history',
      semantics: '50-row pages and at most three rental previews with exact complete totals, global association properties and retained source identity',
      populations: 'default directory includes active records only; archived records are a separate scenario; legacy all-record ground truth remains separately reported',
      timingPopulations: ['successful_directory_first_pages', 'successful_rental_history', 'unexpected_http_errors'],
      traversal: 'first and every forward page, complete no-duplicate source coverage, and every reverse page; integrity requests are untimed',
      sqlCount: 'real Prisma query events through final response hook, including authentication, transaction and usage bookkeeping',
      plans: 'actual captured tenant SELECT or narrowly allowed canonical WITH statements under restricted READ ONLY runtime role and company RLS; query text and constants omitted',
    },
    limitations: mode === 'baseline' ? [
      'Synthetic local single-user reads, not deployed capacity, network/provider latency or write throughput.',
      'Warm-cache small samples; p95 is the largest of ten observations.',
      'HTTP time receives the complete response body; SQL counts include response-hook bookkeeping.',
      'Plan execution excludes application serialization and body transfer.',
      'Expected limit timing is reported separately and is not a successful directory latency.',
      'The union-limit variant is an untimed integrity check after explicit fixture setup.',
      'The ordinary 200-tenant fixture smoke and restricted-role hashing proof are untimed compatibility checks, not additional benchmark scenarios.',
    ] : [
      'Synthetic local single-user reads, not deployed capacity, network/provider latency or write throughput.',
      'Warm-cache small samples; p95 is the largest of ten observations.',
      'Successful and unexpected-error timing populations are separate; any selected non-200 response prevents a complete report.',
      'HTTP time receives the complete body; SQL counts include response-hook bookkeeping; plan execution excludes application serialization and transfer.',
      'First-page timings are distinct from untimed forward/reverse integrity traversals.',
      'Default active-record totals differ from the old all-record arrays; archived records remain measured separately.',
      'The fixed fixture has at most three associations per person: history checks prove source completeness at that grain, not multi-page history capacity.',
      'The ordinary 200-tenant legacy-array smoke and restricted-role hashing proof are untimed compatibility checks.',
    ], measurements,
  };
  const output = join(tmpdir(), `propertyflow-tenant-directory-capacity-${mode}-${startedAt.replace(/\D/g, '')}-${serverFingerprint.slice(0, 10)}-${suffix}.json`);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`Immutable sanitized report: ${output}`);
};
const requestDirectory = async (expected, expectedStatus, timed = true) => {
  fixture.beginQueryCapture();
  const started = timed ? performance.now() : null;
  const response = await fetch(fixture.origin + '/api/company/resident-profiles', {
    headers: { cookie: `pf-session=${fixture.sessions.owner.token}` }, redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  const text = await response.text(), elapsed = timed ? performance.now() - started : null;
  const captured = await fixture.endQueryCapture();
  assert.equal(response.status, expectedStatus); assert.ok(captured.count > 0);
  assert.ok(Array.isArray(captured.tenantQueries) && captured.tenantQueries.length > 0);
  const body = JSON.parse(text);
  if (expectedStatus === 200) validateDirectory(body, expected); else validateLimit(body);
  return {
    measurement: { ...(timed ? { httpMs: elapsed } : {}), bytes: Buffer.byteLength(text), status: response.status,
      sqlQueries: integer(captured.count), databaseMs: number(captured.databaseMs), commits: integer(captured.commits), rollbacks: integer(captured.rollbacks) },
    queries: captured.tenantQueries,
  };
};

const binaryCompare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const rentalRank = { current: 0, upcoming: 1, draft: 2, former: 3 };
const fieldsOnly = (value, allowed) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.ok(Object.keys(value).every(key => allowed.includes(key)));
};
const validateToken = value => assert.ok(value === null || typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value));
const orderedRows = rows => [...rows].sort((a, b) => binaryCompare(a.contactName, b.contactName) || binaryCompare(a.contactId, b.contactId));
const associationMatches = (row, filters) => (!filters.propertyId || row.propertyId === filters.propertyId)
  && (!filters.rental || ['all', 'unassigned'].includes(filters.rental) || row.status === filters.rental);
const associationSearch = (row, query) => `${row.propertyName} ${row.unitLabel}`.toLowerCase().includes(query.toLowerCase());
const expectedProperties = expected => [...new Map(expected.rows.flatMap(row => row.rentals).map(row => [row.propertyId, row.propertyName])).entries()]
  .map(([id, name]) => ({ id, name })).sort((a, b) => binaryCompare(a.name, b.name) || binaryCompare(a.id, b.id));
const matchingRows = (expected, filters) => orderedRows(expected.rows.filter(row => row.recordStatus === (filters.records || 'active')
  && (!filters.access || filters.access === 'all' || row.portalState === filters.access)
  && (!filters.q || row.rentals.some(rental => associationSearch(rental, filters.q)))
  && (filters.rental === 'unassigned' ? !filters.propertyId && !row.rentals.length
    : !filters.propertyId && (!filters.rental || filters.rental === 'all') || row.rentals.some(rental => associationMatches(rental, filters)))));
const expectedPreview = (row, filters) => [...row.rentals].sort((a, b) => Number(!associationMatches(a, filters)) - Number(!associationMatches(b, filters))
  || (filters.q ? Number(!associationSearch(a, filters.q)) - Number(!associationSearch(b, filters.q)) : 0)
  || rentalRank[a.status] - rentalRank[b.status] || binaryCompare(b.startsOn, a.startsOn) || binaryCompare(a.leaseId, b.leaseId)).slice(0, 3).map(rental);
const validateClock = body => {
  assert.equal(body.companyId, 'perf-company'); assert.match(body.today, /^\d{4}-\d{2}-\d{2}$/); assert.equal(body.timezone, 'America/New_York');
};
const validatePagedDirectory = (body, rows, properties, filters, first = false) => {
  fieldsOnly(body, ['companyId', 'today', 'timezone', 'items', 'total', 'pageSize', 'nextCursor', 'previousCursor', 'properties']);
  validateClock(body); assert.equal(body.pageSize, 50); assert.equal(body.total, rows.length); assert.deepEqual(body.properties, properties);
  assert.ok(Array.isArray(body.items) && body.items.length <= 50);
  const allowed = new Map(rows.map(row => [row.contactId, row]));
  assert.equal(new Set(body.items.map(row => row.id)).size, body.items.length);
  for (const item of body.items) {
    fieldsOnly(item, ['kind', 'id', 'contactId', 'userId', 'name', 'email', 'phone', 'contactName', 'contactPhone', 'status', 'recordStatus', 'portalState', 'version', 'user', 'rentals', 'rentalCount', 'canArchive']);
    const source = allowed.get(item.id); assert.ok(source); assert.equal(item.kind, 'contact'); assert.equal(item.contactId, item.id);
    assert.deepEqual({ userId: item.userId, name: item.name, contactName: item.contactName, status: item.status, recordStatus: item.recordStatus, portalState: item.portalState, canArchive: item.canArchive },
      { userId: source.userId, name: source.contactName, contactName: source.contactName, status: source.status, recordStatus: source.recordStatus, portalState: source.portalState, canArchive: source.canArchive });
    assert.equal(item.rentalCount, source.rentals.length); assert.ok(Array.isArray(item.rentals)); assert.equal(item.rentals.length, Math.min(3, source.rentals.length));
    for (const association of item.rentals) fieldsOnly(association, ['leaseId', 'propertyId', 'propertyName', 'unitLabel', 'role', 'status', 'startsOn', 'endsOn', 'blocksArchive']);
    assert.deepEqual(item.rentals.map(rental), expectedPreview(source, filters));
    assert.ok(item.user === null || typeof item.user === 'object');
    if (item.user) fieldsOnly(item.user, ['name', 'email', 'status', 'emailVerified']);
  }
  validateToken(body.nextCursor); validateToken(body.previousCursor);
  if (first) {
    assert.equal(body.items.length, Math.min(50, rows.length)); assert.equal(body.previousCursor, null);
    assert.deepEqual(body.items.map(row => row.id), rows.slice(0, 50).map(row => row.contactId));
  }
};
const validateRentalHistory = (body, source) => {
  fieldsOnly(body, ['companyId', 'today', 'timezone', 'person', 'items', 'total', 'pageSize', 'nextCursor', 'previousCursor']);
  validateClock(body); assert.equal(body.pageSize, 50); assert.equal(body.total, source.rentals.length);
  fieldsOnly(body.person, ['kind', 'id', 'contactId', 'userId', 'name', 'recordStatus', 'portalState']);
  assert.deepEqual(body.person, { kind: 'contact', id: source.contactId, contactId: source.contactId, userId: source.userId,
    name: source.contactName, recordStatus: source.recordStatus, portalState: source.portalState });
  assert.ok(Array.isArray(body.items) && body.items.length <= 50);
  for (const row of body.items) fieldsOnly(row, ['leaseId', 'propertyId', 'propertyName', 'unitLabel', 'role', 'status', 'startsOn', 'endsOn', 'blocksArchive']);
  assert.deepEqual(normalizeRentals(body.items), normalizeRentals(source.rentals));
  assert.equal(body.nextCursor, null); assert.equal(body.previousCursor, null);
};
const pagedScenarios = expected => {
  const active = expected.rows.filter(row => row.recordStatus === 'active');
  const mixed = active.flatMap(row => row.rentals.filter(rental => rental.status !== 'former'
    && row.rentals.some(other => other.status === 'former' && other.propertyId !== rental.propertyId)
    && !row.rentals.some(other => other.status === 'former' && other.propertyId === rental.propertyId))).find(Boolean);
  assert.ok(mixed);
  const realUnit = active.flatMap(row => row.rentals).find(row => row.unitLabel.startsWith('Fictional household ')); assert.ok(realUnit);
  const result = [
    { name: 'default_active', filters: {} }, { name: 'archived', filters: { records: 'archived' } },
    { name: 'portal_pending', filters: { access: 'pending' } },
    { name: 'same_association_former', filters: { propertyId: mixed.propertyId, rental: 'former' } },
    { name: 'unassigned', filters: { rental: 'unassigned' } }, { name: 'literal_search', filters: { q: '%_' } },
    { name: 'real_unit_search', filters: { q: realUnit.unitLabel } },
  ];
  return result.map(scenario => ({ ...scenario, rows: matchingRows(expected, scenario.filters) }));
};
const requestPaged = async (path, validate, phase) => {
  assert.ok(['warmup', 'measured', 'integrity'].includes(phase)); pagedRequestCounts[phase]++;
  fixture.beginQueryCapture(); const started = phase === 'integrity' ? null : performance.now();
  const response = await fetch(fixture.origin + path, { headers: { cookie: `pf-session=${fixture.sessions.owner.token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  const text = await response.text(), elapsed = started === null ? null : performance.now() - started;
  const captured = await fixture.endQueryCapture(), body = JSON.parse(text);
  if (response.status === 200) {
    assert.ok(captured.count > 0 && captured.tenantQueries.some(row => /^WITH contacts AS MATERIALIZED/.test(row.query)));
    validate(body);
  } else {
    assert.ok(response.status >= 400 && response.status <= 599); fieldsOnly(body, ['error', 'code']);
    assert.equal(typeof body.error, 'string'); assert.ok(typeof body.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(body.code));
  }
  return { body, queries: captured.tenantQueries, measurement: {
    ...(elapsed === null ? {} : { httpMs: elapsed }), bytes: Buffer.byteLength(text), status: response.status,
    sqlQueries: integer(captured.count), databaseMs: number(captured.databaseMs), commits: integer(captured.commits), rollbacks: integer(captured.rollbacks),
    ...(response.status === 200 ? {} : { code: body.code }),
  } };
};
const samplePagedScenario = async (path, validate, population) => {
  const samples = [], warmups = []; let last, successful;
  for (let sample = 0; sample < 12; sample++) {
    if (interrupted) throw new Error('Interrupted');
    last = await requestPaged(path, validate, sample < 2 ? 'warmup' : 'measured');
    if (last.measurement.status === 200) successful = last;
    if (sample >= 2) samples.push(last.measurement); else warmups.push(last.measurement);
  }
  const successes = samples.filter(row => row.status === 200), errors = samples.filter(row => row.status !== 200);
  return { successful, allSucceeded: successes.length === 10 && warmups.every(row => row.status === 200),
    report: { timingPopulation: population, expectedStatus: 200, warmupAttempts: warmups.length, warmupUnexpectedResponses: warmups.filter(row => row.status !== 200).length,
      measuredAttempts: samples.length, successfulResponses: successes.length, unexpectedResponses: errors.length,
      successOnly: successes.length ? summary(successes) : null,
      errorOnly: errors.length ? { ...summary(errors), statuses: Object.fromEntries([...new Set(errors.map(row => row.status))].map(status => [status, errors.filter(row => row.status === status).length])),
        codes: Object.fromEntries([...new Set(errors.map(row => row.code))].map(code => [code, errors.filter(row => row.code === code).length])) } : null } };
};
const traverseDirectory = async (scenario, first, properties) => {
  const pages = [first], seen = new Set(first.items.map(row => row.id)), maxPages = Math.max(1, Math.ceil(scenario.rows.length / 50));
  let current = first;
  while (current.nextCursor) {
    assert.ok(pages.length < maxPages); if (interrupted) throw new Error('Interrupted');
    const query = new URLSearchParams({ ...scenario.filters, cursor: current.nextCursor });
    const response = await requestPaged('/api/company/resident-profiles/directory?' + query,
      body => validatePagedDirectory(body, scenario.rows, properties, scenario.filters), 'integrity');
    assert.equal(response.measurement.status, 200); current = response.body;
    assert.deepEqual(current.items.map(row => row.id), scenario.rows.slice(seen.size, seen.size + 50).map(row => row.contactId));
    for (const row of current.items) { assert.ok(!seen.has(row.id)); seen.add(row.id); }
    pages.push(current);
  }
  assert.equal(pages.length, maxPages); assert.deepEqual([...seen].sort(), scenario.rows.map(row => row.contactId).sort());
  const reverse = new Set(current.items.map(row => row.id)); let reversePages = 1;
  for (let index = pages.length - 2; index >= 0; index--) {
    assert.ok(current.previousCursor); if (interrupted) throw new Error('Interrupted');
    const query = new URLSearchParams({ ...scenario.filters, before: current.previousCursor });
    const response = await requestPaged('/api/company/resident-profiles/directory?' + query,
      body => validatePagedDirectory(body, scenario.rows, properties, scenario.filters), 'integrity');
    assert.equal(response.measurement.status, 200); current = response.body;
    assert.deepEqual(current.items.map(row => row.id), pages[index].items.map(row => row.id));
    for (const row of current.items) { assert.ok(!reverse.has(row.id)); reverse.add(row.id); }
    reversePages++;
  }
  assert.equal(current.previousCursor, null); assert.equal(reverse.size, scenario.rows.length);
  return { timed: false, forwardPages: pages.length, reversePages, deepestPage: pages.length, exactRowsVisited: seen.size,
    uniqueForwardSources: seen.size, uniqueReverseSources: reverse.size, complete: true };
};
const runPagedScales = async performanceFixture => {
  for (const scale of scales) {
    if (interrupted) throw new Error('Interrupted');
    stage = `${scale} paged fixture startup`; closing = null; sourceBefore = null;
    startup = performanceFixture({ tenantScale: scale }); fixture = await startup; startup = null;
    if (interrupted) throw new Error('Interrupted');
    assert.equal(fixture.clientFingerprint, initialClientFingerprint);
    const expected = fixture.tenantExpectations, properties = expectedProperties(expected);
    assert.equal(expected.logicalRows, scale); assert.equal(expected.contactRows, scale); assert.equal(expected.unmatchedResidentMemberships, 0);
    assert.ok(expected.rows.every(row => row.rentals.length <= 3));
    const before = sourceSnapshot(await fixture.counts()); sourceBefore = before;
    const result = { scale, complete: false, legacyAllRecordGroundTruth: groundTruthSummary(expected),
      defaultActiveRecordPopulation: expected.rows.filter(row => row.recordStatus === 'active').length,
      separatelyMeasuredArchivedPopulation: expected.rows.filter(row => row.recordStatus === 'archived').length,
      globalAssociationProperties: properties.length, scenarios: [] };
    measurements.push(result);
    for (const scenario of pagedScenarios(expected)) {
      stage = `${scale} ${scenario.name}`;
      const path = '/api/company/resident-profiles/directory?' + new URLSearchParams(scenario.filters);
      const sampled = await samplePagedScenario(path, body => validatePagedDirectory(body, scenario.rows, properties, scenario.filters, true), 'successful_directory_first_pages');
      const row = { scenario: scenario.name, endpoint: 'directory', expectedTotal: scenario.rows.length, expectedFirstPageRows: Math.min(50, scenario.rows.length),
        ...sampled.report }; result.scenarios.push(row);
      assert.ok(sampled.allSucceeded, 'A selected directory scenario did not succeed');
      row.plans = sanitizePlans(await fixture.explainTenants(sampled.successful.queries));
      row.traversal = await traverseDirectory(scenario, sampled.successful.body, properties);
      console.log(`paged ${scale} ${scenario.name}: ${row.successfulResponses} successful samples, median ${row.successOnly.httpMedianMs}ms p95 ${row.successOnly.httpP95Ms}ms, ${row.successOnly.responseBytesMax} bytes, SQL ${row.successOnly.sqlQueriesMin}-${row.successOnly.sqlQueriesMax}`);
    }
    const person = [...expected.rows].sort((a, b) => b.rentals.length - a.rentals.length || binaryCompare(a.contactId, b.contactId))[0];
    assert.ok(person.rentals.length > 0 && person.rentals.length <= 3);
    stage = `${scale} independent rental history`;
    const sampled = await samplePagedScenario(`/api/company/resident-contacts/${encodeURIComponent(person.contactId)}/rentals`, body => validateRentalHistory(body, person), 'successful_rental_history');
    const history = { scenario: 'independent_rental_history', endpoint: 'rental_history', expectedTotal: person.rentals.length,
      ...sampled.report, multiPageCapacityMeasured: false }; result.scenarios.push(history);
    assert.ok(sampled.allSucceeded, 'The selected rental history scenario did not succeed');
    history.plans = sanitizePlans(await fixture.explainTenants(sampled.successful.queries));
    history.integrity = { complete: true, uniqueLeaseSources: person.rentals.length, roleAndEffectiveDatesPreserved: true, moneyFieldsAbsent: true };
    const after = sourceSnapshot(await fixture.counts()); assert.deepEqual(after, before);
    assert.equal((await fixture.transactionState()).idle_transactions, 0); await checkBuilds();
    Object.assign(result, { complete: true, sourceFingerprintsUnchanged: true, sourceSnapshots: { before, after }, idleRuntimeTransactions: 0 });
    await writeReport(false, `through-${scale}`); await cleanup();
  }
};
try {
  serverFingerprint = await fingerprint(); initialClientFingerprint = await clientFingerprint();
  if (mode === 'paged') measurementSourceFingerprint = await measurementFingerprint();
  revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.match(revision, /^[a-f0-9]{7,40}$/);
  const { performanceFixture } = await import('./performance-fixture.mjs');
  stage = 'default fixture startup';
  startup = performanceFixture(); fixture = await startup; startup = null;
  if (interrupted) throw new Error('Interrupted');
  assert.equal(fixture.clientFingerprint, initialClientFingerprint);
  const defaultBefore = sourceSnapshot(await fixture.counts()); sourceBefore = defaultBefore;
  assert.equal(defaultBefore.ResidentContact.count, 200); assert.equal(defaultBefore.Lease.count, 200);
  stage = 'default fixture smoke';
  const smokeResponse = await fetch(fixture.origin + '/api/company/resident-profiles', {
    headers: { cookie: `pf-session=${fixture.sessions.owner.token}` }, redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  const smokeText = await smokeResponse.text(); assert.equal(smokeResponse.status, 200);
  validateDefaultDirectory(JSON.parse(smokeText));
  stage = 'default builtin SHA-256 compatibility';
  const hashEvidence = await fixture.verifyBuiltinSha256();
  const expectedHashEvidence = { available: true, nodeCompatible: true, cases: 4, maxUtf8Bytes: 4096, runtimeRls: true };
  assert.deepEqual(hashEvidence, expectedHashEvidence); builtinSha256 = expectedHashEvidence;
  const defaultAfter = sourceSnapshot(await fixture.counts()); assert.deepEqual(defaultAfter, defaultBefore);
  assert.equal((await fixture.transactionState()).idle_transactions, 0); await checkBuilds();
  defaultFixtureSmoke = { timed: false, status: 200, logicalRows: 200, uniqueAccountBindings: 200,
    rentalAssociationCount: 200, primaryParticipantDuplicatesDeduplicated: 200, responseBytes: Buffer.byteLength(smokeText),
    sourceFingerprintsUnchanged: true, sourceSnapshots: { before: defaultBefore, after: defaultAfter },
    serverFingerprintUnchanged: true, clientFingerprintUnchanged: true, idleRuntimeTransactions: 0 };
  await writeReport(false, 'default-smoke'); await cleanup();
  if (mode === 'paged') await runPagedScales(performanceFixture);
  for (const scale of mode === 'baseline' ? scales : []) {
    if (interrupted) throw new Error('Interrupted');
    stage = `${scale} fixture startup`; closing = null; sourceBefore = null;
    startup = performanceFixture({ tenantScale: scale }); fixture = await startup; startup = null;
    if (interrupted) throw new Error('Interrupted');
    assert.equal(fixture.clientFingerprint, initialClientFingerprint);
    const expected = fixture.tenantExpectations, expectedSummary = groundTruthSummary(expected);
    assert.equal(expected.logicalRows, scale); assert.equal(expected.contactRows, scale);
    assert.equal(expected.unmatchedResidentMemberships, 0);
    assert.ok(expected.residentMembershipRows <= 2000);
    const exceededGuard = firstExceededGuard(expected);
    assert.equal(exceededGuard, scale > 2000 ? 'contacts' : null);
    const before = sourceSnapshot(await fixture.counts()); sourceBefore = before;
    const samples = []; let captured;
    for (let sample = 0; sample < 12; sample++) {
      if (interrupted) throw new Error('Interrupted');
      stage = `${scale} directory read`;
      const result = await requestDirectory(expected, scale > 2000 ? 422 : 200);
      captured = result.queries;
      if (sample >= 2) samples.push(result.measurement);
    }
    stage = `${scale} runtime query plans`;
    const plans = sanitizePlans(await fixture.explainTenants(captured));
    for (const relation of scale <= 2000 ? ['ResidentContact', 'CompanyMembership', 'Lease', 'LeaseParticipant'] : ['ResidentContact', 'CompanyMembership'])
      assert.ok(plans.some(value => hasRelation(value.plan, relation)));
    const after = sourceSnapshot(await fixture.counts()); assert.deepEqual(after, before);
    const transactions = await fixture.transactionState(); assert.equal(transactions.idle_transactions, 0);
    await checkBuilds();
    const result = {
      scale, expected: expectedSummary, population: scale > 2000 ? 'expected_limit' : 'successful_complete_arrays',
      expectedStatus: scale > 2000 ? 422 : 200, ...(exceededGuard ? { expectedCode: 'TENANT_DIRECTORY_TOO_LARGE', firstExceededGuard: exceededGuard } : {}),
      successfulCompleteResponses: samples.filter(sample => sample.status === 200).length,
      expectedLimitResponses: samples.filter(sample => sample.status === 422).length,
      ...summary(samples), sourceFingerprintsUnchanged: true, sourceSnapshots: { before, after }, idleRuntimeTransactions: 0, plans,
    };
    if (scale === 2000) {
      stage = `${scale} union-limit fixture setup`;
      const union = await fixture.prepareTenantUnionLimit();
      assert.equal(union.logicalRows, 2001); assert.equal(union.contactRows, 2000); assert.equal(union.firstExceededGuard, 'merged_rows');
      assert.ok(union.residentMembershipRows <= 2000);
      const unionGuard = firstExceededGuard(union); assert.equal(unionGuard, 'merged_rows');
      const unionBefore = sourceSnapshot(await fixture.counts()); sourceBefore = unionBefore;
      stage = `${scale} untimed union-limit read`;
      const checked = await requestDirectory(null, 422, false);
      const unionPlans = sanitizePlans(await fixture.explainTenants(checked.queries));
      const unionAfter = sourceSnapshot(await fixture.counts()); assert.deepEqual(unionAfter, unionBefore);
      assert.equal((await fixture.transactionState()).idle_transactions, 0);
      result.unionLimit = {
        timed: false, setup: { logicalRows: integer(union.logicalRows), contactRows: integer(union.contactRows), residentMembershipRows: integer(union.residentMembershipRows) },
        firstExceededGuard: unionGuard, expectedStatus: 422, expectedCode: 'TENANT_DIRECTORY_TOO_LARGE',
        ...checked.measurement, sourceFingerprintsUnchanged: true, sourceSnapshots: { before: unionBefore, after: unionAfter }, idleRuntimeTransactions: 0, plans: unionPlans,
      };
    }
    measurements.push(result);
    await writeReport(false, `through-${scale}`);
    console.log(`baseline ${scale} ${result.population}: ${result.samples} samples, median ${result.httpMedianMs}ms p95 ${result.httpP95Ms}ms, ${result.responseBytesMax} bytes, SQL ${result.sqlQueriesMin}-${result.sqlQueriesMax}`);
    await cleanup();
  }
  stage = 'final report'; await writeReport(true, 'complete');
} catch (error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : 'MEASUREMENT_FAILURE';
  let sourceFingerprintsUnchanged = null, idleRuntimeTransactions = null;
  if (fixture && sourceBefore) try {
    sourceFingerprintsUnchanged = JSON.stringify(sourceSnapshot(await fixture.counts())) === JSON.stringify(sourceBefore);
    idleRuntimeTransactions = integer((await fixture.transactionState()).idle_transactions);
  } catch { /* Missing evidence remains null; private errors are never serialized. */ }
  const failure = { schemaVersion: 1, kind: 'tenant-directory-capacity-failure', mode, stage, code,
    sourceFingerprintsUnchanged, idleRuntimeTransactions, serverFingerprint, clientFingerprint: initialClientFingerprint,
    defaultFixtureSmokeComplete: defaultFixtureSmoke !== null, builtinSha256Verified: builtinSha256 !== null,
    completedScales: measurements.filter(value => mode === 'baseline' || value.complete).map(value => value.scale),
    ...(mode === 'paged' ? { measurementSourceFingerprint, requestCounts: { ...pagedRequestCounts }, measurements } : {}), complete: false };
  const output = join(tmpdir(), `propertyflow-tenant-directory-capacity-${mode}-${startedAt.replace(/\D/g, '')}-${serverFingerprint?.slice(0, 10) || 'unavailable'}-failure.json`);
  try { await writeFile(output, JSON.stringify(failure, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); console.error(`Immutable sanitized failure report: ${output}`); }
  catch { console.error('Failure report could not be written.'); }
  console.error(`Tenant capacity measurement failed during ${stage} (${code}); no complete report published.`); process.exitCode = 1;
} finally {
  try { await cleanup(); } catch { console.error('Isolated fixture cleanup failed.'); process.exitCode = 1; }
}
