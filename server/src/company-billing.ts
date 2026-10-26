import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessError, companyScope, requirePermission } from "./access.js";
import { assignmentId, serializable } from "./application.js";
import { audit, boundedText, cents, choice, conflict, date, input, mutation, sameSubmission, submission, version, type Tx } from "./operational.js";
import { FEATURE_CATALOG, effectiveFeatures } from "./company-features.js";
import { companyDay } from "./reports.js";

// Company subscriptions are a separate receivable from customers' rent, cash
// ledgers and deposits. Nothing in this module initiates a payment or sends mail.
const access = { membership: { include: { company: true } } } as const;
const isoDay = (value: Date) => value.toISOString().slice(0, 10);
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const notFound = () => new AccessError(404, "NOT_FOUND", "Billing record not found.");
const optionalText = (value: unknown, max: number, label: string) => value === undefined || value === null || value === "" ? null : boundedText(value, max, label);
function email(value: unknown) {
  const result = optionalText(value, 254, "Billing email");
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new AccessError(400, "INVALID_INPUT", "Enter a valid billing email address.");
  return result?.toLowerCase() ?? null;
}
function instant(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new AccessError(400, "INVALID_INPUT", `Choose a valid ${label}.`);
  return new Date(value);
}
function featureKeys(value: unknown) {
  if (!Array.isArray(value) || value.some(key => typeof key !== "string" || !FEATURE_CATALOG.some(feature => feature.key === key)) || new Set(value).size !== value.length)
    throw new AccessError(400, "INVALID_INPUT", "Choose implemented features without duplicates.");
  return FEATURE_CATALOG.filter(feature => value.includes(feature.key)).map(feature => feature.key);
}
function overrides(value: unknown) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.entries(value).some(([key, mode]) => !FEATURE_CATALOG.some(feature => feature.key === key) || !["enabled", "read_only", "disabled"].includes(String(mode))))
    throw new AccessError(400, "INVALID_INPUT", "Choose valid feature override settings.");
  return Object.fromEntries(FEATURE_CATALOG.filter(feature => Object.hasOwn(value, feature.key)).map(feature => [feature.key, (value as Record<string, string>)[feature.key]]));
}
function cursor(request: FastifyRequest) {
  const query = request.query as Record<string, unknown>;
  if (Object.keys(query).some(key => key !== "cursor")) throw new AccessError(400, "INVALID_INPUT", "Choose a valid billing page.");
  return query.cursor === undefined ? undefined : assignmentId(query.cursor);
}
function period(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(value)) throw new AccessError(400, "INVALID_INPUT", "Choose a billing month as YYYY-MM.");
  const start = date(`${value}-01`, "billing period"), end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}
function planDto(row: any) {
  return { id: row.id, name: row.name, version: row.version, currency: row.currency, monthlyPriceCents: row.monthlyPriceCents, features: row.features, archivedAt: row.archivedAt, createdAt: row.createdAt };
}
function subscriptionDto(row: any, platform: boolean) {
  if (!row) return null;
  return {
    companyId: row.companyId, version: row.version, planId: row.planId, status: row.status,
    trialEndsAt: row.trialEndsAt, billingEmail: row.billingEmail, currentPeriodStart: row.currentPeriodStart, currentPeriodEnd: row.currentPeriodEnd,
    featureOverrides: row.featureOverrides, overrideExpiresAt: row.overrideExpiresAt,
    ...(platform ? { overrideReason: row.overrideReason } : {}),
    updatedAt: row.updatedAt, plan: row.plan ? planDto(row.plan) : null,
  };
}
const invoiceSelect = {
  id: true, companyId: true, number: true, billingName: true, billingEmail: true, billingAddress: true,
  planName: true, planVersion: true, monthlyPriceCents: true, periodStart: true, periodEnd: true,
  issuedAt: true, dueOn: true, status: true, version: true,
} as const;
type InvoiceRow = Prisma.SaaSInvoiceGetPayload<{ select: typeof invoiceSelect }>;

