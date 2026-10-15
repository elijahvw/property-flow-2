import type { FastifyInstance, preValidationHookHandler } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { lockRentLease } from "./rent.js";
import { companyDay } from "./reports.js";
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
const leaseSelect = {
  id: true,
  propertyId: true,
  residentId: true,
  status: true,
  version: true,
  startsOn: true,
  endsOn: true,
  property: { select: { name: true } },
  unit: { select: { label: true } },
  resident: { select: { name: true, email: true } },
} as const;
const accountSelect = {
  id: true,
  reference: true,
  companyId: true,
  propertyId: true,
  leaseId: true,
  requiredCents: true,
  dueOn: true,
  version: true,
  createdAt: true,
  lease: { select: leaseSelect },
} as const;
const cashSelect = {
  id: true,
  reference: true,
  amountCents: true,
  version: true,
  voidedAt: true,
  voidReason: true,
} as const;
const receiptSelect = {
  id: true,
  reference: true,
  accountId: true,
  leaseId: true,
  occurredOn: true,
  amountCents: true,
  method: true,
  paymentReference: true,
  memo: true,
  createdAt: true,
  cashEntries: { select: cashSelect },
} as const;
const revisionSelect = {
  id: true,
  accountId: true,
  version: true,
  requiredCents: true,
  dueOn: true,
  reason: true,
  createdAt: true,
} as const;
const day = (d: Date) => d.toISOString().slice(0, 10);
const optional = (v: unknown, max: number, label: string) =>
  v === undefined || v === null || v === "" ? null : boundedText(v, max, label);
