import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId, opaqueUserId } from "./application.js";
import { audit, choice, conflict, input, mutation, scoped, version } from "./operational.js";

export function registerStaffPropertyAccess(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string) {
  const auth = { preValidation: authenticate };
  server.get<{ Params: { userId: string } }>("/api/company/members/:userId/property-access", auth, request => {
    const userId = opaqueUserId(request.params.userId);
    return scoped(db, request, "members.manage", async (tx, companyId) => {
      const member = await tx.companyMembership.findFirst({ where: { companyId, userId, role: "staff" }, select: { version: true, staffPropertyScope: true, maintenanceExecution: true } });
      if (!member) throw new AccessError(404, "NOT_FOUND", "Staff member not found.");
      const [properties, grants, history] = await Promise.all([
        tx.property.findMany({ where: { companyId }, select: { id: true, name: true, address: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
        tx.staffPropertyAccess.findMany({ where: { companyId, userId }, select: { propertyId: true }, orderBy: { propertyId: "asc" } }),
        tx.auditEvent.findMany({ where: { companyId, targetId: userId, action: "staff.property_access.updated" }, select: { id: true, actorId: true, createdAt: true, detail: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10 }),
      ]);
      const actors = await tx.user.findMany({ where: { id: { in: [...new Set(history.map(h => h.actorId))] } }, select: { id: true, name: true } });
      return { expectedVersion: member.version, scope: member.staffPropertyScope, maintenanceExecution: member.maintenanceExecution, propertyIds: grants.map(g => g.propertyId), properties, history: history.map(({ actorId, ...event }) => ({ ...event, actorName: actors.find(a => a.id === actorId)?.name || "Company administrator" })) };
    });
  });
  server.put<{ Params: { userId: string } }>("/api/company/members/:userId/property-access", auth, request => {
    mutation(request, origin);
    const userId = opaqueUserId(request.params.userId), b = input(request, ["scope", "propertyIds", "expectedVersion", "maintenanceExecution"]);
    const scope = choice(b.scope, ["all", "selected"], "property scope"), expectedVersion = version(b.expectedVersion);
    if (!Array.isArray(b.propertyIds) || b.propertyIds.length > 5000) throw new AccessError(400, "INVALID_INPUT", "Choose up to 5,000 properties.");
    if (b.maintenanceExecution !== undefined && typeof b.maintenanceExecution !== "boolean") throw new AccessError(400, "INVALID_INPUT", "Choose whether maintenance execution is allowed.");
    const propertyIds = b.propertyIds.map(assignmentId).sort();
    if (new Set(propertyIds).size !== propertyIds.length || (scope === "all" && propertyIds.length)) throw new AccessError(400, "INVALID_INPUT", "Choose each property once, or use all properties.");
    return scoped(db, request, "members.manage", async (tx, companyId) => {
      // The same fence protects fresh staff reads and every membership mutation.
      await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${userId} RETURNING id`;
      const member = await tx.companyMembership.findFirst({ where: { companyId, userId, role: "staff" } });
      if (!member) throw new AccessError(404, "NOT_FOUND", "Staff member not found.");
      const maintenanceExecution = b.maintenanceExecution === undefined ? member.maintenanceExecution : b.maintenanceExecution as boolean;
      const account = await tx.user.findUniqueOrThrow({where:{id:userId},select:{status:true}});
      if (maintenanceExecution && (member.status !== "active" || account.status !== "active")) throw new AccessError(409,"ACCOUNT_DISABLED","Activate the staff account and membership before granting maintenance execution.");
      const previousIds = (await tx.staffPropertyAccess.findMany({ where: { companyId, userId }, select: { propertyId: true }, orderBy: { propertyId: "asc" } })).map(g => g.propertyId);
      // An identical PUT retry after a lost response has no new side effects.
      if (member.maintenanceExecution === maintenanceExecution && member.staffPropertyScope === scope && JSON.stringify(previousIds) === JSON.stringify(propertyIds)) return { version: member.version };
      if (member.version !== expectedVersion) throw conflict();
      if (await tx.property.count({ where: { companyId, id: { in: propertyIds } } }) !== propertyIds.length) throw new AccessError(404, "NOT_FOUND", "A selected property is unavailable in this company. Reload before saving.");
      await tx.staffPropertyAccess.deleteMany({ where: { companyId, userId } });
      if (propertyIds.length) await tx.staffPropertyAccess.createMany({ data: propertyIds.map(propertyId => ({ companyId, userId, propertyId })) });
      const updated = await tx.companyMembership.update({ where: { userId }, data: { staffPropertyScope: scope, maintenanceExecution, version: { increment: 1 } }, select: { version: true } });
      await audit(tx, request, companyId, userId, "staff.property_access.updated", { from: { scope: member.staffPropertyScope, propertyIds: previousIds }, to: { scope, propertyIds }, version: updated.version });
      if (member.maintenanceExecution !== maintenanceExecution) await audit(tx, request, companyId, userId, "staff.maintenance_access.updated", {enabled:maintenanceExecution,version:updated.version});
      return updated;
    });
  });
}
