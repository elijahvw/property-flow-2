import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError, companyScope } from "./access.js";
import { tenantTransaction } from "./application.js";

const fields = { name: 200, address: 200, city: 200, state: 100, zip: 30 } as const;
const select = { id: true, name: true, address: true, city: true, state: true, zip: true };
function propertyId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value))
    throw new AccessError(400, "INVALID_INPUT", "Invalid property ID.");
  return value;
}
function propertyInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AccessError(400, "INVALID_INPUT", "Property details are required.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !Object.hasOwn(fields, key)))
    throw new AccessError(400, "INVALID_INPUT", "Only property name and address fields can be changed.");
  const result = {} as Record<keyof typeof fields, string>;
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    const value = input[key];
    if (typeof value !== "string" || !value.trim() || value.length > fields[key])
      throw new AccessError(400, "INVALID_INPUT", `${key} is required and must be at most ${fields[key]} characters.`);
    result[key] = value.trim();
  }
  return result;
}
export function registerPropertyDetail(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler) {
  for (const method of ["GET", "PATCH"] as const) {
    server.route<{ Params: { propertyId: string } }>({
      method, url: "/api/company/properties/:propertyId", preValidation: authenticate,
      handler: async request => {
        const permission = method === "GET" ? "property.read" : "property.write";
        const companyId = companyScope(request.principal!, permission, request.headers["x-company-id"]);
        const id = propertyId(request.params.propertyId);
        const data = method === "PATCH" ? propertyInput(request.body) : undefined;
        return tenantTransaction(db, companyId, async tx => {
          const where = { id, companyId };
          const property = await tx.property.findFirst({ where, select });
          if (!property) throw new AccessError(404, "NOT_FOUND", "Property not found.");
          let result = property;
          if (data) {
            // Keep the company predicate on the write as well as the lookup and RLS.
            const updated = await tx.property.updateMany({ where, data });
            if (updated.count !== 1) throw new AccessError(404, "NOT_FOUND", "Property not found.");
            result = { ...property, ...data };
          }
          await tx.auditEvent.create({ data: {
            actorId: request.principal!.id, companyId, targetId: id,
            action: data ? "property.updated" : "property.viewed", requestId: request.id,
          } });
          return result;
        }, { id: request.principal!.id, permission });
      },
    });
  }
}
