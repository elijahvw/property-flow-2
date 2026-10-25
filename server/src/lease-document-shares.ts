import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessError, requirePermission } from "./access.js";
import { assignmentId, opaqueUserId } from "./application.js";
import { audit, boundedText, conflict, date, input, mutation, sameSubmission, scoped, submission, version, type Tx } from "./operational.js";
import { sharedLeaseAccess } from "./lease-participants.js";
import { companyDay } from "./reports.js";

const grantSelect = { id: true, companyId: true, leaseId: true, documentId: true, documentVersionId: true, userId: true, version: true, expiresOn: true, reason: true, revokedAt: true, receivedAt: true, createdAt: true } as const;
type Grant = Prisma.LeaseDocumentShareGetPayload<{ select: typeof grantSelect }>;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const missing = () => new AccessError(404, "NOT_FOUND", "Shared document not found.");
async function today(tx: Tx, companyId: string) {
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } });
  return new Date(`${companyDay(company.timezone)}T00:00:00.000Z`);
}
function after(request: FastifyRequest, allowed: string[] = []) {
  const query = request.query as Record<string, unknown>;
  if (Object.keys(query).some(key => key !== "cursor" && !allowed.includes(key))) throw new AccessError(400, "INVALID_INPUT", "Choose valid document filters.");
  return query.cursor === undefined ? undefined : assignmentId(query.cursor);
}
async function source(tx: Tx, companyId: string, leaseId: string, documentId: string, lock: "share" | "update" = "share") {
  await tx.$queryRaw`SELECT id FROM "Lease" WHERE id=${leaseId} AND "companyId"=${companyId} FOR SHARE`;
  if (lock === "update") await tx.$queryRaw`SELECT id FROM "PrivateDocument" WHERE id=${documentId} AND "companyId"=${companyId} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "PrivateDocument" WHERE id=${documentId} AND "companyId"=${companyId} FOR SHARE`;
  const document = await tx.privateDocument.findFirst({ where: { id: documentId, companyId, leaseId }, select: { id: true, title: true, version: true, archivedAt: true } });
  if (!document) throw missing();
  return document;
}
async function eligibleLease(tx: Tx, companyId: string, leaseId: string, userId: string, day: Date) {
  return tx.lease.findFirst({ where: { id: leaseId, companyId, status: "active", AND: [sharedLeaseAccess(companyId, userId, day), { OR: [{ endsOn: null }, { endsOn: { gte: day } }] }] }, select: { id: true } });
}
async function eligibleResident(tx: Tx, companyId: string, userId: string) {
  return tx.user.findFirst({ where: { id: userId, status: "active", emailVerified: true, identities: { some: {} }, membership: { companyId, status: "active", role: "resident" } }, select: { id: true, name: true, email: true } });
}
async function recipients(tx: Tx, companyId: string, leaseId: string, day: Date) {
  const lease = await tx.lease.findFirst({ where: { id: leaseId, companyId, status: "active", OR: [{ endsOn: null }, { endsOn: { gte: day } }] }, select: { propertyId: true, residentId: true, participants: { where: { companyId }, select: { userId: true, role: true, removedAt: true, portalApproved: true, endsOn: true } } } });
  if (!lease) return [];
  const valid = (participant: typeof lease.participants[number]) => participant.role === "leaseholder" && participant.portalApproved && !participant.removedAt && (!participant.endsOn || participant.endsOn >= day);
  const primary = lease.residentId && !lease.participants.some(participant => participant.userId === lease.residentId && !valid(participant)) ? [lease.residentId] : [];
  const ids = [...new Set([...primary, ...lease.participants.flatMap(participant => valid(participant) && participant.userId ? [participant.userId] : [])])];
  const rows = await tx.user.findMany({ where: { id: { in: ids }, status: "active", emailVerified: true, identities: { some: {} }, membership: { companyId, status: "active", role: "resident", assignments: { some: { companyId, propertyId: lease.propertyId } } } }, select: { id: true, name: true, email: true }, orderBy: { id: "asc" }, take: 201 });
  if (rows.length > 200) throw new AccessError(422, "HOUSEHOLD_TOO_LARGE", "More than 200 eligible leaseholders require a narrower sharing workflow; no recipient list was truncated.");
  return rows;
}
async function grantDto(tx: Tx, companyId: string, row: Grant, day: Date) {
  const [recipient, versionRow, document, access] = await Promise.all([
    tx.user.findFirst({ where: { id: row.userId, membership: { companyId } }, select: { id: true, name: true, email: true } }),
    tx.documentVersion.findFirst({ where: { id: row.documentVersionId, companyId, documentId: row.documentId }, select: { number: true, filename: true, scanStatus: true } }),
    tx.privateDocument.findFirst({ where: { id: row.documentId, companyId, leaseId: row.leaseId }, select: { archivedAt: true } }),
    eligibleLease(tx, companyId, row.leaseId, row.userId, day),
  ]);
  const live = access && await eligibleResident(tx, companyId, row.userId);
  const status = row.revokedAt ? "revoked" : row.expiresOn < day ? "expired" : !document || document.archivedAt || versionRow?.scanStatus !== "clean" || !live ? "unavailable" : "active";
  return { ...row, expiresOn: row.expiresOn.toISOString().slice(0, 10), recipient, versionNumber: versionRow?.number ?? null, filename: versionRow?.filename ?? null, status };
}

