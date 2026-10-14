import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { monitorOperation } from "../operations";

type Property = { id: string; name: string; address: string; city: string; state: string; zip: string };
const fields = [
  ["name", "Property name", 200], ["address", "Street address", 200],
  ["city", "City", 200], ["state", "State / region", 100], ["zip", "Postal code", 30],
] as const;
export default function PropertyDetail() {
  const { propertyId = "" } = useParams();
  const { data, can } = useAuth();
  // Remount on identity, company or access changes so stale details/drafts disappear.
  const scope = `${data?.user.id}:${data?.user.status}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`;
  return <Detail key={`${scope}:${propertyId}`} id={propertyId} editable={can("property.write")} />;
}
function Detail({ id, editable }: { id: string; editable: boolean }) {
  const [property, setProperty] = useState<Property>();
  const [failure, setFailure] = useState<Error>();
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<Error>();
  const [saved, setSaved] = useState(false);
  const endpoint = `/api/company/properties/${encodeURIComponent(id)}`;
  useEffect(() => {
    const controller = new AbortController();
    setFailure(undefined);
    void monitorOperation("page.data.load", () => api<Property>(endpoint, { signal: controller.signal }))
      .then(value => { if (!controller.signal.aborted) setProperty(value); })
      .catch(error => { if (!controller.signal.aborted) setFailure(error); });
    return () => controller.abort();
  }, [endpoint, revision]);
  const unavailable = failure instanceof ApiError && [403, 404].includes(failure.status);
  const deniedSave = saveError instanceof ApiError && [403, 404].includes(saveError.status);
  return <>
    <nav aria-label="Breadcrumb"><Link to="/company/properties">Properties</Link> / Property details</nav>
    {!property ? <section className="panel">
      {failure ? <><h1>{unavailable ? (failure instanceof ApiError && failure.status === 404 ? "Property not found" : "Access unavailable") : "Unable to load property"}</h1>
        <p role="alert">{unavailable ? "This property may be unavailable or outside your current company access." : failure.message}</p>
        {!unavailable && <button onClick={() => setRevision(value => value + 1)}>Try again</button>}
      </> : <p role="status">Loading property…</p>}
    </section> : <>
      <header className="page-heading"><p className="eyebrow">Company property</p><h1>{property.name}</h1>
        <p>{property.address}<br />{property.city}, {property.state} {property.zip}</p>
      </header>
      <section className="panel"><div className="section-heading"><h2>Property details</h2>
        {editable && !editing && <button onClick={() => { setEditing(true); setSaved(false); setSaveError(undefined); }}>Edit property</button>}
      </div>
      {saved && <p className="notice" role="status">Property saved.</p>}
      {editing && editable ? <form onSubmit={async event => {
        event.preventDefault();
        if (busy || deniedSave) return;
        const body = Object.fromEntries(new FormData(event.currentTarget));
        setBusy(true); setSaved(false); setSaveError(undefined);
        try {
          const updated = await monitorOperation("property.update", () => api<Property>(endpoint, { method: "PATCH", body }));
          setProperty(updated); setEditing(false); setSaved(true);
        } catch (error) { setSaveError(error instanceof Error ? error : new Error("Unable to save property.")); }
        finally { setBusy(false); }
      }}>
        <fieldset disabled={busy || deniedSave}><div className="form-grid">
          {fields.map(([name, label, max]) => <label key={name}>{label}<input name={name} defaultValue={property[name]} required maxLength={max} /></label>)}
        </div><div className="actions"><button type="submit">{busy ? "Saving…" : saveError ? "Try saving again" : "Save changes"}</button>
          <button className="secondary" type="button" onClick={() => { setEditing(false); setSaveError(undefined); }}>Cancel</button>
        </div></fieldset>
        {saveError && <p className="notice error" role="alert">{deniedSave ? "This property is no longer available for editing. Return to Properties to check your access." : saveError.message}</p>}
      </form> : <dl className="details">{fields.map(([name, label]) => <React.Fragment key={name}><dt>{label}</dt><dd>{property[name]}</dd></React.Fragment>)}</dl>}
      {!editable && <p className="help">You have read-only access to this property.</p>}
      </section>
    </>}
    <Link to="/company/properties">← Back to properties</Link>
  </>;
}
