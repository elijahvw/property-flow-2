import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { useDebouncedValue } from "../useDebouncedValue";
import { useEditorSelection } from "../useEditorSelection";
import { useResource } from "../useResource";
import { formatDate } from "../dates";
import { DateField } from "../components/DateField";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "../components/Form";
import { useEditorNavigationGuard } from "../components/PageLeaveGuard";
import "./Vacancies.css";

type LeaseSource = { id: string; startsOn: string; endsOn: string | null };
export type Vacancy = {
  unitId: string;
  unitLabel: string;
  propertyId: string;
  propertyName: string;
  unitStatus: string;
  operationalStatus: "unreviewed" | "available" | "turnover" | "unavailable";
  availableOn: string | null;
  notes: string | null;
  forRent: boolean;
  listedAt: string | null;
  version: number;
  occupancy: "vacant" | "occupied" | "future";
  currentLease: LeaseSource | null;
  nextLease: LeaseSource | null;
};
type Directory = {
  items: Vacancy[];
  total: number;
  page: number;
  pageSize: number;
  businessDate: string;
  summary: { unreviewed: number; vacant: number; occupied: number; future: number; available: number; turnover: number; unavailable: number; forRent: number; notListed: number };
};
type UnitEditor = Vacancy & { id: string; editor: "readiness" | "listing" };
const operationalLabels = { unreviewed: "Not reviewed", available: "Ready", turnover: "Turnover in progress", unavailable: "Unavailable" };
const occupancyLabels = { vacant: "Vacant", occupied: "Occupied", future: "Upcoming lease" };
const listingLabel = (row: Vacancy) => row.forRent ? "Remove from rental listings" : "List for rent";
const unitLink = (row: Vacancy) => `/company/properties/${encodeURIComponent(row.propertyId)}/units?${new URLSearchParams({ q: row.unitLabel })}`;
const applicationsLink = (row: Vacancy) => `/company/applications?${new URLSearchParams({ propertyId: row.propertyId, unitId: row.unitId })}`;
const inquiryLink = (row: Vacancy) => `/company/applications/prospects/new?${new URLSearchParams({ propertyId: row.propertyId, unitId: row.unitId })}`;

export function Vacancies() {
  const { data } = useAuth();
  const scope = `${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.membership?.role}:${data?.permissions.join(",")}`;
  return <AvailabilityDirectory key={scope} />;
}

