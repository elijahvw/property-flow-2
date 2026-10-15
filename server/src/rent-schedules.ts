import { randomUUID } from "node:crypto";
import type { FastifyInstance, preValidationHookHandler } from "fastify";
import { Prisma, type PrismaClient, type RentSchedule } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import {
  audit,
  cents,
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
  type AuditRequest,
} from "./operational.js";
import { lockRentLease, allocateRentCredit } from "./rent.js";
import { companyDay } from "./reports.js";
import { installment, isoDay, monthStart, nextMonth } from "./billing-dates.js";
const keys = [
  "firstPeriodOn",
  "lastPeriodOn",
  "firstDueOn",
  "firstAmount",
  "lastAmount",
  "leadDays",
  "expectedVersion",
  "submissionKey",
];
function optionalDate(value: unknown, label: string) {
  return value === null || value === undefined || value === ""
    ? null
    : date(value, label);
}
function parse(body: Record<string, unknown>) {
  const firstPeriodOn = date(body.firstPeriodOn, "first rent month"),
    lastPeriodOn = optionalDate(body.lastPeriodOn, "last rent month");
  if (
    firstPeriodOn.getUTCDate() !== 1 ||
    (lastPeriodOn && lastPeriodOn.getUTCDate() !== 1) ||
    (lastPeriodOn && lastPeriodOn < firstPeriodOn)
  )
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Choose first and last rent months in order.",
    );
  if (
    !Number.isInteger(body.leadDays) ||
    Number(body.leadDays) < 0 ||
    Number(body.leadDays) > 28
  )
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Post rent zero to 28 calendar days before its due date.",
    );
  const amount = (value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    const n = cents(value);
    if (!n)
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Partial-month amounts must be positive.",
      );
    return n;
  };
  return {
    firstPeriodOn,
    lastPeriodOn,
    firstDueOn: optionalDate(body.firstDueOn, "first due date"),
    firstAmountCents: amount(body.firstAmount),
    lastAmountCents: amount(body.lastAmount),
    leadDays: Number(body.leadDays),
    expectedVersion: version(body.expectedVersion),
  };
}
function publicSchedule(row: RentSchedule) {
  const {
    submissionHash: _hash,
    submissionKey: _key,
    createdById: _creator,
    ...rest
  } = row;
  return rest;
}
async function terms(
  tx: Tx,
  companyId: string,
  leaseId: string,
  data: ReturnType<typeof parse>,
) {
  const lease = await lockRentLease(tx, companyId, leaseId);
  if (lease.version !== data.expectedVersion) throw conflict();
  if (lease.status !== "active" || lease.rentCents < 1)
    throw new AccessError(
      409,
      "SCHEDULE_LEASE_INVALID",
      "Activate the lease with a positive monthly rent before enabling recurring billing.",
    );
  const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true },
    }),
    today = companyDay(company.timezone);
  if (isoDay(data.firstPeriodOn) < today.slice(0, 7) + "-01")
    throw new AccessError(
      400,
      "SCHEDULE_BACKFILL_REVIEW",
      "Start with this month or a future month. Post older rent manually after reviewing the ledger.",
    );
  const lastPeriodOn =
    data.lastPeriodOn ?? (lease.endsOn ? monthStart(lease.endsOn) : null);
  if (
    data.firstPeriodOn < monthStart(lease.startsOn) ||
    (lease.endsOn && data.firstPeriodOn > lease.endsOn) ||
    (lastPeriodOn &&
      (lastPeriodOn < data.firstPeriodOn ||
        (lease.endsOn && lastPeriodOn > lease.endsOn)))
  )
    throw new AccessError(
      400,
      "SCHEDULE_TERM_INVALID",
      "Schedule months must overlap the lease term.",
    );
  if (data.lastAmountCents !== null && !lastPeriodOn)
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Choose a last rent month before entering a final partial amount.",
    );
  if (
    lastPeriodOn &&
    +lastPeriodOn === +data.firstPeriodOn &&
    data.firstAmountCents !== null &&
    data.lastAmountCents !== null &&
    data.firstAmountCents !== data.lastAmountCents
  )
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "A one-month schedule must use the same first and final amount.",
    );
  const secondPeriod = nextMonth(data.firstPeriodOn);
  if (data.firstDueOn && (!lastPeriodOn || secondPeriod <= lastPeriodOn)) {
    const secondDue = installment(
      {
        firstPeriodOn: data.firstPeriodOn,
        lastPeriodOn,
        firstDueOn: data.firstDueOn,
        dueDay: lease.rentDueDay,
        leadDays: data.leadDays,
        amountCents: lease.rentCents,
        firstAmountCents: data.firstAmountCents,
        lastAmountCents: data.lastAmountCents,
      },
      secondPeriod,
    ).dueOn;
    if (data.firstDueOn > secondDue)
      throw new AccessError(
        400,
        "SCHEDULE_DATE_ORDER",
        "The first due date must not follow the next installment's due date. Use manual posting for irregular billing dates.",
      );
  }
  return {
    lease,
    today,
    config: {
      firstPeriodOn: data.firstPeriodOn,
      lastPeriodOn,
      firstDueOn: data.firstDueOn,
      firstAmountCents: data.firstAmountCents,
      lastAmountCents: data.lastAmountCents,
      leadDays: data.leadDays,
      amountCents: lease.rentCents,
      dueDay: lease.rentDueDay,
      graceDays: lease.graceDays,
    },
  };
}
async function previews(
  tx: Tx,
  companyId: string,
  leaseId: string,
  schedule: Parameters<typeof installment>[0],
  from: Date,
) {
  const rows = [];
  let period = new Date(from);
  for (
    let i = 0;
    i < 3 && (!schedule.lastPeriodOn || period <= schedule.lastPeriodOn);
    i++, period = nextMonth(period)
  ) {
    const item = installment(schedule, period),
      previous = await tx.rentScheduleOccurrence.findUnique({
        where: {
          companyId_leaseId_periodOn: { companyId, leaseId, periodOn: period },
        },
        select: { outcome: true },
      }),
      charge = await tx.rentCharge.findFirst({
        where: { companyId, leaseId, periodOn: period },
        orderBy: [
          { voidedAt: { sort: "asc", nulls: "first" } },
          { createdAt: "desc" },
        ],
        select: { voidedAt: true },
      });
    rows.push({
      ...item,
      action: previous
        ? "already_processed"
        : charge
          ? charge.voidedAt
            ? "suppressed"
            : "existing"
          : "post",
    });
  }
  return rows;
}
// All writers use the same lease fence. A permanent per-lease/month occurrence
// survives stopping/replacing schedules and voiding charges; jobs never recreate
// an intentionally corrected or voided month.
export async function generateRentOccurrence(
  tx: Tx,
  companyId: string,
  scheduleId: string,
  actor: AuditRequest,
  now = new Date(),
) {
  const initial = await tx.rentSchedule.findFirst({
    where: { id: scheduleId, companyId },
    select: { leaseId: true },
  });
  if (!initial)
    throw new AccessError(404, "NOT_FOUND", "Rent schedule not found.");
  const lease = await lockRentLease(tx, companyId, initial.leaseId),
    schedule = await tx.rentSchedule.findFirstOrThrow({
      where: { id: scheduleId, companyId },
    }),
    company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { status: true, timezone: true },
    });
  if (company.status !== "active" || schedule.status !== "active")
    return { outcome: "inactive" };
  const checked = { lastCheckedAt: now };
  if (lease.status !== "active") {
    await tx.rentSchedule.update({
      where: { id: schedule.id },
      data: { ...checked, lastErrorCode: "LEASE_INACTIVE" },
    });
    return { outcome: "blocked" };
  }
  const period = schedule.nextPeriodOn;
  if (
    (schedule.lastPeriodOn && period > schedule.lastPeriodOn) ||
    (lease.endsOn && period > lease.endsOn)
  ) {
    await tx.rentSchedule.update({
      where: { id: schedule.id },
      data: {
        ...checked,
        status: "completed",
        lastErrorCode: null,
        version: { increment: 1 },
      },
    });
    return { outcome: "completed" };
  }
  if (period < monthStart(lease.startsOn))
    throw new AccessError(
      409,
      "SCHEDULE_TERM_INVALID",
      "Schedule no longer overlaps its lease.",
    );
  const item = installment(schedule, period);
  if (isoDay(item.postOn) > companyDay(company.timezone, now)) {
    await tx.rentSchedule.update({
      where: { id: schedule.id },
      data: { ...checked, lastErrorCode: null },
    });
    const previousInstallment = await tx.rentScheduleOccurrence.findFirst({
      where: { companyId, leaseId: lease.id, periodOn: { lt: period } },
      orderBy: { periodOn: "desc" },
      select: {
        periodOn: true,
        outcome: true,
        charge: { select: { voidedAt: true } },
      },
    });
    const previousActiveCharge = previousInstallment
      ? await tx.rentCharge.findFirst({
          where: {
            companyId,
            leaseId: lease.id,
            periodOn: previousInstallment.periodOn,
            voidedAt: null,
          },
          select: { id: true },
        })
      : null;
    return {
      outcome: "not_due",
      periodOn: period,
      postOn: item.postOn,
      dueOn: item.dueOn,
      businessDate: companyDay(company.timezone, now),
      previousInstallment: previousInstallment
        ? {
            periodOn: previousInstallment.periodOn,
            outcome: previousInstallment.outcome,
            voided:
              !previousActiveCharge &&
              (previousInstallment.outcome === "suppressed" ||
                !!previousInstallment.charge?.voidedAt),
          }
        : null,
    };
  }
  let occurrence = await tx.rentScheduleOccurrence.findUnique({
    where: {
      companyId_leaseId_periodOn: {
        companyId,
        leaseId: lease.id,
        periodOn: period,
      },
    },
  });
  if (!occurrence) {
    // Any prior charge, even a voided one, reserves this month for manual review.
    const charges = await tx.rentCharge.findMany({
        where: { companyId, leaseId: lease.id, periodOn: period },
        orderBy: [
          { voidedAt: { sort: "asc", nulls: "first" } },
          { createdAt: "desc" },
        ],
        select: { id: true, voidedAt: true },
        take: 1,
      }),
      active = charges.find((c) => !c.voidedAt);
    let chargeId = active?.id ?? null,
      outcome = active ? "existing" : charges.length ? "suppressed" : "posted";
    if (outcome === "posted") {
      const key = submission(randomUUID(), [schedule.id, isoDay(period)]);
      const charge = await tx.rentCharge.create({
        data: {
          companyId,
          propertyId: lease.propertyId,
          leaseId: lease.id,
          scheduleId: schedule.id,
          createdById: schedule.createdById,
          ...key,
          periodOn: period,
          dueOn: item.dueOn,
          amountCents: item.amountCents,
          graceDays: schedule.graceDays,
          memo: null,
        },
        select: { id: true },
      });
      chargeId = charge.id;
      await audit(tx, actor, companyId, charge.id, "rent.charge.scheduled", {
        scheduleId: schedule.id,
        leaseId: lease.id,
        periodOn: isoDay(period),
        amountCents: item.amountCents,
      });
      await allocateRentCredit(tx, actor, companyId, lease.id);
    }
    occurrence = await tx.rentScheduleOccurrence.create({
      data: {
        companyId,
        propertyId: lease.propertyId,
        leaseId: lease.id,
        scheduleId: schedule.id,
        periodOn: period,
        chargeId,
        outcome,
      },
    });
    await audit(tx, actor, companyId, schedule.id, "rent.schedule.processed", {
      periodOn: isoDay(period),
      outcome,
      chargeId,
    });
  }
  const nextPeriodOn = nextMonth(period),
    complete = !!(
      (schedule.lastPeriodOn && nextPeriodOn > schedule.lastPeriodOn) ||
      (lease.endsOn && nextPeriodOn > lease.endsOn)
    );
  await tx.rentSchedule.update({
    where: { id: schedule.id },
    data: {
      ...checked,
      nextPeriodOn,
      lastErrorCode: null,
      ...(complete ? { status: "completed" } : {}),
      version: { increment: 1 },
    },
  });
  return { outcome: occurrence.outcome, occurrence };
}
export function registerRentSchedules(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate };
  server.get<{ Params: { leaseId: string }; Querystring: { cursor?: string } }>(
    "/api/company/rent/:leaseId/schedule",
    auth,
    (request) => {
      const leaseId = assignmentId(request.params.leaseId),
        q = request.query;
      if (Object.keys(q).some((k) => k !== "cursor"))
        throw new AccessError(400, "INVALID_INPUT", "Unknown schedule filter.");
      const cursor =
        q.cursor === undefined ? undefined : assignmentId(q.cursor);
      return scoped(db, request, "finance.manage", async (tx, companyId) => {
        await lockRentLease(tx, companyId, leaseId);
        const schedule = await tx.rentSchedule.findFirst({
            where: { companyId, leaseId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          }),
          rows = await tx.rentScheduleOccurrence.findMany({
            where: {
              companyId,
              leaseId,
              ...(cursor ? { id: { lt: cursor } } : {}),
            },
            take: 26,
            orderBy: { id: "desc" },
            include: {
              charge: {
                select: {
                  id: true,
                  amountCents: true,
                  dueOn: true,
                  graceDays: true,
                  voidedAt: true,
                },
              },
            },
          });
        const currentCharges = await tx.rentCharge.findMany({
          where: {
            companyId,
            leaseId,
            voidedAt: null,
            periodOn: { in: rows.slice(0, 25).map((row) => row.periodOn) },
          },
          select: {
            id: true,
            reference: true,
            periodOn: true,
            amountCents: true,
            dueOn: true,
          },
        });
        return {
          schedule: schedule ? publicSchedule(schedule) : null,
          preview:
            schedule && ["active", "paused"].includes(schedule.status)
              ? await previews(
                  tx,
                  companyId,
                  leaseId,
                  schedule,
                  schedule.nextPeriodOn,
                )
              : [],
          history: rows.slice(0, 25).map((row) => ({
            ...row,
            currentCharge:
              currentCharges.find((c) => +c.periodOn === +row.periodOn) ?? null,
          })),
          nextCursor: rows.length > 25 ? rows[24].id : null,
        };
      });
    },
  );
  for (const preview of [false, true])
    server.post<{ Params: { leaseId: string } }>(
      `/api/company/rent/:leaseId/${preview ? "schedule-preview" : "schedules"}`,
      auth,
      (request) => {
        mutation(request, origin);
        const leaseId = assignmentId(request.params.leaseId),
          b = input(request, keys),
          data = parse(b),
          key = submission(b.submissionKey, [leaseId, data]);
        return scoped(db, request, "finance.manage", async (tx, companyId) => {
          // Replays remain valid after a month boundary, term edits or schedule stop.
          const existing = await tx.rentSchedule.findFirst({
            where: {
              companyId,
              createdById: request.principal!.id,
              submissionKey: key.submissionKey,
            },
          });
          if (!preview && existing) {
            sameSubmission(existing.submissionHash, key.submissionHash);
            return publicSchedule(existing);
          }
          const result = await terms(tx, companyId, leaseId, data);
          if (
            await tx.rentSchedule.findFirst({
              where: {
                companyId,
                leaseId,
                status: { in: ["active", "paused"] },
              },
              select: { id: true },
            })
          )
            throw new AccessError(
              409,
              "SCHEDULE_EXISTS",
              "Pause or stop the existing schedule. Stop it before replacing its terms.",
            );
          if (preview)
            return {
              config: result.config,
              preview: await previews(
                tx,
                companyId,
                leaseId,
                result.config,
                data.firstPeriodOn,
              ),
              businessDate: result.today,
            };
          const row = await tx.rentSchedule.create({
            data: {
              companyId,
              propertyId: result.lease.propertyId,
              leaseId,
              createdById: request.principal!.id,
              ...key,
              ...result.config,
              nextPeriodOn: data.firstPeriodOn,
            },
          });
          await audit(tx, request, companyId, row.id, "rent.schedule.enabled", {
            leaseId,
            firstPeriodOn: isoDay(row.firstPeriodOn),
            amountCents: row.amountCents,
            dueDay: row.dueDay,
            graceDays: row.graceDays,
            leadDays: row.leadDays,
          });
          return publicSchedule(row);
        });
      },
    );
  server.patch<{ Params: { scheduleId: string } }>(
    "/api/company/rent-schedules/:scheduleId",
    auth,
    (request) => {
      mutation(request, origin);
      const id = assignmentId(request.params.scheduleId),
        b = input(request, ["status", "expectedVersion"]),
        status = choice(
          b.status,
          ["active", "paused", "stopped"],
          "schedule status",
        ),
        expectedVersion = version(b.expectedVersion);
      return scoped(db, request, "finance.manage", async (tx, companyId) => {
        const previous = await tx.rentSchedule.findFirst({
          where: { id, companyId },
          select: { leaseId: true },
        });
        if (!previous)
          throw new AccessError(404, "NOT_FOUND", "Rent schedule not found.");
        const lease = await lockRentLease(tx, companyId, previous.leaseId),
          row = await tx.rentSchedule.findFirstOrThrow({
            where: { id, companyId },
          });
        if (row.status === status) return publicSchedule(row);
        if (row.version !== expectedVersion) throw conflict();
        if (!["active", "paused"].includes(row.status))
          throw new AccessError(
            409,
            "SCHEDULE_CLOSED",
            "A stopped or completed schedule cannot be reopened. Review a new schedule instead.",
          );
        if (status === "active" && lease.status !== "active")
          throw new AccessError(
            409,
            "SCHEDULE_LEASE_INVALID",
            "The lease must be active to resume billing.",
          );
        const updated = await tx.rentSchedule.update({
          where: { id },
          data: { status, version: { increment: 1 }, lastErrorCode: null },
        });
        await audit(tx, request, companyId, id, "rent.schedule.status", {
          from: row.status,
          to: status,
        });
        return publicSchedule(updated);
      });
    },
  );
  server.post<{ Params: { scheduleId: string } }>(
    "/api/company/rent-schedules/:scheduleId/run",
    auth,
    (request) => {
      mutation(request, origin);
      input(request, []);
      const id = assignmentId(request.params.scheduleId);
      return scoped(db, request, "finance.manage", (tx, companyId) =>
        generateRentOccurrence(tx, companyId, id, request),
      );
    },
  );
}