function complete<T>(rows: T[], limit: number) {
  if (rows.length > limit)
    throw new AccessError(
      422,
      "DEPOSIT_SCOPE_TOO_LARGE",
      "Too many deposit records. Choose a property or lease; no partial totals are shown.",
    );
  return rows;
}
async function today(tx: Tx, companyId: string) {
  const company = await tx.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  return companyDay(company.timezone);
}
function leaseWhere(
  companyId: string,
  residentId?: string,
): Prisma.LeaseWhereInput {
  return {
    companyId,
    ...(residentId
      ? {
          residentId,
          status: { not: "draft" },
          property: {
            assignments: { some: { companyId, userId: residentId } },
          },
        }
      : {}),
  };
}
async function visibleLease(
  tx: Tx,
  companyId: string,
  id: string,
  residentId?: string,
) {
  const row = await tx.lease.findFirst({
    where: { ...leaseWhere(companyId, residentId), id },
    select: leaseSelect,
  });
  if (!row)
    throw new AccessError(
      404,
      "NOT_FOUND",
      "Lease not found in your current workspace.",
    );
  return residentId ? { ...row, resident: undefined } : row;
}
export function depositSummary(
  requiredCents: number,
  held: bigint,
  dueOn: Date,
  businessDate: string,
) {
  const required = BigInt(requiredCents),
    outstanding = required > held ? required - held : 0n;
  return {
    requiredCents: String(required),
    heldCents: String(held),
    outstandingCents: String(outstanding),
    excessHeldCents: String(held > required ? held - required : 0n),
    pastDueCents: day(dueOn) < businessDate ? String(outstanding) : "0",
  };
}
async function account(tx: Tx, companyId: string, leaseId: string) {
  const row = await tx.depositAccount.findFirst({
    where: { companyId, leaseId },
    select: accountSelect,
  });
  if (!row)
    throw new AccessError(
      404,
      "NOT_FOUND",
      "Set up a security deposit for this lease first.",
    );
  return row;
}
function publicReceipt(
  row: Prisma.DepositReceiptGetPayload<{ select: typeof receiptSelect }>,
  resident: boolean,
) {
  const { cashEntries, ...receipt } = row;
  const cash = cashEntries[0];
  if (!cash)
    throw new AccessError(
      503,
      "DEPOSIT_SOURCE_UNAVAILABLE",
      "Deposit source is unavailable. No incomplete balance is shown.",
    );
  return {
    ...receipt,
    paymentReference: resident ? undefined : receipt.paymentReference,
    memo: resident ? undefined : receipt.memo,
    cashEntry: { ...cash, voidReason: resident ? undefined : cash.voidReason },
  };
}
async function detail(
  tx: Tx,
  companyId: string,
  leaseId: string,
  residentId?: string,
  propertyId?: string,
) {
  const lease = await visibleLease(tx, companyId, leaseId, residentId);
  if (propertyId && lease.propertyId !== propertyId)
    throw new AccessError(
      404,
      "NOT_FOUND",
      "Lease not found in this property workspace.",
    );
  const businessDate = await today(tx, companyId);
  const current = await tx.depositAccount.findFirst({
    where: { companyId, leaseId },
    select: accountSelect,
  });
  if (!current) return { businessDate, lease, account: null };
  const receipts = complete(
    await tx.depositReceipt.findMany({
      where: { companyId, accountId: current.id },
      select: receiptSelect,
      orderBy: [{ occurredOn: "desc" }, { id: "desc" }],
      take: 10001,
    }),
    10000,
  ).map((r) => publicReceipt(r, !!residentId));
  const held = receipts.reduce(
    (sum, r) => sum + (r.cashEntry.voidedAt ? 0n : BigInt(r.amountCents)),
    0n,
  );
  const revisions = residentId
    ? undefined
    : await tx.depositRevision.findMany({
        where: { companyId, accountId: current.id },
        select: revisionSelect,
        orderBy: { version: "desc" },
        take: 100,
      });
  return {
    businessDate,
    lease,
    account: {
      ...current,
      lease: undefined,
      summary: depositSummary(
        current.requiredCents,
        held,
        current.dueOn,
        businessDate,
      ),
      receipts,
      revisions,
    },
  };
}
export function registerDeposits(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate };
  for (const resident of [false, true]) {
    const root = resident ? "/api/resident/deposits" : "/api/company/deposits",
      permission = resident
        ? ("resident.self" as const)
        : ("finance.manage" as const);
    server.get<{
      Params: { leaseId: string };
      Querystring: { propertyId?: string };
    }>(root + "/:leaseId", auth, (request) => {
      if (Object.keys(request.query).some((k) => k !== "propertyId"))
        throw new AccessError(400, "INVALID_INPUT", "Unknown deposit filter.");
      const leaseId = assignmentId(request.params.leaseId),
        propertyId =
          request.query.propertyId === undefined
            ? undefined
            : assignmentId(request.query.propertyId);
      return scoped(db, request, permission, (tx, companyId) =>
        detail(
          tx,
          companyId,
          leaseId,
          resident ? request.principal!.id : undefined,
          propertyId,
        ),
      );
    });
    server.get<{ Querystring: { propertyId?: string } }>(
      root,
      auth,
      (request) => {
        if (Object.keys(request.query).some((k) => k !== "propertyId"))
          throw new AccessError(
            400,
            "INVALID_INPUT",
            "Unknown deposit filter.",
          );
        const propertyId =
          request.query.propertyId === undefined
            ? undefined
            : assignmentId(request.query.propertyId);
        return scoped(db, request, permission, async (tx, companyId) => {
          if (
            propertyId &&
            !resident &&
            !(await tx.property.findFirst({
              where: { id: propertyId, companyId },
              select: { id: true },
            }))
          )
            throw new AccessError(404, "NOT_FOUND", "Property not found.");
          const businessDate = await today(tx, companyId);
          const accounts = complete(
            await tx.depositAccount.findMany({
              where: {
                companyId,
                ...(propertyId ? { propertyId } : {}),
                lease: leaseWhere(
                  companyId,
                  resident ? request.principal!.id : undefined,
                ),
              },
              select: accountSelect,
              orderBy: { id: "desc" },
              take: 1001,
            }),
            1000,
          );
          const receipts = complete(
            await tx.depositReceipt.findMany({
              where: {
                companyId,
                accountId: { in: accounts.map((a) => a.id) },
              },
              select: {
                accountId: true,
                amountCents: true,
                cashEntries: { select: { voidedAt: true } },
              },
              take: 10001,
            }),
            10000,
          );
          const held = new Map<string, bigint>();
          for (const r of receipts) {
            if (r.cashEntries.length !== 1)
              throw new AccessError(
                503,
                "DEPOSIT_SOURCE_UNAVAILABLE",
                "Deposit source is unavailable. No incomplete balance is shown.",
              );
            if (!r.cashEntries[0].voidedAt)
              held.set(
                r.accountId,
                (held.get(r.accountId) || 0n) + BigInt(r.amountCents),
              );
          }
          const rows = accounts.map((a) => ({
            ...a,
            lease: resident ? { ...a.lease, resident: undefined } : a.lease,
            summary: depositSummary(
              a.requiredCents,
              held.get(a.id) || 0n,
              a.dueOn,
              businessDate,
            ),
          }));
          const total = {
            requiredCents: 0n,
            heldCents: 0n,
            outstandingCents: 0n,
            excessHeldCents: 0n,
            pastDueCents: 0n,
          };
          for (const r of rows)
            for (const k of Object.keys(total) as (keyof typeof total)[])
              total[k] += BigInt(r.summary[k]);
          return {
            businessDate,
            generatedAt: new Date().toISOString(),
            accounts: rows,
            summary: Object.fromEntries(
              Object.entries(total).map(([k, v]) => [k, String(v)]),
            ),
          };
        });
      },
    );
  }
  server.post<{ Params: { leaseId: string } }>(
    "/api/company/deposits/:leaseId",
    auth,
    (request) => {
      mutation(request, origin);
      const leaseId = assignmentId(request.params.leaseId),
        b = input(request, [
          "amount",
          "dueOn",
          "expectedLeaseVersion",
          "submissionKey",
        ]),
        requiredCents = cents(b.amount),
        dueOn = date(b.dueOn, "deposit due date"),
        expected = version(b.expectedLeaseVersion);
      if (!requiredCents)
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "A new deposit requirement must be greater than zero.",
        );
      const key = submission(b.submissionKey, [
        "deposit.setup",
        leaseId,
        requiredCents,
        dueOn,
        expected,
      ]);
      return scoped(db, request, "finance.manage", async (tx, companyId) => {
        const previous = await tx.depositAccount.findFirst({
          where: {
            companyId,
            createdById: request.principal!.id,
            submissionKey: key.submissionKey,
          },
          select: { ...accountSelect, submissionHash: true },
        });
        if (previous) {
          sameSubmission(previous.submissionHash, key.submissionHash);
          const { submissionHash: _hash, ...row } = previous;
          return row;
        }
        const lease = await lockRentLease(tx, companyId, leaseId);
        if (lease.version !== expected) throw conflict();
        if (
          await tx.depositAccount.findFirst({
            where: { companyId, leaseId },
            select: { id: true },
          })
        )
          throw new AccessError(
            409,
            "DEPOSIT_EXISTS",
            "This lease already has a deposit account. Review its current requirement.",
          );
        const row = await tx.depositAccount.create({
          data: {
            companyId,
            propertyId: lease.propertyId,
            leaseId,
            createdById: request.principal!.id,
            requiredCents,
            dueOn,
            ...key,
          },
          select: accountSelect,
        });
        await tx.depositRevision.create({
          data: {
            companyId,
            accountId: row.id,
            createdById: request.principal!.id,
            version: 1,
            requiredCents,
            dueOn,
            reason: "Initial deposit requirement",
            ...key,
          },
        });
        await audit(tx, request, companyId, row.id, "deposit.created", {
          leaseId,
          requiredCents,
          dueOn: day(dueOn),
          reference: row.reference,
        });
        return row;
      });
    },
  );
  server.patch<{ Params: { leaseId: string } }>(
    "/api/company/deposits/:leaseId",
    auth,
    (request) => {
      mutation(request, origin);
      const leaseId = assignmentId(request.params.leaseId),
        b = input(request, [
          "amount",
          "dueOn",
          "reason",
          "expectedVersion",
          "expectedLeaseVersion",
          "submissionKey",
        ]),
        requiredCents = cents(b.amount),
        dueOn = date(b.dueOn, "deposit due date"),
        reason = boundedText(b.reason, 300, "Reason for changing the deposit"),
        expected = version(b.expectedVersion),
        expectedLease = version(b.expectedLeaseVersion),
        key = submission(b.submissionKey, [
          "deposit.change",
          leaseId,
          requiredCents,
          dueOn,
          reason,
          expected,
          expectedLease,
        ]);
      return scoped(db, request, "finance.manage", async (tx, companyId) => {
        const previous = await tx.depositRevision.findFirst({
          where: {
            companyId,
            createdById: request.principal!.id,
            submissionKey: key.submissionKey,
          },
          select: { ...revisionSelect, submissionHash: true },
        });
        if (previous) {
          sameSubmission(previous.submissionHash, key.submissionHash);
          const { submissionHash: _hash, ...row } = previous;
          return row;
        }
        const lease = await lockRentLease(tx, companyId, leaseId),
          current = await account(tx, companyId, leaseId);
        if (lease.version !== expectedLease || current.version !== expected)
          throw conflict();
        await tx.depositAccount.update({
          where: { id: current.id },
          data: { requiredCents, dueOn, version: { increment: 1 } },
        });
        const row = await tx.depositRevision.create({
          data: {
            companyId,
            accountId: current.id,
            createdById: request.principal!.id,
            version: expected + 1,
            requiredCents,
            dueOn,
            reason,
            ...key,
          },
          select: revisionSelect,
        });
        await audit(
          tx,
          request,
          companyId,
          current.id,
          "deposit.requirement.updated",
          {
            leaseId,
            from: {
              requiredCents: current.requiredCents,
              dueOn: day(current.dueOn),
              version: expected,
            },
            to: { requiredCents, dueOn: day(dueOn), version: row.version },
            reason,
          },
        );
        return row;
      });
    },
  );
  server.post<{ Params: { leaseId: string } }>(
    "/api/company/deposits/:leaseId/receipts",
    auth,
    (request) => {
      mutation(request, origin);
      const leaseId = assignmentId(request.params.leaseId),
        b = input(request, [
          "amount",
          "occurredOn",
          "method",
          "paymentReference",
          "memo",
          "expectedVersion",
          "expectedLeaseVersion",
          "submissionKey",
        ]),
        amountCents = cents(b.amount),
        occurredOn = date(b.occurredOn, "received date"),
        method = choice(
          b.method,
          ["bank_transfer", "cash", "check", "other"],
          "payment method",
        ),
        paymentReference = optional(
          b.paymentReference,
          100,
          "Payment reference",
        ),
        memo = optional(b.memo, 500, "Internal receipt note"),
        expected = version(b.expectedVersion),
        expectedLease = version(b.expectedLeaseVersion);
      if (!amountCents)
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Amount received must be greater than zero.",
        );
      const key = submission(b.submissionKey, [
        "deposit.receipt",
        leaseId,
        amountCents,
        occurredOn,
        method,
        paymentReference,
        memo,
        expected,
        expectedLease,
      ]);
      return scoped(db, request, "finance.manage", async (tx, companyId) => {
        const previous = await tx.depositReceipt.findFirst({
          where: {
            companyId,
            createdById: request.principal!.id,
            submissionKey: key.submissionKey,
          },
          select: { ...receiptSelect, submissionHash: true },
        });
        if (previous) {
          sameSubmission(previous.submissionHash, key.submissionHash);
          return publicReceipt(previous, false);
        }
        const lease = await lockRentLease(tx, companyId, leaseId),
          current = await account(tx, companyId, leaseId);
        if (lease.version !== expectedLease || current.version !== expected)
          throw conflict();
        if (lease.status === "draft")
          throw new AccessError(
            409,
            "DEPOSIT_DRAFT_LEASE",
            "Activate the lease record before recording money received. A future lease can still receive a deposit before move-in.",
          );
        if (day(occurredOn) > (await today(tx, companyId)))
          throw new AccessError(
            400,
            "FUTURE_RECEIPT",
            "Record the date money was actually received, not a future payment.",
          );
        const row = await tx.depositReceipt.create({
          data: {
            companyId,
            propertyId: lease.propertyId,
            leaseId,
            accountId: current.id,
            createdById: request.principal!.id,
            occurredOn,
            amountCents,
            method,
            paymentReference,
            memo,
            ...key,
          },
          select: receiptSelect,
        });
        const cashEntry = await tx.ledgerEntry.create({
          data: {
            companyId,
            propertyId: lease.propertyId,
            depositReceiptId: row.id,
            createdById: request.principal!.id,
            occurredOn,
            amountCents,
            kind: "deposit",
            category: "security_deposit",
            memo: `Security deposit received · ${row.reference}`,
            ...key,
          },
          select: cashSelect,
        });
        await audit(
          tx,
          request,
          companyId,
          row.id,
          "deposit.receipt.recorded",
          {
            leaseId,
            accountId: current.id,
            amountCents,
            reference: row.reference,
            cashEntryId: cashEntry.id,
            cashReference: cashEntry.reference,
          },
        );
        return publicReceipt({ ...row, cashEntries: [cashEntry] }, false);
      });
    },
  );
  server.post<{ Params: { receiptId: string } }>(
    "/api/company/deposit-receipts/:receiptId/void",
    auth,
    (request) => {
      mutation(request, origin);
      const receiptId = assignmentId(request.params.receiptId),
        b = input(request, ["expectedVersion", "reason"]),
        expected = version(b.expectedVersion),
        reason = boundedText(b.reason, 300, "Correction reason");
      return scoped(db, request, "finance.manage", async (tx, companyId) => {
        const first = await tx.depositReceipt.findFirst({
          where: { id: receiptId, companyId },
          select: { leaseId: true },
        });
        if (!first)
          throw new AccessError(404, "NOT_FOUND", "Deposit receipt not found.");
        await lockRentLease(tx, companyId, first.leaseId);
        const row = await tx.depositReceipt.findFirstOrThrow({
          where: { id: receiptId, companyId },
          select: receiptSelect,
        });
        const cash = row.cashEntries[0];
        if (!cash)
          throw new AccessError(
            503,
            "DEPOSIT_SOURCE_UNAVAILABLE",
            "Linked receipt source is unavailable.",
          );
        if (cash.voidedAt) {
          if (cash.voidReason !== reason) throw conflict();
          return publicReceipt(row, false);
        }
        if (cash.version !== expected) throw conflict();
        await tx.ledgerEntry.update({
          where: { id: cash.id },
          data: {
            voidedAt: new Date(),
            voidReason: reason,
            version: { increment: 1 },
          },
        });
        await audit(tx, request, companyId, row.id, "deposit.receipt.voided", {
          leaseId: first.leaseId,
          accountId: row.accountId,
          cashEntryId: cash.id,
          reason,
        });
        return publicReceipt(
          await tx.depositReceipt.findFirstOrThrow({
            where: { id: receiptId, companyId },
            select: receiptSelect,
          }),
          false,
        );
      });
    },
  );
}
