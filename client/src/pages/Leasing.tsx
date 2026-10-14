import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { Form } from "./Workspace";
type Unit = { id: string; propertyId: string; label: string; status: string; version: number };
type Lease = { id: string; propertyId: string; unitId: string; residentId: string; startsOn: string; endsOn: string | null; rentCents: number; currency: string; status: string; version: number; unit: { label: string }; property: { name: string }; resident: { name: string | null; email: string } };
type Records<T> = { items: T[]; nextCursor: string | null };
const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
function Load({ error, retry, label }: { error?: string; retry: () => void; label: string }) {
  return error ? <div role="alert"><p>{error}</p><button onClick={retry}>Try again</button></div> : <p role="status">Loading {label}…</p>;
}
function Pager({ next, cursor, change }: { next: string | null; cursor: string; change: (value: string) => void }) {
  return <div className="actions">{cursor && <button className="secondary" onClick={() => change("")}>First page</button>}{next && <button className="secondary" onClick={() => change(next)}>Next page</button>}</div>;
}
export function Units() {
  const { propertyId = "" } = useParams(), { data, can } = useAuth();
  const scope = `${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`;
  return <UnitList key={`${scope}:${propertyId}`} propertyId={propertyId} editable={can("property.write")} />;
}
function UnitList({ propertyId, editable }: { propertyId: string; editable: boolean }) {
  const [cursor, setCursor] = useState(""), [key, setKey] = useState(() => crypto.randomUUID()), [error, setError] = useState("");
  const property = useResource<{ id: string; name: string }>(`/api/company/properties/${encodeURIComponent(propertyId)}`);
  const r = useResource<Records<Unit>>(`/api/company/properties/${encodeURIComponent(propertyId)}/units?${new URLSearchParams(cursor ? { cursor } : {})}`);
  const reload = () => { setCursor("");r.reload();setError(""); };
  return <>
    <nav aria-label="Breadcrumb"><Link to="/company/properties">Properties</Link> / <Link to={`/company/properties/${encodeURIComponent(propertyId)}`}>Property details</Link> / Units</nav>
    <header className="page-heading"><p className="eyebrow">Property operations</p><h1>Units</h1><p>Unit records are separate from resident property access. Archive a unit to retain its history; end its active lease first.</p></header>
    {error && <p role="alert">{error}</p>}
    {!property.data ? <Load error={property.error} retry={property.reload} label="property" /> : <>
      {editable && <section className="panel"><h2>Add a unit</h2><Form key={key} operation="unit.create" label="Create unit" submit={async form => { await api(`/api/company/properties/${encodeURIComponent(propertyId)}/units`, { method: "POST", body: { label: form.get("label"), submissionKey: key } });reload(); }}>
        <label>Unit name<input name="label" required maxLength={80} placeholder="Apartment 1 or Main house" /></label>
        <p className="help">Names must be unique within this property. Keep the same details to retry a failed submission.</p>
        <button type="button" className="secondary" onClick={() => setKey(crypto.randomUUID())}>Start a new unit</button>
      </Form></section>}
      <section className="panel"><h2>Unit records</h2><button className="secondary" onClick={reload}>Reload units</button>
        {!r.data ? <Load error={r.error} retry={r.reload} label="units" /> : <><p role="status">{r.data.items.length} units on this page</p>
        {!r.data.items.length ? <p>No units yet. Add a unit for each apartment, or one unit for a single-family property.</p> : <ul className="record-list">{r.data.items.map(unit => <li key={unit.id}><h3>{unit.label}</h3><p>{unit.status}</p>
          {editable && <Form key={`${unit.id}:${unit.version}`} operation="unit.update" label={`Save unit ${unit.label}`} submit={async form => { try { await api(`/api/company/units/${encodeURIComponent(unit.id)}`, { method: "PATCH", body: { label: form.get("label"), status: form.get("status"), expectedVersion: unit.version } });reload(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to update unit.");throw e; } }}>
            <label>Name for {unit.label}<input name="label" defaultValue={unit.label} required maxLength={80} /></label>
            <label>Status for {unit.label}<select name="status" defaultValue={unit.status}><option value="active">Active</option><option value="archived">Archived</option></select></label>
          </Form>}
        </li>)}</ul>}
        <Pager next={r.data.nextCursor} cursor={cursor} change={setCursor} /></>}
      </section>
    </>}
    {!editable && <p className="help">You have read-only unit access.</p>}
  </>;
}
export function Leases() {
  const { data } = useAuth();
  const scope = `${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`;
  return <LeaseList key={scope} />;
}
function LeaseList() {
  const [cursor, setCursor] = useState(""), [propertyId, setPropertyId] = useState("");
  const properties = useResource<{ id: string; name: string }[]>("/api/company/properties");
  const r = useResource<Records<Lease>>(`/api/company/leases?${new URLSearchParams(cursor ? { cursor } : {})}`);
  const reload = () => { setCursor("");r.reload(); };
  return <>
    <header className="page-heading"><p className="eyebrow">Company operations</p><h1>Lease records</h1><p>Track dates, monthly rent and a primary resident. These are internal records, not signed contracts. Status is maintained manually. Lease records do not grant resident access.</p></header>
    <section className="panel"><h2>Record a lease</h2>
      {!properties.data ? <Load error={properties.error} retry={properties.reload} label="properties" /> : !properties.data.length ? <p>Create a property and units first.</p> : <>
        <label>Property for new lease<select value={propertyId} onChange={e => setPropertyId(e.target.value)}><option value="">Choose a property</option>{properties.data.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {propertyId && <LeaseCreate key={propertyId} propertyId={propertyId} saved={reload} />}
      </>}
    </section>
    <section className="panel"><h2>Company lease history</h2><button className="secondary" onClick={reload}>Reload leases</button>
      {!r.data ? <Load error={r.error} retry={r.reload} label="leases" /> : <>
        <p role="status">{r.data.items.length} leases on this page</p>
        {!r.data.items.length ? <p>No lease records yet.</p> : <ul className="record-list">{r.data.items.map(lease => <li key={lease.id}><h3>{lease.property.name} · {lease.unit.label}</h3><p>{lease.resident.name || lease.resident.email} · {lease.status}</p><p>{lease.startsOn.slice(0, 10)} to {lease.endsOn?.slice(0, 10) || "Open-ended"} · {usd(lease.rentCents)} monthly</p>
          <Form key={`${lease.id}:${lease.version}`} operation="lease.update" label={`Save lease ${lease.unit.label}`} submit={async form => { await api(`/api/company/leases/${encodeURIComponent(lease.id)}`, { method: "PATCH", body: { startsOn: form.get("startsOn"), endsOn: form.get("endsOn") || null, monthlyRent: form.get("monthlyRent"), status: form.get("status"), expectedVersion: lease.version } });reload(); }}>
            <LeaseTerms prefix={`Lease ${lease.unit.label}`} value={lease} />
          </Form>
        </li>)}</ul>}
        <Pager next={r.data.nextCursor} cursor={cursor} change={setCursor} />
      </>}
    </section>
  </>;
}
function LeaseCreate({ propertyId, saved }: { propertyId: string; saved: () => void }) {
  const [key, setKey] = useState(() => crypto.randomUUID()), [unitCursor, setUnitCursor] = useState("");
  const [unitOptions, setUnitOptions] = useState<Unit[]>([]);
  const units = useResource<Records<Unit>>(`/api/company/properties/${encodeURIComponent(propertyId)}/units?${new URLSearchParams(unitCursor ? { cursor: unitCursor } : {})}`);
  const residents = useResource<{ userId: string; membership: { user: { name: string | null; email: string } } }[]>(`/api/company/properties/${encodeURIComponent(propertyId)}/residents`);
  // Browsing options must never remount a pending draft or change its retry identity.
  // Keep already-seen choices so the selected unit survives an independent page load.
  useEffect(() => {
    if (units.data) setUnitOptions(previous => {
      const choices = new Map(previous.map(unit => [unit.id, unit]));
      for (const unit of units.data!.items) if (unit.status === "active") choices.set(unit.id, unit);
      return [...choices.values()];
    });
  }, [units.data]);
  return <>
    <Link to={`/company/properties/${encodeURIComponent(propertyId)}/units`}>Manage units for this property</Link>
    {!residents.data ? <Load error={residents.error} retry={residents.reload} label="assigned residents" /> : <>
      {(!unitOptions.length || !residents.data.length) ? (units.data && <p>An active unit and an accepted resident assigned to this property are required. Use Properties → Manage residents for assignments.</p>) : <Form key={key} operation="lease.create" label="Create lease record" submit={async form => { await api("/api/company/leases", { method: "POST", body: { propertyId, unitId: form.get("unitId"), residentId: form.get("residentId"), startsOn: form.get("startsOn"), endsOn: form.get("endsOn") || null, monthlyRent: form.get("monthlyRent"), status: form.get("status"), submissionKey: key } });saved(); }}>
        <label>Unit for new lease<select name="unitId" required>{unitOptions.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></label>
        <label>Primary resident<select name="residentId" required>{residents.data.map(person => <option key={person.userId} value={person.userId}>{person.membership.user.name || person.membership.user.email}</option>)}</select></label>
        <LeaseTerms prefix="New lease" />
        <p className="help">Only one active lease per unit. Retry with the same details after a failed response. Browsing more units preserves your draft; availability is checked when saving.</p>
        <button type="button" className="secondary" onClick={() => setKey(crypto.randomUUID())}>Start a new lease</button>
      </Form>}
    </>}
    {!units.data ? <Load error={units.error} retry={units.reload} label="units" /> : <Pager next={units.data.nextCursor} cursor={unitCursor} change={setUnitCursor} />}
  </>;
}
function LeaseTerms({ prefix, value }: { prefix: string; value?: Lease }) {
  return <div className="form-grid">
    <label>{prefix} start date<input name="startsOn" type="date" required defaultValue={value?.startsOn.slice(0, 10)} /></label>
    <div><label>{prefix} end date<input name="endsOn" type="date" defaultValue={value?.endsOn?.slice(0, 10)} /></label><p className="help">Leave blank for an open-ended record; ended records require a date.</p></div>
    <label>{prefix} monthly rent (USD)<input name="monthlyRent" type="number" min="0" max="1000000" step="0.01" required defaultValue={value ? (value.rentCents / 100).toFixed(2) : undefined} /></label>
    <label>{prefix} status<select name="status" defaultValue={value?.status || "draft"}><option value="draft">Draft</option><option value="active">Active</option><option value="ended">Ended</option></select></label>
  </div>;
}
