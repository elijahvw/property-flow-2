import { useDebouncedValue } from "../useDebouncedValue";
import { usePropertySearchParams } from "../usePropertySearchParams";
import { DraftReset } from "../components/DraftReset";
import { PropertyNavigation } from "../components/PropertyNavigation";
import { DateField } from "../components/DateField";
import { useAuth } from "../context/AuthContext";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { formatDate, formatActivityDate, formatActivityTime } from "../dates";
import { useResource } from "../useResource";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "../components/Form";
import { MaintenanceCosts } from "../components/MaintenanceCosts";
import { PrivateDocuments } from "../components/PrivateDocuments";
import { PreventiveSource } from "../components/PreventiveSource";
import { MaintenanceVendor } from "../components/MaintenanceVendor";
import { WorkOrderPanel } from "./WorkOrders";
type Row = {
  id: string;
  propertyId: string;
  unitId: string | null;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  executionStatus?: string;
  version: number;
  targetOn: string | null;
  assigneeName?:string|null;
  createdAt: string;
  updatedAt: string;
  property: { name: string };
  unit: { label: string } | null;
};
type Detail = Row & {
  recordedBy?: string;
  residentUpdatesAvailable?: boolean;
  historyLimited: boolean;
  activity: {
    id: string;
    action: string;
    actorName?: string;
    createdAt: string;
    from?: string;
    to?: string;
    changes?: Record<string, { from: string | null; to: string | null }>;
  }[];
};
const statuses = ["open", "in_progress", "resolved"],
  categories = [
    "plumbing",
    "electrical",
    "hvac",
    "appliance",
    "structural",
    "safety",
    "other",
  ];
const label = (v: string) =>
  (
    ({ in_progress: "In progress", hvac: "Heating & cooling" }) as Record<
      string,
      string
    >
  )[v] || v.slice(0, 1).toUpperCase() + v.slice(1);
