import { registerWorkspaceGuide } from "./workspace-guide.js";
import { registerAccountPasswords } from "./account-passwords.js";
import { registerInvitations } from "./invitations.js";
import { teamInvitationAuthority, replayTeamAcceptance } from "./invitation-access.js";
import type { InvitationMailer } from "./invitation-email.js";
import {registerLeaseProration} from "./lease-proration.js";
import {registerLeaseTransitions} from "./lease-transitions.js";
import {registerLeaseTermChanges} from "./lease-term-changes.js";
import {registerCompanyProfile} from "./company-profile.js";
import { registerLeaseSettlements } from "./lease-settlements.js";
import { registerAccountProfile } from "./account-profile.js";
import { registerContactInvitations, acceptContactInvitation, previewContactInvitation, replayContactAcceptance } from "./contact-invitations.js";
import { registerContactRecords } from "./contact-records.js";
import { linkedResidentContact, preserveResidentContactProfile } from "./resident-contacts.js";
import { registerDeposits } from "./deposits.js";
import { registerRentRecovery } from "./rent-recovery.js";
import { auditLabels } from "./audit-labels.js";
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
import { membershipAccessSelect } from "./membership-view.js";
import { registerStaffPropertyAccess } from "./staff-property-access.js";
import { registerResidentProfiles } from "./resident-profiles.js";
import { input, mutation, boundedText } from "./operational.js";
import { registerCompanyAdministration } from "./company-administration.js";
import { registerUserAdministration } from "./user-administration.js";
import type { IdentityProvider } from "./identity-provider.js";
import { registerRentSchedules } from "./rent-schedules.js";
import { registerRent } from "./rent.js";
import { registerStatements } from "./statements.js";
import { registerLeaseMovements } from "./lease-movements.js";
import { registerLeaseCharges } from "./lease-charges.js";
import { registerFinances } from "./finances.js";
import { registerLeasing } from "./leasing.js";
import { registerLeaseParticipants } from "./lease-participants.js";
import { registerLeaseInvitations, acceptLeaseInvitation, replayLeaseAcceptance, previewLeaseInvitation } from "./lease-invitations.js";
import { registerWorkCalendar } from "./work-calendar.js";
import { registerPreventive } from "./preventive.js";
import { registerVendors } from "./vendors.js";
import { registerMaintenance } from "./maintenance.js";
import { registerPrivateDocuments } from "./private-documents.js";
import { registerWorkOrders } from "./work-orders.js";
import type { DocumentScanner } from "./document-scanner.js";
import { registerMaintenanceCosts } from "./maintenance-costs.js";
import { digest } from "./sessions.js";
import { propertySelect, propertyData, propertyKeys } from "./property-fields.js";
import { scoped, sameSubmission, submission } from "./operational.js";
import { registerOverview } from "./overview.js";
import { registerReports } from "./reports.js";
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
  await tx.staffPropertyAccess.deleteMany({ where: { companyId, userId } });
  await tx.companyMembership.updateMany({ where: { companyId, userId }, data: { maintenanceExecution: false } });
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
      const failure = error as { name?: string; code?: string; cause?: { kind?: string; originalCode?: string }; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
      // Raw queries wrap SQLSTATE in P2010; COMMIT may expose the adapter's
      // structured conflict directly. Do not classify private error text.
      const retryable = failure.code === "P2034" ||
        (failure.name === "DriverAdapterError" && (failure.cause?.kind === "TransactionWriteConflict" || ["40001", "40P01"].includes(failure.cause?.originalCode ?? ""))) ||
        ["40001", "40P01"].includes(failure.code ?? "") ||
        (failure.code === "P2010" && [
          failure.meta?.code,
          failure.meta?.driverAdapterError?.cause?.originalCode,
        ].some(code => ["40001", "40P01"].includes(code ?? "")));
      if (!retryable) throw error;
      if (attempt >= 4) throw new AccessError(409, "ACCESS_CONFLICT", "Access changed. Refresh and try again.");
      // Back off between multi-stage account operations to avoid retrying the
      // same serialization conflict in lockstep. Authorization is re-read.
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1) + Math.floor(Math.random() * 10)));
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
  identityProvider?: IdentityProvider,
  options: { documentScanner?: DocumentScanner; invitationMailer?: InvitationMailer } = {},
) {
  registerWorkspaceGuide(server, db, authenticate, origin);
  registerInvitations(server, db, authenticate, origin, identityProvider, options.invitationMailer);
  registerPrivateDocuments(server, db, authenticate, origin, options.documentScanner);
  registerWorkOrders(server, db, authenticate, origin);
  registerAccountPasswords(server, db, authenticate, origin, identityProvider);
  registerMaintenance(server, db, authenticate, origin);
  registerVendors(server, db, authenticate, origin);
  registerPreventive(server, db, authenticate, origin);
  registerWorkCalendar(server, db, authenticate);
  registerMaintenanceCosts(server, db, authenticate, origin);
  registerLeasing(server, db, authenticate, origin, identityProvider);
  registerLeaseParticipants(server, db, authenticate, origin, identityProvider);
  registerLeaseInvitations(server, db, authenticate, origin, identityProvider);
  registerFinances(server, db, authenticate, origin);
  registerDeposits(server, db, authenticate, origin);
  registerRent(server, db, authenticate, origin);
  registerStatements(server, db, authenticate);
  registerLeaseCharges(server, db, authenticate, origin);
  registerLeaseMovements(server, db, authenticate, origin);
  registerLeaseProration(server,db,authenticate,origin);
  registerLeaseTransitions(server,db,authenticate,origin);
  registerLeaseTermChanges(server,db,authenticate,origin);
  registerLeaseSettlements(server, db, authenticate, origin);
  registerAccountProfile(server, db, authenticate, origin, identityProvider);
  registerRentSchedules(server, db, authenticate, origin);
  registerRentRecovery(server, db, authenticate, origin);
  registerUserAdministration(server, db, authenticate, origin, identityProvider);
  registerCompanyAdministration(server, db, authenticate, origin);
  registerResidentProfiles(server, db, authenticate, origin);
  registerContactRecords(server, db, authenticate, origin, identityProvider);
  registerContactInvitations(server, db, authenticate, origin,identityProvider);
  registerReports(server, db, authenticate);
  registerOverview(server, db, authenticate);
  const auth = { preValidation: authenticate };
  registerPropertyDetail(server, db, authenticate, origin);
  registerStaffPropertyAccess(server, db, authenticate, origin);
  const serial = <T>(request: FastifyRequest, run: (tx: Tx) => Promise<T>, membershipMayBeEstablished = false) =>
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
          (!membershipMayBeEstablished && (current.membership?.companyId !==
            request.principal!.membership?.companyId ||
          JSON.stringify(permissions(current)) !==
            JSON.stringify(permissions(request.principal!))))
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
      membership: u.membership ? {companyId:u.membership.companyId,version:u.membership.version,role:u.membership.role,status:u.membership.status,company: {id:u.membership.company.id,name:u.membership.company.name,status:u.membership.company.status}} : null,
      permissions: permissions(u),
      destination: defaultDestination(u),
      csrfToken: request.appSession!.csrfToken,
    };
  });


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
        emailVerified: true,
        firstSignedInAt: true,
        membership: { select: { ...membershipAccessSelect, company: true } },
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
        if (!Object.hasOwn(body, 'expectedVersion') || body.expectedVersion !== (old?.version ?? null))
          throw new AccessError(409, 'RECORD_CHANGED', 'This assignment changed. Close and reopen access before editing again.');
        if (old && (old.companyId !== companyId || old.role !== role || status !== "active"))
          await clearAssignments(tx, userId, old.companyId);
        // Preserve the old company's business contact before a transfer clears
        // membership profile fields. That contact grants no portal authority.
        if (old) await preserveResidentContactProfile(tx, old.companyId, userId);
        const resetContact = old && old.companyId !== companyId ? {contactName:null,contactPhone:null,emergencyContactName:null,emergencyContactPhone:null,managementNotes:null} : {};
        const result = await tx.companyMembership.upsert({
          where: { userId },
          create: { userId, companyId, role, status },
          update: { companyId, role, status, ...resetContact, version: { increment: 1 } },
          select: membershipAccessSelect,
        });
        if (role === "resident") await linkedResidentContact(tx, companyId, userId);
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
  server.delete<{Params:{userId:string}}>("/api/platform/users/:userId/membership",auth,async request=>{
    platform(request);mutation(request,origin);
    const userId=opaqueUserId(request.params.userId),b=input(request,["expectedVersion","expectedCompanyId","expectedCreatedAt"]);
    return serial(request,async tx=>{
      await lockTarget(tx,userId);
      const old=await tx.companyMembership.findUnique({where:{userId}});
      if(!old)return {success:true};
      if(b.expectedVersion!==old.version||b.expectedCompanyId!==old.companyId||b.expectedCreatedAt!==old.createdAt.toISOString())throw new AccessError(409,"RECORD_CHANGED","This assignment changed. Close and reopen access before editing again.");
      await preserveOwner(tx,userId,null);
      await preserveResidentContactProfile(tx,old.companyId,userId);
      await clearAssignments(tx,userId,old.companyId);
      await tx.companyMembership.delete({where:{userId}});
      await tx.user.update({where:{id:userId},data:{companyId:null,role:"unassigned"}});
      await audit(tx,request,"membership.removed",old.companyId,userId);
      return {success:true};
    });
  });
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
  server.patch<{Params:{userId:string}}>("/api/platform/users/:userId/profile", auth, async request => {
    platform(request); mutation(request, origin);
    const userId = opaqueUserId(request.params.userId), body = input(request, ["name"]);
    const name = boundedText(body.name, 200, "Display name");
    const identity=await serial(request,async tx=>{
      await lockTarget(tx,request.principal!.id);await lockTarget(tx,userId);
      const user=await tx.user.findUnique({where:{id:userId},include:{identities:true}});
      if(!user)throw new AccessError(404,"NOT_FOUND","User not found.");
      const identity=user.identities.find(i=>i.issuer===identityProvider?.issuer);
      if(!identityProvider?.rename || !identity)throw new AccessError(503,"IDENTITY_NOT_CONFIGURED","Account name changes require the Auth0 connection for this account. Reconcile the account from Property Flow Users first.");
      return identity;
    });
    const remote=await identityProvider!.rename(identity.subject,name);
    if(remote.user_id!==identity.subject||remote.name!==name)throw new AccessError(409,"IDENTITY_PROFILE_CONFLICT","Auth0 did not confirm this name. Refresh and retry.");
    return serial(request, async tx => {
      await lockTarget(tx, request.principal!.id);
      await lockTarget(tx, userId);
      const currentIdentity=await tx.identity.findUnique({where:{issuer_subject:{issuer:identity.issuer,subject:identity.subject}}});
      if(currentIdentity?.userId!==userId)throw new AccessError(409,"IDENTITY_CONFLICT","The account identity changed. Refresh and retry.");
      const result = await tx.user.update({where:{id:userId},data:{name},select:{id:true,name:true}});
      await audit(tx, request, "user.profile.updated", undefined, userId);
      return result;
    });
  });
  server.get("/api/platform/audit", auth, async (request) => {
    platform(request);
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).some(key => !["targetId","page","q","companyId"].includes(key))) throw new AccessError(400, "INVALID_INPUT", "Unknown activity filter.");
    const targetId = query.targetId === undefined ? undefined : opaqueUserId(query.targetId);
    const page = query.page === undefined ? null : Number(query.page);
    if (page !== null && (!Number.isInteger(page) || page < 1 || page > 100000)) throw new AccessError(400,"INVALID_INPUT","Choose a valid activity page.");
    const q = query.q === undefined ? '' : typeof query.q === 'string' ? query.q.trim() : null;
    if (q === null || q.length > 100) throw new AccessError(400,"INVALID_INPUT","Use a shorter event filter.");
    const companyId = query.companyId === undefined ? undefined : assignmentId(query.companyId);
    return serial(request, async tx => {
      platform(request);
      const where = { ...(targetId ? { OR: [{targetId}, {actorId:targetId}] } : {}), ...(companyId ? {companyId} : {}), ...(q ? {action:{contains:q,mode:'insensitive' as const}} : {}) };
      const events = await tx.auditEvent.findMany({where,orderBy:[{createdAt:"desc"},{id:"desc"}],skip:page === null ? 0 : (page-1)*25,take:page === null ? 100 : 25});
      const items = await auditLabels(tx, events);
      return page === null ? items : {items,total:await tx.auditEvent.count({where}),page,pageSize:25};
    });
  });

  registerCompanyProfile(server,db,authenticate,origin);
  server.get("/api/company/members", auth, async (request) => {
    const companyId = scope(request, "members.manage");
    return db.companyMembership.findMany({
      where: { companyId },
      select: {
        ...membershipAccessSelect, user: { select: { id: true, name: true, email: true, status: true } },
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
        if (Object.hasOwn(body, "expectedVersion") && body.expectedVersion !== member.version)
          throw new AccessError(409, "STALE_MEMBERSHIP", "This person's access changed. Close and reopen their record before saving.");
        if (member.role === "owner")
          throw new AccessError(
            403,
            "OWNER_PROTECTED",
            "Use ownership transfer to change an owner.",
          );
        if (member.role !== role || status !== "active") await clearAssignments(tx, userId, companyId);
        await preserveResidentContactProfile(tx, companyId, userId);
        const result = await tx.companyMembership.update({
          where: { userId },
          data: { role, status, version: { increment: 1 } },
          select: membershipAccessSelect,
        });
        if (role === "resident") await linkedResidentContact(tx, companyId, userId);
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
      await preserveResidentContactProfile(tx, companyId, userId);
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
  server.get<{ Params: { propertyId: string };Querystring:{includeContacts?:string} }>("/api/company/properties/:propertyId/residents", auth, async request => {
    const companyId = scope(request, "resident.assignment.manage"), propertyId = assignmentId(request.params.propertyId);
    return assignmentTx(request, companyId, async tx => {
      await propertyInScope(tx, companyId, propertyId);
      if(Object.keys(request.query).some(k=>k!=="includeContacts")||request.query.includeContacts!==undefined&&request.query.includeContacts!=="true")throw new AccessError(400,"INVALID_INPUT","Unknown resident selection filter.");
      if(request.query.includeContacts==="true"){
        const contacts=await tx.residentContact.findMany({where:{companyId,status:"active",OR:[{userId:null},{user:{status:"active",OR:[{membership:null},{membership:{companyId,role:"resident",status:"active"}}]}}]},select:{id:true,userId:true,name:true,email:true},orderBy:[{name:"asc"},{id:"asc"}],take:2001});
        const legacy=await tx.residentPropertyAssignment.findMany({where:{companyId,propertyId,membership:{role:"resident",status:"active",user:{status:"active",residentContacts:{none:{companyId}}}}},select:{userId:true,membership:{select:{user:{select:{name:true,email:true}}}}},take:2001});
        if(contacts.length+legacy.length>2000)throw new AccessError(422,"TENANT_SELECTION_TOO_LARGE","More than 2,000 tenants are eligible. No incomplete selection is shown.");
        return [...contacts.map(c=>({...c,contactId:c.id})),...legacy];
      }
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
    return scoped(db, request, "property.read", (tx, companyId, propertyIds) =>
        tx.property.findMany({
          where: { companyId, ...(propertyIds ? { id: { in: propertyIds } } : {}) },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: propertySelect,
        }),
    );
  });
  server.post("/api/company/properties", auth, request => {
    scope(request, "property.write");
    mutation(request, origin);
    const body = input(request, [...propertyKeys, "submissionKey"]),
      data = propertyData(body), key = submission(body.submissionKey, data);
    return scoped(db, request, "property.write", async (tx, companyId) => {
      const previous = await tx.property.findFirst({
        where: { companyId, createdById: request.principal!.id, submissionKey: key.submissionKey },
        select: { ...propertySelect, submissionHash: true },
      });
      if (previous) {
        sameSubmission(previous.submissionHash!, key.submissionHash);
        const { submissionHash, ...safe } = previous;
        return safe;
      }
      const result = await tx.property.create({
        data: { ...data, ...key, companyId, createdById: request.principal!.id }, select: propertySelect,
      });
      await audit(tx, request, "property.created", companyId, result.id);
      return result;
    });
  });

  server.post("/api/invitations/preview", auth, async (request) => {
    const token=requiredString(input(request,["token"]).token,"Invitation token"),user=request.principal!;
    if(user.status!=="active"||!user.emailVerified)throw new AccessError(403,"VERIFIED_EMAIL_REQUIRED","Verify your sign-in email before reviewing this invitation.");
    return serial(request,async tx=>{
      const invitation=await tx.invitation.findUnique({where:{tokenHash:digest(token)}});
      if(!invitation||invitation.revokedAt||(!invitation.acceptedAt&&invitation.expiresAt.getTime()<=Date.now())||(invitation.email!==user.email.toLowerCase()&&!(invitation.contactId&&!invitation.leaseId&&invitation.acceptedAt)))throw new AccessError(403,"INVITATION_INVALID","This invitation is unavailable for your account.");
      if(invitation.accountId && invitation.accountId !== user.id) throw new AccessError(403,"INVITATION_IDENTITY_MISMATCH","Sign in with the account this invitation was created for.");
      await activeCompany(tx,invitation.companyId);
      if(invitation.contactId&&!invitation.leaseId){if(invitation.acceptedAt){const {company,contact}=await replayContactAcceptance(tx,request,invitation);return {company:company.name,name:contact.name,contact:true,accepted:true,leaseApprovals:[],leases:[]};}return previewContactInvitation(tx,invitation);}
      if (invitation.leaseId) {
        if(invitation.acceptedAt)await replayLeaseAcceptance(tx,request,invitation);
        return previewLeaseInvitation(tx,invitation);
      }
      const company = invitation.acceptedAt ? (await replayTeamAcceptance(tx, request, invitation)).company : await teamInvitationAuthority(tx, invitation);
      return { company: company.name, role: invitation.role, team: true, accepted: !!invitation.acceptedAt };
    });
  });
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
      await tx.$queryRaw`UPDATE "Invitation" SET version=version WHERE "tokenHash"=${digest(token)} RETURNING id`;
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash: digest(token) },
      });
      if(invitation?.contactId&&!invitation.leaseId&&invitation.acceptedAt&&!invitation.revokedAt){
        await replayContactAcceptance(tx,request,invitation);
        return {success:true};
      }
      if(invitation?.leaseId&&invitation.acceptedAt&&!invitation.revokedAt&&invitation.email===user.email.toLowerCase()){
        await activeCompany(tx,invitation.companyId);
        return replayLeaseAcceptance(tx,request,invitation);
      }
      if (invitation?.acceptedAt && !invitation.contactId && !invitation.leaseId && !invitation.revokedAt) {
        await replayTeamAcceptance(tx, request, invitation);
        return { success: true, alreadyAccepted: true };
      }
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
      if(invitation.accountId && invitation.accountId !== user.id) throw new AccessError(403,"INVITATION_IDENTITY_MISMATCH","Sign in with the account this invitation was created for.");
      await activeCompany(tx, invitation.companyId);
      // An invitation can only create a membership. It cannot reactivate,
      // promote or transfer an existing member (including a disabled member).
      if(invitation.contactId&&!invitation.leaseId)await acceptContactInvitation(tx,request,invitation);
      else if (invitation.leaseId) await acceptLeaseInvitation(tx,request,invitation);
      else {
      await teamInvitationAuthority(tx, invitation);
      await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${user.id} RETURNING id`;
      if (!invitation.accountId) throw new AccessError(409, "ACCOUNT_SETUP_REQUIRED", "Ask the owner to replace this older invitation with one linked to your sign-in account.");
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
      if (invitation.role === "resident") await linkedResidentContact(tx, invitation.companyId, user.id);
      }
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date(), version: { increment: 1 } },
      });
      await audit(
        tx,
        request,
        "invitation.accepted",
        invitation.companyId,
        invitation.id,
      );
      return { success: true };
    }, true);
  });
}
