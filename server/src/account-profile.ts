import type { IdentityProvider } from "./identity-provider.js";
import type {
  FastifyInstance,
  preValidationHookHandler,
  FastifyRequest,
} from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError, permissions } from "./access.js";
import { serializable } from "./application.js";
import {
  audit,
  boundedText,
  conflict,
  input,
  mutation,
  sameSubmission,
  submission,
  type Tx,
} from "./operational.js";
import { companyDay } from "./reports.js";
import { residentCompatibilityProfile } from "./resident-contacts.js";
const limits = {
  preferredName: 200,
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
} as const;
const keys = [...Object.keys(limits), "preferredContact"];
function parse(b: Record<string, unknown>) {
  const details = Object.fromEntries(
    Object.entries(limits).map(([key, max]) => [
      key,
      b[key] == null || b[key] === "" ? null : boundedText(b[key], max, key),
    ]),
  );
  const preferredContact =
    b.preferredContact == null || b.preferredContact === ""
      ? null
      : b.preferredContact;
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
  if (preferredContact === "phone" && !details.phone)
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Add your primary phone for this preference.",
    );
  if (
    (details.emergencyContactPhone || details.emergencyRelationship) &&
    !details.emergencyContactName
  )
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Add the emergency contact's name.",
    );
  return { ...details, preferredContact } as Record<string, string | null>;
}
async function own<T>(
  db: PrismaClient,
  request: FastifyRequest,
  run: (tx: Tx, user: NonNullable<FastifyRequest["principal"]>) => Promise<T>,
) {
  return serializable(db, async (tx) => {
    const id = request.principal!.id;
    if (request.method === "GET")
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id} FOR SHARE`;
    else
      await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${id} RETURNING id`;
    const user = await tx.user.findUniqueOrThrow({
      where: { id },
      include: { membership: { include: { company: true } } },
    });
    if (
      user.status !== request.principal!.status ||
      user.emailVerified !== request.principal!.emailVerified ||
      user.membership?.companyId !== request.principal!.membership?.companyId ||
      JSON.stringify(permissions(user)) !==
        JSON.stringify(permissions(request.principal!))
    )
      throw new AccessError(
        403,
        "ACCESS_CHANGED",
        "Your account access changed. Refresh your profile.",
      );
    await tx.$queryRaw`SELECT set_config('app.user_id',${id},true)`;
    if (user.membership?.companyId) {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${user.membership.companyId} FOR SHARE`;
      await tx.$queryRaw`SELECT set_config('app.company_id',${user.membership.companyId},true)`;
    }
    return run(tx, user);
  });
}
async function context(tx: Tx, user: NonNullable<FastifyRequest["principal"]>) {
  const m = user.membership,
    shared = !!(
      user.status === "active" &&
      user.emailVerified &&
      m?.status === "active" &&
      m.role === "resident" &&
      m.company.status === "active"
    );
  const contact = shared
    ? await tx.residentContact.findFirst({
        where: { companyId: m!.companyId, userId: user.id, status: "active" },
      })
    : null;
  const profile = await tx.accountProfile.findUnique({
    where: { userId: user.id },
  });
  const details = {
    ...parse({}),
    ...((profile?.details as Record<string, string | null>) ?? {}),
    ...(contact
      ? Object.fromEntries(
          keys.map((k) => [k, contact[k as keyof typeof contact]]),
        )
      : {}),
  } as Record<string, string | null>;
  let assignments: {
    id: string;
    status: string;
    startsOn: Date;
    endsOn: Date | null;
    property: { name: string; address: string };
    unit: { label: string };
  }[] = [];
  if (shared) {
    const today = new Date(companyDay(m!.company.timezone) + "T00:00:00Z");
    assignments = await tx.lease.findMany({
      where: {
        companyId: m!.companyId,
        status: "active",
        AND: [{ OR: [{ endsOn: null }, { endsOn: { gte: today } }] }],
        property: {
          assignments: { some: { companyId: m!.companyId, userId: user.id } },
        },
        OR: [
          {
            residentId: user.id,
            participants: {
              none: {
                userId: user.id,
                OR: [{ removedAt: { not: null } }, { endsOn: { lt: today } }],
              },
            },
          },
          ...(contact
            ? [
                {
                  residentContactId: contact.id,
                  participants: {
                    none: {
                      contactId: contact.id,
                      OR: [
                        { removedAt: { not: null } },
                        { endsOn: { lt: today } },
                      ],
                    },
                  },
                },
              ]
            : []),
          {
            participants: {
              some: {
                companyId: m!.companyId,
                userId: user.id,
                removedAt: null,
                OR: [{ endsOn: null }, { endsOn: { gte: today } }],
              },
            },
          },
        ],
      },
      select: {
        id: true,
        status: true,
        startsOn: true,
        endsOn: true,
        property: { select: { name: true, address: true } },
        unit: { select: { label: true } },
      },
      orderBy: { startsOn: "desc" },
      take: 101,
    });
    if (assignments.length > 100)
      throw new AccessError(
        422,
        "PROFILE_SCOPE_TOO_LARGE",
        "Too many assignments for a complete profile view.",
      );
  }
  return { profile, contact, details, assignments };
}
export function registerAccountProfile(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
  provider?: IdentityProvider,
) {
  const auth = { preValidation: authenticate };
  server.get("/api/account", auth, (request) =>
    own(db, request, async (tx, user) => {
      const c = await context(tx, user);
      return {
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        version: c.profile?.version ?? 0,
        nameVersion: user.updatedAt.toISOString(),
        companyId: user.membership?.companyId ?? null,
        contactVersion: c.contact?.version ?? null,
        sharedWithManagement: !!c.contact,
        contactEmail: c.contact ? c.contact.email : user.email,
        details: c.details,
        updatedAt: c.profile?.updatedAt ?? null,
        assignments: c.assignments,
      };
    }),
  );
  server.patch("/api/account", auth, async (request) => {
    mutation(request, origin);
    const b = input(request, [
        "name",
        ...keys,
        "expectedVersion",
        "expectedNameVersion",
        "expectedContactVersion",
        "expectedCompanyId",
        "submissionKey",
      ]),
      name = boundedText(b.name, 200, "Display name");
    // The previous name-only client stays compatible; it never receives a broader
    // write surface. Unknown assignment/access fields are rejected above.
    const legacy = Object.keys(b).length === 1;
    const details = legacy ? null : parse(b);
    if (
      !legacy &&
      (!Number.isSafeInteger(b.expectedVersion) ||
        Number(b.expectedVersion) < 0 ||
        typeof b.expectedNameVersion !== "string")
    )
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Review the current profile version.",
      );
    const key = legacy
      ? null
      : submission(b.submissionKey, [
          name,
          details,
          b.expectedVersion,
          b.expectedNameVersion,
          b.expectedContactVersion,
          b.expectedCompanyId,
        ]);
    const preparation=await own(db,request,async(tx,user)=>{
      if(!legacy){
        const previous=await tx.accountProfileRevision.findUnique({where:{userId_submissionKey:{userId:user.id,submissionKey:key!.submissionKey}}});
        if(previous){sameSubmission(previous.submissionHash,key!.submissionHash);return {replay:previous.version,subject:null};}
        const c=await context(tx,user);
        if((c.profile?.version??0)!==b.expectedVersion || user.updatedAt.toISOString()!==b.expectedNameVersion || (c.contact?.version??null)!==b.expectedContactVersion || (user.membership?.companyId??null)!==b.expectedCompanyId)throw conflict();
        if(details!.preferredContact==="email"&&c.contact&&!c.contact.email)throw new AccessError(400,"INVALID_INPUT","Ask management to add your contact email, or choose another contact preference.");
      }
      if(user.name===name)return {replay:null,subject:null};
      const identity=await tx.identity.findFirst({where:{userId:user.id,issuer:provider?.issuer??""}});
      if(!provider?.rename||!identity)throw new AccessError(503,"IDENTITY_NOT_CONFIGURED","Account name changes require the Auth0 connection. Contact your platform administrator.");
      return {replay:null,subject:identity.subject};
    });
    if(preparation.replay!==null)return {saved:true,version:preparation.replay};
    if(preparation.subject){
      const remote=await provider!.rename(preparation.subject,name);
      if(remote.user_id!==preparation.subject||remote.name!==name)throw new AccessError(409,"IDENTITY_PROFILE_CONFLICT","Auth0 did not confirm this name. Refresh and retry.");
    }
    return own(db, request, async (tx, user) => {
      if (legacy) {
        const result = await tx.user.update({
          where: { id: user.id },
          data: { name },
          select: { id: true, name: true },
        });
        await tx.auditEvent.create({
          data: {
            actorId: user.id,
            targetId: user.id,
            companyId: user.membership?.companyId ?? null,
            action: "profile.updated",
            requestId: request.id,
          },
        });
        return result;
      }
      const previous = await tx.accountProfileRevision.findUnique({
        where: {
          userId_submissionKey: {
            userId: user.id,
            submissionKey: key!.submissionKey,
          },
        },
      });
      if (previous) {
        sameSubmission(previous.submissionHash, key!.submissionHash);
        return { saved: true, version: previous.version };
      }
      const c = await context(tx, user);
      if (
        (c.profile?.version ?? 0) !== b.expectedVersion ||
        user.updatedAt.toISOString() !== b.expectedNameVersion ||
        (c.contact?.version ?? null) !== b.expectedContactVersion ||
        (user.membership?.companyId ?? null) !== b.expectedCompanyId
      )
        throw conflict();
      if (
        details!.preferredContact === "email" &&
        c.contact &&
        !c.contact.email
      )
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Ask management to add your contact email, or choose another contact preference.",
        );
      const next = (c.profile?.version ?? 0) + 1;
      if (c.profile)
        await tx.accountProfile.update({
          where: { userId: user.id },
          data: { details: details!, version: next, updatedAt: new Date() },
        });
      else
        await tx.accountProfile.create({
          data: { userId: user.id, version: next, details: details! },
        });
      await tx.accountProfileRevision.create({
        data: {
          userId: user.id,
          version: next,
          details: { ...details!, name },
          ...key!,
        },
      });
      await tx.user.update({ where: { id: user.id }, data: { name } });
      if (c.contact) {
        await tx.$queryRaw`UPDATE "ResidentContact" SET "updatedAt"="updatedAt" WHERE id=${c.contact.id} AND "companyId"=${c.contact.companyId} RETURNING id`;
        const member = user.membership!;
        const compatibility = {
          contactName: member.contactName,
          contactPhone: details!.phone,
          emergencyContactName: details!.emergencyContactName,
          emergencyContactPhone: details!.emergencyContactPhone,
          managementNotes: member.managementNotes,
        };
        await tx.companyMembership.update({
          where: { userId: user.id },
          data: {
            contactPhone: details!.phone,
            emergencyContactName: details!.emergencyContactName,
            emergencyContactPhone: details!.emergencyContactPhone,
            version: { increment: 1 },
          },
        });
        await tx.residentContact.update({
          where: { id: c.contact.id },
          data: {
            ...details!,
            version: { increment: 1 },
            compatibilityProfile: residentCompatibilityProfile(compatibility),
          },
        });
        await audit(
          tx,
          request,
          c.contact.companyId,
          c.contact.id,
          "resident.contact.self_updated",
          { fields: keys, profileVersion: next },
        );
      }
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          targetId: user.id,
          companyId: user.membership?.companyId ?? null,
          action: "profile.updated",
          requestId: request.id,
          detail: {
            version: next,
            fields: ["name", ...keys],
            sharedWithManagement: !!c.contact,
          },
        },
      });
      return { saved: true, version: next };
    });
  });
}
