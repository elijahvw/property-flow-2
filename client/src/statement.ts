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
    closingNetCents: string;
    laterNetCents: string;
    currentNetCents: string;
    recordCount: number;
    voidedCount: number;
  };
  items: {
    type: "charge" | "receipt";
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
    requiredCents: string;
    heldCents: string;
    outstandingCents: string;
    excessHeldCents: string;
    pastDueCents: string;
  };
};

export const statementStatuses: Record<string, string> = {
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
    ["Closing net USD", moneyCell(s.period.closingNetCents)],
    ["Later-dated net activity USD", moneyCell(s.period.laterNetCents)],
    ["Current whole-lease net USD", moneyCell(s.current.netCents)],
    [
      "Current whole-lease unpaid rent USD",
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
        "Recorded held USD",
        moneyCell(s.deposit.heldCents),
        "Uncollected USD",
        moneyCell(s.deposit.outstandingCents),
        "Excess held USD",
        moneyCell(s.deposit.excessHeldCents),
      ],
    );
  else rows.push(["Deposit account", "Not set up"]);
  return rows;
}
