import { publishNotification, type NotificationPublisher } from "./notification-events.js";
import type {
  FastifyInstance,
  FastifyRequest,
  preValidationHookHandler,
} from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import {
  audit,
  boundedText,
  choice,
  conflict,
  date,
  input,
  mutation,
  sameSubmission,
  scoped,
  submission,
  version,
  type Tx,
} from "./operational.js";
import { companyDay } from "./reports.js";
import { nextOccurrence } from "./recurrence.js";

const base = "/api/company/preventive";
const select = {
  id: true,
  propertyId: true,
  unitId: true,
  title: true,
  description: true,
  category: true,
  priority: true,
  cadence: true,
  anchorOn: true,
  endOn: true,
  nextOn: true,
  timezone: true,
  status: true,
  version: true,
  property: { select: { name: true } },
  unit: { select: { label: true } },
} as const;
function fields(b: Record<string, unknown>) {
  return {
    title: boundedText(b.title, 160, "Title"),
    description: boundedText(b.description, 4000, "Instructions"),
    category: choice(
      b.category,
      [
        "plumbing",
        "electrical",
        "hvac",
        "appliance",
        "structural",
        "safety",
        "other",
      ],
      "category",
    ),
    priority: choice(b.priority, ["low", "normal", "high"], "priority"),
  };
}
function pageNumber(q: Record<string, string>, keys: string[]) {
  if (
    Object.keys(q).some((k) => !keys.includes(k)) ||
    (q.page !== undefined && !/^[1-9][0-9]{0,5}$/.test(q.page))
  )
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Choose valid filters and page.",
    );
  return Number(q.page || 1);
}
export function registerPreventive(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
  publish: NotificationPublisher = publishNotification,
) {
  const auth = { preValidation: authenticate };
  const run = <T>(
    r: FastifyRequest,
    fn: (tx: Tx, companyId: string) => Promise<T>,
  ) => scoped(db, r, "maintenance.manage", fn);
  const write = <T>(
    r: FastifyRequest,
    fn: (tx: Tx, companyId: string) => Promise<T>,
  ) => {
    mutation(r, origin);
    return run(r, fn);
  };
  const plan = async (tx: Tx, companyId: string, id: string, lock = false) => {
    if (lock)
      await tx.$queryRaw`SELECT id FROM "PreventivePlan" WHERE id=${id} AND "companyId"=${companyId} FOR UPDATE`;
    const row = await tx.preventivePlan.findFirst({
      where: { id, companyId },
      select,
    });
    if (!row) throw new AccessError(404, "NOT_FOUND", "Schedule not found.");
    return row;
  };
  const replay = async (
    tx: Tx,
    companyId: string,
    r: FastifyRequest,
    key: ReturnType<typeof submission>,
  ) => {
    const row = await tx.preventiveAction.findFirst({
      where: {
        companyId,
        actorId: r.principal!.id,
        submissionKey: key.submissionKey,
      },
    });
    if (!row) return null;
    sameSubmission(row.submissionHash, key.submissionHash);
    return {
      saved: true,
      planId: row.planId,
      requestId: row.requestId,
      recovered: true,
      changed: row.changed,
    };
  };
  const record = async (
    tx: Tx,
    companyId: string,
    r: FastifyRequest,
    key: ReturnType<typeof submission>,
    planId: string,
    action: string,
    snapshot: Prisma.InputJsonValue,
    requestId: string | null = null,
    changed = true,
  ) => {
    await tx.preventiveAction.create({
      data: {
        companyId,
        planId,
        actorId: r.principal!.id,
        ...key,
        action,
        snapshot,
        requestId,
        changed,
      },
    });
    if (changed)
      await audit(tx, r, companyId, planId, `preventive.${action}`, {
        requestId,
      });
    return { saved: true, planId, requestId, changed };
  };
  server.get<{ Querystring: Record<string, string> }>(base, auth, (r) => {
    const page = pageNumber(r.query, [
        "page",
        "q",
        "status",
        "due",
        "propertyId",
      ]),
      q =
        r.query.q === undefined
          ? undefined
          : boundedText(r.query.q, 200, "Search"),
      status = choice(
        r.query.status || "active",
        ["active", "paused", "all"],
        "status",
      ),
      due = choice(
        r.query.due || "all",
        ["all", "due", "overdue", "upcoming", "finished"],
        "due filter",
      ),
      propertyId =
        r.query.propertyId === undefined
          ? undefined
          : assignmentId(r.query.propertyId);
    return run(r, async (tx, companyId) => {
      const company = await tx.company.findUniqueOrThrow({
          where: { id: companyId },
          select: { timezone: true },
        }),
        today = companyDay(company.timezone);
      // Each plan retains its explicit timezone even if company settings later change.
      // Filter by stored timezone and local day before counting or paging.
      const zones =
        due === "due" || due === "overdue" || due === "upcoming"
          ? await tx.preventivePlan.groupBy({
              by: ["timezone"],
              where: { companyId },
            })
          : null;
      const dueWhere: Prisma.PreventivePlanWhereInput = zones
        ? {
            OR: zones.map(({ timezone }) => ({
              timezone,
              nextOn: {
                [due === "due" ? "lte" : due === "overdue" ? "lt" : "gt"]: date(
                  companyDay(timezone),
                  "local day",
                ),
              },
            })),
          }
        : {};
      const where: Prisma.PreventivePlanWhereInput = {
        companyId,
        ...(status === "all" ? {} : { status }),
        ...(propertyId ? { propertyId } : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { property: { name: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
        AND: [dueWhere],
        ...(due === "finished" ? { nextOn: null } : {}),
      };
      const items = await tx.preventivePlan.findMany({
        where,
        select,
        orderBy: [{ nextOn: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        skip: (page - 1) * 25,
        take: 25,
      });
      return {
        items: items.map((row) => ({
          ...row,
          today: companyDay(row.timezone),
        })),
        total: await tx.preventivePlan.count({ where }),
        page,
        pageSize: 25,
        today,
        timezone: company.timezone,
      };
    });
  });
  server.post(base, auth, (r) => {
    const b = input(r, [
        "title",
        "description",
        "category",
        "priority",
        "propertyId",
        "unitId",
        "cadence",
        "anchorOn",
        "timezone",
        "endOn",
        "submissionKey",
      ]),
      data = fields(b),
      reviewedTimezone = boundedText(b.timezone, 100, "Timezone"),
      propertyId = assignmentId(b.propertyId),
      unitId = b.unitId == null ? null : assignmentId(b.unitId),
      cadence = choice(
        b.cadence,
        ["weekly", "monthly", "quarterly", "yearly"],
        "repeat interval",
      ),
      anchorOn = date(b.anchorOn, "first due date"),
      endOn = b.endOn == null ? null : date(b.endOn, "last due date");
    if (endOn && endOn < anchorOn)
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Last due date must be on or after the first due date.",
      );
    const key = submission(b.submissionKey, [
      "create",
      data,
      propertyId,
      unitId,
      cadence,
      anchorOn,
      endOn,
      reviewedTimezone,
    ]);
    return write(r, async (tx, companyId) => {
      const previous = await replay(tx, companyId, r, key);
      if (previous) return previous;
      if (
        !(await tx.property.findFirst({
          where: { id: propertyId, companyId },
          select: { id: true },
        }))
      )
        throw new AccessError(404, "NOT_FOUND", "Property not found.");
      if (
        unitId &&
        !(await tx.unit.findFirst({
          where: { id: unitId, propertyId, companyId, status: "active" },
          select: { id: true },
        }))
      )
        throw new AccessError(
          404,
          "NOT_FOUND",
          "Active unit not found in this property.",
        );
      const { timezone } = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { timezone: true },
      });
      if (timezone !== reviewedTimezone)
        throw new AccessError(
          409,
          "TIMEZONE_CHANGED",
          "Company timezone changed. Close this draft and reload schedules to review the new timezone.",
        );
      const row = await tx.preventivePlan.create({
        data: {
          companyId,
          propertyId,
          unitId,
          ...data,
          cadence,
          anchorOn,
          endOn,
          nextOn: anchorOn,
          timezone,
        },
      });
      return record(tx, companyId, r, key, row.id, "create", {
        ...data,
        propertyId,
        unitId,
        cadence,
        anchorOn: anchorOn.toISOString(),
        endOn: endOn?.toISOString() || null,
        timezone,
      });
    });
  });
  server.get<{ Params: { id: string } }>(`${base}/:id`, auth, (r) => {
    pageNumber(r.query as Record<string, string>, []);
    const id = assignmentId(r.params.id);
    return run(r, async (tx, companyId) => {
      const row = await plan(tx, companyId, id);
      return { ...row, today: companyDay(row.timezone) };
    });
  });
  server.patch<{ Params: { id: string } }>(`${base}/:id`, auth, (r) => {
    const id = assignmentId(r.params.id),
      b = input(r, [
        "title",
        "description",
        "category",
        "priority",
        "status",
        "expectedVersion",
        "submissionKey",
      ]),
      data = {
        ...fields(b),
        status: choice(b.status, ["active", "paused"], "schedule status"),
      },
      expectedVersion = version(b.expectedVersion),
      key = submission(b.submissionKey, ["edit", id, expectedVersion, data]);
    return write(r, async (tx, companyId) => {
      const before = await plan(tx, companyId, id, true),
        previous = await replay(tx, companyId, r, key);
      if (previous) return previous;
      if (before.version !== expectedVersion) throw conflict();
      const changed = Object.entries(data).some(
        ([k, v]) => before[k as keyof typeof before] !== v,
      );
      if (changed) {
        const result = await tx.preventivePlan.updateMany({
          where: { id, companyId, version: expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (!result.count) throw conflict();
      }
      return record(
        tx,
        companyId,
        r,
        key,
        id,
        "edit",
        changed
          ? { before: fields(before), beforeStatus: before.status, after: data }
          : {},
        null,
        changed,
      );
    });
  });
  server.post<{ Params: { id: string } }>(
    `${base}/:id/occurrences`,
    auth,
    (r) => {
      const id = assignmentId(r.params.id),
        b = input(r, [
          "outcome",
          "dueOn",
          "reason",
          "expectedVersion",
          "submissionKey",
        ]),
        outcome = choice(
          b.outcome,
          ["generated", "skipped"],
          "occurrence action",
        ),
        dueOn = date(b.dueOn, "reviewed due date"),
        reason =
          outcome === "skipped"
            ? boundedText(b.reason, 1000, "Skip reason")
            : null,
        expectedVersion = version(b.expectedVersion);
      if (outcome === "generated" && b.reason != null && b.reason !== "")
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "A generated request does not have a skip reason.",
        );
      const key = submission(b.submissionKey, [
        "occurrence",
        id,
        expectedVersion,
        outcome,
        dueOn,
        reason,
      ]);
      return write(r, async (tx, companyId) => {
        const row = await plan(tx, companyId, id, true),
          previous = await replay(tx, companyId, r, key);
        if (previous) return previous;
        if (
          row.version !== expectedVersion ||
          !row.nextOn ||
          +row.nextOn !== +dueOn
        )
          throw conflict();
        if (row.status !== "active")
          throw new AccessError(
            409,
            "PLAN_PAUSED",
            "Resume this schedule before creating or skipping an occurrence.",
          );
        if (
          outcome === "generated" &&
          row.unitId &&
          !(await tx.unit.findFirst({
            where: {
              id: row.unitId,
              propertyId: row.propertyId,
              companyId,
              status: "active",
            },
            select: { id: true },
          }))
        )
          throw new AccessError(
            409,
            "UNIT_ARCHIVED",
            "This unit is archived. Restore it or pause this schedule and create a replacement.",
          );
        const request =
          outcome === "generated"
            ? await tx.maintenanceRequest.create({
                data: {
                  companyId,
                  propertyId: row.propertyId,
                  unitId: row.unitId,
                  requesterId: r.principal!.id,
                  title: row.title,
                  description: row.description,
                  category: row.category,
                  priority: row.priority,
                  targetOn: dueOn,
                },
              })
            : null;
        if (request)
          await audit(tx, r, companyId, request.id, "maintenance.created", {
            source: "management",
            preventivePlanId: id,
            dueOn: dueOn.toISOString().slice(0, 10),
          });
        if (request) await publish(tx, { companyId, actorId: r.principal!.id, kind: "maintenance.created", requestId: request.id, eventKey: request.id });
        const occurrence = await tx.preventiveOccurrence.create({
          data: {
            companyId,
            planId: id,
            dueOn,
            outcome,
            reason,
            requestId: request?.id || null,
          },
        });
        const nextOn = nextOccurrence(
          row.anchorOn,
          dueOn,
          row.cadence,
          row.endOn,
        );
        const updated = await tx.preventivePlan.updateMany({
          where: { id, companyId, version: expectedVersion },
          data: { nextOn, version: { increment: 1 } },
        });
        if (!updated.count) throw conflict();
        return record(
          tx,
          companyId,
          r,
          key,
          id,
          outcome === "generated" ? "generate" : "skip",
          {
            occurrenceId: occurrence.id,
            dueOn: dueOn.toISOString(),
            nextOn: nextOn?.toISOString() || null,
            reason,
          },
          request?.id || null,
        );
      });
    },
  );
  for (const history of [false, true])
    server.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
      `${base}/:id/${history ? "history" : "occurrences"}`,
      auth,
      (r) => {
        const id = assignmentId(r.params.id),
          page = pageNumber(r.query, ["page"]);
        return run(r, async (tx, companyId) => {
          await plan(tx, companyId, id);
          const where = { companyId, planId: id };
          if (history) {
            const filter = { ...where, changed: true };
            return {
              items: await tx.preventiveAction.findMany({
                where: filter,
                select: {
                  id: true,
                  action: true,
                  snapshot: true,
                  requestId: true,
                  createdAt: true,
                  actor: { select: { name: true } },
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                skip: (page - 1) * 25,
                take: 25,
              }),
              total: await tx.preventiveAction.count({ where: filter }),
              page,
              pageSize: 25,
            };
          }
          return {
            items: await tx.preventiveOccurrence.findMany({
              where,
              select: {
                id: true,
                dueOn: true,
                outcome: true,
                reason: true,
                requestId: true,
                request: { select: { status: true, title: true } },
                createdAt: true,
              },
              orderBy: [{ dueOn: "desc" }, { id: "desc" }],
              skip: (page - 1) * 25,
              take: 25,
            }),
            total: await tx.preventiveOccurrence.count({ where }),
            page,
            pageSize: 25,
          };
        });
      },
    );
  server.get<{ Params: { id: string } }>(
    "/api/company/maintenance/:id/preventive",
    auth,
    (r) => {
      pageNumber(r.query as Record<string, string>, []);
      const id = assignmentId(r.params.id);
      return run(r, async (tx, companyId) => {
        if (
          !(await tx.maintenanceRequest.findFirst({
            where: { id, companyId },
            select: { id: true },
          }))
        )
          throw new AccessError(
            404,
            "NOT_FOUND",
            "Maintenance request not found.",
          );
        return tx.preventiveOccurrence.findFirst({
          where: { companyId, requestId: id },
          select: {
            id: true,
            dueOn: true,
            plan: {
              select: { id: true, title: true, timezone: true, status: true },
            },
          },
        });
      });
    },
  );
}