function AvailabilityDirectory() {
  const { data: auth } = useAuth();
  const isOwner = auth?.membership?.role === "owner";
  const [params, setParams] = useSearchParams();
  const propertyId = params.get("propertyId") || "";
  const unitId = params.get("unitId") || "";
  const query = params.get("q") || "";
  const search = useDebouncedValue(query.trim());
  const operational = params.get("operational") || "all";
  const occupancy = params.get("occupancy") || "all";
  const listing = params.get("listing") || "all";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const request = new URLSearchParams({ operational, occupancy, listing, page: String(page) });
  for (const [name, value] of Object.entries({ propertyId, unitId, q: search })) if (value) request.set(name, value);
  const resource = useResource<Directory>(`/api/company/vacancies?${request}`, true, true);
  const properties = useResource<{ id: string; name: string }[]>("/api/company/properties", true, true);
  const [selected, select, editorOpen, saveEditorDraft] = useEditorSelection<UnitEditor | null>(null);
  const [choosingUnit, setChoosingUnit] = useState(false);
  const [saved, setSaved] = useState("");
  const [draftRecovery, setDraftRecovery] = useState(false);
  useEditorNavigationGuard({ active: !!selected && !editorOpen, busy: false, uncertain: draftRecovery });
  const change = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (name === "propertyId") next.delete("unitId");
    if (value && value !== "all") next.set(name, value); else next.delete(name);
    setParams(next, { replace: name === "q" });
  };
  const goPage = (nextPage: number) => {
    const next = new URLSearchParams(params);
    if (nextPage > 1) next.set("page", String(nextPage)); else next.delete("page");
    setParams(next);
  };
  const data = resource.data;
  const selectedUnit = data?.items.find(row => row.unitId === unitId);
  return <div className="availability-workspace">
    <header className="page-heading page-heading-row">
      <div><p className="record-kicker">Leasing</p><h1>Availability</h1><p>Review occupancy, rental listings and readiness for each unit. Owners decide which units to list for rent.</p></div>
      <div className="actions"><Link className="button" to={`/company/applications/prospects/new${propertyId ? `?${new URLSearchParams({ propertyId, ...(unitId ? { unitId } : {}) })}` : ""}`}>Record an inquiry</Link><Link className="button secondary" to={`/company/applications${propertyId ? `?${new URLSearchParams({ propertyId, ...(unitId ? { unitId } : {}) })}` : ""}`}>Applications</Link></div>
    </header>
    <section className="panel availability-filter-panel" aria-label="Filter availability">
      <div className="availability-filters">
        <label>Search units or properties<input type="search" value={query} maxLength={200} placeholder="Unit name or property" onChange={event => change("q", event.target.value)} /></label>
        <label>Property<select value={propertyId} onChange={event => change("propertyId", event.target.value)}><option value="">All properties</option>{propertyId && !properties.data?.some(property => property.id === propertyId) && <option value={propertyId}>Selected property</option>}{properties.data?.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
        <label>Occupancy<select value={occupancy} onChange={event => change("occupancy", event.target.value)}><option value="all">All occupancy</option><option value="vacant">Vacant</option><option value="occupied">Occupied</option><option value="future">Upcoming lease</option></select></label>
        <label>Rental listing<select value={listing} onChange={event => change("listing", event.target.value)}><option value="all">All rental listings</option><option value="for_rent">For rent</option><option value="not_listed">Not listed for rent</option></select></label>
        <label>Unit readiness<select value={operational} onChange={event => change("operational", event.target.value)}><option value="all">All readiness settings</option><option value="unreviewed">Not reviewed</option><option value="available">Ready</option><option value="turnover">Turnover in progress</option><option value="unavailable">Unavailable</option></select></label>
      </div>
      <div className="availability-unit-filter"><span>{unitId ? <><strong>Unit filter:</strong> {selectedUnit ? `${selectedUnit.propertyName} · ${selectedUnit.unitLabel}` : "One selected unit"}</> : "Showing all units in this view"}</span><button type="button" className="text-button" onClick={() => setChoosingUnit(true)}>{unitId ? "Choose another unit" : "Filter by unit"}</button>{unitId && <button type="button" className="text-button" onClick={() => change("unitId", "")}>Clear unit filter</button>}</div>
      {properties.error && <p role="alert" className="help">Property choices could not load. Your current availability filters still apply. <button type="button" className="text-button" onClick={properties.reload}>Retry property choices</button></p>}
    </section>
    {saved && <p className="notice" role="status">{saved}</p>}
    {selected && !editorOpen && <section className="notice availability-draft" aria-label="Unfinished unit update"><p>{draftRecovery ? "An interrupted update needs recovery" : "An unfinished update is kept on this page"} for <strong>{selected.propertyName} · {selected.unitLabel}</strong>.</p><button type="button" className="secondary" onClick={() => select(selected)}>Continue {selected.editor === "listing" ? "rental listing" : "readiness"} update</button></section>}
    {resource.error && <section className="notice error" role="alert"><p>{resource.error}</p>{data && <p>The displayed records may be out of date.</p>}<button type="button" className="secondary" onClick={resource.reload}>Try again</button></section>}
    {!data ? !resource.error && <section className="panel" role="status">Loading unit availability…</section> : <>
      <section className="availability-summary" aria-label="Availability summary">
        <div><h2>Occupancy</h2><p>Lease coverage as of {formatDate(data.businessDate)}</p><dl><div><dt>Vacant</dt><dd>{data.summary.vacant}</dd></div><div><dt>Occupied</dt><dd>{data.summary.occupied}</dd></div><div><dt>Upcoming lease</dt><dd>{data.summary.future}</dd></div></dl></div>
        <div><h2>Rental listings</h2><p>Units explicitly listed by an owner in this workspace</p><dl className="availability-pair-counts"><div><dt>For rent</dt><dd>{data.summary.forRent}</dd></div><div><dt>Not listed for rent</dt><dd>{data.summary.notListed}</dd></div></dl></div>
        <div><h2>Unit readiness</h2><p>Preparation for the next rental</p><dl className="availability-readiness-counts"><div><dt>Not reviewed</dt><dd>{data.summary.unreviewed}</dd></div><div><dt>Ready</dt><dd>{data.summary.available}</dd></div><div><dt>Turnover in progress</dt><dd>{data.summary.turnover}</dd></div><div><dt>Unavailable</dt><dd>{data.summary.unavailable}</dd></div></dl></div>
        <p className="help">Counts include every unit matching the property, unit and search filters. Occupancy, rental listing and readiness selections narrow the results below. A vacant or ready unit is not automatically listed for rent. Listing a unit does not change its lease coverage.</p>
      </section>
      <section aria-label="Unit availability results">
        <div className="section-heading"><h2>Units in this view</h2><p role="status">{data.total} matching {data.total === 1 ? "unit" : "units"}{data.total ? ` · Page ${data.page} of ${Math.ceil(data.total / data.pageSize)}` : ""}</p></div>
        {!data.items.length ? <div className="panel empty-state"><h3>No units match this view</h3><p>Try another property, search term, rental listing or readiness setting.</p><Link to="/company/vacancies">Clear availability filters</Link><p className="help">Units are managed from their <Link to="/company/properties">property workspace</Link>.</p></div> : <ul className="availability-list">{data.items.map(row => <li key={row.unitId} className="availability-card">
          <div className="availability-unit-heading"><div><Link className="availability-property" to={`/company/properties/${encodeURIComponent(row.propertyId)}`}>{row.propertyName}</Link><h3><Link to={unitLink(row)}>{row.unitLabel}</Link></h3></div><span className={`availability-tag occupancy-${row.occupancy}`}>{occupancyLabels[row.occupancy]}</span></div>
          <div className="availability-card-details"><section className="availability-rental-listing"><h4>Rental listing</h4><span className={`availability-tag listing-${row.forRent ? "listed" : "not-listed"}`}>{row.forRent ? "For rent" : "Not listed for rent"}</span><p className="help">{row.forRent ? `For rent in your workspace${row.listedAt ? ` · Listed ${formatDate(row.listedAt)}` : ""}` : "An owner must explicitly list this unit for rent."}</p></section><section><h4>Lease coverage</h4>{row.currentLease && <LeaseCoverage lease={row.currentLease} label="Current lease" />}{row.nextLease && <LeaseCoverage lease={row.nextLease} label="Next lease" />}{!row.currentLease && !row.nextLease && <p>No current or future lease is recorded.</p>}</section><section><h4>Unit readiness</h4><span className={`availability-tag readiness-${row.operationalStatus}`}>{operationalLabels[row.operationalStatus]}</span><p>{row.availableOn ? `Ready from ${formatDate(row.availableOn)}` : "Readiness date not recorded"}</p>{row.operationalStatus === "unreviewed" && <p className="help">No readiness review recorded</p>}{row.notes && <p className="availability-notes">{row.notes}</p>}</section></div>
          <div className="availability-card-actions">{isOwner && <button type="button" onClick={() => select({ ...row, id: `listing:${row.unitId}`, editor: "listing" })}>{listingLabel(row)}<span className="sr-only"> for {row.propertyName} · {row.unitLabel}</span></button>}<button type="button" className="secondary" onClick={() => select({ ...row, id: `readiness:${row.unitId}`, editor: "readiness" })}>Update readiness<span className="sr-only"> for {row.propertyName} · {row.unitLabel}</span></button><Link to={inquiryLink(row)}>Record inquiry</Link><Link to={applicationsLink(row)}>View applications</Link></div>
        </li>)}</ul>}
        {(data.page > 1 || data.page * data.pageSize < data.total) && <nav className="availability-pagination" aria-label="Availability pages"><button type="button" className="secondary" disabled={data.page <= 1} onClick={() => goPage(data.page - 1)}>Previous page</button><span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span><button type="button" className="secondary" disabled={data.page * data.pageSize >= data.total} onClick={() => goPage(data.page + 1)}>Next page</button></nav>}
      </section>
    </>}
    {selected && <EditorDialog key={`${selected.id}:${selected.version}`} open={editorOpen} onSaveDraft={interrupted => { setDraftRecovery(!!interrupted); saveEditorDraft(interrupted); }} title={`${selected.editor === "listing" ? listingLabel(selected) : "Update readiness"} · ${selected.unitLabel}`} description={selected.editor === "listing" ? `${selected.propertyName} · Review this rental listing decision before saving.` : `${selected.propertyName} · Readiness is separate from rental listing and lease coverage.`} onClose={() => { select(null); setDraftRecovery(false); }}>
      {selected.editor === "listing" ? <RentalListingEditor row={selected} refresh={resource.reload} saved={current => { select(null); setDraftRecovery(false); setSaved(`${selected.propertyName} · ${selected.unitLabel} is currently ${current.forRent ? "for rent in your workspace" : "not listed for rent"}.${current.forRent === selected.forRent ? " Your request was recovered, and a later saved update changed the listing. Review the current status before making another change." : ""}`); resource.reload(); }} /> : <AvailabilityEditor row={selected} refresh={resource.reload} saved={() => { select(null); setDraftRecovery(false); setSaved(`Readiness updated for ${selected.propertyName} · ${selected.unitLabel}.`); resource.reload(); }} />}
    </EditorDialog>}
    <EditorDialog open={choosingUnit} draftable={false} title="Choose a unit" onClose={() => setChoosingUnit(false)}><UnitPicker propertyId={propertyId} chosen={row => { change("unitId", row.unitId); setChoosingUnit(false); }} /></EditorDialog>
  </div>;
}

