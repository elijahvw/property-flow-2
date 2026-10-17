import { TenantForm,type TenantContact } from "../components/TenantForm";
import { formatDate } from "../dates";
import { leasePath, unitDirectoryPath, unitListContext } from "../lease-links";
import { DateField } from "../components/DateField";
import {
  LeaseReview,
  leasePending,
  type LeaseReviewData,
} from "../components/LeaseReview";
import { useEffect, useId, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { UnitFields, type UnitExtras } from "../components/PropertyFields";
import { EditorDialog } from "../components/EditorDialog";
import { DraftReset } from "../components/DraftReset";
import { PropertyNavigation } from "../components/PropertyNavigation";
import { Form } from "./Workspace";
type Unit = UnitExtras & {
  id: string;
  propertyId: string;
  label: string;
  status: string;
  version: number;
};
export type Lease = {
  hasTermHistory?:boolean;
  overview?:{householdCount:number;pendingApprovals:number;scheduleStatus:string|null;depositRecorded:boolean};
  previousLeaseId?: string | null;
  previousLease?: { id: string; endsOn: string | null; status: string } | null;
  renewals?: { id: string; status: string; startsOn: string }[];
  rentDueDay?: number;
  graceDays?: number;
  paymentInstructions?: string | null;
  id: string;
  propertyId: string;
  unitId: string;
  residentId: string|null;
  residentContactId?:string|null;
  startsOn: string;
  endsOn: string | null;
  rentCents: number;
  currency: string;
  status: string;
  version: number;
  unit: { label: string };
  property: { name: string };
  resident: { name: string | null; email: string };
};
type Records<T> = { items: T[]; nextCursor: string | null };
const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
function Load({
  error,
  retry,
  label,
}: {
  error?: string;
  retry: () => void;
  label: string;
}) {
  return error ? (
    <div role="alert">
      <p>{error}</p>
      <button onClick={retry}>Try again</button>
    </div>
  ) : (
    <p role="status">Loading {label}…</p>
  );
}
function Pager({
  next,
  cursor,
  change,
}: {
  next: string | null;
  cursor: string;
  change: (value: string) => void;
}) {
  return (
    <div className="actions">
      {cursor && (
        <button className="secondary" onClick={() => change("")}>
          First page
        </button>
      )}
      {next && (
        <button className="secondary" onClick={() => change(next)}>
          Next page
        </button>
      )}
    </div>
  );
}
export function Units() {
  const { propertyId = "" } = useParams(),
    { data, can } = useAuth();
  const scope = `${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`;
  return (
    <UnitList
      key={`${scope}:${propertyId}`}
      propertyId={propertyId}
      editable={can("property.write")}
    />
  );
}
function UnitList({
  propertyId,
  editable,
}: {
  propertyId: string;
  editable: boolean;
}) {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const cursor = params.get("cursor") || "",
    query = params.get("q") || "",
    status = params.get("status") || "";
  const [adding, setAdding] = useState(false),
    [selected, setSelected] = useState<Unit | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID()),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const change = (field: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete("cursor");
    if (value) next.set(field, value);
    else next.delete(field);
    setParams(next, { replace: true });
  };
  const property = useResource<{ id: string; name: string }>(
    `/api/company/properties/${encodeURIComponent(propertyId)}`,
  );
  const r = useResource<Records<Unit>>(
    `/api/company/properties/${encodeURIComponent(propertyId)}/units?${new URLSearchParams(Object.entries({ cursor, q: query.trim(), status }).filter(([, value]) => value))}`,
    true,
    true,
  );
  const reload = () => {
    change("cursor", "");
    r.reload();
    setError("");
  };
  return (
    <>
      <PropertyNavigation id={propertyId} name={property.data?.name} external />
      <nav className="sr-only" aria-label="Breadcrumb">
        <Link to="/company/properties">Properties</Link> /{" "}
        <Link to={`/company/properties/${encodeURIComponent(propertyId)}`}>
          Property details
        </Link>{" "}
        / Units
      </nav>
      <header className="page-heading">
        <p className="eyebrow">{property.data?.name || "Property"} / Units</p>
        <h1>Units</h1>
        <p>
          Find a space, review its details and follow its lease history.
        </p>
        {editable && (
          <button disabled={!property.data} onClick={() => setAdding(true)}>
            Add a unit
          </button>
        )}
      </header>
      {error && <p role="alert">{error}</p>}
      {success && <p role="status" className="notice">{success}</p>}
      {!property.data ? (
        <Load error={property.error} retry={property.reload} label="property" />
      ) : (
        <>
          {editable && (
            <EditorDialog
              open={adding}
              title="Add a unit"
              onClose={() => setAdding(false)}
            >
              <Form
                key={key}
                operation="unit.create"
                secondaryActions={
                  <DraftReset reset={() => setKey(crypto.randomUUID())} />
                }
                label="Create unit"
                submit={async (form) => {
                  await api(
                    `/api/company/properties/${encodeURIComponent(propertyId)}/units`,
                    {
                      method: "POST",
                      body: { ...Object.fromEntries(form), submissionKey: key },
                    },
                  );
                  reload();
                  setAdding(false);
                  setKey(crypto.randomUUID());
                  setSuccess(`Unit created.${query || status ? " Adjust the filters if it is not shown below." : ""}`);
                }}
              >
                <label>
                  Unit name
                  <input
                    name="label"
                    required
                    maxLength={80}
                    placeholder="Apartment 1 or Main house"
                  />
                </label>
                <UnitFields />
                <p className="help">
                  Choose a name that identifies this space within the property.
                </p>
              </Form>
            </EditorDialog>
          )}
          <section className="panel directory-panel" aria-label="Unit directory">
            <h2>Unit records</h2>
            <div className="directory-toolbar">
              <label className="directory-search">
                Find unit
                <input type="search" maxLength={200} placeholder="Unit name or floor" value={query} onChange={e => change("q", e.target.value)} />
              </label>
              <label>
                Unit view
                <select aria-label="Unit view" value={status} onChange={e => change("status", e.target.value)}>
                  <option value="">All units</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              {(query || status) && <button className="text-button" onClick={() => setParams({}, { replace: true })}>Clear filters</button>}
            </div>
            {r.data && r.error && (
              <Load error={r.error} retry={r.reload} label="units" />
            )}

            {!r.data ? (
              <Load error={r.error} retry={r.reload} label="units" />
            ) : (
              <>
                <p role="status" className="directory-results">{r.data.items.length} {r.data.items.length === 1 ? "unit" : "units"} on this page</p>
                {!r.data.items.length ? (
                  <div className="empty-state">
                    <h3>{query || status || cursor ? "No matching units" : "No units yet"}</h3>
                    <p>{query || status || cursor ? "Try a different search or unit view." : "Add a unit for each apartment, or one unit for a single-family property."}</p>
                  </div>
                ) : (
                  <div className="table-wrap">
                  <table className="core-table unit-directory">
                    <thead><tr><th>Unit</th><th>Space</th><th>Market rent</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                    {r.data.items.map((unit) => (
                      <tr key={unit.id}>
                        <td>
                          <h3>{unit.label}</h3>
                          <span className="cell-detail">{unit.floor ? `Floor ${unit.floor}` : "Floor not recorded"}</span>
                          {unit.notes && <details className="row-more"><summary>Unit notes</summary><p className="preserve-lines">{unit.notes}</p></details>}
                        </td>
                        <td data-label="Space">
                          <span className="cell-detail">
                            {unit.bedrooms == null
                              ? "Bedrooms not recorded"
                              : unit.bedrooms === 0 ? "Studio" : `${unit.bedrooms} bed`}{" "}
                            ·{" "}
                            {unit.bathroomsHundredths == null
                              ? "Bathrooms not recorded"
                              : `${unit.bathroomsHundredths / 100} bath`}
                            {unit.squareFeet != null
                              ? ` · ${unit.squareFeet.toLocaleString()} sq ft`
                              : ""}
                          </span>
                        </td>
                        <td data-label="Market rent">{unit.marketRentCents == null ? "Not recorded" : <><strong>{usd(unit.marketRentCents)}</strong><span className="cell-detail">Asking amount / month</span></>}</td>
                        <td data-label="Status"><span className={`status-pill ${unit.status}`}>{unit.status === "active" ? "Active" : "Archived"}</span></td>
                        <td><div className="row-actions">
                        {can("lease.manage") && <Link aria-label={`View leases for ${unit.label}`} to={`/company/properties/${encodeURIComponent(propertyId)}/leases?${new URLSearchParams(Object.entries({ unitId: unit.id, unitListQ: query, unitListStatus: status, unitListCursor: cursor }).filter(([, value]) => value))}`}>View leases →</Link>}
                        {editable && (
                          <button
                            className="text-button"
                            aria-label={`Edit unit ${unit.label}`}
                            onClick={() => setSelected(unit)}
                          >
                            Edit unit
                          </button>
                        )}
                        </div></td>
                      </tr>
                    ))}
                    </tbody>
                  </table>
                  </div>
                )}
                <Pager
                  next={r.data.nextCursor}
                  cursor={cursor}
                  change={value => change("cursor", value)}
                />
              </>
            )}
          </section>
        </>
      )}
      {selected && (
        <EditorDialog
          open
          title={`Edit unit ${selected.label}`}
          onClose={() => {
            setSelected(null);
            reload();
          }}
        >
          {" "}
          <Form
            key={`${selected.id}:${selected.version}`}
            operation="unit.update"
            label={`Save unit ${selected.label}`}
            submit={async (form) => {
              try {
                await api(
                  `/api/company/units/${encodeURIComponent(selected.id)}`,
                  {
                    method: "PATCH",
                    body: {
                      ...Object.fromEntries(form),
                      label: form.get("label"),
                      status: form.get("status"),
                      expectedVersion: selected.version,
                    },
                  },
                );
                reload();
                setSelected(null);
                setSuccess("Unit updated.");
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Unable to update selected.",
                );
                throw e;
              }
            }}
          >
            <label>
              Name for {selected.label}
              <input
                name="label"
                defaultValue={selected.label}
                required
                maxLength={80}
              />
            </label>
            <UnitFields value={selected} />
            <label>
              Status for {selected.label}
              <select name="status" defaultValue={selected.status}>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <p className="help">Archiving retains the unit and its history. End its active lease before archiving.</p>
          </Form>
        </EditorDialog>
      )}
      {!editable && <p className="help">You have read-only unit access.</p>}
    </>
  );
}
export function Leases() {
  const { data } = useAuth();
  const [routeParams] = useSearchParams();
  const pathParams = useParams();
  const scope = `${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}:${pathParams.propertyId || routeParams.get("propertyId") || ""}`;
  return <LeaseList key={scope} />;
}
function LeaseList() {
  const navigate = useNavigate();
  const { data: auth, can } = useAuth();
  const { propertyId: pathPropertyId } = useParams();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.get("new") === "lease"),
    [selected, setSelected] = useState<Lease | null>(null),
    [renewing, setRenewing] = useState<Lease | null>(null);
  const contextId = pathPropertyId || params.get("propertyId") || "",
    unitId = params.get("unitId") || "",
    status = params.get("status") || "",
    attention = params.get("attention") || "",
    approvals = params.get("approvals") || "",
    query = params.get("q") || "";
  const [visitedProperties, setVisitedProperties] = useState<string[]>(() =>
    contextId ? [contextId] : [],
  );
  const [cursor, setCursor] = useState(""),
    [propertyId, setPropertyId] = useState(contextId);
  useEffect(()=>setCursor(""),[contextId,unitId,status,attention,approvals,query]);
  const properties = useResource<{ id: string; name: string }[]>(
    "/api/company/properties",
  );
  const r = useResource<Records<Lease> & { unit?: { id: string; label: string; propertyId: string } }>(
    `/api/company/leases?${new URLSearchParams(Object.entries({ cursor, propertyId: contextId, unitId, status, attention, approvals, q: query }).filter(([, value]) => value))}`,
    true,
    true,
  );
  const propertyName = properties.data?.find((p) => p.id === contextId)?.name;
  const detailPath = (id: string) =>
    leasePath(
      id,
      Object.fromEntries(
        Object.entries({
          leaseListProperty: contextId,
          leaseListStatus: status,
          leaseListAttention: attention,
          leaseListNested: pathPropertyId ? "true" : "",
          leaseListApprovals: approvals,
          leaseListQ: query,
          leaseListUnit: unitId,
          ...unitListContext(params),
          ...(approvals ? { section: "invitations" } : {}),
        }).filter(([, value]) => value),
      ),
    );
  const reload = () => {
    setCursor("");
    r.reload();
  };
  return (
    <>
      {contextId && <PropertyNavigation id={contextId} />}
      <header className="page-heading page-heading-row"><div>
        <p className="eyebrow">Leasing</p>
        <h1>
          {contextId
            ? `${propertyName || "Property"} · Leases`
            : "Lease records"}
        </h1>
        <p>
          Lease terms, households, renewals and linked billing records.
        </p>
        {unitId && <p className="notice">
          Showing leases for {r.data?.unit?.label || "the selected unit"}.{" "}
          {r.data?.unit && <Link to={unitDirectoryPath(r.data.unit.propertyId, params)}>← Back to units</Link>}{" "}
          <button className="text-button" onClick={() => { const next = new URLSearchParams(params); for (const key of ["unitId", "unitListQ", "unitListStatus", "unitListCursor"]) next.delete(key); setParams(next); }}>Show all units</button>
        </p>}
        {contextId && (
          <p>
            <Link to="/company/leases">View all company leases</Link>
          </p>
        )}
        </div><div className="actions"><button onClick={() => setAdding(true)}>Record a lease</button>
        {properties.data
          ?.filter(
            (p) =>
              (!pathPropertyId || p.id === pathPropertyId) &&
              leasePending(
                `pf:lease-setup:${auth?.user.id}:${auth?.membership?.companyId}:${p.id}`,
              ),
          )
          .map((p) => (
            <button
              className="secondary"
              key={p.id}
              onClick={() => {
                setPropertyId(p.id);
                setVisitedProperties((ids) =>
                  ids.includes(p.id) ? ids : [...ids, p.id],
                );
                setAdding(true);
              }}
            >
              Resume lease review · {p.name}
            </button>
          ))}
        </div>
      </header>
      <EditorDialog
        open={adding}
        title="Record a lease"
        description="Choose the property, unit, and resident, then add the lease terms."
        onClose={() => setAdding(false)}
      >
        {!properties.data ? (
          <Load
            error={properties.error}
            retry={properties.reload}
            label="properties"
          />
        ) : !properties.data.length ? (
          <p>Create a property and units first.</p>
        ) : (
          <>
            <label>
              Property for new lease
              <select
                value={propertyId}
                onChange={(e) => {
                  const id = e.target.value;
                  setPropertyId(id);
                  if (id)
                    setVisitedProperties((previous) =>
                      previous.includes(id) ? previous : [...previous, id],
                    );
                }}
              >
                <option value="">Choose a property</option>
                {properties.data
                  .filter((p) => !pathPropertyId || p.id === pathPropertyId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            {visitedProperties.map((id) => (
              <div
                className="lease-property-draft"
                key={id}
                hidden={propertyId !== id}
              >
                <LeaseCreate
                  propertyId={id}
                  initialContactId={params.get("contactId") || undefined}
                  propertyName={
                    properties.data!.find((p) => p.id === id)?.name ||
                    "Property"
                  }
                  saved={(row) => {
                    reload();
                    setAdding(false);
                    navigate(
                      `/company/leases/${encodeURIComponent(row.id)}?onboarding=household`,
                    );
                  }}
                />
              </div>
            ))}
          </>
        )}
      </EditorDialog>
      <section className="panel">
        <div className="section-heading">
          <h2>
            {contextId ? "Property lease history" : "Company lease history"}
          </h2>

        </div>
        <div className="directory-toolbar">
          <label className="directory-search">
            Find lease
            <input
              type="search"
              placeholder="Tenant, property or unit"
              value={query}
              maxLength={200}
              onChange={(e) => {
                setCursor("");
                const next = new URLSearchParams(params);
                if (e.target.value) next.set("q", e.target.value);
                else next.delete("q");
                setParams(next, { replace: true });
              }}
            />
          </label>
          {!pathPropertyId && (
            <label>
              Filter property
              <select
                value={contextId}
                onChange={(e) => {
                  setCursor("");
                  const next = new URLSearchParams(params);
                  for (const key of ["unitId", "unitListQ", "unitListStatus", "unitListCursor"]) next.delete(key);
                  if (e.target.value) next.set("propertyId", e.target.value);
                  else next.delete("propertyId");
                  setParams(next);
                }}
              >
                <option value="">All properties</option>
                {properties.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="compact-filter">
            Lease view
            <select
              aria-label="Lease view"
              value={approvals ? "resident_approvals" : attention || status}
              onChange={(e) => {
                const value = e.target.value;
                setCursor("");
                setParams({
                  ...(unitId ? { unitId, ...unitListContext(params) } : {}),
                  ...(query ? { q: query } : {}),
                  ...(!pathPropertyId && contextId
                    ? { propertyId: contextId }
                    : {}),
                  ...(value === "resident_approvals"
                    ? { approvals: "pending" }
                    : ["ending_soon", "past_end", "in_effect"].includes(value)
                      ? { attention: value }
                      : value
                        ? { status: value }
                        : {}),
                });
              }}
            >
              <option value="">All leases</option>
              {can("members.manage") && (
                <option value="resident_approvals">
                  Resident approvals needed
                </option>
              )}
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="ended">Ended</option>
              <option value="in_effect">In effect today</option>
              <option value="ending_soon">Ending within 30 days</option>
              <option value="past_end">Past end, still active</option>
            </select>
          </label>
        </div>
        {r.data && r.error && (
          <Load error={r.error} retry={r.reload} label="leases" />
        )}

        {!r.data ? (
          <Load error={r.error} retry={r.reload} label="leases" />
        ) : (
          <>
            <p role="status">{r.data.items.length} leases on this page</p>
            {!r.data.items.length ? (
              <div className="empty-state">
                <h3>
                  {unitId && !(query || status || attention || approvals)
                    ? "No leases for this unit"
                    : query || status || attention || approvals
                    ? "No matching leases"
                    : "No lease records yet"}
                </h3>
                <p>
                  {unitId && !(query || status || attention || approvals)
                    ? "No lease records have been recorded for this unit."
                    : query || status || attention || approvals
                    ? "Try a different search or lease view."
                    : "Record an existing lease or prepare a new term to connect the unit, household and billing."}
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="core-table lease-directory">
                  <thead>
                    <tr>
                      <th>Property &amp; unit</th>
                      <th>Primary tenant</th>
                      <th>Lease term</th>
                      <th>Status</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.data.items.map((lease) => (
                      <tr key={lease.id}>
                        <td>
                          <Link
                            className="table-primary"
                            to={`/company/properties/${encodeURIComponent(lease.propertyId)}/leases`}
                          >
                            {lease.property.name}
                          </Link>
                          <span className="cell-detail">
                            {lease.unit.label}
                          </span>
                        </td>
                        <td>
                          <Link to={detailPath(lease.id)}>
                            {lease.resident.name || lease.resident.email}
                          </Link>
                          {lease.resident.name && lease.resident.email && (
                            <span className="cell-detail">
                              {lease.resident.email}
                            </span>
                          )}
                        </td>
                        <td>
                          <span>{formatDate(lease.startsOn)}</span>
                          <span className="cell-detail">
                            through {formatDate(lease.endsOn, "Open ended")}
                          </span>
                          <strong className="lease-rent">
                            {usd(lease.rentCents)} <span>/ month</span>
                          </strong>
                          {lease.previousLeaseId && (
                            <span className="cell-detail">Renewal · previous term ended {formatDate(lease.previousLease?.endsOn,"on record")}</span>
                          )}
                        </td>
                        <td>
                          <span className={`status-pill ${lease.status}`}>
                            {lease.status === "active"
                              ? "Active"
                              : lease.status === "draft"
                                ? "Draft"
                                : "Ended"}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <Link
                              className="tenant-row-action"
                              to={detailPath(lease.id)}
                            >
                              Open lease workspace
                            </Link>
                            <details className="row-more" open={!!leasePending(`pf:lease-renewal:${auth?.user.id}:${auth?.membership?.companyId}:${lease.id}`)}>
                              <summary>More actions</summary>
                              <div className="row-more-actions">
                                <Link
                                  to={`/company/rent?leaseId=${encodeURIComponent(lease.id)}`}
                                >
                                  Rent ledger →
                                </Link>
                                {leasePending(
                                  `pf:lease-renewal:${auth?.user.id}:${auth?.membership?.companyId}:${lease.id}`,
                                ) && (
                                  <button
                                    className="secondary"
                                    onClick={() => setRenewing(lease)}
                                  >
                                    Resume renewal review
                                  </button>
                                )}
                                {lease.status !== "draft" &&
                                  lease.endsOn &&
                                  !lease.renewals?.length && (
                                    <button
                                      className="secondary"
                                      onClick={() => setRenewing(lease)}
                                    >
                                      Prepare renewal
                                    </button>
                                  )}
                                {lease.renewals?.length ? (
                                  <span className="help">
                                    {lease.renewals[0].status} renewal starts{" "}
                                    {formatDate(lease.renewals[0].startsOn)}
                                  </span>
                                ) : null}
                                <button
                                  className="secondary"
                                  onClick={() => setSelected(lease)}
                                >
                                  Edit lease
                                </button>
                              </div>
                            </details>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager
              next={r.data.nextCursor}
              cursor={cursor}
              change={setCursor}
            />
          </>
        )}
      </section>
      <EditorDialog
        open={!!renewing}
        title="Prepare lease renewal"
        onClose={() => {
          setRenewing(null);
          reload();
        }}
      >
        {renewing && (
          <LeaseRenewal
            key={renewing.id}
            previous={renewing}
            saved={() => {
              setRenewing(null);
              reload();
              setParams({
                ...(!pathPropertyId ? { propertyId: renewing.propertyId } : {}),
                status: "draft",
              });
            }}
          />
        )}
      </EditorDialog>
      {selected && (
        <EditorDialog
          open
          title={`Edit lease · ${selected.property.name} · ${selected.unit.label}`}
          onClose={() => {
            setSelected(null);
            reload();
          }}
        >
          {" "}
          <Form
            key={`${selected.id}:${selected.version}`}
            operation="lease.update"
            label={`Save lease ${selected.unit.label}`}
            submit={async (form) => {
              await api(
                `/api/company/leases/${encodeURIComponent(selected.id)}`,
                {
                  method: "PATCH",
                  body: {
                    startsOn: form.get("startsOn"),
                    endsOn: form.get("endsOn") || null,
                    monthlyRent: form.get("monthlyRent"),
                    status: form.get("status"),
                    expectedVersion: selected.version,
                    rentDueDay: Number(form.get("rentDueDay")),
                    graceDays: Number(form.get("graceDays")),
                    paymentInstructions:
                      form.get("paymentInstructions") || null,
                  },
                },
              );
              reload();
              setSelected(null);
            }}
          >
            <LeaseTerms
              prefix={`Lease ${selected.unit.label}`}
              value={selected}
            />
          </Form>
        </EditorDialog>
      )}
    </>
  );
}
export function LeaseCreate({
  propertyId,
  propertyName,
  initialContactId,
  saved,
}: {
  propertyId: string;
  propertyName: string;
  initialContactId?:string;
  saved: (row: { id:string }) => void;
}) {
  const auth = useAuth().data,
    storageKey = `pf:lease-setup:${auth?.user.id}:${auth?.membership?.companyId}:${propertyId}`;
  const [review, setReview] = useState<LeaseReviewData | null>(() =>
    leasePending(storageKey),
  );
  const [key, setKey] = useState(() => crypto.randomUUID()),
    [unitCursor, setUnitCursor] = useState("");
  const [unitOptions, setUnitOptions] = useState<Unit[]>([]);
  const units = useResource<Records<Unit>>(
    `/api/company/properties/${encodeURIComponent(propertyId)}/units?${new URLSearchParams(unitCursor ? { cursor: unitCursor } : {})}`,
  );
  type Candidate={userId:string|null;contactId?:string;name?:string;email?:string|null;membership?:{user:{name:string|null;email:string}}};
  const residents=useResource<Candidate[]>(`/api/company/properties/${encodeURIComponent(propertyId)}/residents?includeContacts=true`);
  const [tenantFormRevision,setTenantFormRevision]=useState(0);
  const [addingTenant,setAddingTenant]=useState(false),[newTenant,setNewTenant]=useState<TenantContact|null>(null);
  const [selectedTenant,setSelectedTenant]=useState<string|null>(initialContactId||null);
  const choices:Candidate[]=[...(residents.data||[]),...(newTenant&&!residents.data?.some(p=>p.contactId===newTenant.id)?[{userId:newTenant.userId,contactId:newTenant.id,name:newTenant.name,email:newTenant.email}]:[])];
  const requestedTenant=selectedTenant??choices[0]?.contactId??choices[0]?.userId??"";
  const selectedTenantId=choices.some(p=>(p.contactId||p.userId)===requestedTenant)?requestedTenant:"";
  const candidateName=(p:Candidate)=>p.name||p.membership?.user.name||p.email||p.membership?.user.email||"Tenant";
  // Browsing options must never remount a pending draft or change its retry identity.
  // Keep already-seen choices so the selected unit survives an independent page load.
  useEffect(() => {
    if (units.data)
      setUnitOptions((previous) => {
        const choices = new Map(previous.map((unit) => [unit.id, unit]));
        for (const unit of units.data!.items)
          if (unit.status === "active") choices.set(unit.id, unit);
        return [...choices.values()];
      });
  }, [units.data]);
  return (
    <>
      <EditorDialog open={addingTenant} title="Add tenant for this lease" onClose={()=>{setAddingTenant(false);setTenantFormRevision(v=>v+1);residents.reload();}}><TenantForm key={tenantFormRevision} saved={row=>{setNewTenant(row);setSelectedTenant(row.id);setAddingTenant(false);residents.reload();}} cancel={()=>setAddingTenant(false)}/></EditorDialog>
      <div className="prerequisite-links">
        <Link
          to={`/company/properties/${encodeURIComponent(propertyId)}/residents`}
        >
          Manage residents
        </Link>{" "}
        ·{" "}
        <Link
          to={`/company/properties/${encodeURIComponent(propertyId)}/units`}
        >
          Manage units for this property
        </Link>
      </div>
      <p className="help">Choose an existing tenant or add a contact without leaving this lease. A portal account is not required.</p><button type="button" className="secondary" onClick={()=>setAddingTenant(true)}>Add tenant for this lease</button>
      <ol className="lease-setup-progress" aria-label="Lease setup progress">
        <li aria-current={!review?"step":undefined}>1. Rental and terms</li>
        <li aria-current={review?"step":undefined}>2. Review and record</li>
        <li>3. Household, invitations and billing</li>
      </ol>
      {!residents.data ? (
        <Load
          error={residents.error}
          retry={residents.reload}
          label="assigned residents"
        />
      ) : (
        <>
          {!unitOptions.length || !choices.length ? (
            units.data && (
              <p>
                Choose an active unit, then add a tenant or select an assigned resident before creating a lease.
              </p>
            )
          ) : (
            <>
              {review && (
                <LeaseReview
                  review={review}
                  storageKey={storageKey}
                  back={() => setReview(null)}
                  saved={(row) => {
                    setReview(null);
                    saved(row);
                    setKey(crypto.randomUUID());
                  }}
                />
              )}
              <div hidden={!!review}>
                <Form
                  key={key}
                  operation="page.data.load"
                  secondaryActions={
                    <DraftReset reset={() => setKey(crypto.randomUUID())} />
                  }
                  label="Review lease"
                  submit={async (form) => {
                    setReview({
                      property: propertyName,
                      unit:
                        unitOptions.find((u) => u.id === form.get("unitId"))
                          ?.label || "Unit",
                      resident:
                        candidateName(choices.find(p=>(p.contactId||p.userId)===form.get("residentId"))!),
                      payload: {
                        propertyId,
                        unitId: form.get("unitId"),
                        ...(choices.find(p=>(p.contactId||p.userId)===form.get("residentId"))?.contactId?{residentContactId:form.get("residentId")}:{residentId:form.get("residentId")}),
                        startsOn: form.get("startsOn"),
                        endsOn: form.get("endsOn") || null,
                        monthlyRent: form.get("monthlyRent"),
                        status: form.get("status"),
                        submissionKey: key,
                        rentDueDay: Number(form.get("rentDueDay")),
                        graceDays: Number(form.get("graceDays")),
                        paymentInstructions:
                          form.get("paymentInstructions") || null,
                      },
                    });
                  }}
                >
                  <div className="form-grid">
                    <label>
                      Unit for new lease
                      <select name="unitId" required>
                        {unitOptions.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Primary resident
                      <select name="residentId" required value={selectedTenantId} onChange={e=>setSelectedTenant(e.target.value)}>
                        <option value="">Choose a tenant</option>
                        {choices.map((person) => (
                          <option key={person.contactId||person.userId} value={person.contactId||person.userId||""}>
                            {candidateName(person)}{!person.userId?" · No portal account":""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {initialContactId&&!choices.some(p=>p.contactId===initialContactId)&&!selectedTenantId&&<p role="alert">This tenant is not eligible for the selected property. Review their record or choose another tenant explicitly.</p>}
                  <LeaseTerms prefix="New lease" />
                  <p className="help">
                    One active lease is allowed per unit. Review the details,
                    then select Review lease before saving.
                  </p>
                </Form>
              </div>
            </>
          )}
        </>
      )}
      {!units.data ? (
        <Load error={units.error} retry={units.reload} label="units" />
      ) : (
        <Pager
          next={units.data.nextCursor}
          cursor={unitCursor}
          change={setUnitCursor}
        />
      )}
    </>
  );
}
export function LeaseTerms({
  prefix,
  value,
  draftOnly = false,
  lockPaymentTerms = !!value?.hasTermHistory,
}: {
  prefix: string;
  value?: Lease;
  draftOnly?: boolean;
  lockPaymentTerms?:boolean;
}) {
  const endDateHelpId = useId();
  return (
    <>
      <fieldset className="form-section">
        <legend>Lease dates and rent</legend>
        <p className="help">Start date and monthly rent are required. Dates use the month name, day and year.</p>
        <div className="form-grid">
          <label>
            {prefix} start date
            <DateField
              name="startsOn" aria-label={`${prefix} start date`}
              required
              defaultValue={value?.startsOn.slice(0, 10)}
            />
          </label>
          <div>
            <label>
              {prefix} end date
              <DateField
                name="endsOn" aria-label={`${prefix} end date`}
                aria-describedby={endDateHelpId}
                defaultValue={value?.endsOn?.slice(0, 10)}
              />
            </label>
            <p className="help" id={endDateHelpId}>
              Leave blank for an open-ended record; ended records require a date.
            </p>
          </div>
          <label>
            {prefix} monthly rent (USD)
            <input
              name="monthlyRent"
              readOnly={lockPaymentTerms}
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              required
              defaultValue={
                value ? (value.rentCents / 100).toFixed(2) : undefined
              }
            />
          </label>
          <label>
            {prefix} status
            <select
              name="status"
              defaultValue={draftOnly ? "draft" : value?.status || "draft"}
              disabled={draftOnly}
            >
              <option value="draft">Draft</option>
              {!draftOnly && <option value="active">Active</option>}
              {!draftOnly && <option value="ended">Ended</option>}
            </select>
          </label>
        </div>
      </fieldset>
      {lockPaymentTerms&&<p className="notice">Use Terms &amp; changes to review future payment terms. This form manages dates and the recorded lease setup.</p>}
      <PaymentTerms prefix={prefix} value={value} locked={lockPaymentTerms} />
    </>
  );
}

function PaymentTerms({ prefix, value,locked=false }: { prefix: string; value?: Lease;locked?:boolean }) {
  const [due, setDue] = useState(value?.rentDueDay ?? 1),
    [grace, setGrace] = useState(String(value?.graceDays ?? 0));
  const preview = new Date("2026-11-01T00:00:00Z");
  preview.setUTCDate(Math.min(due, 30));
  const through = new Date(preview);
  const graceNumber = Number(grace),
    validGrace =
      grace !== "" &&
      Number.isInteger(graceNumber) &&
      graceNumber >= 0 &&
      graceNumber <= 30;
  through.setUTCDate(through.getUTCDate() + (validGrace ? graceNumber : 0));
  const after = new Date(through);
  after.setUTCDate(after.getUTCDate() + 1);
  return (
    <>{locked&&<><input type="hidden" name="rentDueDay" value={due}/><input type="hidden" name="graceDays" value={grace}/><input type="hidden" name="paymentInstructions" value={value?.paymentInstructions||""}/></>}
    <fieldset disabled={locked} className="editor-section payment-terms">
      <legend>Rent payment terms</legend>
      <div className="form-grid">
        <label>
          {prefix} rent due day
          <select
            name="rentDueDay"
            value={due}
            onChange={(e) => setDue(Number(e.target.value))}
          >
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                Day {i + 1}
              </option>
            ))}
          </select>
        </label>
        <label>
          {prefix} grace period (days after due date)
          <input
            name="graceDays"
            type="number"
            required
            min="0"
            max="30"
            step="1"
            value={grace}
            onChange={(e) => setGrace(e.target.value)}
          />
        </label>
      </div>
      <p className="help">
        Due days 29–31 use the last day when a month is shorter. Grace is
        counted in full calendar days after the due date, in the company
        timezone.
      </p>
      <p className="policy-example">
        Example: November rent due {formatDate(preview.toISOString())} · grace
        through {formatDate(through.toISOString())} · past grace from{" "}
        {formatDate(after.toISOString())}.
      </p>
      <label>
        {prefix} payment instructions shared with resident (optional)
        <textarea
          name="paymentInstructions"
          maxLength={1000}
          defaultValue={value?.paymentInstructions || ""}
          placeholder="How and where to send manually recorded payments"
        />
      </label>
      <p className="help">
        Settings apply to newly posted charges. Existing charges retain their
        saved grace period. No automatic late fees are charged.
      </p>
    </fieldset></>
  );
}

export function LeaseRenewal({
  previous,
  saved,
}: {
  previous: Lease;
  saved: (row: { id:string }) => void;
}) {
  const auth = useAuth().data,
    storageKey = `pf:lease-renewal:${auth?.user.id}:${auth?.membership?.companyId}:${previous.id}`;
  const [review, setReview] = useState<LeaseReviewData | null>(() =>
    leasePending(storageKey),
  );
  const [key] = useState(() => crypto.randomUUID());
  const start = new Date(previous.endsOn!);
  start.setUTCDate(start.getUTCDate() + 1);
  const proposed = {
    ...previous,
    startsOn: start.toISOString(),
    endsOn: null,
    status: "draft",
  };
  return (
    <>
      <ol className="lease-setup-progress" aria-label="Lease renewal progress">
        <li aria-current={!review?"step":undefined}>1. Next-term details</li>
        <li aria-current={review?"step":undefined}>2. Review renewal draft</li>
        <li>3. Review household and transition</li>
      </ol>
      {review && (
        <LeaseReview
          review={review}
          storageKey={storageKey}
          back={() => setReview(null)}
          saved={saved}
        />
      )}
      <div hidden={!!review}>
        <Form
          operation="page.data.load"
          label="Review renewal"
          submit={async (f) =>
            setReview({
              property: previous.property.name,
              unit: previous.unit.label,
              resident: previous.resident.name||previous.resident.email,
              payload: {
                propertyId: previous.propertyId,
                unitId: previous.unitId,
                ...(previous.residentContactId?{residentContactId:previous.residentContactId}:{residentId:previous.residentId}),
                previousLeaseId: previous.id,
                expectedPreviousVersion: previous.version,
                startsOn: f.get("startsOn"),
                endsOn: f.get("endsOn") || null,
                monthlyRent: f.get("monthlyRent"),
                rentDueDay: Number(f.get("rentDueDay")),
                graceDays: Number(f.get("graceDays")),
                paymentInstructions: f.get("paymentInstructions") || null,
                status: "draft",
                submissionKey: key,
              },
            })
          }
        >
          <p>
            {previous.property.name} · {previous.unit.label} ·{" "}
            {previous.resident.name || previous.resident.email}
          </p>
          <p className="notice">
            Previous term ends {formatDate(previous.endsOn)}. Review a new
            term starting afterward. This does not end the previous lease or
            stop its rent schedule.
          </p>
          <LeaseTerms prefix="Renewal" value={proposed} draftOnly lockPaymentTerms={false} />
        </Form>
      </div>
    </>
  );
}
