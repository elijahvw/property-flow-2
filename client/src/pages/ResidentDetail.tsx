import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { tenantDirectorySearch, tenantLedgerContext } from "../tenant-links";
import { propertyLink } from "../components/PropertyNavigation";
import { ResidentEditor, type ResidentProfileDetail } from "./ResidentProfiles";
import { dollars } from "./Finances";
import { formatDate } from "../dates";

type RentSummary = { outstandingCents: string; creditCents: string; afterGraceCents: string; upcomingCents: string; withinGraceCents: string; dueTodayCents: string };
type DepositSummary = { requiredCents: string; heldCents: string; outstandingCents: string; excessHeldCents: string; pastDueCents: string };
type Lease = {
  id: string; propertyId: string; startsOn: string; endsOn: string | null;
  status: string; rentCents: number; rentDueDay: number; graceDays: number;
  property: { name: string }; unit: { label: string }; rent: RentSummary;
  deposit: (DepositSummary & { id: string; reference: string; dueOn: string }) | null;
};
type Workspace = { businessDate: string; timezone: string; generatedAt: string; rent: RentSummary; deposits: DepositSummary; leases: Lease[] };

export function ResidentDetail() {
  const { userId = "" } = useParams();
  const { data } = useAuth();
  return <TenantWorkspace key={`${userId}:${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`} id={userId} />;
}
function TenantWorkspace({ id }: { id: string }) {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const profile = useResource<ResidentProfileDetail>(`/api/company/resident-profiles/${encodeURIComponent(id)}`, true, true);
  const [editor, setEditor] = useState<"contact" | "access" | null>(null);
  const [contactVisited, setContactVisited] = useState(false), [accessVisited, setAccessVisited] = useState(false);
  const person = profile.data;
  const search = tenantDirectorySearch(params);
  const directory = "/company/residents" + (search ? `?${search}` : "");
  if (!person) return <section className="panel tenant-load-state"><Link to={directory} aria-label="All tenants">← All tenants</Link>{profile.error ? <><h1>Tenant unavailable</h1><p role="alert">{profile.error}</p><button className="secondary" onClick={profile.reload}>Try again</button></> : <p role="status">Loading tenant workspace…</p>}</section>;
  const name = person.contactName || person.user.name || person.user.email;
  const active = person.status === "active" && person.user.status === "active";
  return <div className="tenant-workspace">
    <nav className="record-breadcrumb" aria-label="Breadcrumb"><Link to={directory} aria-label="All tenants">← All tenants</Link><span aria-hidden="true">/</span><span>{name}</span></nav>
    <header className="tenant-record-header">
      <span className="tenant-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
      <div className="tenant-record-title"><p className="record-kicker">Tenant workspace</p><h1>{name}</h1><p>{person.user.email}</p></div>
      <span className={`tenant-status ${active ? "" : "neutral"}`}>{active ? person.user.emailVerified ? "Portal active" : "Verification needed" : "Portal disabled"}</span>
      <button className="secondary" disabled={!!profile.error} onClick={() => { setContactVisited(true); setEditor("contact"); }}>Edit resident profile</button>
    </header>
    {profile.error && <div className="notice error" role="alert">{profile.error} Contact information could not be refreshed. <button className="secondary" onClick={profile.reload}>Try again</button></div>}
    <div className="tenant-content-grid">
      <div className="tenant-primary">
        {can("finance.manage") && can("lease.manage") ? <TenantFinancials id={id} /> : <section className="panel"><h2>Lease and financial information</h2><p>Your current permissions do not include this information.</p></section>}
        <section className="panel tenant-activity">
          <div className="section-heading"><h2>Recent activity</h2><span className="section-caption">Latest 100 company events</span></div>
          {person.activity.length ? <ol className="tenant-timeline">{person.activity.map(event => <li key={event.id}><span className="timeline-mark" aria-hidden="true" /><div><strong>{event.action.replace(/\./g, " ")}</strong><time dateTime={event.createdAt}>{new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(event.createdAt))}</time></div></li>)}</ol> : <p className="tenant-muted">No activity has been recorded for this tenant yet.</p>}
        </section>
      </div>
      <aside className="tenant-secondary" aria-label="Tenant information">
        <section className="panel tenant-contact-panel"><h2>Contact information</h2><dl className="tenant-facts"><div><dt>Email</dt><dd>{person.user.email}</dd></div><div><dt>Phone</dt><dd>{person.contactPhone || "Not supplied"}</dd></div><div><dt>Emergency contact</dt><dd>{person.emergencyContactName || "Not supplied"}{person.emergencyContactPhone && <span className="cell-detail">{person.emergencyContactPhone}</span>}</dd></div></dl></section>
        <section className="panel"><div className="section-heading"><h2>Property access</h2><span className="section-caption">{person.assignments.length} assigned</span></div>
          {person.assignments.length ? <ul className="tenant-property-list">{person.assignments.map(({ property }) => <li key={property.id}><Link to={`/company/properties/${encodeURIComponent(property.id)}/residents`}>{property.name}<span aria-hidden="true">↗</span></Link><p>{property.address}</p></li>)}</ul> : <p className="tenant-muted">No current property access. Historical leases remain available to management.</p>}
          <p className="section-caption">Assignments control portal access. They do not change lease or payment history.</p>
          {can("members.manage") && <button className="secondary tenant-wide-button" disabled={!!profile.error} onClick={() => { setAccessVisited(true); setEditor("access"); }}>Edit tenant access</button>}
        </section>
        <section className="panel tenant-private-notes"><div className="section-heading"><h2>Management notes</h2><span className="tenant-private-label">Internal</span></div><p className="preserve-lines">{person.managementNotes || "No internal notes added."}</p><p className="section-caption">Visible to authorized management only.</p></section>
      </aside>
    </div>
    {contactVisited && <ResidentEditor id={id} mode="contact" open={editor === "contact"} close={() => { setEditor(null); profile.reload(); }} />}
    {accessVisited && can("members.manage") && <ResidentEditor id={id} mode="access" open={editor === "access"} close={() => { setEditor(null); profile.reload(); }} />}
  </div>;
}

