import { formatDate } from "../dates";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { dollars } from "../money";
import { propertyLink } from "../components/PropertyNavigation";
import { Address } from "../components/Address";
import { leasePath } from "../lease-links";
import type { FeatureKey } from "../company-features";
import "./Overview.css";

type OverviewData = {
  billingIssues?: { count: number; };
  residentApprovals?: { pendingCount: number; };
  company: { name: string; timezone: string; };
  property: { id: string; name: string; } | null;
  today: string;
  generatedAt: string;
  propertyCount: number;
  activeUnitCount: number;
  properties: { id: string; name: string; address: string; city: string; state: string; _count: { units: number; }; }[];
  leases?: {
    inEffectCount: number;
    monthlyRentCents?: string;
    draftCount: number;
    endingSoonCount: number;
    pastEndCount: number;
    withoutCurrentLease: number;
    endingSoon: { id: string; propertyId: string; endsOn: string; property: { name: string; }; unit: { label: string; }; }[];
  };
  maintenance?: {
    reviewCount?: number;
    overdueCount?: number;
    openCount: number;
    highPriorityCount: number;
    latest: { id: string; propertyId: string; title: string; priority: string; status: string; property: { name: string; }; }[];
  };
  rentCollections?: {
    pastDueCents: string;
    afterGraceCents: string;
    withinGraceCents: string;
    pastDueLeaseCount: number;
    afterGraceLeaseCount: number;
  };
  cash?: { rentRefundCents?: string; dateFrom: string; dateTo: string; incomeCents: string; expenseCents: string; netCents: string; };
};
const plural = (count: number, singular: string, multiple = `${singular}s`) => count === 1 ? singular : multiple;
type WorkItem = { title: string; detail: string; count: number; to: string; area: string; };

function WorkList({ items, tone = "normal" }: { items: WorkItem[]; tone?: "normal" | "urgent"; }) {
  return <ul className={`overview-work-list overview-work-list-${tone}`}>
    {items.map(item => <li key={item.title}>
      <Link to={item.to}>
        <span className="overview-work-count" aria-hidden="true">{item.count}</span>
        <span className="overview-work-copy">
          <span className="overview-work-area">{item.area}</span>
          <strong>{item.title}</strong>
          <span>{item.count} {item.detail}</span>
        </span>
        <span className="overview-work-arrow" aria-hidden="true">→</span>
      </Link>
    </li>)}
  </ul>;
}

