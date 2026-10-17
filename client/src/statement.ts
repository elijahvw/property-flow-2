import type {MoneyMovement} from "./components/LeaseMovements";
import { moneyCell } from "./report-export";
import { leaseContext } from "./lease-links";

export type Statement = {
  generatedAt: string;
  businessDate: string;
  company: { name: string; timezone: string };
  currency: string;
  lease: {
    id: string;
    propertyId: string;
    startsOn: string;
    endsOn: string | null;
    status: string;
    property: {
      name: string;
      address: string;
      city: string;
      state: string;
      zip: string;
      countryCode: string | null;
    };
    unit: { label: string };
  };
  filters: { dateFrom: string | null; dateTo: string | null };
  basis: string;
  current: {
    rentOutstandingCents?: string;
    otherOutstandingCents?: string;
    noncashCreditCents?: string;
    depositAppliedCents?:string; refundedCents?:string;
    outstandingCents: string;
    creditCents: string;
    netCents: string;
    overdueCents: string;
    afterGraceCents: string;
    withinGraceCents: string;
    dueTodayCents: string;
    upcomingCents: string;
    paidLateChargeCount: string;
    paidAfterGraceCents: string;
  };
  period: {
    openingNetCents: string;
    chargedCents: string;
    receivedCents: string;
    noncashCreditCents?: string;
    depositAppliedCents?:string; refundedCents?:string;
    closingNetCents: string;
    laterNetCents: string;
    currentNetCents: string;
    recordCount: number;
    voidedCount: number;
  };
  items: {
    type: "charge" | "receipt" | "credit" | "credit_reversal" | "refund" | "deposit_application" | "movement_reversal";
    category?: string | null;
    dueOn?: string | null;
    description?: string | null;
    relatedId?: string | null;
    relatedReference?: string | null;
    id: string;
    reference: string;
    date: string;
    periodOn: string | null;
    amountCents: string;
    appliedCents: string;
    remainingCents: string;
    status: string;
    graceThrough: string | null;
    settledOn: string | null;
    voidedAt: string | null;
    createdAt: string;
    scheduleId: string | null;
    effectCents: string;
    runningNetCents: string;
  }[];
  allocations: {
    id: string;
    amountCents: string;
    createdAt: string;
    chargeId: string;
    chargeReference: string;
    chargeDate: string;
    receiptId: string;
    receiptReference: string;
    receiptDate: string;
    active: boolean;
  }[];
  deposit: null | {
    id: string;
    reference: string;
    dueOn: string;
    movements?:MoneyMovement[];
    receivedCents?:string;appliedCents?:string;returnedCents?:string;correctedCents?:string;
    requiredCents: string;
    heldCents: string;
    outstandingCents: string;
    excessHeldCents: string;
    pastDueCents: string;
  };
};

export const statementStatuses: Record<string, string> = {
  credit_applied: "Credit applied",
  credit_reversed: "Credit reversed",
  credit_reversal: "Credit reversal",
  settled: "Settled with credit",
  settled_deposit:"Settled from deposit",returned:"Returned",partly_returned:"Partly returned",deposit_applied:"Deposit applied",movement_corrected:"Corrected / reversed",movement_reversal:"Record correction",
  upcoming: "Future due",
  due_today: "Due today",
  within_grace: "Within grace",
  past_grace: "Past grace",
  paid: "Paid",
  paid_late: "Paid late",
  fully_applied: "Fully applied",
  partly_applied: "Partly applied",
  unapplied: "Unapplied credit",
  voided: "Voided · correction",
};

export function statementPath(
  id: string,
  resident = false,
  context: Record<string, string> = {},
) {
  const search = new URLSearchParams(context);
  return `/${resident ? "resident" : "company"}/leases/${encodeURIComponent(id)}/statement${search.size ? "?" + search : ""}`;
}

export function statementContext(params: URLSearchParams) {
  const context = leaseContext(params);
  for (const key of ["propertyId", "leaseReturn", "statementFrom"]) {
    const value = params.get(key);
    if (value) context[key] = value;
  }
  return context;
}

