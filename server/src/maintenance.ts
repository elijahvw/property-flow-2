import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessError, companyScope } from "./access.js";
import { assignmentId, serializable } from "./application.js";
const statuses = ["open", "in_progress", "resolved"];
const select = { id: true, propertyId: true, title: true, description: true, priority: true, status: true, createdAt: true, updatedAt: true, property: { select: { name: true } } } as const;
function choice(value: unknown, values: string[], label: string) {
  if (typeof value !== "string" || !values.includes(value)) throw new AccessError(400, "INVALID_INPUT", `Choose a valid ${label}.`);
  return value;
}
function body(request: FastifyRequest, keys: string[]) {
  const b = request.body;
  if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).some(k => !keys.includes(k))) throw new AccessError(400, "INVALID_INPUT", "Submit only the requested fields.");
  return b as Record<string, unknown>;
}
function text(value: unknown, max: number, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new AccessError(400, "INVALID_INPUT", `${label} is required (maximum ${max} characters).`);
  return value.trim();
}
export function registerMaintenance(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string) {
  const auth = { preValidation: authenticate };
  const mutate = (request: FastifyRequest) => {
    if (request.headers.origin !== origin || !request.appSession || request.headers["x-csrf-token"] !== request.appSession.csrfToken)
      throw new AccessError(403, "CSRF_INVALID", "Refresh and try again.");
  };
  // Lock before rereading access. Revocation uses the same User tuple; Serializable
  // retries discard a snapshot taken before a competing revocation committed.
  const scoped = <T>(request: FastifyRequest, resident: boolean, run: (tx: Prisma.TransactionClient, companyId: string) => Promise<T>) => {
    const permission = resident ? "resident.self" : "maintenance.manage";
    const companyId = companyScope(request.principal!, permission, request.headers["x-company-id"]);
    return serializable(db, async tx => {
      await tx.$queryRaw`UPDATE "User" SET "updatedAt" = "updatedAt" WHERE id = ${request.principal!.id} RETURNING id`;
      // SHARE conflicts with Company status UPDATEs but permits parallel maintenance
      // by different users. Serializable rejects a company changed since this snapshot.
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR SHARE`;
      const current = await tx.user.findUnique({ where: { id: request.principal!.id }, include: { membership: { include: { company: true } } } });
      if (!current) throw new AccessError(403, "ACCESS_DENIED", "Access is unavailable.");
      companyScope(current, permission, companyId);
      await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
      return run(tx, companyId);
    });
  };
  const audit = (tx: Prisma.TransactionClient, request: FastifyRequest, companyId: string, targetId: string, action: string, detail?: Prisma.InputJsonValue) => tx.auditEvent.create({ data: { companyId, targetId, actorId: request.principal!.id, action, detail, requestId: request.id } });
  server.post("/api/resident/maintenance", auth, async request => {
    mutate(request);
    const b = body(request, ["propertyId", "title", "description", "priority", "submissionKey"]);
    const propertyId = assignmentId(b.propertyId), title = text(b.title, 160, "Title"), description = text(b.description, 4000, "Description"), priority = choice(b.priority, ["low", "normal", "high"], "priority");
    const key = b.submissionKey;
    if (typeof key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))
      throw new AccessError(400, "INVALID_INPUT", "A UUID submission key is required.");
    const submissionKey = key.toLowerCase();
    const submissionHash = createHash("sha256").update(JSON.stringify([propertyId, title, description, priority])).digest("hex");
    return scoped(request, true, async (tx, companyId) => {
      // The shared requester write lock serializes replay/create and revocation.
      // Persist the fingerprint with the request and audit in the same transaction.
      const previous = await tx.maintenanceRequest.findFirst({ where: { companyId, requesterId: request.principal!.id, submissionKey }, select: { ...select, submissionHash: true } });
      if (previous) {
        const authorized = await tx.residentPropertyAssignment.findFirst({ where: { companyId, propertyId: previous.propertyId, userId: request.principal!.id } });
        if (!authorized) throw new AccessError(404, "NOT_FOUND", "Assigned property not found.");
        if (previous.submissionHash !== submissionHash) throw new AccessError(409, "SUBMISSION_MISMATCH", "This submission was already used with different details. Restore the original details to retry, or start a new request.");
        const { submissionHash: _hash, ...row } = previous;
        return row;
      }
      const assignment = await tx.residentPropertyAssignment.findFirst({ where: { companyId, propertyId, userId: request.principal!.id } });
      if (!assignment) throw new AccessError(404, "NOT_FOUND", "Assigned property not found.");
      const row = await tx.maintenanceRequest.create({ data: { companyId, propertyId, requesterId: request.principal!.id, title, description, priority, submissionKey, submissionHash }, select });
      await audit(tx, request, companyId, row.id, "maintenance.created", { propertyId, priority });
      return row;
    });
  });
  for (const resident of [true, false]) server.get<{ Querystring: { status?: string; propertyId?: string } }>(resident ? "/api/resident/maintenance" : "/api/company/maintenance", auth, async request => {
    if (Object.keys(request.query).some(k => !["status", "propertyId"].includes(k))) throw new AccessError(400, "INVALID_INPUT", "Unknown filter.");
    const status = request.query.status === undefined ? undefined : choice(request.query.status, ["unresolved",...statuses], "status");
    const propertyId = request.query.propertyId === undefined ? undefined : assignmentId(request.query.propertyId);
    return scoped(request, resident, async (tx, companyId) => {
      if (propertyId && !await tx.property.findFirst({ where: { id: propertyId, companyId } })) throw new AccessError(404, "NOT_FOUND", "Property not found.");
      return tx.maintenanceRequest.findMany({ where: { companyId, status:status==="unresolved"?{in:["open","in_progress"]}:status, propertyId, ...(resident ? { requesterId: request.principal!.id, property: { assignments: { some: { companyId, userId: request.principal!.id } } } } : {}) }, select, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    });
  });
  server.patch<{ Params: { requestId: string } }>("/api/company/maintenance/:requestId", auth, async request => {
    mutate(request);
    const id = assignmentId(request.params.requestId), status = choice(body(request, ["status"]).status, statuses, "status");
    return scoped(request, false, async (tx, companyId) => {
      const previous = await tx.maintenanceRequest.findFirst({ where: { id, companyId }, select: { status: true } });
      if (!previous) throw new AccessError(404, "NOT_FOUND", "Request not found.");
      const row = await tx.maintenanceRequest.update({ where: { id }, data: { status }, select });
      if (previous.status !== status) await audit(tx, request, companyId, id, "maintenance.status.changed", { from: previous.status, to: status });
      return row;
    });
  });
}
