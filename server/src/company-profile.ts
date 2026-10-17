import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError, companyRoleGuide } from "./access.js";
import { companyProfile } from "./company-administration.js";
import {
  audit,
  boundedText,
  conflict,
  input,
  mutation,
  sameSubmission,
  scoped,
  submission,
  version,
} from "./operational.js";
const keys = [
  "name",
  "legalName",
  "contactName",
  "contactEmail",
  "contactPhone",
  "website",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "country",
  "timezone",
];
const select = {
  id: true,
  name: true,
  legalName: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  website: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  region: true,
  postalCode: true,
  country: true,
  timezone: true,
  version: true,
  updatedAt: true,
  status: true,
  domain: true,
} as const;
export function registerCompanyProfile(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate };
  server.get("/api/company/roles", auth, (request) =>
    scoped(db, request, "company.manage", async () => ({
      roles: companyRoleGuide(),
    })),
  );
  server.get("/api/company", auth, (request) =>
    scoped(db, request, "company.manage", async (tx, companyId) =>
      tx.company.findUniqueOrThrow({ where: { id: companyId }, select }),
    ),
  );
  server.get("/api/company/profile-history", auth, (request) =>
    scoped(db, request, "company.manage", async (tx, companyId) => {
      const b = request.query as Record<string, unknown>;
      if (
        Object.keys(b).some((k) => k !== "beforeVersion") ||
        (b.beforeVersion !== undefined &&
          !/^[1-9]\d{0,8}$/.test(String(b.beforeVersion)))
      )
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Choose a valid company history page.",
        );
      const rows = await tx.companyProfileRevision.findMany({
        where: {
          companyId,
          ...(b.beforeVersion
            ? { version: { lt: Number(b.beforeVersion) } }
            : {}),
        },
        select: {
          id: true,
          version: true,
          before: true,
          after: true,
          createdById: true,
          createdAt: true,
        },
        orderBy: { version: "desc" },
        take: 51,
      });
      const actors = await tx.user.findMany({
        where: { id: { in: rows.map((r) => r.createdById) } },
        select: { id: true, name: true, email: true },
      });
      return {
        items: rows.slice(0, 50).map((r) => ({
          ...r,
          actor:
            actors.find((a) => a.id === r.createdById)?.name ||
            actors.find((a) => a.id === r.createdById)?.email ||
            "Recorded user",
        })),
        nextBeforeVersion: rows.length > 50 ? rows[49].version : null,
      };
    }),
  );
  server.patch("/api/company", auth, (request) => {
    mutation(request, origin);
    const b = input(request, [...keys, "expectedVersion", "submissionKey"]),
      legacy = Object.keys(b).length === 1 && Object.hasOwn(b, "name"),
      name = boundedText(b.name, 200, "Company name"),
      expected = legacy ? null : version(b.expectedVersion);
    // The platform-only adminNotes field never enters this owner's write surface.
    const parsed = legacy ? { name } : companyProfile(b),
      { adminNotes: _notes, ...profile } = parsed as ReturnType<
        typeof companyProfile
      >;
    const key = legacy
      ? null
      : submission(b.submissionKey, [profile, expected]);
    return scoped(db, request, "company.manage", async (tx, companyId) => {
      if (key) {
        const old = await tx.companyProfileRevision.findFirst({
          where: {
            companyId,
            createdById: request.principal!.id,
            submissionKey: key.submissionKey,
          },
        });
        if (old) {
          sameSubmission(old.submissionHash, key.submissionHash);
          return { saved: true, version: old.version };
        }
      }
      const before = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select,
      });
      if (expected !== null && before.version !== expected) throw conflict();
      const after = await tx.company.update({
        where: { id: companyId },
        data: { ...profile, version: { increment: 1 } },
        select,
      });
      if (key)
        await tx.companyProfileRevision.create({
          data: {
            companyId,
            version: after.version,
            before: JSON.parse(JSON.stringify(before)),
            after: JSON.parse(JSON.stringify(after)),
            createdById: request.principal!.id,
            ...key,
          },
        });
      await audit(
        tx,
        request,
        companyId,
        companyId,
        "company.profile.updated",
        {
          fromVersion: before.version,
          toVersion: after.version,
          fields: keys.filter(
            (k) =>
              before[k as keyof typeof before] !==
              after[k as keyof typeof after],
          ),
        },
      );
      return after;
    });
  });
}
