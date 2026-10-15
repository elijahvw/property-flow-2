import { RentSchedule } from "./RentSchedule";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { scheduledDueDate, graceDates } from "../rent-policy";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import {
  PropertyNavigation,
  propertyLink,
} from "../components/PropertyNavigation";
import { EditorDialog } from "../components/EditorDialog";
import { DraftReset } from "../components/DraftReset";
import { Form } from "./Workspace";
import { dollars } from "./Finances";
import { downloadReport, moneyCell } from "../report-export";
type Summary = {
  paidAfterGraceCents?: string;
  paidLateChargeCount?: string;
  afterGraceCents: string;
  withinGraceCents: string;
  dueTodayCents: string;
  upcomingCents: string;
  age1To30Cents: string;
  age31To60Cents: string;
  age61To90Cents: string;
  age91PlusCents: string;
  chargedCents: string;
  paidCents: string;
  outstandingCents: string;
  overdueCents: string;
  creditCents: string;
  netCents: string;
};
type Entry = {
  id: string;
  amountCents: number;
  appliedCents: string;
  memo?: string | null;
  version: number;
  voidedAt: string | null;
  voidReason?: string | null;
  createdAt: string;
  periodOn?: string;
  dueOn?: string;
  occurredOn?: string;
  graceDays?: number;
  graceThrough?: string;
  afterGraceOn?: string;
  daysPastDue?: number;
  collectionStatus?: string;
  remainingCents?: string;
  paidLate?: boolean;
  settledOn?: string | null;
  paidAfterGraceCents?: string;
};
type Account = {
  lease: {
    rentDueDay?: number;
    graceDays?: number;
    paymentInstructions?: string | null;
    id: string;
    propertyId: string;
    property: { name: string };
    unit: { label: string };
    resident?: { name: string | null; email: string };
    startsOn: string;
    endsOn: string | null;
    rentCents: number;
    status: string;
    version: number;
  };
  summary: Summary;
  charges?: Entry[];
  payments?: Entry[];
  allocations?: {
    id: string;
    chargeId: string;
    entryId: string;
    amountCents: number;
  }[];
};
type RentData = {
  businessDate: string;
  generatedAt: string;
  accounts: Account[];
};
function Load({ error, retry }: { error?: string; retry: () => void }) {
  return error ? (
    <div className="notice error" role="alert">
      <p>{error}</p>
      <button className="secondary" onClick={retry}>
        Try again
      </button>
    </div>
  ) : (
    <p role="status">Loading rent records…</p>
  );
}
function Metrics({ summary }: { summary: Summary }) {
  return (
    <div
      className="rent-metrics"
      role="region"
      aria-label="Rent balance summary"
    >
      <div>
        <span>Unpaid charges</span>
        <strong>{dollars(summary.outstandingCents)}</strong>
        <small>{dollars(summary.overdueCents)} past due</small>
      </div>
      <div>
        <span>Past grace</span>
        <strong>{dollars(summary.afterGraceCents)}</strong>
        <small>{dollars(summary.withinGraceCents)} past due within grace</small>
      </div>
      <div>
        <span>Unapplied credit</span>
        <strong>{dollars(summary.creditCents)}</strong>
        <small>Automatically applied to new charges</small>
      </div>
    </div>
  );
}
function PaymentStanding({ summary }: { summary: Summary }) {
  return (
    <p className="payment-standing">
      <strong>
        {BigInt(summary.overdueCents) > 0n
          ? "Past-due rent remains"
          : BigInt(summary.chargedCents) > 0n
            ? "Up to date — no past-due rent"
            : "No posted rent yet"}
      </strong>
      {BigInt(summary.paidLateChargeCount ?? "0") > 0n && (
        <span>
          {" "}
          · {summary.paidLateChargeCount}{" "}
          {summary.paidLateChargeCount === "1" ? "charge" : "charges"} paid
          late; history retained.
        </span>
      )}
    </p>
  );
}
export function Rent({ resident = false }: { resident?: boolean }) {
  const { data } = useAuth(),
    [params] = useSearchParams();
  return (
    <RentWorkspace
      key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}:${params.get("propertyId") || ""}:${params.get("leaseId") || ""}`}
      resident={resident}
    />
  );
}
function RentWorkspace({ resident }: { resident: boolean }) {
  const [params, setParams] = useSearchParams(),
    propertyId = params.get("propertyId") || "",
    leaseId = params.get("leaseId") || "";
  const [search, setSearch] = useState(""),
    [view, setView] = useState(
      [
        "paid_late",
        "past_due",
        "after_grace",
        "within_grace",
        "due_today",
        "unpaid",
        "credit",
        "all",
      ].includes(params.get("view") || "")
        ? params.get("view")!
        : "all",
    ),
    [age, setAge] = useState("all"),
    [listPage, setListPage] = useState(0);
  const query = new URLSearchParams({
    ...(propertyId ? { propertyId } : {}),
    ...(leaseId ? { leaseId } : {}),
  });
  const r = useResource<RentData>(
    `/api/${resident ? "resident" : "company"}/rent?${query}`,
    true,
    true,
  );
  const account = r.data?.accounts[0];
  const list =
    r.data?.accounts.filter(
      (a) =>
        `${a.lease.property.name} ${a.lease.unit.label} ${a.lease.resident?.name || ""} ${a.lease.resident?.email || ""}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (view === "all" ||
          (view === "paid_late" &&
            BigInt(a.summary.paidLateChargeCount ?? "0") > 0n) ||
          (view === "unpaid" && BigInt(a.summary.outstandingCents) > 0n) ||
          (view === "credit" && BigInt(a.summary.creditCents) > 0n) ||
          (view === "past_due" && BigInt(a.summary.overdueCents) > 0n) ||
          (view === "after_grace" && BigInt(a.summary.afterGraceCents) > 0n) ||
          (view === "within_grace" &&
            BigInt(a.summary.withinGraceCents) > 0n) ||
          (view === "due_today" && BigInt(a.summary.dueTodayCents) > 0n)) &&
        (age === "all" || BigInt(a.summary[age as keyof Summary] ?? "0") > 0n),
    ) || [];
  useEffect(
    () =>
      setListPage((p) =>
        Math.min(p, Math.max(0, Math.ceil(list.length / 25) - 1)),
      ),
    [list.length],
  );
  const totals: Summary = {
    paidAfterGraceCents: "0",
    paidLateChargeCount: "0",
    afterGraceCents: "0",
    withinGraceCents: "0",
    dueTodayCents: "0",
    upcomingCents: "0",
    age1To30Cents: "0",
    age31To60Cents: "0",
    age61To90Cents: "0",
    age91PlusCents: "0",
    chargedCents: "0",
    paidCents: "0",
    outstandingCents: "0",
    overdueCents: "0",
    creditCents: "0",
    netCents: "0",
  };
  for (const a of list)
    for (const k of Object.keys(totals) as (keyof Summary)[])
      totals[k] = String(
        BigInt(totals[k] ?? "0") + BigInt(a.summary[k] ?? "0"),
      );
  return (
    <>
      {!resident && (propertyId || (leaseId && account)) && (
        <PropertyNavigation
          id={propertyId || account!.lease.propertyId}
          name={account?.lease.property.name}
          external={!!account}
        />
      )}
      <header className="page-heading">
        <p className="eyebrow">
          {resident ? "My rental" : "Money · Rent operations"}
        </p>
        <h1>
          {leaseId ? "Rent ledger" : resident ? "My rent" : "Rent & balances"}
        </h1>
        <p>
          {resident
            ? "Your posted rent, recorded payments, and remaining balance."
            : "Post monthly rent, record payments received, and follow each lease balance."}
        </p>
      </header>
      {!resident && !leaseId && (
        <div className="rent-filters">
          <PropertyScope
            value={propertyId}
            change={(value) =>
              setParams({ ...(value ? { propertyId: value } : {}), view })
            }
          />
        </div>
      )}
      {r.error && <Load error={r.error} retry={r.reload} />}
      {!r.data ? (
        !r.error && <Load retry={r.reload} />
      ) : (
        <>
          {leaseId && account ? (
            <>
              <Link
                to={propertyLink(
                  resident ? "/resident/rent" : "/company/rent",
                  propertyId || undefined,
                )}
              >
                ← All rent accounts
              </Link>
              <LeaseLedger
                key={account.lease.id}
                account={account}
                today={r.data.businessDate}
                resident={resident}
                reload={r.reload}
                stale={!!r.error}
              />
            </>
          ) : (
            !leaseId && (
              <>
                <Metrics summary={totals} />
                <Aging summary={totals} />
                <section className="panel">
                  <div className="section-heading">
                    <h2>Lease accounts</h2>
                    <button
                      className="secondary"
                      disabled={!!r.error}
                      onClick={() =>
                        downloadReport(
                          `rent-balances-${r.data!.businessDate}.csv`,
                          [
                            ["Business date", r.data!.businessDate],
                            [
                              "Past due USD",
                              moneyCell(totals.overdueCents),
                              "Past grace USD",
                              moneyCell(totals.afterGraceCents),
                              "Within grace USD",
                              moneyCell(totals.withinGraceCents),
                            ],
                            [
                              "Age 1–30 USD",
                              moneyCell(totals.age1To30Cents),
                              "Age 31–60 USD",
                              moneyCell(totals.age31To60Cents),
                              "Age 61–90 USD",
                              moneyCell(totals.age61To90Cents),
                              "Age 91+ USD",
                              moneyCell(totals.age91PlusCents),
                            ],
                            [
                              "Basis",
                              "Posted charges and recorded payments; current balances in USD",
                            ],
                            [
                              "Property",
                              "Unit",
                              "Resident",
                              "Lease reference",
                              "Status",
                              "Charged USD",
                              "Received USD",
                              "Unpaid USD",
                              "Past due USD",
                              "Credit USD",
                              "Past grace USD",
                              "Within grace USD",
                              "Age 1–30 USD",
                              "Age 31–60 USD",
                              "Age 61–90 USD",
                              "Age 91+ USD",
                            ],
                            ...list.map((a) => [
                              a.lease.property.name,
                              a.lease.unit.label,
                              a.lease.resident?.name ||
                                a.lease.resident?.email ||
                                "Your lease",
                              a.lease.id,
                              a.lease.status,
                              moneyCell(a.summary.chargedCents),
                              moneyCell(a.summary.paidCents),
                              moneyCell(a.summary.outstandingCents),
                              moneyCell(a.summary.overdueCents),
                              moneyCell(a.summary.creditCents),
                              moneyCell(a.summary.afterGraceCents),
                              moneyCell(a.summary.withinGraceCents),
                              moneyCell(a.summary.age1To30Cents),
                              moneyCell(a.summary.age31To60Cents),
                              moneyCell(a.summary.age61To90Cents),
                              moneyCell(a.summary.age91PlusCents),
                            ]),
                            [
                              "Totals",
                              "",
                              "",
                              "",
                              "",
                              moneyCell(totals.chargedCents),
                              moneyCell(totals.paidCents),
                              moneyCell(totals.outstandingCents),
                              moneyCell(totals.overdueCents),
                              moneyCell(totals.creditCents),
                              moneyCell(totals.afterGraceCents),
                              moneyCell(totals.withinGraceCents),
                              moneyCell(totals.age1To30Cents),
                              moneyCell(totals.age31To60Cents),
                              moneyCell(totals.age61To90Cents),
                              moneyCell(totals.age91PlusCents),
                            ],
                          ],
                        )
                      }
                    >
                      Download balances CSV
                    </button>
                    {!resident && (
                      <Link
                        to={propertyLink(
                          "/company/leases",
                          propertyId || undefined,
                        )}
                      >
                        Manage leases →
                      </Link>
                    )}
                  </div>
                  <div className="rent-filters">
                    <label>
                      Search rent accounts
                      <input
                        type="search"
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setListPage(0);
                        }}
                        placeholder="Property, unit, or resident"
                      />
                    </label>
                    <label>
                      Balance view
                      <select
                        value={view}
                        onChange={(e) => {
                          setView(e.target.value);
                          setListPage(0);
                        }}
                      >
                        <option value="all">All accounts</option>
                        <option value="paid_late">Paid-late history</option>
                        <option value="unpaid">With unpaid charges</option>
                        <option value="credit">With unapplied credit</option>
                        <option value="past_due">Past due</option>
                        <option value="after_grace">Past grace</option>
                        <option value="within_grace">Within grace</option>
                        <option value="due_today">Due today</option>
                      </select>
                    </label>
                    <label>
                      Past-due age
                      <select
                        value={age}
                        onChange={(e) => {
                          setAge(e.target.value);
                          setListPage(0);
                        }}
                      >
                        <option value="all">Any age</option>
                        <option value="age1To30Cents">1–30 days</option>
                        <option value="age31To60Cents">31–60 days</option>
                        <option value="age61To90Cents">61–90 days</option>
                        <option value="age91PlusCents">91+ days</option>
                      </select>
                    </label>
                  </div>
                  <p className="help">
                    {list.length} matching accounts. Totals include every
                    matching account, across all pages. An age filter selects
                    accounts with unpaid charges in that band; totals include
                    all their charges. Charges appear after rent is posted.
                  </p>
                  {!list.length ? (
                    <div className="rent-empty">
                      <h3>No matching rent accounts</h3>
                      <p>
                        {resident
                          ? "Your manager must record your lease and maintain your property assignment before rent appears here."
                          : "Create a lease, or change your search and filters. Existing manual finance entries are not automatically linked to leases."}
                      </p>
                      {!resident && (
                        <Link
                          className="button secondary"
                          to={propertyLink(
                            "/company/leases",
                            propertyId || undefined,
                            { new: "lease" },
                          )}
                        >
                          Record a lease
                        </Link>
                      )}
                    </div>
                  ) : (
                    <ul className="record-list rent-accounts">
                      {list
                        .slice(listPage * 25, (listPage + 1) * 25)
                        .map((a) => (
                          <li key={a.lease.id}>
                            <div>
                              <h3>
                                <Link
                                  to={
                                    "?" +
                                    new URLSearchParams({
                                      ...(propertyId ? { propertyId } : {}),
                                      leaseId: a.lease.id,
                                    })
                                  }
                                >
                                  {a.lease.property.name} · {a.lease.unit.label}
                                </Link>
                              </h3>
                              <p>
                                {a.lease.resident
                                  ? a.lease.resident.name ||
                                    a.lease.resident.email
                                  : "Your lease"}{" "}
                                ·{" "}
                                <span className="badge">{a.lease.status}</span>
                              </p>
                              <small>
                                {a.lease.startsOn.slice(0, 10)} –{" "}
                                {a.lease.endsOn?.slice(0, 10) || "Open-ended"}
                              </small>
                            </div>
                            <div className="rent-account-balance">
                              <strong>
                                {dollars(a.summary.outstandingCents)}
                              </strong>
                              <span>unpaid</span>
                              {BigInt(a.summary.overdueCents) === 0n &&
                                BigInt(a.summary.chargedCents) > 0n && (
                                  <small>Up to date</small>
                                )}
                              {BigInt(a.summary.paidLateChargeCount ?? "0") >
                                0n && (
                                <small>
                                  {a.summary.paidLateChargeCount}{" "}
                                  {a.summary.paidLateChargeCount === "1"
                                    ? "charge"
                                    : "charges"}{" "}
                                  paid late
                                </small>
                              )}
                              {BigInt(a.summary.afterGraceCents) > 0n && (
                                <span className="collection-badge past_grace">
                                  {dollars(a.summary.afterGraceCents)} past
                                  grace
                                </span>
                              )}
                              {BigInt(a.summary.withinGraceCents) > 0n && (
                                <small>
                                  {dollars(a.summary.withinGraceCents)} within
                                  grace
                                </small>
                              )}
                              {BigInt(a.summary.creditCents) > 0n && (
                                <small>
                                  {dollars(a.summary.creditCents)} credit
                                </small>
                              )}
                              <Link
                                to={
                                  "?" +
                                  new URLSearchParams({
                                    ...(propertyId ? { propertyId } : {}),
                                    leaseId: a.lease.id,
                                  })
                                }
                              >
                                Open ledger →
                              </Link>
                            </div>
                          </li>
                        ))}
                    </ul>
                  )}
                  <Pager
                    page={listPage}
                    total={list.length}
                    change={setListPage}
                  />
                </section>
              </>
            )
          )}
          <p className="help">
            As of {r.data.businessDate} in your company timezone. Last updated{" "}
            {new Date(r.data.generatedAt).toLocaleTimeString()}. Past due means
            a posted unpaid charge has a due date before today. Past grace means
            its saved grace window has also ended. Aging uses the due date; no
            late fees are added.
          </p>
        </>
      )}
      {!resident && !leaseId && (
        <label className="rent-property-jump">
          Property workspace
          <Link to="/company/properties">Browse properties →</Link>
        </label>
      )}
    </>
  );
}
function Pager({
  page,
  total,
  change,
}: {
  page: number;
  total: number;
  change: (p: number) => void;
}) {
  return total > 25 ? (
    <nav className="actions" aria-label="Record pages">
      <button
        className="secondary"
        disabled={!page}
        onClick={() => change(page - 1)}
      >
        Previous page
      </button>
      <span>
        Page {page + 1} of {Math.ceil(total / 25)}
      </span>
      <button
        className="secondary"
        disabled={(page + 1) * 25 >= total}
        onClick={() => change(page + 1)}
      >
        Next page
      </button>
    </nav>
  ) : null;
}
function LeaseLedger({
  account,
  today,
  resident,
  reload,
  stale,
}: {
  account: Account;
  today: string;
  resident: boolean;
  reload: () => void;
  stale: boolean;
}) {
  const { lease, summary } = account;
  const [chargeOpen, setChargeOpen] = useState(false),
    [paymentOpen, setPaymentOpen] = useState(false),
    [correction, setCorrection] = useState<{
      row: Entry;
      type: "charge" | "payment";
    } | null>(null);
  const [tab, setTab] = useState<"charges" | "payments">("charges"),
    [recordPage, setRecordPage] = useState(0);
  const rows = [...(account[tab] || [])].reverse(),
    active = lease.status !== "draft";
  return (
    <>
      <section className="panel rent-lease-heading">
        <div>
          <h2>
            {lease.property.name} · {lease.unit.label}
          </h2>
          <p>
            {lease.resident && (
              <>{lease.resident.name || lease.resident.email} · </>
            )}
            <span className="badge">{lease.status}</span>
          </p>
          <p>
            {lease.startsOn.slice(0, 10)} –{" "}
            {lease.endsOn?.slice(0, 10) || "Open-ended"} ·{" "}
            {dollars(lease.rentCents)} monthly
          </p>
          <p>
            Due day {lease.rentDueDay ?? 1} · {lease.graceDays ?? 0} calendar
            days of grace after due date
          </p>
          {lease.paymentInstructions && (
            <p className="payment-instructions">{lease.paymentInstructions}</p>
          )}
        </div>
        {!resident && (
          <div className="actions">
            <button
              disabled={!active || stale}
              className={summary.chargedCents === "0" ? "secondary" : ""}
              onClick={() => setPaymentOpen(true)}
            >
              Record payment
            </button>
            <button
              disabled={!active || stale}
              className={summary.chargedCents === "0" ? "" : "secondary"}
              onClick={() => setChargeOpen(true)}
            >
              Post monthly rent
            </button>
            <Link to={propertyLink("/company/leases", lease.propertyId)}>
              Lease details →
            </Link>
          </div>
        )}
      </section>
      {!active && (
        <p className="notice">
          This lease is a draft. Activate it in Leases before posting rent or
          recording a payment.
        </p>
      )}
      <PaymentStanding summary={summary} />
      <Metrics summary={summary} />
      <Aging summary={summary} />
      {!resident && (
        <RentSchedule lease={lease} businessDate={today} changed={reload} />
      )}
      <section className="panel">
        <div className="section-heading">
          <h2>Account history</h2>
          <button
            className="secondary"
            disabled={stale}
            onClick={() =>
              downloadReport(`rent-ledger-${today}.csv`, [
                ["Property", lease.property.name, "Unit", lease.unit.label],
                [
                  "Past due USD",
                  moneyCell(summary.overdueCents),
                  "Past grace USD",
                  moneyCell(summary.afterGraceCents),
                  "Within grace USD",
                  moneyCell(summary.withinGraceCents),
                ],
                ["Lease reference", lease.id, "Business date", today],
                [
                  "Basis",
                  "Current posted rent ledger in USD; voided entries excluded from totals",
                ],
                [
                  "Charged USD",
                  moneyCell(summary.chargedCents),
                  "Received USD",
                  moneyCell(summary.paidCents),
                ],
                [
                  "Unpaid USD",
                  moneyCell(summary.outstandingCents),
                  "Credit USD",
                  moneyCell(summary.creditCents),
                ],
                [
                  "Type",
                  "Reference",
                  "Period",
                  "Due / received date",
                  "Amount USD",
                  "Applied USD",
                  "Status",
                  "Description",
                  "Grace days",
                  "Grace through",
                  "Past grace from",
                  "Unpaid USD",
                  "Days past due",
                  "Payment timing",
                  "Settled on",
                  "Received after grace USD",
                ],
                ...(account.charges || []).map((c) => [
                  "Charge",
                  c.id,
                  c.periodOn!.slice(0, 7),
                  c.dueOn!.slice(0, 10),
                  moneyCell(String(c.amountCents)),
                  moneyCell(c.appliedCents),
                  c.voidedAt ? "Voided" : "Posted",
                  c.memo || "",
                  String(c.graceDays ?? 0),
                  c.graceThrough || "",
                  c.afterGraceOn || "",
                  moneyCell(c.remainingCents || "0"),
                  String(c.daysPastDue || 0),
                  c.voidedAt
                    ? "Voided"
                    : c.paidLate
                      ? "Paid late"
                      : c.settledOn
                        ? "Paid within grace"
                        : "Not settled",
                  c.settledOn || "",
                  moneyCell(c.paidAfterGraceCents || "0"),
                ]),
                ...(account.payments || []).map((p) => [
                  "Payment",
                  p.id,
                  "",
                  p.occurredOn!.slice(0, 10),
                  moneyCell(String(p.amountCents)),
                  moneyCell(p.appliedCents),
                  p.voidedAt ? "Voided" : "Received",
                  p.memo || "",
                  "",
                  "",
                  "",
                  "",
                  "",
                ]),
                [
                  "Allocation reference",
                  "Payment reference",
                  "Charge reference",
                  "Amount USD",
                ],
                ...(account.allocations || []).map((a) => [
                  a.id,
                  a.entryId,
                  a.chargeId,
                  moneyCell(String(a.amountCents)),
                ]),
              ])
            }
          >
            Download ledger CSV
          </button>
          <p className="help">
            {dollars(summary.chargedCents)} charged ·{" "}
            {dollars(summary.paidCents)} received
          </p>
        </div>
        <div
          className="rent-history-tabs"
          role="group"
          aria-label="History view"
        >
          <button
            className={tab === "charges" ? "" : "secondary"}
            aria-pressed={tab === "charges"}
            onClick={() => {
              setTab("charges");
              setRecordPage(0);
            }}
          >
            Charges ({account.charges?.length || 0})
          </button>
          <button
            className={tab === "payments" ? "" : "secondary"}
            aria-pressed={tab === "payments"}
            onClick={() => {
              setTab("payments");
              setRecordPage(0);
            }}
          >
            Payments ({account.payments?.length || 0})
          </button>
        </div>
        {!rows.length ? (
          <div className="rent-empty">
            <h3>
              {tab === "charges"
                ? "No rent posted yet"
                : "No payments recorded yet"}
            </h3>
            <p>
              {tab === "charges"
                ? "Monthly lease rent becomes a balance only when a charge is posted. No automatic backfill or proration is performed."
                : "Record payments already received. Any amount beyond unpaid charges remains an unapplied credit."}
            </p>
          </div>
        ) : (
          <ul className="rent-history">
            {rows.slice(recordPage * 25, (recordPage + 1) * 25).map((row) => (
              <li key={row.id} className={row.voidedAt ? "rent-voided" : ""}>
                <div className="rent-entry-main">
                  <span className="rent-entry-icon" aria-hidden="true">
                    {tab === "charges" ? "↗" : "↙"}
                  </span>
                  <div>
                    <h3>
                      {tab === "charges"
                        ? `Rent · ${row.periodOn?.slice(0, 7)}`
                        : "Payment received"}
                    </h3>
                    <p>
                      {tab === "charges"
                        ? `Due ${row.dueOn?.slice(0, 10)}`
                        : row.occurredOn?.slice(0, 10)}
                    </p>
                    {row.memo && <p>{row.memo}</p>}
                    {tab === "charges" && row.collectionStatus && (
                      <>
                        <span
                          className={`collection-badge ${row.paidLate ? "paid_late" : row.collectionStatus}`}
                        >
                          {row.paidLate
                            ? "paid late"
                            : row.collectionStatus.replace(/_/g, " ")}
                        </span>
                        <p>
                          {row.settledOn
                            ? `Paid ${row.settledOn} · fully paid`
                            : `${dollars(row.remainingCents || "0")} unpaid · ${row.daysPastDue || 0} days past due`}
                        </p>
                        {BigInt(row.paidAfterGraceCents ?? "0") > 0n && (
                          <p className="help">
                            {dollars(row.paidAfterGraceCents!)} received after
                            grace
                          </p>
                        )}
                        <p className="help">
                          {row.graceDays} days grace · through{" "}
                          {row.graceThrough} · past grace from{" "}
                          {row.afterGraceOn}
                        </p>
                      </>
                    )}
                    <small>Reference: {row.id}</small>
                    {tab === "payments" && !row.voidedAt && (
                      <ul
                        className="rent-allocation-list"
                        aria-label="Applied to charges"
                      >
                        {account.allocations
                          ?.filter((a) => a.entryId === row.id)
                          .map((a) => (
                            <li key={a.id}>
                              {account.charges
                                ?.find((c) => c.id === a.chargeId)
                                ?.periodOn?.slice(0, 7)}{" "}
                              rent · {dollars(a.amountCents)}
                            </li>
                          ))}
                      </ul>
                    )}
                    {row.voidedAt && (
                      <p>Voided{row.voidReason ? `: ${row.voidReason}` : ""}</p>
                    )}
                  </div>
                </div>
                <div className="rent-entry-amount">
                  <strong>{dollars(row.amountCents)}</strong>
                  {!row.voidedAt && (
                    <small>
                      {tab === "charges"
                        ? `${dollars(BigInt(row.amountCents).toString())} charged · ${dollars(row.appliedCents)} paid`
                        : `${dollars(row.appliedCents)} applied · ${dollars(String(BigInt(row.amountCents) - BigInt(row.appliedCents)))} credit`}
                    </small>
                  )}
                  {!row.voidedAt && !resident && (
                    <button
                      disabled={stale}
                      className="text-button"
                      onClick={() =>
                        setCorrection({
                          row,
                          type: tab === "charges" ? "charge" : "payment",
                        })
                      }
                    >
                      Void {tab === "charges" ? "charge" : "payment"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pager page={recordPage} total={rows.length} change={setRecordPage} />
        <p className="help">
          Payments apply to the oldest unpaid posted charge first. Existing
          allocations stay linked to their original charges. Voids retain
          history and are excluded from balances.
        </p>
        {!resident && (
          <Link to={propertyLink("/company/finances", lease.propertyId)}>
            View property cash transactions →
          </Link>
        )}
      </section>
      {!resident && (
        <>
          <RentEditor
            mode="charge"
            open={chargeOpen}
            close={() => setChargeOpen(false)}
            account={account}
            today={today}
            reload={reload}
          />
          <RentEditor
            mode="payment"
            open={paymentOpen}
            close={() => setPaymentOpen(false)}
            account={account}
            today={today}
            reload={reload}
          />
          {correction && (
            <EditorDialog
              open
              title={`Void ${correction.type}`}
              onClose={() => setCorrection(null)}
            >
              <p>
                {dollars(correction.row.amountCents)} · {correction.row.id}
              </p>
              <Form
                label={`Confirm void ${correction.type}`}
                operation="rent.void"
                submit={async (form) => {
                  await api(
                    correction.type === "charge"
                      ? `/api/company/rent/charges/${encodeURIComponent(correction.row.id)}/void`
                      : `/api/company/finances/${encodeURIComponent(correction.row.id)}/void`,
                    {
                      method: "POST",
                      body: {
                        expectedVersion: correction.row.version,
                        reason: form.get("reason"),
                      },
                    },
                  );
                  setCorrection(null);
                  reload();
                }}
              >
                <label>
                  Correction reason
                  <textarea name="reason" required maxLength={300} />
                </label>
                <p className="help">
                  This corrects a record; it does not refund money. A charge
                  with an applied payment cannot be voided until that payment is
                  corrected. Record the replacement afterward.
                </p>
              </Form>
            </EditorDialog>
          )}
        </>
      )}
    </>
  );
}
function RentEditor({
  mode,
  open,
  close,
  account,
  today,
  reload,
}: {
  mode: "charge" | "payment";
  open: boolean;
  close: () => void;
  account: Account;
  today: string;
  reload: () => void;
}) {
  const { data: auth } = useAuth();
  const storageKey = `pf-rent-pending:${auth!.user.id}:${auth!.membership!.companyId}:${account.lease.id}:${mode}`;
  const [key, setKey] = useState(
    () => pendingRent(storageKey)?.submissionKey || crypto.randomUUID(),
  );
  const clear = () => {
    sessionStorage.removeItem(storageKey);
    setKey(crypto.randomUUID());
  };
  // Snapshot the reviewed lease when this draft is first opened. Refreshes must
  // not silently update its version, values, or retry fingerprint after a timeout.
  return (
    <EditorDialog
      open={open}
      title={mode === "charge" ? "Post monthly rent" : "Record rent payment"}
      onClose={close}
    >
      <RentDraft
        key={key}
        mode={mode}
        account={account}
        today={today}
        submissionKey={key}
        storageKey={storageKey}
        reset={clear}
        saved={() => {
          close();
          clear();
          reload();
        }}
      />
    </EditorDialog>
  );
}
type PendingRent = {
  submissionKey: string;
  amount: string;
  memo: string | null;
  periodOn?: string;
  dueOn?: string;
  expectedVersion?: number;
  occurredOn?: string;
  reviewedPolicy?: { graceDays: number; rentDueDay: number };
};
function pendingRent(key: string): PendingRent | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    if (
      value &&
      typeof value.submissionKey === "string" &&
      typeof value.amount === "string"
    )
      return value;
  } catch {
    /* Submitting requires a successful storage write before any API call. */
  }
}
function RentDraft({
  mode,
  account,
  today,
  submissionKey,
  storageKey,
  reset,
  saved,
}: {
  mode: "charge" | "payment";
  account: Account;
  today: string;
  submissionKey: string;
  storageKey: string;
  reset: () => void;
  saved: () => void;
}) {
  const [pending, setPending] = useState(() => pendingRent(storageKey));
  const [lease] = useState(account.lease),
    [month, setMonth] = useState(
      pending?.periodOn?.slice(0, 7) ||
        (lease.startsOn.slice(0, 7) > today.slice(0, 7)
          ? lease.startsOn.slice(0, 7)
          : lease.endsOn && lease.endsOn.slice(0, 7) < today.slice(0, 7)
            ? lease.endsOn.slice(0, 7)
            : today.slice(0, 7)),
    ),
    [amount, setAmount] = useState(
      pending?.amount ||
        (mode === "charge" ? (account.lease.rentCents / 100).toFixed(2) : ""),
    );
  const due = scheduledDueDate(month, lease.rentDueDay ?? 1);
  const [dueOverride, setDueOverride] = useState<{
    month: string;
    value: string;
  }>();
  const actualDue =
    pending?.dueOn || (dueOverride?.month === month ? dueOverride.value : due);
  const savedGrace = pending?.reviewedPolicy?.graceDays ?? lease.graceDays ?? 0;
  const grace = graceDates(actualDue, savedGrace);
  return (
    <Form
      operation={mode === "charge" ? "rent.charge" : "rent.payment"}
      label={mode === "charge" ? "Post rent charge" : "Record payment received"}
      secondaryActions={<DraftReset reset={reset} />}
      submit={async (form) => {
        const body: PendingRent =
          pending ||
          (mode === "charge"
            ? {
                periodOn: String(form.get("periodOn")) + "-01",
                dueOn: String(form.get("dueOn")),
                amount: String(form.get("amount")),
                memo: String(form.get("memo") || "") || null,
                expectedVersion: lease.version,
                reviewedPolicy: {
                  graceDays: lease.graceDays ?? 0,
                  rentDueDay: lease.rentDueDay ?? 1,
                },
                submissionKey,
              }
            : {
                occurredOn: String(form.get("occurredOn")),
                amount: String(form.get("amount")),
                memo: String(form.get("memo") || "") || null,
                submissionKey,
              });
        // Keep the original payload and identity across reload/navigation after an
        // uncertain response. The tab stores only this user's own pending input.
        sessionStorage.setItem(storageKey, JSON.stringify(body));
        setPending(body);
        try {
          const { reviewedPolicy: _reviewedPolicy, ...requestBody } = body;
          await api(
            `/api/company/rent/${encodeURIComponent(lease.id)}/${mode === "charge" ? "charges" : "payments"}`,
            { method: "POST", body: requestBody },
          );
        } catch (error) {
          // A first attempt with a definitive rejection has no committed identity;
          // allow correcting it. Never discard an earlier uncertain submission.
          if (
            !pending &&
            error instanceof ApiError &&
            [400, 403, 404, 409, 422].includes(error.status)
          ) {
            sessionStorage.removeItem(storageKey);
            setPending(undefined);
          }
          throw error;
        }
        saved();
      }}
    >
      <div className="rent-draft-context">
        <strong>
          {lease.property.name} · {lease.unit.label}
        </strong>
        <p>
          {lease.resident?.name || lease.resident?.email} ·{" "}
          {dollars(lease.rentCents)} monthly
        </p>
      </div>
      {pending && (
        <p className="notice">
          An unconfirmed save is retained in this tab. Retry the original
          submission safely, or check the ledger before clearing this draft.
        </p>
      )}
      <fieldset disabled={!!pending} className="rent-draft-fields">
        {mode === "charge" ? (
          <div className="field-grid">
            <label>
              Rent month
              <input
                name="periodOn"
                type="month"
                required
                min={lease.startsOn.slice(0, 7)}
                max={lease.endsOn?.slice(0, 7)}
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </label>
            <label>
              Due date
              <input
                key={month}
                name="dueOn"
                type="date"
                required
                value={actualDue}
                onChange={(e) =>
                  setDueOverride({ month, value: e.target.value })
                }
              />
            </label>
          </div>
        ) : (
          <label>
            Date received
            <input
              name="occurredOn"
              type="date"
              required
              defaultValue={pending?.occurredOn || today}
              max={today}
            />
          </label>
        )}
        <label>
          {mode === "charge" ? "Charge amount (USD)" : "Payment amount (USD)"}
          <input
            name="amount"
            type="number"
            min="0.01"
            max="1000000"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          {mode === "charge"
            ? "Description shared with resident (optional)"
            : "Internal payment reference / memo (optional)"}
          <textarea
            name="memo"
            maxLength={500}
            defaultValue={pending?.memo || ""}
          />
        </label>
      </fieldset>
      {mode === "charge" && (
        <p className="policy-example">
          Grace through {grace.through} · past grace from {grace.after}. This
          charge saves {savedGrace} grace days. No late fee is generated.
        </p>
      )}
      <p className="notice">
        {mode === "charge"
          ? `Review ${month}: the default is the full monthly rent. For a partial month, enter the agreed amount yourself. One active charge per lease month. The agreed due date can precede move-in; no automatic proration is performed.`
          : "Record money you have already received. This creates one rent income entry in cash reports, applies it to unpaid rent, and keeps any excess as credit. Do not record it again in Finances."}
      </p>
    </Form>
  );
}

function Aging({ summary }: { summary: Summary }) {
  return (
    <section className="rent-aging" aria-label="Past-due aging">
      <div>
        <h2>Past-due aging</h2>
        <p>Current unpaid amounts, aged from their original due date.</p>
      </div>
      {[
        ["1–30 days", summary.age1To30Cents],
        ["31–60 days", summary.age31To60Cents],
        ["61–90 days", summary.age61To90Cents],
        ["91+ days", summary.age91PlusCents],
      ].map(([label, amount]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{dollars(amount)}</strong>
        </div>
      ))}
    </section>
  );
}
function PropertyScope({
  value,
  change,
}: {
  value: string;
  change: (value: string) => void;
}) {
  const r = useResource<{ id: string; name: string }[]>(
    "/api/company/properties",
  );
  return (
    <label>
      Rent property
      <select
        value={value}
        disabled={!r.data}
        onChange={(e) => change(e.target.value)}
      >
        <option value="">All properties</option>
        {r.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {r.error && (
        <span role="alert">
          {r.error}
          <button className="text-button" onClick={r.reload}>
            Retry property list
          </button>
        </span>
      )}
    </label>
  );
}
