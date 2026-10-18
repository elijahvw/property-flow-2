import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessError, companyScope, type Permission } from "./access.js";
import { assignmentId, serializable } from "./application.js";
export type Tx = Prisma.TransactionClient;
export function input(request: FastifyRequest, keys: string[]) {
  const value = request.body;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)))
    throw new AccessError(400, "INVALID_INPUT", "Submit only the requested fields.");
  return value as Record<string, unknown>;
}
export function boundedText(value: unknown, max: number, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
    throw new AccessError(400, "INVALID_INPUT", `${label} is required (maximum ${max} characters).`);
  return value.trim();
}
export function choice(value: unknown, values: string[], label: string) {
  if (typeof value !== "string" || !values.includes(value)) throw new AccessError(400, "INVALID_INPUT", `Choose a valid ${label}.`);
  return value;
}
export function cents(value: unknown) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,6})(\.[0-9]{1,2})?$/.test(value))
    throw new AccessError(400, "INVALID_INPUT", "Enter a USD amount with at most two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (result > 100000000) throw new AccessError(400, "INVALID_INPUT", "Amount must not exceed USD 1,000,000.");
  return result;
}
export function date(value: unknown, label: string): Date {
  if (typeof value !== "string" || !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value))
    throw new AccessError(400, "INVALID_INPUT", `Enter ${label} as YYYY-MM-DD.`);
  const result = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value)
    throw new AccessError(400, "INVALID_INPUT", `Choose a valid ${label}.`);
  return result;
}
export function version(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new AccessError(400, "INVALID_INPUT", "A record version is required.");
  return Number(value);
}
export function submission(value: unknown, payload: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new AccessError(400, "INVALID_INPUT", "A UUID submission key is required.");
  return { submissionKey: value.toLowerCase(), submissionHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
}
export function sameSubmission(stored: string, actual: string) {
  if (stored !== actual) throw new AccessError(409, "SUBMISSION_MISMATCH", "This submission key was used with different details. Restore the original details to retry, or start a new record.");
}
export function mutation(request: FastifyRequest, origin: string) {
  if (request.headers.origin !== origin || !request.appSession || request.headers["x-csrf-token"] !== request.appSession.csrfToken)
    throw new AccessError(403, "CSRF_INVALID", "Refresh and try again.");
}
export function scoped<T>(db: PrismaClient, request: FastifyRequest, permission: Permission, run: (tx: Tx, companyId: string, propertyIds: string[] | null) => Promise<T>) {
  const companyId = companyScope(request.principal!, permission, request.headers["x-company-id"]);
  return serializable(db, async tx => {
    // Reads share the authorization fence; concurrent panels must not write-conflict
    // with one another. Access mutations still need the exclusive user fence,
    // and either fence blocks a queued role change until this transaction ends.
    if (request.method === "GET") await tx.$queryRaw`SELECT id FROM "User" WHERE id=${request.principal!.id} FOR SHARE`;
    else await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${request.principal!.id} RETURNING id`;
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId} FOR SHARE`;
    const current = await tx.user.findUnique({ where: { id: request.principal!.id }, include: { membership: { include: { company: true } } } });
    if (!current) throw new AccessError(403, "ACCESS_DENIED", "Access is unavailable.");
    companyScope(current, permission, companyId);
    await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    const propertyIds = current.membership?.role === "staff" && current.membership.staffPropertyScope === "selected"
      ? (await tx.staffPropertyAccess.findMany({ where: { companyId, userId: current.id }, select: { propertyId: true } })).map(g => g.propertyId)
      : null;
    return run(tx, companyId, propertyIds);
  });
}
export type AuditRequest = { id: string; principal?: { id: string } };
export function audit(tx: Tx, request: AuditRequest, companyId: string, targetId: string, action: string, detail?: Prisma.InputJsonValue) {
  return tx.auditEvent.create({ data: { actorId: request.principal!.id, companyId, targetId, action, requestId: request.id, detail } });
}
export function paging(query: { cursor?: string }) {
  if (Object.keys(query).some(k => k !== "cursor")) throw new AccessError(400, "INVALID_INPUT", "Unknown filter.");
  return query.cursor === undefined ? undefined : assignmentId(query.cursor);
}
export function page<T extends { id: string }>(rows: T[]) {
  const items = rows.slice(0, 50);
  return { items, nextCursor: rows.length > 50 ? items[items.length - 1].id : null };
}
export function conflict() { return new AccessError(409, "RECORD_CHANGED", "This record changed. Reload the list before editing again."); }
