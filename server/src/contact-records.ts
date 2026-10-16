import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { companyDay } from "./reports.js";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
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
  type Tx,
} from "./operational.js";
import {
  preserveResidentContactProfile,
  residentCompatibilityProfile,
} from "./resident-contacts.js";

const limits = {
  name: 200,
  preferredName: 200,
  email: 254,
  phone: 40,
  alternatePhone: 40,
  addressLine1: 200,
  addressLine2: 200,
  city: 100,
  region: 100,
  postalCode: 30,
  country: 100,
  emergencyContactName: 200,
  emergencyContactPhone: 40,
  emergencyRelationship: 100,
  managementNotes: 2000,
} as const;
const fields = [...Object.keys(limits), "preferredContact"];
const contactSelect = {
  id: true,
  userId: true,
  name: true,
  preferredName: true,
  email: true,
  phone: true,
  alternatePhone: true,
  preferredContact: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  region: true,
  postalCode: true,
  country: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyRelationship: true,
  managementNotes: true,
  status: true,
  version: true,
  createdAt: true,
} as const;
function details(body: Record<string, unknown>) {
  const parsed = Object.fromEntries(
    Object.entries(limits).map(([key, max]) => [
      key,
      body[key] == null || body[key] === ""
        ? null
        : boundedText(body[key], max, key),
    ]),
  ) as Record<keyof typeof limits, string | null>;
  const name = boundedText(body.name, 200, "Full name");
  if (parsed.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email))
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Enter a complete contact email.",
    );
  const preferredContact =
    body.preferredContact == null || body.preferredContact === ""
      ? null
      : body.preferredContact;
  if (
    preferredContact !== null &&
    preferredContact !== "email" &&
    preferredContact !== "phone"
  )
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Choose email, phone or no contact preference.",
    );
  if (
    (preferredContact === "email" && !parsed.email) ||
    (preferredContact === "phone" && !parsed.phone)
  )
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Add the email or phone number for the chosen contact preference.",
    );
  if (
    (parsed.emergencyContactPhone || parsed.emergencyRelationship) &&
    !parsed.emergencyContactName
  )
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Add the emergency contact's name.",
    );
  return {
    ...parsed,
    name,
    preferredContact: preferredContact as "email" | "phone" | null,
  };
}
async function portal(tx: Tx, companyId: string, userId: string | null) {
  if (!userId) return null;
  const member = await tx.companyMembership.findFirst({
    where: { userId, companyId, role: "resident" },
    select: {
      version: true,
      status: true,
      user: { select: { status: true, emailVerified: true } },
    },
  });
  return {
    userId,
    state:
      !member || member.status !== "active" || member.user.status !== "active"
        ? "disabled"
        : member.user.emailVerified
          ? "active"
          : "verification",
    membershipVersion: member?.version ?? null,
    manageable: !!member,
  };
}
export async function contactDirectory(tx: Tx, companyId: string) {
  const contacts = await tx.residentContact.findMany({
    where: { companyId },
    select: {
      id: true,
      userId: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      preferredName: true,
      version: true,
      invitations: {
        where: {
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 2001,
  });
  const members = await tx.companyMembership.findMany({
    where: { companyId, role: "resident" },
    select: {
      userId: true,
      status: true,
      version: true,
      contactName: true,
      contactPhone: true,
      user: {
        select: { name: true, email: true, status: true, emailVerified: true },
      },
    },
    orderBy: { userId: "asc" },
    take: 2001,
  });
  if (contacts.length > 2000 || members.length > 2000)
    throw new AccessError(
      422,
      "TENANT_DIRECTORY_TOO_LARGE",
      "This tenant directory exceeds 2,000 records. No partial directory is shown.",
    );
  const memberMap = new Map(members.map((m) => [m.userId, m]));
  const mapped = new Set(contacts.map((c) => c.userId).filter(Boolean));
  const result = [
    ...contacts.map((c) => {
      const member = c.userId ? memberMap.get(c.userId) : undefined;
      const state = !c.userId
        ? c.invitations.length
          ? "pending"
          : "offline"
        : !member ||
            member.status !== "active" ||
            member.user.status !== "active"
          ? "disabled"
          : member.user.emailVerified
            ? "active"
            : "verification";
      const { invitations: _invitations, ...summary } = c;
      return {
        ...summary,
        contactId: c.id,
        contactName: c.name,
        contactPhone: c.phone,
        recordStatus: c.status,
        status: member?.status ?? "offline",
        portalState: state,
        user: member?.user ?? null,
      };
    }),
    ...members
      .filter((m) => !mapped.has(m.userId))
      .map((m) => ({ ...m, recordStatus: "active" })),
  ];
  if (result.length > 2000)
    throw new AccessError(
      422,
      "TENANT_DIRECTORY_TOO_LARGE",
      "This tenant directory exceeds 2,000 records. No partial directory is shown.",
    );
  return result;
}
export function registerContactRecords(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate };
  server.post("/api/company/resident-contacts", auth, (request) => {
    mutation(request, origin);
    const b = input(request, [...fields, "submissionKey", "duplicateReviewed"]),
      data = details(b);
    if (
      b.duplicateReviewed !== undefined &&
      typeof b.duplicateReviewed !== "boolean"
    )
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Duplicate review must be true or false.",
      );
    const key = submission(b.submissionKey, data);
    return scoped(
      db,
      request,
      "resident.assignment.manage",
      async (tx, companyId) => {
        const previous = await tx.residentContact.findFirst({
          where: {
            companyId,
            createdById: request.principal!.id,
            submissionKey: key.submissionKey,
          },
          select: { ...contactSelect, submissionHash: true },
        });
        if (previous) {
          sameSubmission(previous.submissionHash!, key.submissionHash);
          const { submissionHash: _hash, ...row } = previous;
          return row;
        }
        // Serialize independent additions so an equal name/email cannot evade
        // duplicate review. No identity or financial records are ever merged.
        await tx.$queryRaw`UPDATE "Company" SET "updatedAt"="updatedAt" WHERE id=${companyId} RETURNING id`;
        const duplicate = await tx.residentContact.findFirst({
          where: {
            companyId,
            OR: [
              { name: { equals: data.name, mode: "insensitive" } },
              ...(data.email
                ? [
                    {
                      email: {
                        equals: data.email,
                        mode: "insensitive" as const,
                      },
                    },
                  ]
                : []),
            ],
          },
          select: { id: true },
        });
        if (duplicate && !b.duplicateReviewed)
          throw new AccessError(
            409,
            "POSSIBLE_DUPLICATE",
            "A tenant with this name or email already exists. Review the directory, or confirm this is a separate person before saving.",
          );
        const row = await tx.residentContact.create({
          data: {
            companyId,
            ...data,
            createdById: request.principal!.id,
            ...key,
          },
          select: contactSelect,
        });
        await audit(tx, request, companyId, row.id, "resident.contact.created");
        return row;
      },
    );
  });
  server.get<{ Params: { contactId: string } }>(
    "/api/company/resident-contacts/:contactId",
    auth,
    (request) => {
      const id = assignmentId(request.params.contactId);
      return scoped(
        db,
        request,
        "resident.assignment.manage",
        async (tx, companyId) => {
          const row = await tx.residentContact.findFirst({
            where: { id, companyId },
            select: contactSelect,
          });
          if (!row)
            throw new AccessError(
              404,
              "NOT_FOUND",
              "Tenant not found in this company.",
            );
          const activity = await tx.auditEvent.findMany({
            where: {
              companyId,
              OR: [
                { targetId: id },
                ...(row.userId
                  ? [{ targetId: row.userId }, { actorId: row.userId }]
                  : []),
              ],
            },
            select: { id: true, action: true, createdAt: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 100,
          });
          const invitations = await tx.invitation.findMany({
            where: { companyId, contactId: id },
            select: {
              id: true,
              email: true,
              expiresAt: true,
              acceptedAt: true,
              revokedAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 20,
          });
          const company = await tx.company.findUniqueOrThrow({
              where: { id: companyId },
              select: { timezone: true },
            }),
            today = new Date(companyDay(company.timezone) + "T00:00:00Z");
          const leases = await tx.leaseParticipant.findMany({
            where: {
              companyId,
              contactId: id,
              removedAt: null,
              OR: [{ endsOn: null }, { endsOn: { gte: today } }],
              lease: {
                status: { in: ["active", "draft"] },
                OR: [{ endsOn: null }, { endsOn: { gte: today } }],
              },
            },
            select: {
              id: true,
              leaseId: true,
              version: true,
              role: true,
              lease: {
                select: {
                  id: true,
                  version: true,
                  status: true,
                  startsOn: true,
                  endsOn: true,
                  property: { select: { name: true } },
                  unit: { select: { label: true } },
                },
              },
            },
            take: 101,
            orderBy: { leaseId: "asc" },
          });
          if (leases.length > 100)
            throw new AccessError(
              422,
              "INVITATION_SCOPE_TOO_LARGE",
              "Too many leases to review in one portal invitation.",
            );
          return {
            ...row,
            portal: await portal(tx, companyId, row.userId),
            invitations,
            leases,
            activity,
          };
        },
      );
    },
  );
  server.patch<{ Params: { contactId: string } }>(
    "/api/company/resident-contacts/:contactId",
    auth,
    (request) => {
      mutation(request, origin);
      const id = assignmentId(request.params.contactId),
        b = input(request, [...fields, "expectedVersion", "status"]),
        data = details(b),
        expectedVersion = version(b.expectedVersion);
      const status = b.status ?? "active";
      if (status !== "active" && status !== "archived")
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Choose active or archived.",
        );
      return scoped(
        db,
        request,
        "resident.assignment.manage",
        async (tx, companyId) => {
          // Use User -> contact order, shared with membership transfers and legacy
          // profile edits. Reconcile legacy edits before testing the contact version.
          let old = await tx.residentContact.findFirst({
            where: { id, companyId },
            select: contactSelect,
          });
          if (!old)
            throw new AccessError(
              404,
              "NOT_FOUND",
              "Tenant not found in this company.",
            );
          if (old.userId) {
            await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${old.userId} RETURNING id`;
            await preserveResidentContactProfile(tx, companyId, old.userId);
          }
          await tx.$queryRaw`UPDATE "ResidentContact" SET "updatedAt"="updatedAt" WHERE id=${id} AND "companyId"=${companyId} RETURNING id`;
          old = await tx.residentContact.findFirstOrThrow({
            where: { id, companyId },
            select: contactSelect,
          });
          if (old.version !== expectedVersion) throw conflict();
          const company = await tx.company.findUniqueOrThrow({
              where: { id: companyId },
              select: { timezone: true },
            }),
            today = new Date(companyDay(company.timezone) + "T00:00:00Z");
          if (
            status === "archived" &&
            (await tx.lease.findFirst({
              where: {
                companyId,
                status: { in: ["active", "draft"] },
                AND: [{ OR: [{ endsOn: null }, { endsOn: { gte: today } }] }],
                OR: [
                  { residentContactId: id },
                  {
                    participants: {
                      some: {
                        companyId,
                        contactId: id,
                        removedAt: null,
                        OR: [{ endsOn: null }, { endsOn: { gte: today } }],
                      },
                    },
                  },
                ],
              },
              select: { id: true },
            }))
          )
            throw new AccessError(
              409,
              "TENANT_HAS_CURRENT_LEASE",
              "End or review this tenant's current/upcoming lease relationships before archiving. Rental and financial history is retained.",
            );
          let compatibilityProfile;
          if (old.userId) {
            const member = await tx.companyMembership.findFirst({
              where: { companyId, userId: old.userId, role: "resident" },
              select: { userId: true },
            });
            if (member) {
              const profile = {
                contactName: data.name,
                contactPhone: data.phone,
                emergencyContactName: data.emergencyContactName,
                emergencyContactPhone: data.emergencyContactPhone,
                managementNotes: data.managementNotes,
              };
              await tx.companyMembership.update({
                where: { userId: old.userId },
                data: { ...profile, version: { increment: 1 } },
              });
              compatibilityProfile = residentCompatibilityProfile(profile);
            }
          }
          if (
            data.email?.toLowerCase() !== old.email?.toLowerCase() ||
            status === "archived"
          )
            await tx.invitation.updateMany({
              where: {
                companyId,
                contactId: id,
                acceptedAt: null,
                revokedAt: null,
              },
              data: { revokedAt: new Date() },
            });
          const row = await tx.residentContact.update({
            where: { id },
            data: {
              ...data,
              status,
              compatibilityProfile,
              version: { increment: 1 },
            },
            select: contactSelect,
          });
          await audit(tx, request, companyId, id, "resident.contact.updated", {
            status,
          });
          return row;
        },
      );
    },
  );
}