export function statementCsv(s: Statement) {
  const rows: Parameters<typeof import("./report-export").reportCsv>[0] = [
    ["Tenant statement", s.company.name],
    [
      "Property",
      s.lease.property.name,
      "Unit",
      s.lease.unit.label,
      "Lease ID",
      s.lease.id,
    ],
    [
      "Street address",
      s.lease.property.address,
      "City",
      s.lease.property.city,
      "State / region",
      s.lease.property.state,
      "Postal code",
      s.lease.property.zip,
    ],
    [
      "Generated at",
      s.generatedAt,
      "Business date",
      s.businessDate,
      "Timezone",
      s.company.timezone,
      "Currency",
      s.currency,
    ],
    [
      "Date from (inclusive)",
      s.filters.dateFrom ?? "All dates",
      "Date to (inclusive)",
      s.filters.dateTo ?? "All dates",
    ],
    ["Basis", s.basis],
    ["Opening net USD", moneyCell(s.period.openingNetCents)],
    ["Period charges USD", moneyCell(s.period.chargedCents)],
    ["Period receipts USD", moneyCell(s.period.receivedCents)],
    [
      "Period net noncash credits USD",
      moneyCell(s.period.noncashCreditCents ?? "0"),
    ],
    [
      "Current noncash reductions USD",
      moneyCell(s.current.noncashCreditCents ?? "0"),
    ],
    ["Period net deposit applications USD",moneyCell(s.period.depositAppliedCents??"0")],
    ["Period manual payment refunds USD",moneyCell(s.period.refundedCents??"0")],
    ["Closing net USD", moneyCell(s.period.closingNetCents)],
    ["Later-dated net activity USD", moneyCell(s.period.laterNetCents)],
    ["Current whole-lease net USD", moneyCell(s.current.netCents)],
    [
      "Current whole-lease unpaid charges USD",
      moneyCell(s.current.outstandingCents),
    ],
    [
      "Current whole-lease unapplied receipt credit USD",
      moneyCell(s.current.creditCents),
    ],
    [
      "Future due USD",
      moneyCell(s.current.upcomingCents),
      "Due today USD",
      moneyCell(s.current.dueTodayCents),
      "Within grace USD",
      moneyCell(s.current.withinGraceCents),
      "Past grace USD",
      moneyCell(s.current.afterGraceCents),
    ],
    [
      "Paid late charge count",
      s.current.paidLateChargeCount,
      "Received after grace USD",
      moneyCell(s.current.paidAfterGraceCents),
    ],
    [
      "Filtered source count",
      String(s.period.recordCount),
      "Voided source count",
      String(s.period.voidedCount),
    ],
    [],
    [
      "Source date",
      "Type",
      "Reference",
      "Source ID",
      "Rent period",
      "Original USD",
      "Net effect USD",
      "Running net USD",
      "Current status",
      "Currently applied USD",
      "Currently remaining USD",
      "Grace through",
      "Settled on",
      "Voided at (correction, not refund)",
      "Recorded at",
      "Schedule ID",
      "Category",
      "Due date",
      "Tenant-visible description",
      "Related source ID",
      "Related source reference",
    ],
    ...s.items.map((r) => [
      r.date,
      r.type,
      r.reference,
      r.id,
      r.periodOn ?? "",
      moneyCell(r.amountCents),
      moneyCell(r.effectCents),
      moneyCell(r.runningNetCents),
      statementStatuses[r.status] ?? r.status,
      moneyCell(r.appliedCents),
      moneyCell(r.remainingCents),
      r.graceThrough ?? "",
      r.settledOn ?? "",
      r.voidedAt ?? "",
      r.createdAt,
      r.scheduleId ?? "",
      r.category ?? "",
      r.dueOn ?? "",
      r.description ?? "",
      r.relatedId ?? "",
      r.relatedReference ?? "",
    ]),
    [],
    [
      "Allocation ID",
      "Receipt reference",
      "Receipt ID",
      "Receipt date",
      "Charge reference",
      "Charge ID",
      "Charge due date",
      "Allocated USD",
      "Current allocation status",
      "Recorded at",
    ],
    ...s.allocations.map((a) => [
      a.id,
      a.receiptReference,
      a.receiptId,
      a.receiptDate,
      a.chargeReference,
      a.chargeId,
      a.chargeDate,
      moneyCell(a.amountCents),
      a.active ? "Active" : "Inactive · source voided",
      a.createdAt,
    ]),
    [],
    ["Deposits · current whole lease, separate from rent"],
  ];
  if (s.deposit)
    rows.push(
      [
        "Deposit reference",
        s.deposit.reference,
        "Deposit ID",
        s.deposit.id,
        "Due date",
        s.deposit.dueOn,
      ],
      [
        "Required USD",
        moneyCell(s.deposit.requiredCents),
        "Valid receipts USD",moneyCell(s.deposit.receivedCents??s.deposit.heldCents),
        "Applied to charges USD",moneyCell(s.deposit.appliedCents??"0"),
        "Money returned USD",moneyCell(s.deposit.returnedCents??"0"),
        "Corrected receipts USD",moneyCell(s.deposit.correctedCents??"0"),
        "Recorded held USD",
        moneyCell(s.deposit.heldCents),
        "Uncollected USD",
        moneyCell(s.deposit.outstandingCents),
        "Excess held USD",
        moneyCell(s.deposit.excessHeldCents),
      ],
    );
  else rows.push(["Deposit account", "Not set up"]);
  if(s.deposit?.movements?.length)rows.push([], ["Deposit movement reference","Source ID","Kind","Effective date","Amount USD","Reason","Charge ID","Cash source ID","Cash reference","Correction ID","Correction date","Correction reason"],...s.deposit.movements.map(m=>[m.reference,m.id,m.kind,m.effectiveOn.slice(0,10),moneyCell(String(m.amountCents)),m.reason,m.chargeId||"",m.cashEntries[0]?.id||"",m.cashEntries[0]?.reference||"",m.reversal?.id||"",m.reversal?.effectiveOn.slice(0,10)||"",m.reversal?.reason||""]));
  return rows;
}
