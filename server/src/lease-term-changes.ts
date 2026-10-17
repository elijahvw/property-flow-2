import { createHash } from "node:crypto";
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
import { lockRentLease } from "./rent.js";
import { sharedLeaseAccess } from "./lease-participants.js";
import { companyDay } from "./reports.js";
import { paymentPolicyPatch, paymentPolicyKeys } from "./payment-policy.js";
import { isoDay, nextMonth, monthStart } from "./billing-dates.js";
import {
  readTermChanges,
  termSelect,
  termsAt,
  termInstallment,
  type PaymentTerms,
  type TermChange,
} from "./lease-term-policy.js";
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");

function parse(b: Record<string, unknown>) {
  const effectiveOn = date(b.effectiveOn, "effective date"),
    rentCents = cents(b.monthlyRent),
    policy = paymentPolicyPatch(b);
  if (
    effectiveOn.getUTCDate() !== 1 ||
    !rentCents ||
    policy.rentDueDay === undefined ||
    policy.graceDays === undefined ||
    policy.paymentInstructions === undefined
  )
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Choose a first-of-month effective date, positive monthly rent and complete payment terms.",
    );
  return {
    effectiveOn,
    rentCents,
    rentDueDay: policy.rentDueDay,
    graceDays: policy.graceDays,
    paymentInstructions: policy.paymentInstructions,
    reason: boundedText(b.reason, 500, "Reason shown to the tenant"),
    expectedLeaseVersion: version(b.expectedLeaseVersion),
  };
}
async function context(
  tx: Tx,
  companyId: string,
  leaseId: string,
  residentId?: string,
) {
  const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true },
    }),
    today = companyDay(company.timezone),
    on = new Date(today + "T00:00:00Z");
  const lease = await tx.lease.findFirst({
    where: {
      id: leaseId,
      companyId,
      ...(residentId
        ? {
            ...sharedLeaseAccess(companyId, residentId, on),
            status: { not: "draft" },
          }
        : {}),
    },
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
  if (!lease)
    throw new AccessError(
      404,
      "NOT_FOUND",
      "Lease terms are unavailable in your current workspace.",
    );
  const changes = await readTermChanges(tx, companyId, [leaseId]);
  const schedules = await tx.rentSchedule.findMany({
    where: { companyId, leaseId, status: { in: ["active", "paused"] } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      version: true,
      status: true,
      nextPeriodOn: true,
      firstPeriodOn: true,
      lastPeriodOn: true,
      amountCents: true,
      dueDay: true,
      graceDays: true,
      leadDays: true,
      firstAmountCents: true,
      lastAmountCents: true,
      firstDueOn: true,
    },
    take: 3,
  });
  if (schedules.length > 1)
    throw new AccessError(
      422,
      "TERM_SCHEDULE_SCOPE",
      "More than one open billing schedule requires review before changing terms.",
    );
  const charges = await tx.rentCharge.findMany({
    where: { companyId, leaseId, kind: "rent" },
    select: {
      id: true,
      reference: true,
      periodOn: true,
      amountCents: true,
      dueOn: true,
      graceDays: true,
      voidedAt: true,
      version: true,
      termChangeId: true,
    },
    orderBy: [{ periodOn: "asc" }, { id: "asc" }],
    take: 10001,
  });
  if (charges.length > 10000)
    throw new AccessError(
      422,
      "TERM_SCOPE_TOO_LARGE",
      "Too many recorded rent months for a complete review.",
    );
  const current = termsAt(lease, changes, on),
    pending =
      changes.find((t) => !t.cancellation && t.effectiveOn > on) ?? null;
  const last = charges.at(-1);
  let earliest =
    last && last.periodOn >= nextMonth(on)
      ? nextMonth(last.periodOn)
      : nextMonth(on);
  const firstFullMonth =
    lease.startsOn.getUTCDate() === 1
      ? monthStart(lease.startsOn)
      : nextMonth(lease.startsOn);
  if (earliest < firstFullMonth) earliest = firstFullMonth;
  return {
    lease,
    changes,
    schedules,
    charges,
    current,
    pending,
    businessDate: today,
    earliestEffectiveOn: earliest,
    sourceHash: digest({ today, lease, changes, schedules, charges }),
  };
}
function installments(
  c: Awaited<ReturnType<typeof context>>,
  effective: Date,
  afterChanges: TermChange[],
) {
  const s = c.schedules[0],
    base = s
      ? { ...s, paymentInstructions: c.lease.paymentInstructions }
      : {
          firstPeriodOn: monthStart(c.lease.startsOn),
          lastPeriodOn: c.lease.endsOn ? monthStart(c.lease.endsOn) : null,
          firstDueOn: null,
          firstAmountCents: null,
          lastAmountCents: null,
          amountCents: c.lease.rentCents,
          dueDay: c.lease.rentDueDay,
          graceDays: c.lease.graceDays,
          leadDays: 0,
          paymentInstructions: c.lease.paymentInstructions,
        };
  let period = new Date(effective);
  if (s && period < s.firstPeriodOn) period = new Date(s.firstPeriodOn);
  if (s && period < s.nextPeriodOn) period = new Date(s.nextPeriodOn);
  if (base.firstDueOn) {
    const second = termInstallment(
      base,
      afterChanges,
      nextMonth(base.firstPeriodOn),
    );
    if (base.firstDueOn > second.dueOn)
      throw new AccessError(
        409,
        "TERM_DUE_ORDER",
        "The retained first due date would follow the next installment. Review the billing schedule before changing the due day.",
      );
  }
  const end =
    [base.lastPeriodOn, c.lease.endsOn ? monthStart(c.lease.endsOn) : null]
      .filter((v): v is Date => !!v)
      .sort((a, b) => +a - +b)[0] ?? null;
  const rows = [];
  for (let i = 0; !end || period <= end; i++, period = nextMonth(period)) {
    if (!end && i >= 12) break;
    if (i >= 1200)
      throw new AccessError(
        422,
        "TERM_PREVIEW_TOO_LARGE",
        "Review a billing horizon of no more than 100 years.",
      );
    const before = termInstallment(base, c.changes, period),
      after = termInstallment(base, afterChanges, period);
    rows.push({
      periodOn: period,
      before,
      after,
      action: s ? (s.status === "active" ? "automatic" : "paused") : "manual",
      amountOverride:
        (+period === +base.firstPeriodOn && base.firstAmountCents !== null) ||
        (base.lastPeriodOn !== null &&
          +period === +base.lastPeriodOn &&
          base.lastAmountCents !== null),
      dueOverride: +period === +base.firstPeriodOn && base.firstDueOn !== null,
    });
  }
  return {
    installments: rows,
    continues: !end,
    horizonDescription: end
      ? "Every remaining installment in the recorded lease/schedule horizon."
      : "Next 12 installments. The same rule continues monthly until another reviewed change or the lease/schedule ends.",
    schedule: s ? { id: s.id, status: s.status } : null,
  };
}
async function checkDate(
  c: Awaited<ReturnType<typeof context>>,
  effective: Date,
) {
  if (
    isoDay(effective) <= c.businessDate ||
    effective < c.lease.startsOn ||
    (c.lease.endsOn && effective > c.lease.endsOn)
  )
    throw new AccessError(
      400,
      "TERM_DATE_INVALID",
      "Choose a full future rent month inside the lease term. Review already-posted differences as a separate charge or credit.",
    );
  if (c.charges.some((charge) => charge.periodOn >= effective))
    throw new AccessError(
      409,
      "TERM_ALREADY_POSTED",
      "Rent has already been recorded for an affected month, including correction history. Choose a date after the latest recorded rent month; handle any agreed difference with a separate charge or credit.",
    );
}
export function registerLeaseTermChanges(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const fields = [
    "effectiveOn",
    "monthlyRent",
    ...paymentPolicyKeys,
    "reason",
    "expectedLeaseVersion",
  ];
  const auth = { preValidation: authenticate },
    root = "/api/company/leases/:leaseId/terms";
  for (const resident of [false, true])
    server.get<{ Params: { leaseId: string } }>(
      resident ? "/api/resident/leases/:leaseId/terms" : root,
      auth,
      (request) => {
        if (Object.keys(request.query as object).length)
          throw new AccessError(400, "INVALID_INPUT", "Unknown terms filter.");
        const id = assignmentId(request.params.leaseId);
        return scoped(
          db,
          request,
          resident ? "resident.self" : "lease.manage",
          async (tx, companyId) => {
            const c = await context(
              tx,
              companyId,
              id,
              resident ? request.principal!.id : undefined,
            );
            return {
              lease: { ...c.lease, ...c.current },
              businessDate: c.businessDate,
              current: c.current,
              baseline: {
                rentCents: c.lease.rentCents,
                rentDueDay: c.lease.rentDueDay,
                graceDays: c.lease.graceDays,
                paymentInstructions: c.lease.paymentInstructions,
              },
              changes: c.changes.map((t, index) => ({
                ...t,
                status: t.cancellation
                  ? "cancelled"
                  : isoDay(t.effectiveOn) > c.businessDate
                    ? "scheduled"
                    : c.changes
                          .slice(index + 1)
                          .some(
                            (n) =>
                              !n.cancellation &&
                              isoDay(n.effectiveOn) <= c.businessDate,
                          )
                      ? "superseded"
                      : "in_effect",
              })),
              pending: c.pending,
              earliestEffectiveOn: c.earliestEffectiveOn,
              ...(resident
                ? {}
                : {
                    sourceHash: c.sourceHash,
                    schedule: c.schedules[0] ?? null,
                  }),
            };
          },
        );
      },
    );
  for (const preview of [true, false])
    server.post<{ Params: { leaseId: string } }>(
      root + (preview ? "/preview" : ""),
      auth,
      (request) => {
        mutation(request, origin);
        const id = assignmentId(request.params.leaseId),
          b = input(
            request,
            preview
              ? fields
              : [...fields, "sourceHash", "submissionKey", "confirmed"],
          ),
          data = parse(b);
        if (
          !preview &&
          (b.confirmed !== true ||
            typeof b.sourceHash !== "string" ||
            !/^[0-9a-f]{64}$/.test(b.sourceHash))
        )
          throw new AccessError(
            400,
            "REVIEW_REQUIRED",
            "Confirm the reviewed future terms and installment effects.",
          );
        const key = preview
          ? null
          : submission(b.submissionKey, [id, data, b.sourceHash, true]);
        return scoped(db, request, "lease.manage", async (tx, companyId) => {
          if (key) {
            const old = await tx.leaseTermChange.findFirst({
              where: {
                companyId,
                createdById: request.principal!.id,
                submissionKey: key.submissionKey,
              },
              select: { ...termSelect, submissionHash: true },
            });
            if (old) {
              sameSubmission(old.submissionHash, key.submissionHash);
              const { submissionHash: _hash, ...row } = old;
              return row;
            }
          }
          await lockRentLease(tx, companyId, id);
          const c = await context(tx, companyId, id);
          if (c.lease.version !== data.expectedLeaseVersion) throw conflict();
          if (c.lease.status !== "active")
            throw new AccessError(
              409,
              "TERM_LEASE_INACTIVE",
              "Activate the lease record before scheduling future payment terms.",
            );
          if (c.pending)
            throw new AccessError(
              409,
              "TERM_PENDING",
              "Review or cancel the existing future change before scheduling another.",
            );
          await checkDate(c, data.effectiveOn);
          const after: PaymentTerms = {
              rentCents: data.rentCents,
              rentDueDay: data.rentDueDay,
              graceDays: data.graceDays,
              paymentInstructions: data.paymentInstructions,
            },
            before: PaymentTerms = {
              rentCents: c.current.rentCents,
              rentDueDay: c.current.rentDueDay,
              graceDays: c.current.graceDays,
              paymentInstructions: c.current.paymentInstructions,
            };
          if (JSON.stringify(before) === JSON.stringify(after))
            throw new AccessError(
              400,
              "TERM_UNCHANGED",
              "Change at least one payment term before reviewing.",
            );
          const proposed: TermChange = {
            id: "preview",
            reference: "",
            leaseId: id,
            effectiveOn: data.effectiveOn,
            ...after,
            before,
            reason: data.reason,
            createdAt: new Date(),
            cancellation: null,
          };
          const impact = installments(c, data.effectiveOn, [
            ...c.changes,
            proposed,
          ]);
          if (preview)
            return {
              kind: "change",
              effectiveOn: data.effectiveOn,
              reason: data.reason,
              before,
              after,
              ...impact,
              sourceHash: c.sourceHash,
              expectedLeaseVersion: c.lease.version,
            };
          if (b.sourceHash !== c.sourceHash)
            throw new AccessError(
              409,
              "TERM_SOURCES_CHANGED",
              "Lease, billing or recorded rent changed. Refresh and review the installment effects again.",
            );
          const row = await tx.leaseTermChange.create({
            data: {
              companyId,
              propertyId: c.lease.propertyId,
              leaseId: id,
              effectiveOn: data.effectiveOn,
              ...after,
              before: before as unknown as Prisma.InputJsonObject,
              reason: data.reason,
              createdById: request.principal!.id,
              ...key!,
            },
            select: termSelect,
          });
          await audit(tx, request, companyId, row.id, "lease.terms.scheduled", {
            leaseId: id,
            effectiveOn: isoDay(data.effectiveOn),
            before: before as unknown as Prisma.InputJsonObject,
            after: after as unknown as Prisma.InputJsonObject,
            reason: data.reason,
          });
          return row;
        });
      },
    );
  for (const preview of [true, false])
    server.post<{ Params: { leaseId: string; changeId: string } }>(
      root + `/:changeId/${preview ? "cancel-preview" : "cancel"}`,
      auth,
      (request) => {
        mutation(request, origin);
        const id = assignmentId(request.params.leaseId),
          changeId = assignmentId(request.params.changeId),
          b = input(
            request,
            preview
              ? ["reason", "expectedLeaseVersion"]
              : [
                  "reason",
                  "expectedLeaseVersion",
                  "sourceHash",
                  "confirmed",
                  "submissionKey",
                ],
          ),
          reason = boundedText(
            b.reason,
            500,
            "Cancellation reason shown to the tenant",
          ),
          expected = version(b.expectedLeaseVersion);
        if (
          !preview &&
          (b.confirmed !== true ||
            typeof b.sourceHash !== "string" ||
            !/^[0-9a-f]{64}$/.test(b.sourceHash))
        )
          throw new AccessError(
            400,
            "REVIEW_REQUIRED",
            "Confirm the reviewed cancellation and installment effects.",
          );
        const key = preview
          ? null
          : submission(b.submissionKey, [
              id,
              changeId,
              reason,
              expected,
              b.sourceHash,
              true,
            ]);
        return scoped(db, request, "lease.manage", async (tx, companyId) => {
          if (key) {
            const old = await tx.leaseTermCancellation.findFirst({
              where: {
                companyId,
                createdById: request.principal!.id,
                submissionKey: key.submissionKey,
              },
            });
            if (old) {
              sameSubmission(old.submissionHash, key.submissionHash);
              return { id: old.id, changeId: old.changeId };
            }
          }
          await lockRentLease(tx, companyId, id);
          const c = await context(tx, companyId, id),
            target = c.changes.find((t) => t.id === changeId);
          if (!target)
            throw new AccessError(404, "NOT_FOUND", "Term change not found.");
          if (c.lease.version !== expected) throw conflict();
          if (target.cancellation)
            throw new AccessError(
              409,
              "TERM_CANCELLED",
              "This term change is already cancelled. Its history is retained.",
            );
          await checkDate(c, target.effectiveOn);
          const next = c.changes.map((t) =>
              t.id === changeId
                ? {
                    ...t,
                    cancellation: {
                      id: "preview",
                      reason,
                      createdAt: new Date(),
                    },
                  }
                : t,
            ),
            after = termsAt(c.lease, next, target.effectiveOn),
            before = termsAt(c.lease, c.changes, target.effectiveOn),
            impact = installments(c, target.effectiveOn, next);
          if (preview)
            return {
              kind: "cancel",
              effectiveOn: target.effectiveOn,
              reason,
              before,
              after,
              ...impact,
              sourceHash: c.sourceHash,
              expectedLeaseVersion: c.lease.version,
            };
          if (b.sourceHash !== c.sourceHash)
            throw new AccessError(
              409,
              "TERM_SOURCES_CHANGED",
              "Lease, billing or recorded rent changed. Refresh and review the cancellation again.",
            );
          const row = await tx.leaseTermCancellation.create({
            data: {
              companyId,
              propertyId: c.lease.propertyId,
              leaseId: id,
              changeId,
              reason,
              createdById: request.principal!.id,
              ...key!,
            },
          });
          await audit(tx, request, companyId, row.id, "lease.terms.cancelled", {
            leaseId: id,
            changeId,
            effectiveOn: isoDay(target.effectiveOn),
            reason,
          });
          return { id: row.id, changeId };
        });
      },
    );
}
