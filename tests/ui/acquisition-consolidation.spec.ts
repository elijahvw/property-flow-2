import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page, role = 'owner') {
  const companyId = 'fictional-company', property = { id: 'fictional-property', name: 'Fictional Maple House' }, unit = { id: 'fictional-unit', propertyId: property.id, label: 'Fictional Garden Suite', status: 'active', version: 1, marketRentCents: null, property };
  const person: any = { id: 'fictional-prospect', companyId, propertyId: property.id, unitId: unit.id, name: 'Fictional Avery', email: 'avery@test.invalid', phone: '555-0100', source: 'email', desiredMoveIn: '2026-11-01', followUpOn: '2026-10-24', notes: 'Original inquiry note', stage: 'inquiry', version: 1, contactId: null, leaseId: null, createdAt: '2026-10-24T10:00:00Z', updatedAt: '2026-10-24T10:00:00Z', property, unit: { id: unit.id, label: unit.label } };
  const state = { role, mode: 'enabled', denyWrite: false, abortBefore: false, loseAfter: false, person, unit, listing: { version: null as number | null, forRent: false, listedAt: null as string | null }, readiness: { version: 1, condition: 'ready', reason: 'Condition reviewed independently', availableOn: '2026-10-24', updatedAt: '2026-10-24T10:00:00Z' }, follows: [] as any[], applications: [] as any[], events: [] as any[], reads: [] as string[], writes: [] as { path: string; body: any; company: string | undefined }[], receipts: new Map<string, any>() };
  const counts = () => Object.fromEntries(['inquiry', 'tour', 'application', 'review', 'approved', 'declined', 'withdrawn', 'converted'].map(stage => [stage, state.person.stage === stage ? 1 : 0]));
  const prospect = () => ({ ...state.person, status: ['declined', 'withdrawn', 'converted'].includes(state.person.stage) ? 'closed' : 'open' });
  const history = () => ({ items: state.events, total: state.events.length, page: 1, pageSize: 25 });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status });
    if (method === 'GET') state.reads.push(path);
    if (path === '/api/bootstrap') return json({ user: { id: 'fictional-operator', name: 'Fixture Operator', email: 'operator@test.invalid', emailVerified: true, status: 'active', platformRole: null }, membership: { companyId, role: state.role, version: 1, status: 'active', company: { id: companyId, name: 'Fictional Company', status: 'active' } }, permissions: state.role === 'staff' ? ['property.read'] : ['property.read', 'property.write', 'lease.manage', 'resident.assignment.manage'], companyFeatures: Object.fromEntries(['properties', 'leasing', 'maintenance', 'documents', 'finances', 'reports', 'inspections', 'agreements', 'notifications', 'resident_portal'].map(key => [key, ['properties', 'leasing'].includes(key) ? state.mode : 'enabled'])), csrfToken: 'fixture', destination: '/company/availability' });
    if (path === '/api/account/guide') return json({ eligible: false });
    if (path === '/api/telemetry') return json({ accepted: true });
    if (path === '/api/company/properties') return json([property]);
    if (path === `/api/company/properties/${property.id}/units`) return json({ items: [{ ...unit }], nextCursor: null });
    if (method !== 'GET') {
      const body = request.postDataJSON(); state.writes.push({ path, body, company: request.headers()['x-company-id'] });
      expect(request.headers()['x-csrf-token']).toBe('fixture');
      if (state.denyWrite) return json({ code: 'ACCESS_DENIED', error: 'Current acquisition access is unavailable.' }, 403);
      if (state.mode !== 'enabled') return json({ code: 'SUBSCRIPTION_READ_ONLY', error: 'Leasing is read-only.' }, 403);
      if (state.abortBefore) { state.abortBefore = false; return route.abort('failed'); }
      if (state.receipts.has(body.submissionKey)) return json(state.receipts.get(body.submissionKey));
      let result: any;
      if (path.endsWith('/rental-listing')) {
        if (state.role !== 'owner') return json({ code: 'ACCESS_DENIED', error: 'Owner required.' }, 403);
        if (unit.status !== 'active' || body.expectedVersion !== state.listing.version || body.expectedAvailabilityVersion !== state.readiness.version) return json({ code: 'RECORD_CHANGED', error: 'Review the current listing and readiness.' }, 409);
        Object.assign(state.listing, { version: (state.listing.version || 0) + 1, forRent: body.forRent, listedAt: body.forRent ? '2026-10-24T12:00:00Z' : null }); result = { ...state.listing };
      } else if (path.includes('/follow-ups')) {
        const id = path.split('/').at(-1), existing = state.follows.find(row => row.id === id);
        if (method === 'PATCH') { if (!existing || body.expectedVersion !== existing.version) return json({ code: 'RECORD_CHANGED', error: 'This follow-up changed.' }, 409); Object.assign(existing, body, { version: existing.version + 1 }); result = { ...existing }; }
        else { result = { id: `followup-${state.follows.length + 1}`, prospectId: person.id, ...body, version: 1 }; state.follows.push(result); }
      } else if (path === '/api/company/applications') {
        if (body.expectedProspectVersion !== person.version) return json({ code: 'RECORD_CHANGED', error: 'The source inquiry changed.' }, 409);
        result = { id: `application-${state.applications.length + 1}`, propertyId: property.id, unitId: unit.id, prospectId: person.id, notes: body.notes, status: 'draft', version: 1, contactId: null, leaseId: null, property, unit: { id: unit.id, label: unit.label }, prospect: { id: person.id, name: person.name, email: person.email }, createdAt: '2026-10-24T12:00:00Z', updatedAt: '2026-10-24T12:00:00Z' }; state.applications.push(result);
      } else if (path.startsWith('/api/company/applications/')) {
        const row = state.applications.find(row => row.id === path.split('/')[4]);
        if (!row || body.expectedVersion !== row.version) return json({ code: 'RECORD_CHANGED', error: 'This application changed.' }, 409);
        if (path.endsWith('/actions')) { if (body.expectedProspectVersion !== person.version) return json({ code: 'RECORD_CHANGED', error: 'The source inquiry changed.' }, 409); const next: Record<string, string> = { submit: 'submitted', review: 'in_review', approve: 'approved', reject: 'rejected', withdraw: 'withdrawn', reopen: 'in_review' }; row.status = next[body.action]; row.version++; result = { ...row }; }
        else if (path.endsWith('/convert')) { expect(body.confirmedMatch).toBe(true); expect(body.expectedProspectVersion).toBe(person.version); row.version++; row.contactId = 'fictional-contact'; row.leaseId = 'fictional-new-lease'; Object.assign(person, { stage: 'converted', contactId: row.contactId, leaseId: row.leaseId, version: person.version + 1 }); result = { application: { ...row }, contactId: row.contactId, leaseId: row.leaseId }; }
        else { row.notes = body.notes; row.version++; result = { ...row }; }
      } else if (path.startsWith('/api/company/prospects')) {
        if (path === '/api/company/prospects') { Object.assign(person, body, { version: 1, stage: 'inquiry' }); result = { prospect: { ...person } }; }
        else { if (body.expectedVersion !== person.version) return json({ code: 'RECORD_CHANGED', error: 'This prospect changed.' }, 409); if (path.endsWith('/convert')) Object.assign(person, { stage: 'converted', contactId: body.contactId, leaseId: body.leaseId }); else if (path.endsWith('/stage')) person.stage = body.stage; else Object.assign(person, body); person.version++; result = { prospect: { ...person } }; }
      } else return json({ error: 'Unexpected fixture mutation' }, 400);
      state.receipts.set(body.submissionKey, result); state.events.unshift({ id: `event-${state.events.length + 1}`, action: body.action || 'created', entityType: path.includes('/follow-ups') ? 'follow_up' : 'application', actorName: 'Fixture Operator', version: result.version || result.application?.version || 1, createdAt: '2026-10-24T12:00:00Z', reason: body.reason || null });
      if (state.loseAfter) { state.loseAfter = false; return route.abort('failed'); }
      return json(result);
    }
    if (path === '/api/company/availability') {
      const entry = { unit: { ...unit }, availability: { ...state.readiness }, listing: { ...state.listing }, state: unit.status === 'archived' ? 'archived' : 'ready', readinessStale: false, currentLease: null, nextLease: null, latestLeaseEnd: null };
      const items = !url.searchParams.get('listing') || (url.searchParams.get('listing') === 'for_rent') === state.listing.forRent ? [entry] : [];
      return json({ companyId, today: '2026-10-24', planningDate: '2026-10-24', timezone: 'America/New_York', definition: 'Readiness and owner listing intent are separate.', items, total: items.length, counts: { ready: items.length, archived: unit.status === 'archived' ? items.length : 0 }, nextCursor: null });
    }
    if (path.endsWith('/rental-listing/history') || path.endsWith('/acquisition-history')) return json(history());
    if (path.endsWith('/availability/history')) return json({ items: [], nextCursor: null });
    if (path === '/api/company/prospects') return json({ companyId, items: [{ ...person }], total: 1, counts: counts(), today: '2026-10-24', timezone: 'America/New_York', nextCursor: null });
    if (path === `/api/company/prospects/${person.id}/acquisition`) return json({ companyId, prospect: prospect(), followUps: state.follows, applications: state.applications, history: state.events, followUpTotal: state.follows.length, applicationTotal: state.applications.length, historyTotal: state.events.length });
    if (path.endsWith('/follow-ups')) return json({ items: state.follows.filter(row => !url.searchParams.get('status') || url.searchParams.get('status') === 'all' || row.status === url.searchParams.get('status')), total: state.follows.length, page: 1, pageSize: 25 });
    if (path.includes('/follow-ups/')) { const row = state.follows.find(row => row.id === path.split('/').at(-1)); return row ? json({ companyId, followUp: row }) : json({ error: 'Follow-up unavailable' }, 404); }
    if (path.endsWith('/conversion-options')) return json({ contacts: [{ id: 'fictional-contact', name: person.name, email: person.email, version: 1 }], leases: [{ id: 'fictional-existing-lease', unitId: unit.id, version: 1, propertyId: property.id, startsOn: '2026-11-01', endsOn: null, status: 'draft', unit }], nextCursor: null, nextLeaseCursor: null });
    if (path.startsWith('/api/company/prospects/recovery/')) { const key = path.split('/').at(-1)!; return json({ companyId, receiptRecorded: state.receipts.has(key), prospect: state.receipts.has(key) ? person : null, request: { id: key, title: 'Original inquiry request', status: state.receipts.has(key) ? person.stage : 'Receipt not visible', version: state.receipts.has(key) ? person.version : null, notes: 'No in-flight request is cancelled by local resolution.' } }); }
    if (path === `/api/company/prospects/${person.id}`) return json({ prospect: { ...person }, history: { items: [], nextCursor: null } });
    if (path === '/api/company/applications') return json({ companyId, items: state.applications, total: state.applications.length, page: Number(url.searchParams.get('page') || 1), pageSize: 25 });
    if (path.endsWith('/conversion-candidates')) return json({ items: [], total: 0, page: 1, pageSize: 25 });
    if (path.startsWith('/api/company/applications/')) { const row = state.applications.find(row => row.id === path.split('/')[4]); if (!row) return json({ error: 'Application unavailable' }, 404); return path.endsWith('/history') ? json(history()) : json({ companyId, application: row, prospect: prospect(), history: state.events, historyTotal: state.events.length }); }
    return json([]);
  });
  return state;
}
const focus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));
const journal = (page: Page, suffix: string) => page.evaluate(suffix => Object.entries(sessionStorage).find(([key]) => key.endsWith(suffix))?.[1] || null, suffix);

