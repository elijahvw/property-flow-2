import type { Tx } from "./operational.js";
import { AccessError } from "./access.js";
import { companyDay } from "./reports.js";
import { installment } from "./billing-dates.js";
export type PaymentTerms = {
  rentCents: number;
  rentDueDay: number;
  graceDays: number;
  paymentInstructions: string | null;
};
export const termSelect = {
  id: true,
  reference: true,
  leaseId: true,
  effectiveOn: true,
  rentCents: true,
  rentDueDay: true,
  graceDays: true,
  paymentInstructions: true,
  before: true,
  reason: true,
  createdAt: true,
  cancellation: { select: { id: true, reason: true, createdAt: true } },
} as const;
export async function readTermChanges(
  tx: Tx,
  companyId: string,
  leaseIds: string[],
) {
  const rows = await tx.leaseTermChange.findMany({
    where: { companyId, leaseId: { in: leaseIds } },
    select: termSelect,
    orderBy: [{ effectiveOn: "asc" }, { id: "asc" }],
    take: 1001,
  });
  if (rows.length > 1000)
    throw new AccessError(
      422,
      "TERM_SCOPE_TOO_LARGE",
      "Too many term changes for a complete view. Choose a narrower lease or property scope.",
    );
  return rows;
}
export type TermChange = Awaited<ReturnType<typeof readTermChanges>>[number];
export function termsAt(base: PaymentTerms, changes: TermChange[], on: Date) {
  const chosen = changes
    .filter((t) => !t.cancellation && t.effectiveOn <= on)
    .at(-1);
  return {
    ...(chosen
      ? {
          rentCents: chosen.rentCents,
          rentDueDay: chosen.rentDueDay,
          graceDays: chosen.graceDays,
          paymentInstructions: chosen.paymentInstructions,
        }
      : base),
    termChangeId: chosen?.id ?? null,
    effectiveOn: chosen?.effectiveOn ?? null,
  };
}
export async function currentLeaseTerms<
  T extends { id: string; rentCents: number },
>(tx: Tx, companyId: string, rows: T[], today?: string): Promise<T[]> {
  const on =
      today ??
      companyDay(
        (
          await tx.company.findUniqueOrThrow({
            where: { id: companyId },
            select: { timezone: true },
          })
        ).timezone,
      ),
    changes = await readTermChanges(
      tx,
      companyId,
      rows.map((r) => r.id),
    );
  return rows.map((row) => {
    const base = row as T & Partial<PaymentTerms>,
      t = termsAt(
        {
          rentCents: row.rentCents,
          rentDueDay: base.rentDueDay ?? 1,
          graceDays: base.graceDays ?? 0,
          paymentInstructions: base.paymentInstructions ?? null,
        },
        changes.filter((t) => t.leaseId === row.id),
        new Date(on + "T00:00:00Z"),
      );
    return {
      ...row,
      hasTermHistory: changes.some((c) => c.leaseId === row.id),
      rentCents: t.rentCents,
      ...("rentDueDay" in row ? { rentDueDay: t.rentDueDay } : {}),
      ...("graceDays" in row ? { graceDays: t.graceDays } : {}),
      ...("paymentInstructions" in row
        ? { paymentInstructions: t.paymentInstructions }
        : {}),
    };
  });
}
export function termInstallment(
  schedule: Parameters<typeof installment>[0] & {
    graceDays: number;
    paymentInstructions?: string | null;
  },
  changes: TermChange[],
  period: Date,
) {
  const t = termsAt(
    {
      rentCents: schedule.amountCents,
      rentDueDay: schedule.dueDay,
      graceDays: schedule.graceDays,
      paymentInstructions: schedule.paymentInstructions ?? null,
    },
    changes,
    period,
  );
  return {
    ...installment(
      { ...schedule, amountCents: t.rentCents, dueDay: t.rentDueDay },
      period,
    ),
    graceDays: t.graceDays,
    termChangeId: t.termChangeId,
    paymentInstructions: t.paymentInstructions,
  };
}
