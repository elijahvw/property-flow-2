import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useResource } from "../useResource";
import { formatDate } from "../dates";
import { Form } from "./Form";
import { EditorDialog } from "./EditorDialog";
import { DateField } from "./DateField";
import "./LeaseInspections.css";

type Item = {
  key: string;
  area: string;
  item: string;
  condition: string;
  notes: string;
  evidenceVersionIds: string[];
};
type Snapshot = {
  kind: string;
  inspectedOn: string;
  status: string;
  items: Item[];
  baselineRevisionId: string | null;
};
type Inspection = Snapshot & { id: string; version: number };
type Revision = {
  id: string;
  version: number;
  action: string;
  reason: string | null;
  createdAt: string;
  actorName: string;
  snapshot: Snapshot;
};
type Original = {
  id: string;
  documentId: string;
  number: number;
  filename: string;
  scanStatus: string;
  document: { title: string; archivedAt: string | null };
};
type Baseline = {
  id: string;
  inspectionId: string;
  version: number;
  inspectedOn: string;
};
type Directory = {
  items: Omit<Inspection, "items" | "baselineRevisionId">[];
  baselines: Baseline[];
};
type Detail = {
  inspection: Inspection;
  baseline: { id: string; version: number; snapshot: Snapshot } | null;
  comparison: { itemKey: string; before: Item | null; after: Item }[];
  baselineOnly: Item[];
  originals: Original[];
  revisions: Revision[];
  nextBeforeVersion: number | null;
};
type Documents = {
  items: {
    id: string;
    title: string;
    archivedAt: string | null;
    versions: {
      id: string;
      number: number;
      filename: string;
      scanStatus: string;
    }[];
  }[];
};
const conditions: Record<string, string> = {
  not_checked: "Not checked",
  good: "Good",
  fair: "Fair",
  damaged: "Damaged",
  not_applicable: "Not applicable",
};
const states: Record<string, string> = {
  in_progress: "In progress",
  awaiting_review: "Awaiting review",
  completed: "Completed",
};
const kindName = (kind: string) =>
  kind === "move_in" ? "Move-in" : "Move-out";
const blank = (): Item => ({
  key: crypto.randomUUID(),
  area: "",
  item: "",
  condition: "not_checked",
  notes: "",
  evidenceVersionIds: [],
});
function documentLink(params: URLSearchParams, documentId?: string) {
  const next = new URLSearchParams(params);
  next.set("section", "documents");
  if (documentId) next.set("documentId", documentId);
  return `?${next}`;
}
function Evidence({
  ids,
  originals,
}: {
  ids: string[];
  originals: Original[];
}) {
  const [params] = useSearchParams();
  if (!ids.length) return <span className="help">No evidence linked</span>;
  return (
    <ul className="inspection-evidence">
      {ids.map((id) => {
        const file = originals.find((o) => o.id === id);
        return (
          <li key={id}>
            {file ? (
              <Link
                target="_blank"
                rel="noreferrer"
                to={documentLink(params, file.documentId)}
              >
                {file.document.title} · version {file.number} · {file.filename}
                {file.document.archivedAt ? " (archived)" : ""}
              </Link>
            ) : (
              "Retained original unavailable"
            )}
          </li>
        );
      })}
    </ul>
  );
}
function Observations({
  items,
  originals,
}: {
  items: Item[];
  originals: Original[];
}) {
  return (
    <ul className="inspection-items">
      {items.map((item) => (
        <li key={item.key}>
          <h4>
            {item.area} · {item.item}
          </h4>
          <p>
            <strong>{conditions[item.condition]}</strong>
          </p>
          {item.notes && <p className="inspection-notes">{item.notes}</p>}
          <Evidence ids={item.evidenceVersionIds} originals={originals} />
        </li>
      ))}
    </ul>
  );
}

export function InspectionSettlementContext({
  leaseId,
  inspectionId,
}: {
  leaseId: string;
  inspectionId: string;
}) {
  const [params] = useSearchParams(),
    r = useResource<Detail>(
      `/api/company/leases/${encodeURIComponent(leaseId)}/inspections/${encodeURIComponent(inspectionId)}`,
      false,
      true,
    );
  const next = new URLSearchParams(params);
  next.set("section", "inspections");
  return (
    <section className="notice">
      <h3>Inspection follow-up</h3>
      {r.data ? (
        <>
          <p>
            {kindName(r.data.inspection.kind)} ·{" "}
            {formatDate(r.data.inspection.inspectedOn)} ·{" "}
            {states[r.data.inspection.status]} · version{" "}
            {r.data.inspection.version}
          </p>
          <p>
            {r.data.inspection.status === "completed"
              ? "Review the retained observations and original evidence when preparing settlement items."
              : "This inspection is awaiting completion or further work. Review its current condition report before preparing settlement items."}
          </p>
        </>
      ) : (
        <p>{r.error || "Loading inspection context…"}</p>
      )}
      <Link to={`?${next}`}>Return to the source inspection →</Link>
      <p className="help">
        An inspection does not create charges or apply a deposit. Each financial
        action needs its own review.
      </p>
    </section>
  );
}

