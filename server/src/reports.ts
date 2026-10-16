import { leasePerson, leasePersonSelect } from "./lease-person.js";
import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { choice, date, scoped, type Tx } from "./operational.js";
const MAX_ROWS = 10000;
const ensureComplete = (length: number) => {
  if (length > MAX_ROWS)
    throw new AccessError(
      422,
      "REPORT_TOO_LARGE",
      "More than 10,000 records match. Narrow the report filters; no partial report was generated.",
    );
};
const day = (value: Date) => value.toISOString().slice(0, 10);
export function companyDay(timezone: string, now = new Date()) {
  const p = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => p.find((x) => x.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
async function propertyName(tx: Tx, companyId: string, propertyId?: string) {
  if (!propertyId) return null;
  const row = await tx.property.findFirst({
    where: { id: propertyId, companyId },
    select: { name: true },
  });
  if (!row) throw new AccessError(404, "NOT_FOUND", "Property not found.");
  return row.name;
}
export function registerReports(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
) {
  const auth = { preValidation: authenticate };
  server.get("/api/company/reports/context", auth, (request) =>
    scoped(db, request, "finance.manage", async (tx, companyId) => {
      const company = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { name: true, timezone: true },
      });
      return { ...company, today: companyDay(company.timezone) };
    }),
  );
  server.get<{
    Querystring: { propertyId?: string; dateFrom?: string; dateTo?: string };
  }>("/api/company/reports/cash", auth, (request) => {
    const q = request.query;
    if (
      Object.keys(q).some(
        (k) => !["propertyId", "dateFrom", "dateTo"].includes(k),
      )
    )
      throw new AccessError(400, "INVALID_INPUT", "Unknown report filter.");
    const from = date(q.dateFrom, "from date"),
      to = date(q.dateTo, "through date"),
      propertyId =
        q.propertyId === undefined ? undefined : assignmentId(q.propertyId);
    if (from > to)
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Through date must follow the from date.",
      );
    return scoped(db, request, "finance.manage", async (tx, companyId) => {
      const company = await tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { name: true, timezone: true },
      });
      const selectedProperty = await propertyName(tx, companyId, propertyId);
      const rows = await tx.ledgerEntry.findMany({
        where: {
          companyId,
          ...(propertyId ? { propertyId } : {}),
          occurredOn: { gte: from, lte: to },
        },
        select: {
          id: true,
          reference: true,
          depositReceipt:{select:{id:true,reference:true,leaseId:true}},
          propertyId: true,
          occurredOn: true,
          kind: true,
          category: true,
          currency: true,
          amountCents: true,
          memo: true,
          voidedAt: true,
          voidReason: true,
          property: { select: { name: true } },
        },
        orderBy: [{ occurredOn: "asc" }, { id: "asc" }],
        take: MAX_ROWS + 1,
      });
      ensureComplete(rows.length);
      let income = 0n,
        expense = 0n,
        deposit = 0n,
        voided = 0;
      const groups = new Map<
        string,
        {
          month: string;
          propertyId: string;
          property: string;
          kind: string;
          category: string;
          amount: bigint;
          count: number;
        }
      >();
      for (const row of rows) {
        if (row.voidedAt) {
          voided++;
          continue;
        }
        const amount = BigInt(row.amountCents);
        if (row.kind === "income") income += amount;
        else if(row.kind === "expense") expense += amount;
        else if(row.kind === "deposit") deposit += amount;
        const month = day(row.occurredOn).slice(0, 7),
          key = JSON.stringify([month, row.propertyId, row.kind, row.category]);
        const g = groups.get(key) || {
          month,
          propertyId: row.propertyId,
          property: row.property.name,
          kind: row.kind,
          category: row.category,
          amount: 0n,
          count: 0,
        };
        g.amount += amount;
        g.count++;
        groups.set(key, g);
      }
      return {
        kind: "cash" as const,
        generatedAt: new Date().toISOString(),
        company,
        currency: "USD",
        filters: {
          propertyId: propertyId || null,
          propertyName: selectedProperty,
          dateFrom: day(from),
          dateTo: day(to),
        },
        basis:
          "Recorded income, expenses and refundable security-deposit receipts. Operating net excludes deposits; cash movement includes them. Voided entries excluded at generation time.",
        summary: {
          incomeCents: String(income),
          expenseCents: String(expense),
          netCents: String(income - expense),
          depositReceivedCents: String(deposit),
          cashMovementCents: String(income - expense + deposit),
          includedCount: rows.length - voided,
          voidedCount: voided,
        },
        groups: [...groups.values()]
          .sort(
            (a, b) =>
              a.month.localeCompare(b.month) ||
              a.propertyId.localeCompare(b.propertyId) ||
              a.kind.localeCompare(b.kind) ||
              a.category.localeCompare(b.category),
          )
          .map(({ amount, ...g }) => ({ ...g, amountCents: String(amount) })),
        items: rows.map((row) => ({
          ...row,
          occurredOn: day(row.occurredOn),
          amountCents: String(row.amountCents),
        })),
      };
    });
  });
  server.get<{ Querystring: { propertyId?: string; status?: string } }>(
    "/api/company/reports/leases",
    auth,
    (request) => {
      const q = request.query;
      if (Object.keys(q).some((k) => !["propertyId", "status"].includes(k)))
        throw new AccessError(400, "INVALID_INPUT", "Unknown report filter.");
      const propertyId =
          q.propertyId === undefined ? undefined : assignmentId(q.propertyId),
        status =
          q.status === undefined
            ? undefined
            : choice(q.status, ["draft", "active", "ended"], "lease status");
      return scoped(db, request, "lease.manage", async (tx, companyId) => {
        const company = await tx.company.findUniqueOrThrow({
            where: { id: companyId },
            select: { name: true, timezone: true },
          }),
          generatedAt = new Date(),
          today = companyDay(company.timezone, generatedAt);
        const selectedProperty = await propertyName(tx, companyId, propertyId);
        const rows = await tx.lease.findMany({
          where: {
            companyId,
            ...(propertyId ? { propertyId } : {}),
            ...(status ? { status } : {}),
          },
          select: {
            id: true,
            propertyId: true,
            unitId: true,
            startsOn: true,
            endsOn: true,
            status: true,
            rentCents: true,
            currency: true,
            property: { select: { name: true } },
            unit: { select: { label: true, status: true } },
            ...leasePersonSelect,
          },
          orderBy: [
            { propertyId: "asc" },
            { unitId: "asc" },
            { startsOn: "asc" },
            { id: "asc" },
          ],
          take: MAX_ROWS + 1,
        });
        ensureComplete(rows.length);
        let rent = 0n,
          current = 0,
          future = 0,
          expired = 0;
        const items = rows.map((row) => {
          const startsOn = day(row.startsOn),
            endsOn = row.endsOn ? day(row.endsOn) : null;
          const inEffect =
            row.status === "active" &&
            row.unit.status === "active" &&
            startsOn <= today &&
            (!endsOn || endsOn >= today);
          if (inEffect) {
            current++;
            rent += BigInt(row.rentCents);
          }
          if (row.status === "active" && startsOn > today) future++;
          if (row.status === "active" && endsOn && endsOn < today) expired++;
          return {
            ...row, resident:leasePerson(row),
            startsOn,
            endsOn,
            rentCents: String(row.rentCents),
            inEffect,
          };
        });
        return {
          kind: "leases" as const,
          generatedAt: generatedAt.toISOString(),
          company,
          currency: "USD",
          today,
          filters: {
            propertyId: propertyId || null,
            propertyName: selectedProperty,
            status: status || null,
          },
          basis:
            "Current lease records and manually maintained status. Active terms are inclusive of start/end dates; this is not historical occupancy, rent collected or balances owed.",
          summary: {
            recordCount: rows.length,
            currentCount: current,
            monthlyRentCents: String(rent),
            futureActiveCount: future,
            expiredActiveCount: expired,
          },
          items,
        };
      });
    },
  );
}
