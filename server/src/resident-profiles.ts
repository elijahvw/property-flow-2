import { contactDirectory } from "./contact-records.js";
import { linkedResidentContact, residentCompatibilityProfile } from "./resident-contacts.js";
import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { opaqueUserId } from "./application.js";
import { registerResidentWorkspace } from "./resident-workspace.js";
import { readTenantDirectory, readTenantRentals, tenantDirectoryQuery, tenantRentalQuery } from "./tenant-directory.js";
import {
  audit,
  boundedText,
  conflict,
  input,
  mutation,
  scoped,
  version,
} from "./operational.js";

const limits = {
  contactName: 200,
  contactPhone: 40,
  emergencyContactName: 200,
  emergencyContactPhone: 40,
  managementNotes: 2000,
} as const;
export function residentProfile(body: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(limits).map(([key, max]) => {
      const value = body[key];
      return [
        key,
        value === undefined || value === null || value === ""
          ? null
          : boundedText(value, max, key),
      ];
    }),
  );
}
const select = {
  userId: true,
  companyId: true,
  role: true,
  status: true,
  version: true,
  contactName: true,
  contactPhone: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  managementNotes: true,
  user: {
    select: { name: true, email: true, status: true, emailVerified: true },
  },
} as const;

export function registerResidentProfiles(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate };
  registerResidentWorkspace(server, db, authenticate);
  server.get("/api/company/resident-profiles", auth, (request) =>
    scoped(db, request, "resident.assignment.manage", (tx, companyId) =>
      contactDirectory(tx, companyId),
    ),
  );
  server.get("/api/company/resident-profiles/directory", auth, (request) => {
    const query = tenantDirectoryQuery(request.query as Record<string, unknown>);
    return scoped(db, request, "resident.assignment.manage", (tx, companyId) =>
      readTenantDirectory(tx, companyId, request.principal!.id, query),
    );
  });
  server.get<{ Params: { userId: string } }>("/api/company/resident-profiles/:userId/rentals", auth, (request) => {
    const id = opaqueUserId(request.params.userId), query = tenantRentalQuery(request.query as Record<string, unknown>);
    return scoped(db, request, "resident.assignment.manage", (tx, companyId) =>
      readTenantRentals(tx, companyId, request.principal!.id, { kind: "resident", id }, query),
    );
  });
  server.get<{ Params: { userId: string } }>(
    "/api/company/resident-profiles/:userId",
    auth,
    (request) => {
      const userId = opaqueUserId(request.params.userId);
      return scoped(
        db,
        request,
        "resident.assignment.manage",
        async (tx, companyId) => {
          const member = await tx.companyMembership.findFirst({
            where: { userId, companyId, role: "resident" },
            select,
          });
          if (!member)
            throw new AccessError(
              404,
              "NOT_FOUND",
              "Resident not found in this company.",
            );
          const assignments = await tx.residentPropertyAssignment.findMany({
            where: { userId, companyId },
            select: {
              property: { select: { id: true, name: true, address: true } },
            },
          });
          const activity = await tx.auditEvent.findMany({
            where: { companyId, OR: [{targetId:userId},{actorId:userId}] },
            select: { id: true, action: true, createdAt: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 100,
          });
          const contact = await tx.residentContact.findFirst({ where:{companyId,userId}, select:{id:true} });
          return { ...member, contactId:contact?.id || null, assignments, activity };
        },
      );
    },
  );
  server.patch<{ Params: { userId: string } }>(
    "/api/company/resident-profiles/:userId",
    auth,
    (request) => {
      mutation(request, origin);
      const userId = opaqueUserId(request.params.userId),
        body = input(request, ["expectedVersion", ...Object.keys(limits)]);
      const expectedVersion = version(body.expectedVersion),
        profile = residentProfile(body);
      return scoped(
        db,
        request,
        "resident.assignment.manage",
        async (tx, companyId) => {
          await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${userId} RETURNING id`;
          const member = await tx.companyMembership.findFirst({
            where: { userId, companyId, role: "resident" },
            select: { version: true },
          });
          if (!member)
            throw new AccessError(
              404,
              "NOT_FOUND",
              "Resident not found in this company.",
            );
          if (member.version !== expectedVersion) throw conflict();
          const result = await tx.companyMembership.update({
            where: { userId },
            data: { ...profile, version: { increment: 1 } },
            select,
          });
          const contact = await linkedResidentContact(tx, companyId, userId);
          await tx.residentContact.update({ where: { id: contact.id }, data: {
            name: result.contactName ?? Array.from(result.user.name?.trim() || result.user.email.trim() || "Resident").slice(0, 200).join(""),
            phone: result.contactPhone,
            emergencyContactName: result.emergencyContactName,
            emergencyContactPhone: result.emergencyContactPhone,
            managementNotes: result.managementNotes,
            compatibilityProfile: residentCompatibilityProfile(result),
            version: { increment: 1 },
          } });
          // Contact values and internal notes do not belong in the event payload.
          await audit(
            tx,
            request,
            companyId,
            userId,
            "resident.profile.updated",
          );
          return result;
        },
      );
    },
  );
}
