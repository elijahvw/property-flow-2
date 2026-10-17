import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { date, scoped } from "./operational.js";
import { companyDay } from "./reports.js";
import { readRentSources, rentBalances } from "./rent.js";
import { readDepositDetail } from "./deposits.js";
import { chargeTiming } from "./payment-policy.js";
import { sharedLeaseAccess } from "./lease-participants.js";

const day = (value: Date) => value.toISOString().slice(0, 10);
export const statementBasis =
  "Monthly rent uses its due date; one-time charges, noncash credits and linked reversals use their effective date; cash receipts use the date received; deposit applications and manual refunds use their effective date. Dates are inclusive calendar days. All amounts use current record status and current allocations at generation time, including corrections made later. Opening and closing net balances are charges less cash receipts, net noncash credits and net deposit applications, plus active rent refunds by source date, not historical as-of balances. Allocations do not change net activity. Unpaid charges, unapplied receipt credit and refundable deposits are shown separately for the whole lease.";

// One source snapshot and the rent ledger's exact-cent calculator. Never infer
// historical allocations or turn a correction void into a cash refund.
export function buildRentStatement(
  sources: Awaited<ReturnType<typeof readRentSources>>,
  today: string,
  dateFrom: string | null,
  dateTo: string | null,
) {
  const { chargeApplied, paymentApplied, chargePaymentHistory, refundedByPayment, ...current } =
    rentBalances(sources, today);
  const charges = sources.charges.map((c) => {
    const applied = chargeApplied.get(c.id) ?? 0n;
    const remaining = c.voidedAt ? 0n : BigInt(c.amountCents) - applied;
    const timing = chargeTiming(
      c.dueOn,
      c.graceDays,
      today,
      remaining,
      !!c.voidedAt,
    );
    const history = chargePaymentHistory.get(c.id);
    return {
      type: "charge" as const,
      id: c.id,
      reference: c.reference,
      date: day(c.kind === "one_time" ? c.effectiveOn! : c.dueOn),
      dueOn: day(c.dueOn),
      category: c.category ?? "rent",
      description: c.kind === "one_time" ? c.memo : null,
      relatedId: null,
      relatedReference: null,
      periodOn: c.kind === "one_time" ? null : day(c.periodOn),
      amountCents: String(c.amountCents),
      appliedCents: String(applied),
      remainingCents: String(remaining),
      status:
        history?.paidLate && !c.voidedAt
          ? "paid_late"
          : !c.voidedAt &&
              remaining === 0n &&
              BigInt(history?.creditedCents ?? "0") + BigInt(history?.depositAppliedCents ?? "0") > 0n
            ? BigInt(history?.depositAppliedCents??"0")>0n ? "settled_deposit" : "settled"
            : timing.collectionStatus,
      graceThrough: timing.graceThrough,
      settledOn: history?.settledOn ?? null,
      voidedAt: c.voidedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      scheduleId: c.scheduleId,
      effectCents: c.voidedAt ? "0" : String(c.amountCents),
    };
  });
  const receipts = sources.payments.map((p) => {
    const applied = paymentApplied.get(p.id) ?? 0n;
    const remaining = p.voidedAt ? 0n : BigInt(p.amountCents) - applied - (refundedByPayment.get(p.id)??0n);
    return {
      type: "receipt" as const,
      id: p.id,
      reference: p.reference,
      date: day(p.occurredOn),
      dueOn: null,
      category: null,
      description: null,
      relatedId: null,
      relatedReference: null,
      periodOn: null,
      amountCents: String(p.amountCents),
      appliedCents: String(applied),
      remainingCents: String(remaining),
      status: p.voidedAt
        ? "voided"
        : (refundedByPayment.get(p.id)??0n)>0n ? remaining===0n && applied===0n ? "returned" : "partly_returned"
        : remaining === 0n
          ? "fully_applied"
          : applied > 0n
            ? "partly_applied"
            : "unapplied",
      graceThrough: null,
      settledOn: null,
      voidedAt: p.voidedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      scheduleId: null,
      effectCents: p.voidedAt ? "0" : String(-BigInt(p.amountCents)),
    };
  });
  const chargeReferences = new Map(charges.map(charge => [charge.id, charge.reference]));
  const credits = (sources.credits ?? []).flatMap((c) => {
    const base = {
      id: c.id,
      reference: c.reference,
      date: day(c.effectiveOn),
      dueOn: null,
      category: c.kind,
      description: c.reason,
      relatedId: c.chargeId,
      relatedReference:
        chargeReferences.get(c.chargeId) ?? null,
      type: "credit" as const,
      periodOn: null,
      amountCents: String(c.amountCents),
      appliedCents: c.reversal ? "0" : String(c.amountCents),
      remainingCents: "0",
      status: c.reversal ? "credit_reversed" : "credit_applied",
      graceThrough: null,
      settledOn: null,
      voidedAt: null,
      createdAt: c.createdAt.toISOString(),
      scheduleId: null,
      effectCents: String(-BigInt(c.amountCents)),
    };
    return c.reversal
      ? [
          base,
          {
            ...base,
            id: c.reversal.id,
            reference: c.reversal.reference,
            date: day(c.reversal.effectiveOn),
            type: "credit_reversal" as const,
            category: "credit_reversal",
            description: c.reversal.reason,
            relatedId: c.id,
            relatedReference: c.reference,
            appliedCents: "0",
            status: "credit_reversal",
            createdAt: c.reversal.createdAt.toISOString(),
            effectCents: String(c.amountCents),
          },
        ]
      : [base];
  });
  const movements = (sources.movements??[]).filter(m=>m.kind!=="deposit_refund").flatMap(m=>{
    const refund=m.kind==="rent_refund", base={
      type:refund?"refund" as const:"deposit_application" as const,id:m.id,reference:m.reference,date:day(m.effectiveOn),dueOn:null,category:m.kind,
      description:m.reason,relatedId:m.chargeId??m.paymentId,relatedReference:refund?receipts.find(p=>p.id===m.paymentId)?.reference??null:chargeReferences.get(m.chargeId!)??null,
      periodOn:null,amountCents:String(m.amountCents),appliedCents:m.reversal?"0":String(m.amountCents),remainingCents:"0",status:m.reversal?"movement_corrected":refund?"returned":"deposit_applied",graceThrough:null,settledOn:null,
      voidedAt:refund&&m.reversal?m.reversal.createdAt.toISOString():null,createdAt:m.createdAt.toISOString(),scheduleId:null,
      effectCents:refund?(m.reversal?"0":String(m.amountCents)):String(-BigInt(m.amountCents)),
    };
    return m.reversal?[base,{...base,type:"movement_reversal" as const,id:m.reversal.id,reference:m.reversal.reference,date:day(m.reversal.effectiveOn),description:m.reversal.reason,relatedId:m.id,relatedReference:m.reference,status:"movement_reversal",voidedAt:null,createdAt:m.reversal.createdAt.toISOString(),effectCents:refund?"0":String(m.amountCents)}]:[base];
  });
  const all = [...charges, ...receipts, ...credits, ...movements].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.type.localeCompare(b.type) ||
      a.id.localeCompare(b.id),
  );
  const before = all.filter((r) => dateFrom && r.date < dateFrom);
  const after = all.filter((r) => dateTo && r.date > dateTo);
  const period = all.filter(
    (r) => (!dateFrom || r.date >= dateFrom) && (!dateTo || r.date <= dateTo),
  );
  const net = (rows: typeof all) =>
    rows.reduce((sum, r) => sum + BigInt(r.effectCents), 0n);
  const opening = net(before);
  let running = opening;
  const items = period.map((r) => {
    running += BigInt(r.effectCents);
    return { ...r, runningNetCents: String(running) };
  });
  const chargeById = new Map(charges.map((r) => [r.id, r]));
  const receiptById = new Map(receipts.map((r) => [r.id, r]));
  const included = new Set(period.map((r) => `${r.type}:${r.id}`));
  // Include both endpoints even when only one falls in the selected range.
  // This explains payments applied to an earlier or future charge.
  const allocations = sources.allocations
    .filter(
      (a) =>
        included.has(`charge:${a.chargeId}`) ||
        included.has(`receipt:${a.entryId}`),
    )
    .map((a) => {
      const charge = chargeById.get(a.chargeId),
        receipt = receiptById.get(a.entryId);
      if (!charge || !receipt)
        throw new AccessError(
          503,
          "STATEMENT_SOURCE_UNAVAILABLE",
          "Statement sources are incomplete. No partial balance is shown.",
        );
      return {
        id: a.id,
        amountCents: String(a.amountCents),
        createdAt: a.createdAt.toISOString(),
        chargeId: charge.id,
        chargeReference: charge.reference,
        chargeDate: charge.dueOn ?? charge.date,
        receiptId: receipt.id,
        receiptReference: receipt.reference,
        receiptDate: receipt.date,
        active: !charge.voidedAt && !receipt.voidedAt,
      };
    });
  return {
    current,
    period: {
      openingNetCents: String(opening),
      chargedCents: String(
        period
          .filter((r) => r.type === "charge")
          .reduce((s, r) => s + BigInt(r.effectCents), 0n),
      ),
      receivedCents: String(
        -period
          .filter((r) => r.type === "receipt")
          .reduce((s, r) => s + BigInt(r.effectCents), 0n),
      ),
      noncashCreditCents: String(
        -period
          .filter((r) => r.type === "credit" || r.type === "credit_reversal")
          .reduce((s, r) => s + BigInt(r.effectCents), 0n),
      ),
      depositAppliedCents:String(-period.filter(r=>r.category==="deposit_application").reduce((s,r)=>s+BigInt(r.effectCents),0n)),
      refundedCents:String(period.filter(r=>r.category==="rent_refund").reduce((s,r)=>s+BigInt(r.effectCents),0n)),
      closingNetCents: String(running),
      laterNetCents: String(net(after)),
      currentNetCents: current.netCents,
      recordCount: period.length,
      voidedCount: period.filter((r) => r.voidedAt).length,
    },
    items,
    allocations,
  };
}

