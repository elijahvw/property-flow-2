import {installment,monthStart} from "./billing-dates.js";
import {currentLeaseTerms,readTermChanges,termsAt} from "./lease-term-policy.js";
import { readLeaseMovements } from "./movement-sources.js";
import { leasePerson, leasePersonSelect } from "./lease-person.js";
import { chargeTiming } from "./payment-policy.js";
import type {
  FastifyInstance,
  preValidationHookHandler,
  FastifyRequest,
} from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { companyDay } from "./reports.js";
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
  type AuditRequest,
} from "./operational.js";
import { sharedLeaseAccess } from "./lease-participants.js";
const leaseSelect = {
  rentDueDay: true,
  graceDays: true,
  paymentInstructions: true,
  id: true,
  propertyId: true,
  residentId: true,
  startsOn: true,
  endsOn: true,
  rentCents: true,
  status: true,
  version: true,
  property: { select: { name: true } },
  unit: { select: { label: true } },
  ...leasePersonSelect,
} as const;
export const chargeSelect = {
  termChangeId:true,termsSnapshot:true,
  kind: true, category: true, effectiveOn: true,
  reference:true,
  scheduleId: true,
  graceDays: true,
  id: true,
  leaseId: true,
  periodOn: true,
  dueOn: true,
  amountCents: true,
  memo: true,
  version: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
} as const;
const paymentSelect = {
  reference:true,
  id: true,
  leaseId: true,
  occurredOn: true,
  amountCents: true,
  memo: true,
  version: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
} as const;
const allocationSelect = {
  createdAt: true,
  id: true,
  leaseId: true,
  chargeId: true,
  entryId: true,
  amountCents: true,
} as const;
function bounded<T>(rows: T[], limit = 10000): T[] {
  if (rows.length > limit)
    throw new AccessError(
      422,
      "RENT_SCOPE_TOO_LARGE",
      "Too many rent records for this view. Choose a property or an individual lease; no partial totals are shown.",
    );
  return rows;
}
export async function lockRentLease(
  tx: Tx,
  companyId: string,
  leaseId: string,
) {
  // Same write fence as lease edits. Serializable retries refresh any waiter snapshot.
  await tx.$queryRaw`UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=${leaseId} AND "companyId"=${companyId} RETURNING id`;
  const row = await tx.lease.findFirst({
    where: { id: leaseId, companyId },
    select: leaseSelect,
  });
  if (!row) throw new AccessError(404, "NOT_FOUND", "Lease not found.");
  return row;
}
export const creditSelect = {
  id:true, reference:true, leaseId:true, chargeId:true, kind:true,
  effectiveOn:true, amountCents:true, reason:true, createdAt:true,
  reversal:{select:{id:true,reference:true,effectiveOn:true,reason:true,createdAt:true}},
} as const;
async function sources(tx: Tx, companyId: string, leaseIds: string[]) {
  const where = { companyId, leaseId: { in: leaseIds } };
  const charges = bounded(
    await tx.rentCharge.findMany({
      where,
      select: chargeSelect,
      take: 10001,
      orderBy: [{ dueOn: "asc" }, { id: "asc" }],
    }),
  );
  const payments = bounded(
    await tx.ledgerEntry.findMany({
      where,
      select: paymentSelect,
      take: 10001,
      orderBy: [{ occurredOn: "asc" }, { id: "asc" }],
    }),
  );
  const allocations = bounded(
    await tx.rentAllocation.findMany({
      where,
      select: allocationSelect,
      take: 10001,
      orderBy: { id: "asc" },
    }),
  );
  const credits = bounded(await tx.leaseCredit.findMany({where,select:creditSelect,take:10001,orderBy:[{effectiveOn:"asc"},{id:"asc"}]}));
  return { charges, payments, allocations, credits, movements: await readLeaseMovements(tx,companyId,leaseIds) };
}
// Connected workspaces use the same bounded sources and balance rules as rent.
export { sources as readRentSources };
// Persistent allocations retain their original source identity. A voided payment's
// allocations stay in history but contribute zero to current balances.
export function rentBalances(
  data: Omit<Awaited<ReturnType<typeof sources>>, "credits"|"movements"> & Partial<Pick<Awaited<ReturnType<typeof sources>>,"credits"|"movements">>,
  today: string,
) {
  const activePayments = new Set(
    data.payments.filter((p) => !p.voidedAt).map((p) => p.id),
  );
  const activeCharges = new Set(
    data.charges.filter((c) => !c.voidedAt).map((c) => c.id),
  );
  const paymentById = new Map(
    data.payments.filter((p) => !p.voidedAt).map((p) => [p.id, p]),
  );
  const chargeById = new Map(
    data.charges.filter((c) => !c.voidedAt).map((c) => [c.id, c]),
  );
  const receiptHistory = new Map<
    string,
    { paidAfterGraceCents: bigint; latestReceivedOn: string | null }
  >();
  const chargeApplied = new Map<string, bigint>(),
    paymentApplied = new Map<string, bigint>();
  for (const a of data.allocations)
    if (activePayments.has(a.entryId) && activeCharges.has(a.chargeId)) {
      const charge = chargeById.get(a.chargeId)!,
        payment = paymentById.get(a.entryId)!;
      const graceThrough = chargeTiming(
        charge.dueOn,
        charge.graceDays,
        today,
        1n,
      ).graceThrough;
      const received = payment.occurredOn.toISOString().slice(0, 10),
        history = receiptHistory.get(a.chargeId) ?? {
          paidAfterGraceCents: 0n,
          latestReceivedOn: null,
        };
      if (received > graceThrough)
        history.paidAfterGraceCents += BigInt(a.amountCents);
      if (!history.latestReceivedOn || received > history.latestReceivedOn)
        history.latestReceivedOn = received;
      receiptHistory.set(a.chargeId, history);
      chargeApplied.set(
        a.chargeId,
        (chargeApplied.get(a.chargeId) || 0n) + BigInt(a.amountCents),
      );
      paymentApplied.set(
        a.entryId,
        (paymentApplied.get(a.entryId) || 0n) + BigInt(a.amountCents),
      );
    }
  const creditedByCharge = new Map<string,bigint>();
  let noncashCredit = 0n;
  for(const credit of data.credits ?? []) if(!credit.reversal && activeCharges.has(credit.chargeId)) {
    const amount=BigInt(credit.amountCents);
    creditedByCharge.set(credit.chargeId,(creditedByCharge.get(credit.chargeId)??0n)+amount);
    chargeApplied.set(credit.chargeId,(chargeApplied.get(credit.chargeId)??0n)+amount);
    noncashCredit+=amount;
  }
  const refundedByPayment=new Map<string,bigint>(), depositByCharge=new Map<string,bigint>();
  let depositApplied=0n, refunded=0n;
  for(const movement of data.movements ?? []) if(!movement.reversal) {
    const amount=BigInt(movement.amountCents);
    if(movement.kind==="deposit_application" && movement.chargeId && activeCharges.has(movement.chargeId)) {
      chargeApplied.set(movement.chargeId,(chargeApplied.get(movement.chargeId)??0n)+amount);
      depositByCharge.set(movement.chargeId,(depositByCharge.get(movement.chargeId)??0n)+amount);
      depositApplied+=amount;
    }
    if(movement.kind==="rent_refund" && movement.paymentId && activePayments.has(movement.paymentId)) {
      refundedByPayment.set(movement.paymentId,(refundedByPayment.get(movement.paymentId)??0n)+amount);refunded+=amount;
    }
  }
  let rentOutstanding=0n, otherOutstanding=0n;
  const chargePaymentHistory = new Map<
    string,
    { paidAfterGraceCents: string; paidLate: boolean; settledOn: string | null; creditedCents:string; depositAppliedCents:string }
  >();
  let paidAfterGrace = 0n,
    paidLateCharges = 0n;
  let charged = 0n,
    paid = 0n,
    outstanding = 0n,
    overdue = 0n,
    credit = 0n,
    afterGrace = 0n,
    withinGrace = 0n,
    dueToday = 0n,
    upcoming = 0n;
  const aging = {
    age1To30Cents: 0n,
    age31To60Cents: 0n,
    age61To90Cents: 0n,
    age91PlusCents: 0n,
  };
  for (const c of data.charges)
    if (!c.voidedAt) {
      charged += BigInt(c.amountCents);
      const remaining = BigInt(c.amountCents) - (chargeApplied.get(c.id) || 0n);
      if (remaining < 0n) throw new Error("Rent charge overallocated");
      outstanding += remaining;
      if(c.kind==="one_time")otherOutstanding+=remaining;else rentOutstanding+=remaining;
      const credited=creditedByCharge.get(c.id)??0n, deposited=depositByCharge.get(c.id)??0n;
      const history = receiptHistory.get(c.id),
        late = history?.paidAfterGraceCents ?? 0n;
      paidAfterGrace += late;
      if (remaining === 0n && late > 0n && credited + deposited === 0n) paidLateCharges++;
      chargePaymentHistory.set(c.id, {
        paidAfterGraceCents: String(late),
        paidLate: remaining === 0n && late > 0n && credited + deposited === 0n,
        creditedCents:String(credited),
        depositAppliedCents:String(deposited),
        settledOn:
          remaining === 0n && credited + deposited === 0n ? (history?.latestReceivedOn ?? null) : null,
      });
      const timing = chargeTiming(c.dueOn, c.graceDays, today, remaining);
      if (timing.daysPastDue > 0) {
        overdue += remaining;
        const bucket =
          timing.daysPastDue <= 30
            ? "age1To30Cents"
            : timing.daysPastDue <= 60
              ? "age31To60Cents"
              : timing.daysPastDue <= 90
                ? "age61To90Cents"
                : "age91PlusCents";
        aging[bucket] += remaining;
      }
      if (timing.collectionStatus === "past_grace") afterGrace += remaining;
      if (timing.collectionStatus === "within_grace") withinGrace += remaining;
      if (timing.collectionStatus === "due_today") dueToday += remaining;
      if (timing.collectionStatus === "upcoming") upcoming += remaining;
    }
  for (const p of data.payments)
    if (!p.voidedAt) {
      paid += BigInt(p.amountCents);
      const remaining =
        BigInt(p.amountCents) - (paymentApplied.get(p.id) || 0n) - (refundedByPayment.get(p.id) || 0n);
      if (remaining < 0n) throw new Error("Rent payment overallocated");
      credit += remaining;
    }
  return {
    paidAfterGraceCents: String(paidAfterGrace),
    paidLateChargeCount: String(paidLateCharges),
    rentOutstandingCents:String(rentOutstanding),
    otherOutstandingCents:String(otherOutstanding),
    noncashCreditCents:String(noncashCredit),
    depositAppliedCents:String(depositApplied),
    refundedCents:String(refunded),
    chargedCents: String(charged),
    paidCents: String(paid),
    outstandingCents: String(outstanding),
    overdueCents: String(overdue),
    afterGraceCents: String(afterGrace),
    withinGraceCents: String(withinGrace),
    dueTodayCents: String(dueToday),
    upcomingCents: String(upcoming),
    ...Object.fromEntries(
      Object.entries(aging).map(([key, value]) => [key, String(value)]),
    ),
    creditCents: String(credit),
    netCents: String(charged - paid - noncashCredit - depositApplied + refunded),
    chargeApplied,
    paymentApplied,
    refundedByPayment,
    chargePaymentHistory,
  };
}
export async function allocateRentCredit(
  tx: Tx,
  request: AuditRequest,
  companyId: string,
  leaseId: string,
) {
  const data = await sources(tx, companyId, [leaseId]);
  const balance = rentBalances(data, "0000-01-01");
  const lease = await tx.lease.findFirstOrThrow({
    where: { id: leaseId, companyId },
    select: { propertyId: true },
  });
  const charges = data.charges.filter((c) => !c.voidedAt).sort((a,b)=>+a.dueOn-+b.dueOn || Number(a.kind==="one_time")-Number(b.kind==="one_time") || a.id.localeCompare(b.id));
  const pending: Prisma.RentAllocationCreateManyInput[] = [];
  let index = 0;
  for (const p of data.payments.filter((p) => !p.voidedAt)) {
    let available =
      BigInt(p.amountCents) - (balance.paymentApplied.get(p.id) || 0n) - (balance.refundedByPayment.get(p.id) || 0n);
    while (available > 0n && index < charges.length) {
      const c = charges[index],
        remaining =
          BigInt(c.amountCents) - (balance.chargeApplied.get(c.id) || 0n);
      if (!remaining) {
        index++;
        continue;
      }
      const amount = available < remaining ? available : remaining;
      pending.push({
        companyId,
        propertyId: lease.propertyId,
        leaseId,
        chargeId: c.id,
        entryId: p.id,
        amountCents: Number(amount),
      });
      balance.chargeApplied.set(
        c.id,
        (balance.chargeApplied.get(c.id) || 0n) + amount,
      );
      available -= amount;
    }
  }
  const created = pending.length;
  if (created) await tx.rentAllocation.createMany({ data: pending });
  if (created)
    await audit(tx, request, companyId, leaseId, "rent.allocated", {
      allocations: created,
    });
}
async function businessDay(tx: Tx, companyId: string) {
  return companyDay(
    (
      await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { timezone: true },
      })
    ).timezone,
  );
}
export function registerRent(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate };
  server.get<{Params:{leaseId:string};Querystring:{periodOn?:string}}>("/api/company/rent/:leaseId/terms",auth,request=>{
    if(Object.keys(request.query).some(k=>k!=="periodOn"))throw new AccessError(400,"INVALID_INPUT","Unknown rent terms filter.");
    const period=date(request.query.periodOn,"rent month"),id=assignmentId(request.params.leaseId);
    if(period.getUTCDate()!==1)throw new AccessError(400,"INVALID_INPUT","Choose a first-of-month rent period.");
    return scoped(db,request,"finance.manage",async(tx,companyId)=>{
      const lease=await tx.lease.findFirst({where:{id,companyId},select:leaseSelect});if(!lease)throw new AccessError(404,"NOT_FOUND","Lease not found.");
      if(period<monthStart(lease.startsOn)||(lease.endsOn&&period>monthStart(lease.endsOn)))throw new AccessError(400,"INVALID_INPUT","Choose a rent month inside the recorded lease term.");
      const terms=termsAt(lease,await readTermChanges(tx,companyId,[id]),period),item=installment({firstPeriodOn:period,firstDueOn:null,firstAmountCents:null,lastAmountCents:null,lastPeriodOn:null,amountCents:terms.rentCents,dueDay:terms.rentDueDay,leadDays:0},period);
      return{...terms,periodOn:period,dueOn:item.dueOn,expectedLeaseVersion:lease.version};
    });
  });
  for (const resident of [false, true])
    server.get<{ Querystring: { propertyId?: string; leaseId?: string } }>(
      resident ? "/api/resident/rent" : "/api/company/rent",
      auth,
      (request) => {
        const q = request.query;
        if (Object.keys(q).some((k) => !["propertyId", "leaseId"].includes(k)))
          throw new AccessError(400, "INVALID_INPUT", "Unknown rent filter.");
        const propertyId =
            q.propertyId === undefined ? undefined : assignmentId(q.propertyId),
          leaseId =
            q.leaseId === undefined ? undefined : assignmentId(q.leaseId);
        return scoped(
          db,
          request,
          resident ? "resident.self" : "finance.manage",
          async (tx, companyId) => {
            const today = await businessDay(tx, companyId);
            const where: Prisma.LeaseWhereInput = {
              companyId,
              ...(propertyId ? { propertyId } : {}),
              ...(leaseId ? { id: leaseId } : {}),
              ...(resident
                ? {
                    ...sharedLeaseAccess(companyId, request.principal!.id, new Date(today + "T00:00:00Z")),
                  }
                : {}),
            };
            if (
              !resident &&
              propertyId &&
              !(await tx.property.findFirst({
                where: { id: propertyId, companyId },
                select: { id: true },
              }))
            )
              throw new AccessError(404, "NOT_FOUND", "Property not found.");
            const leaseRows = bounded(
              await tx.lease.findMany({
                where,
                select: leaseSelect,
                take: 1001,
                orderBy: [{ property: { name: "asc" } }, { id: "asc" }],
              }),
              1000,
            );
            const leases=await currentLeaseTerms(tx,companyId,leaseRows,today);
            if (leaseId && !leases.length)
              throw new AccessError(404, "NOT_FOUND", "Lease not found.");
            const data = await sources(
                tx,
                companyId,
                leases.map((l) => l.id),
              );
            const accounts = leases.map((lease) => {
              const scopedData = {
                credits: data.credits.filter(c=>c.leaseId===lease.id),
                movements: data.movements.filter(c=>c.leaseId===lease.id),
                charges: data.charges.filter((c) => c.leaseId === lease.id),
                payments: data.payments.filter((p) => p.leaseId === lease.id),
                allocations: data.allocations.filter(
                  (a) => a.leaseId === lease.id,
                ),
              };
              const {
                chargeApplied,
                paymentApplied,
                refundedByPayment,
                chargePaymentHistory,
                ...summary
              } = rentBalances(scopedData, today);
              return {
                lease: resident ? { ...lease, resident: undefined, residentContact:undefined } : {...lease,resident:leasePerson(lease)},
                summary,
                ...(leaseId
                  ? {
                      charges: scopedData.charges.map((c) => ({
                        ...c,
                        ...(chargePaymentHistory.get(c.id) ?? {
                          paidAfterGraceCents: "0",
                          paidLate: false,
                          settledOn: null,
                        }),
                        ...chargeTiming(
                          c.dueOn,
                          c.graceDays,
                          today,
                          BigInt(c.amountCents) -
                            (chargeApplied.get(c.id) || 0n),
                          !!c.voidedAt,
                        ),
                        remainingCents: c.voidedAt
                          ? "0"
                          : String(
                              BigInt(c.amountCents) -
                                (chargeApplied.get(c.id) || 0n),
                            ),
                        voidReason: resident ? undefined : c.voidReason,
                        appliedCents: String(chargeApplied.get(c.id) || 0n),
                      })),
                      payments: scopedData.payments.map((p) => ({
                        ...p,
                        memo: resident ? undefined : p.memo,
                        voidReason: resident ? undefined : p.voidReason,
                        appliedCents: String(paymentApplied.get(p.id) || 0n),
                        refundedCents: String(refundedByPayment.get(p.id) || 0n),
                      })),
                      allocations: scopedData.allocations,
                      credits:scopedData.credits,
                      movements:scopedData.movements,
                    }
                  : {}),
              };
            });
            return {
              businessDate: today,
              generatedAt: new Date().toISOString(),
              accounts,
            };
          },
        );
      },
    );
  server.post<{ Params: { leaseId: string } }>(
    "/api/company/rent/:leaseId/charges",
    auth,
    (request) => {
      mutation(request, origin);
      const leaseId = assignmentId(request.params.leaseId),
        b = input(request, [
          "periodOn",
          "dueOn",
          "amount",
          "memo",
          "expectedVersion",
          "submissionKey",
        ]);
      const periodOn = date(b.periodOn, "rent month"),
        dueOn = date(b.dueOn, "due date"),
        amountCents = cents(b.amount),
        expectedVersion = version(b.expectedVersion),
        memo =
          b.memo === null || b.memo === ""
            ? null
            : boundedText(b.memo, 500, "Description");
      if (!amountCents || periodOn.getUTCDate() !== 1)
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Choose a rent month, an agreed due date, and a positive amount.",
        );
      const key = submission(b.submissionKey, [
        leaseId,
        periodOn,
        dueOn,
        amountCents,
        memo,
        expectedVersion,
      ]);
      return scoped(db, request, "finance.manage", async (tx, companyId) => {
        const lease = await lockRentLease(tx, companyId, leaseId);
        const previous = await tx.rentCharge.findFirst({
          where: {
            companyId,
            createdById: request.principal!.id,
            submissionKey: key.submissionKey,
          },
          select: { ...chargeSelect, submissionHash: true },
        });
        if (previous) {
          sameSubmission(previous.submissionHash, key.submissionHash);
          const { submissionHash, ...row } = previous;
          return row;
        }
        if (lease.version !== expectedVersion) throw conflict();
        const monthEnd = new Date(periodOn);
        monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
        monthEnd.setUTCDate(0);
        if (
          lease.status === "draft" ||
          monthEnd < lease.startsOn ||
          (lease.endsOn && periodOn > lease.endsOn)
        )
          throw new AccessError(
            409,
            "RENT_PERIOD_INVALID",
            "Post monthly rent for an active or ended lease and a month overlapping its term. The agreed due date may be before move-in.",
          );
        if (
          await tx.rentCharge.findFirst({
            where: { companyId, leaseId, periodOn, kind:"rent", voidedAt: null },
            select: { id: true },
          })
        )
          throw new AccessError(
            409,
            "RENT_ALREADY_POSTED",
            "Rent is already posted for this month. Review the existing charge before making a correction.",
          );
        const effectiveTerms=termsAt(lease,await readTermChanges(tx,companyId,[leaseId]),periodOn);
        const row = await tx.rentCharge.create({
          data: {
            companyId,
            propertyId: lease.propertyId,
            leaseId,
            createdById: request.principal!.id,
            periodOn,
            dueOn,
            amountCents,
            graceDays: effectiveTerms.graceDays,
            memo,
            ...key,
          },
          select: chargeSelect,
        });
        await audit(tx, request, companyId, row.id, "rent.charge.created", {
          leaseId,
          periodOn: periodOn.toISOString().slice(0, 10),
          amountCents,
        });
        await allocateRentCredit(tx, request, companyId, leaseId);
        return row;
      });
    },
  );
  server.post<{ Params: { leaseId: string } }>(
    "/api/company/rent/:leaseId/payments",
    auth,
    (request) => {
      mutation(request, origin);
      const leaseId = assignmentId(request.params.leaseId),
        b = input(request, ["occurredOn", "amount", "memo", "submissionKey"]),
        occurredOn = date(b.occurredOn, "payment date"),
        amountCents = cents(b.amount),
        memo =
          b.memo === null || b.memo === ""
            ? null
            : boundedText(b.memo, 500, "Memo");
      if (!amountCents)
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Payment must be greater than zero.",
        );
      const key = submission(b.submissionKey, [
        "rent-payment",
        leaseId,
        occurredOn,
        amountCents,
        memo,
      ]);
      return scoped(db, request, "finance.manage", async (tx, companyId) => {
        const lease = await lockRentLease(tx, companyId, leaseId);
        const previous = await tx.ledgerEntry.findFirst({
          where: {
            companyId,
            createdById: request.principal!.id,
            submissionKey: key.submissionKey,
          },
          select: { ...paymentSelect, submissionHash: true },
        });
        if (previous) {
          sameSubmission(previous.submissionHash, key.submissionHash);
          const { submissionHash, ...row } = previous;
          return row;
        }
        if (lease.status === "draft")
          throw new AccessError(
            409,
            "LEASE_DRAFT",
            "Activate the lease before recording rent payments.",
          );
        if (
          occurredOn.toISOString().slice(0, 10) >
          (await businessDay(tx, companyId))
        )
          throw new AccessError(
            400,
            "INVALID_INPUT",
            "Record only payments already received; choose today or an earlier date.",
          );
        const row = await tx.ledgerEntry.create({
          data: {
            companyId,
            propertyId: lease.propertyId,
            leaseId,
            createdById: request.principal!.id,
            occurredOn,
            amountCents,
            kind: "income",
            category: "rent",
            memo,
            ...key,
          },
          select: paymentSelect,
        });
        await audit(tx, request, companyId, row.id, "finance.created", {
          propertyId: lease.propertyId,
          leaseId,
          kind: "income",
        });
        await allocateRentCredit(tx, request, companyId, leaseId);
        return row;
      });
    },
  );
  server.post<{ Params: { chargeId: string } }>(
    "/api/company/rent/charges/:chargeId/void",
    auth,
    (request) => {
      mutation(request, origin);
      const chargeId = assignmentId(request.params.chargeId),
        b = input(request, ["expectedVersion", "reason"]),
        expectedVersion = version(b.expectedVersion),
        reason = boundedText(b.reason, 300, "Correction reason");
      return scoped(db, request, "finance.manage", async (tx, companyId) => {
        let previous = await tx.rentCharge.findFirst({
          where: { id: chargeId, companyId },
          select: chargeSelect,
        });
        if (!previous)
          throw new AccessError(404, "NOT_FOUND", "Charge not found.");
        await lockRentLease(tx, companyId, previous.leaseId);
        previous = await tx.rentCharge.findFirstOrThrow({
          where: { id: chargeId, companyId },
          select: chargeSelect,
        });
        if (previous.voidedAt) {
          if (previous.voidReason !== reason) throw conflict();
          return previous;
        }
        if (previous.version !== expectedVersion) throw conflict();
        if (
          await tx.rentAllocation.findFirst({
            where: { companyId, chargeId, entry: { voidedAt: null } },
            select: { id: true },
          })
        )
          throw new AccessError(
            409,
            "CHARGE_HAS_PAYMENTS",
            "This charge has payments applied. Correct those payments before voiding the charge.",
          );
        if(await tx.leaseMovement.findFirst({where:{companyId,chargeId,reversal:null},select:{id:true}}))throw new AccessError(409,"CHARGE_HAS_DEPOSIT_APPLICATION","Reverse deposit applications before correcting this charge.");
        if(await tx.leaseCredit.findFirst({where:{companyId,chargeId,reversal:null},select:{id:true}}))
          throw new AccessError(409,"CHARGE_HAS_CREDITS","Reverse the active credit notes before voiding this charge.");
        const row = await tx.rentCharge.update({
          where: { id: chargeId },
          data: {
            voidedAt: new Date(),
            voidReason: reason,
            version: { increment: 1 },
          },
          select: chargeSelect,
        });
        await audit(tx, request, companyId, chargeId, "rent.charge.voided", {
          leaseId: previous.leaseId,
        });
        return row;
      });
    },
  );
}
