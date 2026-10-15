import { Prisma } from "@prisma/client";
import type { Tx } from "./operational.js";
// Complete dashboard aggregate, independent of the account view's display/read caps.
export async function rentCollections(
  tx: Tx,
  companyId: string,
  today: string,
  propertyId?: string,
) {
  const day = new Date(today + "T00:00:00Z");
  const [row] = await tx.$queryRaw<
    {
      pastDue: bigint;
      afterGrace: bigint;
      withinGrace: bigint;
      pastDueLeases: number;
      afterGraceLeases: number;
    }[]
  >(Prisma.sql`
    WITH applied AS (
      SELECT a."chargeId", SUM(a."amountCents") amount
      FROM "RentAllocation" a JOIN "LedgerEntry" p ON p.id=a."entryId" AND p."companyId"=a."companyId"
      WHERE a."companyId"=${companyId} AND p."voidedAt" IS NULL
      GROUP BY a."chargeId"
    ), balances AS (
      SELECT c."leaseId", c."dueOn", c."graceDays", c."amountCents"-COALESCE(a.amount,0) remaining
      FROM "RentCharge" c LEFT JOIN applied a ON a."chargeId"=c.id
      WHERE c."companyId"=${companyId} AND c."voidedAt" IS NULL ${propertyId ? Prisma.sql`AND c."propertyId"=${propertyId}` : Prisma.empty}
    ) SELECT
      COALESCE(SUM(remaining) FILTER (WHERE "dueOn"<${day}::date),0)::bigint "pastDue",
      COALESCE(SUM(remaining) FILTER (WHERE "dueOn"+"graceDays"<${day}::date),0)::bigint "afterGrace",
      COALESCE(SUM(remaining) FILTER (WHERE "dueOn"<${day}::date AND "dueOn"+"graceDays">=${day}::date),0)::bigint "withinGrace",
      COUNT(DISTINCT "leaseId") FILTER (WHERE remaining>0 AND "dueOn"<${day}::date)::int "pastDueLeases",
      COUNT(DISTINCT "leaseId") FILTER (WHERE remaining>0 AND "dueOn"+"graceDays"<${day}::date)::int "afterGraceLeases"
    FROM balances`);
  return {
    pastDueCents: String(row.pastDue),
    afterGraceCents: String(row.afterGrace),
    withinGraceCents: String(row.withinGrace),
    pastDueLeaseCount: row.pastDueLeases,
    afterGraceLeaseCount: row.afterGraceLeases,
  };
}