export function registerStatements(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
) {
  for (const resident of [false, true]) {
    server.get<{
      Params: { leaseId: string };
      Querystring: { dateFrom?: string; dateTo?: string };
    }>(
      `/api/${resident ? "resident" : "company"}/statements/:leaseId`,
      { preValidation: authenticate },
      (request) => {
        if (
          Object.keys(request.query).some(
            (key) => !["dateFrom", "dateTo"].includes(key),
          )
        )
          throw new AccessError(
            400,
            "INVALID_INPUT",
            "Unknown statement filter.",
          );
        const leaseId = assignmentId(request.params.leaseId);
        const from =
          request.query.dateFrom === undefined
            ? null
            : day(date(request.query.dateFrom, "statement start date"));
        const to =
          request.query.dateTo === undefined
            ? null
            : day(date(request.query.dateTo, "statement end date"));
        if (from && to && from > to)
          throw new AccessError(
            400,
            "INVALID_INPUT",
            "The end date must be on or after the start date.",
          );
        return scoped(
          db,
          request,
          resident ? "resident.self" : "finance.manage",
          async (tx, companyId) => {
            const company = await tx.company.findUniqueOrThrow({
              where: { id: companyId },
              select: { name: true, timezone: true },
            });
            const today = companyDay(company.timezone);
            const lease = await tx.lease.findFirst({
              where: {
                id: leaseId,
                companyId,
                ...(resident
                  ? {
                      ...sharedLeaseAccess(
                        companyId,
                        request.principal!.id,
                        new Date(today + "T00:00:00Z"),
                      ),
                      status: { not: "draft" },
                    }
                  : {}),
              },
              select: {
                id: true,
                propertyId: true,
                startsOn: true,
                endsOn: true,
                status: true,
                property: {
                  select: {
                    name: true,
                    address: true,
                    city: true,
                    state: true,
                    zip: true,
                    countryCode: true,
                  },
                },
                unit: { select: { label: true } },
              },
            });
            if (!lease)
              throw new AccessError(
                404,
                "NOT_FOUND",
                "Lease not found in your current workspace.",
              );
            const sources = await readRentSources(tx, companyId, [leaseId]);
            const rent = buildRentStatement(sources, today, from, to);
            const deposit = await readDepositDetail(
              tx,
              companyId,
              leaseId,
              resident ? request.principal!.id : undefined,
            );
            return {
              generatedAt: new Date().toISOString(),
              businessDate: today,
              company,
              lease,
              currency: "USD",
              filters: { dateFrom: from, dateTo: to },
              basis: statementBasis,
              ...rent,
              deposit: deposit.account
                ? {
                    id: deposit.account.id,
                    reference: deposit.account.reference,
                    dueOn: day(deposit.account.dueOn),
                    ...deposit.account.summary,
                    movements: deposit.account.movements,
                  }
                : null,
            };
          },
        );
      },
    );
  }
}
