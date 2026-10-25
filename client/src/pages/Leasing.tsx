import { TaskDraftPanel, TaskDraftAccessNotice, TaskSourceUnavailable, useTaskDraft, readLeaseDraft, type TaskDraft } from "../components/TaskDraft";
import { useEditorSelection } from "../useEditorSelection";
import { useDebouncedValue } from "../useDebouncedValue";
import { TenantForm,type TenantContact } from "../components/TenantForm";
import { formatDate } from "../dates";
import { leasePath, unitDirectoryPath, unitListContext } from "../lease-links";
import { prospectContext, withProspectContext } from "../prospect-context";
import { DateField } from "../components/DateField";
import {
  LeaseReview,
  leasePending,
  type LeaseReviewData,
} from "../components/LeaseReview";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { UnitFields, type UnitExtras } from "../components/PropertyFields";
import { EditorDialog } from "../components/EditorDialog";
import { DraftReset } from "../components/DraftReset";
import { PropertyNavigation } from "../components/PropertyNavigation";
import { Form } from "../components/Form";
import { DirectoryView, type DirectoryFilter } from "../components/DirectoryView";
import { availableFeatureRoute } from "../company-features";
import { tenantEditorScope, useTenantEditorRecord } from "../tenant-write-access";
import "../components/LandlordForms.css";
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
function mergeLeaseUnitChoices(previous: Unit[], incoming: Unit[]) {
  const choices = new Map(previous.map(unit => [unit.id, unit]));
  for (const unit of incoming) {
    const existing = choices.get(unit.id);
    if (!existing || !Number.isSafeInteger(existing.version) || unit.version >= existing.version) choices.set(unit.id, unit);
  }
  return [...choices.values()];
}
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
  label = "Directory pages",
}: {
  next: string | null;
  cursor: string;
  change: (value: string) => void;
  label?: string;
}) {
  return (
    <nav className="directory-pagination" aria-label={label}>
      <span className="directory-page-context">{cursor ? "Later results · return to the first page to start again." : next ? "More records are available on the next page." : "All matching records are shown."}</span>
      <div className="actions">
      {cursor && (
        <button type="button" className="secondary" onClick={() => change("")}>
          First page
        </button>
      )}
      {next && (
        <button type="button" className="secondary" onClick={() => change(next)}>
          Next page
        </button>
      )}
      </div>
    </nav>
  );
}
export function Units() {
  const { propertyId = "" } = useParams(),
    { data, can } = useAuth();
  const scope = tenantEditorScope(data);
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
  const { can, data: auth } = useAuth();
  const unitReadOnly = auth?.companyFeatures?.properties === "read_only";
  const [params, setParams] = useSearchParams();
  const cursor = params.get("cursor") || "",
    query = params.get("q") || "",
    status = params.get("status") || "";
  const [adding, setAdding] = useState(false),
    [selected, setSelected, selectedOpen, saveSelectedDraft] = useEditorSelection<Unit | null>(null);
  const [unitDraftStarted, setUnitDraftStarted] = useState(false);
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
  const search = useDebouncedValue(query.trim());
  const propertyResource = useResource<{ id: string; name: string }>(
    `/api/company/properties/${encodeURIComponent(propertyId)}`,
  );
  const property = { ...propertyResource, data: useTenantEditorRecord(propertyResource, tenantEditorScope(auth)) };
  const r = useResource<Records<Unit>>(
    `/api/company/properties/${encodeURIComponent(propertyId)}/units?${new URLSearchParams(Object.entries({ cursor, q: search, status }).filter(([, value]) => value))}`,
    true,
    true,
  );
  const reload = () => {
    change("cursor", "");
    r.reload();
    setError("");
  };
  const clearUnitFilters = () => {
    const next = new URLSearchParams(params);
    for (const key of ["q", "status", "cursor"]) next.delete(key);
    setParams(next, { replace: true });
  };
  const unitFilters: DirectoryFilter[] = [
    ...(query.trim() ? [{ key: "q", label: "Search", value: query.trim(), remove: () => change("q", "") }] : []),
    ...(status ? [{ key: "status", label: "Unit view", value: status === "archived" ? "Archived" : status === "active" ? "Active" : "Selected view", remove: () => change("status", "") }] : []),
  ];
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
        {editable && <div className="actions"><button disabled={!property.data || unitReadOnly} onClick={() => { setUnitDraftStarted(true); setAdding(true); }}>Add a unit</button>{!unitReadOnly && <Link className="button secondary" to="/company/imports/units">Import units from CSV</Link>}{unitReadOnly && unitDraftStarted && !adding && <button className="secondary" onClick={() => setAdding(true)}>Resume unit draft</button>}{unitReadOnly && selected && !selectedOpen && <button className="secondary" onClick={() => setSelected(selected)}>Resume unit edit · {selected.label}</button>}</div>}
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
              onClose={() => setAdding(false)} onDiscard={() => { setAdding(false); setUnitDraftStarted(false); setKey(crypto.randomUUID()); }}
            >
              <Form
                locked={unitReadOnly}
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
                  setUnitDraftStarted(false);
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
          <section className="panel directory-panel directory-workbench leasing-directory-panel" aria-label="Unit directory">
            <h2>Unit records</h2>
            {search !== query.trim() && <p role="status" className="help">Updating search…</p>}
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
            </div>
            <DirectoryView filters={unitFilters} clear={clearUnitFilters} scope={property.data.name} summary={<span role="status">{r.error ? "Unit count unavailable" : r.data ? `${r.data.items.length} ${r.data.items.length === 1 ? "unit" : "units"} on this page` : "Loading units…"}</span>} />
            {r.data && r.error && (
              <Load error={r.error} retry={r.reload} label="units" />
            )}

            {!r.data ? (
              <Load error={r.error} retry={r.reload} label="units" />
            ) : (
              <>
                {!r.data.items.length ? (
                  <div className="empty-state directory-empty">
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
                            disabled={unitReadOnly}
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
                  label="Unit directory pages"
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
          key={selected.id}
          open={selectedOpen}
          onSaveDraft={saveSelectedDraft}
          title={`Edit unit ${selected.label}`}
          onClose={() => {
            setSelected(null);
            reload();
          }}
        >
          {" "}
          <Form
            locked={unitReadOnly}
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
  const scope = `${tenantEditorScope(data)}:${pathParams.propertyId || routeParams.get("propertyId") || ""}`;
  return <LeaseList key={scope} />;
}
function LeaseList() {
  const navigate = useNavigate();
  const { data: auth, can } = useAuth();
  const leaseReadOnly = auth?.companyFeatures?.leasing === "read_only";
  const { propertyId: pathPropertyId } = useParams();
  const [params, setParams] = useSearchParams();
  const adding = params.get("new") === "lease";
  const setAdding = (open: boolean) => setParams(previous => {
    const next = new URLSearchParams(previous);
    if (open) next.set("new", "lease"); else next.delete("new");
    return next;
  }, { replace: !open });
  const [selected, setSelected, selectedOpen, saveSelectedDraft] = useEditorSelection<Lease | null>(null),
    [renewing, setRenewing, renewingOpen, saveRenewingDraft] = useEditorSelection<Lease | null>(null);
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
  const search = useDebouncedValue(query.trim());
  const propertyResource = useResource<{ id: string; name: string }[]>(
    "/api/company/properties",
  );
  const properties = { ...propertyResource, data: useTenantEditorRecord(propertyResource, tenantEditorScope(auth)) };
  const r = useResource<Records<Lease> & { unit?: Unit }>(
    `/api/company/leases?${new URLSearchParams(Object.entries({ cursor, propertyId: contextId, unitId, status, attention, approvals, q: search }).filter(([, value]) => value))}`,
    true,
    true,
  );
  const initializedProperty = useRef(false);
  useEffect(() => {
    if (!properties.data || initializedProperty.current) return;
    initializedProperty.current = true;
    if (!propertyId && properties.data.length === 1) {
      const id = properties.data[0].id;
      setPropertyId(id);
      setVisitedProperties(previous => previous.includes(id) ? previous : [...previous, id]);
    }
  }, [properties.data, propertyId]);
  const propertyName = properties.data?.find((p) => p.id === contextId)?.name;
  const detailPath = (id: string, section?: string) =>
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
          ...prospectContext(params),
          ...(section ? { section } : approvals ? { section: "invitations" } : {}),
        }).filter(([, value]) => value),
      ),
    );
  const reload = () => {
    setCursor("");
    r.reload();
  };
  const removeLeaseFilter = (keys: string[]) => {
    const next = new URLSearchParams(params);
    for (const key of keys) next.delete(key);
    setCursor(""); setParams(next, { replace: true });
  };
  const clearLeaseFilters = () => removeLeaseFilter(["q", "status", "attention", "approvals", ...(!pathPropertyId && !unitId ? ["propertyId"] : [])]);
  const leaseViewLabel = approvals ? "Resident approvals needed" : ({ draft: "Draft", active: "Active", ended: "Ended", in_effect: "In effect today", ending_soon: "Ending within 30 days", past_end: "Past end, still active" } as Record<string, string>)[attention || status];
  const leaseFilters: DirectoryFilter[] = [
    ...(query.trim() ? [{ key: "q", label: "Search", value: query.trim(), remove: () => removeLeaseFilter(["q"]) }] : []),
    ...(!pathPropertyId && !unitId && contextId ? [{ key: "property", label: "Property", value: propertyName || "Selected property", remove: () => removeLeaseFilter(["propertyId"]) }] : []),
    ...(approvals || attention || status ? [{ key: "view", label: "Lease view", value: leaseViewLabel || "Selected view", remove: () => removeLeaseFilter(["status", "attention", "approvals"]) }] : []),
  ];
  const canViewFinance = can("finance.manage") && availableFeatureRoute("/company/rent", auth?.companyFeatures, auth?.membership?.role);
  return (
    <>
      <div hidden={adding}>
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
            <Link to={withProspectContext("/company/leases", params)}>View all company leases</Link>
          </p>
        )}
        </div><div className="actions"><button disabled={leaseReadOnly} onClick={() => setAdding(true)}>Record a lease</button>
        {leaseReadOnly && selected && !selectedOpen && <button className="secondary" onClick={() => setSelected(selected)}>Resume lease edit · {selected.unit.label}</button>}
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
      </div>
      <EditorDialog
        presentation="page"
        eyebrow="Lease setup"
        backLabel="Back to leases"
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
                  active={propertyId === id}
                  unitHint={{ id: unitId, loading: r.loading, failed: !!r.error, candidate: r.data?.unit }}
                  initialContactId={params.get("contactId") || undefined}
                  propertyName={
                    properties.data!.find((p) => p.id === id)?.name ||
                    "Property"
                  }
                  saved={(row) => {
                    reload();
                    navigate(
                      leasePath(row.id, { onboarding: "household", ...prospectContext(params) }),
                    );
                  }}
                />
              </div>
            ))}
          </>
        )}
      </EditorDialog>
      <div hidden={adding}>
      <section className="panel directory-workbench leasing-directory-panel" aria-label="Lease directory">
        <div className="section-heading">
          <h2>
            {contextId ? "Property lease history" : "Company lease history"}
          </h2>

        </div>
        {search !== query.trim() && <p role="status" className="help">Updating search…</p>}
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
                  ...prospectContext(params),
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
        <DirectoryView filters={leaseFilters} clear={clearLeaseFilters} scope={unitId ? `Selected unit: ${r.data?.unit?.label || "Unit history"}` : contextId ? `${propertyName || "Selected property"} · lease records` : "All company properties · lease records"} summary={<span role="status">{r.error ? "Lease count unavailable" : r.data ? `${r.data.items.length} leases on this page` : "Loading leases…"}</span>} />
        {r.data && r.error && (
          <Load error={r.error} retry={r.reload} label="leases" />
        )}

        {!r.data ? (
          <Load error={r.error} retry={r.reload} label="leases" />
        ) : (
          <>
            {!r.data.items.length ? (
              <div className="empty-state directory-empty">
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
                        <td data-label="Property & unit">
                          <Link
                            className="table-primary"
                            to={withProspectContext(`/company/properties/${encodeURIComponent(lease.propertyId)}/leases`, params)}
                          >
                            {lease.property.name}
                          </Link>
                          <span className="cell-detail">
                            {lease.unit.label}
                          </span>
                        </td>
                        <td data-label="Primary tenant">
                          <Link to={detailPath(lease.id)}>
                            {lease.resident.name || lease.resident.email}
                          </Link>
                          {lease.resident.name && lease.resident.email && (
                            <span className="cell-detail">
                              {lease.resident.email}
                            </span>
                          )}
                        </td>
                        <td data-label="Lease term">
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
                        <td data-label="Status">
                          <span className={`status-pill ${lease.status}`}>
                            {lease.status === "active"
                              ? "Active"
                              : lease.status === "draft"
                                ? "Draft"
                                : "Ended"}
                          </span>
                          <p className="lease-workflow-hint">{lease.status === "draft" ? "Review household and terms before activation." : lease.status === "ended" ? "History and source balances are retained." : lease.renewals?.length ? "A linked next term is already prepared." : "Review household, terms and the next transition."}</p>
                          <Link className="lease-context-action" to={detailPath(lease.id, lease.status === "draft" ? "household" : lease.status === "ended" ? "overview" : "renewal")}>{lease.status === "draft" ? "Continue lease setup" : lease.status === "ended" ? "Review lease history" : "Review next term"}</Link>
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
                                {canViewFinance && <Link
                                  to={withProspectContext(`/company/rent?leaseId=${encodeURIComponent(lease.id)}`, params)}
                                >
                                  Rent &amp; payments →
                                </Link>}
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
                                      disabled={leaseReadOnly}
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
                                  disabled={leaseReadOnly}
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
              label="Lease directory pages"
              next={r.data.nextCursor}
              cursor={cursor}
              change={setCursor}
            />
          </>
        )}
      </section>
      <EditorDialog
        key={renewing?.id}
        open={renewingOpen} onSaveDraft={saveRenewingDraft}
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
                ...prospectContext(params),
                ...(!pathPropertyId ? { propertyId: renewing.propertyId } : {}),
                status: "draft",
              });
            }}
          />
        )}
      </EditorDialog>
      {selected && (
        <EditorDialog
          key={selected.id}
          open={selectedOpen}
          onSaveDraft={saveSelectedDraft}
          title={`Edit lease · ${selected.property.name} · ${selected.unit.label}`}
          onClose={() => {
            setSelected(null);
            reload();
          }}
        >
          {" "}
          <Form
            locked={leaseReadOnly}
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
      </div>
    </>
  );
}
export function LeaseCreate({
  propertyId,
  propertyName,
  initialContactId,
  initialTask,
  active = true,
  unitHint,
  saved,
}: {
  propertyId: string;
  propertyName: string;
  initialContactId?:string;
  initialTask?: TaskDraft;
  active?: boolean;
  unitHint?: { id: string; loading: boolean; failed: boolean; candidate?: Unit };
  saved: (row: { id:string }) => void;
}) {
  const [returnParams] = useSearchParams();
  const auth = useAuth().data,
    storageKey = `pf:lease-setup:${auth?.user.id}:${auth?.membership?.companyId}:${propertyId}`;
  const [openingReview] = useState<LeaseReviewData | null>(() => leasePending(storageKey));
  const [review, setReview] = useState<LeaseReviewData | null>(openingReview);
  const [savedLease, setSavedLease] = useState<string | null>(null);
  const [openingUnitHint] = useState(unitHint?.id || "");
  const hintScope = JSON.stringify([auth?.user.id, auth?.user.status, auth?.user.emailVerified, auth?.membership?.companyId,
    auth?.membership?.version, auth?.permissions, auth?.impersonation?.contextId, auth?.companyFeatures]);
  const openingHintScope = useRef(hintScope), edited = useRef(!!openingReview || !!initialTask), hintConsumed = useRef(!!openingReview || !!initialTask);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(() => typeof openingReview?.payload.unitId === "string" ? openingReview.payload.unitId : typeof initialTask?.values.unitId === "string" ? initialTask.values.unitId : null);
  const [key, setKey] = useState(() => initialTask?.actionKey || crypto.randomUUID()),
    [unitCursor, setUnitCursor] = useState("");
  const [unitOptions, setUnitOptions] = useState<Unit[]>([]);
  const [observedHint, setObservedHint] = useState<Unit>();
  const units = useResource<Records<Unit>>(
    `/api/company/properties/${encodeURIComponent(propertyId)}/units?${new URLSearchParams(unitCursor ? { cursor: unitCursor } : {})}`,
  );
  type Candidate={userId:string|null;contactId?:string;name?:string;email?:string|null;membership?:{user:{name:string|null;email:string}}};
  const residentsResource=useResource<Candidate[]>(`/api/company/properties/${encodeURIComponent(propertyId)}/residents?includeContacts=true`);
  const residents={...residentsResource,data:useTenantEditorRecord(residentsResource,`${tenantEditorScope(auth)}:${propertyId}`)};
  const [tenantFormRevision,setTenantFormRevision]=useState(0);
  const [addingTenant,setAddingTenant]=useState(false),[newTenant,setNewTenant]=useState<TenantContact|null>(null);
  const [selectedTenant,setSelectedTenant]=useState<string|null>(String(initialTask?.values.residentContactId || initialTask?.values.residentId || initialContactId || "") || null);
  const choices:Candidate[]=[...(residents.data||[]),...(newTenant&&!residents.data?.some(p=>p.contactId===newTenant.id)?[{userId:newTenant.userId,contactId:newTenant.id,name:newTenant.name,email:newTenant.email}]:[])];
  const requestedTenant=selectedTenant??(choices.length===1?(choices[0].contactId||choices[0].userId||""):"");
  const selectedTenantId=choices.some(p=>(p.contactId||p.userId)===requestedTenant)?requestedTenant:"";
  const candidateName=(p:Candidate)=>p.name||p.membership?.user.name||p.email||p.membership?.user.email||"Tenant";
  const container = useRef<HTMLDivElement>(null);
  const task = useTaskDraft({kind:"lease_create",propertyId,initial:initialTask,element:container,
    disabled:!!leasePending(storageKey),readValues:()=>readLeaseDraft(container.current,choices.find(person=>(person.contactId||person.userId)===selectedTenantId)?.contactId)});
  const acceptExactUnit = (unit: Unit) => setUnitOptions(previous => mergeLeaseUnitChoices(previous,[unit]));
  // Browsing options must never remount a pending draft or change its retry identity.
  // Keep already-seen choices so the selected unit survives an independent page load.
  useEffect(() => {
    if (units.data) {
      const observed = units.data.items.find(unit => unit.id === openingUnitHint);
      if (observed) setObservedHint(previous => !previous || observed.version >= previous.version ? observed : previous);
      setUnitOptions((previous) => {
        return mergeLeaseUnitChoices(previous, units.data!.items.filter(unit => unit.status === "active"));
      });
    }
  }, [units.data, openingUnitHint]);
  const candidate = unitHint?.candidate;
  // Include inactive page observations: a newer archived record must prevent
  // an older in-flight active lookup from initializing this intake.
  const newestHint = [observedHint, units.data?.items.find(unit => unit.id === openingUnitHint), candidate]
    .filter((unit): unit is Unit => !!unit && unit.id === openingUnitHint && Number.isSafeInteger(unit.version) && unit.version >= 1)
    .reduce<Unit | undefined>((newest, unit) => !newest || unit.version > newest.version ? unit : newest, undefined);
  const verifiedCandidate = !unitHint?.loading && !unitHint?.failed && unitHint?.id === openingUnitHint && candidate &&
    candidate.id === openingUnitHint && candidate.propertyId === propertyId && candidate.status === "active" &&
    Number.isSafeInteger(candidate.version) && candidate.version >= 1 && newestHint?.status === "active" &&
    newestHint.propertyId === propertyId && typeof newestHint.label === "string" && !!newestHint.label.trim()
      ? newestHint : undefined;
  useEffect(() => {
    // A returned page or background refresh is advisory. It must never rewrite
    // a different property, an edited intake or a retained submission journal.
    if (hintScope !== openingHintScope.current) hintConsumed.current = true;
    if (!active || !openingUnitHint || hintConsumed.current || edited.current || review || !verifiedCandidate || hintScope !== openingHintScope.current) return;
    setUnitOptions(previous => mergeLeaseUnitChoices(previous, [verifiedCandidate]));
    setSelectedUnit(verifiedCandidate.id);
    hintConsumed.current = true;
  }, [active, openingUnitHint, verifiedCandidate, review, hintScope]);
  const hintUnavailable = openingUnitHint && !review && !hintConsumed.current && !unitHint?.loading && !verifiedCandidate;
  const unitValue = selectedUnit ?? (openingUnitHint ? "" : unitOptions[0]?.id || "");
  if (task.accessDenied) return <TaskDraftAccessNotice task={task}/>;
  if (task.sourceUnavailable) return <TaskSourceUnavailable task={task}/>;
  if (savedLease) return <p className="notice" role="status">Lease recorded. <Link to={leasePath(savedLease, { onboarding:"household", ...prospectContext(returnParams) })}>Open the recorded lease workspace</Link>. Other unfinished property tasks are kept until you choose to leave.</p>;
  return (
    <div ref={container}>
      {!review && <TaskDraftPanel task={task}/>}
      {initialTask && selectedUnit && !unitOptions.some(unit=>unit.id===selectedUnit) && <SavedLeaseUnit id={selectedUnit} propertyId={propertyId} loaded={acceptExactUnit}/>}
      <EditorDialog open={addingTenant} title="Add tenant for this lease" onSaveDraft={()=>setAddingTenant(false)} onClose={()=>{setAddingTenant(false);setTenantFormRevision(v=>v+1);residents.reload();}}><TenantForm key={tenantFormRevision} saved={row=>{edited.current=true;setNewTenant(row);setSelectedTenant(row.id);setAddingTenant(false);residents.reload();}} cancel={()=>setAddingTenant(false)}/></EditorDialog>
      <ol className="lease-setup-progress" aria-label="Lease setup progress">
        <li aria-current={!review?"step":undefined}>1. Rental and terms</li>
        <li aria-current={review?"step":undefined}>2. Review and record</li>
        <li>3. Household, invitations and billing</li>
      </ol>
      <div className="lease-setup-tools" hidden={!!review}>
        <p className="help">Choose an existing tenant or add one here. Each tenant has one Auth0 account; activating portal access is optional.</p>
        <div className="actions">
          <button type="button" className="secondary" disabled={task.uncertain || task.writeBlocked} onClick={()=>{edited.current=true;setAddingTenant(true);}}>Add tenant for this lease</button>
          <details className="lease-setup-links"><summary>Property setup options</summary><div className="actions">
            <Link to={withProspectContext(`/company/properties/${encodeURIComponent(propertyId)}/residents`, returnParams)}>Manage residents</Link>
            <Link to={`/company/properties/${encodeURIComponent(propertyId)}/units`}>Manage units for this property</Link>
          </div></details>
        </div>
      </div>
      {openingUnitHint && !review && !hintConsumed.current && <p role="status" className="help">
        {hintUnavailable ? "Suggested unit is unavailable for this property. Choose an active unit."
          : edited.current ? "Choose an active unit. Your existing edits have been kept."
            : unitHint?.loading ? "Checking suggested unit…" : "Choose an active unit."}
      </p>}
      {review && (
        <LeaseReview
          review={review}
          prepare={task.beforeCommit}
          finished={task.finish}
          failed={task.observeBusinessError}
          completedElement={container}
          storageKey={storageKey}
          back={() => setReview(null)}
          saved={(row) => {
            setSavedLease(row.id);
            setReview(null);
            saved(row);
            setKey(crypto.randomUUID());
          }}
        />
      )}
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
              <div hidden={!!review} onChangeCapture={() => { edited.current = true; }}>
                <Form
                  key={key}
                  taskValues
                  locked={task.uncertain || task.writeBlocked || !!task.currentRecord}
                  operation="page.data.load"
                  secondaryActions={
                    <DraftReset reset={() => { edited.current = true; hintConsumed.current = true; setSelectedUnit(null); setKey(crypto.randomUUID()); }} />
                  }
                  reviewOnly
                  label="Review lease"
                  submit={async (form) => {
                    await task.review();
                    edited.current = true;
                    hintConsumed.current = true;
                    setSelectedUnit(String(form.get("unitId") || ""));
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
                        submissionKey: task.record?.actionKey || key,
                        rentDueDay: Number(form.get("rentDueDay")),
                        graceDays: Number(form.get("graceDays")),
                        paymentInstructions:
                          form.get("paymentInstructions") || null,
                      },
                    });
                  }}
                >
                  <fieldset className="form-section"><legend>Rental and tenant</legend><div className="form-grid">
                    <label>
                      Unit for new lease
                      <select name="unitId" required value={unitValue} onChange={event => { edited.current = true; setSelectedUnit(event.target.value); }}>
                        {openingUnitHint && <option value="">Choose an active unit</option>}
                        {selectedUnit && !unitOptions.some(unit => unit.id === selectedUnit) && openingReview && <option value={selectedUnit}>{openingReview.unit} · recorded selection</option>}
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
                            {candidateName(person)}{!person.userId?" · Account will be prepared":""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div></fieldset>
                  {initialContactId&&!choices.some(p=>p.contactId===initialContactId)&&!selectedTenantId&&<p role="alert">This tenant is not eligible for the selected property. Review their record or choose another tenant explicitly.</p>}
                  <LeaseTerms prefix="New lease" draftValues={initialTask?.values} />
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
    </div>
  );
}
export function LeaseTerms({
  prefix,
  value,
  draftOnly = false,
  lockPaymentTerms = !!value?.hasTermHistory,
  draftValues,
}: {
  prefix: string;
  value?: Lease;
  draftOnly?: boolean;
  lockPaymentTerms?:boolean;
  draftValues?: Record<string,unknown>;
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
              defaultValue={draftValues?.startsOn !== undefined ? String(draftValues.startsOn) : value?.startsOn.slice(0, 10)}
            />
          </label>
          <div>
            <label>
              {prefix} end date
              <DateField
                name="endsOn" aria-label={`${prefix} end date`}
                aria-describedby={endDateHelpId}
                defaultValue={draftValues?.endsOn !== undefined ? String(draftValues.endsOn) : value?.endsOn?.slice(0, 10)}
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
                draftValues?.monthlyRent !== undefined ? String(draftValues.monthlyRent) : value ? (value.rentCents / 100).toFixed(2) : undefined
              }
            />
          </label>
          <label>
            {prefix} status
            <select
              name="status"
              defaultValue={draftOnly ? "draft" : String(draftValues?.status || value?.status || "draft")}
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
      <PaymentTerms prefix={prefix} value={value} locked={lockPaymentTerms} draftValues={draftValues} />
    </>
  );
}