for (const width of [1440, 390]) test(`owner listing review is separate from readiness and usable at ${width}px`, async ({ page }) => {
  const state = await fixture(page); await page.setViewportSize({ width, height: 900 });
  await page.goto('/company/availability'); await expect(page.locator('.availability-table').getByText('Not listed for rent', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review Fictional Garden Suite rental listing', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review rental listing · Fictional Garden Suite', exact: true });
  await dialog.getByRole('combobox', { name: 'Rental listing intent', exact: true }).selectOption('true'); await dialog.getByLabel('Reason for listing review', { exact: true }).fill('Explicit fictional owner decision');
  await dialog.getByRole('button', { name: 'Save rental listing', exact: true }).click(); await expect(dialog).not.toBeVisible();
  await expect(page.locator('.availability-table').getByText('For rent', { exact: true })).toBeVisible(); expect(state.readiness.version).toBe(1); expect(state.readiness.reason).toBe('Condition reviewed independently');
  expect(state.writes[0].body.expectedAvailabilityVersion).toBe(1); expect(state.writes[0].company).toBe('fictional-company');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/propertyflow-consolidated-listing-${width}.png`, fullPage: false });
});

test('manager sees owner listing intent without receiving listing controls', async ({ page }) => {
  const state = await fixture(page, 'manager'); state.events.push({ id: 'listing-history-1', action: 'listed', entityType: 'unit_listing', version: 1, actorName: 'Fictional Owner', reason: 'Explicit owner decision', createdAt: '2026-10-24T12:00:00Z' }); await page.goto('/company/availability');
  await expect(page.locator('.availability-table').getByText('Not listed for rent', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: /rental listing$/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Rental listing history for Fictional Garden Suite', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Rental listing history · Fictional Garden Suite', exact: true });
  await expect(history).toContainText('Explicit owner decision'); await expect(history).toContainText('Fictional Owner'); await expect(history.getByRole('button', { name: 'Save rental listing', exact: true })).toHaveCount(0); expect(state.writes).toHaveLength(0);
});

test('an archived unit retains an original committed listing retry across reload', async ({ page }) => {
  const state = await fixture(page); state.loseAfter = true; await page.goto('/company/availability');
  await page.getByRole('button', { name: 'Review Fictional Garden Suite rental listing', exact: true }).click(); let dialog = page.getByRole('dialog', { name: 'Review rental listing · Fictional Garden Suite', exact: true });
  await dialog.getByRole('combobox', { name: 'Rental listing intent', exact: true }).selectOption('true'); await dialog.getByLabel('Reason for listing review', { exact: true }).fill('Original interrupted listing');
  await dialog.getByRole('button', { name: 'Save rental listing', exact: true }).click(); await expect(dialog.getByRole('alert')).toBeVisible();
  const original = await journal(page, ':listing:fictional-unit'); expect(original).not.toBeNull(); state.unit.status = 'archived'; page.once('dialog', dialog => dialog.accept()); await page.reload();
  await page.getByRole('button', { name: 'Recover original Fictional Garden Suite listing request', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Review rental listing · Fictional Garden Suite', exact: true });
  await dialog.getByRole('button', { name: 'Save rental listing', exact: true }).click(); await expect(dialog).not.toBeVisible();
  expect(state.writes).toHaveLength(2); expect(state.writes[1].body).toEqual(state.writes[0].body); expect(state.events).toHaveLength(1); expect(await journal(page, ':listing:fictional-unit')).toBeNull();
  await expect(page.getByRole('button', { name: /rental listing$/ })).toHaveCount(0);
});

test('follow-up input survives enabled to read-only to enabled policy refresh without rebasing its source', async ({ page }) => {
  const state = await fixture(page); await page.goto('/company/prospects?prospectId=fictional-prospect');
  await page.getByRole('button', { name: 'Add follow-up', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Add follow-up', exact: true });
  await dialog.getByLabel('Title', { exact: true }).fill('Original tour draft'); await dialog.getByLabel('Follow-up date', { exact: true }).fill('2026-11-04');
  state.mode = 'read_only'; await focus(page); await expect(dialog.getByLabel('Title', { exact: true })).toBeDisabled(); await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Original tour draft');
  state.person.version++; state.person.notes = 'Separate source update'; state.mode = 'enabled'; await focus(page);
  await expect(dialog.getByLabel('Title', { exact: true })).toBeEnabled(); await expect(dialog.getByLabel('Follow-up date', { exact: true })).toHaveValue('2026-11-04');
  await dialog.getByRole('button', { name: 'Add follow-up', exact: true }).click(); await expect(dialog).not.toBeVisible(); expect(state.follows).toHaveLength(1); expect(state.writes[0].company).toBe('fictional-company');
});

test('a pending follow-up PATCH resolves only after reading its exact current record', async ({ page }) => {
  const state = await fixture(page); state.follows.push({ id: 'followup-original', prospectId: state.person.id, kind: 'tour', title: 'Original tour', dueOn: '2026-11-03', notes: 'Original follow-up note', status: 'open', version: 1 });
  await page.goto('/company/prospects?prospectId=fictional-prospect'); await page.getByRole('button', { name: 'Update follow-up', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Update follow-up', exact: true }); await dialog.getByLabel('Title', { exact: true }).fill('My attempted tour update'); state.abortBefore = true;
  await dialog.getByRole('button', { name: 'Save follow-up', exact: true }).click(); await expect(dialog.getByRole('alert')).toBeVisible();
  const original = await journal(page, ':followup:fictional-prospect:followup-original'); Object.assign(state.follows[0], { version: 2, title: 'Peer reviewed tour', notes: 'Peer actual follow-up note', dueOn: '2026-11-09' });
  await dialog.getByRole('button', { name: 'Save follow-up', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('follow-up changed'); expect(await journal(page, ':followup:fictional-prospect:followup-original')).toBe(original);
  const recovery = dialog.locator('details[aria-label="Review current acquisition source"]'); await recovery.getByRole('button', { name: 'Load current saved record', exact: true }).click();
  await expect(recovery).toContainText('Peer actual follow-up note'); await expect(recovery).not.toContainText('Original inquiry note'); expect(state.reads).toContain('/api/company/prospects/fictional-prospect/follow-ups/followup-original');
  await recovery.getByRole('checkbox').check(); const before = state.writes.length; await recovery.getByRole('button', { name: 'Keep current source and stop retrying', exact: true }).click();
  await expect(dialog).not.toBeVisible(); expect(state.writes).toHaveLength(before); expect(await journal(page, ':followup:fictional-prospect:followup-original')).toBeNull(); expect(state.follows[0].notes).toBe('Peer actual follow-up note');
});

test('an inquiry create journal survives reload and restores its original company and details', async ({ page }) => {
  const state = await fixture(page); await page.goto('/company/prospects'); await page.getByRole('button', { name: 'Record inquiry', exact: true }).first().click();
  let dialog = page.getByRole('dialog', { name: 'Record prospect inquiry', exact: true }); await dialog.getByLabel('Name', { exact: true }).fill('Original new inquiry'); await dialog.getByLabel('Email (email or phone required)', { exact: true }).fill('original-new@test.invalid'); await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption('fictional-property'); await dialog.getByLabel('Reason for recording this inquiry', { exact: true }).fill('Original creation review');
  state.loseAfter = true; await dialog.getByRole('button', { name: 'Record inquiry', exact: true }).click(); await expect(dialog.getByRole('alert')).toBeVisible(); const original = await journal(page, ':prospect:new');
  page.once('dialog', dialog => dialog.accept()); await page.reload(); dialog = page.getByRole('dialog', { name: 'Record prospect inquiry', exact: true }); await expect(dialog).toContainText('Original new inquiry');
  await dialog.getByRole('button', { name: 'Record inquiry', exact: true }).click(); await expect(dialog).not.toBeVisible(); expect(state.writes[1].body).toEqual(state.writes[0].body); expect(state.writes[1].company).toBe('fictional-company'); expect(original).not.toBeNull(); expect(await journal(page, ':prospect:new')).toBeNull();
});

test('a fresh inquiry with no visible receipt can stop retrying only after an explicit current-source review', async ({ page }) => {
  const state = await fixture(page); await page.goto('/company/prospects'); await page.getByRole('button', { name: 'Record inquiry', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Record prospect inquiry', exact: true }); await dialog.getByLabel('Name', { exact: true }).fill('Uncommitted inquiry'); await dialog.getByLabel('Email (email or phone required)', { exact: true }).fill('uncommitted@test.invalid'); await dialog.getByRole('combobox', { name: 'Property', exact: true }).selectOption('fictional-property'); await dialog.getByLabel('Reason for recording this inquiry', { exact: true }).fill('Explicit attempt for local recovery');
  state.abortBefore = true; await dialog.getByRole('button', { name: 'Record inquiry', exact: true }).click(); await expect(dialog.getByRole('alert')).toBeVisible(); expect(await journal(page, ':prospect:new')).not.toBeNull();
  const recovery = dialog.locator('details[aria-label="Review current acquisition source"]'); await recovery.locator('summary').click(); await recovery.getByRole('button', { name: 'Load current saved record', exact: true }).click();
  await expect(recovery).toContainText('Receipt not visible'); await expect(recovery).toContainText('No in-flight request is cancelled'); await expect(recovery.getByRole('button', { name: 'Keep current source and stop retrying', exact: true })).toBeDisabled();
  await recovery.getByRole('checkbox').check(); const before = state.writes.length; await recovery.getByRole('button', { name: 'Keep current source and stop retrying', exact: true }).click(); await expect(dialog).not.toBeVisible(); expect(state.writes).toHaveLength(before); expect(state.events).toHaveLength(0); expect(state.person.name).toBe('Fictional Avery'); expect(await journal(page, ':prospect:new')).toBeNull();
});

test('a definitive prospect version rejection keeps entered details and the opening source version', async ({ page }) => {
  const state = await fixture(page); await page.goto('/company/prospects?prospectId=fictional-prospect'); await page.getByRole('button', { name: 'Edit prospect details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit prospect details', exact: true }); await dialog.getByLabel('Name', { exact: true }).fill('My unsaved correction'); await dialog.getByRole('textbox', { name: 'Management notes (optional)', exact: true }).fill('Keep my unsaved notes'); await dialog.getByLabel('Reason for this update', { exact: true }).fill('Original reviewed correction');
  state.person.version = 2; state.person.notes = 'Peer saved notes'; await dialog.getByRole('button', { name: 'Save prospect details', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('prospect changed');
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('My unsaved correction'); await expect(dialog.getByRole('textbox', { name: 'Management notes (optional)', exact: true })).toHaveValue('Keep my unsaved notes'); await expect(dialog.getByLabel('Name', { exact: true })).toBeEnabled(); expect(await journal(page, ':prospect:fictional-prospect:edit')).toBeNull();
  await dialog.getByRole('button', { name: 'Save prospect details', exact: true }).click(); expect(state.writes).toHaveLength(2); expect(state.writes.every(row => row.body.expectedVersion === 1)).toBe(true); expect(state.person.notes).toBe('Peer saved notes'); expect(state.events).toHaveLength(0);
});

test('a committed prospect handoff reloads after conversion and remains an exact retry through read-only and access denial', async ({ page }) => {
  const state = await fixture(page); state.person.stage = 'approved'; await page.goto('/company/prospects?prospectId=fictional-prospect'); await page.getByRole('button', { name: 'Review tenant & lease link', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Review tenant and lease handoff', exact: true }); await dialog.getByRole('combobox', { name: 'Tenant account', exact: true }).selectOption('fictional-contact'); await dialog.getByRole('combobox', { name: 'Existing lease', exact: true }).selectOption('fictional-existing-lease'); await dialog.getByRole('checkbox').check(); await dialog.getByLabel('Reason for linking these existing records', { exact: true }).fill('Explicit original person match');
  state.loseAfter = true; await dialog.getByRole('button', { name: 'Confirm tenant & lease link', exact: true }).click(); await expect(dialog.getByRole('alert')).toBeVisible(); const original = await journal(page, ':prospect:fictional-prospect:convert'); expect(state.person.stage).toBe('converted'); state.unit.status = 'archived'; state.mode = 'read_only'; page.once('dialog', dialog => dialog.accept()); await page.reload();
  dialog = page.getByRole('dialog', { name: 'Review tenant and lease handoff', exact: true }); await expect(dialog).toContainText('Original interrupted prospect request'); await expect(dialog.getByRole('button', { name: 'Confirm tenant & lease link', exact: true })).toBeDisabled(); expect(await journal(page, ':prospect:fictional-prospect:convert')).toBe(original);
  state.mode = 'enabled'; await focus(page); await expect(dialog.getByRole('button', { name: 'Confirm tenant & lease link', exact: true })).toBeEnabled(); state.denyWrite = true; await dialog.getByRole('button', { name: 'Confirm tenant & lease link', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Prospect access unavailable', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Fictional Avery', exact: true })).toHaveCount(0); expect(await journal(page, ':prospect:fictional-prospect:convert')).toBe(original);
  state.denyWrite = false; await page.reload(); dialog = page.getByRole('dialog', { name: 'Review tenant and lease handoff', exact: true }); await dialog.getByRole('button', { name: 'Confirm tenant & lease link', exact: true }).click(); await expect(dialog).not.toBeVisible(); expect(state.writes).toHaveLength(3); expect(state.writes.every(row => JSON.stringify(row.body) === JSON.stringify(state.writes[0].body))).toBe(true); expect(state.events).toHaveLength(1); expect(await journal(page, ':prospect:fictional-prospect:convert')).toBeNull();
});

for (const width of [1440, 390]) test(`application review and lease preparation preserve the canonical prospect return at ${width}px`, async ({ page }) => {
  const state = await fixture(page); await page.setViewportSize({ width, height: 900 });
  await page.goto('/company/prospects?q=Original&stage=inquiry&cursor=fictional-cursor&prospectId=fictional-prospect'); await page.getByRole('link', { name: 'Create application', exact: true }).click();
  await expect(page).toHaveURL(/\/company\/applications\/new/); await expect(page.getByRole('heading', { name: 'Create application', exact: true })).toBeVisible();
  await page.getByLabel('Application notes (optional)', { exact: true }).fill('Reviewed fictional application'); await page.getByRole('button', { name: 'Review application', exact: true }).click(); await page.getByRole('button', { name: 'Save application draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fictional Avery', exact: true })).toBeVisible();
  for (const label of ['Submit application', 'Start review', 'Approve application']) { await page.getByRole('button', { name: label, exact: true }).click(); const dialog = page.getByRole('dialog', { name: label, exact: true }); await dialog.getByLabel('Reason for this action', { exact: true }).fill(`Explicit fixture decision ${label}`); await dialog.getByRole('button', { name: label, exact: true }).click(); await expect(dialog).not.toBeVisible(); }
  await page.getByRole('link', { name: 'Prepare lease draft', exact: true }).click(); await page.getByLabel('Lease start date', { exact: true }).fill('2026-11-01'); await page.getByLabel('Monthly rent (USD)', { exact: true }).fill('1625.37'); await page.getByRole('button', { name: 'Review lease preparation', exact: true }).click();
  await page.getByRole('checkbox', { name: 'I reviewed the applicant, intended tenant, unit and rental terms.', exact: true }).check();
  await page.screenshot({ path: `/tmp/propertyflow-consolidated-application-review-${width}.png`, fullPage: false });
  await page.getByRole('button', { name: 'Prepare linked lease draft', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Lease draft prepared', exact: true })).toBeVisible();
  const source = page.getByRole('link', { name: '← Back to prospect', exact: true }); await expect(source).toHaveAttribute('href', /q=Original/); await expect(source).toHaveAttribute('href', /cursor=fictional-cursor/); expect(state.writes.every(row => row.company === 'fictional-company')).toBe(true);
  expect(state.applications).toHaveLength(1); expect(state.person.stage).toBe('converted'); expect(state.writes.at(-1)?.body.monthlyRent).toBe('1625.37'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('authoritative denial hides an application action immediately while preserving its exact earlier journal', async ({ page }) => {
  const state = await fixture(page); state.applications.push({ id: 'application-1', propertyId: state.person.propertyId, unitId: state.unit.id, prospectId: state.person.id, notes: 'Private application note', status: 'draft', version: 1, contactId: null, leaseId: null, property: state.person.property, unit: state.person.unit, prospect: { id: state.person.id, name: state.person.name, email: state.person.email }, createdAt: '2026-10-24T12:00:00Z', updatedAt: '2026-10-24T12:00:00Z' });
  await page.goto('/company/applications/application-1'); await page.getByRole('button', { name: 'Submit application', exact: true }).click(); let dialog = page.getByRole('dialog', { name: 'Submit application', exact: true }); await dialog.getByLabel('Reason for this action', { exact: true }).fill('Original approval flow'); state.loseAfter = true;
  await dialog.getByRole('button', { name: 'Submit application', exact: true }).click(); await expect(dialog.getByRole('alert')).toBeVisible(); const original = await journal(page, ':application:application-1:action'); state.denyWrite = true;
  await dialog.getByRole('button', { name: 'Submit application', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Acquisition access unavailable', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Fictional Avery', exact: true })).toHaveCount(0); expect(await journal(page, ':application:application-1:action')).toBe(original);
  state.denyWrite = false; await page.reload(); dialog = page.getByRole('dialog', { name: 'Submit application', exact: true }); await dialog.getByRole('button', { name: 'Submit application', exact: true }).click(); await expect(dialog).not.toBeVisible(); expect(state.writes[2].body).toEqual(state.writes[0].body); expect(state.events).toHaveLength(1);
});
