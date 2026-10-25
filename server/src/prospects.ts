import type { FastifyInstance, preValidationHookHandler } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { audit, boundedText, choice, conflict, date, input, mutation, sameSubmission, scoped, submission, version, type Tx } from "./operational.js";
import { companyDay } from "./reports.js";
import { requireContactAccount } from "./resident-accounts.js";
import { lockUnit } from "./leasing.js";

export const PROSPECT_STAGES = ["inquiry", "tour", "application", "review", "approved", "declined", "withdrawn", "converted"] as const;
const editableStages = PROSPECT_STAGES.filter(stage => stage !== "converted");
const fields = ["unitId", "name", "email", "phone", "source", "desiredMoveIn", "followUpOn", "notes"];
const prospectSelect = {
  id: true, companyId: true, propertyId: true, unitId: true, name: true, email: true, phone: true,
  source: true, desiredMoveIn: true, followUpOn: true, notes: true, stage: true, version: true,
  contactId: true, leaseId: true, createdAt: true, updatedAt: true,
  property: { select: { id: true, name: true } }, unit: { select: { id: true, label: true } },
} as const;
const optionalText = (value: unknown, max: number, label: string) => value == null || value === "" ? null : boundedText(value, max, label);
const optionalDate = (value: unknown, label: string) => value == null || value === "" ? null : date(value, label);
function details(body: Record<string, unknown>) {
  const email = optionalText(body.email, 254, "Email")?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccessError(400, "INVALID_INPUT", "Enter a valid contact email.");
  const phone = optionalText(body.phone, 40, "Phone");
  if (!email && !phone) throw new AccessError(400, "CONTACT_REQUIRED", "Record an email address or phone number for the inquiry.");
  return {
    unitId: body.unitId == null || body.unitId === "" ? null : assignmentId(body.unitId),
    name: boundedText(body.name, 200, "Prospect name"), email, phone,
    source: choice(body.source, ["phone", "email", "walk_in", "referral", "other"], "inquiry source"),
    desiredMoveIn: optionalDate(body.desiredMoveIn, "desired move-in date"),
    followUpOn: optionalDate(body.followUpOn, "follow-up date"),
    notes: optionalText(body.notes, 2000, "Operational notes"),
  };
}
function queryValues(query: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(query).some(key => !allowed.includes(key))) throw new AccessError(400, "INVALID_INPUT", "Choose valid prospect filters.");
  if (query.q !== undefined && (typeof query.q !== "string" || query.q.length > 200 || query.q.includes("\0"))) throw new AccessError(400, "INVALID_INPUT", "Search must be at most 200 characters.");
  return { q: typeof query.q === "string" ? query.q.trim() : "", cursor: query.cursor === undefined ? null : assignmentId(query.cursor) };
}
const converted = () => new AccessError(409, "PROSPECT_CONVERTED", "This prospect is linked to a tenant and lease. Review or correct the actual source records; the original conversion history is retained.");
async function prospect(tx: Tx, companyId: string, id: string, lock = false) {
  if (lock) await tx.$queryRaw`UPDATE "Prospect" SET "updatedAt"="updatedAt" WHERE id=${id} AND "companyId"=${companyId} RETURNING id`;
  const row = await tx.prospect.findFirst({ where: { id, companyId }, select: prospectSelect });
  if (!row) throw new AccessError(404, "NOT_FOUND", "Prospect not found.");
  return row;
}
async function target(tx: Tx, companyId: string, propertyId: string, unitId: string | null) {
  if (!await tx.property.findFirst({ where: { id: propertyId, companyId }, select: { id: true } })) throw new AccessError(404, "NOT_FOUND", "Property not found.");
  if (unitId && !await tx.unit.findFirst({ where: { id: unitId, propertyId, companyId, status: "active" }, select: { id: true } })) throw new AccessError(409, "UNIT_UNAVAILABLE", "Choose an active unit in the selected property.");
}
async function receipt(tx: Tx, companyId: string, key: { submissionKey: string; submissionHash: string }, id?: string) {
  const old = await tx.prospectAction.findUnique({ where: { companyId_submissionKey: { companyId, submissionKey: key.submissionKey } }, select: { prospectId: true, submissionHash: true } });
  if (!old) return null;
  sameSubmission(old.submissionHash, key.submissionHash);
  if (id && old.prospectId !== id) throw new AccessError(409, "SUBMISSION_MISMATCH", "This submission belongs to another prospect.");
  return { prospect: await prospect(tx, companyId, old.prospectId) };
}
async function history(tx: Tx, companyId: string, id: string, cursor: string | null = null) {
  const rows = await tx.prospectAction.findMany({ where: { companyId, prospectId: id, ...(cursor ? { id: { lt: cursor } } : {}) }, select: { id: true, version: true, action: true, snapshot: true, reason: true, actorId: true, createdAt: true }, orderBy: { id: "desc" }, take: 51 });
  return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null };
}