// Called inside the existing archive transaction. Restoring a document never
// restores these grants: the owner must review a new grant explicitly.
export async function revokeDocumentShares(tx: Tx, request: FastifyRequest, companyId: string, documentId: string) {
  const grants = await tx.leaseDocumentShare.findMany({ where: { companyId, documentId, revokedAt: null }, select: grantSelect });
  if (!grants.length) return;
  await tx.leaseDocumentShare.updateMany({ where: { companyId, documentId, revokedAt: null }, data: { revokedAt: new Date(), version: { increment: 1 }, reason: "Source document archived" } });
  await tx.leaseDocumentShareAction.createMany({ data: grants.map(grant => ({ companyId, shareId: grant.id, action: "source_archived", detail: json({ documentId, documentVersionId: grant.documentVersionId, userId: grant.userId, fromVersion: grant.version }), createdById: request.principal!.id, ...submission(randomUUID(), { documentId, shareId: grant.id, action: "source_archived" }) })) });
  await audit(tx, request, companyId, documentId, "document.share.source_archived", { revokedCount: grants.length });
}

export function registerLeaseDocumentShares(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string) {
  const auth = { preValidation: authenticate }, base = "/api/company/leases/:leaseId/documents/:documentId/shares";
  type Params = { leaseId: string; documentId: string; shareId: string };
  server.get<{ Params: Params }>(base, auth, request => {
    const cursor = after(request, ["userId", "documentVersionId"]), leaseId = assignmentId(request.params.leaseId), documentId = assignmentId(request.params.documentId);
    const query = request.query as { userId?: string; documentVersionId?: string };
    const userId = query.userId === undefined ? undefined : opaqueUserId(query.userId), documentVersionId = query.documentVersionId === undefined ? undefined : assignmentId(query.documentVersionId);
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      const document = await source(tx, companyId, leaseId, documentId), day = await today(tx, companyId);
      const [versions, eligibleResidents, rows, total] = await Promise.all([
        tx.documentVersion.findMany({ where: { companyId, documentId }, select: { id: true, number: true, filename: true, scanStatus: true, byteLength: true }, orderBy: { number: "desc" }, take: 51 }),
        recipients(tx, companyId, leaseId, day),
        tx.leaseDocumentShare.findMany({ where: { companyId, documentId, leaseId, userId, documentVersionId, ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: "desc" }, take: 51, select: grantSelect }),
        tx.leaseDocumentShare.count({ where: { companyId, documentId, leaseId, userId, documentVersionId } }),
      ]);
      if (versions.length > 50) throw new AccessError(422, "DOCUMENT_VERSION_LIMIT", "This document exceeds the retained-version limit; no version list was truncated.");
      return { document, today: day.toISOString().slice(0, 10), versions, eligibleResidents, items: await Promise.all(rows.slice(0, 50).map(row => grantDto(tx, companyId, row, day))), total, nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  });
  server.post<{ Params: Params }>(base, auth, request => {
    mutation(request, origin); requirePermission(request.principal!, "company.manage");
    const body = input(request, ["documentVersionId", "userId", "expiresOn", "reason", "expectedVersion", "expectedDocumentVersion", "submissionKey"]);
    const leaseId = assignmentId(request.params.leaseId), documentId = assignmentId(request.params.documentId);
    const payload = { leaseId, documentId, documentVersionId: assignmentId(body.documentVersionId), userId: opaqueUserId(body.userId), expiresOn: date(body.expiresOn, "access-through date"), reason: boundedText(body.reason, 500, "Sharing reason"), expectedVersion: body.expectedVersion === null ? null : version(body.expectedVersion), expectedDocumentVersion: version(body.expectedDocumentVersion) };
    const key = submission(body.submissionKey, payload);
    return scoped(db, request, "company.manage", async (tx, companyId) => {
      const day = await today(tx, companyId), receipt = await tx.leaseDocumentShareAction.findUnique({ where: { companyId_submissionKey: { companyId, submissionKey: key.submissionKey } } });
      if (receipt) { sameSubmission(receipt.submissionHash, key.submissionHash); const row = await tx.leaseDocumentShare.findFirst({ where: { companyId, id: receipt.shareId, documentId, leaseId }, select: grantSelect }); if (!row) throw missing(); return { share: await grantDto(tx, companyId, row, day) }; }
      const document = await source(tx, companyId, leaseId, documentId, "update");
      if (document.archivedAt) throw new AccessError(409, "DOCUMENT_ARCHIVED", "Restore the original document, then review a new share grant.");
      if (document.version !== payload.expectedDocumentVersion) throw conflict();
      if (payload.expiresOn < day) throw new AccessError(400, "INVALID_INPUT", "Access must continue through today or a later company calendar date.");
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${payload.userId} FOR SHARE`;
      if (!await eligibleResident(tx, companyId, payload.userId) || !await eligibleLease(tx, companyId, leaseId, payload.userId, day)) throw new AccessError(409, "RECIPIENT_UNAVAILABLE", "Choose a currently approved leaseholder with verified account and property access on this active or upcoming lease.");
      const original = await tx.documentVersion.findFirst({ where: { id: payload.documentVersionId, companyId, documentId }, select: { id: true, scanStatus: true } });
      if (!original) throw missing();
      if (original.scanStatus !== "clean") throw new AccessError(409, "FILE_QUARANTINED", "Only this exact original cleared by scanning can be shared.");
      const current = await tx.leaseDocumentShare.findUnique({ where: { companyId_documentVersionId_userId: { companyId, documentVersionId: payload.documentVersionId, userId: payload.userId } }, select: grantSelect });
      if ((current?.version ?? null) !== payload.expectedVersion) throw conflict();
      const row = current ? await tx.leaseDocumentShare.update({ where: { id: current.id, companyId }, data: { expiresOn: payload.expiresOn, reason: payload.reason, revokedAt: null, receivedAt: null, version: { increment: 1 } }, select: grantSelect }) : await tx.leaseDocumentShare.create({ data: { companyId, leaseId, documentId, documentVersionId: payload.documentVersionId, userId: payload.userId, expiresOn: payload.expiresOn, reason: payload.reason, createdById: request.principal!.id }, select: grantSelect });
      await tx.leaseDocumentShareAction.create({ data: { companyId, shareId: row.id, action: "grant", detail: json({ ...payload, version: row.version }), createdById: request.principal!.id, ...key } });
      await audit(tx, request, companyId, documentId, "document.share.granted", { shareId: row.id, recipientId: row.userId, documentVersionId: row.documentVersionId, expiresOn: payload.expiresOn.toISOString().slice(0, 10), version: row.version });
      return { share: await grantDto(tx, companyId, row, day) };
    });
  });
  server.post<{ Params: Params }>(base + "/:shareId/revoke", auth, request => {
    mutation(request, origin); requirePermission(request.principal!, "company.manage");
    const body = input(request, ["expectedVersion", "reason", "submissionKey"]), leaseId = assignmentId(request.params.leaseId), documentId = assignmentId(request.params.documentId), shareId = assignmentId(request.params.shareId);
    const payload = { leaseId, documentId, shareId, expectedVersion: version(body.expectedVersion), reason: boundedText(body.reason, 500, "Revocation reason") }, key = submission(body.submissionKey, payload);
    return scoped(db, request, "company.manage", async (tx, companyId) => {
      const day = await today(tx, companyId), receipt = await tx.leaseDocumentShareAction.findUnique({ where: { companyId_submissionKey: { companyId, submissionKey: key.submissionKey } } });
      if (receipt) { sameSubmission(receipt.submissionHash, key.submissionHash); const row = await tx.leaseDocumentShare.findFirst({ where: { companyId, id: receipt.shareId, documentId, leaseId }, select: grantSelect }); if (!row) throw missing(); return { share: await grantDto(tx, companyId, row, day) }; }
      await source(tx, companyId, leaseId, documentId, "update");
      const current = await tx.leaseDocumentShare.findFirst({ where: { id: shareId, companyId, documentId, leaseId }, select: grantSelect });
      if (!current) throw missing();
      if (current.version !== payload.expectedVersion) throw conflict();
      const row = await tx.leaseDocumentShare.update({ where: { id: shareId, companyId }, data: { revokedAt: new Date(), reason: payload.reason, version: { increment: 1 } }, select: grantSelect });
      await tx.leaseDocumentShareAction.create({ data: { companyId, shareId, action: "revoke", detail: json(payload), createdById: request.principal!.id, ...key } });
      await audit(tx, request, companyId, documentId, "document.share.revoked", { shareId, recipientId: row.userId, documentVersionId: row.documentVersionId, version: row.version });
      return { share: await grantDto(tx, companyId, row, day) };
    });
  });
  server.get<{ Params: Params }>(base + "/:shareId/history", auth, request => {
    const cursor = after(request), leaseId = assignmentId(request.params.leaseId), documentId = assignmentId(request.params.documentId), shareId = assignmentId(request.params.shareId);
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      await source(tx, companyId, leaseId, documentId);
      if (!await tx.leaseDocumentShare.findFirst({ where: { id: shareId, companyId, leaseId, documentId }, select: { id: true } })) throw missing();
      const rows = await tx.leaseDocumentShareAction.findMany({ where: { companyId, shareId, ...(cursor ? { id: { lt: cursor } } : {}) }, select: { id: true, action: true, detail: true, createdAt: true }, orderBy: { id: "desc" }, take: 51 });
      return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  });
  function visible(companyId: string, userId: string, day: Date): Prisma.LeaseDocumentShareWhereInput {
    return { companyId, userId, revokedAt: null, expiresOn: { gte: day }, document: { companyId, archivedAt: null }, documentVersion: { companyId, scanStatus: "clean" }, lease: { companyId, status: "active", AND: [sharedLeaseAccess(companyId, userId, day), { OR: [{ endsOn: null }, { endsOn: { gte: day } }] }] } };
  }
  const residentSelect = { id: true, version: true, receivedAt: true, createdAt: true, expiresOn: true, document: { select: { title: true } }, documentVersion: { select: { number: true, filename: true, mediaType: true, byteLength: true } }, lease: { select: { id: true, property: { select: { name: true } }, unit: { select: { label: true } } } } } as const;
  const residentDto = (row: Prisma.LeaseDocumentShareGetPayload<{ select: typeof residentSelect }>) => ({ id: row.id, version: row.version, receivedAt: row.receivedAt, sharedAt: row.createdAt, title: row.document.title, versionNumber: row.documentVersion.number, filename: row.documentVersion.filename, mediaType: row.documentVersion.mediaType, byteLength: row.documentVersion.byteLength, expiresOn: row.expiresOn.toISOString().slice(0, 10), lease: row.lease });
  server.get("/api/resident/documents", auth, request => {
    const cursor = after(request, ["q"]), query = request.query as { q?: unknown };
    if (query.q !== undefined && (typeof query.q !== "string" || query.q.length > 160 || /[\u0000-\u001f\u007f]/.test(query.q))) throw new AccessError(400, "INVALID_INPUT", "Search shared documents with up to 160 characters.");
    const search = typeof query.q === "string" ? query.q.trim() : "", needle = search.replace(/[\\%_]/g, "\\$&");
    return scoped(db, request, "resident.self", async (tx, companyId) => {
      const userId = request.principal!.id, day = await today(tx, companyId);
      if (!await eligibleResident(tx, companyId, userId)) throw missing();
      const where: Prisma.LeaseDocumentShareWhereInput = { ...visible(companyId, userId, day), ...(search ? { OR: [{ document: { title: { contains: needle, mode: "insensitive" } } }, { lease: { property: { name: { contains: needle, mode: "insensitive" } } } }, { lease: { unit: { label: { contains: needle, mode: "insensitive" } } } }] } : {}) }, [rows, total] = await Promise.all([
        tx.leaseDocumentShare.findMany({ where: { ...where, ...(cursor ? { id: { lt: cursor } } : {}) }, select: residentSelect, orderBy: { id: "desc" }, take: 51 }),
        tx.leaseDocumentShare.count({ where }),
      ]);
      return { companyId, items: rows.slice(0, 50).map(residentDto), total, nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  });
  server.get<{ Params: { shareId: string } }>("/api/resident/documents/:shareId", auth, request => {
    const shareId = assignmentId(request.params.shareId);
    return scoped(db, request, "resident.self", async (tx, companyId) => {
      const userId = request.principal!.id, day = await today(tx, companyId);
      if (!await eligibleResident(tx, companyId, userId)) throw missing();
      const row = await tx.leaseDocumentShare.findFirst({ where: { id: shareId, ...visible(companyId, userId, day) }, select: residentSelect });
      if (!row) throw missing();
      return { companyId, document: residentDto(row) };
    });
  });
  server.get<{ Params: { shareId: string } }>("/api/resident/documents/:shareId/download", auth, async (request, reply) => {
    const shareId = assignmentId(request.params.shareId);
    const result = await scoped(db, request, "resident.self", async (tx, companyId) => {
      const userId = request.principal!.id, day = await today(tx, companyId);
      if (!await eligibleResident(tx, companyId, userId)) throw missing();
      const selected = await tx.leaseDocumentShare.findFirst({ where: { id: shareId, ...visible(companyId, userId, day) }, select: grantSelect });
      if (!selected) throw missing();
      await source(tx, companyId, selected.leaseId, selected.documentId);
      await tx.$queryRaw`SELECT id FROM "LeaseDocumentShare" WHERE id=${shareId} AND "companyId"=${companyId} FOR SHARE`;
      const share = await tx.leaseDocumentShare.findFirst({ where: { id: shareId, ...visible(companyId, userId, day) }, select: { ...grantSelect, documentVersion: { select: { filename: true, mediaType: true, content: true } } } });
      if (!share) throw missing();
      await tx.leaseDocumentShareAction.create({ data: { companyId, shareId, action: "downloaded", detail: json({ documentVersionId: share.documentVersionId, recipientId: userId, impersonated: !!request.impersonation }), createdById: request.sessionActor?.id ?? userId, ...submission(randomUUID(), { action: "downloaded", shareId, userId }) } });
      await audit(tx, request, companyId, share.documentId, "document.shared.downloaded", { shareId, documentVersionId: share.documentVersionId, leaseId: share.leaseId, recipientId: userId });
      return { filename: share.documentVersion.filename, mediaType: share.documentVersion.mediaType, contentBase64: Buffer.from(share.documentVersion.content).toString("base64") };
    });
    return reply.header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff").send(result);
  });
  server.post<{ Params: { shareId: string } }>("/api/resident/documents/:shareId/received", auth, request => {
    mutation(request, origin);
    const shareId = assignmentId(request.params.shareId), body = input(request, ["expectedVersion", "submissionKey"]), expectedVersion = version(body.expectedVersion);
    const payload = { action: "received", shareId, userId: request.principal!.id, expectedVersion }, key = submission(body.submissionKey, payload);
    return scoped(db, request, "resident.self", async (tx, companyId) => {
      const userId = request.principal!.id, day = await today(tx, companyId);
      if (!await eligibleResident(tx, companyId, userId)) throw missing();
      const selected = await tx.leaseDocumentShare.findFirst({ where: { id: shareId, ...visible(companyId, userId, day) }, select: grantSelect });
      if (!selected) throw missing();
      await source(tx, companyId, selected.leaseId, selected.documentId);
      await tx.$queryRaw`SELECT id FROM "LeaseDocumentShare" WHERE id=${shareId} AND "companyId"=${companyId} FOR UPDATE`;
      const share = await tx.leaseDocumentShare.findFirst({ where: { id: shareId, ...visible(companyId, userId, day) }, select: grantSelect });
      if (!share) throw missing();
      const previous = await tx.leaseDocumentShareAction.findUnique({ where: { companyId_submissionKey: { companyId, submissionKey: key.submissionKey } } });
      if (previous) {
        sameSubmission(previous.submissionHash, key.submissionHash);
        if (previous.action !== "received" || previous.shareId !== shareId || previous.createdById !== userId) throw conflict();
        // A later owner review may have begun a new access grant. Return its
        // current state without acknowledging it with this earlier receipt.
        return { id: share.id, version: share.version, receivedAt: share.receivedAt, receipt: { id: previous.id, recordedAt: previous.createdAt } };
      }
      if (share.version !== expectedVersion) throw conflict();
      if (share.receivedAt) throw new AccessError(409, "ALREADY_RECEIVED", "Receipt is already confirmed for this access grant. Refresh the current document status.");
      const receivedAt = new Date();
      const updated = await tx.leaseDocumentShare.update({ where: { id: shareId, companyId }, data: { receivedAt, version: { increment: 1 } }, select: grantSelect });
      const receipt = await tx.leaseDocumentShareAction.create({ data: { companyId, shareId, action: "received", detail: json({ documentVersionId: share.documentVersionId, userId, fromVersion: expectedVersion, receivedAt }), createdById: userId, ...key } });
      await audit(tx, request, companyId, share.documentId, "document.share.received", { shareId, documentVersionId: share.documentVersionId, leaseId: share.leaseId, recipientId: userId, version: updated.version });
      return { id: updated.id, version: updated.version, receivedAt: updated.receivedAt, receipt: { id: receipt.id, recordedAt: receipt.createdAt } };
    });
  });
}
