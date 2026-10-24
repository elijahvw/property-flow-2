import type { FastifyInstance, preValidationHookHandler } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { lockUnit } from "./leasing.js";
import { audit, boundedText, choice, conflict, date, input, mutation, sameSubmission, scoped, submission, version } from "./operational.js";
import { companyDay } from "./reports.js";

export const AVAILABILITY_STATES = ["occupied", "future_occupancy", "ready", "turnover", "unavailable", "unconfirmed", "archived"] as const;
export const AVAILABILITY_DEFINITION = "Lease projections use the selected planning date and current recorded lease status and dates. Operational readiness is the latest management review, not reconstructed historical occupancy or a guarantee of future availability. Draft leases do not reserve a unit. A unit without a current lease remains unconfirmed until reviewed.";
const currentSelect = { version: true, condition: true, availableOn: true, reason: true, updatedAt: true } as const;
const isoDay = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
type BoardRow = {
  id: string; propertyId: string; label: string; unitStatus: string; unitVersion: number; marketRentCents: number | null; propertyName: string;
  availabilityVersion: number | null; condition: string | null; availableOn: Date | null; reason: string | null; updatedAt: Date | null;
  state: typeof AVAILABILITY_STATES[number]; readinessStale: boolean;
  currentLeaseId: string | null; currentLeaseStartsOn: Date | null; currentLeaseEndsOn: Date | null;
  nextLeaseId: string | null; nextLeaseStartsOn: Date | null; nextLeaseEndsOn: Date | null; latestLeaseEnd: Date | null;
};
function dto(row: BoardRow) {
  return {
    unit: { id: row.id, propertyId: row.propertyId, label: row.label, status: row.unitStatus, version: row.unitVersion, marketRentCents: row.marketRentCents, property: { id: row.propertyId, name: row.propertyName } },
    availability: row.availabilityVersion === null ? null : { version: row.availabilityVersion, condition: row.condition, availableOn: isoDay(row.availableOn), reason: row.reason, updatedAt: row.updatedAt },
    state: row.state, readinessStale: row.readinessStale,
    currentLease: row.currentLeaseId ? { id: row.currentLeaseId, startsOn: isoDay(row.currentLeaseStartsOn), endsOn: isoDay(row.currentLeaseEndsOn), status: "active" } : null,
    nextLease: row.nextLeaseId ? { id: row.nextLeaseId, startsOn: isoDay(row.nextLeaseStartsOn), endsOn: isoDay(row.nextLeaseEndsOn), status: "active" } : null,
    latestLeaseEnd: isoDay(row.latestLeaseEnd),
  };
}

