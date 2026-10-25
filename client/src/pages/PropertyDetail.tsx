import { Address, PropertyAddressFields } from "../components/Address";
import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import {
  PropertyFields,
  propertyTypes,
  type PropertyExtras,
} from "../components/PropertyFields";
import {
  PropertyNavigation,
  propertyLink,
} from "../components/PropertyNavigation";
import { EditorDialog } from "../components/EditorDialog";
import { ManageResidents } from "./Workspace";
import { monitorOperation } from "../operations";
import { availableFeatureRoute } from "../company-features";
import { tenantEditorScope } from "../tenant-write-access";
import "./PropertyDetail.css";

type Property = PropertyExtras & {
  version: number;
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};
export default function PropertyDetail() {
  const { propertyId = "" } = useParams();
  const { data, can } = useAuth();
  // Remount on identity, company or access changes so stale details/drafts disappear.
  const scope = tenantEditorScope(data);
  return (
    <Detail
      key={`${scope}:${propertyId}`}
      id={propertyId}
      editable={can("property.write")}
    />
  );
}
function Detail({ id, editable }: { id: string; editable: boolean }) {
  const [property, setProperty] = useState<Property>();
  const [failure, setFailure] = useState<Error>();
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [managing, setManaging] = useState(false);
  const { can, data: auth } = useAuth();
  const propertyReadOnly = auth?.companyFeatures?.properties === "read_only";
  const tenantAccessReadOnly = propertyReadOnly || auth?.companyFeatures?.leasing === "read_only";
  const allowed = (permission: Parameters<typeof can>[0], path: string) => can(permission) && availableFeatureRoute(path, auth?.companyFeatures, auth?.membership?.role);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<Error>();
  const [saved, setSaved] = useState(false);
  const endpoint = `/api/company/properties/${encodeURIComponent(id)}`;
  useEffect(() => {
    const controller = new AbortController();
    setFailure(undefined);
    void monitorOperation("page.data.load", () =>
      api<Property>(endpoint, { signal: controller.signal }),
    )
      .then((value) => {
        if (!controller.signal.aborted) setProperty(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setFailure(error);
      });
    return () => controller.abort();
  }, [endpoint, revision]);
  const unavailable =
    failure instanceof ApiError && [403, 404].includes(failure.status);
  const deniedSave =
    saveError instanceof ApiError && [403, 404].includes(saveError.status);
  return (
    <div className="property-detail-workspace">
      <PropertyNavigation id={id} name={property?.name} external />
      <nav className="sr-only" aria-label="Breadcrumb">
        <Link to="/company/properties">Properties</Link> / Property details
      </nav>
      {!property ? (
        <section className="panel">
          {failure ? (
            <>
              <h1>
                {unavailable
                  ? failure instanceof ApiError && failure.status === 404
                    ? "Property not found"
                    : "Access unavailable"
                  : "Unable to load property"}
              </h1>
              <p role="alert">
                {unavailable
                  ? "This property may be unavailable or outside your current company access."
                  : failure.message}
              </p>
              {!unavailable && (
                <button onClick={() => setRevision((value) => value + 1)}>
                  Try again
                </button>
              )}
            </>
          ) : (
            <p role="status">Loading property…</p>
          )}
        </section>
      ) : (
        <>
          <header className="page-heading">
            <p className="eyebrow">Company property</p>
            <h1>{property.name}</h1>
            <p>
              {property.address}
              <br />
              {property.city}, {property.state} {property.zip}
            </p>
            <div className="actions">
              <Link
                className="button"
                to={`/company/properties/${encodeURIComponent(id)}/units`}
              >
                {editable ? "Manage units" : "View units"}
              </Link>
              {allowed("resident.assignment.manage", `/company/properties/${encodeURIComponent(id)}/residents`) && (tenantAccessReadOnly ? <Link className="button secondary" to={`/company/properties/${encodeURIComponent(id)}/residents`}>View tenant access</Link> :
                <button className="secondary" onClick={() => setManaging(true)}>
                  Manage residents
                </button>
              )}
              {allowed("lease.manage", propertyLink("/company/leases", id)) && auth?.companyFeatures?.leasing !== "read_only" && (
                <Link
                  className="button secondary"
                  to={`/company/properties/${encodeURIComponent(id)}/leases?new=lease`}
                >
                  Record a lease
                </Link>
              )}
            </div>
          </header>
          <section className="panel property-record-panel">
            <div className="section-heading">
              <h2>Property details</h2>
              {editable && !editing && (
                <button
                  disabled={propertyReadOnly}
                  onClick={() => {
                    setEditing(true);
                    setSaved(false);
                    setSaveError(undefined);
                  }}
                >
                  Edit property
                </button>
              )}
            </div>
            {saved && (
              <p className="notice" role="status">
                Property saved.
              </p>
            )}
            {editable && (
              <EditorDialog
                key={property.version}
                open={editing}
                title="Edit property"
                onClose={() => setEditing(false)}
                busy={busy}
              >
                <form
                  key={property.version}
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (busy || deniedSave || propertyReadOnly) return;
                    const body = {
                      ...Object.fromEntries(new FormData(event.currentTarget)),
                      expectedVersion: property.version,
                    };
                    setBusy(true);
                    setSaved(false);
                    setSaveError(undefined);
                    try {
                      const updated = await monitorOperation(
                        "property.update",
                        () =>
                          api<Property>(endpoint, { method: "PATCH", body }),
                      );
                      setProperty(updated);
                      setEditing(false);
                      setSaved(true);
                    } catch (error) {
                      setSaveError(
                        error instanceof Error
                          ? error
                          : new Error("Unable to save property."),
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <fieldset disabled={busy || deniedSave || propertyReadOnly}>
                    <PropertyAddressFields value={property} />
                    <PropertyFields value={property} />
                    <div className="actions">
                      <button type="submit">
                        {busy
                          ? "Saving…"
                          : saveError
                            ? "Try saving again"
                            : "Save changes"}
                      </button>
                      <button
                        className="secondary"
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.form?.reset();
                          setEditing(false);
                          setSaveError(undefined);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </fieldset>
                  {saveError instanceof ApiError &&
                    saveError.status === 409 && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setEditing(false);
                          setSaveError(undefined);
                          setProperty(undefined);
                          setRevision((v) => v + 1);
                        }}
                      >
                        Discard edits and reload latest property
                      </button>
                    )}
                  {saveError && (
                    <p className="notice error" role="alert">
                      {deniedSave
                        ? "This property is no longer available for editing. Return to Properties to check your access."
                        : saveError.message}
                    </p>
                  )}
                </form>
              </EditorDialog>
            )}
            <div className="property-details-layout">
              <section className="property-location" aria-label="Property location"><p className="record-kicker">Location</p><Address street={property.address} city={property.city} region={property.state} postalCode={property.zip} country={property.countryCode}/></section>
              <dl className="details property-building-facts">{[["Property type",propertyTypes.find(([v])=>v===property.propertyType)?.[1]],["Year built",property.yearBuilt],["Parcel / tax ID",property.parcelId]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{value??"Not recorded"}</dd></div>)}</dl>
            </div>
            <div className="property-notes"><h3>Property notes</h3><p className="preserve-lines">{property.notes||"No property notes added."}</p></div>
            {!editable && (
              <p className="help">
                You have read-only access to this property.
              </p>
            )}
          </section>
          {managing && (
            <ManageResidents
              property={property}
              close={() => setManaging(false)}
            />
          )}
          <section className="property-workflow-section" aria-label="Property workflows">
            <div className="section-heading"><div><p className="record-kicker">Work in this property</p><h2>Choose your next task</h2></div><p className="help">Every workspace below stays scoped to {property.name}.</p></div>
            <div className="property-workflow-grid">
              {[
                { title: "Spaces & records", description: "Keep each rentable space and its source history together.", links: [["Units", `/company/properties/${encodeURIComponent(id)}/units`, "property.read", "Review spaces, details and lease history"]] },
                { title: "People & leasing", description: "Follow account access, households and each lease term.", links: [["Tenant access", `/company/properties/${encodeURIComponent(id)}/residents`, "resident.assignment.manage", "Review property access and tenant contacts"], ["Leases", propertyLink("/company/leases", id), "lease.manage", "Open terms, households and renewal workspaces"]] },
                { title: "Finance", description: "Follow source balances and record money only after it moves.", links: [["Rent & payments", propertyLink("/company/rent", id), "finance.manage", "Review charges, receipts and outstanding balances"], ["Deposits", propertyLink("/company/deposits", id), "finance.manage", "Review requirements, held funds and corrections"], ["Cash activity", propertyLink("/company/finances", id), "finance.manage", "Record paid expenses and received income"], ["Reports", propertyLink("/company/reports", id), "finance.manage", "Follow the records behind totals and exports"]] },
                { title: "Maintenance", description: "Keep requests, assigned work and their source records connected.", links: [["Maintenance requests", propertyLink("/company/maintenance", id), "maintenance.manage", "Review requests, work progress and supporting history"]] },
              ].map(area => ({ ...area, links: area.links.filter(([, path, permission]) => allowed(permission as Parameters<typeof can>[0], path)) })).filter(area => area.links.length).map(area => <section className="property-workflow-card" key={area.title}><h3>{area.title}</h3><p>{area.description}</p><ul>{area.links.map(([label, path, , help]) => <li key={path}><Link to={path}><strong>{label}</strong><span>{help}</span><span aria-hidden="true">→</span></Link></li>)}</ul></section>)}
            </div>
          </section>
        </>
      )}
      <Link to="/company/properties">← Back to properties</Link>
    </div>
  );
}