export function LeaseInspections({ leaseId }: { leaseId: string }) {
  const endpoint = `/api/company/leases/${encodeURIComponent(leaseId)}/inspections`;
  const r = useResource<Directory>(endpoint, true, true),
    [params, setParams] = useSearchParams();
  const selected = params.get("inspectionId");
  const [editor, setEditor] = useState<{
      row: Inspection | null;
      key: string;
    } | null>(null),
    [open, setOpen] = useState(false);
  const [itemChanges, setItemChanges] = useState(0);
  const [accessDenied, setAccessDenied] = useState(false);
  const denied = () => {
    setEditor(null);
    setOpen(false);
    setAccessDenied(true);
  };
  const choose = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("section", "inspections");
    next.set("inspectionId", id);
    setParams(next);
  };
  if (accessDenied)
    return (
      <p role="alert" className="notice error">
        Inspection access is unavailable.{" "}
        <button type="button" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </p>
    );
  return (
    <section className="panel inspection-workspace">
      <div className="section-heading">
        <div>
          <h2>Move-in &amp; move-out inspections</h2>
          <p>
            Record condition, retain original evidence, then review the
            completed report.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!editor) setEditor({ row: null, key: crypto.randomUUID() });
            setOpen(true);
          }}
        >
          {editor ? "Resume inspection draft" : "Record inspection"}
        </button>
      </div>
      {r.error && (
        <p className="notice error" role="alert">
          {r.error}{" "}
          <button className="text-button" onClick={r.reload}>
            Retry inspections
          </button>
        </p>
      )}
      {!r.data ? (
        <p role="status">Loading inspections…</p>
      ) : (
        <>
          {!r.data.items.length ? (
            <p>
              No inspections recorded for this lease. Start with the actual
              condition observed at move-in or move-out.
            </p>
          ) : (
            <nav
              aria-label="Lease inspections"
              className="inspection-directory"
            >
              {r.data.items.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={selected === row.id ? "" : "secondary"}
                  aria-current={selected === row.id ? "page" : undefined}
                  onClick={() => choose(row.id)}
                >
                  {kindName(row.kind)} · {formatDate(row.inspectedOn)}{" "}
                  <span>{states[row.status]}</span>
                </button>
              ))}
            </nav>
          )}
          {selected && (
            <InspectionDetail
              key={selected}
              id={selected}
              endpoint={endpoint}
              edit={(row) => {
                if (!editor)
                  setEditor({
                    row: structuredClone(row),
                    key: crypto.randomUUID(),
                  });
                setOpen(true);
              }}
              changed={r.reload}
              denied={denied}
            />
          )}
          <EditorDialog
            open={open}
            hasChanges={itemChanges > 0}
            changeVersion={itemChanges}
            title={
              editor?.row ? "Edit inspection observations" : "Record inspection"
            }
            onClose={() => setOpen(false)}
            onDiscard={() => {
              setOpen(false);
              setEditor(null);
              setItemChanges(0);
            }}
          >
            {editor && (
              <InspectionEditor
                key={editor.key}
                draft={editor}
                endpoint={endpoint}
                baselines={r.data.baselines}
                itemsChanged={() => setItemChanges((value) => value + 1)}
                denied={denied}
                saved={(id) => {
                  setOpen(false);
                  setEditor(null);
                  setItemChanges(0);
                  choose(id);
                  r.reload();
                }}
              />
            )}
          </EditorDialog>
        </>
      )}
    </section>
  );
}
function InspectionDetail({
  id,
  endpoint,
  edit,
  changed,
  denied,
}: {
  id: string;
  endpoint: string;
  edit: (row: Inspection) => void;
  changed: () => void;
  denied: () => void;
}) {
  const [before, setBefore] = useState<number | null>(null),
    [action, setAction] = useState<{
      name: string;
      row: Inspection;
      key: string;
    } | null>(null),
    [open, setOpen] = useState(false);
  const [params] = useSearchParams(),
    r = useResource<Detail>(
      `${endpoint}/${encodeURIComponent(id)}${before ? `?beforeVersion=${before}` : ""}`,
      true,
      true,
    );
  if (!r.data)
    return (
      <div>
        {r.error && (
          <p role="alert" className="notice error">
            {r.error}
          </p>
        )}
        {r.error ? (
          <button className="secondary" onClick={r.reload}>
            Reload inspection
          </button>
        ) : (
          <p role="status">Loading inspection…</p>
        )}
      </div>
    );
  const d = r.data,
    row = d.inspection;
  const review = (name: string) => {
    if (!action)
      setAction({ name, row: structuredClone(row), key: crypto.randomUUID() });
    setOpen(true);
  };
  const settle = new URLSearchParams(params);
  settle.set("section", "settlement");
  return (
    <article className="inspection-report">
      {r.error && (
        <p className="notice error" role="alert">
          {r.error} <button onClick={r.reload}>Retry report</button>
        </p>
      )}
      <header>
        <p className="record-kicker">
          {kindName(row.kind)} inspection · version {row.version}
        </p>
        <h3>{formatDate(row.inspectedOn)}</h3>
        <p>
          <strong>{states[row.status]}</strong>
        </p>
      </header>
      <div className="actions">
        {row.status === "in_progress" && (
          <>
            <button type="button" onClick={() => edit(row)}>
              Edit observations
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => review("submit")}
            >
              Submit for review
            </button>
          </>
        )}
        {row.status === "awaiting_review" && (
          <button type="button" onClick={() => review("complete")}>
            Review completion
          </button>
        )}
        {row.status !== "in_progress" && (
          <button
            type="button"
            className="secondary"
            onClick={() => review("reopen")}
          >
            Reopen inspection
          </button>
        )}
        {action && (
          <button className="secondary" onClick={() => setOpen(true)}>
            Resume inspection review
          </button>
        )}
        <Link to={documentLink(params)}>Upload evidence in Documents →</Link>
      </div>
      <Observations items={row.items} originals={d.originals} />
      {row.kind === "move_out" && (
        <section className="inspection-comparison">
          <h3>Move-in comparison</h3>
          {d.baseline ? (
            <>
              <p>
                Compared with the retained, reviewed move-in report from{" "}
                {formatDate(d.baseline.snapshot.inspectedOn)}, version{" "}
                {d.baseline.version}.
              </p>
              <ul className="inspection-items">
                {d.comparison.map((c) => (
                  <li key={c.itemKey}>
                    <h4>
                      {c.after.area} · {c.after.item}
                    </h4>
                    <p>
                      {c.before
                        ? `${conditions[c.before.condition]} at move-in → ${conditions[c.after.condition]} at move-out`
                        : "No matching item in the selected move-in report"}
                    </p>
                    {c.before && (
                      <details>
                        <summary>Original move-in observation</summary>
                        {c.before.notes && (
                          <p className="inspection-notes">{c.before.notes}</p>
                        )}
                        <Evidence
                          ids={c.before.evidenceVersionIds}
                          originals={d.originals}
                        />
                      </details>
                    )}
                  </li>
                ))}
              </ul>
              {d.baselineOnly.length > 0 && (
                <details>
                  <summary>
                    {d.baselineOnly.length} move-in items without a matching
                    move-out observation
                  </summary>
                  <Observations
                    items={d.baselineOnly}
                    originals={d.originals}
                  />
                </details>
              )}
            </>
          ) : (
            <p>
              No reviewed move-in report selected. Condition comparison is
              unavailable.
            </p>
          )}
          <p className="help">
            Observed changes do not establish responsibility or create a charge.
          </p>
          {row.status === "completed" && (
            <Link to={`?${settle}`}>Review move-out settlement →</Link>
          )}
        </section>
      )}
      <section>
        <h3>Retained inspection history</h3>
        <p className="help">
          Each save and review retains its observations and exact evidence
          versions.
        </p>
        {d.revisions.map((rev) => (
          <details key={rev.id}>
            <summary>
              Version {rev.version} · {rev.action} · {formatDate(rev.createdAt)}{" "}
              · {rev.actorName}
            </summary>
            {rev.reason && <p className="inspection-notes">{rev.reason}</p>}
            <p>
              {kindName(rev.snapshot.kind)} ·{" "}
              {formatDate(rev.snapshot.inspectedOn)} ·{" "}
              {states[rev.snapshot.status]}
            </p>
            <Observations items={rev.snapshot.items} originals={d.originals} />
          </details>
        ))}
        <div className="actions">
          {d.nextBeforeVersion && (
            <button
              className="secondary"
              onClick={() => setBefore(d.nextBeforeVersion)}
            >
              Older inspection history
            </button>
          )}
          {before && (
            <button className="secondary" onClick={() => setBefore(null)}>
              Latest inspection history
            </button>
          )}
        </div>
      </section>
      <EditorDialog
        open={open}
        title={
          action?.name === "complete"
            ? "Review inspection completion"
            : action?.name === "reopen"
              ? "Reopen inspection"
              : "Submit inspection for review"
        }
        onClose={() => setOpen(false)}
        onDiscard={() => {
          setOpen(false);
          setAction(null);
        }}
      >
        {action && (
          <Form
            key={action.key}
            operation="inspection.review"
            label={
              action.name === "complete"
                ? "Complete reviewed inspection"
                : action.name === "reopen"
                  ? "Reopen with reason"
                  : "Submit saved inspection"
            }
            feedbackText="Inspection review saved."
            submit={async (data) => {
              try {
                await api(`${endpoint}/${id}`, {
                  method: "POST",
                  body: {
                    action: action.name,
                    expectedVersion: action.row.version,
                    submissionKey: action.key,
                    ...(action.name !== "submit"
                      ? { reason: String(data.get("reason")) }
                      : {}),
                  },
                });
                setOpen(false);
                setAction(null);
                setBefore(null);
                r.reload();
                changed();
              } catch (e) {
                if (e instanceof ApiError && [403, 404].includes(e.status)) {
                  setOpen(false);
                  setAction(null);
                  denied();
                }
                r.reload();
                throw e;
              }
            }}
          >
            <p>
              {kindName(action.row.kind)} · {formatDate(action.row.inspectedOn)}{" "}
              · version {action.row.version}
            </p>
            <Observations items={action.row.items} originals={d.originals} />
            {action.name !== "submit" && (
              <label>
                {action.name === "complete"
                  ? "Completion review note"
                  : "Reason for reopening"}
                <textarea name="reason" required maxLength={1000} />
              </label>
            )}
            <label className="checkbox-label">
              <input type="checkbox" required />{" "}
              {action.name === "complete"
                ? "I reviewed all saved condition items and their linked evidence."
                : action.name === "reopen"
                  ? "I understand the previous review will remain in history."
                  : "All observed items are ready for management review."}
            </label>
            <p className="help">
              This action records condition only. Charges, deposit applications
              and refunds require their own review.
            </p>
          </Form>
        )}
      </EditorDialog>
    </article>
  );
}
function InspectionEditor({
  draft,
  endpoint,
  baselines,
  itemsChanged,
  saved,
  denied,
}: {
  draft: { row: Inspection | null; key: string };
  endpoint: string;
  baselines: Baseline[];
  itemsChanged: () => void;
  saved: (id: string) => void;
  denied: () => void;
}) {
  const [items, setItems] = useState<Item[]>(
    () => draft.row?.items || [blank()],
  );
  const [kind, setKind] = useState(draft.row?.kind || "move_in");
  const documents = useResource<Documents>(
    endpoint.replace(/\/inspections$/, "/documents"),
    true,
    true,
  );
  const frozen = useRef<Record<string, unknown> | null>(null);
  const options =
    documents.data?.items.flatMap((doc) =>
      doc.versions
        .filter((v) => v.scanStatus === "clean")
        .map((v) => ({
          id: v.id,
          label: `${doc.title} · version ${v.number} · ${v.filename}${doc.archivedAt ? " (archived)" : ""}`,
        })),
    ) || [];
  return (
    <Form
      operation="inspection.save"
      label="Save observations"
      feedbackText="Inspection observations saved."
      submit={async (data) => {
        const body = frozen.current || {
          ...(draft.row
            ? { action: "edit", expectedVersion: draft.row.version }
            : { kind }),
          inspectedOn: String(data.get("inspectedOn")),
          baselineRevisionId:
            kind === "move_out"
              ? String(data.get("baselineRevisionId") || "") || null
              : null,
          items: items.map((i) => ({
            key: i.key,
            area: String(data.get(`${i.key}-area`)),
            item: String(data.get(`${i.key}-item`)),
            condition: String(data.get(`${i.key}-condition`)),
            notes: String(data.get(`${i.key}-notes`)),
            evidenceVersionIds: data.getAll(`${i.key}-evidence`).map(String),
          })),
          submissionKey: draft.key,
        };
        try {
          const result = await api<{ inspectionId: string }>(
            `${endpoint}${draft.row ? `/${draft.row.id}` : ""}`,
            { method: "POST", body },
          );
          saved(result.inspectionId);
        } catch (e) {
          if (e instanceof ApiError && [403, 404].includes(e.status)) denied();
          if (e instanceof ApiError && e.submissionUncertain)
            frozen.current = body;
          throw e;
        }
      }}
    >
      <div className="form-grid">
        <label>
          Inspection type
          <select
            aria-label="Inspection type"
            name="kind"
            value={kind}
            disabled={!!draft.row}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="move_in">Move-in</option>
            <option value="move_out">Move-out</option>
          </select>
        </label>
        <label>
          Inspection date
          <DateField
            aria-label="Inspection date"
            name="inspectedOn"
            required
            defaultValue={draft.row?.inspectedOn.slice(0, 10) || ""}
          />
        </label>
      </div>
      {kind === "move_out" && (
        <label>
          Reviewed move-in baseline
          <select
            aria-label="Reviewed move-in baseline"
            name="baselineRevisionId"
            defaultValue={draft.row?.baselineRevisionId || ""}
          >
            <option value="">No reviewed move-in record selected</option>
            {baselines.map((b) => (
              <option key={b.id} value={b.id}>
                {formatDate(b.inspectedOn)} · reviewed version {b.version}
              </option>
            ))}
            {draft.row?.baselineRevisionId &&
              !baselines.some(
                (b) => b.id === draft.row!.baselineRevisionId,
              ) && (
                <option value={draft.row.baselineRevisionId}>
                  Retained selected move-in review
                </option>
              )}
          </select>
          <span className="help">
            The exact reviewed version stays linked even if that move-in report
            is later reopened.
          </span>
        </label>
      )}
      <p className="help">
        Upload originals in this lease’s Documents section and clear scanning
        before linking them. Saving observations keeps them in progress until
        submitted and reviewed.
      </p>
      {documents.error && (
        <p role="alert" className="notice error">
          Evidence choices could not load. Existing selections are retained.{" "}
          <button type="button" onClick={documents.reload}>
            Retry evidence choices
          </button>
        </p>
      )}
      {items.map((i, index) => (
        <fieldset className="inspection-item-editor" key={i.key}>
          <legend>Condition item {index + 1}</legend>
          <div className="form-grid">
            <label>
              Area
              <input
                aria-label={`Area ${index + 1}`}
                name={`${i.key}-area`}
                required
                maxLength={80}
                defaultValue={i.area}
              />
            </label>
            <label>
              Item
              <input
                aria-label={`Item ${index + 1}`}
                name={`${i.key}-item`}
                required
                maxLength={120}
                defaultValue={i.item}
              />
            </label>
          </div>
          <label>
            Condition
            <select
              aria-label={`Condition ${index + 1}`}
              name={`${i.key}-condition`}
              defaultValue={i.condition}
            >
              {Object.entries(conditions).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Observation notes
            <textarea
              aria-label={`Observation notes ${index + 1}`}
              name={`${i.key}-notes`}
              maxLength={1000}
              defaultValue={i.notes}
            />
            <span className="help">
              Describe damage before submitting for review.
            </span>
          </label>
          <details>
            <summary>Link exact evidence versions</summary>
            <div className="inspection-evidence-options">
              {options.length === 0 && (
                <p className="help">No cleared document versions available.</p>
              )}
              {[
                ...options,
                ...i.evidenceVersionIds
                  .filter((id) => !options.some((o) => o.id === id))
                  .map((id) => ({
                    id,
                    label: "Retained evidence selection (metadata unavailable)",
                  })),
              ].map((o) => (
                <label className="checkbox-label" key={o.id}>
                  <input
                    type="checkbox"
                    name={`${i.key}-evidence`}
                    value={o.id}
                    defaultChecked={i.evidenceVersionIds.includes(o.id)}
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </details>
          <button
            type="button"
            className="text-button"
            disabled={items.length === 1}
            onClick={() => {
              itemsChanged();
              setItems((rows) => rows.filter((row) => row.key !== i.key));
            }}
          >
            Remove condition item {index + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="secondary"
        disabled={items.length >= 100}
        onClick={() => {
          itemsChanged();
          setItems((rows) => [...rows, blank()]);
        }}
      >
        Add condition item
      </button>
    </Form>
  );
}
