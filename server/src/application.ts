import type {
  FastifyInstance,
  FastifyRequest,
  preValidationHookHandler,
} from "fastify";
import type { Prisma, PrismaClient, Session } from "@prisma/client";
import { randomBytes } from "node:crypto";
import {
  AccessError,
  COMPANY_ROLES,
  companyScope,
  defaultDestination,
  permissions,
  requirePermission,
} from "./access.js";
import { registerLeasing } from "./leasing.js";
import { registerMaintenance } from "./maintenance.js";
import { digest } from "./sessions.js";
import { registerPropertyDetail } from "./property-detail.js";

type UserWithAccess = Prisma.UserGetPayload<{
  include: { membership: { include: { company: true } } };
}>;
declare module "fastify" {
  interface FastifyRequest {
    principal?: UserWithAccess;
    appSession?: Session;
    dbUser?: any;
  }
}
type Tx = Prisma.TransactionClient;
const requiredString = (value: unknown, label: string, max = 200): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new AccessError(
      400,
      "INVALID_INPUT",
      `${label} is required and must be at most ${max} characters.`,
    );
  return value.trim();
};
const roleValue = (value: unknown) => {
  if (!COMPANY_ROLES.includes(value as any))
    throw new AccessError(400, "INVALID_ROLE", "Choose a company role.");
  return value as string;
};
const stateValue = (value: unknown) => {
  if (!["active", "disabled"].includes(value as string))
    throw new AccessError(400, "INVALID_STATUS", "Choose an account status.");
  return value as string;
};
const bodyOf = (request: FastifyRequest): Record<string, unknown> => {
  if (
    !request.body ||
    typeof request.body !== "object" ||
    Array.isArray(request.body)
  )
    throw new AccessError(400, "INVALID_INPUT", "An object is required.");
  return request.body as Record<string, unknown>;
};
async function audit(
  tx: Tx,
  request: FastifyRequest,
  action: string,
  companyId?: string,
  targetId?: string,
  detail?: Prisma.InputJsonValue,
) {
  await tx.auditEvent.create({
    data: {
      actorId: request.principal!.id,
      action,
      companyId,
      targetId,
      detail,
      requestId: request.id,
    },
  });
}
// All target access changes and assignment mutations write-lock the same User row.
// The no-op UPDATE also changes the MVCC tuple: a transaction that waited with
// an older Serializable snapshot must retry before validating target access.
async function lockTarget(tx: Tx, userId: string) {
  await tx.$queryRaw`UPDATE "User" SET "updatedAt" = "updatedAt" WHERE id = ${userId} RETURNING id`;
}
async function clearAssignments(tx: Tx, userId: string, companyId?: string) {
  if (!companyId) return;
  await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
  await tx.residentPropertyAssignment.deleteMany({ where: { companyId, userId } });
}
export function assignmentId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_|:@.\-]{0,199}$/.test(value))
    throw new AccessError(400, "INVALID_ID", "Choose a valid identifier.");
  return value;
}
// Identity-provider subjects are persisted verbatim. Do not interpret their
// punctuation, normalize or trim them, or apply the property identifier grammar.
export const MAX_USER_ID_BYTES = 4096;
export function opaqueUserId(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.includes("\0") ||
      Buffer.byteLength(value, "utf8") > MAX_USER_ID_BYTES)
    throw new AccessError(400, "INVALID_ID", "Choose a valid user identifier.");
  return value;
}
export async function serializable<T>(db: PrismaClient, run: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(run, { isolationLevel: "Serializable" }); }
    catch (error) {
      const failure = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
      // Raw lock queries can report PostgreSQL SQLSTATE through P2010.
      const retryable = failure.code === "P2034" ||
        ["40001", "40P01"].includes(failure.code ?? "") ||
        (failure.code === "P2010" && [
          failure.meta?.code,
          failure.meta?.driverAdapterError?.cause?.originalCode,
        ].some(code => ["40001", "40P01"].includes(code ?? "")));
      if (!retryable) throw error;
      if (attempt >= 2) throw new AccessError(409, "ACCESS_CONFLICT", "Access changed. Refresh and try again.");
    }
  }
}
async function activeCompany(tx: Tx, id: string) {
  const company = await tx.company.findUnique({ where: { id } });
  if (!company) throw new AccessError(404, "NOT_FOUND", "Company not found.");
  if (company.status !== "active")
    throw new AccessError(
      403,
      "COMPANY_SUSPENDED",
      "This company is suspended.",
    );
  return company;
}
async function preserveOwner(
  tx: Tx,
  userId: string,
  replacement: { companyId: string; role: string; status: string } | null,
) {
  const old = await tx.companyMembership.findUnique({ where: { userId } });
  if (
    old?.role === "owner" &&
    old.status === "active" &&
    !(
      replacement?.companyId === old.companyId &&
      replacement.role === "owner" &&
      replacement.status === "active"
    )
  ) {
    const others = await tx.companyMembership.count({
      where: {
        companyId: old.companyId,
        role: "owner",
        status: "active",
        userId: { not: userId },
        user: { status: "active" },
      },
    });
    if (!others)
      throw new AccessError(
        409,
        "LAST_OWNER",
        "Assign another active owner before removing this owner.",
      );
  }
}
export async function tenantTransaction<T>(
  db: PrismaClient,
  companyId: string,
  run: (tx: Tx) => Promise<T>,
  actor?: { id: string; permission: "property.read" | "property.write" },
): Promise<T> {
  return db.$transaction(async (tx) => {
    if (actor) {
      const current = await tx.user.findUnique({
        where: { id: actor.id },
        include: { membership: { include: { company: true } } },
      });
      if (!current)
        throw new AccessError(403, "ACCESS_DENIED", "Access is unavailable.");
      companyScope(current, actor.permission, companyId);
    }
    await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    return run(tx);
  });
}
export function registerApplication(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  registerMaintenance(server, db, authenticate, origin);
  registerLeasing(server, db, authenticate, origin);
  const auth = { preValidation: authenticate };
  registerPropertyDetail(server, db, authenticate);
  const serial = <T>(request: FastifyRequest, run: (tx: Tx) => Promise<T>) =>
    serializable(db,
      async (tx) => {
        const current = await tx.user.findUnique({
          where: { id: request.principal!.id },
          include: { membership: { include: { company: true } } },
        });
        if (
          !current ||
          current.status !== request.principal!.status ||
          current.email !== request.principal!.email ||
          current.emailVerified !== request.principal!.emailVerified ||
          current.membership?.companyId !==
            request.principal!.membership?.companyId ||
          JSON.stringify(permissions(current)) !==
            JSON.stringify(permissions(request.principal!))
        )
          throw new AccessError(
            403,
            "ACCESS_CHANGED",
            "Your access changed. Refresh to continue.",
          );
        return run(tx);
      },
    );
  const platform = (request: FastifyRequest) =>
    requirePermission(request.principal!, "platform.manage");
  const scope = (
    request: FastifyRequest,
    permission:
      | "property.read"
      | "property.write"
      | "company.manage"
      | "members.manage"
      | "resident.assignment.manage"
      | "resident.self",
  ) =>
    companyScope(
      request.principal!,
      permission,
      request.headers["x-company-id"],
    );

  server.get("/api/bootstrap", auth, async (request) => {
    const u = request.principal!;
    return {
      user: {
        id: u.id,
        email: u.email,
        emailVerified: u.emailVerified,
        name: u.name,
        status: u.status,
        platformRole: u.platformRole,
      },
      membership: u.membership,
      permissions: permissions(u),
      destination: defaultDestination(u),
      csrfToken: request.appSession!.csrfToken,
    };
  });
  server.patch("/api/account", auth, async (request) => {
    const name = requiredString(bodyOf(request).name, "Name");
    return serial(request, async (tx) => {
      const result = await tx.user.update({
        where: { id: request.principal!.id },
        data: { name },
        select: { id: true, name: true },
      });
      await audit(tx, request, "profile.updated");
      return result;
    });
  });

  server.get("/api/platform/companies", auth, async (request) => {
    platform(request);
    return db.company.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { memberships: true } } },
    });
  });
  server.post("/api/platform/companies", auth, async (request) => {
    platform(request);
    const body = bodyOf(request),
      name = requiredString(body.name, "Company name");
    return serial(request, async (tx) => {
      const company = await tx.company.create({ data: { name } });
      await audit(tx, request, "company.created", company.id);
      return company;
    });
  });
  server.get<{ Params: { companyId: string } }>(
    "/api/platform/companies/:companyId",
    auth,
    async (request) => {
      platform(request);
      const company = await db.company.findUnique({
        where: { id: request.params.companyId },
        include: {
          memberships: {
            include: {
              user: {
                select: { id: true, email: true, name: true, status: true },
              },
            },
          },
        },
      });
      if (!company)
        throw new AccessError(404, "NOT_FOUND", "Company not found.");
      await serial(request, (tx) =>
        audit(tx, request, "platform.company.viewed", company.id),
      );
      return company;
    },
  );
  server.patch<{ Params: { companyId: string } }>(
    "/api/platform/companies/:companyId",
    auth,
    async (request) => {
      platform(request);
      const body = bodyOf(request);
      const name = requiredString(body.name, "Company name");
      if (!["active", "suspended"].includes(body.status as string))
        throw new AccessError(
          400,
          "INVALID_STATUS",
          "Choose a company status.",
        );
      return serial(request, async (tx) => {
        const result = await tx.company.update({
          where: { id: request.params.companyId },
          data: { name, status: body.status as string },
        });
        await audit(tx, request, "company.updated", result.id, undefined, {
          status: result.status,
        });
        return result;
      });
    },
  );
  server.get("/api/platform/users", auth, async (request) => {
    platform(request);
    return db.user.findMany({
      orderBy: { email: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        platformRole: true,
        membership: { include: { company: true } },
        companyId: true,
        role: true,
      },
    });
  });
  server.put<{ Params: { userId: string } }>(
    "/api/platform/users/:userId/membership",
    auth,
    async (request) => {
      platform(request);
      const body = bodyOf(request),
        userId = opaqueUserId(request.params.userId);
      const companyId = requiredString(body.companyId, "Company"),
        role = roleValue(body.role),
        status = stateValue(body.status);
      return serial(request, async (tx) => {
        await lockTarget(tx, userId);
        await activeCompany(tx, companyId);
        const target = await tx.user.findUnique({ where: { id: userId } });
        if (!target || target.status !== "active")
          throw new AccessError(
            409,
            "USER_INACTIVE",
            "Select an active application user.",
          );
        await preserveOwner(tx, userId, { companyId, role, status });
        const old = await tx.companyMembership.findUnique({
          where: { userId },
        });
        if (old && (old.companyId !== companyId || old.role !== role || status !== "active"))
          await clearAssignments(tx, userId, old.companyId);
        const result = await tx.companyMembership.upsert({
          where: { userId },
          create: { userId, companyId, role, status },
          update: { companyId, role, status, version: { increment: 1 } },
        });
        // Clear obsolete assignment evidence after explicit review. Local membership is authoritative.
        await tx.user.update({
          where: { id: userId },
          data: { companyId: null, role: "unassigned" },
        });
        await audit(
          tx,
          request,
          old?.companyId && old.companyId !== companyId
            ? "membership.transferred"
            : "membership.assigned",
          companyId,
          userId,
          { previousCompanyId: old?.companyId ?? null, role, status },
        );
        return result;
      });
    },
  );
  server.patch<{ Params: { userId: string } }>(
    "/api/platform/users/:userId/status",
    auth,
    async (request) => {
      platform(request);
      const status = stateValue(bodyOf(request).status),
        userId = opaqueUserId(request.params.userId);
      return serial(request, async (tx) => {
        await lockTarget(tx, userId);
        const target = await tx.user.findUnique({ where: { id: userId } });
        if (!target) throw new AccessError(404, "NOT_FOUND", "User not found.");
        if (target.platformRole === "owner")
          throw new AccessError(
            403,
            "PLATFORM_OWNER_PROTECTED",
            "Platform-owner status requires the administrative recovery procedure.",
          );
        if (status !== "active") {
          await preserveOwner(tx, userId, null);
          const membership = await tx.companyMembership.findUnique({ where: { userId } });
          await clearAssignments(tx, userId, membership?.companyId);
        }
        const result = await tx.user.update({
          where: { id: userId },
          data: { status },
          select: { id: true, status: true },
        });
        await audit(tx, request, "user.status.changed", undefined, userId, {
          status,
        });
        return result;
      });
    },
  );
  server.get("/api/platform/audit", auth, async (request) => {
    platform(request);
    return db.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });

  server.get("/api/company", auth, async (request) => {
    const companyId = scope(request, "company.manage");
    return db.company.findUnique({ where: { id: companyId } });
  });
  server.patch("/api/company", auth, async (request) => {
    const companyId = scope(request, "company.manage"),
      name = requiredString(bodyOf(request).name, "Company name");
    return serial(request, async (tx) => {
      await activeCompany(tx, companyId);
      const company = await tx.company.update({
        where: { id: companyId },
        data: { name },
      });
      await audit(tx, request, "company.profile.updated", companyId);
      return company;
    });
  });
  server.get("/api/company/members", auth, async (request) => {
    const companyId = scope(request, "members.manage");
    return db.companyMembership.findMany({
      where: { companyId },
      include: {
        user: { select: { id: true, name: true, email: true, status: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  });
  server.patch<{ Params: { userId: string } }>(
    "/api/company/members/:userId",
    auth,
    async (request) => {
      const companyId = scope(request, "members.manage"),
        body = bodyOf(request),
        role = roleValue(body.role),
        status = stateValue(body.status),
        userId = opaqueUserId(request.params.userId);
      if (role === "owner")
        throw new AccessError(
          403,
          "OWNERSHIP_TRANSFER_REQUIRED",
          "Use ownership transfer to assign an owner.",
        );
      return serial(request, async (tx) => {
        await lockTarget(tx, userId);
        const member = await tx.companyMembership.findUnique({
          where: { userId },
        });
        if (!member || member.companyId !== companyId)
          throw new AccessError(404, "NOT_FOUND", "Member not found.");
        if (member.role === "owner")
          throw new AccessError(
            403,
            "OWNER_PROTECTED",
            "Use ownership transfer to change an owner.",
          );
        if (member.role !== role || status !== "active") await clearAssignments(tx, userId, companyId);
        const result = await tx.companyMembership.update({
          where: { userId },
          data: { role, status, version: { increment: 1 } },
        });
        await audit(tx, request, "membership.updated", companyId, userId, {
          role,
          status,
        });
        return result;
      });
    },
  );
  server.post("/api/company/transfer-ownership", auth, async (request) => {
    const companyId = scope(request, "members.manage"),
      userId = opaqueUserId(bodyOf(request).userId);
    if (userId === request.principal!.id)
      throw new AccessError(
        400,
        "INVALID_OWNER",
        "Choose another active company member.",
      );
    return serial(request, async (tx) => {
      await lockTarget(tx, userId);
      const current = await tx.companyMembership.findUnique({
        where: { userId: request.principal!.id },
      });
      const target = await tx.companyMembership.findUnique({
        where: { userId },
        include: { user: true },
      });
      if (
        current?.role !== "owner" ||
        current.status !== "active" ||
        current.companyId !== companyId ||
        !target ||
        target.companyId !== companyId ||
        target.status !== "active" ||
        target.user.status !== "active"
      )
        throw new AccessError(
          403,
          "INVALID_OWNER",
          "Choose an active member of this company.",
        );
      await clearAssignments(tx, userId, companyId);
      await tx.companyMembership.update({
        where: { userId },
        data: { role: "owner", version: { increment: 1 } },
      });
      await tx.companyMembership.update({
        where: { userId: current.userId },
        data: { role: "manager", version: { increment: 1 } },
      });
      await audit(tx, request, "ownership.transferred", companyId, userId);
      return { success: true };
    });
  });

  const assignmentTx = <T>(request: FastifyRequest, companyId: string, run: (tx: Tx) => Promise<T>) =>
    serial(request, async tx => {
      await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
      return run(tx);
    });
  server.get("/api/company/residents", auth, async request => {
    const companyId = scope(request, "resident.assignment.manage");
    return assignmentTx(request, companyId, tx => tx.companyMembership.findMany({
      where: { companyId, role: "resident", status: "active", user: { status: "active" }, company: { status: "active" } },
      select: { userId: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }));
  });
  const propertyInScope = async (tx: Tx, companyId: string, propertyId: string) => {
    if (!await tx.property.findFirst({ where: { id: propertyId, companyId } }))
      throw new AccessError(404, "NOT_FOUND", "Property not found.");
  };
  server.get<{ Params: { propertyId: string } }>("/api/company/properties/:propertyId/residents", auth, async request => {
    const companyId = scope(request, "resident.assignment.manage"), propertyId = assignmentId(request.params.propertyId);
    return assignmentTx(request, companyId, async tx => {
      await propertyInScope(tx, companyId, propertyId);
      return tx.residentPropertyAssignment.findMany({ where: { companyId, propertyId }, select: { userId: true, createdAt: true, membership: { select: { user: { select: { name: true, email: true } } } } } });
    });
  });
  for (const method of ["PUT", "DELETE"] as const) {
    server.route<{ Params: { propertyId: string; userId: string } }>({
      method, url: "/api/company/properties/:propertyId/residents/:userId", ...auth,
      handler: async request => {
        const companyId = scope(request, "resident.assignment.manage"),
          propertyId = assignmentId(request.params.propertyId), userId = opaqueUserId(request.params.userId);
        return assignmentTx(request, companyId, async tx => {
          await lockTarget(tx, userId);
          await propertyInScope(tx, companyId, propertyId);
          const member = await tx.companyMembership.findUnique({ where: { userId }, include: { user: true, company: true } });
          if (!member || member.companyId !== companyId) throw new AccessError(404, "NOT_FOUND", "Resident not found.");
          if (method === "PUT") {
            if (member.role !== "resident" || member.status !== "active" || member.user.status !== "active" || member.company.status !== "active")
              throw new AccessError(409, "RESIDENT_INELIGIBLE", "Choose an active accepted resident.");
            await tx.residentPropertyAssignment.upsert({ where: { propertyId_userId: { propertyId, userId } }, create: { companyId, propertyId, userId }, update: {} });
          } else await tx.residentPropertyAssignment.deleteMany({ where: { companyId, propertyId, userId } });
          await audit(tx, request, method === "PUT" ? "resident.assignment.assigned" : "resident.assignment.removed", companyId, userId, { propertyId });
          return { success: true };
        });
      },
    });
  }
  server.get("/api/resident/properties", auth, async request => {
    const companyId = scope(request, "resident.self");
    return assignmentTx(request, companyId, async tx => {
      const rows = await tx.residentPropertyAssignment.findMany({
        where: { companyId, userId: request.principal!.id },
        select: { property: { select: { id: true, name: true, address: true } } },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(row => row.property);
    });
  });

  server.get("/api/company/properties", auth, async (request) => {
    const companyId = scope(request, "property.read");
    return tenantTransaction(
      db,
      companyId,
      (tx) =>
        tx.property.findMany({
          where: { companyId },
          orderBy: { name: "asc" },
        }),
      { id: request.principal!.id, permission: "property.read" },
    );
  });
  server.post("/api/company/properties", auth, async (request) => {
    const companyId = scope(request, "property.write"),
      body = bodyOf(request);
    const data = {
      companyId,
      name: requiredString(body.name, "Property name"),
      address: requiredString(body.address, "Street address"),
      city: requiredString(body.city, "City"),
      state: requiredString(body.state, "State", 100),
      zip: requiredString(body.zip, "Postal code", 30),
    };
    return tenantTransaction(
      db,
      companyId,
      async (tx) => {
        const property = await tx.property.create({ data });
        await audit(tx, request, "property.created", companyId, property.id);
        return property;
      },
      { id: request.principal!.id, permission: "property.write" },
    );
  });

  // Invitations are acceptance links, never fabricated users or shared passwords.
  const invitationCompany = (request: FastifyRequest) => {
    if (permissions(request.principal!).includes("platform.manage"))
      return requiredString(bodyOf(request).companyId, "Company");
    return scope(request, "members.manage");
  };
  server.post("/api/invitations", auth, async (request) => {
    const companyId = invitationCompany(request),
      body = bodyOf(request),
      role = roleValue(body.role),
      email = requiredString(body.email, "Email", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new AccessError(
        400,
        "INVALID_EMAIL",
        "Enter a valid email address.",
      );
    if (
      role === "owner" &&
      !permissions(request.principal!).includes("platform.manage")
    )
      throw new AccessError(
        403,
        "OWNER_PROTECTED",
        "Only the platform owner can invite a company owner.",
      );
    const token = randomBytes(32).toString("base64url");
    return serial(request, async (tx) => {
      await activeCompany(tx, companyId);
      const invitation = await tx.invitation.create({
        data: {
          companyId,
          email,
          role,
          tokenHash: digest(token),
          createdBy: request.principal!.id,
          expiresAt: new Date(Date.now() + 72 * 3600000),
        },
      });
      await audit(tx, request, "invitation.created", companyId, invitation.id, {
        role,
      });
      return {
        id: invitation.id,
        expiresAt: invitation.expiresAt,
        acceptanceUrl: `${origin}/invite#${token}`,
      };
    });
  });
  server.get("/api/invitations", auth, async (request) => {
    const isPlatform = permissions(request.principal!).includes(
      "platform.manage",
    );
    const companyId = isPlatform ? undefined : scope(request, "members.manage");
    return db.invitation.findMany({
      where: { companyId },
      select: {
        id: true,
        companyId: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });
  server.post<{ Params: { invitationId: string } }>(
    "/api/invitations/:invitationId/revoke",
    auth,
    async (request) => {
      const isPlatform = permissions(request.principal!).includes(
        "platform.manage",
      );
      const companyId = isPlatform
        ? undefined
        : scope(request, "members.manage");
      return serial(request, async (tx) => {
        const invitation = await tx.invitation.findFirst({
          where: {
            id: request.params.invitationId,
            companyId,
            acceptedAt: null,
            revokedAt: null,
          },
        });
        if (!invitation)
          throw new AccessError(404, "NOT_FOUND", "Invitation not found.");
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { revokedAt: new Date() },
        });
        await audit(
          tx,
          request,
          "invitation.revoked",
          invitation.companyId,
          invitation.id,
        );
        return { success: true };
      });
    },
  );
  server.post("/api/invitations/accept", auth, async (request) => {
    const token = requiredString(bodyOf(request).token, "Invitation token"),
      user = request.principal!;
    if (user.status !== "active" || !user.emailVerified)
      throw new AccessError(
        403,
        "VERIFIED_EMAIL_REQUIRED",
        "Verify your sign-in email before accepting an invitation.",
      );
    return serial(request, async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash: digest(token) },
      });
      if (
        !invitation ||
        invitation.acceptedAt ||
        invitation.revokedAt ||
        invitation.expiresAt.getTime() <= Date.now() ||
        invitation.email !== user.email.toLowerCase()
      )
        throw new AccessError(
          403,
          "INVITATION_INVALID",
          "This invitation is unavailable for your account.",
        );
      await activeCompany(tx, invitation.companyId);
      // An invitation can only create a membership. It cannot reactivate,
      // promote or transfer an existing member (including a disabled member).
      if (await tx.companyMembership.findUnique({ where: { userId: user.id } }))
        throw new AccessError(
          409,
          "ALREADY_ASSIGNED",
          "Your account already has a company assignment. Ask your administrator to update it.",
        );
      await tx.companyMembership.create({
        data: {
          userId: user.id,
          companyId: invitation.companyId,
          role: invitation.role,
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      await audit(
        tx,
        request,
        "invitation.accepted",
        invitation.companyId,
        invitation.id,
      );
      return { success: true };
    });
  });
}
