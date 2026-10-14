import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { opaqueUserId } from "./application.js";
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
  server.get("/api/company/resident-profiles", auth, (request) =>
    scoped(db, request, "resident.assignment.manage", (tx, companyId) =>
      tx.companyMembership.findMany({
        where: { companyId, role: "resident" },
        select,
        orderBy: { user: { email: "asc" } },
      }),
    ),
  );
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
            where: { companyId, targetId: userId },
            select: { id: true, action: true, createdAt: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 100,
          });
          return { ...member, assignments, activity };
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
