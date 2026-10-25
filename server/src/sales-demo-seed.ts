import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { registerApplication } from "./application.js";
import { AccessError } from "./access.js";
import type { Tx } from "./operational.js";
import type { IdentityProvider, ProviderUser } from "./identity-provider.js";
import { companyDay } from "./reports.js";
import { seedDemoScenarios } from "./sales-demo-scenarios.js";

// Bump whenever the fixture changes. Only constant fictional content goes here;
// never copy customer data or call an external identity/email/payment provider.
export const SALES_DEMO_SEED_VERSION = 4;
export type DemoSeedAccounts = { issuer: string; databaseConnection: string; users: Record<string, ProviderUser> };
export async function seedSalesDemo(tx: Tx, companyId: string, accounts: DemoSeedAccounts) {
  const ownerId = accounts.users.owner.user_id;
  // Existing business handlers run inside the single outer transaction. This
  // private, unbound Fastify instance has no socket, login route or real provider.
  const db = new Proxy(tx, {
    get(target, key) {
      if (key === "$transaction") return async (run: (inner: Tx) => unknown) => run(tx);
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as PrismaClient;
  const origin = "https://sales-demo.invalid", csrf = randomUUID();
  const app = Fastify();
  const people = new Map(Object.values(accounts.users).map(user => [user.user_id, user]));
  const provider: IdentityProvider = {
    issuer: accounts.issuer, databaseConnection: accounts.databaseConnection,
    async get(id) {
      const row = people.get(id);
      if (!row) throw new AccessError(409, "DEMO_IDENTITY_ONLY", "Choose a fictional demo account.");
      return row;
    },
    async create(email) {
      const row = [...people.values()].find(p => p.email === email);
      if (!row) throw new Error("Only preprovisioned demo identities are allowed");
      return row;
    },
    async list() { return { users: [], nextPage: null }; },
    async rename() { throw new Error("Demo fixture cannot change identities"); },
    async verify() { throw new Error("Demo fixture cannot send email"); },
    async setup() { throw new Error("Demo fixture cannot send email"); },
  };
  let actingId = ownerId;
  registerApplication(app, db, async request => {
    request.principal = await tx.user.findUniqueOrThrow({ where: { id: actingId }, include: { membership: { include: { company: true } } } });
    request.appSession = { tokenHash: csrf, csrfToken: csrf, userId: actingId, createdAt: new Date(), expiresAt: new Date(Date.now()+60000), idleExpiresAt: new Date(Date.now()+60000), impersonatedUserId: null, impersonationExpiresAt: null, impersonationReason: null, impersonationCompanyId: null, impersonationMembershipVersion: null };
  }, origin, provider, {
    salesDemo: false,

  });
  app.setErrorHandler((error, request, reply) => reply.code(error instanceof AccessError ? error.statusCode : 500).send({ code: (error as AccessError).code || "DEMO_SEED_FAILED", step: request.routeOptions.url }));
  async function call(method: "GET" | "POST" | "PUT" | "PATCH", url: string, body?: Record<string, unknown>): Promise<any> {
    const keyed = method !== "GET" && method !== "PATCH" && !url.endsWith("/void") && (!url.endsWith("/preview") || url.startsWith("/api/company/imports/"));
    const response = await app.inject({ method, url, headers: { origin, "x-csrf-token": csrf }, ...(body ? { payload: { ...body, ...(keyed ? { submissionKey: randomUUID() } : {}) } } : {}) });
    if (response.statusCode !== 200) {
      const failure = response.json();
      console.error(JSON.stringify({ code: "DEMO_SEED_FAILED", step: failure.step, sourceCode: failure.code }));
      throw new AccessError(503, "DEMO_SEED_FAILED", `Demo setup could not finish (${failure.code}). Retry to rebuild the entire fixture.`);
    }
    return response.json();
  }
  const today = companyDay("America/New_York"), month = today.slice(0,7)+"-01";
  const offset = (months: number, day = 1) => { const d = new Date(today); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+months, day)).toISOString().slice(0,10); };
  try {
    await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    const properties = [], leases = [], residents = [], units = [];
    const managerId = accounts.users.manager.user_id, staffId = accounts.users.staff.user_id;
    for (const [id, role, name] of [[managerId, "manager", "Alex Parker · DEMO Manager"], [staffId, "staff", "Sam Ellis · DEMO Technician"]]) {
      await tx.companyMembership.create({ data: { userId: id, companyId, role, staffPropertyScope: role === "staff" ? "selected" : "all", maintenanceExecution: role === "staff" } });
    }
    for (const [index, name] of ["Maple Court · DEMO", "Harbor House · DEMO"].entries()) {
      const property = await call("POST", "/api/company/properties", { name, address: index ? "82 Harbor Avenue" : "14 Maple Lane", city: "Philadelphia", state: "PA", zip: "19106", notes: "Fictional sales demonstration property." });
      properties.push(property.id);
      for (let n=1; n<=3; n++) {
        const unit = await call("POST", `/api/company/properties/${property.id}/units`, { label: `Apartment ${n}`, bedrooms: n === 1 ? 1 : 2, bathrooms: "1.00", marketRent: n === 1 ? "1500.00" : "1800.00" });
        units.push(unit.id);
        if (n === 3) continue;
        const accountKey = ["resident", "resident2", "resident3", "resident4"][index*2+n-1];
        const personId = accounts.users[accountKey].user_id;
        await tx.companyMembership.create({ data: { userId: personId, companyId, role: "resident" } });
        await tx.residentPropertyAssignment.create({ data: { userId: personId, companyId, propertyId: property.id } });
        residents.push(personId);
        const lease = await call("POST", "/api/company/leases", { propertyId: property.id, unitId: unit.id, residentId: personId, startsOn: offset(-5), endsOn: offset(index === 0 && n === 2 ? 1 : 7, 20), monthlyRent: n===1 ? "1500.00" : "1800.00", status: "active", rentDueDay: 1, graceDays: 5, paymentInstructions: "DEMO ONLY · Manual sample receipts. No real money is moved." });
        leases.push(lease.id);
        for (let period=-2; period<=0; period++) {
          await call("POST", `/api/company/rent/${lease.id}/charges`, { periodOn: offset(period), dueOn: offset(period), amount: n===1 ? "1500.00" : "1800.00", memo: "DEMO monthly rent", expectedVersion: lease.version });
          if (!(index===0 && n===2 && period===0)) await call("POST", `/api/company/rent/${lease.id}/payments`, { occurredOn: offset(period, 3) > today ? today : offset(period, 3), amount: index===1 && n===1 && period===0 ? "900.00" : n===1 ? "1500.00" : "1800.00", memo: "DEMO manual rent receipt" });
        }
        const deposit = await call("POST", `/api/company/deposits/${lease.id}`, { amount: "1500.00", dueOn: offset(-5), expectedLeaseVersion: lease.version });
        await call("POST", `/api/company/deposits/${lease.id}/receipts`, { amount: "1500.00", occurredOn: offset(-5), method: "bank_transfer", memo: "DEMO refundable deposit", paymentReference: "DEMO ONLY", expectedVersion: deposit.version, expectedLeaseVersion: lease.version });
      }
    }
    await call("POST", `/api/company/rent/${leases[0]}/one-time-charges`, { category: "parking", effectiveOn: month, dueOn: month, amount: "75.00", description: "DEMO reserved parking", expectedLeaseVersion: 1 });
    const vendor = await call("POST", "/api/company/vendors", { name: "Clearwater Plumbing · DEMO", service: "Plumbing", contactName: "Sam Ellis · DEMO", email: "vendor@sales-demo.invalid", phone: "215-555-0142", notes: "Fictional contact. Do not contact." });
    const requests = [];
    for (const [index, title] of ["Kitchen faucet dripping · DEMO", "Hallway light replacement · DEMO", "Seasonal HVAC review · DEMO"].entries()) {
      const request = await call("POST", "/api/company/maintenance", { propertyId: properties[index%2], title, description: "Fictional sales demonstration work order.", priority: index===0 ? "high" : "normal", targetOn: today });
      requests.push(request.id);
    }
    const vendorSource = await call("GET", `/api/company/maintenance/${requests[0]}/vendor`);
    await call("POST", `/api/company/maintenance/${requests[0]}/vendor`, { vendorId: vendor.vendorId, vendorVersion: 1, expectedVersion: vendorSource.version });
    await tx.staffPropertyAccess.create({ data: { userId: staffId, companyId, propertyId: properties[0] } });
    for (const action of ["assign", "accept", "submit", "approve"]) {
      actingId = action === "accept" || action === "submit" ? staffId : ownerId;
      const work = await call("GET", `/api/company/work-orders/${requests[0]}`);
      await call("POST", `/api/company/work-orders/${requests[0]}/actions`, { action, expectedVersion: work.version, note: "DEMO faucet service and completion review.", ...(action === "assign" ? { assigneeId: staffId } : {}) });
    }
    actingId = ownerId;
    const expense = await call("POST", "/api/company/finances", { propertyId: properties[0], occurredOn: today, amount: "185.00", kind: "expense", category: "repairs", memo: "DEMO faucet repair paid manually" });
    await call("POST", `/api/company/maintenance/${requests[0]}/costs`, { entryId: expense.id, expectedEntryVersion: expense.version });
    const plan = await call("POST", "/api/company/preventive", { title: "Monthly safety inspection · DEMO", description: "Fictional smoke detector and common area check.", category: "safety", priority: "normal", propertyId: properties[0], unitId: null, cadence: "monthly", timezone: "America/New_York", anchorOn: today, endOn: null });
    const inspection = await call("POST", `/api/company/leases/${leases[0]}/inspections`, { kind: "move_in", inspectedOn: today, baselineRevisionId: null, items: [{ key: randomUUID(), area: "Kitchen", item: "Countertop", condition: "good", notes: "DEMO observed condition", evidenceVersionIds: [] }] });
    const inspectionId = inspection.inspectionId;
    actingId = managerId;
    await call("POST", `/api/company/leases/${leases[0]}/inspections/${inspectionId}`, { action: "submit", expectedVersion: 1 });
    actingId = ownerId;
    const file = await call("POST", `/api/company/leases/${leases[0]}/documents`, { title: "Unsigned sample agreement · DEMO", filename: "demo-agreement.txt", mediaType: "text/plain", contentBase64: Buffer.from("FICTIONAL SALES DEMO ONLY. Unsigned sample agreement. No legal effect.").toString("base64") });
    const context = await call("GET", `/api/company/leases/${leases[0]}/agreements/context`);
    const agreement = await call("POST", `/api/company/leases/${leases[0]}/agreements`, { title: "Lease preparation · DEMO", kind: "lease", notes: "Fictional unsigned preparation. The sample original is not scanned for malware.", documentVersionIds: [], partyIds: context.leaseholders.map((p: { id: string }) => p.id), companySignerId: ownerId });
    await call("PUT", `/api/company/units/${units[2]}/availability`, { expectedVersion: null, condition: "ready", availableOn: today, reason: "DEMO owner-reviewed vacancy and readiness." });
    await call("PUT", `/api/company/units/${units[5]}/availability`, { expectedVersion: null, condition: "turnover", availableOn: offset(1), reason: "DEMO turnover in progress." });
    await call("POST", `/api/company/units/${units[2]}/rental-listing`, { forRent: true, expectedVersion: null, expectedAvailabilityVersion: 1, reason: "DEMO explicit owner listing intent." });
    const prospect = (await call("POST", "/api/company/prospects", { propertyId: properties[0], unitId: units[2], name: "Morgan Lee · DEMO", email: "prospect@sales-demo.invalid", source: "referral", desiredMoveIn: offset(1), followUpOn: today, notes: "Fictional sales inquiry.", reason: "DEMO inquiry intake." })).prospect;
    const followUp = await call("POST", `/api/company/prospects/${prospect.id}/follow-ups`, { kind: "tour", title: "Apartment tour · DEMO", dueOn: today, notes: "Fictional tour follow-up." });
    const application = await call("POST", "/api/company/applications", { prospectId: prospect.id, unitId: units[2], notes: "DEMO application ready for manual review. No screening provider.", expectedProspectVersion: prospect.version });
    const savedTask = await call("POST", "/api/company/task-drafts", { kind: "lease_create", propertyId: properties[0], sourceId: null, values: { unitId: units[2], startsOn: offset(1), endsOn: offset(13), monthlyRent: "1650.00", status: "draft", paymentInstructions: "DEMO saved task, not a submitted lease." }, context: {} });
    const schedule = await call("POST", `/api/company/rent/${leases[0]}/schedules`, { firstPeriodOn: offset(1), firstDueOn: offset(1), leadDays: 0, expectedVersion: 1 });
    const renewal = await call("POST", "/api/company/leases", { propertyId: properties[0], unitId: units[1], residentId: residents[1], previousLeaseId: leases[1], expectedPreviousVersion: 1, startsOn: offset(1,21), endsOn: offset(13,20), monthlyRent: "1850.00", status: "draft", paymentInstructions: "DEMO renewal awaiting review." });
    const termBody = { effectiveOn: offset(2), monthlyRent: "1550.00", rentDueDay: 1, graceDays: 5, paymentInstructions: "DEMO future agreed terms.", reason: "DEMO reviewed future rent adjustment.", expectedLeaseVersion: 1 };
    const termPreview = await call("POST", `/api/company/leases/${leases[0]}/terms/preview`, termBody);
    await call("POST", `/api/company/leases/${leases[0]}/terms`, { ...termBody, sourceHash: termPreview.sourceHash, confirmed: true });
    const occupant = accounts.users.occupant;
    await tx.companyMembership.create({ data: { userId: occupant.user_id, companyId, role: "resident" } });
    await call("POST", `/api/company/leases/${leases[0]}/participants`, { userId: occupant.user_id, name: occupant.name, email: occupant.email, role: "occupant", startsOn: offset(-5), endsOn: null, portalApproved: true });
    const pendingWork = await call("GET", `/api/company/work-orders/${requests[2]}`);
    await call("POST", `/api/company/work-orders/${requests[2]}/actions`, { action: "assign", assigneeId: staffId, expectedVersion: pendingWork.version, note: "DEMO upcoming seasonal service." });
    actingId = accounts.users.resident.user_id;
    const residentRequest = await call("POST", "/api/resident/maintenance", { propertyId: properties[0], title: "Bedroom window draft · DEMO", description: "Fictional resident request for the shared maintenance timeline.", priority: "normal" });
    actingId = ownerId;
    requests.push(residentRequest.id);
    const scenarios = await seedDemoScenarios({ call, tx, companyId, accounts, today, offset, properties, units, leases, requests, asActor: id => { actingId = id; } });
    return { today, properties, units, leases, residents, occupantId: occupant.user_id, managerId, staffId, requests, vendorId: vendor.vendorId, preventivePlanId: plan.planId, inspectionId, agreementId: agreement.agreementId, documentId: file.documentId, documentVersionId: file.versionId, prospectId: prospect.id, followUpId: followUp.id, applicationId: application.id, savedTaskId: savedTask.id, scheduleId: schedule.id, renewalId: renewal.id, scenarios };
  } finally { await app.close(); }
}
