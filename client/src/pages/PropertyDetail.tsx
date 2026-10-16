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
  const scope = `${data?.user.id}:${data?.user.status}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`;
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
  const { can } = useAuth();
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
    <>
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
              {can("resident.assignment.manage") && (
                <button className="secondary" onClick={() => setManaging(true)}>
                  Manage residents
                </button>
              )}
              {can("lease.manage") && (
                <Link
                  className="button secondary"
                  to={`/company/properties/${encodeURIComponent(id)}/leases?new=lease`}
                >
                  Record a lease
                </Link>
              )}
            </div>
          </header>
          <section className="panel">
            <div className="section-heading">
              <h2>Property details</h2>
              {editable && !editing && (
                <button
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
                open={editing}
                title="Edit property"
                onClose={() => setEditing(false)}
                busy={busy}
              >
                <form
                  key={property.version}
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (busy || deniedSave) return;
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
                  <fieldset disabled={busy || deniedSave}>
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
          <section className="panel">
            <h2>Keep this property moving</h2>
            <div className="quick-links">
              <Link to={`/company/properties/${encodeURIComponent(id)}/units`}>
                <strong>Units</strong>
                <span>Set up the spaces you rent.</span>
              </Link>
              {can("resident.assignment.manage") && (
                <Link
                  to={`/company/properties/${encodeURIComponent(id)}/residents`}
                >
                  <strong>Residents</strong>
                  <span>Contact details and property access.</span>
                </Link>
              )}
              {can("maintenance.manage") && (
                <Link to={propertyLink("/company/maintenance", id)}>
                  <strong>Maintenance</strong>
                  <span>Review requests and update progress.</span>
                </Link>
              )}
              {can("finance.manage") && (
                <Link to={propertyLink("/company/finances", id)}>
                  <strong>Finances</strong>
                  <span>Record income and expenses.</span>
                </Link>
              )}
            </div>
          </section>
        </>
      )}
      <Link to="/company/properties">← Back to properties</Link>
    </>
  );
}
