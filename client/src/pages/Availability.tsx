import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { formatActivityTime, formatDate } from "../dates";
import { dollars } from "../money";
import { useResource } from "../useResource";
import { DateField } from "../components/DateField";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "../components/Form";
import { tenantEditorScope } from "../tenant-write-access";
import { AcquisitionRecovery } from "../components/AcquisitionRecovery";
import { hasAcquisitionRecovery, useAcquisitionMutation } from "../acquisition-mutations";
import "./Availability.css";

type Condition = "ready" | "turnover" | "unavailable" | "unconfirmed";
type State = "occupied" | "future_occupancy" | "ready" | "turnover" | "unavailable" | "unconfirmed" | "archived";
type Lease = { id: string; startsOn: string; endsOn: string | null; status: string };
type AvailabilityReview = { version: number; condition: Condition; availableOn: string | null; reason: string; updatedAt: string };
type Entry = {
  unit: { id: string; propertyId: string; label: string; status: string; version: number; marketRentCents: number | null; property: { id: string; name: string } };
  availability: AvailabilityReview | null;
  state: State;
  readinessStale: boolean;
  listing?: { version: number | null; forRent: boolean; listedAt: string | null };
  currentLease: Lease | null;
  nextLease: Lease | null;
  latestLeaseEnd: string | null;
};
type Board = { today?: string; planningDate: string; timezone: string; definition: string; items: Entry[]; total: number; counts: Record<State, number>; nextCursor: string | null };
const states: [State, string][] = [["occupied", "Recorded occupied"], ["future_occupancy", "Future occupancy"], ["ready", "Vacant & ready"], ["turnover", "Turnover"], ["unavailable", "Unavailable"], ["unconfirmed", "Readiness unconfirmed"], ["archived", "Archived"]];
const stateLabel = (state: string) => states.find(([key]) => key === state)?.[1] || state;
const conditionLabel = (condition: Condition) => ({ ready: "Vacant & ready", turnover: "Turnover", unavailable: "Unavailable", unconfirmed: "Readiness unconfirmed" })[condition];
const endpoint = "/api/company/availability";
const unitEndpoint = (id: string) => `/api/company/units/${encodeURIComponent(id)}/availability`;

function Loading({ error, retry }: { error?: string; retry: () => void }) {
  return error ? <p className="notice error" role="alert">{error} <button className="secondary" onClick={retry}>Retry availability</button></p> : <p role="status">Loading availability…</p>;
}

