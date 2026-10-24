import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { date, scoped, type Tx } from "./operational.js";
import { companyDay } from "./reports.js";

const MAX_ROWS = 10000;
const isoDay = (value: Date) => value.toISOString().slice(0, 10);
const sourceSelect = {
  id: true, reference: true, propertyId: true, occurredOn: true,
  kind: true, category: true, currency: true, amountCents: true, memo: true,
  createdAt: true, voidedAt: true, voidReason: true,
  property: { select: { name: true } },
  movement: { select: { id: true, leaseId: true, reference: true, kind: true } },
  depositReceipt: { select: { id: true, reference: true, leaseId: true } },
} as const;
type Source = Prisma.LedgerEntryGetPayload<{ select: typeof sourceSelect }>;
const amountKeys = ["incomeCents", "expenseCents", "rentRefundCents", "depositReceivedCents", "depositRefundCents", "netCents", "cashMovementCents"] as const;

export function summarizeHistoricalCash(rows: Source[], cutoff: Date) {
  let income = 0n, expense = 0n, rentRefund = 0n, deposit = 0n, depositRefund = 0n, voided = 0;
  const groups = new Map<string, { month: string; propertyId: string; property: string; kind: string; category: string; amount: bigint; count: number }>();
  const items = rows.map(row => {
    const excluded = row.voidedAt !== null && row.voidedAt.getTime() < cutoff.getTime();
    if (excluded) voided++;
    else {
      const amount = BigInt(row.amountCents);
      if (row.kind === "income") income += amount;
      else if (row.kind === "expense") expense += amount;
      else if (row.kind === "deposit") deposit += amount;
      else if (row.kind === "refund" && row.category === "rent") rentRefund += amount;
      else if (row.kind === "refund") depositRefund += amount;
      const month = isoDay(row.occurredOn).slice(0, 7), key = JSON.stringify([month, row.propertyId, row.kind, row.category]);
      const group = groups.get(key) ?? { month, propertyId: row.propertyId, property: row.property.name, kind: row.kind, category: row.category, amount: 0n, count: 0 };
      group.amount += amount; group.count++; groups.set(key, group);
    }
    return {
      id: row.id, reference: row.reference, propertyId: row.propertyId, property: row.property,
      occurredOn: isoDay(row.occurredOn), recordedAt: row.createdAt.toISOString(),
      kind: row.kind, category: row.category, currency: row.currency, amountCents: String(row.amountCents), memo: row.memo,
      included: !excluded,
      // Later corrections must not rewrite or reveal the state represented by
      // this report. The source link still opens the current operational record.
      voidedAt: excluded ? row.voidedAt!.toISOString() : null,
      voidReason: excluded ? row.voidReason : null,
      movement: row.movement, depositReceipt: row.depositReceipt,
    };
  });
  return {
    summary: {
      incomeCents: String(income), expenseCents: String(expense), rentRefundCents: String(rentRefund),
      depositReceivedCents: String(deposit), depositRefundCents: String(depositRefund),
      netCents: String(income - expense - rentRefund),
      cashMovementCents: String(income - expense - rentRefund + deposit - depositRefund),
      includedCount: rows.length - voided, voidedCount: voided,
    },
    groups: [...groups.values()].sort((a, b) => a.month.localeCompare(b.month) || a.propertyId.localeCompare(b.propertyId) || a.kind.localeCompare(b.kind) || a.category.localeCompare(b.category)).map(({ amount, ...group }) => ({ ...group, amountCents: String(amount) })),
    items,
  };
}

