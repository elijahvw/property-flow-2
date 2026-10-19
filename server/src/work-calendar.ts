import type { FastifyInstance, preValidationHookHandler } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { choice, date, scoped } from "./operational.js";
import { companyDay } from "./reports.js";

export function registerWorkCalendar(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
) {
  server.get<{ Querystring: Record<string, string> }>(
    "/api/company/work-calendar",
    { preValidation: authenticate },
    (r) => {
      const q = r.query;
      if (
        Object.keys(q).some(
          (k) => !["month", "day", "propertyId", "kind", "page"].includes(k),
        ) ||
        (q.month !== undefined &&
          !/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(q.month)) ||
        (q.page !== undefined && !/^[1-9][0-9]{0,5}$/.test(q.page))
      )
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Choose a valid calendar month and filters.",
        );
      const kind = choice(
          q.kind || "all",
          ["all", "schedule", "request"],
          "work type",
        ),
        propertyId =
          q.propertyId === undefined ? null : assignmentId(q.propertyId),
        day = q.day === undefined ? null : date(q.day, "calendar day"),
        page = Number(q.page || 1);
      return scoped(db, r, "maintenance.manage", async (tx, companyId) => {
        const { timezone } = await tx.company.findUniqueOrThrow({
            where: { id: companyId },
            select: { timezone: true },
          }),
          today = companyDay(timezone),
          month = q.month || today.slice(0, 7);
        if (day && day.toISOString().slice(0, 7) !== month)
          throw new AccessError(
            400,
            "INVALID_INPUT",
            "Choose a day in the selected month.",
          );
        if (
          propertyId &&
          !(await tx.property.findFirst({
            where: { id: propertyId, companyId },
            select: { id: true },
          }))
        )
          throw new AccessError(404, "NOT_FOUND", "Property not found.");
        const start = date(month + "-01", "month"),
          last = new Date(
            Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
          );
        // Both summaries and rows read the same source set in one scoped transaction.
        // A generated occurrence exists only as a request; the plan has advanced.
        const events = Prisma.sql`WITH events AS (
        SELECT p.id, 'schedule'::text kind, p.title, p."nextOn" AS "dueOn",p.timezone,p.priority,p.status,
          p."propertyId",p."unitId", home.name AS "propertyName",u.label AS "unitLabel"
        FROM "PreventivePlan" p JOIN "Property" home ON home.id=p."propertyId" AND home."companyId"=p."companyId"
        LEFT JOIN "Unit" u ON u.id=p."unitId" AND u."propertyId"=p."propertyId" AND u."companyId"=p."companyId"
        WHERE p."companyId"=${companyId} AND p.status='active' AND p."nextOn" BETWEEN ${start} AND ${last}
          ${propertyId ? Prisma.sql`AND p."propertyId"=${propertyId}` : Prisma.empty}
        UNION ALL
        SELECT r.id,'request'::text kind,r.title,r."targetOn" AS "dueOn",COALESCE(plan.timezone,${timezone}) AS timezone,r.priority,r.status,
          r."propertyId",r."unitId",home.name AS "propertyName",u.label AS "unitLabel"
        FROM "MaintenanceRequest" r JOIN "Property" home ON home.id=r."propertyId" AND home."companyId"=r."companyId"
        LEFT JOIN "Unit" u ON u.id=r."unitId" AND u."propertyId"=r."propertyId" AND u."companyId"=r."companyId"
        LEFT JOIN "PreventiveOccurrence" occurrence ON occurrence."requestId"=r.id AND occurrence."companyId"=r."companyId"
        LEFT JOIN "PreventivePlan" plan ON plan.id=occurrence."planId" AND plan."companyId"=occurrence."companyId"
        WHERE r."companyId"=${companyId} AND r.status<>'resolved' AND r."targetOn" BETWEEN ${start} AND ${last}
          ${propertyId ? Prisma.sql`AND r."propertyId"=${propertyId}` : Prisma.empty}
      ), filtered AS (SELECT *,"dueOn"<(CURRENT_TIMESTAMP AT TIME ZONE timezone)::date AS overdue FROM events WHERE ${kind === "all" ? Prisma.sql`true` : Prisma.sql`kind=${kind}`})`;
        const days = await tx.$queryRaw<
          {
            dueOn: Date;
            total: number;
            schedules: number;
            requests: number;
            overdue: number;
          }[]
        >(
          Prisma.sql`${events} SELECT "dueOn",count(*)::int AS total,count(*) FILTER(WHERE kind='schedule')::int AS schedules,count(*) FILTER(WHERE kind='request')::int AS requests,count(*) FILTER(WHERE overdue)::int AS overdue FROM filtered GROUP BY "dueOn" ORDER BY "dueOn"`,
        );
        const items = await tx.$queryRaw(
          Prisma.sql`${events} SELECT * FROM filtered ${day ? Prisma.sql`WHERE "dueOn"=${day}` : Prisma.empty} ORDER BY "dueOn",kind,title,id LIMIT 25 OFFSET ${(page - 1) * 25}`,
        );
        const total = days
          .filter((row) => !day || +row.dueOn === +day)
          .reduce((sum, row) => sum + row.total, 0);
        return {
          month,
          day: day?.toISOString().slice(0, 10) || null,
          today,
          timezone,
          days,
          items,
          total,
          monthTotal: days.reduce((sum, row) => sum + row.total, 0),
          page,
          pageSize: 25,
        };
      });
    },
  );
}