export function Availability() {
  const { data } = useAuth();
  return <AvailabilityWorkspace key={tenantEditorScope(data)}/>;
}
function AvailabilityWorkspace() {
  const { data } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ["propertyId", "q", "status", "asOf", "cursor", "listing"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const resource = useResource<Board>(`${endpoint}?${query}`, true, true);
  const properties = useResource<{ id: string; name: string }[]>("/api/company/properties");
  const [draft, setDraft] = useState<{ entry: Entry; key: string; today: string } | null>(null);
  const [open, setOpen] = useState(false), [history, setHistory] = useState<Entry | null>(null);
  const [listing, setListing] = useState<Entry | null>(null), [listingHistory, setListingHistory] = useState<Entry | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const currentCursor = params.get("cursor") || "";
  useEffect(() => {
    setCursors(previous => !currentCursor ? [] : previous.includes(currentCursor) ? previous.slice(0, previous.indexOf(currentCursor) + 1) : []);
  }, [currentCursor]);
  const readOnly = !!data?.impersonation || data?.companyFeatures?.leasing === "read_only" || data?.companyFeatures?.properties === "read_only";
  const reset = () => { setOpen(false); setDraft(null); };
  const filter = (values: Record<string, string>) => {
    setCursors([]);
    const next = new URLSearchParams(params);
    next.delete("cursor");
    for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key);
    setParams(next);
  };
  const changePage = (cursor: string | null, previous = false) => {
    const next = new URLSearchParams(params);
    if (previous) {
      const prior = cursors.slice(0, -1);
      prior.length ? next.set("cursor", prior[prior.length - 1]) : next.delete("cursor");
      setCursors(prior);
    } else if (cursor) {
      setCursors(current => [...current, cursor]); next.set("cursor", cursor);
    }
    setParams(next);
  };
  if ([401, 403, 404].includes(resource.errorStatus || 0)) return <Loading error={resource.error || "This availability workspace is unavailable."} retry={resource.reload}/>;
  return <>
    <header className="page-heading"><p className="eyebrow">Leasing operations</p><h1>Availability & turnover</h1><p>Review recorded occupancy, upcoming leases and the unit's confirmed operational condition.</p></header>
    <p className="notice">An empty lease slot does not confirm physical vacancy. Mark a unit ready only after reviewing its actual condition. Planning dates use current lease records; they do not reconstruct historical occupancy.</p>
    <form className="availability-filters panel" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      filter(Object.fromEntries(["q", "propertyId", "status", "asOf", "listing"].map(key => [key, String(form.get(key) || "")])));
    }} key={`${params.get("q") || ""}:${params.get("propertyId") || ""}:${params.get("status") || ""}:${params.get("asOf") || ""}:${params.get("listing") || ""}`}>
      <label>Find a unit or property<input type="search" name="q" maxLength={200} defaultValue={params.get("q") || ""}/></label>
      <label>Property<select name="propertyId" defaultValue={params.get("propertyId") || ""}><option value="">All properties</option>{properties.data?.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
      <label>Availability state<select name="status" defaultValue={params.get("status") || ""}><option value="">All states</option>{states.map(([state, label]) => <option key={state} value={state}>{label}</option>)}</select></label>
      <label>Rental listing<select name="listing" defaultValue={params.get("listing") || ""}><option value="">All listing states</option><option value="for_rent">For rent</option><option value="not_listed">Not listed for rent</option></select></label>
      <label>Planning date<DateField aria-label="Planning date" name="asOf" defaultValue={params.get("asOf") || ""}/></label>
      <div className="actions"><button className="secondary" type="submit">Apply availability filters</button><button className="text-button" type="button" onClick={() => filter({ q: "", propertyId: "", status: "", asOf: "", listing: "" })}>Clear filters</button></div>
    </form>
    {properties.error && <p className="notice error" role="alert">Property filters could not load. <button className="secondary" onClick={properties.reload}>Retry properties</button></p>}
    {draft && !open && <p className="notice">A readiness review for <strong>{draft.entry.unit.label}</strong> is kept on this page. <button className="secondary" onClick={() => setOpen(true)}>Continue readiness review</button></p>}
    {!resource.data && <Loading error={resource.error} retry={resource.reload}/>}
    {resource.data && <>
      {resource.error && <Loading error={resource.error} retry={resource.reload}/>}
      <section className="panel" aria-labelledby="availability-results-title">
        <div className="section-heading"><div><h2 id="availability-results-title">Unit availability</h2><p>Planning date {formatDate(resource.data.planningDate)} · {resource.data.timezone}</p></div><strong>{resource.data.total.toLocaleString()} matching {resource.data.total === 1 ? "unit" : "units"}</strong></div>
        <p className="help">{resource.data.definition}</p>
        <p className="help">State totals cover the selected property and search and rental-listing filters before applying the availability-state filter.</p>
        <dl className="availability-summary" aria-label="Matching units by state">{states.map(([state, label]) => <div key={state}><dt>{label}</dt><dd>{resource.data!.counts[state] ?? 0}</dd></div>)}</dl>
        {!resource.data.items.length ? <p>No units match these availability filters. Review the filters or add a unit from its property.</p> : <div className="table-wrap"><table className="availability-table"><thead><tr><th scope="col">Property & unit</th><th scope="col">Availability</th><th scope="col">Recorded lease sources</th><th scope="col">Operational review</th><th scope="col">Actions</th></tr></thead><tbody>{resource.data.items.map(entry => <tr key={entry.unit.id}>
          <td><Link to={`/company/properties/${encodeURIComponent(entry.unit.propertyId)}`}>{entry.unit.property.name}</Link><br/><strong><Link to={`/company/properties/${encodeURIComponent(entry.unit.propertyId)}/units?${new URLSearchParams({ q: entry.unit.label })}`}>{entry.unit.label}</Link></strong>{entry.unit.marketRentCents != null && <p className="help">Asking amount {dollars(entry.unit.marketRentCents)}/month</p>}</td>
          <td><strong>{entry.currentLease ? "Occupied" : "Not occupied"}</strong><p className="help">{stateLabel(entry.state)}</p><p><span className={`status-pill ${entry.listing?.forRent ? "active" : "draft"}`}>{entry.listing?.forRent ? "For rent" : "Not listed for rent"}</span></p><p className="help">Listing intent is an explicit owner decision, separate from readiness and recorded occupancy.</p>{entry.readinessStale && <p className="help">A tenancy followed the last ready review. Confirm readiness again.</p>}{entry.state === "unconfirmed" && <p className="help">No current lease is recorded; physical readiness is unconfirmed.</p>}</td>
          <td>{entry.currentLease && <p><Link to={`/company/leases/${encodeURIComponent(entry.currentLease.id)}`}>Current recorded lease</Link><br/><span className="help">{formatDate(entry.currentLease.startsOn)} – {formatDate(entry.currentLease.endsOn, "Open ended")}</span></p>}{entry.nextLease && <p><Link to={`/company/leases/${encodeURIComponent(entry.nextLease.id)}`}>Upcoming recorded lease</Link><br/><span className="help">Starts {formatDate(entry.nextLease.startsOn)}</span></p>}{!entry.currentLease && !entry.nextLease && <p className="help">No current or upcoming active lease recorded.</p>}<Link to={`/company/properties/${encodeURIComponent(entry.unit.propertyId)}/leases?${new URLSearchParams({ unitId: entry.unit.id })}`}>Unit lease history</Link></td>
          <td>{entry.availability ? <><strong>{conditionLabel(entry.availability.condition)}</strong>{entry.availability.availableOn && <p className="help">{entry.availability.condition === "ready" ? "Confirmed ready from" : "Estimated available from"} {formatDate(entry.availability.availableOn)}</p>}<p>{entry.availability.reason}</p><p className="help">Reviewed {formatActivityTime(entry.availability.updatedAt)}</p>{["turnover", "unavailable"].includes(entry.availability.condition) && <p className="help">An estimate does not automatically mark the unit ready.</p>}</> : <p className="help">No operational readiness review recorded.</p>}</td>
          <td><div className="availability-actions">{entry.unit.status !== "archived" ? <button className="secondary" disabled={readOnly || !!draft || !!listing} onClick={() => { setDraft({ entry, key: crypto.randomUUID(), today: resource.data!.today || resource.data!.planningDate }); setOpen(true); }}>Review {entry.unit.label} readiness</button> : <p className="help">Restore the archived unit before changing readiness.</p>}{data?.membership?.role === "owner" && (entry.unit.status !== "archived" || hasAcquisitionRecovery(`listing:${entry.unit.id}`, data?.user.id, data?.membership?.companyId)) && <button className="secondary" disabled={readOnly || !!draft || !!listing} onClick={() => setListing(entry)}>{hasAcquisitionRecovery(`listing:${entry.unit.id}`, data?.user.id, data?.membership?.companyId) ? `Recover original ${entry.unit.label} listing request` : `Review ${entry.unit.label} rental listing`}</button>}<button className="text-button" onClick={() => setHistory(entry)}>Readiness history for {entry.unit.label}</button><button className="text-button" onClick={() => setListingHistory(entry)}>Rental listing history for {entry.unit.label}</button><Link to={`/company/maintenance?${new URLSearchParams({ propertyId: entry.unit.propertyId })}`}>Property maintenance</Link></div></td>
        </tr>)}</tbody></table></div>}
        <div className="actions"><button className="secondary" disabled={!currentCursor} onClick={() => changePage(null, true)}>Previous units</button><button className="secondary" disabled={!resource.data.nextCursor} onClick={() => changePage(resource.data!.nextCursor)}>Next units</button></div>
      </section>
    </>}
    <EditorDialog open={open} title="Review unit readiness" onClose={() => setOpen(false)} onDiscard={() => { reset(); resource.reload(); }} onSaveDraft={() => setOpen(false)}>
      {draft && <Form key={draft.key} operation="availability.update" label="Save readiness review" feedbackText="Readiness review saved." submit={async form => {
        await api(unitEndpoint(draft.entry.unit.id), { method: "PUT", body: { expectedVersion: draft.entry.availability?.version ?? null, condition: String(form.get("condition")), availableOn: String(form.get("availableOn") || "") || null, reason: String(form.get("reason") || ""), submissionKey: draft.key } });
        reset(); resource.reload();
      }}><ReadinessFields entry={draft.entry} today={draft.today}/><p className="help">This records operational readiness only. It does not end a lease, reserve a unit, create an application or promise a future vacancy. The review and its reason remain in history. If this record changes elsewhere, discard this review and reopen it to use the latest version.</p></Form>}
    </EditorDialog>
    {listing && <ListingReview key={listing.unit.id} entry={listing} readOnly={readOnly} close={() => setListing(null)} saved={() => { setListing(null); resource.reload(); }}/>}
    <EditorDialog open={!!history} title={history ? `Readiness history · ${history.unit.label}` : "Readiness history"} draftable={false} onClose={() => setHistory(null)}>{history && <ReadinessHistory key={history.unit.id} unitId={history.unit.id}/>}</EditorDialog>
    <EditorDialog open={!!listingHistory} title={listingHistory ? `Rental listing history · ${listingHistory.unit.label}` : "Rental listing history"} draftable={false} onClose={() => setListingHistory(null)}>{listingHistory && <RentalListingHistory key={listingHistory.unit.id} unitId={listingHistory.unit.id}/>}</EditorDialog>
  </>;
}

