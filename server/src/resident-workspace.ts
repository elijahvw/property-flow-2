import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError, companyScope } from "./access.js";
import { opaqueUserId } from "./application.js";
import { depositSummary } from "./deposits.js";
import { scoped } from "./operational.js";
import { companyDay } from "./reports.js";
import { readRentSources, rentBalances } from "./rent.js";

function complete<T>(rows: T[], limit: number) {
  if (rows.length > limit)
    throw new AccessError(422, "RESIDENT_WORKSPACE_TOO_LARGE",
      "This tenant has too many records for a complete overview. Open an individual lease ledger; no partial balances are shown.");
  return rows;
}
function summary(data: Awaited<ReturnType<typeof readRentSources>>, today: string) {
  const { chargeApplied, paymentApplied, chargePaymentHistory, ...totals } = rentBalances(data, today);
  return totals;
}

export function registerResidentWorkspace(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
) {
  server.get<{ Params: { userId: string } }>(
    "/api/company/resident-profiles/:userId/workspace",
    { preValidation: authenticate },
    request => {
      const userId = opaqueUserId(request.params.userId);
      if (Object.keys(request.query as object).length)
        throw new AccessError(400, "INVALID_INPUT", "Unknown tenant workspace filter.");
      return scoped(db, request, "resident.assignment.manage", async (tx, companyId) => {
        // Do not rely on the browser's grants or the request's earlier snapshot.
        const current = await tx.user.findUniqueOrThrow({
          where: { id: request.principal!.id },
          include: { membership: { include: { company: true } } },
        });
        companyScope(current, "lease.manage", companyId);
        companyScope(current, "finance.manage", companyId);
        const member = await tx.companyMembership.findFirst({
          where: { userId, companyId, role: "resident" }, select: { userId: true },
        });
        if (!member) throw new AccessError(404, "NOT_FOUND", "Resident not found in this company.");
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } });
        const businessDate = companyDay(company.timezone);
        // Include draft/future/ended history for management, independent of portal
        // assignment. This endpoint is never used as a tenant self-service API.
        const leases = complete(await tx.lease.findMany({
          where: { companyId, residentId: userId },
          select: {
            id: true, propertyId: true, startsOn: true, endsOn: true,
            status: true, rentCents: true, rentDueDay: true, graceDays: true,
            property: { select: { name: true } }, unit: { select: { label: true } },
          },
          orderBy: [{ startsOn: "desc" }, { id: "desc" }], take: 1001,
        }), 1000);
        const leaseIds = leases.map(l => l.id);
        const data = await readRentSources(tx, companyId, leaseIds);
        const grouped = new Map(leaseIds.map(id => [id, {
          charges: [] as typeof data.charges, payments: [] as typeof data.payments,
          allocations: [] as typeof data.allocations,
        }]));
        for (const row of data.charges) grouped.get(row.leaseId)!.charges.push(row);
        for (const row of data.payments) grouped.get(row.leaseId!)!.payments.push(row);
        for (const row of data.allocations) grouped.get(row.leaseId)!.allocations.push(row);
        const deposits = complete(await tx.depositAccount.findMany({
          where: { companyId, leaseId: { in: leaseIds } },
          select: { id: true, reference: true, leaseId: true, requiredCents: true, dueOn: true }, take: 1001,
        }), 1000);
        const receipts = complete(await tx.depositReceipt.findMany({
          where: { companyId, accountId: { in: deposits.map(d => d.id) } },
          select: { accountId: true, amountCents: true, cashEntries: { select: { voidedAt: true } } },
          take: 10001,
        }), 10000);
        const held = new Map<string, bigint>();
        for (const receipt of receipts) {
          if (receipt.cashEntries.length !== 1)
            throw new AccessError(503, "DEPOSIT_SOURCE_UNAVAILABLE", "Deposit source is unavailable. No incomplete balance is shown.");
          if (!receipt.cashEntries[0].voidedAt)
            held.set(receipt.accountId, (held.get(receipt.accountId) ?? 0n) + BigInt(receipt.amountCents));
        }
        const byLease = new Map(deposits.map(d => [d.leaseId, {
          id: d.id, reference: d.reference, dueOn: d.dueOn,
          ...depositSummary(d.requiredCents, held.get(d.id) ?? 0n, d.dueOn, businessDate),
        }]));
        const depositTotals = { requiredCents: 0n, heldCents: 0n, outstandingCents: 0n, excessHeldCents: 0n, pastDueCents: 0n };
        for (const deposit of byLease.values())
          for (const key of Object.keys(depositTotals) as (keyof typeof depositTotals)[])
            depositTotals[key] += BigInt(deposit[key]);
        return {
          businessDate, timezone: company.timezone, generatedAt: new Date().toISOString(),
          rent: summary(data, businessDate),
          deposits: Object.fromEntries(Object.entries(depositTotals).map(([k, v]) => [k, String(v)])),
          leases: leases.map(lease => ({
            ...lease, rent: summary(grouped.get(lease.id)!, businessDate), deposit: byLease.get(lease.id) ?? null,
          })),
        };
      });
    },
  );
}