export function registerUnitAvailability(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string) {
  const auth = { preValidation: authenticate };
  server.get<{ Querystring: Record<string, unknown> }>("/api/company/availability", auth, request => {
    const query = request.query;
    if (Object.keys(query).some(key => !["propertyId", "q", "status", "asOf", "cursor"].includes(key))) throw new AccessError(400, "INVALID_INPUT", "Choose valid availability filters.");
    if (query.q !== undefined && (typeof query.q !== "string" || query.q.length > 200 || query.q.includes("\0"))) throw new AccessError(400, "INVALID_INPUT", "Search must be at most 200 characters.");
    const propertyId = query.propertyId === undefined ? null : assignmentId(query.propertyId);
    const cursor = query.cursor === undefined ? null : assignmentId(query.cursor);
    const status = query.status === undefined ? null : choice(query.status, [...AVAILABILITY_STATES], "availability state");
    const planning = query.asOf === undefined ? null : date(query.asOf, "planning date");
    const search = typeof query.q === "string" ? query.q.trim() : "";
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } });
      const today = companyDay(company.timezone), planningDate = planning ?? date(today, "planning date");
      if (propertyId && !await tx.property.findFirst({ where: { id: propertyId, companyId }, select: { id: true } })) throw new AccessError(404, "NOT_FOUND", "Property not found.");
      const data = Prisma.sql`WITH source AS (
        SELECT u.id,u."propertyId",u.label,u.status AS "unitStatus",u.version AS "unitVersion",u."marketRentCents",p.name AS "propertyName",
          a.version AS "availabilityVersion",a.condition,a."availableOn",a.reason,a."updatedAt",
          current_lease.id AS "currentLeaseId",current_lease."startsOn" AS "currentLeaseStartsOn",current_lease."endsOn" AS "currentLeaseEndsOn",
          next_lease.id AS "nextLeaseId",next_lease."startsOn" AS "nextLeaseStartsOn",next_lease."endsOn" AS "nextLeaseEndsOn",past_lease."endsOn" AS "latestLeaseEnd"
        FROM "Unit" u JOIN "Property" p ON p.id=u."propertyId" AND p."companyId"=u."companyId"
        LEFT JOIN "UnitAvailability" a ON a."unitId"=u.id AND a."propertyId"=u."propertyId" AND a."companyId"=u."companyId"
        LEFT JOIN LATERAL (SELECT l.id,l."startsOn",l."endsOn" FROM "Lease" l WHERE l."companyId"=u."companyId" AND l."unitId"=u.id AND l.status='active' AND l."startsOn"<=${planningDate} AND (l."endsOn" IS NULL OR l."endsOn">=${planningDate}) ORDER BY l."startsOn" DESC,l.id DESC LIMIT 1) current_lease ON true
        LEFT JOIN LATERAL (SELECT l.id,l."startsOn",l."endsOn" FROM "Lease" l WHERE l."companyId"=u."companyId" AND l."unitId"=u.id AND l.status='active' AND l."startsOn">${planningDate} ORDER BY l."startsOn",l.id LIMIT 1) next_lease ON true
        LEFT JOIN LATERAL (SELECT l."endsOn" FROM "Lease" l WHERE l."companyId"=u."companyId" AND l."unitId"=u.id AND l.status IN ('active','ended') AND l."endsOn"<${planningDate} ORDER BY l."endsOn" DESC,l.id DESC LIMIT 1) past_lease ON true
        WHERE u."companyId"=${companyId}
          ${propertyId ? Prisma.sql`AND u."propertyId"=${propertyId}` : Prisma.empty}
          ${search ? Prisma.sql`AND (strpos(lower(u.label),lower(${search}))>0 OR strpos(lower(p.name),lower(${search}))>0)` : Prisma.empty}
      ), classified AS (SELECT *,
        condition='ready' AND ("availableOn" IS NULL OR "latestLeaseEnd">="availableOn") AS "readinessStale",
        CASE WHEN "unitStatus"='archived' THEN 'archived'
          WHEN "currentLeaseId" IS NOT NULL THEN 'occupied'
          WHEN condition='unavailable' THEN 'unavailable'
          WHEN condition='turnover' THEN 'turnover'
          WHEN "nextLeaseId" IS NOT NULL THEN 'future_occupancy'
          WHEN condition='ready' AND "availableOn"<=${planningDate} AND ("latestLeaseEnd" IS NULL OR "availableOn">"latestLeaseEnd") THEN 'ready'
          ELSE 'unconfirmed' END AS state
        FROM source)
      `;
      const grouped = await tx.$queryRaw<{ state: string; total: number }[]>(Prisma.sql`${data} SELECT state,count(*)::int AS total FROM classified GROUP BY state`);
      const rows = await tx.$queryRaw<BoardRow[]>(Prisma.sql`${data} SELECT * FROM classified WHERE true ${status ? Prisma.sql`AND state=${status}` : Prisma.empty} ${cursor ? Prisma.sql`AND id<${cursor}` : Prisma.empty} ORDER BY id DESC LIMIT 51`);
      const counts = Object.fromEntries(AVAILABILITY_STATES.map(state => [state, grouped.find(row => row.state === state)?.total ?? 0])) as Record<typeof AVAILABILITY_STATES[number], number>;
      return { planningDate: isoDay(planningDate), today, timezone: company.timezone, definition: AVAILABILITY_DEFINITION, items: rows.slice(0, 50).map(row => dto({ ...row, readinessStale: row.readinessStale === true })), counts, total: status ? counts[status as typeof AVAILABILITY_STATES[number]] : Object.values(counts).reduce((sum, value) => sum + value, 0), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  });

  server.put<{ Params: { unitId: string } }>("/api/company/units/:unitId/availability", auth, request => {
    mutation(request, origin);
    const unitId = assignmentId(request.params.unitId), body = input(request, ["expectedVersion", "condition", "availableOn", "reason", "submissionKey"]);
    const expectedVersion = body.expectedVersion === null ? null : version(body.expectedVersion);
    const condition = choice(body.condition, ["ready", "turnover", "unavailable", "unconfirmed"], "operational condition");
    const availableOn = body.availableOn === undefined || body.availableOn === null || body.availableOn === "" ? null : date(body.availableOn, "readiness or estimated availability date");
    const reason = boundedText(body.reason, 500, "Review reason");
    const key = submission(body.submissionKey, { unitId, expectedVersion, condition, availableOn, reason });
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      const unit = await lockUnit(tx, companyId, unitId);
      const previous = await tx.unitAvailabilityRevision.findUnique({ where: { companyId_submissionKey: { companyId, submissionKey: key.submissionKey } }, select: { unitId: true, submissionHash: true } });
      if (previous) {
        sameSubmission(previous.submissionHash, key.submissionHash);
        if (previous.unitId !== unitId) throw new AccessError(409, "SUBMISSION_MISMATCH", "This review belongs to another unit.");
        return { availability: await tx.unitAvailability.findUniqueOrThrow({ where: { unitId, companyId }, select: currentSelect }) };
      }
      if (unit.status !== "active") throw new AccessError(409, "UNIT_ARCHIVED", "Restore this unit before recording a new readiness review.");
      const current = await tx.unitAvailability.findUnique({ where: { unitId, companyId }, select: currentSelect });
      if ((current?.version ?? null) !== expectedVersion) throw conflict();
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } });
      const today = date(companyDay(company.timezone), "company business date");
      const reviewedDate = condition === "ready" ? availableOn ?? today : condition === "unconfirmed" ? null : availableOn;
      if (condition === "ready") {
        if (reviewedDate! > today) throw new AccessError(400, "FUTURE_READINESS", "Confirm readiness on or before today's company business date. Use an estimated date while a unit is in turnover or unavailable.");
        const occupied = await tx.lease.findFirst({ where: { companyId, unitId, status: "active", startsOn: { lte: today }, OR: [{ endsOn: null }, { endsOn: { gte: today } }] }, select: { id: true } });
        if (occupied) throw new AccessError(409, "UNIT_OCCUPIED", "This unit has a current active lease. Review the lease ending before confirming the unit is vacant and ready.");
        const lastLease = await tx.lease.findFirst({ where: { companyId, unitId, status: { in: ["active", "ended"] }, endsOn: { lte: today } }, select: { endsOn: true }, orderBy: [{ endsOn: "desc" }, { id: "desc" }] });
        if (lastLease?.endsOn && reviewedDate! <= lastLease.endsOn) throw new AccessError(409, "READINESS_PRECEDES_TENANCY", "The readiness confirmation must follow the latest recorded lease end. Review the unit again after its tenancy.");
      }
      const values = { condition, availableOn: reviewedDate, reason, updatedById: request.principal!.id };
      const row = current
        ? await tx.unitAvailability.update({ where: { unitId, companyId }, data: { ...values, version: { increment: 1 } }, select: currentSelect })
        : await tx.unitAvailability.create({ data: { companyId, propertyId: unit.propertyId, unitId, ...values }, select: currentSelect });
      await tx.unitAvailabilityRevision.create({ data: { companyId, propertyId: unit.propertyId, unitId, version: row.version, snapshot: JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue, reason, actorId: request.principal!.id, ...key } });
      await audit(tx, request, companyId, unitId, "availability.reviewed", { version: row.version, condition, availableOn: isoDay(reviewedDate) });
      return { availability: row };
    });
  });

  server.get<{ Params: { unitId: string }; Querystring: Record<string, unknown> }>("/api/company/units/:unitId/availability/history", auth, request => {
    const unitId = assignmentId(request.params.unitId), query = request.query;
    if (Object.keys(query).some(key => key !== "cursor")) throw new AccessError(400, "INVALID_INPUT", "Choose a valid history page.");
    const cursor = query.cursor === undefined ? null : assignmentId(query.cursor);
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      if (!await tx.unit.findFirst({ where: { id: unitId, companyId }, select: { id: true } })) throw new AccessError(404, "NOT_FOUND", "Unit not found.");
      const rows = await tx.unitAvailabilityRevision.findMany({ where: { companyId, unitId, ...(cursor ? { id: { lt: cursor } } : {}) }, select: { id: true, version: true, snapshot: true, reason: true, actorId: true, createdAt: true }, orderBy: { id: "desc" }, take: 51 });
      return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null };
    });
  });
}
