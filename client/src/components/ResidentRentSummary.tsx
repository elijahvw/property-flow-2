import { Link } from "react-router-dom";
import type { Account } from "../pages/Rent";
import { useResource } from "../useResource";
import { dollars } from "../money";
import { formatDate } from "../dates";
import { statementPath } from "../statement";
import "./ResidentRentSummary.css";

type Snapshot = { businessDate: string; accounts: Account[] };
function complete(snapshot: Snapshot | undefined): snapshot is Snapshot {
  return !!snapshot && Array.isArray(snapshot.accounts) &&
    snapshot.accounts.every(account => account?.lease?.id && account.lease.property?.name &&
      account.lease.unit?.label && ["overdueCents", "dueTodayCents", "upcomingCents", "creditCents"]
        .every(key => /^\d+$/.test(String(account.summary?.[key as keyof Account["summary"]] ?? ""))));
}

export function ResidentRentSummary() {
  const r = useResource<Snapshot>("/api/resident/rent", true, true);
  if (r.error || (r.data && !complete(r.data))) return (
    <section className="panel" aria-label="Rental balance overview">
      <h2>Your rent summary is unavailable</h2>
      <p role={r.error ? "alert" : "status"}>{r.error || "Your balances could not be loaded. Try again to see the complete records."}</p>
      <button className="secondary" onClick={r.reload}>Retry rent summary</button>
    </section>
  );
  if (!r.data) return <section className="panel" aria-label="Rental balance overview"><p role="status">Loading your rental balances…</p></section>;
  if (!r.data.accounts.length) return (
    <section className="panel" aria-label="Rental balance overview">
      <h2>Lease financial access</h2>
      <p>Financial records are available to approved leaseholders. Contact your property manager if you need access to your lease records.</p>
    </section>
  );
  return (
    <section className="panel resident-rent-summary" aria-label="Rental balance overview">
      <div className="section-heading"><div><h2>Your rental balances</h2><p>Recorded charges and payments as of {formatDate(r.data.businessDate)}.</p></div></div>
      <p className="help">These are shared lease balances. Payment credit and security deposits are tracked separately. Follow your lease’s payment instructions to arrange payment.</p>
      <div className="resident-balance-accounts">
        {r.data.accounts.map(account => {
          const { lease, summary } = account;
          const dueNow = String(BigInt(summary.overdueCents) + BigInt(summary.dueTodayCents));
          return <article key={lease.id} className="resident-balance-account" aria-label={`${lease.property.name} · ${lease.unit.label}`}>
            <h3>{lease.property.name} · {lease.unit.label}</h3>
            <dl className="resident-balance-values">
              <div><dt>Due now</dt><dd><strong>{dollars(dueNow)}</strong><small>Unpaid charges due today or earlier</small></dd></div>
              <div><dt>Upcoming charges</dt><dd><strong>{dollars(summary.upcomingCents)}</strong><small>Posted charges with a future due date</small></dd></div>
              <div><dt>Unapplied payment credit</dt><dd><strong>{dollars(summary.creditCents)}</strong><small>Received payments not yet applied to charges</small></dd></div>
            </dl>
            <div className="actions">
              <Link to={`/resident/rent?${new URLSearchParams({ leaseId: lease.id })}`}>Rent & payments for {lease.unit.label} →</Link>
              <Link to={statementPath(lease.id, true)}>Statement for {lease.unit.label} →</Link>
            </div>
          </article>;
        })}
      </div>
    </section>
  );
}