function Loading({ error, retry }: { error?: string; retry: () => void }) {
  return error ? (
    <div role="alert" className="notice error">
      <p>{error}</p>
      <button onClick={retry}>Try again</button>
    </div>
  ) : (
    <p role="status">Loading maintenance…</p>
  );
}
function directoryQuery(params: URLSearchParams) {
  const q = new URLSearchParams();
  for (const key of ["propertyId", "status", "priority", "q", "nested", "workStatus", "due", "assignee"])
    if (params.get(key)) q.set(key, params.get(key)!);
  return q;
}
function directoryPath(params: URLSearchParams, resident: boolean) {
  const q = directoryQuery(params),
    property = q.get("propertyId"),
    nested = q.get("nested") === "true" && property && !resident;
  q.delete("nested");
  if (nested) q.delete("propertyId");
  return (
    (nested
      ? `/company/properties/${encodeURIComponent(property!)}/maintenance`
      : resident
        ? "/resident/maintenance"
        : "/company/maintenance") + (q.size ? `?${q}` : "")
  );
}
function requestPath(
  id: string,
  params: URLSearchParams,
  resident: boolean,
  nested = false,
) {
  const q = directoryQuery(params);
  if (nested) q.set("nested", "true");
  return (
    `${resident ? "/resident" : "/company"}/maintenance/${encodeURIComponent(id)}` +
    (q.size ? `?${q}` : "")
  );
}
function CategoryField({ value = "other" }: { value?: string }) {
  return (
    <label>
      Category
      <select name="category" aria-label="Category" defaultValue={value}>
        {categories.map((c) => (
          <option key={c} value={c}>
            {label(c)}
          </option>
        ))}
      </select>
    </label>
  );
}
function PriorityField({ value = "normal" }: { value?: string }) {
  return (
    <label>
      Priority
      <select name="priority" aria-label="Priority" defaultValue={value}>
        {["low", "normal", "high"].map((p) => (
          <option key={p} value={p}>
            {label(p)}
          </option>
        ))}
      </select>
    </label>
  );
}
export function UnitPicker({
  propertyId,
  initial,
}: {
  propertyId: string;
  initial?: { id: string; label: string } | null;
}) {
  const [cursor, setCursor] = useState(""),
    [options, setOptions] = useState<
      { id: string; label: string; status: string }[]
    >([]),
    [chosen, setChosen] = useState(initial?.id || "");
  const r = useResource<{
    items: { id: string; label: string; status: string }[];
    nextCursor: string | null;
  }>(
    `/api/company/properties/${encodeURIComponent(propertyId)}/units?${new URLSearchParams(cursor ? { cursor } : {})}`,
  );
  useEffect(() => {
    if (r.data)
      setOptions((old) => [
        ...new Map(
          [...old, ...r.data!.items.filter((u) => u.status === "active")].map(
            (u) => [u.id, u],
          ),
        ).values(),
      ]);
  }, [r.data]);
  return (
    <div>
      <label>
        Unit (optional)
        <select
          name="unitId"
          aria-label="Unit (optional)"
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
        >
          <option value="">Whole property / common area</option>
          {initial && !options.some((u) => u.id === initial.id) && (
            <option value={initial.id}>{initial.label} · recorded unit</option>
          )}
          {options.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </label>
      {!r.data && <Loading error={r.error} retry={r.reload} />}{" "}
      {r.data?.nextCursor && (
        <button
          type="button"
          className="text-button"
          onClick={() => setCursor(r.data!.nextCursor!)}
        >
          Load more units
        </button>
      )}
      <p className="help">
        Choose the affected unit, or leave this as property-wide work.
      </p>
    </div>
  );
}
export function Maintenance({ resident = false }: { resident?: boolean }) {
  const { data } = useAuth();
  return (
    <RequestWorkspace
      key={`${resident}:${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`}
      resident={resident}
    />
  );
}
function RequestWorkspace({ resident }: { resident: boolean }) {
  const [params, setParams, pathPropertyId] = usePropertySearchParams();
  const [adding, setAdding] = useState(false),
    [success, setSuccess] = useState(""),
    [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());
  const status = params.get("status") || "",
    propertyId = params.get("propertyId") || "",
    query = params.get("q") || "",
    priority = params.get("priority") || "",
    due=params.get("due")||"",assignee=params.get("assignee")||"",
    workStatus = params.get("workStatus") || "";
  const search = useDebouncedValue(query.trim()), assigneeSearch=useDebouncedValue(assignee.trim());
  const [newProperty, setNewProperty] = useState("");
  const [createdId, setCreatedId] = useState("");
  const base = resident
    ? "/api/resident/maintenance"
    : "/api/company/maintenance";
  const properties = useResource<{ id: string; name: string }[]>(
    resident ? "/api/resident/properties" : "/api/company/properties",
    true,
    true,
  );
  const r = useResource<Row[]>(
    `${base}?${new URLSearchParams(Object.entries({ status, propertyId, q: search, priority, ...(!resident ? {workStatus,due,assignee:assigneeSearch} : {}) }).filter(([, v]) => v))}`,
    true,
    true,
  );
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const creatingProperty =
    pathPropertyId || newProperty || propertyId || properties.data?.[0]?.id || "";
  return (
    <>
      {!resident && propertyId && <PropertyNavigation id={propertyId} />}
      {!resident && <p className="actions"><Link to="/company/vendors">Vendor directory →</Link><Link to="/company/preventive">Preventive maintenance →</Link></p>}
      <header className="page-heading page-heading-row">
        <div>
          <p className="record-kicker">Operations / Maintenance</p>
          <h1>
            {resident ? "My maintenance requests" : "Maintenance requests"}
          </h1>
          <p>
            {resident
              ? "Track your requests and see updates from your property team."
              : "Record the issue, keep its property and unit together, and follow the work through resolution."}
          </p>
        </div>
        <button
          onClick={() => {
            setSuccess("");
            setCreatedId("");
            if (!newProperty)
              setNewProperty(propertyId || properties.data?.[0]?.id || "");
            setAdding(true);
          }}
        >
          {resident ? "Submit a request" : "Add request"}
        </button>
      </header>
      <EditorDialog
        open={adding}
        title={resident ? "Submit a request" : "Record a maintenance request"}
        onClose={() => setAdding(false)} onDiscard={() => { setAdding(false); setSubmissionKey(crypto.randomUUID()); setNewProperty(""); }}
      >
        <p className="help">
          For emergencies, contact local emergency services. High priority does
          not guarantee an immediate response.
        </p>
        {!properties.data ? (
          <Loading error={properties.error} retry={properties.reload} />
        ) : !properties.data.length ? (
          <p>
            {resident
              ? "No properties assigned. Ask your property manager for an assignment before submitting a request."
              : "Add a property before recording maintenance."}
          </p>
        ) : (
          <Form
            key={submissionKey}
            label={resident ? "Submit request" : "Save request"}
            operation="maintenance.create"
            secondaryActions={
              <DraftReset reset={() => setSubmissionKey(crypto.randomUUID())} />
            }
            submit={async (data) => {
              const saved = await api<Row>(base, {
                method: "POST",
                body: {
                  ...Object.fromEntries(data),
                  ...(!resident
                    ? {
                        unitId: data.get("unitId") || null,
                        targetOn: data.get("targetOn") || null,
                      }
                    : {}),
                  submissionKey,
                },
              });
              r.reload();
              setCreatedId(saved.id);
              setNewProperty("");
              setAdding(false);
              setSubmissionKey(crypto.randomUUID());
              setSuccess(
                resident
                  ? "Request submitted."
                  : "Maintenance request recorded.",
              );
            }}
          >
            <fieldset className="form-section">
              <legend>Location</legend>
              <div className="form-grid">
                <label>
                  {resident ? "Assigned property" : "Property"}
                  <select
                    required
                    name="propertyId"
                    value={creatingProperty}
                    onChange={(e) => setNewProperty(e.target.value)}
                  >
                    {properties.data
                      .filter((p) => !pathPropertyId || p.id === pathPropertyId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                {!resident && creatingProperty && (
                  <UnitPicker
                    key={`${submissionKey}:${creatingProperty}`}
                    propertyId={creatingProperty}
                  />
                )}
              </div>
            </fieldset>
            <fieldset className="form-section">
              <legend>Issue details</legend>
              <p className="help">
                Title and description are required. Include the location of the
                issue and the details needed to arrange the work.
              </p>
              <label>
                Title
                <input
                  required
                  name="title"
                  maxLength={160}
                  placeholder="A short description of the issue"
                />
              </label>
              <label>
                Description
                <textarea
                  required
                  name="description"
                  aria-label="Description"
                  maxLength={4000}
                  rows={5}
                  placeholder="What happened, where it is, and any details needed to arrange the work"
                />
              </label>
              <div className="form-grid">
                <CategoryField />
                <PriorityField />
                {!resident && (
                  <label>
                    Target date (optional)
                    <DateField name="targetOn" aria-label="Target date" />
                  </label>
                )}
              </div>
            </fieldset>
            {!resident && (
              <p className="help">
                Recorded by your account. This creates a maintenance record; it
                does not notify a vendor or send a resident invitation.
              </p>
            )}
          </Form>
        )}
      </EditorDialog>
      {success && (
        <p role="status" className="notice">
          <span>{success}</span>{" "}
          {createdId && (
            <Link
              to={requestPath(createdId, params, resident, !!pathPropertyId)}
            >
              Open request →
            </Link>
          )}
        </p>
      )}
      <section
        className="panel directory-panel"
        aria-label="Maintenance directory"
      >
        <div className="section-heading">
          <h2>Requests</h2>
          <span className="section-caption">
            Open, in progress and completed work
          </span>
        </div>
        {search !== query.trim() && <p role="status" className="help">Updating search…</p>}
        <div className="directory-toolbar">
          <label className="directory-search">
            Find request
            <input
              type="search"
              maxLength={200}
              placeholder="Issue, property or unit"
              value={query}
              onChange={(e) => change("q", e.target.value)}
            />
          </label>
          <label>
            Filter status
            <select
              value={status}
              onChange={(e) => change("status", e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="unresolved">Open &amp; in progress</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </label>
          {!resident && <label>Filter assigned work<select aria-label="Filter assigned work" value={workStatus} onChange={e => change("workStatus", e.target.value)}>
            <option value="">All work stages</option><option value="unassigned">Unassigned</option><option value="assigned">Awaiting acceptance</option><option value="accepted">In progress with teammate</option><option value="pending_review">Completion awaiting review</option><option value="complete">Completion approved</option>
          </select></label>}
          <label>
            Filter property
            <select
              value={propertyId}
              onChange={(e) => change("propertyId", e.target.value)}
            >
              {!pathPropertyId && <option value="">All properties</option>}
              {properties.data
                ?.filter((p) => !pathPropertyId || p.id === pathPropertyId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          {!resident&&<><label>Target date<select value={due} onChange={e=>change("due",e.target.value)}><option value="">All target dates</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="upcoming">Upcoming</option><option value="unscheduled">No target date</option></select></label><label>Assignee<input type="search" maxLength={200} placeholder="Name or email; unassigned" value={assignee} onChange={e=>change("assignee",e.target.value)}/></label></>}
          <label>
            Filter priority
            <select
              value={priority}
              onChange={(e) => change("priority", e.target.value)}
            >
              <option value="">All priorities</option>
              {["high", "normal", "low"].map((p) => (
                <option key={p} value={p}>
                  {label(p)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!resident && !properties.data && (
          <Loading error={properties.error} retry={properties.reload} />
        )}
        {r.error && r.data && <Loading error={r.error} retry={r.reload} />}
        {!r.data ? (
          <Loading error={r.error} retry={r.reload} />
        ) : (
          <>
            <p className="directory-results" role="status">
              {r.data.length} matching requests ·{" "}
              {statuses
                .map(
                  (s) =>
                    `${r.data!.filter((r) => r.status === s).length} ${label(s)}`,
                )
                .join(" · ")}
            </p>
            {!r.data.length ? (
              <div className="empty-state">
                <h3>No requests match these filters.</h3>
                <p>
                  {status || propertyId || query || priority || due || assignee
                    ? "Try a different search or filter."
                    : "Requests will appear here as maintenance is recorded."}
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="core-table maintenance-directory">
                  <thead>
                    <tr>
                      <th>Request</th>
                      <th>Property &amp; unit</th>
                      <th>Priority</th>
                      <th>Dates</th>
                      <th>Status</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.data.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <h3>
                            <Link
                              className="table-primary"
                              to={requestPath(
                                row.id,
                                params,
                                resident,
                                !!pathPropertyId,
                              )}
                            >
                              {row.title}
                            </Link>
                          </h3>
                          <span className="cell-detail">
                            {label(row.category || "other")}
                          </span>
                        </td>
                        <td data-label="Property & unit">
                          {row.property.name}
                          <span className="cell-detail">
                            {row.unit?.label ||
                              "Property-wide / unit not recorded"}
                          </span>
                        </td>
                        <td data-label="Priority">
                          <span className={`priority-label ${row.priority}`}>
                            {label(row.priority)}
                          </span>
                        </td>
                        <td data-label="Dates">
                          <span className="cell-detail">
                            Reported {formatActivityDate(row.createdAt)}
                          </span>
                          {row.targetOn && (
                            <span className="cell-detail">
                              Target {formatDate(row.targetOn)}
                            </span>
                          )}
                        </td>
                        <td data-label="Status">
                          <span className={`status-pill ${row.status}`}>
                            {label(row.status)}
                          </span>
                          {!resident&&row.assigneeName&&<span className="cell-detail">Assigned to {row.assigneeName}</span>}
                          {!resident && row.executionStatus && row.executionStatus !== "unassigned" && <span className="cell-detail">{({assigned:"Awaiting acceptance",accepted:"Work accepted",pending_review:"Completion awaiting review",complete:"Completion approved"} as Record<string,string>)[row.executionStatus]}</span>}
                        </td>
                        <td>
                          <Link
                            className="tenant-row-action"
                            to={requestPath(
                              row.id,
                              params,
                              resident,
                              !!pathPropertyId,
                            )}
                          >
                            {resident ? "View request →" : "Manage request →"}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
export function MaintenanceRequestDetail({
  resident = false,
}: {
  resident?: boolean;
}) {
  const { data } = useAuth(),
    { requestId = "" } = useParams();
  return (
    <RequestDetail
      key={`${resident}:${requestId}:${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`}
      id={requestId}
      resident={resident}
    />
  );
}
function RequestDetail({ id, resident }: { id: string; resident: boolean }) {
  const { can } = useAuth();
  const [params] = useSearchParams(),
    [editing, setEditing] = useState(false),
    [success, setSuccess] = useState("");
  const endpoint = `${resident ? "/api/resident" : "/api/company"}/maintenance/${encodeURIComponent(id)}`;
  const r = useResource<Detail>(endpoint, true, true),
    row = r.data;
  // Freeze the opening record: a background refresh must not authorize a stale draft.
  const [draft, setDraft] = useState<Row | null>(null);
  return (
    <>
      <nav className="record-breadcrumb">
        <Link to={directoryPath(params, resident)}>← Back to maintenance</Link>
        {!resident&&params.get("planId")&&<Link to={`/company/preventive/${encodeURIComponent(params.get("planId")!)}`}>Back to schedule →</Link>}
        {!resident&&params.get("vendorId")&&<Link to={`/company/vendors/${encodeURIComponent(params.get("vendorId")!)}`}>Back to vendor →</Link>}
      </nav>
      {r.error && row && <Loading error={r.error} retry={r.reload} />}
      {!row ? (
        <Loading error={r.error} retry={r.reload} />
      ) : (
        <>
          <header className="page-heading page-heading-row">
            <div>
              <p className="record-kicker">Maintenance request</p>
              <h1>{row.title}</h1>
              <p>
                {row.property.name} ·{" "}
                {row.unit?.label || "Property-wide / unit not recorded"}
              </p>
            </div>
            <div className="actions">
              <span className={`status-pill ${row.status}`}>
                {label(row.status)}
              </span>
              {!resident && (
                <button
                  onClick={() => {
                    setDraft((previous) => previous || row);
                    setEditing(true);
                  }}
                >
                  Update request
                </button>
              )}
            </div>
          </header>
          {success && (
            <p role="status" className="notice">
              {success}
            </p>
          )}
          <div className="maintenance-detail-layout">
            <section className="panel">
              <h2>Issue details</h2>
              <p className="preserve-lines">{row.description}</p>
              <dl className="details">
                <div>
                  <dt>Category</dt>
                  <dd>{label(row.category)}</dd>
                </div>
                <div>
                  <dt>Priority</dt>
                  <dd>
                    <span className={`priority-label ${row.priority}`}>
                      {label(row.priority)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Reported</dt>
                  <dd>{formatActivityDate(row.createdAt)}</dd>
                </div>
                <div>
                  <dt>Target date</dt>
                  <dd>{formatDate(row.targetOn, "Not set")}</dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>{formatActivityTime(row.updatedAt)}</dd>
                </div>
                {!resident && (
                  <div>
                    <dt>Recorded by</dt>
                    <dd>{row.recordedBy}</dd>
                  </div>
                )}
              </dl>
              {!resident && (
                <div className="actions">
                  <Link
                    to={`/company/properties/${encodeURIComponent(row.propertyId)}`}
                  >
                    Open property →
                  </Link>
                  <Link
                    to={`/company/properties/${encodeURIComponent(row.propertyId)}/leases`}
                  >
                    Property leases →
                  </Link>
                </div>
              )}
            </section>
            <section className="panel maintenance-history">
              <h2>Activity history</h2>
              <p className="help">
                {resident
                  ? "Recorded request and status updates."
                  : "Recorded changes remain available after a request is resolved."}
              </p>
              {row.historyLimited && (
                <p className="notice">
                  Showing the latest 100 events. Earlier events remain in the
                  audit log.
                </p>
              )}
              <ol>
                {row.activity.map((event) => (
                  <li key={event.id}>
                    <strong>
                      {event.action === "maintenance.created"
                        ? "Request recorded"
                        : event.action === "maintenance.status.changed"
                          ? `${label(event.from || "open")} → ${label(event.to || "open")}`
                          : "Request details updated"}
                    </strong>
                    <span className="cell-detail">
                      {formatActivityTime(event.createdAt)}
                      {event.actorName ? ` · ${event.actorName}` : ""}
                    </span>
                    {event.changes && (
                      <details>
                        <summary>View changes</summary>
                        <dl className="activity-changes">
                          {Object.entries(event.changes).map(
                            ([key, change]) => (
                              <div key={key}>
                                <dt>
                                  {(
                                    {
                                      targetOn: "Target date",
                                      unitId: "Unit",
                                    } as Record<string, string>
                                  )[key] || label(key)}
                                </dt>
                                <dd>
                                  {key === "targetOn"
                                    ? `${formatDate(change.from, "Not set")} → ${formatDate(change.to, "Not set")}`
                                    : [
                                          "status",
                                          "priority",
                                          "category",
                                        ].includes(key)
                                      ? `${label(change.from || "Not set")} → ${label(change.to || "Not set")}`
                                      : `${change.from || "Not set"} → ${change.to || "Not set"}`}
                                </dd>
                              </div>
                            ),
                          )}
                        </dl>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
              {!row.activity.length && <p>No recorded activity available.</p>}
            </section>
          </div>
          <RequestUpdates endpoint={endpoint} resident={resident} canShare={row.residentUpdatesAvailable === true} />
          {!resident && <PreventiveSource requestId={id}/>}
          {!resident && <MaintenanceVendor requestId={id} changed={r.reload} />}
          {!resident && can("finance.manage") && <MaintenanceCosts requestId={id} propertyId={row.propertyId} />}
          {!resident && <WorkOrderPanel id={id} management changed={r.reload} />}
          {!resident && <PrivateDocuments source="maintenance" sourceId={id} />}
          {!resident && draft && (
            <EditorDialog
              open={editing}
              title={`Update request · ${draft.title}`}
              onClose={() => setEditing(false)} onDiscard={() => { setEditing(false); setDraft(null); r.reload(); }}
            >
              <Form
                key={`${draft.id}:${draft.version}`}
                operation="maintenance.status"
                label="Save request changes"
                feedbackText="Maintenance request updated."
                secondaryActions={
                  <DraftReset
                    reset={() => {
                      setDraft(null);
                      setEditing(false);
                      r.reload();
                    }}
                  />
                }
                submit={async (form) => {
                  await api(endpoint, {
                    method: "PATCH",
                    body: {
                      ...Object.fromEntries(form),
                      unitId: form.get("unitId") || null,
                      targetOn: form.get("targetOn") || null,
                      expectedVersion: draft.version,
                    },
                  });
                  setEditing(false);
                  setDraft(null);
                  setSuccess("Request updated.");
                  r.reload();
                }}
              >
                <fieldset className="form-section">
                  <legend>Work status</legend>
                  <div className="form-grid">
                    <label>
                      Status for {draft.title}
                      <select name="status" defaultValue={draft.status}>
                        {statuses.map((s) => (
                          <option key={s} value={s}>
                            {label(s)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <PriorityField value={draft.priority} />
                    <label>
                      Target date (optional)
                      <DateField
                        name="targetOn"
                        aria-label="Target date"
                        defaultValue={draft.targetOn?.slice(0, 10)}
                      />
                    </label>
                  </div>
                </fieldset>
                <fieldset className="form-section">
                  <legend>Request details</legend>
                  <label>
                    Title
                    <input
                      required
                      name="title"
                      maxLength={160}
                      defaultValue={draft.title}
                    />
                  </label>
                  <label>
                    Description
                    <textarea
                      required
                      name="description"
                      aria-label="Description"
                      maxLength={4000}
                      rows={5}
                      defaultValue={draft.description}
                    />
                  </label>
                  <div className="form-grid">
                    <CategoryField value={draft.category} />
                    <UnitPicker
                      key={`${draft.id}:${draft.version}`}
                      propertyId={draft.propertyId}
                      initial={
                        draft.unitId && draft.unit
                          ? { id: draft.unitId, label: draft.unit.label }
                          : null
                      }
                    />
                  </div>
                </fieldset>
                <p className="help">
                  Changes are recorded in the activity history. If another
                  person updates this request, your draft will remain available
                  so you can review it before trying again. Clear the draft to
                  start from the latest saved request.
                </p>
              </Form>
            </EditorDialog>
          )}
        </>
      )}
    </>
  );
}

function RequestUpdates({ endpoint, resident, canShare }: { endpoint: string; resident: boolean; canShare: boolean }) {
  const [cursor, setCursor] = useState(""),
    [adding, setAdding] = useState(false),
    [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID()),
    [success, setSuccess] = useState("");
  const updates = useResource<{
    items: { id: string; content: string; visibility: string; author: string; createdAt: string }[];
    nextCursor: string | null;
  }>(`${endpoint}/updates${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`, true, true);
  return (
    <section className="panel maintenance-updates" aria-label="Request updates">
      <div className="section-heading">
        <h2>{resident ? "Updates from your property team" : "Progress updates"}</h2>
        {!resident && <button onClick={() => { setSuccess(""); setAdding(true); }}>Add update</button>}
      </div>
      <p className="help">{resident ? "Shared updates for this request. For emergencies, contact local emergency services." : "Keep a record of visits, progress and follow-up. Internal notes stay with your management team. Updates do not send email or text messages."}</p>
      {success && <p role="status" className="notice">{success}</p>}
      {updates.error && updates.data && <Loading error={updates.error} retry={updates.reload} />}
      {!updates.data ? <Loading error={updates.error} retry={updates.reload} /> : <>
        {!updates.data.items.length ? <p>{resident ? "No shared updates yet." : "No progress updates recorded yet."}</p> :
          <ol className="maintenance-update-list">
            {updates.data.items.map(update => <li key={update.id}>
              <div className="section-heading">
                <strong>{update.author}</strong>
                {!resident && <span className={`status-pill ${update.visibility === "internal" ? "" : "active"}`}>{update.visibility === "internal" ? "Internal note" : "Resident-visible update"}</span>}
              </div>
              <span className="cell-detail">{formatActivityTime(update.createdAt)}</span>
              <p className="preserve-lines">{update.content}</p>
            </li>)}
          </ol>}
        <div className="actions">
          {cursor && <button className="secondary" onClick={() => setCursor("")}>Latest updates</button>}
          {updates.data.nextCursor && <button className="secondary" onClick={() => setCursor(updates.data!.nextCursor!)}>Older updates</button>}
        </div>
      </>}
      {!resident && <EditorDialog open={adding} title="Add maintenance update" onClose={() => setAdding(false)} onDiscard={() => { setAdding(false); setSubmissionKey(crypto.randomUUID()); }}>
        <Form key={submissionKey} operation="maintenance.update" label="Record update" feedbackText="Maintenance update recorded."
          secondaryActions={<DraftReset reset={() => setSubmissionKey(crypto.randomUUID())} />}
          submit={async form => {
            await api(`${endpoint}/updates`, { method: "POST", body: { content: form.get("content"), visibility: form.get("visibility"), submissionKey } });
            setAdding(false);
            setSubmissionKey(crypto.randomUUID());
            setSuccess("Update recorded.");
            setCursor("");
            updates.reload();
          }}>
          <fieldset className="form-section">
            <legend>Update and audience</legend>
            <label>Who can see this update?
              <select name="visibility" aria-label="Update audience" defaultValue="internal">
                <option value="internal">Management team only</option>
                {canShare && <option value="resident">Resident requester and management team</option>}
              </select>
            </label>
            <p className="help">{canShare ? "Shared updates are visible only to the resident who submitted this request, while they retain property access. They do not notify the resident." : "This management-created request has no resident requester. Its updates stay internal."}</p>
            <label>Update (required)<textarea name="content" aria-label="Update text" required maxLength={4000} rows={6} /></label>
          </fieldset>
          <p className="help">Review the audience before saving. Recorded updates and their audience are retained; add a follow-up to correct an earlier update.</p>
        </Form>
      </EditorDialog>}
    </section>
  );
}