export function registerProspects(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string) {
  const auth = { preValidation: authenticate };
  const record = async (tx: Tx, request: Parameters<typeof audit>[1], companyId: string, row: { id: string; version: number }, action: string, reason: string, key: { submissionKey: string; submissionHash: string }, extra: Prisma.InputJsonObject = {}) => {
    await tx.prospectAction.create({ data: { companyId, prospectId: row.id, version: row.version, action, snapshot: JSON.parse(JSON.stringify({ ...row, ...extra })) as Prisma.InputJsonValue, reason, actorId: request.principal!.id, ...key } });
    await audit(tx, request, companyId, row.id, `prospect.${action}`, { version: row.version, reason, ...extra });
  };

  server.get<{ Querystring: Record<string, unknown> }>("/api/company/prospects", auth, request => {
    const query = request.query, values = queryValues(query, ["propertyId", "q", "stage", "due", "cursor"]);
    const propertyId = query.propertyId === undefined ? null : assignmentId(query.propertyId);
    const stage = query.stage === undefined ? null : choice(query.stage, [...PROSPECT_STAGES], "prospect stage");
    const due = query.due === undefined ? null : choice(query.due, ["overdue", "today", "upcoming"], "follow-up view");
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } });
      const today = companyDay(company.timezone), currentDay = date(today, "company business date"), through = new Date(currentDay); through.setUTCDate(through.getUTCDate() + 7);
      if (propertyId) await target(tx, companyId, propertyId, null);
      const where: Prisma.ProspectWhereInput = {
        companyId, ...(propertyId ? { propertyId } : {}),
        ...(values.q ? { OR: [{ name: { contains: values.q, mode: "insensitive" } }, { email: { contains: values.q, mode: "insensitive" } }, { phone: { contains: values.q, mode: "insensitive" } }, { property: { name: { contains: values.q, mode: "insensitive" } } }, { unit: { label: { contains: values.q, mode: "insensitive" } } }] } : {}),
        ...(due ? { stage: { notIn: ["declined", "withdrawn", "converted"] }, followUpOn: due === "overdue" ? { lt: currentDay } : due === "today" ? currentDay : { gte: currentDay, lte: through } } : {}),
      };
      const grouped = await tx.prospect.groupBy({ by: ["stage"], where, _count: true });
      const counts = Object.fromEntries(PROSPECT_STAGES.map(value => [value, grouped.find(row => row.stage === value)?._count ?? 0])) as Record<typeof PROSPECT_STAGES[number], number>;
      const selected = stage ? { AND: [where, { stage }] } : where;
      const rows = await tx.prospect.findMany({ where: { AND: [selected, ...(values.cursor ? [{ id: { lt: values.cursor } }] : [])] }, select: prospectSelect, orderBy: { id: "desc" }, take: 51 });
      return { today, timezone: company.timezone, items: rows.slice(0, 50), counts, total: stage ? counts[stage as typeof PROSPECT_STAGES[number]] : Object.values(counts).reduce((sum, value) => sum + value, 0), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  });

  server.post("/api/company/prospects", auth, request => {
    mutation(request, origin);
    const body = input(request, ["propertyId", ...fields, "reason", "submissionKey"]), propertyId = assignmentId(body.propertyId), data = details(body), reason = boundedText(body.reason, 500, "Creation reason");
    const key = submission(body.submissionKey, { propertyId, ...data, reason });
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      await tx.$queryRaw`UPDATE "Company" SET "updatedAt"="updatedAt" WHERE id=${companyId} RETURNING id`;
      const replay = await receipt(tx, companyId, key); if (replay) return replay;
      await target(tx, companyId, propertyId, data.unitId);
      const row = await tx.prospect.create({ data: { companyId, propertyId, ...data, createdById: request.principal!.id }, select: prospectSelect });
      await record(tx, request, companyId, row, "created", reason, key);
      return { prospect: row };
    });
  });

  server.get<{ Params: { submissionKey: string } }>("/api/company/prospects/recovery/:submissionKey", auth, request => {
    const key = submission(request.params.submissionKey, {}).submissionKey;
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      const action = await tx.prospectAction.findFirst({ where: { companyId, actorId: request.principal!.id, submissionKey: key }, select: { prospectId: true } });
      const row = action ? await prospect(tx, companyId, action.prospectId) : null;
      return { companyId, receiptRecorded: !!row, prospect: row, request: { id: key, title: row?.name || "Original inquiry request", version: row?.version ?? null, status: row?.stage || "Receipt not visible", notes: row?.notes || (row ? "None" : "No matching receipt is currently visible. Stopping this browser's retry does not cancel an in-flight request.") } };
    });
  });

  server.get<{ Params: { prospectId: string } }>("/api/company/prospects/:prospectId", auth, request => {
    const id = assignmentId(request.params.prospectId);
    return scoped(db, request, "lease.manage", async (tx, companyId) => ({ prospect: await prospect(tx, companyId, id), history: await history(tx, companyId, id) }));
  });
  server.get<{ Params: { prospectId: string }; Querystring: Record<string, unknown> }>("/api/company/prospects/:prospectId/history", auth, request => {
    const id = assignmentId(request.params.prospectId), values = queryValues(request.query, ["cursor"]);
    return scoped(db, request, "lease.manage", async (tx, companyId) => { await prospect(tx, companyId, id); return history(tx, companyId, id, values.cursor); });
  });

  server.patch<{ Params: { prospectId: string } }>("/api/company/prospects/:prospectId", auth, request => {
    mutation(request, origin);
    const id = assignmentId(request.params.prospectId), body = input(request, ["expectedVersion", ...fields, "reason", "submissionKey"]), expectedVersion = version(body.expectedVersion), data = details(body), reason = boundedText(body.reason, 500, "Change reason");
    const key = submission(body.submissionKey, { id, action: "updated", expectedVersion, ...data, reason });
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      const row = await prospect(tx, companyId, id, true), replay = await receipt(tx, companyId, key, id); if (replay) return replay;
      if (row.stage === "converted") throw converted();
      if (row.version !== expectedVersion) throw conflict();
      if (await tx.rentalApplication.count({ where: { companyId, prospectId: id, leaseId: null, status: { in: ["submitted", "in_review", "approved"] } } })) throw new AccessError(409, "APPLICATION_REVIEW_ACTIVE", "Withdraw the submitted or reviewed application before changing the prospect's contact details. Its reviewed history remains retained.");
      await target(tx, companyId, row.propertyId, data.unitId);
      const updated = await tx.prospect.update({ where: { id, companyId }, data: { ...data, version: { increment: 1 } }, select: prospectSelect });
      await record(tx, request, companyId, updated, "updated", reason, key);
      return { prospect: updated };
    });
  });

  server.post<{ Params: { prospectId: string } }>("/api/company/prospects/:prospectId/stage", auth, request => {
    mutation(request, origin);
    const id = assignmentId(request.params.prospectId), body = input(request, ["expectedVersion", "stage", "reason", "submissionKey"]), expectedVersion = version(body.expectedVersion), stage = choice(body.stage, editableStages, "recorded stage"), reason = boundedText(body.reason, 500, "Decision or stage reason");
    const key = submission(body.submissionKey, { id, action: "stage", expectedVersion, stage, reason });
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      const row = await prospect(tx, companyId, id, true), replay = await receipt(tx, companyId, key, id); if (replay) return replay;
      if (row.stage === "converted") throw converted();
      if (row.version !== expectedVersion) throw conflict();
      if (["declined", "withdrawn"].includes(row.stage) && !["inquiry", "review"].includes(stage)) throw new AccessError(409, "REOPEN_REVIEW_REQUIRED", "Reopen the inquiry or review before recording another decision.");
      const updated = await tx.prospect.update({ where: { id, companyId }, data: { stage, version: { increment: 1 } }, select: prospectSelect });
      await record(tx, request, companyId, updated, "stage.changed", reason, key);
      return { prospect: updated };
    });
  });

  server.get<{ Params: { prospectId: string }; Querystring: Record<string, unknown> }>("/api/company/prospects/:prospectId/conversion-options", auth, request => {
    const id = assignmentId(request.params.prospectId), query = request.query, values = queryValues(query, ["q", "cursor", "contactId", "leaseCursor"]);
    const contactId = query.contactId === undefined ? null : assignmentId(query.contactId), leaseCursor = query.leaseCursor === undefined ? null : assignmentId(query.leaseCursor);
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      const row = await prospect(tx, companyId, id);
      if (row.stage !== "approved") throw new AccessError(409, "APPROVAL_REQUIRED", "Record an approval before reviewing an existing tenant and lease for conversion.");
      const eligible: Prisma.ResidentContactWhereInput = { companyId, status: "active", user: { status: "active", identities: { some: {} }, OR: [{ membership: null }, { membership: { companyId, role: "resident", status: "active" } }] } };
      const contacts = await tx.residentContact.findMany({ where: { ...eligible, ...(values.cursor ? { id: { lt: values.cursor } } : {}), ...(values.q ? { OR: [{ name: { contains: values.q, mode: "insensitive" } }, { email: { contains: values.q, mode: "insensitive" } }] } : {}) }, select: { id: true, name: true, email: true, version: true }, orderBy: { id: "desc" }, take: 51 });
      if (contactId && !await tx.residentContact.findFirst({ where: { ...eligible, id: contactId }, select: { id: true } })) throw new AccessError(409, "CONTACT_UNAVAILABLE", "Choose a current tenant with an existing exact sign-in account binding.");
      const leases = contactId ? await tx.lease.findMany({ where: { companyId, propertyId: row.propertyId, ...(row.unitId ? { unitId: row.unitId } : {}), residentContactId: contactId, status: { in: ["draft", "active"] }, unit: { status: "active" }, ...(leaseCursor ? { id: { lt: leaseCursor } } : {}) }, select: { id: true, version: true, propertyId: true, unitId: true, startsOn: true, endsOn: true, status: true, unit: { select: { id: true, label: true } } }, orderBy: { id: "desc" }, take: 51 }) : [];
      return { contacts: contacts.slice(0, 50), nextCursor: contacts.length > 50 ? contacts[49].id : null, leases: leases.slice(0, 50), nextLeaseCursor: leases.length > 50 ? leases[49].id : null };
    });
  });

  server.post<{ Params: { prospectId: string } }>("/api/company/prospects/:prospectId/convert", auth, request => {
    mutation(request, origin);
    const id = assignmentId(request.params.prospectId), body = input(request, ["expectedVersion", "contactId", "expectedContactVersion", "leaseId", "expectedLeaseVersion", "confirmedMatch", "reason", "submissionKey"]);
    if (body.confirmedMatch !== true) throw new AccessError(400, "MATCH_REVIEW_REQUIRED", "Confirm that the selected tenant and lease belong to this prospect. Contact email alone never establishes identity.");
    const payload = { id, action: "converted", expectedVersion: version(body.expectedVersion), contactId: assignmentId(body.contactId), expectedContactVersion: version(body.expectedContactVersion), leaseId: assignmentId(body.leaseId), expectedLeaseVersion: version(body.expectedLeaseVersion), confirmedMatch: true, reason: boundedText(body.reason, 500, "Conversion reason") };
    const key = submission(body.submissionKey, payload);
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      const row = await prospect(tx, companyId, id, true), replay = await receipt(tx, companyId, key, id); if (replay) return replay;
      if (row.stage === "converted") throw converted();
      if (row.version !== payload.expectedVersion) throw conflict();
      if (row.stage !== "approved") throw new AccessError(409, "APPROVAL_REQUIRED", "Record an approval before converting this prospect.");
      await tx.$queryRaw`UPDATE "ResidentContact" SET "updatedAt"="updatedAt" WHERE id=${payload.contactId} AND "companyId"=${companyId} RETURNING id`;
      const contact = await tx.residentContact.findFirst({ where: { id: payload.contactId, companyId, status: "active" } });
      if (!contact) throw new AccessError(404, "NOT_FOUND", "Tenant not found.");
      if (contact.version !== payload.expectedContactVersion) throw conflict();
      const userId = await requireContactAccount(tx, contact);
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR SHARE`;
      const account = await tx.user.findUnique({ where: { id: userId }, include: { membership: true } });
      if (!account || account.status !== "active" || account.membership && (account.membership.companyId !== companyId || account.membership.role !== "resident" || account.membership.status !== "active")) throw new AccessError(409, "CONTACT_UNAVAILABLE", "Review the selected tenant's current account and company access before converting.");
      await tx.$queryRaw`UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=${payload.leaseId} AND "companyId"=${companyId} RETURNING id`;
      const lease = await tx.lease.findFirst({ where: { id: payload.leaseId, companyId }, select: { id: true, version: true, propertyId: true, unitId: true, residentContactId: true, status: true } });
      if (!lease || lease.propertyId !== row.propertyId || row.unitId && lease.unitId !== row.unitId || lease.residentContactId !== contact.id) throw new AccessError(409, "LEASE_PARTY_MISMATCH", "Choose a lease for this exact tenant, property and preferred unit. No people or leases were merged.");
      if (lease.version !== payload.expectedLeaseVersion) throw conflict();
      if (!["draft", "active"].includes(lease.status)) throw new AccessError(409, "LEASE_UNAVAILABLE", "Choose a draft or active lease for the approved prospect.");
      const unit = await lockUnit(tx, companyId, lease.unitId);
      if (unit.status !== "active") throw new AccessError(409, "UNIT_ARCHIVED", "Restore the unit before linking a prospect conversion.");
      if (await tx.prospect.findFirst({ where: { companyId, leaseId: lease.id, id: { not: id } }, select: { id: true } })) throw new AccessError(409, "LEASE_ALREADY_LINKED", "This lease is already linked to another prospect. Review that source case instead of duplicating the conversion.");
      const updated = await tx.prospect.update({ where: { id, companyId }, data: { stage: "converted", contactId: contact.id, leaseId: lease.id, version: { increment: 1 } }, select: prospectSelect });
      await record(tx, request, companyId, updated, "converted", payload.reason, key, { reviewedContactVersion: contact.version, reviewedLeaseVersion: lease.version, reviewedAccountId: userId });
      return { prospect: updated };
    });
  });

  server.post<{ Params: { prospectId: string } }>("/api/company/prospects/:prospectId/reopen-conversion", auth, request => {
    mutation(request, origin);
    const id = assignmentId(request.params.prospectId), body = input(request, ["expectedVersion", "confirmedUnlink", "reason", "submissionKey"]);
    if (body.confirmedUnlink !== true) throw new AccessError(400, "UNLINK_REVIEW_REQUIRED", "Confirm that only this prospect link will be reopened. The tenant, lease and their access remain unchanged.");
    const payload = { id, action: "conversion.reopened", expectedVersion: version(body.expectedVersion), confirmedUnlink: true, reason: boundedText(body.reason, 500, "Correction reason") }, key = submission(body.submissionKey, payload);
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      const row = await prospect(tx, companyId, id, true), replay = await receipt(tx, companyId, key, id); if (replay) return replay;
      if (row.version !== payload.expectedVersion) throw conflict();
      if (row.stage !== "converted" || !row.contactId || !row.leaseId) throw new AccessError(409, "CONVERSION_REQUIRED", "Only a converted prospect can have its source link deliberately reopened.");
      const updated = await tx.prospect.update({ where: { id, companyId }, data: { stage: "review", contactId: null, leaseId: null, version: { increment: 1 } }, select: prospectSelect });
      await record(tx, request, companyId, updated, "conversion.reopened", payload.reason, key, { previousContactId: row.contactId, previousLeaseId: row.leaseId });
      return { prospect: updated };
    });
  });
}