function ReadinessFields({ entry, today }: { entry: Entry; today: string }) {
  const [condition, setCondition] = useState<Condition>(entry.availability?.condition || (entry.currentLease ? "turnover" : "ready"));
  return <><p><strong>{entry.unit.property.name} · {entry.unit.label}</strong></p><p>Current planning state: {stateLabel(entry.state)}.</p><fieldset><legend>Operational condition</legend><label>Condition<select name="condition" value={condition} onChange={event => setCondition(event.target.value as Condition)}><option value="ready">Vacant & ready</option><option value="turnover">Turnover</option><option value="unavailable">Unavailable</option><option value="unconfirmed">Clear readiness confirmation</option></select></label>{condition !== "unconfirmed" && <label>{condition === "ready" ? "Readiness confirmed on" : "Estimated available from (optional)"}<DateField key={condition === "ready" ? "confirmed" : "estimated"} aria-label={condition === "ready" ? "Readiness confirmed on" : "Estimated available from (optional)"} name="availableOn" defaultValue={entry.availability?.availableOn || (condition === "ready" ? today : "")} required={condition === "ready"} max={condition === "ready" ? today : undefined}/></label>}<p className="help">{condition === "ready" ? "Confirm an observed condition, using today or an earlier date. A current recorded tenancy must be resolved first." : condition === "unconfirmed" ? "Clear the current operational confirmation while retaining its earlier reviews. This does not change any lease." : "Estimated dates support planning. Change the condition to ready only after confirming the unit is ready."}</p></fieldset><label>Reason for this readiness review<textarea name="reason" required maxLength={500} rows={4}/></label></>;
}

