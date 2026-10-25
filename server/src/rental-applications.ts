import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import { Prisma, type PrismaClient, type RentalApplication } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { audit, boundedText, cents, choice, conflict, date, input, mutation, sameSubmission, scoped, submission, version, type Tx } from "./operational.js";
import { companyDay } from "./reports.js";
import { lockUnit } from "./leasing.js";
import { prepareAccount, saveAccount } from "./resident-accounts.js";
import type { IdentityProvider } from "./identity-provider.js";
import { paymentPolicyPatch } from "./payment-policy.js";

const invalid = (message: string) => new AccessError(400, "INVALID_INPUT", message);
const absent = (label: string) => new AccessError(404, "NOT_FOUND", `${label} not found.`);
const states = ["draft", "submitted", "in_review", "approved", "rejected", "withdrawn"];
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const notes = (value: unknown) => value == null || value === "" ? "" : boundedText(value, 2000, "Management notes");
const optional = (value: unknown, max: number, label: string) => value == null || value === "" ? null : boundedText(value, max, label);
const optionalDate = (value: unknown, label: string) => value == null || value === "" ? null : date(value, label);
function email(value: unknown) {
  const result = boundedText(value, 254, "Email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw invalid("Enter a complete email address.");
  return result;
}
function pagination(query: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(query).some(k => ![...allowed, "page"].includes(k))) throw invalid("Choose only the available filters.");
  const value = query.page ?? "1";
  if (typeof value !== "string" || !/^[1-9]\d{0,4}$/.test(value)) throw invalid("Choose a valid page.");
  return Number(value);
}
function queryText(value: unknown) { return value == null || value === "" ? "" : boundedText(value, 200, "Search"); }
function safe<T extends { companyId: string; createdById?: string; submissionKey?: string; submissionHash?: string }>(row: T) {
  const { companyId: _company, createdById: _actor, submissionKey: _key, submissionHash: _hash, ...result } = row;
  return result;
}
async function source(tx: Tx, companyId: string, propertyId: string, unitId: string | null = null) {
  if (!await tx.property.findFirst({ where: { id: propertyId, companyId }, select: { id: true } })) throw absent("Property");
  if (unitId && !await tx.unit.findFirst({ where: { id: unitId, propertyId, companyId }, select: { id: true } })) throw absent("Unit at this property");
}
async function prospect(tx: Tx, companyId: string, id: string, lock = false) {
  if (lock) await tx.$queryRaw`UPDATE "Prospect" SET "updatedAt"="updatedAt" WHERE id=${id} AND "companyId"=${companyId} RETURNING id`;
  const row = await tx.prospect.findFirst({ where: { id, companyId } });
  if (!row) throw absent("Prospect");
  return row;
}
async function application(tx: Tx, companyId: string, id: string, lock = false) {
  // Do not no-op UPDATE converted applications: the retention trigger rejects it.
  if (lock) await tx.$queryRaw`SELECT id FROM "RentalApplication" WHERE id=${id} AND "companyId"=${companyId} FOR UPDATE`;
  const row = await tx.rentalApplication.findFirst({ where: { id, companyId } });
  if (!row) throw absent("Application");
  return row;
}
async function decorate<T extends { propertyId: string; unitId?: string | null; prospectId?: string }>(tx: Tx, companyId: string, rows: T[]) {
  const properties = await tx.property.findMany({ where: { companyId, id: { in: [...new Set(rows.map(r => r.propertyId))] } }, select: { id: true, name: true } });
  const units = await tx.unit.findMany({ where: { companyId, id: { in: [...new Set(rows.flatMap(r => r.unitId ? [r.unitId] : []))] } }, select: { id: true, label: true } });
  const prospects = await tx.prospect.findMany({ where: { companyId, id: { in: [...new Set(rows.flatMap(r => r.prospectId ? [r.prospectId] : []))] } }, select: { id: true, name: true, email: true } });
  return rows.map(row => ({ ...row, ...("stage" in row ? { status: ["declined", "withdrawn", "converted"].includes(String(row.stage)) ? "closed" : "open" } : {}), property: properties.find(p => p.id === row.propertyId)!, unit: units.find(u => u.id === row.unitId) ?? null, ...(row.prospectId ? { prospect: prospects.find(p => p.id === row.prospectId)! } : {}) }));
}
async function replay(tx: Tx, companyId: string, request: FastifyRequest, key: ReturnType<typeof submission>) {
  const previous = await tx.admissionsEvent.findFirst({ where: { companyId, actorId: request.principal!.id, submissionKey: key.submissionKey } });
  if (previous) sameSubmission(previous.submissionHash, key.submissionHash);
  return previous;
}
async function record(tx: Tx, request: FastifyRequest, row: { id: string; companyId: string; propertyId: string; version: number }, entityType: string, action: string, key: ReturnType<typeof submission>, reason?: string) {
  await tx.admissionsEvent.create({ data: { companyId: row.companyId, propertyId: row.propertyId, entityType, entityId: row.id, action, actorId: request.principal!.id, version: row.version, ...key, snapshot: json({ ...row, ...(reason ? { reason } : {}) }) } });
  await audit(tx, request, row.companyId, row.id, `admissions.${entityType}.${action}`, { version: row.version });
}
async function history(tx: Tx, companyId: string, entityType: string, entityId: string, page = 1) {
  const where: Prisma.AdmissionsEventWhereInput = entityType === "prospect" ? { companyId, OR: [{ entityType, entityId }, { entityType: "follow_up", snapshot: { path: ["prospectId"], equals: entityId } }] } : { companyId, entityType, entityId };
  const [events, total] = await Promise.all([tx.admissionsEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25, skip: (page - 1) * 25 }), tx.admissionsEvent.count({ where })]);
  const people = await tx.user.findMany({ where: { id: { in: [...new Set(events.map(e => e.actorId))] } }, select: { id: true, name: true } });
  return { items: events.map(e => ({ id: e.id, entityType: e.entityType, action: e.action, actorName: people.find(p => p.id === e.actorId)?.name || "Property management", version: e.version, createdAt: e.createdAt, reason: typeof (e.snapshot as Record<string, unknown>).reason === "string" ? (e.snapshot as Record<string, unknown>).reason : null })), total, page, pageSize: 25 };
}
export function registerRentalApplications(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string, provider?: IdentityProvider) {
  const auth = { preValidation: authenticate };
  const run = <T>(r: FastifyRequest, work: (tx: Tx, companyId: string) => Promise<T>) => scoped(db, r, "lease.manage", work);
  server.post<{ Params: { unitId: string } }>("/api/company/units/:unitId/rental-listing", auth, r => {
    mutation(r, origin);
    const unitId = assignmentId(r.params.unitId), b = input(r, ["forRent", "expectedVersion", "expectedAvailabilityVersion", "reason", "submissionKey"]);
    if (typeof b.forRent !== "boolean") throw invalid("Choose whether to list this unit for rent.");
    const expectedVersion = b.expectedVersion === null ? null : version(b.expectedVersion);
    const expectedAvailabilityVersion = b.expectedAvailabilityVersion === null ? null : version(b.expectedAvailabilityVersion);
    const forRent = b.forRent, reason = boundedText(b.reason, 500, "Listing review reason");
    const key = submission(b.submissionKey, ["rental-listing", unitId, forRent, expectedVersion, expectedAvailabilityVersion, reason]);
    return run(r, async (tx, companyId) => {
      const owner = await tx.companyMembership.findFirst({ where: { companyId, userId: r.principal!.id, role: "owner", status: "active" }, select: { userId: true } });
      if (!owner) throw new AccessError(403, "ACCESS_DENIED", "Only a current company owner can change rental listings.");
      const unit = await lockUnit(tx, companyId, unitId), prior = await replay(tx, companyId, r, key);
      const current = await tx.unitRentalListing.findFirst({ where: { unitId, companyId } });
      if (prior) return current ? { version: current.version, forRent: current.forRent, listedAt: current.listedAt } : null;
      if (unit.status !== "active") throw new AccessError(409, "UNIT_ARCHIVED", "Restore the unit before changing its listing intent.");
      const readiness = await tx.unitAvailability.findFirst({ where: { unitId, companyId }, select: { version: true } });
      if ((current?.version ?? null) !== expectedVersion || (readiness?.version ?? null) !== expectedAvailabilityVersion) throw conflict();
      const data = { forRent, listedAt: forRent ? current?.listedAt ?? new Date() : null, updatedById: r.principal!.id };
      const row = current ? await tx.unitRentalListing.update({ where: { unitId }, data: { ...data, version: { increment: 1 } } }) : await tx.unitRentalListing.create({ data: { unitId, companyId, propertyId: unit.propertyId, ...data } });
      await record(tx, r, { ...row, id: unitId }, "unit_listing", forRent ? "listed" : "unlisted", key, reason);
      return { version: row.version, forRent: row.forRent, listedAt: row.listedAt };
    });
  });
  server.get<{ Params: { unitId: string }; Querystring: Record<string, unknown> }>("/api/company/units/:unitId/rental-listing/history", auth, r => {
    const unitId = assignmentId(r.params.unitId), page = pagination(r.query, []);
    return run(r, async (tx, companyId) => {
      if (!await tx.unit.findFirst({ where: { id: unitId, companyId }, select: { id: true } })) throw absent("Unit");
      return history(tx, companyId, "unit_listing", unitId, page);
    });
  });
  server.get<{ Params: { prospectId: string }; Querystring: Record<string, unknown> }>("/api/company/prospects/:prospectId/follow-ups", auth, r => {
    const page = pagination(r.query, ["status", "kind"]), id = assignmentId(r.params.prospectId), status = choice(r.query.status || "all", ["all", "open", "completed", "cancelled"], "follow-up status"), kind = choice(r.query.kind || "all", ["all", "tour", "task"], "follow-up type");
    return run(r, async (tx, companyId) => { await prospect(tx, companyId, id); const where = { companyId, prospectId: id, ...(status === "all" ? {} : { status }), ...(kind === "all" ? {} : { kind }) }; return { items: (await tx.prospectFollowUp.findMany({ where, orderBy: [{ dueOn: "asc" }, { id: "asc" }], take: 25, skip: (page - 1) * 25 })).map(safe), total: await tx.prospectFollowUp.count({ where }), page, pageSize: 25 }; });
  });
  server.get<{ Params: { prospectId: string } }>("/api/company/prospects/:prospectId/acquisition", auth, r => run(r, async (tx, companyId) => {
    const row = await prospect(tx, companyId, assignmentId(r.params.prospectId));
    const [followUps, applications, followUpTotal, applicationTotal, log] = await Promise.all([
      tx.prospectFollowUp.findMany({ where: { companyId, prospectId: row.id }, orderBy: [{ dueOn: "asc" }, { id: "asc" }], take: 25 }),
      tx.rentalApplication.findMany({ where: { companyId, prospectId: row.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 25 }),
      tx.prospectFollowUp.count({ where: { companyId, prospectId: row.id } }), tx.rentalApplication.count({ where: { companyId, prospectId: row.id } }), history(tx, companyId, "prospect", row.id),
    ]);
    return { companyId, prospect: (await decorate(tx, companyId, [safe(row)]))[0], followUps: followUps.map(safe), applications: await decorate(tx, companyId, applications.map(safe)), followUpTotal, applicationTotal, history: log.items, historyTotal: log.total };
  }));
  server.get<{ Params: { prospectId: string }; Querystring: Record<string, unknown> }>("/api/company/prospects/:prospectId/acquisition-history", auth, r => {
    const page = pagination(r.query, []), id = assignmentId(r.params.prospectId);
    return run(r, async (tx, companyId) => { await prospect(tx, companyId, id); return history(tx, companyId, "prospect", id, page); });
  });
  server.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>("/api/company/applications/:id/history", auth, r => {
    const page = pagination(r.query, []), id = assignmentId(r.params.id);
    return run(r, async (tx, companyId) => { await application(tx, companyId, id); return history(tx, companyId, "application", id, page); });
  });
  server.get<{ Params: { prospectId: string; followUpId: string } }>("/api/company/prospects/:prospectId/follow-ups/:followUpId", auth, r => run(r, async (tx, companyId) => {
    const prospectId = assignmentId(r.params.prospectId), id = assignmentId(r.params.followUpId); await prospect(tx, companyId, prospectId);
    const row = await tx.prospectFollowUp.findFirst({ where: { id, companyId, prospectId } }); if (!row) throw absent("Follow-up");
    return { companyId, followUp: safe(row) };
  }));
  server.post<{ Params: { prospectId: string } }>("/api/company/prospects/:prospectId/follow-ups", auth, r => {
    mutation(r, origin);
    const id = assignmentId(r.params.prospectId), b = input(r, ["kind", "title", "dueOn", "notes", "submissionKey"]), data = { kind: choice(b.kind, ["tour", "task"], "follow-up type"), title: boundedText(b.title, 160, "Follow-up title"), dueOn: date(b.dueOn, "follow-up date"), notes: notes(b.notes) }, key = submission(b.submissionKey, ["followup.create", id, data]);
    return run(r, async (tx, companyId) => {
      const prior = await replay(tx, companyId, r, key), parent = await prospect(tx, companyId, id, true);
      if (prior) return safe(await tx.prospectFollowUp.findFirstOrThrow({ where: { id: prior.entityId, companyId } }));
      if (["declined", "withdrawn", "converted"].includes(parent.stage)) throw new AccessError(409, "PROSPECT_CLOSED", "Reopen the prospect before adding a follow-up.");
      const row = await tx.prospectFollowUp.create({ data: { companyId, propertyId: parent.propertyId, prospectId: id, ...data } });
      await record(tx, r, row, "follow_up", "created", key);
      return safe(row);
    });
  });
  server.patch<{ Params: { prospectId: string; followUpId: string } }>("/api/company/prospects/:prospectId/follow-ups/:followUpId", auth, r => {
    mutation(r, origin);
    const id = assignmentId(r.params.prospectId), followUpId = assignmentId(r.params.followUpId), b = input(r, ["kind", "title", "dueOn", "notes", "status", "expectedVersion", "submissionKey"]), data = { kind: choice(b.kind, ["tour", "task"], "follow-up type"), title: boundedText(b.title, 160, "Follow-up title"), dueOn: date(b.dueOn, "follow-up date"), notes: notes(b.notes), status: choice(b.status, ["open", "completed", "cancelled"], "follow-up status") }, expectedVersion = version(b.expectedVersion), key = submission(b.submissionKey, ["followup.edit", id, followUpId, data, expectedVersion]);
    return run(r, async (tx, companyId) => {
      const prior = await replay(tx, companyId, r, key); await prospect(tx, companyId, id, true);
      const current = await tx.prospectFollowUp.findFirst({ where: { id: followUpId, prospectId: id, companyId } }); if (!current) throw absent("Follow-up");
      if (prior) return safe(current); if (current.version !== expectedVersion) throw conflict();
      const row = await tx.prospectFollowUp.update({ where: { id: followUpId }, data: { ...data, version: { increment: 1 } } }); await record(tx, r, row, "follow_up", "edited", key); return safe(row);
    });
  });
  server.get<{ Querystring: Record<string, unknown> }>("/api/company/applications", auth, r => {
    const q = r.query, page = pagination(q, ["propertyId", "unitId", "prospectId", "q", "status"]), propertyId = q.propertyId == null ? null : assignmentId(q.propertyId), unitId = q.unitId == null ? null : assignmentId(q.unitId), prospectId = q.prospectId == null ? null : assignmentId(q.prospectId), status = choice(q.status || "all", ["all", ...states], "application status"), search = queryText(q.q);
    return run(r, async (tx, companyId) => {
      if (propertyId) await source(tx, companyId, propertyId, unitId);
      if (prospectId) await prospect(tx, companyId, prospectId);
      // Filter/search in PostgreSQL rather than loading every matching prospect
      // identifier into the API process before applying application pagination.
      const matched = Prisma.sql`WITH matched AS (SELECT a.id,a."createdAt" FROM "RentalApplication" a JOIN "Prospect" p ON p.id=a."prospectId" AND p."companyId"=a."companyId" WHERE a."companyId"=${companyId}
        ${propertyId ? Prisma.sql`AND a."propertyId"=${propertyId}` : Prisma.empty} ${unitId ? Prisma.sql`AND a."unitId"=${unitId}` : Prisma.empty} ${prospectId ? Prisma.sql`AND a."prospectId"=${prospectId}` : Prisma.empty}
        ${status === "all" ? Prisma.empty : Prisma.sql`AND a.status=${status}`} ${search ? Prisma.sql`AND (position(lower(${search}) in lower(p.name))>0 OR position(lower(${search}) in lower(p.email))>0)` : Prisma.empty})`;
      const [count] = await tx.$queryRaw<Array<{ total: number }>>(Prisma.sql`${matched} SELECT count(*)::int total FROM matched`);
      const ids = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`${matched} SELECT id FROM matched ORDER BY "createdAt" DESC,id DESC LIMIT 25 OFFSET ${(page - 1) * 25}`);
      const items = await tx.rentalApplication.findMany({ where: { companyId, id: { in: ids.map(row => row.id) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      return { companyId, items: await decorate(tx, companyId, items.map(safe)), total: count.total, page, pageSize: 25 };
    });
  });
  server.post("/api/company/applications", auth, r => {
    mutation(r, origin);
    const b = input(r, ["prospectId", "unitId", "notes", "expectedProspectVersion", "submissionKey"]), prospectId = assignmentId(b.prospectId), unitId = assignmentId(b.unitId), data = { notes: notes(b.notes) }, expectedProspectVersion = version(b.expectedProspectVersion), key = submission(b.submissionKey, ["application.create", prospectId, unitId, data, expectedProspectVersion]);
    return run(r, async (tx, companyId) => {
      const prior = await replay(tx, companyId, r, key), parent = await prospect(tx, companyId, prospectId, true);
      if (prior) return (await decorate(tx, companyId, [safe(await application(tx, companyId, prior.entityId))]))[0];
      if (["declined", "withdrawn", "converted"].includes(parent.stage)) throw new AccessError(409, "PROSPECT_CLOSED", "Reopen the prospect before recording an application.");
      if (parent.version !== expectedProspectVersion) throw conflict();
      email(parent.email);
      const unit = await lockUnit(tx, companyId, unitId); if (unit.propertyId !== parent.propertyId) throw absent("Unit at this property"); if (unit.status !== "active") throw new AccessError(409, "UNIT_ARCHIVED", "Choose an active unit.");
      if (await tx.rentalApplication.findFirst({ where: { companyId, prospectId, unitId, leaseId: null, status: { in: ["draft", "submitted", "in_review", "approved"] } }, select: { id: true } })) throw new AccessError(409, "APPLICATION_EXISTS", "This prospect already has an open application for this unit. Open that application.");
      const row = await tx.rentalApplication.create({ data: { companyId, propertyId: parent.propertyId, unitId, prospectId, ...data, createdById: r.principal!.id, ...key } }); await record(tx, r, row, "application", "created", key); return (await decorate(tx, companyId, [safe(row)]))[0];
    });
  });
  server.get<{ Params: { id: string } }>("/api/company/applications/:id", auth, r => run(r, async (tx, companyId) => {
    const row = await application(tx, companyId, assignmentId(r.params.id)), parent = await prospect(tx, companyId, row.prospectId), log = await history(tx, companyId, "application", row.id);
    return { companyId, application: (await decorate(tx, companyId, [safe(row)]))[0], prospect: (await decorate(tx, companyId, [safe(parent)]))[0], history: log.items, historyTotal: log.total };
  }));
  server.patch<{ Params: { id: string } }>("/api/company/applications/:id", auth, r => {
    mutation(r, origin); const id = assignmentId(r.params.id), b = input(r, ["notes", "expectedVersion", "submissionKey"]), data = { notes: notes(b.notes) }, expectedVersion = version(b.expectedVersion), key = submission(b.submissionKey, ["application.edit", id, data, expectedVersion]);
    return run(r, async (tx, companyId) => { const prior = await replay(tx, companyId, r, key), current = await application(tx, companyId, id, true); if (prior) return (await decorate(tx, companyId, [safe(current)]))[0]; if (current.version !== expectedVersion) throw conflict(); if (current.leaseId) throw new AccessError(409, "APPLICATION_CONVERTED", "This application is linked to a lease. Retain its reviewed history."); const row = await tx.rentalApplication.update({ where: { id }, data: { ...data, version: { increment: 1 } } }); await record(tx, r, row, "application", "edited", key); return (await decorate(tx, companyId, [safe(row)]))[0]; });
  });
  server.post<{ Params: { id: string } }>("/api/company/applications/:id/actions", auth, r => {
    mutation(r, origin); const id = assignmentId(r.params.id), b = input(r, ["action", "reason", "expectedVersion", "expectedProspectVersion", "submissionKey"]), action = choice(b.action, ["submit", "review", "approve", "reject", "withdraw", "reopen"], "application action"), reason = boundedText(b.reason, 1000, "Decision explanation"), expectedVersion = version(b.expectedVersion), expectedProspectVersion = version(b.expectedProspectVersion), key = submission(b.submissionKey, ["application.action", id, action, reason, expectedVersion, expectedProspectVersion]);
    return run(r, async (tx, companyId) => {
      const prior = await replay(tx, companyId, r, key), current = await application(tx, companyId, id, true); if (prior) return (await decorate(tx, companyId, [safe(current)]))[0]; const parent = await prospect(tx, companyId, current.prospectId, true); if (parent.version !== expectedProspectVersion) throw conflict(); if (current.version !== expectedVersion) throw conflict(); if (current.leaseId) throw new AccessError(409, "APPLICATION_CONVERTED", "Manage the linked lease; a converted application retains its decision history.");
      if (["submit", "review", "approve"].includes(action) && ["declined", "withdrawn", "converted"].includes(parent.stage)) throw new AccessError(409, "PROSPECT_CLOSED", "Reopen the prospect before continuing application review.");
      const allowed: Record<string, string[]> = { submit: ["draft"], review: ["submitted"], approve: ["in_review"], reject: ["in_review"], withdraw: ["draft", "submitted", "in_review", "approved"], reopen: ["approved", "rejected", "withdrawn"] };
      if (!allowed[action].includes(current.status)) throw new AccessError(409, "APPLICATION_STAGE_CHANGED", "This action is not available at the current application stage. Refresh and review the next step.");
      const status = action === "submit" ? "submitted" : action === "review" ? "in_review" : action === "approve" ? "approved" : action === "reject" ? "rejected" : action === "withdraw" ? "withdrawn" : current.status === "withdrawn" ? "draft" : "in_review";
      if (["draft", "submitted", "in_review", "approved"].includes(status) && await tx.rentalApplication.findFirst({ where: { companyId, prospectId: current.prospectId, unitId: current.unitId, leaseId: null, status: { in: ["draft", "submitted", "in_review", "approved"] }, id: { not: id } }, select: { id: true } })) throw new AccessError(409, "APPLICATION_EXISTS", "Another open application already covers this inquiry and unit. Review that source before reopening this decision.");
      const row = await tx.rentalApplication.update({ where: { id }, data: { status, version: { increment: 1 } } }); await record(tx, r, row, "application", action, key, reason); return (await decorate(tx, companyId, [safe(row)]))[0];
    });
  });
  server.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>("/api/company/applications/:id/conversion-candidates", auth, r => {
    const page = pagination(r.query, ["q"]), search = queryText(r.query.q), id = assignmentId(r.params.id);
    return run(r, async (tx, companyId) => { const row = await application(tx, companyId, id), parent = await prospect(tx, companyId, row.prospectId); const where: Prisma.ResidentContactWhereInput = { companyId, status: "active", email: { equals: parent.email, mode: "insensitive" }, OR: [{ userId: null }, { user: { status: "active", OR: [{ membership: null }, { membership: { companyId, role: "resident", status: "active" } }] } }], ...(search ? { name: { contains: search, mode: "insensitive" } } : {}) }; return { items: await tx.residentContact.findMany({ where, select: { id: true, name: true, email: true, userId: true, version: true, status: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 25, skip: (page - 1) * 25 }), total: await tx.residentContact.count({ where }), page, pageSize: 25 }; });
  });
  server.post<{ Params: { id: string } }>("/api/company/applications/:id/convert", auth, async r => {
    mutation(r, origin);
    const id = assignmentId(r.params.id), b = input(r, ["expectedVersion", "expectedProspectVersion", "confirmedMatch", "reason", "contactId", "expectedContactVersion", "startsOn", "endsOn", "monthlyRent", "rentDueDay", "graceDays", "paymentInstructions", "submissionKey"]), expectedVersion = version(b.expectedVersion), expectedProspectVersion = version(b.expectedProspectVersion), reason = boundedText(b.reason, 500, "Conversion reason"), contactId = b.contactId == null ? null : assignmentId(b.contactId), expectedContactVersion = contactId ? version(b.expectedContactVersion) : null, startsOn = date(b.startsOn, "lease start date"), endsOn = optionalDate(b.endsOn, "lease end date"), rentCents = cents(b.monthlyRent), policy = { rentDueDay: 1, graceDays: 0, paymentInstructions: null, ...paymentPolicyPatch(b) };
    if (b.confirmedMatch !== true) throw invalid("Confirm the exact applicant account and reviewed lease terms before preparing a lease.");
    if (endsOn && endsOn < startsOn) throw invalid("Lease end date cannot precede its start date.");
    const key = submission(b.submissionKey, ["application.convert", id, expectedVersion, expectedProspectVersion, true, reason, contactId, expectedContactVersion, startsOn, endsOn, rentCents, policy]);
    const before = await run(r, async (tx, companyId) => {
      const prior = await replay(tx, companyId, r, key), row = await application(tx, companyId, id), parent = await prospect(tx, companyId, row.prospectId);
      if (prior) return { replayed: true as const, row };
      if (row.version !== expectedVersion || parent.version !== expectedProspectVersion) throw conflict();
      if (["declined", "withdrawn", "converted"].includes(parent.stage)) throw new AccessError(409, "PROSPECT_CLOSED", "Reopen the prospect before preparing another lease.");
      email(parent.email);
      if (row.status !== "approved" || row.leaseId) throw new AccessError(409, "APPLICATION_NOT_CONVERTIBLE", "Approve the application before preparing its lease. Open an existing linked lease instead of converting twice.");
      const contact = contactId ? await tx.residentContact.findFirst({ where: { id: contactId, companyId, status: "active" } }) : null;
      if (contactId && (!contact || contact.version !== expectedContactVersion)) throw conflict();
      if (contact && contact.email?.toLowerCase() !== email(parent.email)) throw new AccessError(409, "CONTACT_EMAIL_CHANGED", "The selected tenant email differs from this prospect. Review the intended person before continuing.");
      const identity = contact?.userId ? await tx.identity.findFirst({ where: { userId: contact.userId, issuer: provider?.issuer ?? "" } }) : null;
      if (contact?.userId && !identity) throw new AccessError(409, "IDENTITY_CONFLICT", "This tenant has no matching Auth0 identity. Ask an administrator to review the account.");
      return { replayed: false as const, row, parent, contact, subject: identity?.subject };
    });
    const result = async (tx: Tx, companyId: string, row: RentalApplication) => ({ application: (await decorate(tx, companyId, [safe(row)]))[0], contactId: row.contactId, leaseId: row.leaseId, leaseHref: `/company/leases/${encodeURIComponent(row.leaseId!)}?onboarding=household`, contactHref: `/company/tenants/${encodeURIComponent(row.contactId!)}` });
    if (before.replayed) return run(r, async (tx, companyId) => result(tx, companyId, await application(tx, companyId, id)));
    const prepared = await prepareAccount(provider, before.contact?.email ?? email(before.parent.email), before.contact?.name ?? before.parent.name, before.subject);
    if (prepared.user.email.toLowerCase() !== email(before.parent.email)) throw new AccessError(409, "IDENTITY_EMAIL_CHANGED", "The sign-in account email differs from this prospect. Review the intended identity before continuing.");
    return run(r, async (tx, companyId) => {
      const prior = await replay(tx, companyId, r, key), row = await application(tx, companyId, id, true);
      if (prior) return result(tx, companyId, row);
      const parent = await prospect(tx, companyId, row.prospectId, true);
      if (row.version !== expectedVersion || row.status !== "approved" || row.leaseId || parent.version !== before.parent.version || parent.version !== expectedProspectVersion || ["declined", "withdrawn", "converted"].includes(parent.stage)) throw conflict();
      const unit = await lockUnit(tx, companyId, row.unitId); if (unit.propertyId !== row.propertyId || unit.status !== "active") throw new AccessError(409, "UNIT_UNAVAILABLE", "Restore and review the intended unit before preparing a lease.");
      const accountId = await saveAccount(tx, r, prepared, companyId);
      await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${accountId} RETURNING id`;
      let contact = contactId ? await tx.residentContact.findFirst({ where: { id: contactId, companyId, status: "active" } }) : await tx.residentContact.findFirst({ where: { companyId, userId: accountId } });
      if (contact) {
        await tx.$queryRaw`UPDATE "ResidentContact" SET "updatedAt"="updatedAt" WHERE id=${contact.id} AND "companyId"=${companyId} RETURNING id`;
        contact = await tx.residentContact.findFirstOrThrow({ where: { id: contact.id, companyId } });
      }
      if (contactId && (!contact || contact.version !== expectedContactVersion || contact.email?.toLowerCase() !== email(parent.email) || (contact.userId && contact.userId !== accountId))) throw conflict();
      if (!contactId && contact) throw new AccessError(409, "CONTACT_REVIEW_REQUIRED", "This account already has a tenant profile. Select and review that exact profile explicitly; no profiles were merged.");
      if (contact && contact.status !== "active") throw new AccessError(409, "TENANT_ARCHIVED", "Restore the existing tenant profile before preparing this lease.");
      const duplicate = await tx.residentContact.findFirst({ where: { companyId, userId: accountId, ...(contact ? { id: { not: contact.id } } : {}) }, select: { id: true } });
      if (duplicate) throw new AccessError(409, "CONTACT_LINK_CONFLICT", "The account already has a tenant profile. Select that existing profile explicitly.");
      if (!contact) {
        if (await tx.residentContact.findFirst({ where: { companyId, email: { equals: parent.email, mode: "insensitive" } }, select: { id: true } })) throw new AccessError(409, "CONTACT_REVIEW_REQUIRED", "A tenant profile already uses this email. Restore it if archived, then select and review that existing profile; profiles are not merged by email.");
        contact = await tx.residentContact.create({ data: { companyId, userId: accountId, name: parent.name, email: parent.email, phone: parent.phone, createdById: r.principal!.id } });
      }
      else if (!contact.userId) contact = await tx.residentContact.update({ where: { id: contact.id }, data: { userId: accountId, version: { increment: 1 } } });
      const lease = await tx.lease.create({ data: { companyId, propertyId: row.propertyId, unitId: row.unitId, residentId: accountId, residentContactId: contact.id, startsOn, endsOn, rentCents, currency: "USD", status: "draft", ...policy, createdById: r.principal!.id, ...key } });
      await tx.leaseParticipant.create({ data: { companyId, propertyId: row.propertyId, leaseId: lease.id, userId: accountId, contactId: contact.id, name: contact.name, email: contact.email, role: "leaseholder", startsOn, portalApproved: false, createdById: r.principal!.id, submissionKey: `primary:${lease.id}`, submissionHash: key.submissionHash } });
      const changed = await tx.rentalApplication.update({ where: { id }, data: { contactId: contact.id, leaseId: lease.id, version: { increment: 1 } } });
      await record(tx, r, changed, "application", "converted", key, reason);
      const linked = await tx.prospect.update({ where: { id: parent.id, companyId }, data: { stage: "converted", contactId: contact.id, leaseId: lease.id, version: { increment: 1 } } });
      await tx.prospectAction.create({ data: { companyId, prospectId: parent.id, version: linked.version, action: "converted", reason, actorId: r.principal!.id, submissionKey: `application:${id}:${key.submissionKey}`, submissionHash: key.submissionHash, snapshot: json({ ...linked, applicationId: id, reviewedContactVersion: contact.version, reviewedAccountId: accountId }) } });
      await audit(tx, r, companyId, parent.id, "prospect.converted", { version: linked.version, applicationId: id, leaseId: lease.id });
      await audit(tx, r, companyId, lease.id, "lease.created", { applicationId: id, status: "draft", unitId: row.unitId });
      return result(tx, companyId, changed);
    });
  });
}
