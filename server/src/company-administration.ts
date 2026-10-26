import type {
  FastifyInstance,
  FastifyRequest,
  preValidationHookHandler,
} from "fastify";
import type { PrismaClient } from "@prisma/client";
import { membershipAccessSelect } from "./membership-view.js";
import { AccessError, requirePermission } from "./access.js";
import { assignmentId, serializable } from "./application.js";
import {
  boundedText,
  input,
  mutation,
  sameSubmission,
  submission,
  version,
  conflict,
  type Tx,
} from "./operational.js";
const lengths = {
  legalName: 200,
  contactName: 200,
  contactEmail: 254,
  contactPhone: 40,
  website: 500,
  addressLine1: 200,
  addressLine2: 200,
  city: 100,
  region: 100,
  postalCode: 30,
  country: 2,
  adminNotes: 2000,
} as const;
export function companyProfile(body: Record<string, unknown>) {
  const result: Record<keyof typeof lengths, string | null> = {} as any;
  for (const key of Object.keys(lengths) as (keyof typeof lengths)[]) {
    const value = body[key];
    result[key] =
      value === undefined || value === null || value === ""
        ? null
        : boundedText(value, lengths[key], key);
  }
  if (result.contactEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.contactEmail))
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Enter a valid contact email.",
      );
    result.contactEmail = result.contactEmail.toLowerCase();
  }
  if (result.country) {
    if (!/^[A-Za-z]{2}$/.test(result.country))
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Country must be a two-letter code.",
      );
    result.country = result.country.toUpperCase();
  }
  if (result.website) {
    let url: URL;
    try {
      url = new URL(result.website);
    } catch {
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Enter a complete website URL.",
      );
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Website must use http or https without credentials.",
      );
    result.website = url.href;
  }
  const timezone =
    body.timezone === undefined
      ? "America/New_York"
      : boundedText(body.timezone, 80, "Timezone");
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Choose a valid IANA timezone.",
    );
  }
  return {
    name: boundedText(body.name, 200, "Company name"),
    ...result,
    timezone,
  };
}
export function registerCompanyAdministration(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate };
  const platform = (request: FastifyRequest) =>
    requirePermission(request.principal!, "platform.manage");
  async function checked<T>(
    request: FastifyRequest,
    run: (tx: Tx) => Promise<T>,
  ) {
    platform(request);
    return serializable(db, async (tx) => {
      await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${request.principal!.id} RETURNING id`;
      const actor = await tx.user.findUnique({
        where: { id: request.principal!.id },
        include: { membership: { include: { company: true } } },
      });
      if (!actor)
        throw new AccessError(403, "ACCESS_DENIED", "Access is unavailable.");
      requirePermission(actor, "platform.manage");
      return run(tx);
    });
  }
  const publicRow = (row: any) => {
    const { submissionKey, submissionHash, createdById, deletionSubmissionKey, deletionSubmissionHash, deletedById, ...safe } = row;
    return safe;
  };
  const audit = (
    tx: Tx,
    request: FastifyRequest,
    companyId: string,
    action: string,
  ) =>
    tx.auditEvent.create({
      data: {
        actorId: request.principal!.id,
        companyId,
        targetId: companyId,
        action,
        requestId: request.id,
      },
    });
  server.get("/api/platform/companies", auth, (request) =>
    checked(request, async (tx) =>
      (
        await tx.company.findMany({
          where: { status: { not: "deleted" } },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          include: {
            _count: { select: { memberships: true, properties: true } },
          },
        })
      ).map(publicRow),
    ),
  );
  server.get<{ Params: { companyId: string } }>(
    "/api/platform/companies/:companyId",
    auth,
    (request) =>
      checked(request, async (tx) => {
        const row = await tx.company.findUnique({
          where: { id: assignmentId(request.params.companyId) },
          include: {
            memberships: {
              select: {
                ...membershipAccessSelect,
                user: {
                  select: {
                    id: true,
                    email: true,
                    name: true,
                    status: true,
                    emailVerified: true,
                  },
                },
              },
            },
          },
        });
        if (!row) throw new AccessError(404, "NOT_FOUND", "Company not found.");
        await audit(tx, request, row.id, "platform.company.viewed");
        return publicRow(row);
      }),
  );
  server.post("/api/platform/companies", auth, (request) => {
    platform(request);
    mutation(request, origin);
    const body = input(request, [
        "name",
        ...Object.keys(lengths),
        "timezone",
        "submissionKey",
      ]),
      profile = companyProfile(body),
      key = submission(body.submissionKey, profile);
    return checked(request, async (tx) => {
      const previous = await tx.company.findFirst({
        where: {
          createdById: request.principal!.id,
          submissionKey: key.submissionKey,
        },
      });
      if (previous) {
        sameSubmission(previous.submissionHash!, key.submissionHash);
        return publicRow(previous);
      }
      const row = await tx.company.create({
        data: { ...profile, ...key, createdById: request.principal!.id },
      });
      await audit(tx, request, row.id, "company.created");
      return publicRow(row);
    });
  });
  server.delete<{ Params: { companyId: string } }>(
    "/api/platform/companies/:companyId", auth, request => {
      platform(request);
      mutation(request, origin);
      const id = assignmentId(request.params.companyId),
        body = input(request, ["expectedVersion", "confirmationName", "submissionKey"]),
        expectedVersion = version(body.expectedVersion),
        confirmationName = boundedText(body.confirmationName, 200, "Company name confirmation"),
        key = submission(body.submissionKey, { id, expectedVersion, confirmationName });
      return checked(request, async tx => {
        // This fence also serializes membership assignment and company operations.
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${id} FOR UPDATE`;
        const company = await tx.company.findUnique({ where: { id }, include: { salesDemo: { include: { setup: { select: { status: true } } } } } });
        if (!company) throw new AccessError(404, "NOT_FOUND", "Company not found.");
        if (company.status === "deleted") {
          if (company.deletedById !== request.principal!.id || company.deletionSubmissionKey !== key.submissionKey)
            throw new AccessError(409, "COMPANY_DELETED", "This company was already deleted.");
          sameSubmission(company.deletionSubmissionHash!, key.submissionHash);
          const { salesDemo, ...row } = company;
          return publicRow(row);
        }
        if (company.version !== expectedVersion) throw conflict();
        if (confirmationName !== company.name) throw new AccessError(400, "INVALID_INPUT", "Enter the exact company name to confirm deletion.");
        if (company.salesDemo && (company.salesDemo.status !== "retired" || company.salesDemo.setup && company.salesDemo.setup.status !== "retired"))
          throw new AccessError(409, "DEMO_TEARDOWN_REQUIRED", "Tear down this sales demo first so its generated sign-in accounts are disabled safely, then delete the company.");
        const members = await tx.companyMembership.findMany({ where: { companyId: id }, select: { userId: true } });
        await tx.companyMembership.updateMany({ where: { companyId: id }, data: { status: "disabled", version: { increment: 1 } } });
        await tx.invitation.updateMany({ where: { companyId: id, revokedAt: null, acceptedAt: null }, data: { revokedAt: new Date(), version: { increment: 1 } } });
        await tx.session.deleteMany({ where: { OR: [{ userId: { in: members.map(m => m.userId) } }, { impersonatedUserId: { in: members.map(m => m.userId) } }, { impersonationCompanyId: id }] } });
        const row = await tx.company.update({ where: { id }, data: { status: "deleted", deletedAt: new Date(), deletedById: request.principal!.id,
          deletionSubmissionKey: key.submissionKey, deletionSubmissionHash: key.submissionHash, version: { increment: 1 } } });
        await audit(tx, request, id, "company.deleted");
        return publicRow(row);
      });
    },
  );
  server.patch<{ Params: { companyId: string } }>(
    "/api/platform/companies/:companyId",
    auth,
    (request) => {
      platform(request);
      mutation(request, origin);
      const id = assignmentId(request.params.companyId),
        body = input(request, [
          "name",
          ...Object.keys(lengths),
          "timezone",
          "status",
          "expectedVersion",
        ]),
        profile = companyProfile(body),
        expectedVersion = version(body.expectedVersion);
      if (!["active", "suspended"].includes(body.status as string))
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Choose a valid company status.",
        );
      return checked(request, async (tx) => {
        const previous = await tx.company.findUnique({ where: { id } });
        if (!previous)
          throw new AccessError(404, "NOT_FOUND", "Company not found.");
        if (previous.status === "deleted") throw new AccessError(409, "COMPANY_DELETED", "This company was deleted and cannot be reactivated.");
        const result = await tx.company.updateMany({
          where: { id, version: expectedVersion },
          data: {
            ...profile,
            status: body.status as string,
            version: { increment: 1 },
          },
        });
        if (result.count !== 1) throw conflict();
        await audit(tx, request, id, "company.updated");
        return publicRow(await tx.company.findUniqueOrThrow({ where: { id } }));
      });
    },
  );
}
