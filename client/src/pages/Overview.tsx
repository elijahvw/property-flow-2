import { formatDate } from "../dates";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { dollars } from "../money";
import { propertyLink } from "../components/PropertyNavigation";
type OverviewData = {
  billingIssues?:{count:number};
  residentApprovals?: {pendingCount:number};
  company: { name: string; timezone: string };
  property: { id: string; name: string } | null;
  today: string;
  generatedAt: string;
  propertyCount: number;
  activeUnitCount: number;
  properties: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    _count: { units: number };
  }[];
  leases?: {
    inEffectCount: number;
    monthlyRentCents: string;
    draftCount: number;
    endingSoonCount: number;
    pastEndCount: number;
    withoutCurrentLease: number;
    endingSoon: {
      id: string;
      propertyId: string;
      endsOn: string;
      property: { name: string };
      unit: { label: string };
    }[];
  };
  maintenance?: {
    reviewCount?:number;overdueCount?:number;
    openCount: number;
    highPriorityCount: number;
    latest: {
      id: string;
      propertyId: string;
      title: string;
      priority: string;
      status: string;
      property: { name: string };
    }[];
  };
  rentCollections?: {
    pastDueCents: string;
    afterGraceCents: string;
    withinGraceCents: string;
    pastDueLeaseCount: number;
    afterGraceLeaseCount: number;
  };
  cash?: {
    rentRefundCents?:string;
    dateFrom: string;
    dateTo: string;
    incomeCents: string;
    expenseCents: string;
    netCents: string;
  };
};
export function Overview() {
  const { data } = useAuth();
  return (
    <OverviewWorkspace
      key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`}
    />
  );
}
function OverviewWorkspace() {
  const { can } = useAuth(),
    [params, setParams] = useSearchParams(),
    id = params.get("propertyId") || "";
  const r = useResource<OverviewData>(
      propertyLink("/api/company/overview", id),
      false,
      true,
    ),
    properties = useResource<{ id: string; name: string }[]>(
      "/api/company/properties",
      true,
      true,
    ),
    d = r.data;
  const needsAttention = !!d && [d.residentApprovals?.pendingCount,d.rentCollections?.afterGraceLeaseCount,d.maintenance?.openCount,d.maintenance?.reviewCount,d.maintenance?.overdueCount,d.leases?.endingSoonCount,d.leases?.draftCount,d.leases?.pastEndCount,d.billingIssues?.count].some(value=>(value||0)>0);
  const url = (path: string, extra: Record<string, string> = {}) =>
    propertyLink(path, id, extra);
  return (
    <>
      <header className="page-heading page-heading-row">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1>Overview</h1>
          <p>
            {d
              ? `${d.company.name} · ${new Date(d.today + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`
              : "Your portfolio, priorities, and next steps."}
          </p>
        </div>
        <label className="scope-filter">
          Property
          <select
            value={id}
            onChange={(e) =>
              setParams(e.target.value ? { propertyId: e.target.value } : {})
            }
          >
            <option value="">All properties</option>
            {properties.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      {properties.error && (
        <p role="alert">
          Property choices could not load.{" "}
          <button className="text-button" onClick={properties.reload}>
            Try again
          </button>
        </p>
      )}
      {!d ? (
        <section className="panel">
          {r.error ? (
            <>
              <h2>Overview unavailable</h2>
              <p role="alert">{r.error}</p>
              <button onClick={r.reload}>Try again</button>
            </>
          ) : (
            <p role="status">Loading your overview…</p>
          )}
        </section>
      ) : (
        <>
          <section className="overview-metrics" aria-label="Portfolio snapshot">
            <Link to="/company/properties">
              <span>Properties</span>
              <strong>{d.propertyCount}</strong>
              <small>View your portfolio →</small>
            </Link>
            <Link
              to={
                id
                  ? `/company/properties/${encodeURIComponent(id)}/units`
                  : "/company/properties"
              }
            >
              <span>Active units</span>
              <strong>{d.activeUnitCount}</strong>
              <small>Manage unit records →</small>
            </Link>
            {d.leases && (
              <Link to={url("/company/leases", { attention: "in_effect" })}>
                <span>Leases in effect today</span>
                <strong>{d.leases.inEffectCount}</strong>
                <small>
                  {d.leases.withoutCurrentLease} active units without a current
                  lease
                </small>
              </Link>
            )}
            {d.maintenance && (
              <Link to={url("/company/maintenance")}>
                <span>Open maintenance</span>
                <strong>{d.maintenance.openCount}</strong>
                <small>
                  {d.maintenance.highPriorityCount} high priority · includes in
                  progress
                </small>
              </Link>
            )}
          </section>
          <div className="workspace-columns">
            <div>
              {(d.leases || d.maintenance || d.rentCollections) && (
                <section className="panel">
                  <div className="section-heading">
                    <h2>Needs attention</h2>
                    <span className="badge">Saved records</span>
                  </div>
                  {!needsAttention && <p>No outstanding tasks need attention. Your portfolio records remain available below.</p>}
                  <div className="attention-list">
                    {!!d.billingIssues?.count&&<Link to={url("/company/rent",{view:"billing_issues"})}><span className="attention-icon">!</span><div><strong>Review recurring billing</strong><span>{d.billingIssues.count} schedules need a check</span></div><span aria-hidden="true">→</span></Link>}
                    {!!d.maintenance?.reviewCount&&<Link to={url("/company/maintenance",{workStatus:"pending_review"})}><span className="attention-icon">↗</span><div><strong>Review completed work</strong><span>{d.maintenance.reviewCount} awaiting management approval</span></div><span aria-hidden="true">→</span></Link>}
                    {!!d.maintenance?.overdueCount&&<Link to={url("/company/maintenance",{due:"overdue"})}><span className="attention-icon">!</span><div><strong>Follow up overdue maintenance</strong><span>{d.maintenance.overdueCount} requests past their target date</span></div><span aria-hidden="true">→</span></Link>}
                    {d.residentApprovals&&d.residentApprovals.pendingCount>0&&<Link to={url("/company/leases",{approvals:"pending"})}><span className="attention-icon">↗</span><div><strong>Approve resident requests</strong><span>{d.residentApprovals.pendingCount} awaiting owner review</span></div><span aria-hidden="true">→</span></Link>}
                    {!!d.rentCollections?.afterGraceLeaseCount && (
                      <Link to={url("/company/rent", { view: "after_grace" })}>
                        <span className="attention-icon">↗</span>
                        <div>
                          <strong>Follow up rent past grace</strong>
                          <span>
                            {dollars(d.rentCollections.afterGraceCents)} across{" "}
                            {d.rentCollections.afterGraceLeaseCount} lease
                            accounts ·{" "}
                            {dollars(d.rentCollections.withinGraceCents)} still
                            within grace
                          </span>
                        </div>
                        <span aria-hidden="true">→</span>
                      </Link>
                    )}
                    {!!d.maintenance?.openCount && (
                      <Link
                        to={url("/company/maintenance", {
                          status: "unresolved",
                        })}
                      >
                        <span className="attention-icon">↗</span>
                        <div>
                          <strong>Review maintenance</strong>
                          <span>
                            {d.maintenance.openCount} open or in progress ·{" "}
                            {d.maintenance.highPriorityCount} high priority
                          </span>
                        </div>
                        <span aria-hidden="true">→</span>
                      </Link>
                    )}
                    {d.leases && (
                      <>
                        {d.leases.endingSoonCount>0&&<Link
                          to={url("/company/leases", {
                            attention: "ending_soon",
                          })}
                        >
                          <span className="attention-icon">◷</span>
                          <div>
                            <strong>Leases ending within 30 days</strong>
                            <span>
                              {d.leases.endingSoonCount} active records to
                              review
                            </span>
                          </div>
                          <span aria-hidden="true">→</span>
                        </Link>}
                        {d.leases.draftCount>0&&<Link to={url("/company/leases", { status: "draft" })}>
                          <span className="attention-icon">≡</span>
                          <div>
                            <strong>Finish draft leases</strong>
                            <span>{d.leases.draftCount} draft records</span>
                          </div>
                          <span aria-hidden="true">→</span>
                        </Link>}
                        {d.leases.pastEndCount > 0 && (
                          <Link
                            to={url("/company/leases", {
                              attention: "past_end",
                            })}
                          >
                            <span className="attention-icon">!</span>
                            <div>
                              <strong>Review past-end active leases</strong>
                              <span>
                                {d.leases.pastEndCount} records still marked
                                active
                              </span>
                            </div>
                            <span aria-hidden="true">→</span>
                          </Link>
                        )}
                      </>
                    )}
                  </div>
                </section>
              )}
              <section className="panel">
                <div className="section-heading">
                  <h2>{id ? "Selected property" : "Your properties"}</h2>
                  <Link to="/company/properties">View all</Link>
                </div>
                {d.properties.length ? (
                  <div className="property-cards">
                    {d.properties.map((p) => (
                      <Link
                        to={`/company/properties/${encodeURIComponent(p.id)}`}
                        key={p.id}
                      >
                        <span className="property-card-icon" aria-hidden="true">
                          ⌂
                        </span>
                        <div>
                          <h3>{p.name}</h3>
                          <p>
                            {p.address} · {p.city}, {p.state}
                          </p>
                          <small>{p._count.units} unit records</small>
                        </div>
                        <span aria-hidden="true">→</span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <h3>Build your property workspace</h3>
                    <p>
                      Add your first property, then its units and residents.
                    </p>
                    {can("property.write") && (
                      <Link
                        className="button"
                        to="/company/properties?new=property"
                      >
                        Add your first property
                      </Link>
                    )}
                  </div>
                )}
              </section>
            </div>
            <aside>
              {can("property.write") && (
                <section className="panel">
                  <h2>Quick actions</h2>
                  <div className="quick-action-list">
                    {can("finance.manage") && (
                      <Link to={url("/company/rent")}>
                        Manage rent & balances →
                      </Link>
                    )}
                    {can("property.write") && (
                      <Link to="/company/properties?new=property">
                        ＋ Add property
                      </Link>
                    )}
                    {can("lease.manage") && (
                      <Link to={url("/company/leases", { new: "lease" })}>
                        ＋ Record lease
                      </Link>
                    )}
                    {can("finance.manage") && (
                      <Link
                        to={url("/company/finances", { new: "transaction" })}
                      >
                        ＋ Record transaction
                      </Link>
                    )}
                    {can("resident.assignment.manage") && (
                      <Link
                        to={
                          id
                            ? `/company/properties/${encodeURIComponent(id)}/residents`
                            : "/company/residents"
                        }
                      >
                        Manage residents →
                      </Link>
                    )}
                  </div>
                </section>
              )}
              {d.cash && (
                <section className="panel">
                  <div className="section-heading">
                    <h2>Month to date</h2>
                    <Link to={url("/company/reports")}>Reports</Link>
                  </div>
                  <p className="help">
                    {formatDate(d.cash.dateFrom)} – {formatDate(d.cash.dateTo)} · received / paid
                  </p>
                  <dl className="cash-summary">
                    <div>
                      <dt>Income received</dt>
                      <dd>{dollars(d.cash.incomeCents)}</dd>
                    </div>
                    <div>
                      <dt>Expenses paid</dt>
                      <dd>{dollars(d.cash.expenseCents)}</dd>
                    </div>
                    {d.cash.rentRefundCents&&<div><dt>Rent refunds</dt><dd>{dollars(d.cash.rentRefundCents)}</dd></div>}
                    <div className="cash-total">
                      <dt>Net recorded</dt>
                      <dd>{dollars(d.cash.netCents)}</dd>
                    </div>
                  </dl>
                  <Link
                    className="text-link"
                    to={url("/company/finances", {
                      dateFrom: d.cash.dateFrom,
                      dateTo: d.cash.dateTo,
                    })}
                  >
                    View source transactions →
                  </Link>
                  <p className="help compact-note">
                    Voids excluded. Recorded cash only; this does not calculate
                    balances owed.
                  </p>
                </section>
              )}
              {d.leases && (
                <section className="panel">
                  <h2>Upcoming lease endings</h2>
                  {d.leases.endingSoon.length ? (
                    <ul className="overview-events">
                      {d.leases.endingSoon.map((l) => (
                        <li key={l.id}>
                          <Link
                            to={`/company/leases/${encodeURIComponent(l.id)}?section=renewal`}
                          >
                            <strong>
                              {l.property.name} · {l.unit.label}
                            </strong>
                            <span>Ends {formatDate(l.endsOn)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="help">
                      No active leases end in the next 30 days.
                    </p>
                  )}
                </section>
              )}
            </aside>
          </div>
          <p className="help">
            As of {new Date(d.generatedAt).toLocaleTimeString()} · Company
            timezone: {d.company.timezone}. Overview updates when you return and
            while this tab stays open.
          </p>
        </>
      )}
    </>
  );
}