function TenantFinancials({ id }: { id: string }) {
  const [params] = useSearchParams();
  const [view, setView] = useState("all");
  const resource = useResource<Workspace>(`/api/company/resident-profiles/${encodeURIComponent(id)}/workspace`, true, true);
  const data = resource.data;
  // A failed refresh must not present old financial values as a current balance.
  if (resource.error) return <section className="panel tenant-load-state"><h2>Balances and leases unavailable</h2><p role="alert">{resource.error}</p><p>No partial or outdated balances are shown.</p><button className="secondary" onClick={resource.reload}>Try balances again</button></section>;
  if (!data) return <section className="panel tenant-load-state" role="status">Loading balances and lease history…</section>;
  const context = tenantLedgerContext(id, params);
  const rank = (lease: Lease) => lease.status === "ended" ? 4 : lease.status === "draft" ? 3 : lease.startsOn.slice(0, 10) > data.businessDate ? 2 : lease.endsOn && lease.endsOn.slice(0, 10) < data.businessDate ? 1 : 0;
  const rows = data.leases.filter(l => view === "all" || l.status === view).sort((a, b) => rank(a) - rank(b) || b.startsOn.localeCompare(a.startsOn) || a.id.localeCompare(b.id));
  return <>
    <section className="tenant-balance-section" aria-label="Tenant balance overview">
      <div className="section-heading"><h2>Balance overview</h2><span className="section-caption">As of {formatDate(data.businessDate)}</span></div>
      <div className="tenant-metrics">
        <div><span>Rent outstanding</span><strong>{dollars(data.rent.outstandingCents)}</strong><small>Includes {dollars(data.rent.upcomingCents)} not yet due</small></div>
        <div className={BigInt(data.rent.afterGraceCents) > 0n ? "attention" : ""}><span>Rent past grace</span><strong>{dollars(data.rent.afterGraceCents)}</strong><small>Unpaid after the agreed grace period</small></div>
        <div><span>Unapplied rent credit</span><strong>{dollars(data.rent.creditCents)}</strong><small>Received money not yet allocated</small></div>
        <div><span>Deposit held</span><strong>{dollars(data.deposits.heldCents)}</strong><small>{dollars(data.deposits.outstandingCents)} still to collect</small></div>
      </div>
      <p className="section-caption tenant-balance-note">Current recorded balances across all leases. Deposits are separate from rent and are not a verified bank balance.</p>
    </section>
    <section className="panel tenant-leases-panel" aria-label="Tenant leases">
      <div className="section-heading"><div><h2>Leases &amp; balances</h2><p className="section-caption">Rental history and the records behind each balance.</p></div><span className="directory-count">{data.leases.length} {data.leases.length === 1 ? "lease" : "leases"}</span></div>
      <div className="tenant-lease-toolbar"><label>Lease status<select aria-label="Lease status" value={view} onChange={e => setView(e.target.value)}><option value="all">All leases</option><option value="active">Active records</option><option value="draft">Drafts</option><option value="ended">Ended</option></select></label></div>
      {!data.leases.length ? <div className="empty-state"><h3>No lease recorded yet</h3><p>Record a lease to connect this tenant's rental terms and financial history.</p><Link className="button secondary" to="/company/leases?new=lease">Record a lease</Link></div> : !rows.length ? <p className="tenant-muted">No leases match this status.</p> : <ul className="tenant-lease-list">{rows.map(lease => {
        const status = lease.status === "draft" ? "Draft" : lease.status === "ended" ? "Ended" : lease.startsOn.slice(0,10) > data.businessDate ? "Upcoming" : lease.endsOn && lease.endsOn.slice(0,10) < data.businessDate ? "Expired · review needed" : "In effect";
        return <li key={lease.id}>
          <div className="tenant-lease-top"><div><Link className="tenant-property-name" to={`/company/properties/${encodeURIComponent(lease.propertyId)}`}>{lease.property.name}</Link><h3>{lease.unit.label}</h3></div><span className={`tenant-status ${status !== "In effect" ? "neutral" : ""}`}>{status}</span></div>
          <p className="tenant-lease-term">{formatDate(lease.startsOn)} <span aria-hidden="true">—</span> {lease.endsOn ? formatDate(lease.endsOn) : "Open ended"}</p>
          <dl className="tenant-lease-money"><div><dt>Monthly rent</dt><dd>{dollars(lease.rentCents)}</dd></div><div><dt>Rent outstanding</dt><dd>{dollars(lease.rent.outstandingCents)}</dd></div><div><dt>Deposit held</dt><dd>{lease.deposit ? dollars(lease.deposit.heldCents) : "Not set up"}</dd></div></dl>
          <div className="tenant-lease-footer"><span className="section-caption">Due day {lease.rentDueDay} · {lease.graceDays} {lease.graceDays === 1 ? "day" : "days"} grace</span><div className="tenant-lease-actions"><Link to={propertyLink("/company/rent", lease.propertyId, { leaseId: lease.id, ...context })} aria-label={`Open rent ledger for ${lease.unit.label}`}>Rent ledger <span aria-hidden="true">→</span></Link><Link to={propertyLink("/company/deposits", lease.propertyId, { leaseId: lease.id, ...context })} aria-label={`Open deposit details for ${lease.unit.label}`}>Deposit details <span aria-hidden="true">→</span></Link></div></div>
        </li>;
      })}</ul>}
    </section>
  </>;
}
