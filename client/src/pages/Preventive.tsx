import { calendarBack } from "../calendar-context";
import { useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import { formatDate, formatActivityDate } from "../dates";
import { useResource } from "../useResource";
import { useDebouncedValue } from "../useDebouncedValue";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "../components/Form";
import { DateField } from "../components/DateField";
import { UnitPicker } from "./Maintenance";

type Plan = {
  id: string;
  propertyId: string;
  unitId: string | null;
  title: string;
  description: string;
  category: string;
  priority: string;
  cadence: string;
  anchorOn: string;
  endOn: string | null;
  nextOn: string | null;
  timezone: string;
  status: string;
  version: number;
  today: string;
  property: { name: string };
  unit: { label: string } | null;
};
type Results<T> = { items: T[]; total: number; pageSize: number };
const base = "/api/company/preventive";
const labels: Record<string, string> = {
  weekly: "Every week",
  monthly: "Every month",
  quarterly: "Every 3 months",
  yearly: "Every year",
  hvac: "Heating & cooling",
};
const label = (value: string) =>
  labels[value] || value.slice(0, 1).toUpperCase() + value.slice(1);
function ErrorState({ error, retry }: { error?: string; retry: () => void }) {
  return error ? (
    <p role="alert">
      {error}{" "}
      <button className="secondary" onClick={retry}>
        Try again
      </button>
    </p>
  ) : (
    <p role="status">Loading schedules…</p>
  );
}
function Pager({
  page,
  total,
  pageSize,
  change,
  name,
}: {
  page: number;
  total: number;
  pageSize: number;
  change: (p: number) => void;
  name: string;
}) {
  return (
    <div className="actions">
      <button
        className="secondary"
        disabled={page === 1}
        onClick={() => change(page - 1)}
      >
        Previous {name}
      </button>
      <span>
        Page {page} · {total} total
      </span>
      <button
        className="secondary"
        disabled={page * pageSize >= total}
        onClick={() => change(page + 1)}
      >
        Next {name}
      </button>
    </div>
  );
}
function Fields({
  row,
  properties,
}: {
  row?: Plan;
  properties: { id: string; name: string }[];
}) {
  const [property, setProperty] = useState("");
  return (
    <>
      {!row && (
        <fieldset className="form-section">
          <legend>Location</legend>
          <label>
            Property
            <select
              aria-label="Property"
              name="propertyId"
              required
              value={property}
              onChange={(e) => setProperty(e.target.value)}
            >
              <option value="">Choose a property</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {property && <UnitPicker key={property} propertyId={property} />}
        </fieldset>
      )}
      <fieldset className="form-section">
        <legend>Work instructions</legend>
        <label>
          Title
          <input
            name="title"
            required
            maxLength={160}
            defaultValue={row?.title}
          />
        </label>
        <label>
          Instructions
          <textarea
            name="description"
            aria-label="Instructions"
            required
            maxLength={4000}
            rows={4}
            defaultValue={row?.description}
          />
        </label>
        <div className="form-grid">
          <label>
            Category
            <select
              aria-label="Category"
              name="category"
              defaultValue={row?.category || "other"}
            >
              {[
                "plumbing",
                "electrical",
                "hvac",
                "appliance",
                "structural",
                "safety",
                "other",
              ].map((v) => (
                <option key={v} value={v}>
                  {label(v)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              aria-label="Priority"
              name="priority"
              defaultValue={row?.priority || "normal"}
            >
              {["low", "normal", "high"].map((v) => (
                <option key={v} value={v}>
                  {label(v)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>
      {!row ? (
        <fieldset className="form-section">
          <legend>Repeat schedule</legend>
          <label>
            Repeat
            <select aria-label="Repeat" name="cadence" defaultValue="monthly">
              {Object.keys(labels)
                .filter((v) => v !== "hvac")
                .map((v) => (
                  <option key={v} value={v}>
                    {label(v)}
                  </option>
                ))}
            </select>
          </label>
          <div className="form-grid">
            <label>
              First due date
              <DateField name="anchorOn" aria-label="First due date" required />
            </label>
            <label>
              Last due date (optional)
              <DateField name="endOn" aria-label="Last due date (optional)" />
            </label>
          </div>
          <p className="help">
            Uses your company timezone at creation. Monthly dates keep the
            original day, using the last day of shorter months. You review and
            create each request; saving a schedule does not create work
            automatically.
          </p>
        </fieldset>
      ) : (
        <>
          <label>
            Schedule status
            <select
              aria-label="Schedule status"
              name="status"
              defaultValue={row.status}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </label>
          <p className="help">
            Changes apply to future requests. Existing work and recorded
            occurrences stay as recorded. Pausing keeps the next due date;
            resuming does not skip missed work. To change the location or repeat
            dates, pause this schedule and create a replacement.
          </p>
        </>
      )}
    </>
  );
}
function PlanEditor({
  open,
  close,
  discard,
  row,
  properties,
  saved,
  submissionKey,
  timezone,
}: {
  open: boolean;
  close: () => void;
  discard: () => void;
  row?: Plan;
  properties: { id: string; name: string }[];
  saved: (id: string) => void;
  submissionKey: string;
  timezone?: string;
}) {
  return (
    <EditorDialog
      open={open}
      title={row ? "Edit maintenance schedule" : "Add maintenance schedule"}
      onClose={close}
      onDiscard={discard}
    >
      <Form
        key={submissionKey}
        label={row ? "Save schedule changes" : "Create schedule"}
        operation="preventive.save"
        feedbackText="Schedule saved."
        submit={async (f) => {
          const body: Record<string, unknown> = {
            ...Object.fromEntries(
              ["title", "description", "category", "priority"].map((k) => [
                k,
                f.get(k),
              ]),
            ),
            submissionKey,
          };
          if (row)
            Object.assign(body, {
              status: f.get("status"),
              expectedVersion: row.version,
            });
          else
            Object.assign(body, {
              propertyId: f.get("propertyId"),
              unitId: f.get("unitId") || null,
              cadence: f.get("cadence"),
              anchorOn: f.get("anchorOn"),
              timezone,
              endOn: f.get("endOn") || null,
            });
          const result = await api<{ planId: string }>(
            row ? `${base}/${encodeURIComponent(row.id)}` : base,
            { method: row ? "PATCH" : "POST", body },
          );
          saved(result.planId);
        }}
      >
        {!row && (
          <p>
            Schedule timezone: <strong>{timezone}</strong>
          </p>
        )}
        <Fields row={row} properties={properties} />
      </Form>
    </EditorDialog>
  );
}
export function Preventive() {
  const { data } = useAuth(),
    { planId } = useParams();
  return (
    <PreventivePage
      key={`${planId || "directory"}:${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}`}
      id={planId}
    />
  );
}
function PreventivePage({ id }: { id?: string }) {
  return id ? <PlanDetail id={id} /> : <Directory />;
}
function Directory() {
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate(),
    [open, setOpen] = useState(false),
    [draft, setDraft] = useState<{ key: string; timezone: string } | null>(
      null,
    ),
    q = useDebouncedValue(params.get("q") || "");
  const filters = new URLSearchParams();
  for (const key of ["status", "due", "propertyId", "page"])
    if (params.get(key)) filters.set(key, params.get(key)!);
  if (q.trim()) filters.set("q", q.trim());
  const r = useResource<Results<Plan> & { timezone: string }>(
      `${base}?${filters}`,
      true,
      true,
    ),
    properties = useResource<{ id: string; name: string }[]>(
      "/api/company/properties",
      true,
      true,
    ),
    page = Number(params.get("page") || 1);
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  return (
    <>
      <nav className="record-breadcrumb">
        <Link to="/company/maintenance">← Maintenance</Link>
        <Link to="/company/work-calendar">Work calendar →</Link>
      </nav>
      <header className="page-heading page-heading-row">
        <div>
          <h1>Preventive maintenance</h1>
          <p>
            Plan recurring work, review due dates, and create each maintenance
            request when ready.
          </p>
        </div>
        <button
          disabled={!properties.data?.length || !r.data?.timezone}
          onClick={() => {
            setDraft(
              (previous) =>
                previous || {
                  key: crypto.randomUUID(),
                  timezone: r.data!.timezone,
                },
            );
            setOpen(true);
          }}
        >
          Add schedule
        </button>
      </header>
      {properties.error && (
        <ErrorState error={properties.error} retry={properties.reload} />
      )}{" "}
      {properties.data?.length === 0 && (
        <p className="notice">
          Add a property before scheduling work.{" "}
          <Link to="/company/properties">Open properties →</Link>
        </p>
      )}
      <div className="filters">
        <label>
          Search schedules
          <input
            type="search"
            maxLength={200}
            value={params.get("q") || ""}
            onChange={(e) => change("q", e.target.value)}
            placeholder="Title or property"
          />
        </label>
        <label>
          Schedule status
          <select
            value={params.get("status") || "active"}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="all">All statuses</option>
          </select>
        </label>
        <label>
          Next occurrence
          <select
            value={params.get("due") || "all"}
            onChange={(e) => change("due", e.target.value)}
          >
            <option value="all">All dates</option>
            <option value="due">Due now</option>
            <option value="overdue">Overdue</option>
            <option value="upcoming">Upcoming</option>
            <option value="finished">Schedule finished</option>
          </select>
        </label>
        <label>
          Filter property
          <select
            value={params.get("propertyId") || ""}
            onChange={(e) => change("propertyId", e.target.value)}
          >
            <option value="">All properties</option>
            {properties.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {r.error && r.data && <ErrorState error={r.error} retry={r.reload} />}
      {!r.data ? (
        <ErrorState error={r.error} retry={r.reload} />
      ) : (
        <section className="panel">
          <p>
            {r.data.total} matching{" "}
            {r.data.total === 1 ? "schedule" : "schedules"}
          </p>
          {!r.data.items.length && <p>No schedules match these filters.</p>}
          <div className="table-wrap">
            <table className="core-table">
              <thead>
                <tr>
                  <th>Work</th>
                  <th>Location</th>
                  <th>Next due</th>
                  <th>Repeat</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {r.data.items.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Work">
                      <Link
                        to={`/company/preventive/${encodeURIComponent(row.id)}?${params}`}
                      >
                        {row.title}
                      </Link>
                    </td>
                    <td data-label="Location">
                      {row.property.name}
                      <span className="cell-detail">
                        {row.unit?.label || "Whole property"}
                      </span>
                    </td>
                    <td data-label="Next due">
                      {row.nextOn ? formatDate(row.nextOn) : "Finished"}
                      <span className="cell-detail">
                        {row.timezone}
                        {row.nextOn && row.nextOn.slice(0, 10) < row.today
                          ? " · Overdue"
                          : ""}
                      </span>
                    </td>
                    <td data-label="Repeat">{label(row.cadence)}</td>
                    <td data-label="Status">{label(row.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={page}
            total={r.data.total}
            pageSize={r.data.pageSize}
            name="schedules"
            change={(p) => {
              const next = new URLSearchParams(params);
              next.set("page", String(p));
              setParams(next);
            }}
          />
        </section>
      )}
      {draft && (
        <PlanEditor
          open={open}
          close={() => setOpen(false)}
          discard={() => {
            setOpen(false);
            setDraft(null);
          }}
          properties={properties.data || []}
          submissionKey={draft.key}
          timezone={draft.timezone}
          saved={(id) => {
            setOpen(false);
            setDraft(null);
            navigate(`/company/preventive/${encodeURIComponent(id)}?${params}`);
          }}
        />
      )}
    </>
  );
}
type Occurrence = {
  id: string;
  dueOn: string;
  outcome: string;
  reason: string | null;
  requestId: string | null;
  request: { title: string; status: string } | null;
};
type Action = {
  id: string;
  action: string;
  createdAt: string;
  actor: { name: string | null };
  requestId: string | null;
  snapshot: {
    dueOn?: string;
    reason?: string;
    nextOn?: string;
    title?: string;
    description?: string;
    cadence?: string;
    timezone?: string;
    anchorOn?: string;
    endOn?: string;
    before?: Record<string, string>;
    beforeStatus?: string;
    after?: Record<string, string>;
  };
};
function Records({ id }: { id: string }) {
  const [page, setPage] = useState(1),
    [historyPage, setHistoryPage] = useState(1),
    r = useResource<Results<Occurrence>>(
      `${base}/${encodeURIComponent(id)}/occurrences?page=${page}`,
    ),
    history = useResource<Results<Action>>(
      `${base}/${encodeURIComponent(id)}/history?page=${historyPage}`,
    );
  return (
    <>
      <section className="panel">
        <h2>Recorded occurrences</h2>
        <p>
          Generated work keeps its original due date. Open a request to assign,
          complete, or review it.
        </p>
        {!r.data ? (
          <ErrorState error={r.error} retry={r.reload} />
        ) : (
          <>
            {!r.data.total && <p>No occurrences recorded yet.</p>}
            <ul>
              {r.data.items.map((row) => (
                <li key={row.id}>
                  <strong>{formatDate(row.dueOn)}</strong> ·{" "}
                  {row.requestId ? (
                    <>
                      <Link
                        to={`/company/maintenance/${encodeURIComponent(row.requestId)}?planId=${encodeURIComponent(id)}`}
                      >
                        {row.request?.title || "Open maintenance request"}
                      </Link>{" "}
                      · {label(row.request?.status || "open")}
                    </>
                  ) : (
                    <>Skipped: {row.reason}</>
                  )}
                </li>
              ))}
            </ul>
            <Pager
              page={page}
              total={r.data.total}
              pageSize={r.data.pageSize}
              name="occurrences"
              change={setPage}
            />
          </>
        )}
      </section>
      <section className="panel">
        <details>
          <summary>Schedule history</summary>
          {!history.data ? (
            <ErrorState error={history.error} retry={history.reload} />
          ) : (
            <>
              <ol>
                {history.data.items.map((event) => (
                  <li key={event.id}>
                    <strong>
                      {
                        (
                          {
                            create: "Schedule added",
                            edit: "Schedule edited",
                            generate: "Request created",
                            skip: "Occurrence skipped",
                          } as Record<string, string>
                        )[event.action]
                      }
                    </strong>{" "}
                    · {event.actor.name || "Recorded teammate"} ·{" "}
                    {formatActivityDate(event.createdAt)}
                    {event.snapshot.dueOn && (
                      <p>
                        Due {formatDate(event.snapshot.dueOn)} ·{" "}
                        {event.snapshot.reason || "Maintenance request created"}
                      </p>
                    )}
                    {event.snapshot.nextOn && (
                      <p>Next due {formatDate(event.snapshot.nextOn)}</p>
                    )}
                    {event.snapshot.after && (
                      <dl>
                        {Object.entries(event.snapshot.after).map(
                          ([key, value]) => (
                            <div key={key}>
                              <dt>{label(key)}</dt>
                              <dd>
                                {event.snapshot.before?.[key] ||
                                  (key === "status"
                                    ? event.snapshot.beforeStatus
                                    : undefined)}{" "}
                                → {value}
                              </dd>
                            </div>
                          ),
                        )}
                      </dl>
                    )}
                    {event.action === "create" && (
                      <p>
                        {event.snapshot.title} ·{" "}
                        {label(event.snapshot.cadence || "")} ·{" "}
                        {formatDate(event.snapshot.anchorOn || "")} ·{" "}
                        {event.snapshot.timezone}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
              <Pager
                page={historyPage}
                total={history.data.total}
                pageSize={history.data.pageSize}
                name="history entries"
                change={setHistoryPage}
              />
            </>
          )}
        </details>
      </section>
    </>
  );
}
function PlanDetail({ id }: { id: string }) {
  const [params] = useSearchParams(),
    r = useResource<Plan>(`${base}/${encodeURIComponent(id)}`, true, true),
    [open, setOpen] = useState(false),
    [draft, setDraft] = useState<{ row: Plan; key: string } | null>(null),
    [action, setAction] = useState<{
      row: Plan;
      outcome: string;
      key: string;
    } | null>(null),
    [actionDrafts, setActionDrafts] = useState<
      Record<string, { row: Plan; outcome: string; key: string }>
    >({}),
    [actionOpen, setActionOpen] = useState(false),
    [created, setCreated] = useState("");
  const refresh = () => {
    setOpen(false);
    setDraft(null);
    setActionOpen(false);
    if (action)
      setActionDrafts((v) => {
        const next = { ...v };
        delete next[action.outcome];
        return next;
      });
    setAction(null);
    r.reload();
  };
  return (
    <>
      <nav className="record-breadcrumb">
        {calendarBack(params)&&<Link to={calendarBack(params)!}>Back to work calendar →</Link>}
        <Link to={`/company/preventive?${params}`}>← Back to schedules</Link>
        <Link to="/company/maintenance">Maintenance requests →</Link>
      </nav>
      {!r.data ? (
        <ErrorState error={r.error} retry={r.reload} />
      ) : (
        <>
          {r.error && <ErrorState error={r.error} retry={r.reload} />}
          <header className="page-heading page-heading-row">
            <div>
              <p className="record-kicker">Maintenance schedule</p>
              <h1>{r.data.title}</h1>
              <p>
                <Link
                  to={`/company/properties/${encodeURIComponent(r.data.propertyId)}`}
                >
                  {r.data.property.name}
                </Link>{" "}
                · {r.data.unit?.label || "Whole property"}
              </p>
            </div>
            <button
              className="secondary"
              onClick={() => {
                setDraft(
                  (v) => v || { row: r.data!, key: crypto.randomUUID() },
                );
                setOpen(true);
              }}
            >
              Edit schedule
            </button>
          </header>
          {created && (
            <p className="notice" role="status">
              Request created.{" "}
              <Link
                to={`/company/maintenance/${encodeURIComponent(created)}?planId=${encodeURIComponent(id)}`}
              >
                Open request to assign work →
              </Link>
            </p>
          )}
          <section className="panel">
            <h2>Next occurrence</h2>
            <p>
              <strong>
                {r.data.nextOn
                  ? formatDate(r.data.nextOn)
                  : "Schedule finished"}
              </strong>
              {r.data.nextOn && r.data.nextOn.slice(0, 10) < r.data.today
                ? " · Overdue"
                : ""}{" "}
              · {label(r.data.status)}
            </p>
            <p>
              {label(r.data.cadence)} · {r.data.timezone} · First due{" "}
              {formatDate(r.data.anchorOn)}
              {r.data.endOn ? ` · Last due ${formatDate(r.data.endOn)}` : ""}
            </p>
            <p className="help">
              Create or skip one occurrence at a time. Missed dates remain due
              until reviewed. Creating a request advances this schedule;
              completion is reviewed on that request.
            </p>
            {r.data.status === "paused" && (
              <p className="notice">
                Paused. Edit this schedule to resume at the retained due date.
              </p>
            )}
            {r.data.nextOn && r.data.status === "active" && (
              <div className="actions">
                {[
                  ["generated", "Create next request"],
                  ["skipped", "Skip occurrence"],
                ].map(([outcome, text]) => (
                  <button
                    key={outcome}
                    className={outcome === "skipped" ? "secondary" : ""}
                    onClick={() => {
                      const chosen = actionDrafts[outcome] || {
                        row: r.data!,
                        outcome,
                        key: crypto.randomUUID(),
                      };
                      setActionDrafts((v) => ({ ...v, [outcome]: chosen }));
                      setAction(chosen);
                      setActionOpen(true);
                    }}
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className="panel">
            <h2>Work instructions</h2>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {r.data.description}
            </p>
            <p>
              {label(r.data.category)} · {label(r.data.priority)} priority
            </p>
          </section>
          <Records key={r.data.version} id={id} />
          {draft && (
            <PlanEditor
              open={open}
              close={() => setOpen(false)}
              discard={() => {
                setOpen(false);
                setDraft(null);
              }}
              row={draft.row}
              properties={[]}
              submissionKey={draft.key}
              saved={refresh}
            />
          )}
          {Object.values(actionDrafts).map((review) => (
            <EditorDialog
              key={review.key}
              open={actionOpen && action?.outcome === review.outcome}
              title={
                review.outcome === "generated"
                  ? "Review next request"
                  : "Skip scheduled occurrence"
              }
              onClose={() => setActionOpen(false)}
              onDiscard={() => {
                setActionOpen(false);
                setActionDrafts((v) => {
                  const next = { ...v };
                  delete next[review.outcome];
                  return next;
                });
                setAction(null);
              }}
            >
              <Form
                key={review.key}
                label={
                  review.outcome === "generated"
                    ? "Create maintenance request"
                    : "Confirm skip"
                }
                operation="preventive.occurrence"
                feedbackText={
                  review.outcome === "generated"
                    ? "Maintenance request created."
                    : "Occurrence skipped."
                }
                submit={async (f) => {
                  const result = await api<{ requestId: string | null }>(
                    `${base}/${encodeURIComponent(id)}/occurrences`,
                    {
                      method: "POST",
                      body: {
                        outcome: review.outcome,
                        dueOn: review.row.nextOn!.slice(0, 10),
                        expectedVersion: review.row.version,
                        reason: f.get("reason") || null,
                        submissionKey: review.key,
                      },
                    },
                  );
                  setCreated(result.requestId || "");
                  refresh();
                }}
              >
                <p>
                  <strong>{review.row.title}</strong> ·{" "}
                  {review.row.property.name} ·{" "}
                  {review.row.unit?.label || "Whole property"}
                </p>
                <p>
                  Due {formatDate(review.row.nextOn)} · {review.row.timezone}
                </p>
                <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {review.row.description}
                </p>
                {review.outcome === "skipped" ? (
                  <label>
                    Reason for skipping
                    <textarea
                      name="reason"
                      required
                      maxLength={1000}
                      rows={3}
                    />
                  </label>
                ) : (
                  <p>
                    The request will use these instructions, category, priority,
                    location and due date. Assign a teammate or vendor from the
                    created request.
                  </p>
                )}
              </Form>
            </EditorDialog>
          ))}
        </>
      )}
    </>
  );
}