function PaymentTerms({ prefix, value,locked=false,draftValues }: { prefix: string; value?: Lease;locked?:boolean;draftValues?:Record<string,unknown> }) {
  const [due, setDue] = useState(Number(draftValues?.rentDueDay ?? value?.rentDueDay ?? 1)),
    [grace, setGrace] = useState(String(draftValues?.graceDays ?? value?.graceDays ?? 0));
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
      <details className="payment-policy-help"><summary>How due dates and grace are applied</summary><p className="help">
        Due days 29–31 use the last day when a month is shorter. Grace is
        counted in full calendar days after the due date, in the company
        timezone.
      </p></details>
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
          defaultValue={String(draftValues?.paymentInstructions ?? value?.paymentInstructions ?? "")}
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
  initialTask,
  saved,
}: {
  previous: Lease;
  initialTask?: TaskDraft;
  saved: (row: { id:string }) => void;
}) {
  const auth = useAuth().data,
    storageKey = `pf:lease-renewal:${auth?.user.id}:${auth?.membership?.companyId}:${previous.id}`;
  const [review, setReview] = useState<LeaseReviewData | null>(() =>
    leasePending(storageKey),
  );
  const [key] = useState(() => initialTask?.actionKey || crypto.randomUUID());
  const container = useRef<HTMLDivElement>(null);
  const task=useTaskDraft({kind:"lease_renewal",propertyId:previous.propertyId,sourceId:previous.id,initial:initialTask,element:container,
    disabled:!!leasePending(storageKey),readValues:()=>readLeaseDraft(container.current)});
  const start = new Date(previous.endsOn || previous.startsOn);
  start.setUTCDate(start.getUTCDate() + 1);
  const proposed = {
    ...previous,
    startsOn: start.toISOString(),
    endsOn: null,
    status: "draft",
  };
  if (task.accessDenied) return <TaskDraftAccessNotice task={task}/>;
  if (task.sourceUnavailable) return <TaskSourceUnavailable task={task}/>;
  if (!previous.endsOn) return <p role="alert">The current lease has no end date. Review its source before continuing this renewal task.</p>;
  return (
    <div ref={container}>
      {!review && <TaskDraftPanel task={task}/>}
      <ol className="lease-setup-progress" aria-label="Lease renewal progress">
        <li aria-current={!review?"step":undefined}>1. Next-term details</li>
        <li aria-current={review?"step":undefined}>2. Review renewal draft</li>
        <li>3. Review household and transition</li>
      </ol>
      {review && (
        <LeaseReview
          review={review}
          prepare={task.beforeCommit}
          finished={task.finish}
          failed={task.observeBusinessError}
          completedElement={container}
          storageKey={storageKey}
          back={() => setReview(null)}
          saved={saved}
        />
      )}
      <div hidden={!!review}>
        <Form
          taskValues
          locked={task.uncertain || task.writeBlocked || !!task.currentRecord}
          operation="page.data.load"
          reviewOnly
          label="Review renewal"
          submit={async (f) => {
            await task.review();
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
                submissionKey: task.record?.actionKey || key,
              },
            });
          }}
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
          <LeaseTerms prefix="Renewal" value={proposed} draftOnly lockPaymentTerms={false} draftValues={initialTask?.values} />
        </Form>
      </div>
    </div>
  );
}

function SavedLeaseUnit({id,propertyId,loaded}:{id:string;propertyId:string;loaded:(unit:Unit)=>void}) {
  const response=useResource<{unit?:Unit}>(`/api/company/leases?${new URLSearchParams({propertyId,unitId:id})}`,true,true);
  useEffect(()=>{const unit=response.data?.unit;if(unit?.id===id && unit.propertyId===propertyId && unit.status==="active")loaded(unit);},[response.data,id,propertyId]);
  if(response.error)return <p role="alert">The saved unit could not be loaded. {response.error} <button type="button" onClick={response.reload}>Try again</button></p>;
  if(response.data && (!response.data.unit || response.data.unit.propertyId!==propertyId || response.data.unit.status!=="active"))return <p role="alert">The saved unit is unavailable. Choose an eligible active unit explicitly.</p>;
  return null;
}
