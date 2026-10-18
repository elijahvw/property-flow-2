import { rentCollections } from "./rent-collections.js";
import type { FastifyInstance, preValidationHookHandler } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AccessError, permissions } from "./access.js";
import { assignmentId } from "./application.js";
import { scoped } from "./operational.js";
import { companyDay } from "./reports.js";
export function registerOverview(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
) {
  server.get(
    "/api/company/property-directory",
    { preValidation: authenticate },
    (request) => {
      if (Object.keys(request.query as object).length)
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Unknown property directory filter.",
        );
      return scoped(db, request, "property.read", async (tx, companyId, propertyIds) => {
        const company = await tx.company.findUniqueOrThrow({
          where: { id: companyId },
          select: { timezone: true },
        });
        const actor = await tx.user.findUniqueOrThrow({
          where: { id: request.principal!.id },
          include: { membership: { include: { company: true } } },
        });
        const grants = permissions(actor),
          today = companyDay(company.timezone),
          day = new Date(today + "T00:00:00Z");
        const units = await tx.unit.groupBy({
          by: ["propertyId"],
          where: { companyId, status: "active", ...(propertyIds ? { propertyId: { in: propertyIds } } : {}) },
          _count: true,
        });
        const properties = await tx.property.findMany({
          where: { companyId, ...(propertyIds ? { id: { in: propertyIds } } : {}) },
          select: { id: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        });
        const occupied = grants.includes("lease.manage")
          ? await tx.unit.groupBy({
              by: ["propertyId"],
              where: {
                companyId,
                status: "active",
                leases: {
                  some: {
                    companyId,
                    status: "active",
                    startsOn: { lte: day },
                    OR: [{ endsOn: null }, { endsOn: { gte: day } }],
                  },
                },
              },
              _count: true,
            })
          : null;
        const drafts = grants.includes("lease.manage")
          ? await tx.lease.groupBy({
              by: ["propertyId"],
              where: { companyId, status: "draft" },
              _count: true,
            })
          : null;
        const maintenance = grants.includes("maintenance.manage")
          ? await tx.maintenanceRequest.groupBy({
              by: ["propertyId"],
              where: { companyId, status: { in: ["open", "in_progress"] } },
              _count: true,
            })
          : null;
        const counts = (rows:{propertyId:string;_count:number}[]) => new Map(rows.map(row=>[row.propertyId,row._count]));
        const unitCounts=counts(units),occupiedCounts=counts(occupied||[]),draftCounts=counts(drafts||[]),maintenanceCounts=counts(maintenance||[]);
        return {
          today,
          items: properties.map((p) => ({
            id: p.id,
            activeUnits: unitCounts.get(p.id)||0,
            ...(occupied && drafts
              ? {
                  occupiedUnits: occupiedCounts.get(p.id)||0,
                  draftLeases: draftCounts.get(p.id)||0,
                }
              : {}),
            ...(maintenance
              ? { openMaintenance: maintenanceCounts.get(p.id)||0 }
              : {}),
          })),
        };
      });
    },
  );
  server.get<{ Querystring: { propertyId?: string } }>(
    "/api/company/overview",
    { preValidation: authenticate },
    (request) => {
      if (Object.keys(request.query).some((k) => k !== "propertyId"))
        throw new AccessError(400, "INVALID_INPUT", "Unknown overview filter.");
      const propertyId =
        request.query.propertyId === undefined
          ? undefined
          : assignmentId(request.query.propertyId);
      return scoped(db, request, "property.read", async (tx, companyId, propertyIds) => {
        if (propertyId && propertyIds && !propertyIds.includes(propertyId)) throw new AccessError(404, "NOT_FOUND", "Property not found.");
        const company = await tx.company.findUniqueOrThrow({
          where: { id: companyId },
          select: { name: true, timezone: true },
        });
        const property = propertyId
          ? await tx.property.findFirst({
              where: { id: propertyId, companyId },
              select: { id: true, name: true },
            })
          : null;
        if (propertyId && !property)
          throw new AccessError(404, "NOT_FOUND", "Property not found.");
        // Re-read capabilities inside the protected snapshot; a queued role downgrade must not expose management data.
        const actor = await tx.user.findUniqueOrThrow({
          where: { id: request.principal!.id },
          include: { membership: { include: { company: true } } },
        });
        const grants = permissions(actor),
          today = companyDay(company.timezone),
          date = new Date(today + "T00:00:00Z"),
          through = new Date(date);
        through.setUTCDate(through.getUTCDate() + 30);
        const where = { companyId, ...(propertyId ? { propertyId } : propertyIds ? { propertyId: { in: propertyIds } } : {}) };
        const propertyWhere = {
          companyId,
          ...(propertyId ? { id: propertyId } : propertyIds ? { id: { in: propertyIds } } : {}),
        };
        const result = {
          company,
          property,
          today,
          generatedAt: new Date().toISOString(),
          propertyCount: await tx.property.count({ where: propertyWhere }),
          activeUnitCount: await tx.unit.count({
            where: { ...where, status: "active" },
          }),
          properties: await tx.property.findMany({
            where: propertyWhere,
            select: {
              id: true,
              name: true,
              address: true,
              city: true,
              state: true,
              _count: { select: { units: true } },
            },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            take: 6,
          }),
        };
        const management: Record<string, unknown> = {};
        if(grants.includes("members.manage"))management.residentApprovals={pendingCount:await tx.invitation.count({where:{companyId,...(propertyId?{propertyId}:{}),leaseId:{not:null},approvedAt:null,acceptedAt:null,revokedAt:null,expiresAt:{gt:new Date()},lease:{status:{in:["draft","active"]},OR:[{endsOn:null},{endsOn:{gte:date}}]}}})};
        if (grants.includes("lease.manage")) {
          const active = {
              ...where,
              status: "active",
              unit: { status: "active" },
            },
            inEffect = {
              ...active,
              startsOn: { lte: date },
              OR: [{ endsOn: null }, { endsOn: { gte: date } }],
            };
          const [rent] = await tx.$queryRaw<{ amount: bigint }[]>(
            Prisma.sql`SELECT COALESCE(SUM(COALESCE((SELECT t."rentCents" FROM "LeaseTermChange" t WHERE t."companyId"=l."companyId" AND t."leaseId"=l.id AND t."effectiveOn"<=${date} AND NOT EXISTS(SELECT 1 FROM "LeaseTermCancellation" x WHERE x."changeId"=t.id AND x."companyId"=l."companyId") ORDER BY t."effectiveOn" DESC,t.id DESC LIMIT 1),l."rentCents")),0)::bigint amount FROM "Lease" l JOIN "Unit" u ON u.id=l."unitId" AND u."companyId"=l."companyId" WHERE l."companyId"=${companyId} AND l.status='active' AND u.status='active' AND l."startsOn"<=${date} AND (l."endsOn" IS NULL OR l."endsOn">=${date}) ${propertyId ? Prisma.sql`AND l."propertyId"=${propertyId}` : Prisma.empty}`,
          );
          management.leases = {
            inEffectCount: await tx.lease.count({ where: inEffect }),
            monthlyRentCents: String(rent.amount),
            draftCount: await tx.lease.count({
              where: { ...where, status: "draft" },
            }),
            endingSoonCount: await tx.lease.count({
              where: { ...active, endsOn: { gte: date, lte: through } },
            }),
            pastEndCount: await tx.lease.count({
              where: { ...active, endsOn: { lt: date } },
            }),
            withoutCurrentLease: await tx.unit.count({
              where: {
                ...where,
                status: "active",
                leases: {
                  none: {
                    companyId,
                    status: "active",
                    startsOn: { lte: date },
                    OR: [{ endsOn: null }, { endsOn: { gte: date } }],
                  },
                },
              },
            }),
            endingSoon: await tx.lease.findMany({
              where: { ...active, endsOn: { gte: date, lte: through } },
              select: {
                id: true,
                propertyId: true,
                endsOn: true,
                property: { select: { name: true } },
                unit: { select: { label: true } },
              },
              orderBy: [{ endsOn: "asc" }, { id: "asc" }],
              take: 5,
            }),
          };
        }
        if (grants.includes("maintenance.manage")) {
          const open = { ...where, status: { in: ["open", "in_progress"] } };
          management.maintenance = {
            openCount: await tx.maintenanceRequest.count({ where: open }),
            reviewCount: await tx.maintenanceRequest.count({where:{...where,executionStatus:"pending_review",status:{not:"resolved"}}}),
            overdueCount: await tx.maintenanceRequest.count({where:{...open,targetOn:{lt:date}}}),
            highPriorityCount: await tx.maintenanceRequest.count({
              where: { ...open, priority: "high" },
            }),
            latest: await tx.maintenanceRequest.findMany({
              where: open,
              select: {
                id: true,
                propertyId: true,
                title: true,
                status: true,
                priority: true,
                property: { select: { name: true } },
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 5,
            }),
          };
        }
        if (grants.includes("finance.manage")) {
          management.billingIssues={count:await tx.rentSchedule.count({where:{...where,status:"active",lastErrorCode:{not:null}}})};
          management.rentCollections = await rentCollections(tx,companyId,today,propertyId);
          const from = today.slice(0, 7) + "-01";
          const [totals] = await tx.$queryRaw<
            { income: bigint; expense: bigint; rentRefund:bigint }[]
          >(
            Prisma.sql`SELECT COALESCE(SUM("amountCents") FILTER (WHERE kind='income'),0)::bigint income,COALESCE(SUM("amountCents") FILTER (WHERE kind='expense'),0)::bigint expense,COALESCE(SUM("amountCents") FILTER (WHERE kind='refund' AND category='rent'),0)::bigint "rentRefund" FROM "LedgerEntry" WHERE "companyId"=${companyId} AND "voidedAt" IS NULL AND "occurredOn">=${new Date(from + "T00:00:00Z")} AND "occurredOn"<=${date} ${propertyId ? Prisma.sql`AND "propertyId"=${propertyId}` : Prisma.empty}`,
          );
          management.cash = {
            dateFrom: from,
            dateTo: today,
            incomeCents: String(totals.income),
            expenseCents: String(totals.expense),
            ...(totals.rentRefund>0n?{rentRefundCents:String(totals.rentRefund)}:{}),
            netCents: String(totals.income - totals.expense - totals.rentRefund),
          };
        }
        return { ...result, ...management };
      });
    },
  );
}
