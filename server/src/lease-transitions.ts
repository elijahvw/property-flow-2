import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient, Prisma } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import {
  audit,
  boundedText,
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
} from "./operational.js";
import {
  allocateRentCredit,
  lockRentLease,
  readRentSources,
  rentBalances,
} from "./rent.js";
import { readDepositDetail } from "./deposits.js";
import {
  readTermChanges,
  termsAt,
  termInstallment,
} from "./lease-term-policy.js";
import { calendarProration, rentMonthDue } from "./proration-policy.js";
import { companyDay } from "./reports.js";
import { isoDay, monthStart, nextMonth } from "./billing-dates.js";
import { activeSlot, contactEligible, eligible, lockUnit } from "./leasing.js";
import { sharedLeaseAccess } from "./lease-participants.js";
const hash = (v: unknown) =>
    createHash("sha256").update(JSON.stringify(v)).digest("hex"),
  json = (v: unknown) =>
    JSON.parse(JSON.stringify(v)) as Prisma.InputJsonObject;
const select = {
  id: true,
  reference: true,
  leaseId: true,
  successorId: true,
  kind: true,
  endsOn: true,
  snapshot: true,
  reason: true,
  createdAt: true,
} as const;
const leaseSelect = {
  id: true,
  companyId: true,
  propertyId: true,
  unitId: true,
  residentId: true,
  residentContactId: true,
  previousLeaseId: true,
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
} as const;
async function context(tx: Tx, cid: string, id: string) {
  const lease = await tx.lease.findFirst({
    where: { id, companyId: cid },
    select: leaseSelect,
  });
  if (!lease) throw new AccessError(404, "NOT_FOUND", "Lease not found.");
  const company = await tx.company.findUniqueOrThrow({
      where: { id: cid },
      select: { timezone: true },
    }),
    businessDate = companyDay(company.timezone),
    on = new Date(businessDate + "T00:00:00Z");
  const successors = await tx.lease.findMany({
    where: { companyId: cid, previousLeaseId: id },
    select: leaseSelect,
    take: 2,
  });
  if (successors.length > 1)
    throw new AccessError(
      422,
      "TRANSITION_SCOPE",
      "Review the linked renewals before continuing.",
    );
  const successor = successors[0] ?? null;
  const changes = await readTermChanges(
    tx,
    cid,
    successor ? [id, successor.id] : [id],
  );
  const schedules = await tx.rentSchedule.findMany({
    where: {
      companyId: cid,
      leaseId: { in: successor ? [id, successor.id] : [id] },
      status: { in: ["active", "paused"] },
    },
    orderBy: { id: "asc" },
    take: 4,
  });
  if (schedules.filter((s) => s.leaseId === id).length > 1)
    throw new AccessError(
      422,
      "TRANSITION_SCOPE",
      "Review multiple open billing schedules before continuing.",
    );
  const sources = await readRentSources(tx, cid, [id]),
    {
      chargeApplied: _ca,
      paymentApplied: _pa,
      refundedByPayment: _rp,
      chargePaymentHistory: _history,
      ...summary
    } = rentBalances(sources, businessDate),
    deposit = await readDepositDetail(tx, cid, id),
    depositSummary = deposit.account?.summary ?? null;
  const history = await tx.leaseTransition.findMany({
    where: { companyId: cid, leaseId: id },
    select,
    orderBy: { id: "desc" },
    take: 101,
  });
  if (history.length > 100)
    throw new AccessError(
      422,
      "TRANSITION_SCOPE",
      "Too many handoff events for a complete review.",
    );
  return {
    lease,
    successor,
    changes,
    schedules,
    sources,
    summary,
    depositSummary,
    businessDate,
    timezone: company.timezone,
    current: termsAt(
      lease,
      changes.filter((c) => c.leaseId === id),
      on,
    ),
    history,
    sourceHash: hash({
      businessDate,
      timezone: company.timezone,
      lease,
      successor,
      changes,
      schedules,
      sources,
      deposit,
    }),
  };
}
type Data = {
  kind: string;
  endsOn: Date;
  expectedLeaseVersion: number;
  expectedSuccessorVersion: number | null;
  newBilling: string;
  firstDueOn: Date | null;
  firstAmountCents: number | null;
  firstOverrideReason: string | null;
  reason: string;
  depositDisposition: string;
};
function parse(b: Record<string, unknown>): Data {
  const kind = choice(b.kind, ["plan_end", "end", "renew"], "handoff action"),
    endsOn = date(b.endsOn, "final included lease date"),
    newBilling = choice(
      b.newBilling,
      ["none", "manual", "recurring"],
      "new-term billing",
    );
  if (
    b.depositDisposition !== "retain_old_ledger" ||
    (kind === "renew" ? newBilling === "none" : newBilling !== "none")
  )
    throw new AccessError(
      400,
      "TRANSITION_OPTIONS",
      "Review the deposit disposition and billing choice for this action.",
    );
  const firstAmountCents =
      b.firstAmount == null || b.firstAmount === ""
        ? null
        : cents(b.firstAmount),
    firstOverrideReason =
      firstAmountCents === null
        ? null
        : boundedText(b.firstOverrideReason, 500, "First rent override reason");
  if (firstAmountCents === 0)
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "An agreed first charge must be positive.",
    );
  return {
    kind,
    endsOn,
    newBilling,
    firstDueOn:
      b.firstDueOn == null || b.firstDueOn === ""
        ? null
        : date(b.firstDueOn, "new first rent due date"),
    firstAmountCents,
    firstOverrideReason,
    reason: boundedText(b.reason, 500, "Handoff reason"),
    expectedLeaseVersion: version(b.expectedLeaseVersion),
    expectedSuccessorVersion:
      kind === "renew" ? version(b.expectedSuccessorVersion) : null,
    depositDisposition: "retain_old_ledger",
  };
}
function review(c: Awaited<ReturnType<typeof context>>, d: Data) {
  const { lease, successor } = c,
    end = d.endsOn;
  if (
    lease.status === "draft" ||
    (lease.status === "ended" && d.kind !== "renew")
  )
    throw new AccessError(
      409,
      "TRANSITION_LEASE",
      "Use an active lease for ending or planning; an ended predecessor can hand off to its linked draft.",
    );
  if (end < lease.startsOn)
    throw new AccessError(
      400,
      "TRANSITION_DATES",
      "The final included day cannot precede the lease start.",
    );
  if (lease.status === "ended" && (!lease.endsOn || +lease.endsOn !== +end))
    throw new AccessError(
      409,
      "TRANSITION_DATES",
      "Keep the recorded ended term unchanged.",
    );
  if (
    c.changes.some(
      (t) => t.leaseId === lease.id && !t.cancellation && t.effectiveOn > end,
    )
  )
    throw new AccessError(
      409,
      "TRANSITION_TERMS",
      "Cancel any unposted future terms after the proposed end before reviewing this handoff.",
    );
  if (
    c.sources.charges.some(
      (q) => q.kind === "rent" && !q.voidedAt && q.periodOn > monthStart(end),
    )
  )
    throw new AccessError(
      409,
      "TRANSITION_POSTED",
      "Monthly rent is already posted after the proposed final month. Review those source charges before shortening the term.",
    );
  if (successor && end >= successor.startsOn)
    throw new AccessError(
      409,
      "TRANSITION_OVERLAP",
      "The old term must end before its linked renewal starts.",
    );
  const oldTerms = termsAt(
      lease,
      c.changes.filter((t) => t.leaseId === lease.id),
      monthStart(end),
    ),
    oldCalculation = calendarProration(
      lease.startsOn,
      end,
      monthStart(end),
      oldTerms.rentCents,
    ),
    oldSchedule = c.schedules.find((s) => s.leaseId === lease.id) ?? null,
    oldCharge =
      c.sources.charges.find(
        (q) =>
          q.kind === "rent" && !q.voidedAt && +q.periodOn === +monthStart(end),
      ) ?? null;
  const oldInstallment = oldSchedule
    ? termInstallment(
        oldSchedule,
        c.changes.filter((t) => t.leaseId === lease.id),
        monthStart(end),
      )
    : null;
  const blockers: string[] = [],
    pauseBilling =
      d.kind === "plan_end" &&
      oldCalculation.partial &&
      !oldCharge &&
      oldSchedule?.status === "active";
  const periods = new Map<string, Date>();
  periods.set(isoDay(monthStart(end)), monthStart(end));
  if (oldSchedule) {
    let period = oldSchedule.nextPeriodOn;
    const cutoff =
      oldSchedule.lastPeriodOn && oldSchedule.lastPeriodOn < monthStart(end)
        ? oldSchedule.lastPeriodOn
        : monthStart(end);
    for (let i = 0; period <= cutoff; i++, period = nextMonth(period)) {
      if (i >= 1200)
        throw new AccessError(
          422,
          "HANDOFF_SCOPE",
          "Review no more than 1,200 current-lease rent months at once.",
        );
      periods.set(isoDay(period), period);
    }
  }
  const oldInstallments = Array.from(periods.values())
    .sort((a, b) => +a - +b)
    .map((period) => {
      const terms = termsAt(
          lease,
          c.changes.filter((t) => t.leaseId === lease.id),
          period,
        ),
        calculation = calendarProration(
          lease.startsOn,
          end,
          period,
          terms.rentCents,
        ),
        recorded = c.sources.charges.filter(
          (q) => q.kind === "rent" && +q.periodOn === +period,
        ),
        active = recorded.find((q) => !q.voidedAt),
        item = oldSchedule
          ? termInstallment(
              oldSchedule,
              c.changes.filter((t) => t.leaseId === lease.id),
              period,
            )
          : null;
      const amountOverride =
        !!oldSchedule &&
        ((+period === +oldSchedule.firstPeriodOn &&
          oldSchedule.firstAmountCents !== null) ||
          (oldSchedule.lastPeriodOn !== null &&
            +period === +oldSchedule.lastPeriodOn &&
            oldSchedule.lastAmountCents !== null));
      const amountCents =
          active?.amountCents ??
          (amountOverride
            ? item!.amountCents
            : calculation.partial
              ? calculation.calculatedCents
              : terms.rentCents),
        dueOn = active?.dueOn ?? item?.dueOn ?? rentMonthDue(terms, period),
        action = active
          ? "retain"
          : recorded.length
            ? "retain_voided"
            : !amountCents
              ? "no_charge"
              : d.kind === "plan_end"
                ? "review_later"
                : "post";
      if (
        !amountCents &&
        terms.rentCents > 0 &&
        !recorded.length &&
        d.kind !== "plan_end"
      )
        blockers.push(
          `Rent for ${isoDay(period)} rounds to zero. Record an explicitly agreed amount before the handoff.`,
        );
      return {
        periodOn: isoDay(period),
        calculation,
        amountCents,
        dueOn: isoDay(dueOn),
        graceDays: active?.graceDays ?? terms.graceDays,
        action,
        chargeId: active?.id ?? null,
        reference: active?.reference ?? null,
        amountOverride,
      };
    });
  const oldNewCents = oldInstallments
      .filter((i) => i.action === "post")
      .reduce((n, i) => n + BigInt(i.amountCents), 0n),
    oldOwed =
      BigInt(c.summary.outstandingCents) +
      oldNewCents -
      BigInt(c.summary.creditCents),
    projectedBalances = {
      outstandingCents: String(oldOwed > 0n ? oldOwed : 0n),
      creditCents: String(oldOwed < 0n ? -oldOwed : 0n),
    };
  let newTerm: null | {
    lease: NonNullable<typeof successor>;
    terms: ReturnType<typeof termsAt>;
    first: ReturnType<typeof calendarProration>;
    last: ReturnType<typeof calendarProration> | null;
    firstDueOn: Date;
    firstAmountCents: number;
    billing: string;
  } = null;
  let readyOn = isoDay(end);
  if (d.kind === "renew") {
    if (
      !successor ||
      successor.status !== "draft" ||
      successor.unitId !== lease.unitId ||
      successor.propertyId !== lease.propertyId ||
      +successor.startsOn !== +new Date(+end + 86400000)
    )
      throw new AccessError(
        409,
        "RENEWAL_HANDOFF",
        "Choose the linked draft starting the day after the old lease ends. Review any gap or overlap first.",
      );
    if (successor.version !== d.expectedSuccessorVersion) throw conflict();
    if (c.schedules.some((s) => s.leaseId === successor.id))
      throw new AccessError(
        409,
        "RENEWAL_BILLING",
        "The draft already has billing. Review its schedule before activating.",
      );
    const terms = termsAt(
        successor,
        c.changes.filter((t) => t.leaseId === successor.id),
        monthStart(successor.startsOn),
      ),
      first = calendarProration(
        successor.startsOn,
        successor.endsOn,
        monthStart(successor.startsOn),
        terms.rentCents,
      ),
      last = successor.endsOn
        ? calendarProration(
            successor.startsOn,
            successor.endsOn,
            monthStart(successor.endsOn),
            terms.rentCents,
          )
        : null,
      firstAmountCents = d.firstAmountCents ?? first.calculatedCents;
    if (terms.rentCents > 0 && !firstAmountCents)
      throw new AccessError(
        400,
        "PRORATION_ZERO",
        "The new first installment rounds to zero. Review a positive agreed first amount.",
      );
    if (d.newBilling === "recurring" && last?.partial && !last.calculatedCents)
      throw new AccessError(
        400,
        "PRORATION_ZERO",
        "The final new installment rounds to zero. Use manual billing for an explicitly agreed amount.",
      );
    if (d.newBilling === "recurring" && !terms.rentCents)
      throw new AccessError(
        400,
        "RENEWAL_BILLING",
        "Use manual billing for a rent-free term.",
      );
    const firstDueOn =
        d.firstDueOn ?? rentMonthDue(terms, monthStart(successor.startsOn)),
      second = new Date(
        Date.UTC(
          successor.startsOn.getUTCFullYear(),
          successor.startsOn.getUTCMonth() + 1,
          1,
        ),
      );
    if (
      d.newBilling === "recurring" &&
      (!successor.endsOn || second <= successor.endsOn) &&
      firstDueOn > rentMonthDue(terms, second)
    )
      throw new AccessError(
        400,
        "RENEWAL_DUE_ORDER",
        "The first due date cannot follow the next installment.",
      );
    newTerm = {
      lease: successor,
      terms,
      first,
      last,
      firstDueOn,
      firstAmountCents,
      billing: d.newBilling,
    };
    readyOn = isoDay(successor.startsOn);
  }
  if (d.kind !== "plan_end" && c.businessDate < readyOn)
    blockers.push(
      `This change can be completed on or after ${readyOn}. The current lease stays active until you complete this change.`,
    );
  if (
    d.kind === "plan_end" &&
    lease.endsOn &&
    +lease.endsOn === +end &&
    !pauseBilling
  )
    throw new AccessError(
      400,
      "TRANSITION_UNCHANGED",
      "This end date is already recorded. Continue with partial rent, renewal preparation or the final handoff.",
    );
  return {
    kind: d.kind,
    endsOn: isoDay(end),
    reason: d.reason,
    lease: c.lease,
    successor: newTerm?.lease ?? null,
    businessDate: c.businessDate,
    timezone: c.timezone,
    readyOn,
    ready: !blockers.length,
    blockers,
    oldInstallments,
    projectedBalances,
    oldFinal: {
      calculation: oldCalculation,
      recordedCharge: oldCharge
        ? {
            id: oldCharge.id,
            reference: oldCharge.reference,
            amountCents: oldCharge.amountCents,
            dueOn: isoDay(oldCharge.dueOn),
            graceDays: oldCharge.graceDays,
          }
        : null,
      scheduledAmountCents: oldInstallment?.amountCents ?? oldTerms.rentCents,
    },
    oldBilling: oldSchedule
      ? {
          id: oldSchedule.id,
          version: oldSchedule.version,
          status: oldSchedule.status,
          action:
            d.kind === "plan_end"
              ? pauseBilling
                ? "pause"
                : "retain_until_cutoff"
              : "stop",
        }
      : null,
    pauseBilling,
    newTerm: newTerm
      ? {
          ...newTerm,
          firstDueOn: isoDay(newTerm.firstDueOn),
          firstOverrideReason: d.firstOverrideReason,
        }
      : null,
    balances: c.summary,
    deposit: c.depositSummary,
    depositDisposition: d.depositDisposition,
    sourceHash: c.sourceHash,
    expectedLeaseVersion: c.lease.version,
    expectedSuccessorVersion: successor?.version ?? null,
  };
}
export function registerLeaseTransitions(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate },
    root = "/api/company/leases/:leaseId/transition";
  server.get<{ Params: { leaseId: string } }>(root, auth, (request) => {
    if (Object.keys(request.query as object).length)
      throw new AccessError(400, "INVALID_INPUT", "Unknown handoff filter.");
    const id = assignmentId(request.params.leaseId);
    return scoped(db, request, "finance.manage", async (tx, cid) => {
      const c = await context(tx, cid, id);
      return {
        lease: c.lease,
        successor: c.successor,
        current: c.current,
        businessDate: c.businessDate,
        balances: c.summary,
        deposit: c.depositSummary,
        history: c.history,
      };
    });
  });
  server.get<{ Params: { leaseId: string } }>(
    "/api/resident/leases/:leaseId/transition",
    auth,
    (request) => {
      const id = assignmentId(request.params.leaseId);
      if (Object.keys(request.query as object).length)
        throw new AccessError(400, "INVALID_INPUT", "Unknown handoff filter.");
      return scoped(db, request, "resident.self", async (tx, cid) => {
        const company = await tx.company.findUniqueOrThrow({
          where: { id: cid },
          select: { timezone: true },
        });
        if (
          !(await tx.lease.findFirst({
            where: {
              id,
              companyId: cid,
              status: { not: "draft" },
              ...sharedLeaseAccess(
                cid,
                request.principal!.id,
                new Date(companyDay(company.timezone) + "T00:00:00Z"),
              ),
            },
          }))
        )
          throw new AccessError(404, "NOT_FOUND", "Lease not found.");
        const rows = await tx.leaseTransition.findMany({
          where: { companyId: cid, leaseId: id },
          select: {
            id: true,
            reference: true,
            kind: true,
            endsOn: true,
            reason: true,
            createdAt: true,
          },
          orderBy: { id: "desc" },
          take: 101,
        });
        if (rows.length > 100)
          throw new AccessError(
            422,
            "TRANSITION_SCOPE",
            "Too many handoff records for a complete history.",
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
        const fields = [
            "kind",
            "endsOn",
            "expectedLeaseVersion",
            "expectedSuccessorVersion",
            "newBilling",
            "firstDueOn",
            "firstAmount",
            "firstOverrideReason",
            "reason",
            "depositDisposition",
          ],
          id = assignmentId(request.params.leaseId),
          b = input(
            request,
            preview
              ? fields
              : [...fields, "sourceHash", "submissionKey", "confirmed"],
          ),
          d = parse(b);
        if (
          !preview &&
          (b.confirmed !== true ||
            typeof b.sourceHash !== "string" ||
            !/^[a-f0-9]{64}$/.test(b.sourceHash))
        )
          throw new AccessError(
            400,
            "REVIEW_REQUIRED",
            "Confirm the reviewed lease dates, rent and deposit handling.",
          );
        const key = preview
          ? null
          : submission(b.submissionKey, [id, d, b.sourceHash]);
        return scoped(db, request, "finance.manage", async (tx, cid) => {
          if (key) {
            const old = await tx.leaseTransition.findFirst({
              where: {
                companyId: cid,
                createdById: request.principal!.id,
                submissionKey: key.submissionKey,
              },
              select: { ...select, submissionHash: true },
            });
            if (old) {
              sameSubmission(old.submissionHash, key.submissionHash);
              const { submissionHash: _hash, ...row } = old;
              return row;
            }
          }
          await lockRentLease(tx, cid, id);
          const initial = await tx.lease.findFirst({
            where: { companyId: cid, previousLeaseId: id },
            select: { id: true },
          });
          if (initial) await lockRentLease(tx, cid, initial.id);
          const c = await context(tx, cid, id);
          if (c.lease.version !== d.expectedLeaseVersion) throw conflict();
          const p = review(c, d);
          if (preview) return p;
          if (!p.ready)
            throw new AccessError(
              409,
              "HANDOFF_NOT_READY",
              p.blockers.join(" "),
            );
          if (b.sourceHash !== c.sourceHash)
            throw new AccessError(
              409,
              "HANDOFF_CHANGED",
              "Lease details, billing or balances changed. Refresh and review the lease change again.",
            );
          const unit = await lockUnit(tx, cid, c.lease.unitId);
          if (d.kind === "renew" && unit.status !== "active")
            throw new AccessError(
              409,
              "UNIT_ARCHIVED",
              "Restore the unit before activating its renewal.",
            );
          if (d.kind === "renew") {
            const n = c.successor!;
            if (n.residentContactId)
              await contactEligible(tx, cid, n.residentContactId, n.propertyId);
            else if (n.residentId)
              await eligible(tx, cid, n.residentId, n.propertyId);
            else
              throw new AccessError(
                409,
                "RENEWAL_CONTACT",
                "Review the new primary tenant before activating.",
              );
          }
          const oldChargeIds: string[] = [];
          for (const item of p.oldInstallments.filter(
            (i) => i.action === "post",
          )) {
            const charge = await tx.rentCharge.create({
              data: {
                companyId: cid,
                propertyId: c.lease.propertyId,
                leaseId: id,
                createdById: request.principal!.id,
                ...submission(randomUUID(), [
                  "handoff-old-rent",
                  key!.submissionKey,
                  item.periodOn,
                ]),
                periodOn: new Date(item.periodOn + "T00:00:00Z"),
                dueOn: new Date(item.dueOn + "T00:00:00Z"),
                amountCents: item.amountCents,
                graceDays: item.graceDays,
                memo: `Reviewed final billing · ${item.calculation.fromOn} through ${item.calculation.throughOn} · ${d.reason}`.slice(
                  0,
                  500,
                ),
              },
              select: { id: true },
            });
            oldChargeIds.push(charge.id);
            if (item.calculation.partial) {
              const snapshot = {
                ...item.calculation,
                businessDate: c.businessDate,
                timezone: c.timezone,
                amountCents: item.amountCents,
                dueOn: item.dueOn,
                graceDays: item.graceDays,
                reason: d.reason,
                overrideReason: item.amountOverride
                  ? "Retained previously reviewed schedule amount"
                  : null,
              };
              await tx.leaseProration.create({
                data: {
                  companyId: cid,
                  propertyId: c.lease.propertyId,
                  leaseId: id,
                  chargeId: charge.id,
                  snapshot: json(snapshot),
                  createdById: request.principal!.id,
                  ...submission(randomUUID(), [
                    "handoff-old-proration",
                    key!.submissionKey,
                    item.periodOn,
                  ]),
                },
              });
            }
            await audit(
              tx,
              request,
              cid,
              charge.id,
              "lease.transition.final_rent",
              {
                leaseId: id,
                periodOn: item.periodOn,
                amountCents: item.amountCents,
              },
            );
          }
          if (oldChargeIds.length)
            await allocateRentCredit(tx, request, cid, id);
          await tx.lease.update({
            where: { id },
            data: {
              endsOn: d.endsOn,
              ...(d.kind === "plan_end" ? {} : { status: "ended" }),
              version: { increment: 1 },
            },
          });
          if (p.oldBilling && (d.kind !== "plan_end" || p.pauseBilling)) {
            await tx.rentSchedule.update({
              where: { id: p.oldBilling.id },
              data: {
                status: d.kind === "plan_end" ? "paused" : "stopped",
                version: { increment: 1 },
                lastErrorCode: null,
              },
            });
            await audit(
              tx,
              request,
              cid,
              p.oldBilling.id,
              "lease.transition.billing",
              { leaseId: id, action: p.oldBilling.action },
            );
          }
          let firstChargeId: string | null = null,
            newScheduleId: string | null = null;
          if (d.kind === "renew") {
            const n = p.newTerm!;
            await activeSlot(tx, cid, n.lease.unitId, n.lease.id);
            await tx.lease.update({
              where: { id: n.lease.id },
              data: { status: "active", version: { increment: 1 } },
            });
            if (n.firstAmountCents > 0) {
              const charge = await tx.rentCharge.create({
                data: {
                  companyId: cid,
                  propertyId: n.lease.propertyId,
                  leaseId: n.lease.id,
                  createdById: request.principal!.id,
                  ...submission(randomUUID(), [
                    "handoff-first",
                    key!.submissionKey,
                  ]),
                  periodOn: monthStart(n.lease.startsOn),
                  dueOn: new Date(n.firstDueOn + "T00:00:00Z"),
                  amountCents: n.firstAmountCents,
                  graceDays: n.terms.graceDays,
                  memo: `First rent · ${n.first.fromOn} through ${n.first.throughOn} · ${d.reason}`.slice(
                    0,
                    500,
                  ),
                },
                select: { id: true },
              });
              firstChargeId = charge.id;
              if (n.first.partial || d.firstAmountCents !== null) {
                const snapshot = {
                  ...n.first,
                  businessDate: c.businessDate,
                  timezone: c.timezone,
                  amountCents: n.firstAmountCents,
                  dueOn: n.firstDueOn,
                  graceDays: n.terms.graceDays,
                  reason: d.reason,
                  overrideReason: d.firstOverrideReason,
                };
                await tx.leaseProration.create({
                  data: {
                    companyId: cid,
                    propertyId: n.lease.propertyId,
                    leaseId: n.lease.id,
                    chargeId: charge.id,
                    snapshot: json(snapshot),
                    createdById: request.principal!.id,
                    ...submission(randomUUID(), [
                      "handoff-proration",
                      key!.submissionKey,
                    ]),
                  },
                });
              }
              await audit(
                tx,
                request,
                cid,
                charge.id,
                "lease.transition.first_rent",
                { leaseId: n.lease.id, amountCents: n.firstAmountCents },
              );
              await allocateRentCredit(tx, request, cid, n.lease.id);
            }
            if (n.billing === "recurring") {
              const schedule = await tx.rentSchedule.create({
                data: {
                  companyId: cid,
                  propertyId: n.lease.propertyId,
                  leaseId: n.lease.id,
                  createdById: request.principal!.id,
                  ...submission(randomUUID(), [
                    "handoff-schedule",
                    key!.submissionKey,
                  ]),
                  firstPeriodOn: monthStart(n.lease.startsOn),
                  lastPeriodOn: n.lease.endsOn
                    ? monthStart(n.lease.endsOn)
                    : null,
                  nextPeriodOn: monthStart(n.lease.startsOn),
                  amountCents: n.terms.rentCents,
                  dueDay: n.terms.rentDueDay,
                  graceDays: n.terms.graceDays,
                  leadDays: 0,
                  firstDueOn: new Date(n.firstDueOn + "T00:00:00Z"),
                  firstAmountCents: n.firstAmountCents,
                  lastAmountCents: n.last?.partial
                    ? n.last.calculatedCents
                    : null,
                },
                select: { id: true },
              });
              newScheduleId = schedule.id;
              await audit(
                tx,
                request,
                cid,
                schedule.id,
                "lease.transition.schedule",
                { leaseId: n.lease.id },
              );
            }
          }
          const row = await tx.leaseTransition.create({
            data: {
              companyId: cid,
              propertyId: c.lease.propertyId,
              leaseId: id,
              successorId: d.kind === "renew" ? c.successor!.id : null,
              kind: d.kind,
              endsOn: d.endsOn,
              reason: d.reason,
              snapshot: json({
                ...p,
                oldChargeIds,
                firstChargeId,
                newScheduleId,
              }),
              createdById: request.principal!.id,
              ...key!,
            },
            select,
          });
          await audit(tx, request, cid, row.id, "lease.transition.saved", {
            leaseId: id,
            successorId: row.successorId,
            kind: d.kind,
            endsOn: isoDay(d.endsOn),
            firstChargeId,
            newScheduleId,
            depositDisposition: d.depositDisposition,
          });
          return row;
        });
      },
    );
}