function ReadinessHistory({ unitId }: { unitId: string }) {
  const [cursors, setCursors] = useState<string[]>([]);
  const resource = useResource<{ items: { id: string; version: number; snapshot: { condition: Condition; availableOn: string | null }; reason: string; createdAt: string }[]; nextCursor: string | null }>(`${unitEndpoint(unitId)}/history${cursors.length ? `?cursor=${encodeURIComponent(cursors[cursors.length - 1])}` : ""}`);
  if (!resource.data) return <Loading error={resource.error} retry={resource.reload}/>;
  return <>{resource.error && <Loading error={resource.error} retry={resource.reload}/>}<p className="help">Recorded operational reviews are retained. Lease records and actual occupancy remain separate.</p>{resource.data.items.length ? <ol className="record-list">{resource.data.items.map(review => <li key={review.id}><strong>Revision {review.version} · {conditionLabel(review.snapshot.condition)}</strong><p>{review.reason}</p><p className="help">Reviewed {formatActivityTime(review.createdAt)}{review.snapshot.availableOn ? ` · ${review.snapshot.condition === "ready" ? "Confirmed ready from" : "Estimated available from"} ${formatDate(review.snapshot.availableOn)}` : ""}</p></li>)}</ol> : <p>No readiness reviews have been recorded.</p>}<div className="actions"><button className="secondary" disabled={!cursors.length} onClick={() => setCursors(current => current.slice(0, -1))}>Previous reviews</button><button className="secondary" disabled={!resource.data.nextCursor} onClick={() => setCursors(current => [...current, resource.data!.nextCursor!])}>Next reviews</button></div></>;
}