export function registerCompanyBilling(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string) {
  const auth = { preValidation: authenticate };
  function platform(request: FastifyRequest) { requirePermission(request.principal!, "platform.manage"); }
  function ownerCompany(request: FastifyRequest) {
    return companyScope(request.principal!, "subscription.read", request.headers["x-company-id"]);
  }
  function checked<T>(request: FastifyRequest, companyId: string | null, write: boolean, platformOnly: boolean, run: (tx: Tx) => Promise<T>) {
    if (platformOnly) platform(request); else ownerCompany(request);
    return serializable(db, async tx => {
      const actorId = request.principal!.id;
      if (write) await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${actorId} RETURNING id`;
      else await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actorId} FOR SHARE`;
      const actor = await tx.user.findUnique({ where: { id: actorId }, include: access });
      if (!actor) throw new AccessError(403, "ACCESS_DENIED", "Access is unavailable.");
      if (platformOnly) requirePermission(actor, "platform.manage");
      else companyScope(actor, "subscription.read", companyId);
      if (companyId) {
        if (write) await tx.$queryRaw`UPDATE "Company" SET "updatedAt"="updatedAt" WHERE id=${companyId} RETURNING id`;
        else await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId} FOR SHARE`;
        const company = await tx.company.findUnique({ where: { id: companyId }, select: { id: true, status: true } });
        if (!company) throw new AccessError(404, "NOT_FOUND", "Company not found.");
        if (write && company.status === "deleted") throw new AccessError(409, "COMPANY_DELETED", "This company was deleted. Billing history is read-only.");
        await tx.$queryRaw`SELECT set_config('app.company_id',${companyId},true)`;
      }
      return run(tx);
    });
  }
  async function subscriptionView(tx: Tx, companyId: string, isPlatform: boolean) {
    const sub = await tx.companySubscription.findUnique({ where: { companyId }, include: { plan: true } });
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const plans = isPlatform ? (await tx.platformPlan.findMany({ orderBy: [{ name: "asc" }, { version: "desc" }] })).map(planDto) : undefined;
    return { subscription: subscriptionDto(sub, isPlatform), ...(isPlatform ? { plans, billingProfile: {
      name: company.legalName || company.name, email: sub?.billingEmail || company.contactEmail,
      companyVersion: company.version,
      address: { addressLine1: company.addressLine1, addressLine2: company.addressLine2, city: company.city, region: company.region, postalCode: company.postalCode, country: company.country },
    } } : {}), catalog: FEATURE_CATALOG, effectiveFeatures: effectiveFeatures(sub), collectionMode: "manual" };
  }
  async function payments(tx: Tx, companyId: string, invoiceIds: string[]) {
    if (!invoiceIds.length) return [];
    const rows = await tx.saaSPayment.findMany({ where: { companyId, invoiceId: { in: invoiceIds } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const reversals = await tx.saaSPaymentReversal.findMany({ where: { companyId, paymentId: { in: rows.map(row => row.id) } } });
    return rows.map(row => ({ id: row.id, invoiceId: row.invoiceId, amountCents: row.amountCents, receivedOn: row.receivedOn, paymentReference: row.paymentReference, createdAt: row.createdAt, reversal: reversals.find(reversal => reversal.paymentId === row.id) ?? null }));
  }
  function invoiceDto(row: InvoiceRow, receipts: Awaited<ReturnType<typeof payments>>, detail = false) {
    const paidCents = receipts.filter(payment => payment.invoiceId === row.id && !payment.reversal).reduce((total, payment) => total + payment.amountCents, 0);
    return {
      ...row, ...(detail ? {} : { billingAddress: undefined }), currency: "USD", reference: `INV-${String(row.number).padStart(6, "0")}`,
      paidCents, balanceCents: row.status === "void" ? 0 : row.monthlyPriceCents - paidCents,
      paymentState: row.status === "void" ? "void" : paidCents >= row.monthlyPriceCents ? "paid" : paidCents ? "partially_paid" : "unpaid",
    };
  }
  async function invoiceDetail(tx: Tx, companyId: string, invoiceId: string) {
    const invoice = await tx.saaSInvoice.findFirst({ where: { companyId, id: invoiceId }, select: invoiceSelect });
    if (!invoice) throw notFound();
    const receipts = await payments(tx, companyId, [invoiceId]);
    const events = await tx.saaSInvoiceEvent.findMany({ where: { companyId, invoiceId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, action: true, detail: true, createdAt: true } });
    return { invoice: invoiceDto(invoice, receipts, true), payments: receipts.map(row => ({
      id: row.id, amountCents: row.amountCents, receivedOn: row.receivedOn,
      paymentReference: row.paymentReference, createdAt: row.createdAt,
      reversal: row.reversal ? { id: row.reversal.id, reason: row.reversal.reason, createdAt: row.reversal.createdAt } : null,
    })), events };
  }
  async function listInvoices(tx: Tx, companyId: string, after?: string) {
    const invoices = await tx.saaSInvoice.findMany({ where: { companyId, ...(after ? { id: { lt: after } } : {}) }, select: invoiceSelect, orderBy: { id: "desc" }, take: 51 });
    const receipts = await payments(tx, companyId, invoices.map(row => row.id));
    const issued = await tx.saaSInvoice.aggregate({ where: { companyId, status: "issued" }, _sum: { monthlyPriceCents: true } });
    const allPayments = await tx.saaSPayment.aggregate({ where: { companyId, invoice: { status: "issued" }, reversal: null }, _sum: { amountCents: true } });
    const total = await tx.saaSInvoice.count({ where: { companyId } });
    return { items: invoices.slice(0, 50).map(row => invoiceDto(row, receipts)), nextCursor: invoices.length > 50 ? invoices[49].id : null, total, totalOutstandingCents: (issued._sum.monthlyPriceCents ?? 0) - (allPayments._sum.amountCents ?? 0) };
  }
  async function receipt(tx: Tx, companyId: string, invoiceId: string, key: { submissionKey: string; submissionHash: string }) {
    const stored = await tx.saaSInvoiceEvent.findUnique({ where: { companyId_submissionKey: { companyId, submissionKey: key.submissionKey } } });
    if (!stored) return false;
    sameSubmission(stored.submissionHash!, key.submissionHash);
    if (stored.invoiceId !== invoiceId) throw new AccessError(409, "SUBMISSION_MISMATCH", "This submission belongs to another invoice.");
    return true;
  }
  async function event(tx: Tx, request: FastifyRequest, companyId: string, invoiceId: string, action: string, key: { submissionKey: string; submissionHash: string }, detail: Prisma.InputJsonValue) {
    await tx.saaSInvoiceEvent.create({ data: { companyId, invoiceId, action, detail, ...key, createdById: request.principal!.id } });
    await audit(tx, request, companyId, invoiceId, `subscription.${action}`, detail);
  }
  async function currentInvoice(tx: Tx, companyId: string, invoiceId: string, expectedVersion: number) {
    const row = await tx.saaSInvoice.findFirst({ where: { companyId, id: invoiceId }, select: invoiceSelect });
    if (!row) throw notFound();
    if (row.version !== expectedVersion) throw conflict();
    if (row.status !== "issued") throw new AccessError(409, "INVOICE_VOID", "This invoice is void. Issue a replacement invoice if needed.");
    return row;
  }

  server.get("/api/platform/plans", auth, request => checked(request, null, false, true, async tx => ({ items: (await tx.platformPlan.findMany({ orderBy: [{ name: "asc" }, { version: "desc" }] })).map(planDto), catalog: FEATURE_CATALOG })));
  server.post("/api/platform/plans", auth, request => {
    platform(request); mutation(request, origin);
    const body = input(request, ["name", "monthlyPrice", "features", "submissionKey"]);
    const payload = { name: boundedText(body.name, 100, "Plan name"), monthlyPriceCents: cents(body.monthlyPrice), features: featureKeys(body.features) }, key = submission(body.submissionKey, payload);
    return checked(request, null, true, true, async tx => {
      const previous = await tx.platformPlan.findUnique({ where: { createdById_submissionKey: { createdById: request.principal!.id, submissionKey: key.submissionKey } } });
      if (previous) { sameSubmission(previous.submissionHash, key.submissionHash); return planDto(previous); }
      // Serialize publications sharing a plan name, including their first version.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${payload.name}))::text`;
      const latest = await tx.platformPlan.findFirst({ where: { name: payload.name }, orderBy: { version: "desc" } });
      const row = await tx.platformPlan.create({ data: { ...payload, ...key, version: (latest?.version ?? 0) + 1, createdById: request.principal!.id } });
      await tx.auditEvent.create({ data: { actorId: request.principal!.id, action: "subscription.plan.published", targetId: row.id, requestId: request.id, detail: { name: row.name, version: row.version, monthlyPriceCents: row.monthlyPriceCents, features: row.features } } });
      return planDto(row);
    });
  });
  server.patch<{ Params: { planId: string } }>("/api/platform/plans/:planId/archive", auth, request => {
    platform(request); mutation(request, origin);
    const body = input(request, ["archived", "expectedArchivedAt"]), id = assignmentId(request.params.planId);
    if (typeof body.archived !== "boolean" || body.expectedArchivedAt !== null && (typeof body.expectedArchivedAt !== "string" || !Number.isFinite(Date.parse(body.expectedArchivedAt)))) throw new AccessError(400, "INVALID_INPUT", "Submit the current plan availability before changing it.");
    return checked(request, null, true, true, async tx => {
      await tx.$queryRaw`SELECT id FROM "PlatformPlan" WHERE id=${id} FOR UPDATE`;
      const row = await tx.platformPlan.findUnique({ where: { id } });
      if (!row) throw new AccessError(404, "NOT_FOUND", "Plan not found.");
      if (!!row.archivedAt === body.archived) return planDto(row);
      if ((row.archivedAt?.toISOString() ?? null) !== body.expectedArchivedAt) throw conflict();
      const updated = await tx.platformPlan.update({ where: { id }, data: { archivedAt: body.archived ? new Date() : null } });
      await tx.auditEvent.create({ data: { actorId: request.principal!.id, action: body.archived ? "subscription.plan.archived" : "subscription.plan.restored", targetId: id, requestId: request.id } });
      return planDto(updated);
    });
  });
  server.get<{ Params: { companyId: string } }>("/api/platform/companies/:companyId/subscription", auth, request => checked(request, assignmentId(request.params.companyId), false, true, tx => subscriptionView(tx, request.params.companyId, true)));
  server.get("/api/company/subscription", auth, request => { const companyId = ownerCompany(request); return checked(request, companyId, false, false, tx => subscriptionView(tx, companyId, false)); });
  server.get<{ Params: { companyId: string } }>("/api/platform/companies/:companyId/subscription/history", auth, request => {
    const companyId = assignmentId(request.params.companyId), after = cursor(request);
    return checked(request, companyId, false, true, async tx => {
      const rows = await tx.companySubscriptionRevision.findMany({ where: { companyId, ...(after ? { id: { lt: after } } : {}) }, select: { id: true, version: true, snapshot: true, reason: true, actorId: true, createdAt: true }, orderBy: { id: "desc" }, take: 51 });
      return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  });
  server.put<{ Params: { companyId: string } }>("/api/platform/companies/:companyId/subscription", auth, request => {
    platform(request); mutation(request, origin);
    const companyId = assignmentId(request.params.companyId), body = input(request, ["expectedVersion", "planId", "status", "trialEndsAt", "billingEmail", "featureOverrides", "overrideReason", "overrideExpiresAt", "reason", "submissionKey"]);
    const expectedVersion = body.expectedVersion === null ? null : version(body.expectedVersion);
    const payload = {
      expectedVersion, planId: body.planId === null || body.planId === "" ? null : assignmentId(body.planId),
      status: choice(body.status, ["trial", "active", "expired", "suspended", "cancelled"], "subscription status"),
      trialEndsAt: instant(body.trialEndsAt, "trial end"), billingEmail: email(body.billingEmail), featureOverrides: overrides(body.featureOverrides),
      overrideReason: optionalText(body.overrideReason, 500, "Override reason"), overrideExpiresAt: instant(body.overrideExpiresAt, "override expiry"), reason: boundedText(body.reason, 500, "Change reason"),
    };
    if (Object.keys(payload.featureOverrides).length && !payload.overrideReason) throw new AccessError(400, "INVALID_INPUT", "Explain why this company needs feature overrides.");
    if (!Object.keys(payload.featureOverrides).length) { payload.overrideReason = null; payload.overrideExpiresAt = null; }
    const key = submission(body.submissionKey, payload);
    return checked(request, companyId, true, true, async tx => {
      const previous = await tx.companySubscriptionRevision.findUnique({ where: { companyId_submissionKey: { companyId, submissionKey: key.submissionKey } } });
      if (previous) { sameSubmission(previous.submissionHash, key.submissionHash); return subscriptionView(tx, companyId, true); }
      if (payload.status === "trial" && (!payload.trialEndsAt || payload.trialEndsAt.getTime() <= Date.now())) throw new AccessError(400, "INVALID_INPUT", "A trial must have a future end date.");
      if (payload.overrideExpiresAt && payload.overrideExpiresAt.getTime() <= Date.now()) throw new AccessError(400, "INVALID_INPUT", "Choose a future feature-override expiry.");
      const current = await tx.companySubscription.findUnique({ where: { companyId } });
      if ((current?.version ?? null) !== expectedVersion) throw conflict();
      if (payload.planId) {
        await tx.$queryRaw`SELECT id FROM "PlatformPlan" WHERE id=${payload.planId} FOR SHARE`;
        const plan = await tx.platformPlan.findUnique({ where: { id: payload.planId } });
        if (!plan || plan.archivedAt && current?.planId !== plan.id) throw new AccessError(409, "PLAN_UNAVAILABLE", "Choose an available published plan.");
      }
      const { expectedVersion: _, reason, ...settings } = payload;
      const next = current
        ? await tx.companySubscription.update({ where: { companyId }, data: { ...settings, version: { increment: 1 }, updatedById: request.principal!.id }, include: { plan: true } })
        : await tx.companySubscription.create({ data: { companyId, ...settings, updatedById: request.principal!.id }, include: { plan: true } });
      await tx.companySubscriptionRevision.create({ data: { companyId, version: next.version, snapshot: json(subscriptionDto(next, true)), reason, actorId: request.principal!.id, ...key } });
      await audit(tx, request, companyId, companyId, "subscription.updated", { version: next.version, planId: next.planId, status: next.status, reason });
      return subscriptionView(tx, companyId, true);
    });
  });
  server.get<{ Params: { companyId: string } }>("/api/platform/companies/:companyId/billing", auth, request => { const id = assignmentId(request.params.companyId), after = cursor(request); return checked(request, id, false, true, tx => listInvoices(tx, id, after)); });
  server.get("/api/company/billing", auth, request => { const id = ownerCompany(request), after = cursor(request); return checked(request, id, false, false, tx => listInvoices(tx, id, after)); });
  server.get<{ Params: { companyId: string; invoiceId: string } }>("/api/platform/companies/:companyId/billing/invoices/:invoiceId", auth, request => { const id = assignmentId(request.params.companyId), invoiceId = assignmentId(request.params.invoiceId); return checked(request, id, false, true, tx => invoiceDetail(tx, id, invoiceId)); });
  server.get<{ Params: { invoiceId: string } }>("/api/company/billing/invoices/:invoiceId", auth, request => { const id = ownerCompany(request), invoiceId = assignmentId(request.params.invoiceId); return checked(request, id, false, false, tx => invoiceDetail(tx, id, invoiceId)); });
  server.post<{ Params: { companyId: string } }>("/api/platform/companies/:companyId/billing/invoices", auth, request => {
    platform(request); mutation(request, origin);
    const companyId = assignmentId(request.params.companyId), body = input(request, ["period", "dueOn", "expectedSubscriptionVersion", "expectedCompanyVersion", "submissionKey"]), month = period(body.period), dueOn = date(body.dueOn, "invoice due date");
    const expectedSubscriptionVersion = version(body.expectedSubscriptionVersion), expectedCompanyVersion = version(body.expectedCompanyVersion);
    if (dueOn < month.start) throw new AccessError(400, "INVALID_INPUT", "The due date cannot precede the billing month.");
    const key = submission(body.submissionKey, { period: body.period, dueOn: isoDay(dueOn), expectedSubscriptionVersion, expectedCompanyVersion });
    return checked(request, companyId, true, true, async tx => {
      const previous = await tx.saaSInvoice.findUnique({ where: { companyId_submissionKey: { companyId, submissionKey: key.submissionKey } } });
      if (previous) { sameSubmission(previous.submissionHash, key.submissionHash); return invoiceDetail(tx, companyId, previous.id); }
      const sub = await tx.companySubscription.findUnique({ where: { companyId }, include: { plan: true } });
      if (!sub?.plan || sub.status !== "active") throw new AccessError(409, "BILLING_NOT_CONFIGURED", "Assign an active monthly plan before issuing an invoice. Trial and unavailable subscriptions are not billed.");
      const exists = await tx.saaSInvoice.findFirst({ where: { companyId, periodStart: month.start, status: "issued" } });
      if (exists) throw new AccessError(409, "PERIOD_ALREADY_INVOICED", "This company already has an issued invoice for that month. Review the existing invoice.");
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      if (sub.version !== expectedSubscriptionVersion || company.version !== expectedCompanyVersion)
        throw new AccessError(409, "BILLING_REVIEW_CHANGED", "The company billing details or assigned plan changed. Reload and review the invoice before issuing it.");
      const invoice = await tx.saaSInvoice.create({ data: {
        companyId, billingName: company.legalName || company.name, billingEmail: sub.billingEmail || company.contactEmail,
        billingAddress: json({ addressLine1: company.addressLine1, addressLine2: company.addressLine2, city: company.city, region: company.region, postalCode: company.postalCode, country: company.country }),
        planName: sub.plan.name, planVersion: sub.plan.version, monthlyPriceCents: sub.plan.monthlyPriceCents,
        periodStart: month.start, periodEnd: month.end, dueOn, ...key, createdById: request.principal!.id,
      } });
      await event(tx, request, companyId, invoice.id, "invoice.issued", key, { number: invoice.number, planId: sub.plan.id, periodStart: isoDay(month.start), periodEnd: isoDay(month.end), monthlyPriceCents: invoice.monthlyPriceCents });
      return invoiceDetail(tx, companyId, invoice.id);
    });
  });
  server.post<{ Params: { companyId: string; invoiceId: string } }>("/api/platform/companies/:companyId/billing/invoices/:invoiceId/void", auth, request => {
    platform(request); mutation(request, origin);
    const companyId = assignmentId(request.params.companyId), invoiceId = assignmentId(request.params.invoiceId), body = input(request, ["expectedVersion", "reason", "submissionKey"]);
    const payload = { action: "void", invoiceId, expectedVersion: version(body.expectedVersion), reason: boundedText(body.reason, 500, "Void reason") }, key = submission(body.submissionKey, payload);
    return checked(request, companyId, true, true, async tx => {
      if (await receipt(tx, companyId, invoiceId, key)) return invoiceDetail(tx, companyId, invoiceId);
      const invoice = await currentInvoice(tx, companyId, invoiceId, payload.expectedVersion), receipts = await payments(tx, companyId, [invoiceId]);
      if (receipts.some(row => !row.reversal)) throw new AccessError(409, "INVOICE_HAS_PAYMENTS", "Reverse recorded receipts before voiding this invoice. Voiding does not refund money.");
      await tx.saaSInvoice.update({ where: { id: invoiceId, companyId }, data: { status: "void", version: { increment: 1 } } });
      await event(tx, request, companyId, invoiceId, "invoice.voided", key, { reason: payload.reason, number: invoice.number });
      return invoiceDetail(tx, companyId, invoiceId);
    });
  });
  server.post<{ Params: { companyId: string; invoiceId: string } }>("/api/platform/companies/:companyId/billing/invoices/:invoiceId/payments", auth, request => {
    platform(request); mutation(request, origin);
    const companyId = assignmentId(request.params.companyId), invoiceId = assignmentId(request.params.invoiceId), body = input(request, ["amount", "receivedOn", "paymentReference", "expectedVersion", "submissionKey"]);
    const payload = { action: "payment", invoiceId, amountCents: cents(body.amount), receivedOn: date(body.receivedOn, "received date"), paymentReference: boundedText(body.paymentReference, 200, "Payment evidence/reference"), expectedVersion: version(body.expectedVersion) }, key = submission(body.submissionKey, payload);
    if (!payload.amountCents) throw new AccessError(400, "INVALID_INPUT", "Record a positive amount actually received.");
    return checked(request, companyId, true, true, async tx => {
      if (await receipt(tx, companyId, invoiceId, key)) return invoiceDetail(tx, companyId, invoiceId);
      const invoice = await currentInvoice(tx, companyId, invoiceId, payload.expectedVersion), receipts = await payments(tx, companyId, [invoiceId]);
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } });
      if (isoDay(payload.receivedOn) > companyDay(company.timezone)) throw new AccessError(400, "INVALID_INPUT", "A receipt date cannot be in the future in the company's timezone.");
      const outstanding = invoice.monthlyPriceCents - receipts.filter(row => !row.reversal).reduce((sum, row) => sum + row.amountCents, 0);
      if (payload.amountCents > outstanding) throw new AccessError(409, "PAYMENT_EXCEEDS_BALANCE", "The recorded receipt cannot exceed this invoice's outstanding balance.");
      const row = await tx.saaSPayment.create({ data: { companyId, invoiceId, amountCents: payload.amountCents, receivedOn: payload.receivedOn, paymentReference: payload.paymentReference, ...key, createdById: request.principal!.id } });
      await tx.saaSInvoice.update({ where: { id: invoiceId, companyId }, data: { version: { increment: 1 } } });
      await event(tx, request, companyId, invoiceId, "payment.recorded", key, { paymentId: row.id, amountCents: row.amountCents, receivedOn: isoDay(row.receivedOn) });
      return invoiceDetail(tx, companyId, invoiceId);
    });
  });
  server.post<{ Params: { companyId: string; invoiceId: string; paymentId: string } }>("/api/platform/companies/:companyId/billing/invoices/:invoiceId/payments/:paymentId/reverse", auth, request => {
    platform(request); mutation(request, origin);
    const companyId = assignmentId(request.params.companyId), invoiceId = assignmentId(request.params.invoiceId), paymentId = assignmentId(request.params.paymentId), body = input(request, ["expectedVersion", "reason", "submissionKey"]);
    const payload = { action: "reverse", invoiceId, paymentId, expectedVersion: version(body.expectedVersion), reason: boundedText(body.reason, 500, "Correction reason") }, key = submission(body.submissionKey, payload);
    return checked(request, companyId, true, true, async tx => {
      if (await receipt(tx, companyId, invoiceId, key)) return invoiceDetail(tx, companyId, invoiceId);
      await currentInvoice(tx, companyId, invoiceId, payload.expectedVersion);
      const payment = await tx.saaSPayment.findFirst({ where: { companyId, invoiceId, id: paymentId } });
      if (!payment) throw notFound();
      if (await tx.saaSPaymentReversal.findFirst({ where: { companyId, paymentId } })) throw new AccessError(409, "PAYMENT_ALREADY_REVERSED", "This receipt already has a recorded correction.");
      await tx.saaSPaymentReversal.create({ data: { companyId, paymentId, reason: payload.reason, ...key, createdById: request.principal!.id } });
      await tx.saaSInvoice.update({ where: { id: invoiceId, companyId }, data: { version: { increment: 1 } } });
      await event(tx, request, companyId, invoiceId, "payment.reversed", key, { paymentId, amountCents: payment.amountCents, reason: payload.reason });
      return invoiceDetail(tx, companyId, invoiceId);
    });
  });
}
