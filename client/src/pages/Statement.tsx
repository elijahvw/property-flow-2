import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useResource } from "../useResource";
import { DateField } from "../components/DateField";
import { TenantReturnLink } from "../components/TenantReturnLink";
import { formatDate, formatMonth } from "../dates";
import { leasePath, leaseContext } from "../lease-links";
import { propertyLink } from "../components/PropertyNavigation";
import {
  statementContext,
  statementCsv,
  statementStatuses,
  type Statement as StatementData,
} from "../statement";
import { recordReference } from "../record-reference";
import { downloadReport } from "../report-export";
import { dollars } from "../money";
import "./Statement.css";

export function Statement({ resident = false }: { resident?: boolean }) {
  const [activityPage, setActivityPage] = useState(0),
    [allocationPage, setAllocationPage] = useState(0),
    [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  const { leaseId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const from = params.get("dateFrom") ?? "",
    to = params.get("dateTo") ?? "";
  const [dateFrom, setFrom] = useState(from),
    [dateTo, setTo] = useState(to);
  useEffect(() => {
    setFrom(from);
    setTo(to);
    setActivityPage(0);
    setAllocationPage(0);
  }, [from, to, leaseId]);
  const query = new URLSearchParams({
    ...(from ? { dateFrom: from } : {}),
    ...(to ? { dateTo: to } : {}),
  });
  const r = useResource<StatementData>(
    `/api/${resident ? "resident" : "company"}/statements/${encodeURIComponent(leaseId)}?${query}`,
    false,
    true,
  );
  const statement = r.data;
  const sourcePage = Math.min(
    activityPage,
    Math.max(0, Math.ceil((statement?.items.length ?? 0) / 25) - 1),
  );
  const appliedPage = Math.min(
    allocationPage,
    Math.max(0, Math.ceil((statement?.allocations.length ?? 0) / 25) - 1),
  );
  const context = statementContext(params);
  const back =
    !resident && params.get("statementFrom") === "lease"
      ? leasePath(leaseId, leaseContext(params))
      : propertyLink(
          resident ? "/resident/rent" : "/company/rent",
          resident ? undefined : (params.get("propertyId") ?? undefined),
          {
            ...leaseContext(params),
            leaseId,
            ...(params.get("leaseReturn")
              ? { leaseReturn: params.get("leaseReturn")! }
              : {}),
          },
        );
  const dirty = dateFrom !== from || dateTo !== to;
  const periodLabel = !statement
    ? ""
    : statement.filters.dateFrom && statement.filters.dateTo
      ? `${formatDate(statement.filters.dateFrom)} – ${formatDate(statement.filters.dateTo)}`
      : statement.filters.dateFrom
        ? `From ${formatDate(statement.filters.dateFrom)}`
        : statement.filters.dateTo
          ? `Through ${formatDate(statement.filters.dateTo)}`
          : "All recorded activity";
  return (
    <div className="statement-page">
      <div className="statement-controls">
        <nav className="record-breadcrumb" aria-label="Statement navigation">
          <Link to={back}>
            ←{" "}
            {params.get("statementFrom") === "lease" && !resident
              ? "Back to lease workspace"
              : "Back to rent & payments"}
          </Link>
          {!resident && <TenantReturnLink />}
          <Link to={resident?`/resident/leases/${encodeURIComponent(leaseId)}/terms`:`/company/leases/${encodeURIComponent(leaseId)}?section=terms`}>Lease terms & changes →</Link>
          <Link to={resident?`/resident/leases/${encodeURIComponent(leaseId)}/settlement`:`/company/leases/${encodeURIComponent(leaseId)}?section=settlement`}>Move-out settlement →</Link>
        </nav>
        <header className="page-heading">
          <p className="record-kicker">
            {resident ? "My rental" : "Lease finances"}
          </p>
          <h1>Tenant statement</h1>
          <p>
            A clear record of posted rent, received payments and how they
            connect.
          </p>
        </header>
        <form
          className="statement-filters panel"
          onSubmit={(event) => {
            event.preventDefault();
            setParams({
              ...context,
              ...(dateFrom ? { dateFrom } : {}),
              ...(dateTo ? { dateTo } : {}),
            });
          }}
        >
          <div>
            <h2>Statement period</h2>
            <p className="help">
              Leave either date blank for all earlier or later activity.
            </p>
          </div>
          <div className="statement-date-fields">
            <label>
              From date
              <DateField
                aria-label="Statement from date"
                value={dateFrom}
                onChange={(event) => setFrom(event.target.value)}
                max={dateTo || undefined}
              />
            </label>
            <label>
              Through date
              <DateField
                aria-label="Statement through date"
                value={dateTo}
                onChange={(event) => setTo(event.target.value)}
                min={dateFrom || undefined}
              />
            </label>
          </div>
          <div className="actions">
            <button type="submit">Apply dates</button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setFrom("");
                setTo("");
                setParams(context);
              }}
            >
              All activity
            </button>
          </div>
          {dirty && (
            <p className="help statement-filter-hint" role="status">
              Apply dates to update the statement and enable export.
            </p>
          )}
        </form>
      </div>
      {!statement ? (
        <section className="panel statement-load">
          {r.error ? (
            <>
              <h2>Statement unavailable</h2>
              <p role="alert">{r.error}</p>
              <button className="secondary" onClick={r.reload}>
                Try statement again
              </button>
            </>
          ) : (
            <p role="status">Preparing your statement…</p>
          )}
        </section>
      ) : (
        <>
          <div className="statement-tools">
            <p className="help">
              {periodLabel} · {statement.period.recordCount} records
            </p>
            <div className="actions">
              <button
                className="secondary"
                disabled={dirty}
                onClick={() => window.print()}
              >
                Print statement
              </button>
              <button
                disabled={dirty}
                onClick={() =>
                  downloadReport(
                    `tenant-statement-${statement.businessDate}.csv`,
                    statementCsv(statement),
                  )
                }
              >
                Download statement CSV
              </button>
            </div>
          </div>
          <article
            className="statement-document"
            aria-label="Tenant statement document"
          >
            <header className="statement-document-header">
              <div>
                <p className="record-kicker">{statement.company.name}</p>
                <h2>{statement.lease.property.name}</h2>
                <p>
                  {statement.lease.unit.label} · {statement.lease.status} lease
                </p>
                <address>
                  {statement.lease.property.address}
                  <br />
                  {statement.lease.property.city},{" "}
                  {statement.lease.property.state}{" "}
                  {statement.lease.property.zip}
                  {statement.lease.property.countryCode && (
                    <>
                      <br />
                      {statement.lease.property.countryCode}
                    </>
                  )}
                </address>
              </div>
              <div className="statement-document-meta">
                <strong>Tenant statement</strong>
                <span>{periodLabel}</span>
                <span>
                  Lease term: {formatDate(statement.lease.startsOn)} –{" "}
                  {formatDate(statement.lease.endsOn, "Open ended")}
                </span>
                <span>
                  Current status: {formatDate(statement.businessDate)}
                </span>
                <small>{statement.company.timezone} · USD</small>
              </div>
            </header>
            <section
              aria-label="Current lease balances"
              className="statement-balances"
            >
              <div className="statement-primary-balance">
                <span>Unpaid charges</span>
                <strong>{dollars(statement.current.outstandingCents)}</strong>
                <small>
                  Rent{" "}
                  {dollars(
                    statement.current.rentOutstandingCents ??
                      statement.current.outstandingCents,
                  )}{" "}
                  · Other charges{" "}
                  {dollars(statement.current.otherOutstandingCents ?? "0")}.
                  Includes future due dates.
                </small>
              </div>
              <div>
                <span>Unapplied receipt credit</span>
                <strong>{dollars(statement.current.creditCents)}</strong>
                <small>Received money still available for rent</small>
              </div>
              <div>
                <span>Refundable deposit held</span>
                <strong>
                  {statement.deposit
                    ? dollars(statement.deposit.heldCents)
                    : "Not set up"}
                </strong>
                <small>Recorded separately from rent and credit</small>
              </div>
            </section>
            <section
              className="statement-standing"
              aria-label="Current payment standing"
            >
              {[
                ["Future due", statement.current.upcomingCents],
                ["Due today", statement.current.dueTodayCents],
                ["Within grace", statement.current.withinGraceCents],
                ["Past grace", statement.current.afterGraceCents],
              ].map(([label, amount]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{dollars(amount)}</strong>
                </div>
              ))}
              <p>
                {statement.current.paidLateChargeCount}{" "}
                {statement.current.paidLateChargeCount === "1"
                  ? "charge paid"
                  : "charges paid"}{" "}
                late. Paid-late history is separate from unpaid charges.
              </p>
            </section>
            <section
              className="statement-period"
              aria-labelledby="period-heading"
            >
              <div>
                <h3 id="period-heading">Period reconciliation</h3>
                <p>
                  Current-status charges less cash receipts and net noncash
                  credits, grouped by source date. A negative net amount is a
                  receipt surplus; it is not a refund.
                </p>
              </div>
              <dl>
                {[
                  ["Opening net balance", statement.period.openingNetCents],
                  ["+ Charges in period", statement.period.chargedCents],
                  [
                    "− Payments received in period",
                    statement.period.receivedCents,
                  ],
                  [
                    "− Noncash credits, net of reversals",
                    statement.period.noncashCreditCents ?? "0",
                  ],
                  ["− Deposit applied, net of reversals", statement.period.depositAppliedCents??"0"],
                  ["+ Manual payment refunds", statement.period.refundedCents??"0"],
                  ["Closing net balance", statement.period.closingNetCents],
                  [
                    "+ Later-dated net activity",
                    statement.period.laterNetCents,
                  ],
                  ["Current whole-lease net", statement.current.netCents],
                ].map(([label, amount]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{dollars(amount)}</dd>
                  </div>
                ))}
              </dl>
              <p className="help">
                Current whole-lease net = unpaid charges − unapplied receipt
                credit. Noncash reductions already applied:{" "}
                {dollars(statement.current.noncashCreditCents ?? "0")}. Held deposits stay separate until an authorized application is recorded; applied to charges: {dollars(statement.current.depositAppliedCents??"0")}. Returned payments: {dollars(statement.current.refundedCents??"0")}.
              </p>
            </section>
            <section
              className="statement-activity"
              aria-labelledby="activity-heading"
            >
              <div className="section-heading">
                <h3 id="activity-heading">Lease activity</h3>
                <span className="section-caption">
                  {statement.period.recordCount} source records ·{" "}
                  {statement.period.voidedCount} voided
                </span>
              </div>
              <p className="help">
                Monthly rent uses its due date; one-time charges and credit
                changes use their effective date; cash receipts use the date
                received. Status and applied amounts reflect all current
                activity, including dates outside this period.
              </p>
              {statement.items.length ? (
                <div className="table-wrap">
                  <table>
                    <caption>
                      Charges, cash receipts and noncash credit changes in the
                      selected period
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Date & reference</th>
                        <th scope="col">Activity</th>
                        <th scope="col">Current status</th>
                        <th scope="col" className="statement-money">
                          Charge
                        </th>
                        <th scope="col" className="statement-money">
                          Receipt
                        </th>
                        <th scope="col" className="statement-money">
                          Other balance change
                        </th>
                        <th scope="col" className="statement-money">
                          Running net
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(printing
                        ? statement.items
                        : statement.items.slice(
                            sourcePage * 25,
                            (sourcePage + 1) * 25,
                          )
                      ).map((item) => (
                        <tr
                          key={`${item.type}:${item.id}`}
                          className={
                            item.voidedAt ? "statement-voided" : undefined
                          }
                        >
                          <td>
                            <strong>{formatDate(item.date)}</strong>
                            <small>{recordReference(item.reference)}</small>
                          </td>
                          <td>
                            {item.type === "charge"
                              ? item.periodOn
                                ? `Rent · ${formatMonth(item.periodOn)}`
                                : item.description || "One-time charge"
                              : item.type === "receipt"
                                ? "Payment received"
                                : item.type === "refund" ? "Payment refund" : item.type === "deposit_application" ? "Deposit applied to charge" : item.type === "movement_reversal" ? "Movement correction"
                                : item.type === "credit_reversal"
                                  ? "Credit reversal"
                                  : item.category === "concession"
                                    ? "Concession"
                                    : "Credit note"}
                            {item.type !== "charge" && item.description && (
                              <small>{item.description}</small>
                            )}
                            {item.relatedReference && (
                              <small>
                                For{" "}
                                {recordReference(
                                  item.relatedReference,
                                ).toLowerCase()}
                              </small>
                            )}
                            {item.type === "charge" &&
                              !item.periodOn &&
                              item.dueOn && (
                                <small>Due {formatDate(item.dueOn)}</small>
                              )}
                            {item.scheduleId && <small>Recurring rent</small>}
                            {item.voidedAt && (
                              <small>
                                Voided {formatDate(item.voidedAt)} · excluded
                                from balance
                              </small>
                            )}
                          </td>
                          <td>
                            <span
                              className={`collection-badge ${item.status === "paid_late" ? "paid" : item.status}`}
                            >
                              {statementStatuses[item.status] ?? item.status}
                            </span>
                            <small>
                              {item.type === "charge"
                                ? `${dollars(item.remainingCents)} unpaid`
                                : item.type === "receipt"
                                  ? `${dollars(item.appliedCents)} applied · ${dollars(item.remainingCents)} cash credit`
                                  : "Noncash adjustment"}
                            </small>
                            {item.type === "charge" &&
                              item.graceThrough &&
                              !item.voidedAt && (
                                <small>
                                  Grace through {formatDate(item.graceThrough)}
                                </small>
                              )}
                          </td>
                          <td className="statement-money" data-label="Charge">
                            {item.type === "charge"
                              ? dollars(item.amountCents)
                              : "—"}
                          </td>
                          <td className="statement-money" data-label="Receipt">
                            {item.type === "receipt"
                              ? dollars(item.amountCents)
                              : "—"}
                          </td>
                          <td
                            className="statement-money"
                            data-label="Other balance change"
                          >
                            {item.type !== "charge" && item.type !== "receipt"
                              ? dollars(item.effectCents)
                              : "—"}
                          </td>
                          <td
                            className="statement-money"
                            data-label="Running net"
                          >
                            {dollars(item.runningNetCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="statement-empty">
                  <h4>No rent activity in this period</h4>
                  <p>
                    Try a wider date range or view all activity. Current lease
                    balances remain above.
                  </p>
                </div>
              )}
            </section>
            <StatementPager
              label="Activity"
              page={sourcePage}
              total={statement.items.length}
              change={setActivityPage}
            />
            <details
              className="statement-allocations"
              open={printing || undefined}
            >
              <summary>
                How payments were applied · {statement.allocations.length}{" "}
                allocations
              </summary>
              <p className="help">
                Includes allocations touching a charge or receipt in this
                period. The other source may fall outside the selected dates.
                Inactive allocations remain as correction history and do not
                affect current balances.
              </p>
              {statement.allocations.length ? (
                <div className="table-wrap">
                  <table>
                    <caption>Receipt-to-charge allocation details</caption>
                    <thead>
                      <tr>
                        <th scope="col">Payment receipt</th>
                        <th scope="col">Rent charge</th>
                        <th scope="col">Amount</th>
                        <th scope="col">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(printing
                        ? statement.allocations
                        : statement.allocations.slice(
                            appliedPage * 25,
                            (appliedPage + 1) * 25,
                          )
                      ).map((a) => (
                        <tr key={a.id}>
                          <td data-label="Payment receipt">
                            {recordReference(a.receiptReference)}
                            <small>Received {formatDate(a.receiptDate)}</small>
                          </td>
                          <td data-label="Rent charge">
                            {recordReference(a.chargeReference)}
                            <small>Due {formatDate(a.chargeDate)}</small>
                          </td>
                          <td data-label="Allocated">
                            {dollars(a.amountCents)}
                          </td>
                          <td data-label="Status">
                            {a.active ? "Active" : "Inactive · source voided"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No allocations for the selected source records.</p>
              )}
              <StatementPager
                label="Allocations"
                page={appliedPage}
                total={statement.allocations.length}
                change={setAllocationPage}
              />
            </details>
            <section
              className="statement-deposit"
              aria-labelledby="deposit-heading"
            >
              <h3 id="deposit-heading">Refundable security deposit</h3>
              {statement.deposit ? (
                <>
                  <p>
                    {recordReference(statement.deposit.reference)} · Due{" "}
                    {formatDate(statement.deposit.dueOn)} · Current whole-lease
                    amounts
                  </p>
                  <dl>
                    {[
                      ["Required", statement.deposit.requiredCents],
                      ["Valid receipts", statement.deposit.receivedCents??statement.deposit.heldCents],
                      ["Applied to charges", statement.deposit.appliedCents??"0"],
                      ["Money returned", statement.deposit.returnedCents??"0"],
                      ["Corrected receipts", statement.deposit.correctedCents??"0"],
                      ["Recorded held", statement.deposit.heldCents],
                      ["Uncollected", statement.deposit.outstandingCents],
                      ["Excess held", statement.deposit.excessHeldCents],
                    ].map(([label, amount]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{dollars(amount)}</dd>
                      </div>
                    ))}
                  </dl>
                  {!!statement.deposit.movements?.length && <details className="statement-deposit-history"><summary>Deposit applications, returns and corrections ({statement.deposit.movements.length})</summary><ol>{statement.deposit.movements.map(m=><li key={m.id}><strong>{m.kind==="deposit_application"?"Applied to charge":"Deposit refund"} · {dollars(m.amountCents)}</strong><p>{formatDate(m.effectiveOn)} · {recordReference(m.reference)} · {m.reversal?"Corrected / reversed":"Recorded"}</p><p>{m.reason}</p>{m.reversal&&<p>Correction: {formatDate(m.reversal.effectiveOn)} · {m.reversal.reason}</p>}</li>)}</ol></details>}
                </>
              ) : (
                <p>
                  A deposit requirement has not been recorded for this lease.
                </p>
              )}
              <p className="help">
                Recorded held equals valid receipts less active deposit applications and refunds. Applications and returns do not automatically create a new collection requirement. A void corrects a record; it does not mean money was returned. This is
                not bank reconciliation.
              </p>
            </section>
            <footer className="statement-basis">
              <h3>How to read this statement</h3>
              <p>{statement.basis}</p>
              <p>
                Unpaid means a charge has a remaining amount. Future due, due
                today, within grace and past grace split that unpaid amount by
                the saved charge dates. Paid late means the charge is fully paid
                and some payment was received after grace. No late fees are
                added here.
              </p>
              <small>
                Generated{" "}
                {new Date(statement.generatedAt).toLocaleString("en-US", {
                  timeZone: statement.company.timezone,
                  dateStyle: "long",
                  timeStyle: "short",
                })}{" "}
                ({statement.company.timezone})
              </small>
            </footer>
          </article>
        </>
      )}
    </div>
  );
}

function StatementPager({
  label,
  page,
  total,
  change,
}: {
  label: string;
  page: number;
  total: number;
  change: (page: number) => void;
}) {
  if (total <= 25) return null;
  return (
    <nav className="statement-pagination" aria-label={`${label} pages`}>
      <span aria-live="polite">
        {label}: {page * 25 + 1}–{Math.min(total, (page + 1) * 25)} of {total}.
        Exports include every record.
      </span>
      <div className="actions">
        <button
          className="secondary"
          disabled={!page}
          onClick={() => change(page - 1)}
        >
          Previous {label.toLowerCase()}
        </button>
        <button
          className="secondary"
          disabled={(page + 1) * 25 >= total}
          onClick={() => change(page + 1)}
        >
          Next {label.toLowerCase()}
        </button>
      </div>
    </nav>
  );
}
