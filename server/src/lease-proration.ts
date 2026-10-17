import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient, Prisma } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import {
  audit,
  boundedText,
  cents,
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
import { allocateRentCredit, chargeSelect, lockRentLease } from "./rent.js";
import { readTermChanges, termsAt } from "./lease-term-policy.js";
import { calendarProration, rentMonthDue } from "./proration-policy.js";
import { companyDay } from "./reports.js";
import { sharedLeaseAccess } from "./lease-participants.js";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const prorationSelect = {
  id: true,
  reference: true,
  leaseId: true,
  chargeId: true,
  snapshot: true,
  createdAt: true,
  charge: { select: { reference: true, voidedAt: true } },
} as const;
async function context(tx: Tx, companyId: string, id: string, period: Date) {
  const lease = await tx.lease.findFirst({
    where: { id, companyId },
    select: {
      id: true,
      propertyId: true,
      version: true,
      status: true,
      startsOn: true,
      endsOn: true,
      rentCents: true,
      rentDueDay: true,
      graceDays: true,
      paymentInstructions: true,
      property: { select: { name: true } },
      unit: { select: { label: true } },
    },
  });
  if (!lease) throw new AccessError(404, "NOT_FOUND", "Lease not found.");
  const changes = await readTermChanges(tx, companyId, [id]),
    terms = termsAt(lease, changes, period),
    calculation = calendarProration(
      lease.startsOn,
      lease.endsOn,
      period,
      terms.rentCents,
    ),
    charges = await tx.rentCharge.findMany({
      where: { companyId, leaseId: id, kind: "rent", periodOn: period },
      select: chargeSelect,
      orderBy: { id: "asc" },
      take: 1001,
    }),
    schedules = await tx.rentSchedule.findMany({
      where: { companyId, leaseId: id, status: { in: ["active", "paused"] } },
      orderBy: { id: "asc" },
      take: 3,
    });
  if (charges.length > 1000 || schedules.length > 1)
    throw new AccessError(
      422,
      "PRORATION_SCOPE",
      "Review the billing history before calculating this month.",
    );
  const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true },
    }),
    businessDate = companyDay(company.timezone);
  return {
    lease,
    terms,
    calculation,
    dueOn: rentMonthDue(terms, period),
    existing: charges.find((c) => !c.voidedAt) ?? null,
    businessDate,
    timezone: company.timezone,
    sourceHash: hash({
      businessDate,
      timezone: company.timezone,
      lease,
      changes,
      charges,
      schedules,
    }),
  };
}
export function registerLeaseProration(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate },
    root = "/api/company/leases/:leaseId/proration";
  server.get<{
    Params: { leaseId: string };
    Querystring: { periodOn?: string };
  }>(root, auth, (request) => {
    if (Object.keys(request.query).some((k) => k !== "periodOn"))
      throw new AccessError(400, "INVALID_INPUT", "Unknown proration filter.");
    const id = assignmentId(request.params.leaseId),
      period = date(request.query.periodOn, "rent month");
    return scoped(db, request, "finance.manage", async (tx, cid) => ({
      ...(await context(tx, cid, id, period)),
      history: await tx.leaseProration
        .findMany({
          where: { companyId: cid, leaseId: id },
          select: prorationSelect,
          orderBy: { id: "desc" },
          take: 101,
        })
        .then((rows) => {
          if (rows.length > 100)
            throw new AccessError(
              422,
              "PRORATION_SCOPE",
              "Too many proration records for a complete history.",
            );
          return rows;
        }),
    }));
  });
  server.get<{ Params: { leaseId: string } }>(
    "/api/resident/leases/:leaseId/proration",
    auth,
    (request) => {
      const id = assignmentId(request.params.leaseId);
      if (Object.keys(request.query as object).length)
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Unknown proration filter.",
        );
      return scoped(db, request, "resident.self", async (tx, cid) => {
        const company = await tx.company.findUniqueOrThrow({
            where: { id: cid },
            select: { timezone: true },
          }),
          on = new Date(companyDay(company.timezone) + "T00:00:00Z");
        if (
          !(await tx.lease.findFirst({
            where: {
              id,
              companyId: cid,
              status: { not: "draft" },
              ...sharedLeaseAccess(cid, request.principal!.id, on),
            },
          }))
        )
          throw new AccessError(404, "NOT_FOUND", "Lease not found.");
        const rows = await tx.leaseProration.findMany({
          where: { companyId: cid, leaseId: id },
          select: prorationSelect,
          orderBy: { id: "desc" },
          take: 101,
        });
        if (rows.length > 100)
          throw new AccessError(
            422,
            "PRORATION_SCOPE",
            "Too many proration records for a complete history.",
          );
        return rows;
      });
    },
  );
  for (const preview of [true, false])
    server.post<{ Params: { leaseId: string } }>(
      root + (preview ? "/preview" : ""),
      auth,
      (request) => {
        mutation(request, origin);
        const id = assignmentId(request.params.leaseId),
          fields = [
            "periodOn",
            "fromOn",
            "throughOn",
            "policy",
            "dueOn",
            "overrideAmount",
            "overrideReason",
            "reason",
            "expectedLeaseVersion",
          ],
          b = input(
            request,
            preview
              ? fields
              : [...fields, "sourceHash", "submissionKey", "confirmed"],
          ),
          period = date(b.periodOn, "rent month"),
          from = date(b.fromOn, "included start date"),
          through = date(b.throughOn, "included end date"),
          due = date(b.dueOn, "rent due date"),
          expected = version(b.expectedLeaseVersion),
          reason = boundedText(b.reason, 500, "Shared proration reason"),
          override =
            b.overrideAmount == null || b.overrideAmount === ""
              ? null
              : cents(b.overrideAmount),
          overrideReason =
            override === null
              ? null
              : boundedText(
                  b.overrideReason,
                  500,
                  "Reason for agreed amount override",
                );
        if (b.policy !== "actual_calendar_month")
          throw new AccessError(
            400,
            "PRORATION_POLICY",
            "Review the actual calendar-month policy explicitly.",
          );
        if (override === 0)
          throw new AccessError(
            400,
            "INVALID_INPUT",
            "The agreed charge must be greater than zero.",
          );
        if (
          !preview &&
          (b.confirmed !== true ||
            typeof b.sourceHash !== "string" ||
            !/^[a-f0-9]{64}$/.test(b.sourceHash))
        )
          throw new AccessError(
            400,
            "REVIEW_REQUIRED",
            "Confirm the reviewed partial rent charge.",
          );
        const key = preview
          ? null
          : submission(b.submissionKey, [
              id,
              period,
              from,
              through,
              due,
              expected,
              reason,
              override,
              overrideReason,
              b.sourceHash,
            ]);
        return scoped(db, request, "finance.manage", async (tx, cid) => {
          if (key) {
            const old = await tx.leaseProration.findFirst({
              where: {
                companyId: cid,
                createdById: request.principal!.id,
                submissionKey: key.submissionKey,
              },
              select: { ...prorationSelect, submissionHash: true },
            });
            if (old) {
              sameSubmission(old.submissionHash, key.submissionHash);
              const { submissionHash: _hash, ...row } = old;
              return row;
            }
          }
          await lockRentLease(tx, cid, id);
          const c = await context(tx, cid, id, period);
          if (c.lease.version !== expected) throw conflict();
          if (c.lease.status === "draft")
            throw new AccessError(
              409,
              "LEASE_DRAFT",
              "Activate the lease before posting partial rent.",
            );
          if (c.existing)
            throw new AccessError(
              409,
              "RENT_ALREADY_POSTED",
              "This month already has posted rent. Review it in the ledger; use an agreed charge or credit difference instead of recalculating it.",
            );
          if (
            !c.calculation.partial ||
            c.calculation.fromOn !== from.toISOString().slice(0, 10) ||
            c.calculation.throughOn !== through.toISOString().slice(0, 10)
          )
            throw new AccessError(
              400,
              "PRORATION_DATES",
              "Use the exact included first/last month dates from the current lease.",
            );
          const amountCents = override ?? c.calculation.calculatedCents;
          if (!amountCents)
            throw new AccessError(
              400,
              "PRORATION_ZERO",
              "The calculation rounds to zero cents. Review an agreed positive manual amount or keep this month uncharged.",
            );
          const snapshot = {
            ...c.calculation,
            businessDate: c.businessDate,
            timezone: c.timezone,
            amountCents,
            dueOn: due.toISOString().slice(0, 10),
            graceDays: c.terms.graceDays,
            termChangeId: c.terms.termChangeId,
            reason,
            overrideReason,
          };
          if (preview)
            return {
              snapshot,
              sourceHash: c.sourceHash,
              expectedLeaseVersion: expected,
              lease: c.lease,
            };
          if (b.sourceHash !== c.sourceHash)
            throw new AccessError(
              409,
              "PRORATION_CHANGED",
              "Lease, terms or billing changed. Refresh and review this month again.",
            );
          const charge = await tx.rentCharge.create({
            data: {
              companyId: cid,
              propertyId: c.lease.propertyId,
              leaseId: id,
              createdById: request.principal!.id,
              ...submission(randomUUID(), ["proration", key!.submissionKey]),
              periodOn: period,
              dueOn: due,
              amountCents,
              graceDays: c.terms.graceDays,
              memo: `Prorated rent · ${c.calculation.fromOn} through ${c.calculation.throughOn} · ${reason}`.slice(
                0,
                500,
              ),
            },
            select: { id: true },
          });
          const row = await tx.leaseProration.create({
            data: {
              companyId: cid,
              propertyId: c.lease.propertyId,
              leaseId: id,
              chargeId: charge.id,
              snapshot: snapshot as Prisma.InputJsonObject,
              createdById: request.principal!.id,
              ...key!,
            },
            select: prorationSelect,
          });
          await audit(tx, request, cid, row.id, "lease.proration.posted", {
            leaseId: id,
            chargeId: charge.id,
            snapshot: snapshot as Prisma.InputJsonObject,
          });
          await allocateRentCredit(tx, request, cid, id);
          return row;
        });
      },
    );
}