function LeaseCoverage({ lease, label }: { lease: LeaseSource; label: string }) {
  return <p className="availability-lease"><Link to={`/company/leases/${encodeURIComponent(lease.id)}`}>{label}</Link><span>{formatDate(lease.startsOn)} – {formatDate(lease.endsOn, "No end date")}</span></p>;
}
function AvailabilityEditor({ row, saved, refresh }: { row: Vacancy; saved: () => void; refresh: () => void }) {
  const [key] = useState(() => crypto.randomUUID());
  return <Form operation="availability.save" label="Save readiness" feedbackText="Unit readiness updated." submit={async form => {
    try {
      await api(`/api/company/units/${encodeURIComponent(row.unitId)}/availability`, { method: "POST", body: { status: form.get("status"), availableOn: form.get("availableOn") || null, notes: form.get("notes") || "", expectedVersion: row.version, submissionKey: key } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) refresh();
      throw error;
    }
    saved();
  }}><label>Unit readiness<select name="status" required defaultValue={row.operationalStatus === "unreviewed" ? "" : row.operationalStatus}><option value="" disabled>Choose a reviewed setting</option><option value="available">Ready</option><option value="turnover">Turnover in progress</option><option value="unavailable">Unavailable</option></select></label><label>Ready from (optional)<DateField name="availableOn" aria-label="Ready from" defaultValue={row.availableOn?.slice(0, 10) || ""} /></label><label>Management note (optional)<textarea name="notes" maxLength={2000} rows={3} defaultValue={row.notes || ""} placeholder="For example, cleaning scheduled before the next move-in" /></label><p className="help">Readiness updates do not list this unit for rent. Updates are recorded with your account and the time of the change. If another person changes this unit, close without saving and reopen to review the latest details.</p></Form>;
}
function RentalListingEditor({ row, saved, refresh }: { row: Vacancy; saved: (current: { forRent: boolean }) => void; refresh: () => void }) {
  const [key] = useState(() => crypto.randomUUID());
  return <Form operation="availability.save" label={listingLabel(row)} feedbackText="Rental listing request completed. Review the current status." submit={async () => {
    let current: { forRent: boolean };
    try {
      current = await api(`/api/company/units/${encodeURIComponent(row.unitId)}/rental-listing`, { method: "POST", body: { forRent: !row.forRent, expectedVersion: row.version, submissionKey: key } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) refresh();
      throw error;
    }
    saved(current);
  }}>
    <dl className="availability-listing-review"><div><dt>Unit</dt><dd>{row.propertyName} · {row.unitLabel}</dd></div><div><dt>Occupancy</dt><dd>{occupancyLabels[row.occupancy]}</dd></div><div><dt>Unit readiness</dt><dd>{operationalLabels[row.operationalStatus]}</dd></div><div><dt>Rental listing after saving</dt><dd>{row.forRent ? "Not listed for rent" : "For rent in your workspace"}</dd></div></dl>
    <p>{row.forRent ? "Remove this unit from your workspace’s rental listings. You can list it again when you decide to rent it." : "List this unit for rent in your company workspace. This does not publish a public advertisement."}</p>
    {row.currentLease && <div className="notice"><p>{row.forRent ? "This unit has a current lease. Removing the rental listing does not end or change that lease." : "This unit has a current lease. Listing it for an upcoming vacancy does not end or change that lease."}</p><LeaseCoverage lease={row.currentLease} label="Current lease" /></div>}
    {row.nextLease && <div className="notice"><p>This unit has an upcoming lease. Its dates remain in place.</p><LeaseCoverage lease={row.nextLease} label="Next lease" /></div>}
    <p className="help">Only an owner can change rental listings. If this unit’s details have changed, close without saving and reopen to review the latest version.</p>
  </Form>;
}
function UnitPicker({ propertyId, chosen }: { propertyId: string; chosen: (row: Vacancy) => void }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(query.trim());
  const request = new URLSearchParams({ page: String(page), ...(propertyId ? { propertyId } : {}), ...(search ? { q: search } : {}) });
  const resource = useResource<Directory>(`/api/company/vacancies?${request}`);
  return <div className="availability-unit-picker"><label>Find a unit<input type="search" autoFocus value={query} maxLength={200} placeholder="Unit or property name" onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>{resource.error ? <div role="alert"><p>{resource.error}</p><button className="secondary" onClick={resource.reload}>Try again</button></div> : !resource.data ? <p role="status">Loading units…</p> : <><p role="status">{resource.data.total} matching {resource.data.total === 1 ? "unit" : "units"}</p><ul>{resource.data.items.map(row => <li key={row.unitId}><button type="button" className="secondary" onClick={() => chosen(row)}><strong>{row.unitLabel}</strong><span>{row.propertyName}</span></button></li>)}</ul>{!resource.data.items.length && <p>No units match. Try another name.</p>}{(resource.data.page > 1 || resource.data.page * resource.data.pageSize < resource.data.total) && <div className="availability-pagination"><button className="secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous units</button><span>Page {page}</span><button className="secondary" disabled={page * resource.data.pageSize >= resource.data.total} onClick={() => setPage(value => value + 1)}>More units</button></div>}</>}</div>;
}
