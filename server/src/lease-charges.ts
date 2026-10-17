import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import {
  allocateRentCredit,
  chargeSelect,
  creditSelect,
  lockRentLease,
  readRentSources,
  rentBalances,
} from "./rent.js";
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
import { companyDay } from "./reports.js";

const categories = ["utilities", "parking", "pet", "damage", "other"];
async function effectiveDate(tx: Tx, companyId: string, value: Date) {
  const company = await tx.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const today = companyDay(company.timezone);
  if (value.toISOString().slice(0, 10) > today)
    throw new AccessError(
      400,
      "FUTURE_ADJUSTMENT",
      "Record an effective date on or before today. A charge's due date may be in the future.",
    );
  return today;
}
function positive(amount: unknown) {
  const result = cents(amount);
  if (!result)
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Enter an amount greater than zero.",
    );
  return result;
}
export function registerLeaseCharges(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate };
  server.post<{ Params: { leaseId: string } }>(
    "/api/company/rent/:leaseId/one-time-charges",
    auth,
    (request) => {
      mutation(request, origin);
      const leaseId = assignmentId(request.params.leaseId);
      const b = input(request, [
        "category",
        "effectiveOn",
        "dueOn",
        "amount",
        "description",
        "expectedLeaseVersion",
        "submissionKey",
      ]);
      const category = choice(b.category, categories, "charge category"),
        effectiveOn = date(b.effectiveOn, "charge effective date"),
        dueOn = date(b.dueOn, "charge due date"),
        amountCents = positive(b.amount),
        memo = boundedText(b.description, 500, "Tenant-visible description"),
        expectedVersion = version(b.expectedLeaseVersion);
      const key = submission(b.submissionKey, [
        leaseId,
        category,
        effectiveOn,
        dueOn,
        amountCents,
        memo,
        expectedVersion,
      ]);
      return scoped(db, request, "finance.manage", async (tx, companyId) => {
        const lease = await lockRentLease(tx, companyId, leaseId);
        const old = await tx.rentCharge.findFirst({
          where: {
            companyId,
            createdById: request.principal!.id,
            submissionKey: key.submissionKey,
          },
          select: { ...chargeSelect, submissionHash: true },
        });
        if (old) {
          sameSubmission(old.submissionHash, key.submissionHash);
          const { submissionHash, ...row } = old;
          return row;
        }
        if (lease.version !== expectedVersion) throw conflict();
        if (lease.status === "draft")
          throw new AccessError(
            409,
            "LEASE_DRAFT",
            "Activate the lease before posting a charge.",
          );
        await effectiveDate(tx, companyId, effectiveOn);
        const periodOn = new Date(effectiveOn);
        periodOn.setUTCDate(1);
        const row = await tx.rentCharge.create({
          data: {
            companyId,
            propertyId: lease.propertyId,
            leaseId,
            createdById: request.principal!.id,
            kind: "one_time",
            category,
            effectiveOn,
            periodOn,
            dueOn,
            amountCents,
            memo,
            graceDays: 0,
            ...key,
          },
          select: chargeSelect,
        });
        await audit(tx, request, companyId, row.id, "lease.charge.created", {
          leaseId,
          category,
          effectiveOn: effectiveOn.toISOString(),
          dueOn: dueOn.toISOString(),
          amountCents,
        });
        await allocateRentCredit(tx, request, companyId, leaseId);
        return row;
      });
    },
  );
  server.post<{ Params: { leaseId: string } }>(
    "/api/company/rent/:leaseId/credits",
    auth,
    (request) => {
      mutation(request, origin);
      const leaseId = assignmentId(request.params.leaseId);
      const b = input(request, [
        "chargeId",
        "kind",
        "effectiveOn",
        "amount",
        "reason",
        "expectedChargeVersion",
        "expectedRemainingCents",
        "expectedLeaseVersion",
        "submissionKey",
      ]);
      const chargeId = assignmentId(b.chargeId),
        kind = choice(b.kind, ["credit_note", "concession"], "credit type"),
        effectiveOn = date(b.effectiveOn, "credit effective date"),
        amountCents = positive(b.amount),
        reason = boundedText(b.reason, 500, "Tenant-visible credit reason"),
        expectedChargeVersion = version(b.expectedChargeVersion),
        expectedLeaseVersion = version(b.expectedLeaseVersion);
      if (
        typeof b.expectedRemainingCents !== "string" ||
        !/^(0|[1-9][0-9]{0,8})$/.test(b.expectedRemainingCents)
      )
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Review the current unpaid charge amount.",
        );
      const expectedRemaining = b.expectedRemainingCents;
      const key = submission(b.submissionKey, [
        leaseId,
        chargeId,
        kind,
        effectiveOn,
        amountCents,
        reason,
        expectedChargeVersion,
        expectedLeaseVersion,
        expectedRemaining,
      ]);
      return scoped(db, request, "finance.manage", async (tx, companyId) => {
        const lease = await lockRentLease(tx, companyId, leaseId);
        const old = await tx.leaseCredit.findFirst({
          where: {
            companyId,
            createdById: request.principal!.id,
            submissionKey: key.submissionKey,
          },
          select: { ...creditSelect, submissionHash: true },
        });
        if (old) {
          sameSubmission(old.submissionHash, key.submissionHash);
          const { submissionHash, ...row } = old;
          return row;
        }
        if (lease.version !== expectedLeaseVersion) throw conflict();
        if (lease.status === "draft")
          throw new AccessError(
            409,
            "LEASE_DRAFT",
            "Activate the lease before recording a credit.",
          );
        const today = await effectiveDate(tx, companyId, effectiveOn);
        const sources = await readRentSources(tx, companyId, [leaseId]),
          balance = rentBalances(sources, today);
        const charge = sources.charges.find(
          (c) => c.id === chargeId && !c.voidedAt,
        );
        if (!charge)
          throw new AccessError(
            404,
            "NOT_FOUND",
            "Active charge not found on this lease.",
          );
        if (charge.version !== expectedChargeVersion) throw conflict();
        const remaining =
          BigInt(charge.amountCents) -
          (balance.chargeApplied.get(charge.id) ?? 0n);
        if (remaining !== BigInt(expectedRemaining))
          throw new AccessError(
            409,
            "BALANCE_CHANGED",
            "The unpaid amount changed. Refresh and review the credit again.",
          );
        if (BigInt(amountCents) > remaining)
          throw new AccessError(
            409,
            "CREDIT_EXCEEDS_BALANCE",
            "Credit cannot exceed the selected charge's unpaid amount. It does not create cash credit or a refund.",
          );
        const row = await tx.leaseCredit.create({
          data: {
            companyId,
            propertyId: lease.propertyId,
            leaseId,
            chargeId,
            createdById: request.principal!.id,
            kind,
            effectiveOn,
            amountCents,
            reason,
            ...key,
          },
          select: creditSelect,
        });
        await audit(tx, request, companyId, row.id, "lease.credit.created", {
          leaseId,
          chargeId,
          kind,
          amountCents,
          effectiveOn: effectiveOn.toISOString(),
        });
        return row;
      });
    },
  );
  server.post<{ Params: { leaseId: string; creditId: string } }>(
    "/api/company/rent/:leaseId/credits/:creditId/reverse",
    auth,
    (request) => {
      mutation(request, origin);
      const leaseId = assignmentId(request.params.leaseId),
        creditId = assignmentId(request.params.creditId);
      const b = input(request, [
          "effectiveOn",
          "reason",
          "expectedLeaseVersion",
          "submissionKey",
        ]),
        effectiveOn = date(b.effectiveOn, "reversal effective date"),
        reason = boundedText(b.reason, 500, "Tenant-visible reversal reason"),
        expectedVersion = version(b.expectedLeaseVersion);
      const key = submission(b.submissionKey, [
        leaseId,
        creditId,
        effectiveOn,
        reason,
        expectedVersion,
      ]);
      return scoped(db, request, "finance.manage", async (tx, companyId) => {
        const lease = await lockRentLease(tx, companyId, leaseId);
        const old = await tx.leaseCreditReversal.findFirst({
          where: {
            companyId,
            createdById: request.principal!.id,
            submissionKey: key.submissionKey,
          },
        });
        if (old) {
          sameSubmission(old.submissionHash, key.submissionHash);
          return { id: old.id, reference: old.reference };
        }
        if (lease.version !== expectedVersion) throw conflict();
        const credit = await tx.leaseCredit.findFirst({
          where: { id: creditId, companyId, leaseId },
          select: creditSelect,
        });
        if (!credit)
          throw new AccessError(
            404,
            "NOT_FOUND",
            "Credit note not found on this lease.",
          );
        if (credit.reversal)
          throw new AccessError(
            409,
            "CREDIT_ALREADY_REVERSED",
            "This credit already has a reversal. Review its history.",
          );
        await effectiveDate(tx, companyId, effectiveOn);
        if (effectiveOn < credit.effectiveOn)
          throw new AccessError(
            400,
            "INVALID_INPUT",
            "Reversal date cannot precede the original credit date.",
          );
        const row = await tx.leaseCreditReversal.create({
          data: {
            companyId,
            propertyId: lease.propertyId,
            leaseId,
            creditId,
            createdById: request.principal!.id,
            effectiveOn,
            reason,
            ...key,
          },
          select: { id: true, reference: true },
        });
        await audit(tx, request, companyId, row.id, "lease.credit.reversed", {
          leaseId,
          creditId,
          amountCents: credit.amountCents,
          effectiveOn: effectiveOn.toISOString(),
        });
        await allocateRentCredit(tx, request, companyId, leaseId);
        return row;
      });
    },
  );
}
