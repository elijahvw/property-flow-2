import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import {
  input,
  mutation,
  scoped,
  version,
  conflict,
  audit,
} from "./operational.js";
import {
  propertySelect,
  propertyData,
  propertyKeys,
} from "./property-fields.js";
export function registerPropertyDetail(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate };
  server.get<{ Params: { propertyId: string } }>(
    "/api/company/properties/:propertyId",
    auth,
    (request) => {
      const id = assignmentId(request.params.propertyId);
      return scoped(db, request, "property.read", async (tx, companyId, propertyIds) => {
        if (propertyIds && !propertyIds.includes(id)) throw new AccessError(404, "NOT_FOUND", "Property not found.");
        const row = await tx.property.findFirst({
          where: { id, companyId },
          select: propertySelect,
        });
        if (!row)
          throw new AccessError(404, "NOT_FOUND", "Property not found.");
        await audit(tx, request, companyId, id, "property.viewed");
        return row;
      });
    },
  );
  server.patch<{ Params: { propertyId: string } }>(
    "/api/company/properties/:propertyId",
    auth,
    (request) => {
      mutation(request, origin);
      const id = assignmentId(request.params.propertyId);
      return scoped(db, request, "property.write", async (tx, companyId) => {
        const previous = await tx.property.findFirst({
          where: { id, companyId },
          select: propertySelect,
        });
        if (!previous)
          throw new AccessError(404, "NOT_FOUND", "Property not found.");
        const b = input(request, [...propertyKeys, "expectedVersion"]),
          expectedVersion = version(b.expectedVersion),
          data = propertyData(b);
        const updated = await tx.property.updateMany({
          where: { id, companyId, version: expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw conflict();
        await audit(tx, request, companyId, id, "property.updated");
        return tx.property.findFirstOrThrow({
          where: { id, companyId },
          select: propertySelect,
        });
      });
    },
  );
}