export function Overview() {
  const { data } = useAuth();
  return <OverviewWorkspace key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`} />;
}

function OverviewWorkspace() {
  const { can, data: auth } = useAuth();
  const writable = (...features: FeatureKey[]) => !auth?.impersonation && features.every(feature => !auth?.companyFeatures || auth.companyFeatures[feature] === "enabled");
  const canStartLease = can("lease.manage") && writable("leasing");
  const canRecordCash = can("finance.manage") && writable("finances", "leasing");
  const canManageResidents = can("resident.assignment.manage") && writable("leasing");
  const canAddProperty = can("property.write") && writable("properties");
  const [params, setParams] = useSearchParams();
  const id = params.get("propertyId") || "";
  const r = useResource<OverviewData>(propertyLink("/api/company/overview", id), true, true);
  const properties = useResource<{ id: string; name: string; }[]>("/api/company/properties", true, true);
  const d = r.data;
  const scopeName = id ? d?.property?.name || properties.data?.find(p => p.id === id)?.name || "Selected property" : "All properties";
  const url = (path: string, extra: Record<string, string> = {}) => propertyLink(path, id, extra);
  const selectProperty = (propertyId: string) => {
    const next = new URLSearchParams(params);
    if (propertyId) next.set("propertyId", propertyId); else next.delete("propertyId");
    setParams(next);
  };
  const urgent: WorkItem[] = [], reviews: WorkItem[] = [], planning: WorkItem[] = [];
  if (d?.billingIssues?.count) urgent.push({ title: "Review recurring billing", count: d.billingIssues.count, detail: `${plural(d.billingIssues.count, "schedule")} ${d.billingIssues.count === 1 ? "needs" : "need"} a check before the next posting`, area: "Rent", to: url("/company/rent", { view: "billing_issues" }) });
  if (d?.rentCollections?.afterGraceLeaseCount) urgent.push({ title: "Follow up rent past grace", count: d.rentCollections.afterGraceLeaseCount, detail: `${plural(d.rentCollections.afterGraceLeaseCount, "lease account")} · ${dollars(d.rentCollections.afterGraceCents)} past grace`, area: "Collections", to: url("/company/rent", { view: "after_grace" }) });
  if (d?.maintenance?.overdueCount) urgent.push({ title: "Follow up overdue maintenance", count: d.maintenance.overdueCount, detail: `${plural(d.maintenance.overdueCount, "request")} past the target date`, area: "Maintenance", to: url("/company/maintenance", { due: "overdue" }) });
  if (d?.leases?.pastEndCount) urgent.push({ title: "Review past-end active leases", count: d.leases.pastEndCount, detail: `${plural(d.leases.pastEndCount, "record")} still marked active after the end date`, area: "Leasing", to: url("/company/leases", { attention: "past_end" }) });
  if (d?.residentApprovals?.pendingCount && can("members.manage")) reviews.push({ title: "Approve resident requests", count: d.residentApprovals.pendingCount, detail: `${plural(d.residentApprovals.pendingCount, "request")} awaiting owner review`, area: "People & access", to: url("/company/leases", { approvals: "pending" }) });
  if (d?.maintenance?.reviewCount) reviews.push({ title: "Review completed work", count: d.maintenance.reviewCount, detail: `${plural(d.maintenance.reviewCount, "request")} awaiting management approval`, area: "Maintenance", to: url("/company/maintenance", { workStatus: "pending_review" }) });
  if (d?.leases?.endingSoonCount) planning.push({ title: "Leases ending within 30 days", count: d.leases.endingSoonCount, detail: `active ${plural(d.leases.endingSoonCount, "record")} to review for renewal or move-out`, area: "Upcoming", to: url("/company/leases", { attention: "ending_soon" }) });
  if (d?.leases?.draftCount) planning.push({ title: "Finish draft leases", count: d.leases.draftCount, detail: `${plural(d.leases.draftCount, "draft record")} ready to continue`, area: "In preparation", to: url("/company/leases", { status: "draft" }) });
  const hasManagementWork = !!d && !!(d.leases || d.maintenance || d.rentCollections || d.billingIssues || d.residentApprovals);

  return <div className="daily-overview">
    <header className="page-heading overview-heading">
      <div>
        <p className="eyebrow">Your workspace</p>
        <h1>Overview</h1>
        <p>{d ? `${d.company.name} · ${new Date(d.today + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}` : "Your portfolio, priorities, and next steps."}</p>
      </div>
      <button className="secondary overview-refresh" onClick={r.reload} disabled={r.loading}>{r.loading ? "Refreshing…" : "Refresh overview"}</button>
    </header>

    <section className="overview-scope" aria-label="Overview scope">
      <div>
        <span className="overview-section-kicker">Working in</span>
        <strong>{scopeName}</strong>
        <p>{id ? "Tasks, totals and source links below follow this property." : "Tasks and totals cover your authorized portfolio."}</p>
      </div>
      <div className="overview-scope-controls">
        <label>Property<select value={id} onChange={event => selectProperty(event.target.value)}>
          <option value="">All properties</option>
          {id && !properties.data?.some(p => p.id === id) && <option value={id}>{scopeName}</option>}
          {properties.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        </label>
        {id && <button className="text-button" onClick={() => selectProperty("")}>Clear property filter</button>}
      </div>
    </section>
    {properties.error && <div className="notice error" role="alert">Property choices could not load. The selected scope is unchanged. <button className="text-button" onClick={properties.reload}>Retry property choices</button>
    </div>}
    {d && r.loading && <p className="overview-refresh-state" role="status">Refreshing your overview. The previous snapshot remains visible.</p>}
    {d && r.error && <div className="notice error overview-refresh-error" role="alert">
      <strong>Overview could not refresh</strong>
      <p>{r.error} Showing the last loaded snapshot; the source records may have changed.</p>
      <button className="secondary" onClick={r.reload}>Try again</button>
    </div>}

    {!d ? <section className="panel overview-load-state">{r.error ? <>
      <h2>Overview unavailable</h2>
      <p role="alert">{r.error}</p>
      <button onClick={r.reload}>Try again</button>
    </> : <p role="status">Loading your overview…</p>}</section> : <>
      {hasManagementWork ? <div className="overview-daily-grid">
        <div className="overview-main-work">
          <section className="panel overview-priorities" aria-labelledby="overview-attention-title">
            <div className="overview-panel-heading">
              <div>
                <span className="overview-section-kicker">Start here</span>
                <h2 id="overview-attention-title">Needs attention</h2>
              </div>
              <span className="overview-scope-label">{scopeName}</span>
            </div>
            {!urgent.length && !reviews.length ? <div className="overview-clear-state">
              <span aria-hidden="true">✓</span>
              <div>
                <h3>No urgent issues or approvals</h3>
                <p>Keep current work moving or plan the next lease handoff below.</p>
              </div>
            </div> : <>
              {!!urgent.length && <div className="overview-work-group" role="group" aria-label="Follow up now">
                <h3>Follow up now</h3>
                <WorkList items={urgent} tone="urgent" />
              </div>}
              {!!reviews.length && <div className="overview-work-group" role="group" aria-label="Review and approve">
                <h3>Review & approve</h3>
                <WorkList items={reviews} />
              </div>}
              <p className="help overview-count-note">Each row opens its matching source view. A record can appear in more than one view.</p>
            </>}
          </section>
          <div className="overview-next-grid">
            {d.maintenance && <section className="panel overview-current-work" aria-labelledby="overview-current-title">
              <div className="overview-panel-heading">
                <div>
                  <span className="overview-section-kicker">Keep work moving</span>
                  <h2 id="overview-current-title">Current maintenance</h2>
                </div>
              </div>
              {d.maintenance.openCount ? <WorkList items={[{ title: "Review maintenance", count: d.maintenance.openCount, detail: `open or in progress · ${d.maintenance.highPriorityCount} high priority`, area: "Active work", to: url("/company/maintenance", { status: "unresolved" }) }]} /> : <p className="overview-empty-copy">No open or in-progress maintenance requests in this view.</p>}
            </section>}
            {d.leases && <section className="panel overview-planning" aria-labelledby="overview-planning-title">
              <div className="overview-panel-heading">
                <div>
                  <span className="overview-section-kicker">Next handoffs</span>
                  <h2 id="overview-planning-title">Plan ahead</h2>
                </div>
              </div>
              {planning.length ? <WorkList items={planning} /> : <p className="overview-empty-copy">No upcoming lease endings or unfinished draft leases in this view.</p>}
              {!!d.leases.endingSoon.length && <details className="overview-ending-preview">
                <summary>Upcoming lease endings · {d.leases.endingSoon.length} shown</summary>
                <ul>{d.leases.endingSoon.map(lease => <li key={lease.id}>
                  <Link to={leasePath(lease.id, { section: "renewal", leaseListAttention: "ending_soon", ...(id ? { leaseListProperty: id, leaseListNested: "true" } : {}) })}>
                    <strong>{lease.property.name} · {lease.unit.label}</strong>
                    <span>Ends {formatDate(lease.endsOn)}</span>
                  </Link>
                </li>)}</ul>
              </details>}
            </section>}
          </div>
        </div>
        <aside className="overview-support" aria-label="Workspace tools">
          {d.cash && <section className="panel overview-cash">
            <div className="overview-panel-heading">
              <div>
                <span className="overview-section-kicker">Recorded cash</span>
                <h2>Month to date</h2>
              </div>
              <Link to={url("/company/reports")}>Reports</Link>
            </div>
            <p className="help">{formatDate(d.cash.dateFrom)} – {formatDate(d.cash.dateTo)}</p>
            <dl className="cash-summary">
              <div>
                <dt>Income received</dt>
                <dd>{dollars(d.cash.incomeCents)}</dd>
              </div>
              <div>
                <dt>Expenses paid</dt>
                <dd>{dollars(d.cash.expenseCents)}</dd>
              </div>{d.cash.rentRefundCents && <div>
                <dt>Rent refunds</dt>
                <dd>{dollars(d.cash.rentRefundCents)}</dd>
              </div>}<div className="cash-total">
                <dt>Net recorded</dt>
                <dd>{dollars(d.cash.netCents)}</dd>
              </div>
            </dl>
            <Link className="text-link" to={url("/company/finances", { dateFrom: d.cash.dateFrom, dateTo: d.cash.dateTo })}>View source transactions →</Link>
            <p className="help compact-note">Voids excluded. Received and paid cash; this does not calculate balances owed.</p>
          </section>}
          {d.propertyCount > 0 && (canAddProperty || canStartLease || canRecordCash || canManageResidents) && <section className="panel overview-start-task">
            <div className="overview-panel-heading">
              <div>
                <span className="overview-section-kicker">Create or continue</span>
                <h2>Start a task</h2>
              </div>
            </div>
            <div className="overview-task-actions">
              {canStartLease && <Link to={url("/company/leases", { new: "lease" })}>
                <strong>Record lease</strong>
                <span>Review the unit, existing account and agreed terms.</span>
                <span aria-hidden="true">→</span>
              </Link>}
              {canRecordCash && <Link to={url("/company/finances", { new: "transaction" })}>
                <strong>Record transaction</strong>
                <span>Record money actually received or paid.</span>
                <span aria-hidden="true">→</span>
              </Link>}
              {canManageResidents && <Link to={id ? `/company/properties/${encodeURIComponent(id)}/residents` : "/company/residents"}>
                <strong>Manage residents</strong>
                <span>Review tenant records and separate portal access.</span>
                <span aria-hidden="true">→</span>
              </Link>}
              {canAddProperty && <Link to="/company/properties?new=property">
                <strong>Add property</strong>
                <span>Create the property before adding its units.</span>
                <span aria-hidden="true">→</span>
              </Link>}
            </div>
          </section>}
        </aside>
      </div> : <section className="panel overview-access-summary">
        <span className="overview-section-kicker">Your property workspace</span>
        <h2>Browse the records shared with you</h2>
        <p>Open a property to view its details and units. Management tasks and financial records follow your current access.</p>
        <Link className="button secondary" to="/company/properties">Browse properties</Link>
      </section>}

      <div className="overview-portfolio">
        <div className="overview-panel-heading">
          <div>
            <span className="overview-section-kicker">At a glance</span>
            <h2 id="overview-portfolio-title">Portfolio snapshot</h2>
          </div>
          <span className="overview-scope-label">{scopeName}</span>
        </div>
        <section className="overview-metrics" aria-label="Portfolio snapshot">
          <Link to="/company/properties">
            <span>Properties</span>
            <strong>{d.propertyCount}</strong>
            <small>View your portfolio →</small>
          </Link>
          <Link to={id ? `/company/properties/${encodeURIComponent(id)}/units` : "/company/properties"}>
            <span>Active units</span>
            <strong>{d.activeUnitCount}</strong>
            <small>Manage unit records →</small>
          </Link>
          {d.leases && <Link to={url("/company/leases", { attention: "in_effect" })}>
            <span>Leases in effect today</span>
            <strong>{d.leases.inEffectCount}</strong>
            <small>{d.leases.withoutCurrentLease} active units without a current lease</small>
          </Link>}
          {d.maintenance && <Link to={url("/company/maintenance")}>
            <span>Open maintenance</span>
            <strong>{d.maintenance.openCount}</strong>
            <small>{d.maintenance.highPriorityCount} high priority · includes in progress</small>
          </Link>}
        </section>
      </div>
      <section className="panel overview-properties" aria-labelledby="overview-properties-title">
        <div className="overview-panel-heading">
          <div>
            <span className="overview-section-kicker">Connected records</span>
            <h2 id="overview-properties-title">{id ? "Selected property" : "Your properties"}</h2>
          </div>
          <Link to="/company/properties">View all properties</Link>
        </div>
        {d.properties.length ? <div className="overview-property-grid">{d.properties.map(property => <Link className="overview-property-card" to={`/company/properties/${encodeURIComponent(property.id)}`} key={property.id}>
          <span className="overview-property-icon" aria-hidden="true">⌂</span>
          <span className="overview-property-copy">
            <strong>{property.name}</strong>
            <Address street={property.address} city={property.city} region={property.state} />
            <small>{property._count.units} {plural(property._count.units, "unit record")}</small>
          </span>
          <span aria-hidden="true">→</span>
        </Link>)}</div> : <div className="empty-state">
          <h3>Build your property workspace</h3>
          <p>Add your first property, then its units and residents.</p>{canAddProperty && <Link className="button" to="/company/properties?new=property">Add your first property</Link>}</div>}
      </section>
      <p className="help overview-data-note">As of {formatDate(d.generatedAt)} at {new Date(d.generatedAt).toLocaleTimeString()} · Company timezone: {d.company.timezone}. Overview updates when you return and while this tab stays open.</p>
    </>}
  </div>;
}