function ListingReview({ entry, readOnly, close, saved }: { entry: Entry; readOnly: boolean; close: () => void; saved: () => void }) {
  const mutation = useAcquisitionMutation(`listing:${entry.unit.id}`);
  const [open, setOpen] = useState(true);
  const original = mutation.initial?.body;
  if (mutation.denied) return <EditorDialog open title="Rental listing access unavailable" draftable={false} onClose={close}><p className="notice error" role="alert">This listing review is hidden because current access is unavailable. An interrupted original request is kept for authorized recovery.</p><button type="button" onClick={() => window.location.reload()}>Reload workspace</button></EditorDialog>;
  return <>{!open && <p className="notice">A rental listing review is kept on this page. <button className="secondary" onClick={() => setOpen(true)}>Continue rental listing review</button></p>}<EditorDialog open={open} title={`Review rental listing · ${entry.unit.label}`} onClose={close} onSaveDraft={() => setOpen(false)}>
    <AcquisitionRecovery mutation={mutation} sourcePath={`/api/company/availability?unitId=${encodeURIComponent(entry.unit.id)}`} sourceId={entry.unit.id} resolved={close}/>
    <Form operation="availability.listing" label="Save rental listing" recovering={mutation.pending} feedbackText="Rental listing intent saved." submit={async form => {
      if (readOnly) throw new Error("Rental listing changes are read-only under the current company settings.");
      await mutation.run(`/api/company/units/${encodeURIComponent(entry.unit.id)}/rental-listing`, "POST", { forRent: form.get("forRent") === "true", expectedVersion: entry.listing?.version ?? null, expectedAvailabilityVersion: entry.availability?.version ?? null, reason: String(form.get("reason") || "") });
      if (mutation.current()) saved();
    }}>
      <p><strong>{entry.unit.property.name} · {entry.unit.label}</strong></p><p className="help">Vacancy, a readiness review and a future lease never list a unit automatically. This records the owner's internal rental-listing intent; it does not publish an advertisement, reserve a unit or change lease dates.</p>
      {readOnly && <p className="notice" role="status">Rental listing changes are read-only. The original review is kept.</p>}
      {mutation.pending && <p className="notice">The original interrupted listing request is kept. Retry its exact reviewed details before starting another action.</p>}
      <fieldset disabled={readOnly || mutation.pending}>
        <label>Rental listing intent<select name="forRent" defaultValue={String(original?.forRent ?? entry.listing?.forRent ?? false)}><option value="false">Not listed for rent</option><option value="true">For rent</option></select></label>
        <label>Reason for listing review<textarea name="reason" required maxLength={500} defaultValue={String(original?.reason ?? "")}/></label>
      </fieldset>
      <p className="help">The opening listing and readiness versions are retained. If either changes before this action is saved, review the current source before making a new decision.</p>
    </Form>
  </EditorDialog></>;
}

function RentalListingHistory({ unitId }: { unitId: string }) {
  const [page, setPage] = useState(1);
  const resource = useResource<{ items: { id: string; version: number; action: string; actorName: string; reason: string | null; createdAt: string }[]; total: number; pageSize: number }>(`/api/company/units/${encodeURIComponent(unitId)}/rental-listing/history?page=${page}`);
  if (!resource.data) return <Loading error={resource.error} retry={resource.reload}/>;
  return <>{resource.error && <Loading error={resource.error} retry={resource.reload}/>}<p className="help">Explicit owner decisions are retained separately from readiness reviews, occupancy and lease history.</p>{resource.data.items.length ? <ol className="record-list">{resource.data.items.map(review => <li key={review.id}><strong>Revision {review.version} · {review.action === "listed" ? "Listed for rent" : "Not listed for rent"}</strong><p>{review.reason || "No additional reason recorded."}</p><p className="help">{review.actorName} · {formatActivityTime(review.createdAt)}</p></li>)}</ol> : <p>No rental listing decisions have been recorded.</p>}<div className="actions"><button type="button" className="secondary" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous listing decisions</button><button type="button" className="secondary" disabled={page * resource.data.pageSize >= resource.data.total} onClick={() => setPage(value => value + 1)}>Next listing decisions</button></div></>;
}
