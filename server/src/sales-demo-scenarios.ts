import { randomUUID } from "node:crypto";
import type { Tx } from "./operational.js";
import type { DemoSeedAccounts } from "./sales-demo-seed.js";

// Fixed fictional UTF-8 content, uploaded through ordinary validation and
// explicitly recorded as unscanned. No malware clearance is fabricated.
export const DEMO_BUNDLED_TEXT = "BUNDLED FICTIONAL DEMO ORIGINAL. Plain UTF-8 text only. Unsigned sample; no legal effect or active content.\n";
// Every shipped company feature must retain representative connected sources.
// New catalog entries require this map, fixture and walkthrough to be reviewed.
export const DEMO_FEATURE_COVERAGE = {
  properties: ["properties", "units", "scenarios.archivedUnitId", "presentation.anchorOn"],
  leasing: ["leases", "scenarios.offlineLeaseId", "scenarios.plannedMoveOutId", "scenarios.invitationId", "scenarios.endedLeaseId", "scenarios.approvedApplicationId", "scenarios.rejectedApplicationId", "savedTaskId"],
  maintenance: ["requests", "vendorId", "scenarios.privateUpdateId", "scenarios.pausedPreventivePlanId"],
  documents: ["documentVersionId", "documentId", "scenarios.receivedShareId", "scenarios.archivedDocumentId"],
  finances: ["scenarios.endedLeaseId", "scenarios.offlineLeaseId", "scenarios.reversedCreditId", "scenarios.voidedExpenseId"],
  reports: ["scenarios.expenseImportId", "leases"],
  inspections: ["inspectionId", "scenarios.baselineInspectionId", "scenarios.moveOutInspectionId"],
  agreements: ["agreementId", "scenarios.reviewedAgreementId"],
  notifications: ["scenarios.readNotificationId", "requests"],
  resident_portal: ["residents", "occupantId", "scenarios.offlineContactId", "scenarios.pendingContactId"],
} as const;
// Presentation stops point at retained source records, not made-up dashboard
// values. Keep these state expectations and the walkthrough current together.
export const DEMO_PRESENTATION_STOPS = [
  { title: "Offline tenant with an active lease", role: "Owner or manager", source: "scenarios.offlineLeaseId", route: "/company/leases/", state: "An existing account and active lease with a recorded future move-out plan, without portal membership or issued login credentials." },
  { title: "Invitation awaiting acceptance", role: "Owner", source: "scenarios.pendingContactId", route: "/company/tenants/", state: "A prepared tenant and unaccepted invitation; no email delivery is claimed." },
  { title: "Ended lease, settlement and refund", role: "Owner or manager", source: "scenarios.endedLeaseId", route: "/company/leases/", state: "Retained move-in/move-out evidence, deposit application and linked fictional manual refund source." },
  { title: "Approved application", role: "Owner or manager", source: "scenarios.approvedApplicationId", route: "/company/applications/", state: "A management decision with history, not screening, a signature or portal authority." },
  { title: "Rejected application", role: "Owner or manager", source: "scenarios.rejectedApplicationId", route: "/company/applications/", state: "A different outcome and retained reason; no lease is created." },
  { title: "Completed maintenance and paid expense", role: "Owner or manager", source: "requests.0", route: "/company/maintenance/", state: "Assigned and approved work linked to the same retained paid expense." },
  { title: "Upcoming assigned work", role: "Staff technician", source: "requests.2", route: "/company/work-orders/", state: "Execution stays within current property scope and assignment; finances remain denied." },
  { title: "Household rental terms", role: "Jordan Rivera · resident / leaseholder", source: "leases.0", route: "/resident/leases/", suffix: "/terms", state: "Only this household's permitted lease terms; no management controls." },
  { title: "Leaseholder statement", role: "Jordan Rivera · resident / leaseholder", source: "leases.0", route: "/resident/leases/", suffix: "/statement", state: "Shared lease finances follow the recorded leaseholder relationship, never occupant access." },
  { title: "Occupant service home", role: "Riley Rivera · occupant", source: "occupantId", route: "/resident", appendSource: false, state: "The same household's service view without lease finance or leaseholder document access." },
] as const;
type Call = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: Record<string, unknown>) => Promise<any>;
export async function seedDemoScenarios(c: { call: Call; tx: Tx; companyId: string; accounts: DemoSeedAccounts; today: string; offset: (months: number, day?: number) => string; properties: string[]; units: string[]; leases: string[]; requests: string[]; asActor: (id: string) => void }) {
  const { call, tx, companyId, accounts, today, offset, properties, leases, asActor } = c, ownerId = accounts.users.owner.user_id;
  const contact = async (key: string, notes: string) => call("POST", "/api/company/resident-contacts", { name: accounts.users[key].name, email: accounts.users[key].email, phone: "215-555-0160", emergencyContactName: "Fictional emergency contact", emergencyContactPhone: "215-555-0161", managementNotes: notes });
  const offline = await contact("offline", "DEMO: business tenant with a prepared account but no portal membership, invitation or sign-in. Do not issue credentials."),
    pending = await contact("pending", "DEMO: portal invitation awaiting acceptance; no email sent."),
    former = await contact("former", "DEMO: former tenant with retained rental and settlement history.");
  const invitation = await call("POST", `/api/company/resident-contacts/${pending.id}/invitations`, { expectedVersion: pending.version, approvals: [] });
  const offlineUnit = await call("POST", `/api/company/properties/${properties[0]}/units`, { label: "Offline tenant · Suite 4", bedrooms: 1, bathrooms: "1.00" });
  const offlineLease = await call("POST", "/api/company/leases", { propertyId: properties[0], unitId: offlineUnit.id, residentContactId: offline.id, startsOn: offset(-1,15), endsOn: offset(11,14), monthlyRent: "1200.00", status: "active", rentDueDay: 1, graceDays: 3, paymentInstructions: "DEMO offline tenant. Record manual payments; no portal access." });
  const prorationRoot = `/api/company/leases/${offlineLease.id}/proration`, proration = await call("GET", prorationRoot + "?periodOn=" + offset(-1));
  const prorateBody = { periodOn: offset(-1), fromOn: proration.calculation.fromOn, throughOn: proration.calculation.throughOn, policy: "actual_calendar_month", dueOn: proration.dueOn.slice(0,10), overrideAmount: null, overrideReason: null, reason: "DEMO actual-calendar partial move-in month.", expectedLeaseVersion: offlineLease.version };
  const proratePreview = await call("POST", prorationRoot + "/preview", prorateBody);
  await call("POST", prorationRoot, { ...prorateBody, sourceHash: proratePreview.sourceHash, confirmed: true });
  await call("POST", `/api/company/rent/${offlineLease.id}/charges`, { periodOn: offset(0), dueOn: offset(0), amount: "1200.00", memo: "DEMO unpaid offline rent", expectedVersion: offlineLease.version });
  await call("POST", `/api/company/deposits/${offlineLease.id}`, { amount: "1200.00", dueOn: offset(-1,15), expectedLeaseVersion: offlineLease.version });
  await call("POST", `/api/company/rent/${offlineLease.id}/schedules`, { firstPeriodOn: offset(1), firstDueOn: offset(1), leadDays: 0, expectedVersion: offlineLease.version });
  const pausedSchedule = await tx.rentSchedule.findFirstOrThrow({ where: { companyId, leaseId: offlineLease.id } });
  await call("PATCH", `/api/company/rent-schedules/${pausedSchedule.id}`, { status: "paused", expectedVersion: pausedSchedule.version });

  const formerUnit = await call("POST", `/api/company/properties/${properties[1]}/units`, { label: "Move-out · Suite 5", bedrooms: 2, bathrooms: "1.00" });
  const oldLease = await call("POST", "/api/company/leases", { propertyId: properties[1], unitId: formerUnit.id, residentContactId: former.id, startsOn: offset(-12), endsOn: offset(-1,20), monthlyRent: "1400.00", status: "active" });
  const damage = await call("POST", `/api/company/rent/${oldLease.id}/one-time-charges`, { category: "damage", effectiveOn: offset(-1,20), dueOn: offset(-1,20), amount: "200.00", description: "DEMO reviewed move-out repair", expectedLeaseVersion: 1 });
  const deposit = await call("POST", `/api/company/deposits/${oldLease.id}`, { amount: "1400.00", dueOn: offset(-12), expectedLeaseVersion: 1 });
  await call("POST", `/api/company/deposits/${oldLease.id}/receipts`, { amount: "1400.00", occurredOn: offset(-12), method: "bank_transfer", memo: "DEMO manual deposit receipt", expectedVersion: deposit.version, expectedLeaseVersion: 1 });
  const inspectionRoot = `/api/company/leases/${oldLease.id}/inspections`, itemKey = randomUUID();
  const baseline = await call("POST", inspectionRoot, { kind: "move_in", inspectedOn: offset(-12), baselineRevisionId: null, items: [{ key: itemKey, area: "Living room", item: "Walls", condition: "good", notes: "DEMO move-in condition", evidenceVersionIds: [] }] });
  await call("POST", `${inspectionRoot}/${baseline.inspectionId}`, { action: "submit", expectedVersion: 1 });
  await call("POST", `${inspectionRoot}/${baseline.inspectionId}`, { action: "complete", expectedVersion: 2, reason: "DEMO management reviewed baseline." });
  const baselineRevision = await tx.inspectionRevision.findFirstOrThrow({ where: { companyId, inspectionId: baseline.inspectionId, version: 3 }, select: { id: true } });
  const moveOut = await call("POST", inspectionRoot, { kind: "move_out", inspectedOn: offset(-1,20), baselineRevisionId: baselineRevision.id, items: [{ key: itemKey, area: "Living room", item: "Walls", condition: "fair", notes: "DEMO comparison shows wall scuffs; repair charge remains a separate reviewed source.", evidenceVersionIds: [] }] });
  await call("POST", `${inspectionRoot}/${moveOut.inspectionId}`, { action: "submit", expectedVersion: 1 });
  const settlementRoot = `/api/company/leases/${oldLease.id}/settlement`, settlementBody = { movedOutOn: offset(-1,20), reason: "DEMO final itemization and deposit disposition.", forwarding: { status: "not_supplied" }, applications: [{ chargeId: damage.id, amount: "200.00", evidenceReference: "DEMO separately reviewed wall-repair itemization" }], pauseBilling: true, expectedLeaseVersion: 1, expectedSettlementVersion: 0 };
  const settlementPreview = await call("POST", settlementRoot + "/preview", settlementBody);
  await call("POST", settlementRoot, { ...settlementBody, sourceHash: settlementPreview.sourceHash, confirmed: true });
  const movementsRoot = `/api/company/lease-movements/${oldLease.id}`, movement = await call("GET", movementsRoot);
  await call("POST", movementsRoot, { kind: "deposit_refund", amount: "1200.00", effectiveOn: today, reason: "DEMO remaining deposit manually refunded.", expectedLeaseVersion: movement.lease.version, expectedAvailableCents: movement.deposit.heldCents, expectedAccountVersion: movement.deposit.version, confirmed: true, payee: accounts.users.former.name, method: "bank_transfer", paymentReference: "DEMO ONLY" });
  const endRoot = `/api/company/leases/${oldLease.id}/transition`, endContext = await call("GET", endRoot), endBody = { kind: "end", endsOn: offset(-1,20), expectedLeaseVersion: endContext.lease.version, expectedSuccessorVersion: null, newBilling: "none", firstDueOn: null, firstAmount: null, firstOverrideReason: null, reason: "DEMO reviewed ending with original ledger retained.", depositDisposition: "retain_old_ledger" };
  const endPreview = await call("POST", endRoot + "/preview", endBody);
  await call("POST", endRoot, { ...endBody, sourceHash: endPreview.sourceHash, confirmed: true });
  await call("PUT", `/api/company/units/${formerUnit.id}/availability`, { expectedVersion: null, condition: "turnover", availableOn: today, reason: "DEMO former lease ended; turnover inspection remains to review." });
  await call("PATCH", `/api/company/resident-contacts/${former.id}`, { name: accounts.users.former.name, email: accounts.users.former.email, status: "archived", expectedVersion: former.version });

  const account = (await call("GET", `/api/company/rent?leaseId=${leases[0]}`)).accounts[0], parking = account.charges.find((charge: any) => charge.category === "parking");
  const leaseVersion = (await tx.lease.findUniqueOrThrow({ where: { id: leases[0], companyId } })).version;
  await call("POST", `/api/company/rent/${leases[0]}/credits`, { chargeId: parking.id, kind: "concession", effectiveOn: today, amount: "25.00", reason: "DEMO parking concession; not a cash receipt.", expectedChargeVersion: parking.version, expectedRemainingCents: parking.remainingCents, expectedLeaseVersion: leaseVersion });
  const creditAccount = (await call("GET", `/api/company/rent?leaseId=${leases[0]}`)).accounts[0], correctedParking = creditAccount.charges.find((charge: any) => charge.id === parking.id);
  const reversedCredit = await call("POST", `/api/company/rent/${leases[0]}/credits`, { chargeId: parking.id, kind: "credit_note", effectiveOn: today, amount: "10.00", reason: "DEMO credit entered in error; see retained reversal.", expectedChargeVersion: correctedParking.version, expectedRemainingCents: correctedParking.remainingCents, expectedLeaseVersion: leaseVersion });
  await call("POST", `/api/company/rent/${leases[0]}/credits/${reversedCredit.id}/reverse`, { effectiveOn: today, reason: "DEMO correction preserves both original and reversal.", expectedLeaseVersion: leaseVersion });
  await call("POST", `/api/company/rent/${leases[0]}/payments`, { occurredOn: today, amount: "200.00", memo: "DEMO surplus payment creates unapplied cash credit" });
  const correction = await call("POST", "/api/company/finances", { propertyId: properties[0], occurredOn: today, amount: "15.00", kind: "expense", category: "other", memo: "DEMO correction history" });
  await call("POST", `/api/company/finances/${correction.id}/void`, { expectedVersion: 1, reason: "DEMO original entry corrected; retained for audit." });

  const documentRoot = `/api/company/leases/${leases[0]}/documents`;
  const original = await call("POST", documentRoot, { title: "Bundled sample lease original · DEMO", filename: "bundled-demo.txt", mediaType: "text/plain", contentBase64: Buffer.from(DEMO_BUNDLED_TEXT).toString("base64") });
  const shareRoot = `${documentRoot}/${original.documentId}/shares`, shared = await call("POST", shareRoot, { documentVersionId: original.versionId, userId: accounts.users.resident.user_id, expiresOn: offset(3), reason: "DEMO owner explicitly shares the bundled fictional original.", expectedVersion: null, expectedDocumentVersion: 1 });
  asActor(accounts.users.resident.user_id);
  await call("POST", `/api/resident/documents/${shared.share.id}/received`, { expectedVersion: shared.share.version });
  await call("GET", `/api/resident/documents/${shared.share.id}/download`);
  asActor(ownerId);
  const agreementRoot = `/api/company/leases/${leases[0]}/agreements`, context = await call("GET", agreementRoot + "/context");
  const agreement = await call("POST", agreementRoot, { title: "Reviewed unsigned agreement · DEMO", kind: "lease", notes: "Bundled fictional original. Reviewed preparation only; never signed or sent.", documentVersionIds: [original.versionId], partyIds: context.leaseholders.map((p: { id: string }) => p.id), companySignerId: ownerId });
  asActor(accounts.users.manager.user_id);
  await call("POST", `${agreementRoot}/${agreement.agreementId}`, { action: "submit", expectedVersion: 1, confirmed: true });
  asActor(ownerId);
  await call("POST", `${agreementRoot}/${agreement.agreementId}`, { action: "approve", expectedVersion: 2, confirmed: true, reason: "DEMO owner reviews preparation, not an electronic signature." });
  const archivedDoc = await call("POST", documentRoot, { title: "Archived original · DEMO", filename: "archived-demo.txt", mediaType: "text/plain", contentBase64: Buffer.from(DEMO_BUNDLED_TEXT).toString("base64") });
  await call("PATCH", `${documentRoot}/${archivedDoc.documentId}`, { expectedVersion: 1, archived: true });

  const unitCsv = `propertyId,label,bedrooms,bathrooms,squareFeet,marketRent,floor,notes\n${properties[0]},Imported inventory suite,1,1.00,650,1250.00,2,DEMO unit source\n`;
  const inventory = await call("POST", "/api/company/imports/units/preview", { fileName: "demo-units.csv", csv: unitCsv });
  await call("POST", `/api/company/imports/units/${inventory.id}/commit`, { expectedVersion: inventory.version });
  const invalidInventory = await call("POST", "/api/company/imports/units/preview", { fileName: "demo-unit-errors.csv", csv: `propertyId,label,bedrooms\n${properties[0]},Needs bedroom correction,not-a-number\n` });
  const expenseCsv = `sourceId,propertyId,occurredOn,amount,category,memo\ndemo-paid-utility,${properties[0]},${today},85.25,utilities,DEMO paid utility statement\n`;
  const expenses = await call("POST", "/api/company/imports/expenses/preview", { sourceNamespace: "sales-demo", fileName: "demo-expenses.csv", csv: expenseCsv });
  await call("POST", `/api/company/imports/expenses/${expenses.id}/commit`, { expectedVersion: expenses.version, confirmedPaid: true, confirmedNotRecorded: true });
  const invalidExpenses = await call("POST", "/api/company/imports/expenses/preview", { sourceNamespace: "sales-demo", fileName: "demo-expense-errors.csv", csv: expenseCsv });
  const applicationStates: Record<string, string> = {};
  for (const [outcome, name] of [["approve", "Lena Ortiz"], ["reject", "Blake Quinn"]]) {
    const inquiry = (await call("POST", "/api/company/prospects", { propertyId: properties[0], unitId: c.units[2], name: `${name} · DEMO`, email: `${outcome}-applicant@sales-demo.invalid`, source: "email", desiredMoveIn: offset(2), followUpOn: today, notes: "Fictional manual application decision example.", reason: "DEMO inquiry intake." })).prospect;
    let application = await call("POST", "/api/company/applications", { prospectId: inquiry.id, unitId: c.units[2], notes: "DEMO manual decision history; no screening provider.", expectedProspectVersion: inquiry.version });
    for (const action of ["submit", "review", outcome]) {
      const current = await call("GET", `/api/company/applications/${application.id}`);
      application = await call("POST", `/api/company/applications/${application.id}/actions`, { action, expectedVersion: current.application.version, expectedProspectVersion: current.prospect.version, reason: "DEMO explicitly recorded manual decision; no external screening result." });
    }
    applicationStates[outcome] = application.id;
  }
  const archivedUnit = await call("POST", `/api/company/properties/${properties[0]}/units`, { label: "Archived storage suite · DEMO" });
  await call("PATCH", `/api/company/units/${archivedUnit.id}`, { label: archivedUnit.label, status: "archived", expectedVersion: archivedUnit.version });
  const pausedPreventive = await call("POST", "/api/company/preventive", { title: "Paused filter service · DEMO", description: "Fictional service paused pending equipment replacement.", category: "hvac", priority: "normal", propertyId: properties[0], unitId: null, cadence: "quarterly", timezone: "America/New_York", anchorOn: today, endOn: null });
  await call("PATCH", `/api/company/preventive/${pausedPreventive.planId}`, { title: "Paused filter service · DEMO", description: "Fictional service paused pending equipment replacement.", category: "hvac", priority: "normal", status: "paused", expectedVersion: 1, submissionKey: randomUUID() });
  const requesterId = c.requests[c.requests.length-1];
  const privateUpdate = await call("POST", `/api/company/maintenance/${requesterId}/updates`, { content: "DEMO INTERNAL: compare repair estimates before approving the visit.", visibility: "internal" });
  await call("POST", `/api/company/maintenance/${requesterId}/updates`, { content: "DEMO shared update: the visit is being arranged.", visibility: "resident" });
  asActor(accounts.users.resident.user_id);
  await call("POST", `/api/resident/maintenance/${requesterId}/updates`, { content: "DEMO resident reply: weekday mornings work for me." });
  asActor(accounts.users.manager.user_id);
  const notices = await call("GET", "/api/account/notifications");
  const readNotice = notices.items[0];
  if (readNotice) await call("POST", `/api/account/notifications/${readNotice.id}`, { action: "read", expectedVersion: readNotice.version });
  const preferences = await call("GET", "/api/account/notifications/preferences");
  await call("POST", "/api/account/notifications/preferences", { maintenanceEnabled: true, workEnabled: false, inspectionsEnabled: true, agreementsEnabled: true, expectedVersion: preferences.version, expectedCompanyId: companyId });
  asActor(ownerId);
  const plannedRoot = `/api/company/leases/${offlineLease.id}/transition`, plannedContext = await call("GET", plannedRoot);
  const plannedBody = { kind: "plan_end", endsOn: offset(10,20), expectedLeaseVersion: plannedContext.lease.version, expectedSuccessorVersion: null, newBilling: "none", firstDueOn: null, firstAmount: null, firstOverrideReason: null, reason: "DEMO future move-out planned; occupancy remains active and settlement follows actual departure.", depositDisposition: "retain_old_ledger" };
  const plannedPreview = await call("POST", plannedRoot + "/preview", plannedBody);
  const plannedMoveOut = await call("POST", plannedRoot, { ...plannedBody, sourceHash: plannedPreview.sourceHash, confirmed: true });
  return { plannedMoveOutId: plannedMoveOut.id, offlineContactId: offline.id, offlineLeaseId: offlineLease.id, pendingContactId: pending.id, invitationId: invitation.id, formerContactId: former.id, endedLeaseId: oldLease.id, baselineInspectionId: baseline.inspectionId, moveOutInspectionId: moveOut.inspectionId, reviewedAgreementId: agreement.agreementId, sharedDocumentId: original.documentId, receivedShareId: shared.share.id, archivedDocumentId: archivedDoc.documentId, archivedUnitId: archivedUnit.id, pausedScheduleId: pausedSchedule.id, pausedPreventivePlanId: pausedPreventive.planId, privateUpdateId: privateUpdate.id, readNotificationId: readNotice?.id ?? null, voidedExpenseId: correction.id, reversedCreditId: reversedCredit.id, approvedApplicationId: applicationStates.approve, rejectedApplicationId: applicationStates.reject, unitImportId: inventory.id, invalidUnitImportId: invalidInventory.id, expenseImportId: expenses.id, duplicateExpenseImportId: invalidExpenses.id };
}