async function period(tx: Tx, companyId: string, propertyId: string | undefined, from: Date, to: Date, cutoff: Date) {
  const rows = await tx.ledgerEntry.findMany({
    where: { companyId, ...(propertyId ? { propertyId } : {}), occurredOn: { gte: from, lte: to }, createdAt: { lt: cutoff } },
    select: sourceSelect, orderBy: [{ occurredOn: "asc" }, { id: "asc" }], take: MAX_ROWS + 1,
  });
  if (rows.length > MAX_ROWS) throw new AccessError(422, "REPORT_TOO_LARGE", "More than 10,000 known source records match a report period. Narrow the dates or property; no partial report was generated.");
  return { dateFrom: isoDay(from), dateTo: isoDay(to), ...summarizeHistoricalCash(rows, cutoff) };
}

export function registerHistoricalCashReports(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler) {
  server.get<{ Querystring: Record<string, unknown> }>("/api/company/reports/historical-cash", { preValidation: authenticate }, request => {
    const q = request.query;
    if (Object.keys(q).some(key => !["propertyId", "dateFrom", "dateTo", "asOf", "compareFrom", "compareTo"].includes(key)))
      throw new AccessError(400, "INVALID_INPUT", "Choose only the report's property, business dates, recording date and comparison dates.");
    const from = date(q.dateFrom, "business start date"), to = date(q.dateTo, "business end date"), asOf = date(q.asOf, "recording cutoff date");
    const propertyId = q.propertyId === undefined || q.propertyId === "" ? undefined : assignmentId(q.propertyId);
    const comparing = q.compareFrom !== undefined || q.compareTo !== undefined;
    const compareFrom = comparing ? date(q.compareFrom, "comparison start date") : null, compareTo = comparing ? date(q.compareTo, "comparison end date") : null;
    if (from > to || compareFrom && compareTo && compareFrom > compareTo)
      throw new AccessError(400, "INVALID_INPUT", "Each through date must follow its start date.");
    return scoped(db, request, "finance.manage", async (tx, companyId) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { name: true, timezone: true } });
      if (isoDay(asOf) > companyDay(company.timezone)) throw new AccessError(400, "INVALID_INPUT", "The recording cutoff cannot be a future company date.");
      const property = propertyId ? await tx.property.findFirst({ where: { companyId, id: propertyId }, select: { name: true } }) : null;
      if (propertyId && !property) throw new AccessError(404, "NOT_FOUND", "Property not found.");
      // PostgreSQL resolves the company's actual next midnight, including DST.
      // Today's report is capped at this transaction's generation time rather
      // than claiming knowledge of records that have not yet been recorded.
      const [clock] = await tx.$queryRaw<{ cutoff: Date; generated: Date }[]>`SELECT LEAST(((${isoDay(asOf)}::date + 1)::timestamp AT TIME ZONE ${company.timezone}), transaction_timestamp()) AS cutoff, transaction_timestamp() AS generated`;
      const primary = await period(tx, companyId, propertyId, from, to, clock.cutoff);
      const comparison = compareFrom && compareTo ? await period(tx, companyId, propertyId, compareFrom, compareTo, clock.cutoff) : null;
      const delta = comparison ? Object.fromEntries(amountKeys.map(key => [key, String(BigInt(primary.summary[key]) - BigInt(comparison.summary[key]))])) : null;
      return {
        kind: "historical_cash" as const, generatedAt: clock.generated.toISOString(), company, currency: "USD",
        filters: { propertyId: propertyId ?? null, propertyName: property?.name ?? null, dateFrom: isoDay(from), dateTo: isoDay(to), asOf: isoDay(asOf), compareFrom: compareFrom ? isoDay(compareFrom) : null, compareTo: compareTo ? isoDay(compareTo) : null },
        knowledgeCutoffExclusive: clock.cutoff.toISOString(),
        basis: "Cash source dates select the business period; creation and correction timestamps determine what was recorded by the selected company date. Later backdated entries and later voids do not rewrite that recorded state. Today is limited to the generation time. The company timezone setting and company/property labels are current, rather than reconstructed historical metadata. Operating net excludes refundable deposits and deposit returns; these are recorded cash sources, not bank reconciliation, accounting profit or historical lease balances.",
        primary, comparison, delta,
      };
    });
  });
}
