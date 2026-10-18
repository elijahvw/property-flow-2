import { prepareAccount, saveAccount } from "./resident-accounts.js";
import type { IdentityProvider } from "./identity-provider.js";
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
  user: {select:{id:true,email:true,emailVerified:true,firstSignedInAt:true}},
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
  if (!member) {
    const assigned=await tx.companyMembership.findUnique({where:{userId},select:{userId:true}});
    return assigned ? {userId,state:"disabled",membershipVersion:null,manageable:false} : null;
  }
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
      const state = !member
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
  // Company-owned rental relationships are independent of portal assignments.
  // Read them in one bounded query, including departed occupants and old leases.
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } });
  const today = companyDay(company.timezone);
  const leases = await tx.lease.findMany({
    where: { companyId },
    select: {
      id: true, propertyId: true, residentContactId: true, residentId: true,
      startsOn: true, endsOn: true, status: true,
      property: { select: { name: true } }, unit: { select: { label: true } },
      participants: {
        where: { companyId },
        select: { contactId: true, userId: true, role: true, startsOn: true, endsOn: true, removedAt: true },
        take: 1001,
      },
    },
    orderBy: [{ startsOn: "desc" }, { id: "asc" }], take: 10001,
  });
  if (leases.length > 10000 || leases.some(l => l.participants.length > 1000) || leases.reduce((n,l) => n+l.participants.length,0) > 10000)
    throw new AccessError(422, "TENANT_DIRECTORY_TOO_LARGE", "Too many rental relationships for a complete tenant directory. No partial associations are shown.");
  type Association = { leaseId: string; propertyId: string; propertyName: string; unitLabel: string; role: string; status: string; startsOn: string; endsOn: string | null; blocksArchive: boolean };
  const byIdentity = new Map<string, Association[]>();
  for (const c of contacts) {
    const rows: Association[] = [];
    byIdentity.set(`contact:${c.id}`, rows);
    if (c.userId) byIdentity.set(`user:${c.userId}`, rows);
  }
  for (const m of members) if (!byIdentity.has(`user:${m.userId}`)) byIdentity.set(`user:${m.userId}`, []);
  const day = (date: Date) => date.toISOString().slice(0, 10);
  for (const lease of leases) {
    const linked = new Set<Association[]>();
    const add = (contactId: string | null, userId: string | null, role: string, startsOn: Date, endsOn: Date | null, removed: boolean) => {
      const rows = (contactId ? byIdentity.get(`contact:${contactId}`) : undefined) ?? (userId ? byIdentity.get(`user:${userId}`) : undefined);
      if (!rows || linked.has(rows)) return;
      linked.add(rows);
      const start = day(startsOn) > day(lease.startsOn) ? day(startsOn) : day(lease.startsOn);
      const end = [endsOn, lease.endsOn].filter((v): v is Date => !!v).map(day).sort()[0] ?? null;
      const current = !removed && lease.status !== "ended" && (!end || end >= today);
      const status = !current ? "former" : lease.status === "draft" ? "draft" : start > today ? "upcoming" : "current";
      rows.push({ leaseId: lease.id, propertyId: lease.propertyId, propertyName: lease.property.name, unitLabel: lease.unit.label, role, status, startsOn: start, endsOn: end, blocksArchive: current });
    };
    add(lease.residentContactId, lease.residentId, "leaseholder", lease.startsOn, lease.endsOn, false);
    for (const person of lease.participants) add(person.contactId, person.userId, person.role, person.startsOn, person.endsOn, !!person.removedAt);
  }
  const rank: Record<string, number> = { current: 0, upcoming: 1, draft: 2, former: 3 };
  return result.map(row => {
    const rentals = (("contactId" in row ? byIdentity.get(`contact:${row.contactId}`) : undefined) ?? (row.userId ? byIdentity.get(`user:${row.userId}`) : undefined) ?? [])
      .sort((a,b) => rank[a.status]-rank[b.status] || b.startsOn.localeCompare(a.startsOn) || a.leaseId.localeCompare(b.leaseId));
    return { ...row, rentals, canArchive: !rentals.some(r => r.blocksArchive) };
  });
}
export function registerContactRecords(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
  provider?: IdentityProvider,
) {
  const auth = { preValidation: authenticate };
  server.post("/api/company/resident-contacts", auth, async (request) => {
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
    const replay=await scoped(db,request,"resident.assignment.manage",async(tx,companyId)=>{
      const previous=await tx.residentContact.findFirst({where:{companyId,createdById:request.principal!.id,submissionKey:key.submissionKey},select:{...contactSelect,submissionHash:true}});
      if(previous){sameSubmission(previous.submissionHash!,key.submissionHash);const{submissionHash:_hash,...row}=previous;return row;}
      if (!b.duplicateReviewed && await tx.residentContact.findFirst({where:{companyId,OR:[{name:{equals:data.name,mode:"insensitive"}},...(data.email?[{email:{equals:data.email,mode:"insensitive" as const}}]:[])]},select:{id:true}}))
        throw new AccessError(409,"POSSIBLE_DUPLICATE","A tenant with this name or email already exists. Review the directory, or confirm this is a separate person before saving.");
      return null;
    });
    if(replay)return replay;
    const account=await prepareAccount(provider,data.email,data.name);
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
        const userId=await saveAccount(tx,request,account,companyId);
        if(await tx.residentContact.findFirst({where:{companyId,userId},select:{id:true}}))throw new AccessError(409,"CONTACT_EXISTS","This account already has tenant details in this company. Open the existing tenant; no duplicate account was created.");
        const row = await tx.residentContact.create({
          data: {
            companyId,
            userId,
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
              AND: [{ OR: [{ contactId: id }, ...(row.userId ? [{ userId: row.userId }] : [])] }],
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
            canArchive: leases.length === 0 && !await tx.lease.findFirst({
              where: { companyId, status: { in: ["active", "draft"] }, AND: [{ OR: [{ residentContactId: id }, ...(row.userId ? [{ residentId: row.userId }] : [])] }, { OR: [{ endsOn: null }, { endsOn: { gte: today } }] }] },
              select: { id: true },
            }),
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
    async (request) => {
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
      const nameTarget = await scoped(db,request,"resident.assignment.manage",async(tx,companyId)=>{
        const old=await tx.residentContact.findFirst({where:{id,companyId},select:contactSelect});
        if(!old)throw new AccessError(404,"NOT_FOUND","Tenant not found in this company.");
        if(old.version!==expectedVersion)throw conflict();
        if(old.name===data.name || old.status!=="active" || status!=="active" || !old.userId)return null;
        const user=await tx.user.findUniqueOrThrow({where:{id:old.userId},include:{identities:true,membership:true}});
        // Historical business records confer no authority over a transferred or
        // platform administrator's account. Current resident accounts may sync.
        if(user.status!=="active" || user.platformRole || (user.membership && (user.membership.companyId!==companyId || user.membership.role!=="resident" || user.membership.status!=="active")))return null;
        const identity=user.identities.find(i=>i.issuer===provider?.issuer);
        if(!provider || !identity)throw new AccessError(503,"IDENTITY_NOT_CONFIGURED","This account's name cannot be updated until its Auth0 connection is available. Review it in Property Flow Users.");
        return {userId:user.id,updatedAt:user.updatedAt,subject:identity.subject};
      });
      if(nameTarget){
        const remote=await provider!.rename(nameTarget.subject,data.name);
        if(remote.user_id!==nameTarget.subject || remote.name!==data.name)throw new AccessError(409,"IDENTITY_PROFILE_CONFLICT","Auth0 did not confirm the account name. Refresh and retry.");
      }
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
          if(nameTarget){
            const user=await tx.user.findUniqueOrThrow({where:{id:nameTarget.userId},include:{membership:true,identities:true}});
            if(old.userId!==user.id || user.updatedAt.getTime()!==nameTarget.updatedAt.getTime() || user.status!=="active" || user.platformRole || !user.identities.some(i=>i.issuer===provider!.issuer&&i.subject===nameTarget.subject) || (user.membership && (user.membership.companyId!==companyId || user.membership.role!=="resident" || user.membership.status!=="active")))throw conflict();
            await tx.user.update({where:{id:user.id},data:{name:data.name}});
            await audit(tx,request,companyId,user.id,"user.profile.updated");
          }
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
                  ...(old.userId ? [{ residentId: old.userId }] : []),
                  {
                    participants: {
                      some: {
                        companyId,
                        AND: [{ OR: [{ contactId: id }, ...(old.userId ? [{ userId: old.userId }] : [])] }],
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
            previousStatus: old.status,
          });
          if (old.status !== status)
            await audit(tx, request, companyId, id, status === "archived" ? "resident.contact.archived" : "resident.contact.restored", {
              previousStatus: old.status, status, version: row.version,
            });
          return row;
        },
      );
    },
  );
}
