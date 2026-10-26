import { documentStatusLabel } from "../document-status";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useResource } from "../useResource";
import { useDebouncedValue } from "../useDebouncedValue";
import { formatDate } from "../dates";
import { dollars } from "../money";
import { Form } from "./Form";
import { EditorDialog } from "./EditorDialog";
import "./LeaseAgreements.css";

type Party = {
  id: string;
  userId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  startsOn: string;
  endsOn: string | null;
  version: number;
};
type Representative = {
  userId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: string;
  version: number;
};
type FileSource = {
  id: string;
  documentId: string;
  number: number;
  filename: string;
  mediaType: string;
  byteLength: number;
  scanStatus: string;
  title: string;
  documentVersion: number;
  archivedAt: string | null;
  latest: { id: string; number: number; scanStatus: string } | null;
};
type Missing = { id: string; unavailable: true };
type Source = {
  lease: {
    id: string;
    version: number;
    status: string;
    startsOn: string;
    endsOn: string | null;
    rentCents: number;
    rentDueDay: number;
    graceDays: number;
    paymentInstructions: string | null;
    property: { name: string };
    unit: { label: string };
  };
  files: (FileSource | Missing)[];
  parties: (Party | Missing)[];
  companySigner: Representative | null;
};
type Package = {
  notes: string;
  documentVersionIds: string[];
  partyIds: string[];
  companySignerId: string | null;
};
type Agreement = {
  id: string;
  title: string;
  kind: string;
  status: string;
  version: number;
  package: Package;
  source: Source;
};
type Snapshot = Omit<Agreement, "id" | "version">;
type Revision = {
  id: string;
  version: number;
  action: string;
  reason: string | null;
  snapshot: Snapshot;
  createdAt: string;
  actorName: string;
};
type Detail = {
  agreement: Agreement;
  currentSource: Source;
  sourceChanged: boolean;
  blockers: string[];
  revisions: Revision[];
  nextBeforeVersion: number | null;
};
type Directory = {
  items: Pick<Agreement, "id" | "title" | "kind" | "status" | "version">[];
  total: number;
  page: number;
  pageSize: number;
};
type Context = {
  lease: Source["lease"];
  leaseholders: Party[];
  unavailableLeaseholders: number;
  companySigners: Representative[];
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
type Draft =
  | { type: "package"; row: Agreement | null; key: string }
  | { type: "action"; row: Agreement; key: string; action: string };
const statuses: Record<string, string> = {
  preparing: "In preparation",
  awaiting_review: "Awaiting review",
  reviewed: "Reviewed · unsigned",
  cancelled: "Preparation cancelled",
};
const kinds: Record<string, string> = {
  lease: "Lease agreement",
  renewal: "Renewal agreement",
  addendum: "Addendum",
  other: "Other agreement",
};
const actions: Record<string, string> = {
  create: "Package created",
  edit: "Version saved",
  submit: "Review requested",
  approve: "Preparation approved",
  request_changes: "Changes requested",
  reopen: "Preparation reopened",
  cancel: "Preparation cancelled",
};
const scanLabel = documentStatusLabel;
function docLink(params: URLSearchParams, id?: string) {
  const next = new URLSearchParams(params);
  next.set("section", "documents");
  if (id) next.set("documentId", id);
  return `?${next}`;
}
function Sources({ source }: { source: Source }) {
  const [params] = useSearchParams();
  return (
    <div className="agreement-sources">
      <section>
        <h4>Lease details in this snapshot</h4>
        <p>
          {source.lease.property.name} · {source.lease.unit.label} ·{" "}
          {source.lease.status}
        </p>
        <p>
          {formatDate(source.lease.startsOn)} through{" "}
          {formatDate(source.lease.endsOn, "Open ended")} ·{" "}
          {dollars(source.lease.rentCents)} monthly rent
        </p>
        <p className="help">
          Rent due day {source.lease.rentDueDay} · {source.lease.graceDays}{" "}
          grace days · lease version {source.lease.version}
        </p>
        {source.lease.paymentInstructions && (
          <details>
            <summary>Recorded payment instructions</summary>
            <p className="agreement-notes">
              {source.lease.paymentInstructions}
            </p>
          </details>
        )}
      </section>
      <section>
        <h4>Retained document versions</h4>
        {!source.files.length ? (
          <p>No agreement document selected.</p>
        ) : (
          <ul>
            {source.files.map((file) => (
              <li key={file.id}>
                {"unavailable" in file ? (
                  <p>A selected original is unavailable.</p>
                ) : (
                  <>
                    <Link
                      target="_blank"
                      rel="noreferrer"
                      to={docLink(params, file.documentId)}
                    >
                      {file.title} · version {file.number} · {file.filename}
                    </Link>
                    <p className="help">
                      {scanLabel(file.scanStatus)}
                      {file.archivedAt ? " · Archived" : ""}
                      {file.latest && file.latest.id !== file.id
                        ? ` · Newer uploaded version ${file.latest.number}: ${scanLabel(file.latest.scanStatus)}`
                        : ""}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h4>Intended leaseholder signers</h4>
        {!source.parties.length ? (
          <p>No intended leaseholder signer selected.</p>
        ) : (
          <ul>
            {source.parties.map((party) => (
              <li key={party.id}>
                {"unavailable" in party ? (
                  "A selected leaseholder is no longer eligible."
                ) : (
                  <>
                    {party.name} · {party.email}
                    {!party.emailVerified && (
                      <p className="help">
                        Account email has not been verified. Preparation does
                        not verify identity or grant access.
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <h4>Intended company signer</h4>
        {source.companySigner ? (
          <p>
            {source.companySigner.name} · {source.companySigner.email} ·{" "}
            {source.companySigner.role}
          </p>
        ) : (
          <p>No company signer selected.</p>
        )}
      </section>
    </div>
  );
}
function PackageView({ row }: { row: Agreement | Snapshot }) {
  return (
    <>
      <p className="record-kicker">
        {kinds[row.kind]} · {statuses[row.status]}
      </p>
      {row.package.notes && (
        <section>
          <h4>Private preparation notes</h4>
          <p className="agreement-notes">{row.package.notes}</p>
        </section>
      )}
      <Sources source={row.source} />
    </>
  );
}

export function LeaseAgreements({ leaseId }: { leaseId: string }) {
  const endpoint = `/api/company/leases/${encodeURIComponent(leaseId)}/agreements`,
    [params, setParams] = useSearchParams();
  const search = params.get("agreementQ") || "",
    settled = useDebouncedValue(search),
    status = params.get("agreementStatus") || "active",
    page = Number(params.get("agreementPage") || 1),
    selected = params.get("agreementId");
  const q = new URLSearchParams({ status, page: String(page) });
  if (settled) q.set("q", settled);
  const r = useResource<Directory>(`${endpoint}?${q}`, true, true);
  const [draft, setDraft] = useState<Draft | null>(null),
    [open, setOpen] = useState(false),
    [changeVersion, setChangeVersion] = useState(0),
    [refresh, setRefresh] = useState(0),
    [denied, setDenied] = useState(false);
  const set = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    next.set("section", "agreements");
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  };
  useEffect(() => {
    if (r.data && page > Math.max(1, Math.ceil(r.data.total / r.data.pageSize)))
      set({
        agreementPage: String(
          Math.max(1, Math.ceil(r.data.total / r.data.pageSize)),
        ),
      });
  }, [r.data, page]);
  const saved = (id: string) => {
    setOpen(false);
    setDraft(null);
    setChangeVersion(0);
    set({ agreementId: id });
    setRefresh((v) => v + 1);
    r.reload();
  };
  const unavailable = () => {
    setOpen(false);
    setDraft(null);
    setDenied(true);
  };
  const failed = (e: unknown) => {
    if (e instanceof ApiError && [403, 404].includes(e.status)) unavailable();
    else {
      setRefresh((v) => v + 1);
      r.reload();
    }
  };
  if (denied)
    return (
      <p role="alert" className="notice error">
        Agreement access is unavailable.{" "}
        <button type="button" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </p>
    );
  return (
    <section className="panel agreement-workspace">
      <header className="section-heading">
        <div>
          <h2>Agreements</h2>
          <p>
            Prepare document versions and intended signers for management
            review.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!draft)
              setDraft({
                type: "package",
                row: null,
                key: crypto.randomUUID(),
              });
            setOpen(true);
          }}
        >
          {draft ? "Resume agreement form" : "Prepare agreement"}
        </button>
      </header>
      <p className="notice">
        Unsigned preparation · Electronic signatures are not activated.
        Reviewing a package does not send an invitation or sign an agreement.
      </p>
      <div className="form-grid agreement-filters">
        <label>
          Search agreements
          <input
            type="search"
            aria-label="Search agreements"
            maxLength={200}
            value={search}
            onChange={(e) =>
              set({ agreementQ: e.target.value, agreementPage: "1" })
            }
          />
        </label>
        <label>
          Preparation status
          <select
            aria-label="Agreement preparation status"
            value={status}
            onChange={(e) =>
              set({ agreementStatus: e.target.value, agreementPage: "1" })
            }
          >
            <option value="active">Active preparations</option>
            <option value="all">All preparations</option>
            {Object.entries(statuses).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {r.error && (
        <p className="notice error" role="alert">
          {r.error}{" "}
          <button type="button" onClick={r.reload}>
            Retry agreements
          </button>
        </p>
      )}
      {!r.data ? (
        <p role="status">
          {r.error ? "Agreement results unavailable." : "Loading agreements…"}
        </p>
      ) : (
        <>
          <p className="help">
            {r.data.total} matching{" "}
            {r.data.total === 1 ? "agreement" : "agreements"}
          </p>
          {!r.data.items.length ? (
            <p>
              No matching agreement preparations. Start with the retained
              documents for this lease.
            </p>
          ) : (
            <ul className="agreement-directory">
              {r.data.items.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={selected === row.id ? "" : "secondary"}
                    aria-current={selected === row.id ? "page" : undefined}
                    onClick={() => set({ agreementId: row.id })}
                  >
                    <strong>{row.title}</strong>
                    <span>
                      {kinds[row.kind]} · {statuses[row.status]} · version{" "}
                      {row.version}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="actions">
            {page > 1 && (
              <button
                className="secondary"
                onClick={() => set({ agreementPage: String(page - 1) })}
              >
                Previous agreements
              </button>
            )}
            {page * r.data.pageSize < r.data.total && (
              <button
                className="secondary"
                onClick={() => set({ agreementPage: String(page + 1) })}
              >
                Next agreements
              </button>
            )}
          </div>
          {selected && (
            <AgreementDetail
              key={`${selected}:${refresh}`}
              id={selected}
              endpoint={endpoint}
              busy={!!draft}
              start={(row, action) => {
                setDraft(
                  action
                    ? {
                        type: "action",
                        row: structuredClone(row),
                        action,
                        key: crypto.randomUUID(),
                      }
                    : {
                        type: "package",
                        row: structuredClone(row),
                        key: crypto.randomUUID(),
                      },
                );
                setOpen(true);
              }}
            />
          )}
          <EditorDialog
            open={open}
            title={
              draft?.type === "action"
                ? actions[draft.action] || "Review agreement"
                : draft?.row
                  ? "Save agreement version"
                  : "Prepare agreement"
            }
            hasChanges={changeVersion > 0}
            changeVersion={changeVersion}
            description={
              draft?.type === "package"
                ? "Save version records an unsigned preparation package with retained history. Save draft & close keeps only this unfinished form on the current page."
                : "Review the saved package and its exact sources before recording this action."
            }
            onClose={() => setOpen(false)}
            onDiscard={() => {
              setOpen(false);
              setDraft(null);
              setChangeVersion(0);
            }}
          >
            {draft?.type === "package" ? (
              <PackageEditor
                key={draft.key}
                draft={draft}
                endpoint={endpoint}
                changed={() => setChangeVersion((v) => v + 1)}
                saved={saved}
                failed={failed}
              />
            ) : (
              draft && (
                <ReviewForm
                  key={draft.key}
                  draft={draft}
                  endpoint={endpoint}
                  saved={saved}
                  failed={failed}
                />
              )
            )}
          </EditorDialog>
        </>
      )}
    </section>
  );
}
function AgreementDetail({
  id,
  endpoint,
  busy,
  start,
}: {
  id: string;
  endpoint: string;
  busy: boolean;
  start: (row: Agreement, action?: string) => void;
}) {
  const [before, setBefore] = useState<number | null>(null),
    [params] = useSearchParams();
  const r = useResource<Detail>(
    `${endpoint}/${encodeURIComponent(id)}${before ? `?beforeVersion=${before}` : ""}`,
    true,
    true,
  );
  if (!r.data)
    return (
      <p role={r.error ? "alert" : "status"}>
        {r.error || "Loading agreement package…"}
        {r.error && <button onClick={r.reload}>Retry package</button>}
      </p>
    );
  const d = r.data,
    row = d.agreement;
  const action = (name: string, label: string, blocked = false) => (
    <button
      type="button"
      className={name === "approve" ? "" : "secondary"}
      disabled={busy || blocked}
      onClick={() => start(row, name)}
    >
      {label}
    </button>
  );
  return (
    <article className="agreement-detail">
      {r.error && (
        <p className="notice error" role="alert">
          {r.error} <button onClick={r.reload}>Retry package</button>
        </p>
      )}
      <header>
        <p className="record-kicker">
          Unsigned agreement package · version {row.version}
        </p>
        <h3>{row.title}</h3>
        <p>
          <strong>{statuses[row.status]}</strong>
        </p>
      </header>
      {d.sourceChanged && (
        <section className="notice" role="status">
          <h4>
            {row.status === "reviewed"
              ? "Preparation review is out of date"
              : "Sources changed since this version was saved"}
          </h4>
          <p>
            Lease details, intended signers or retained documents changed.
            Return to preparation and save a new version with the current
            sources before review.
          </p>
          <details>
            <summary>Review current source records</summary>
            <Sources source={d.currentSource} />
          </details>
        </section>
      )}
      {!!d.blockers.length && row.status !== "cancelled" && (
        <section className="notice">
          <h4>Before preparation review</h4>
          <ul>
            {d.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="actions">
        {row.status === "preparing" && (
          <>
            <button type="button" disabled={busy} onClick={() => start(row)}>
              Edit package &amp; refresh sources
            </button>
            {action(
              "submit",
              "Submit package for review",
              d.sourceChanged || d.blockers.length > 0,
            )}
          </>
        )}
        {row.status === "awaiting_review" && (
          <>
            {action(
              "approve",
              "Approve preparation",
              d.sourceChanged || d.blockers.length > 0,
            )}
            {action("request_changes", "Request preparation changes")}
          </>
        )}
        {["reviewed", "cancelled"].includes(row.status) &&
          action("reopen", "Reopen preparation")}
        {row.status !== "cancelled" && action("cancel", "Cancel preparation")}
        <Link to={docLink(params)}>Open lease documents →</Link>
      </div>
      <PackageView row={row} />
      <section className="agreement-history">
        <h3>Retained package history</h3>
        <p className="help">
          Each saved version and review retains the original package, intended
          signers and document references. All versions remain unsigned.
        </p>
        {d.revisions.map((rev) => (
          <details key={rev.id}>
            <summary>
              Version {rev.version} · {actions[rev.action]} ·{" "}
              {formatDate(rev.createdAt)} · {rev.actorName}
            </summary>
            {rev.reason && <p className="agreement-notes">{rev.reason}</p>}
            <h4>{rev.snapshot.title}</h4>
            <PackageView row={rev.snapshot} />
          </details>
        ))}
        <div className="actions">
          {d.nextBeforeVersion && (
            <button
              className="secondary"
              onClick={() => setBefore(d.nextBeforeVersion)}
            >
              Older agreement history
            </button>
          )}
          {before && (
            <button className="secondary" onClick={() => setBefore(null)}>
              Latest agreement history
            </button>
          )}
        </div>
      </section>
    </article>
  );
}
function ReviewForm({
  draft,
  endpoint,
  saved,
  failed,
}: {
  draft: Extract<Draft, { type: "action" }>;
  endpoint: string;
  saved: (id: string) => void;
  failed: (e: unknown) => void;
}) {
  const label: Record<string, string> = {
    submit: "Request package review",
    approve: "Confirm preparation approval",
    request_changes: "Return package for changes",
    reopen: "Reopen with reason",
    cancel: "Confirm preparation cancellation",
  };
  return (
    <Form
      operation="agreement.review"
      label={label[draft.action]}
      feedbackText="Agreement preparation updated."
      submit={async (data) => {
        try {
          const result = await api<{ agreementId: string }>(
            `${endpoint}/${encodeURIComponent(draft.row.id)}`,
            {
              method: "POST",
              body: {
                action: draft.action,
                expectedVersion: draft.row.version,
                submissionKey: draft.key,
                confirmed: data.get("confirmed") === "on",
                ...(draft.action !== "submit"
                  ? { reason: String(data.get("reason")) }
                  : {}),
              },
            },
          );
          saved(result.agreementId);
        } catch (e) {
          failed(e);
          throw e;
        }
      }}
    >
      <h3>
        {draft.row.title} · version {draft.row.version}
      </h3>
      <PackageView row={draft.row} />
      {draft.action !== "submit" && (
        <label>
          Review note or reason
          <textarea
            aria-label="Agreement review reason"
            name="reason"
            required
            maxLength={1000}
          />
        </label>
      )}
      <label className="checkbox-label">
        <input type="checkbox" name="confirmed" required />
        {draft.action === "approve"
          ? "I reviewed the retained document versions, lease details and intended signers. This records preparation approval only."
          : draft.action === "cancel"
            ? "Cancel this preparation and retain all earlier versions. No signature envelope has been sent."
            : draft.action === "reopen" || draft.action === "request_changes"
              ? "Return this package to preparation and retain all earlier reviews."
              : "The saved package is ready for management preparation review."}
      </label>
      <p className="help">
        No invitation, electronic signature, lease change or financial entry is
        created by this action.
      </p>
    </Form>
  );
}
function PackageEditor({
  draft,
  endpoint,
  changed,
  saved,
  failed,
}: {
  draft: Extract<Draft, { type: "package" }>;
  endpoint: string;
  changed: () => void;
  saved: (id: string) => void;
  failed: (e: unknown) => void;
}) {
  const c = useResource<Context>(`${endpoint}/context`, true, true),
    documents = useResource<Documents>(
      endpoint.replace(/\/agreements$/, "/documents"),
      true,
      true,
    );
  const [selectedFiles, setSelectedFiles] = useState<string[]>(
      draft.row?.package.documentVersionIds || [],
    ),
    [documentId, setDocumentId] = useState(""),
    [versionId, setVersionId] = useState("");
  const frozen = useRef<Record<string, unknown> | null>(null),
    chosen = documents.data?.items.find((d) => d.id === documentId);
  const files =
    documents.data?.items.flatMap((d) =>
      d.versions.map((v) => ({
        ...v,
        documentId: d.id,
        title: d.title,
        archivedAt: d.archivedAt,
      })),
    ) || [];
  if (!c.data || !documents.data)
    return (
      <div>
        {c.error || documents.error ? (
          <p role="alert" className="notice error">
            {c.error || documents.error}{" "}
            <button
              type="button"
              onClick={() => {
                c.reload();
                documents.reload();
              }}
            >
              Retry package sources
            </button>
          </p>
        ) : (
          <p role="status">Loading lease documents and intended signers…</p>
        )}
      </div>
    );
  const source = c.data,
    partyIds = draft.row?.package.partyIds || [],
    companySignerId = draft.row?.package.companySignerId || "";
  const addFile = () => {
    const selected = files.find((f) => f.id === versionId);
    if (!selected || selectedFiles.includes(versionId)) return;
    changed();
    setSelectedFiles((ids) => [
      ...ids.filter(
        (id) =>
          files.find((f) => f.id === id)?.documentId !== selected.documentId,
      ),
      versionId,
    ]);
    setVersionId("");
  };
  return (
    <Form
      operation="agreement.save"
      label="Save agreement version"
      feedbackText="Unsigned agreement version saved."
      submit={async (data) => {
        const body = frozen.current || {
          title: String(data.get("title")),
          kind: String(data.get("kind")),
          notes: String(data.get("notes")),
          documentVersionIds: data.getAll("documentVersionIds").map(String),
          partyIds: data.getAll("partyIds").map(String),
          companySignerId: String(data.get("companySignerId") || "") || null,
          submissionKey: draft.key,
          ...(draft.row
            ? { action: "edit", expectedVersion: draft.row.version }
            : {}),
        };
        try {
          const result = await api<{ agreementId: string }>(
            `${endpoint}${draft.row ? `/${encodeURIComponent(draft.row.id)}` : ""}`,
            { method: "POST", body },
          );
          saved(result.agreementId);
        } catch (e) {
          if (e instanceof ApiError && e.submissionUncertain)
            frozen.current = body;
          if (e instanceof ApiError && [403, 404, 409].includes(e.status))
            failed(e);
          throw e;
        }
      }}
    >
      <div className="form-grid">
        <label>
          Agreement title
          <input
            aria-label="Agreement title"
            name="title"
            required
            maxLength={160}
            defaultValue={draft.row?.title || ""}
          />
        </label>
        <label>
          Agreement type
          <select
            aria-label="Agreement type"
            name="kind"
            defaultValue={draft.row?.kind || "lease"}
          >
            {Object.entries(kinds).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="help">
        {source.lease.property.name} · {source.lease.unit.label} ·{" "}
        {formatDate(source.lease.startsOn)} through{" "}
        {formatDate(source.lease.endsOn, "Open ended")} · lease version{" "}
        {source.lease.version}. Saving captures current source records; it does
        not change the lease.
      </p>
      {(c.error || documents.error) && (
        <p className="notice error" role="alert">
          {c.error || documents.error}
        </p>
      )}
      <fieldset className="agreement-editor-section">
        <legend>Agreement document versions</legend>
        <p className="help">
          Upload the prepared agreement in this lease’s Documents section first.
          Historically rejected or archived versions can be retained during preparation;
          review requires active, available originals. Files are not scanned for malware. Choosing another version of
          a document replaces its selection in this package.
        </p>
        <div className="form-grid">
          <label>
            Document
            <select
              aria-label="Agreement document"
              value={documentId}
              onChange={(e) => {
                setDocumentId(e.target.value);
                setVersionId("");
              }}
            >
              <option value="">Choose a lease document</option>
              {documents.data.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                  {d.archivedAt ? " · Archived" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Original version
            <select
              aria-label="Agreement original version"
              value={versionId}
              disabled={!chosen}
              onChange={(e) => setVersionId(e.target.value)}
            >
              <option value="">Choose a retained version</option>
              {chosen?.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Version {v.number} · {v.filename} · {scanLabel(v.scanStatus)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={addFile}
          disabled={
            !versionId ||
            selectedFiles.includes(versionId) ||
            (selectedFiles.length >= 10 &&
              !selectedFiles.some(
                (id) =>
                  files.find((f) => f.id === id)?.documentId === documentId,
              ))
          }
        >
          Use document version
        </button>
        {!selectedFiles.length ? (
          <p>No agreement documents selected yet.</p>
        ) : (
          <ul className="agreement-selected-files">
            {selectedFiles.map((id) => {
              const file = files.find((f) => f.id === id);
              return (
                <li key={id}>
                  <input type="hidden" name="documentVersionIds" value={id} />
                  <p>
                    {file
                      ? `${file.title} · version ${file.number} · ${file.filename} · ${scanLabel(file.scanStatus)}${file.archivedAt ? " · Archived" : ""}`
                      : "Retained selection is unavailable. Remove it and choose a current lease original."}
                  </p>
                  <button
                    type="button"
                    className="text-button"
                    aria-label={`Remove ${file?.title || "unavailable document"} version ${file?.number || "selection"}`}
                    onClick={() => {
                      changed();
                      setSelectedFiles((ids) => ids.filter((v) => v !== id));
                    }}
                  >
                    Remove selected version
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
      <fieldset className="agreement-editor-section">
        <legend>Intended signers</legend>
        <p className="help">
          Selections come from recorded leaseholders and active company
          management. Preparing a package does not grant portal access, verify
          identity or invite anyone.
        </p>
        <div className="agreement-party-options">
          {!source.leaseholders.length && (
            <p>
              No eligible linked leaseholders. Review Leaseholders &amp;
              occupants to connect existing accounts.
            </p>
          )}
          {source.leaseholders.map((p) => (
            <label className="checkbox-label" key={p.id}>
              <input
                type="checkbox"
                name="partyIds"
                value={p.id}
                defaultChecked={partyIds.includes(p.id)}
              />
              {p.name} · {p.email}
              <span className="help">
                {formatDate(p.startsOn)} through{" "}
                {formatDate(p.endsOn, "Open ended")}
                {!p.emailVerified ? " · Email not yet verified" : ""}
              </span>
            </label>
          ))}
          {partyIds
            .filter((id) => !source.leaseholders.some((p) => p.id === id))
            .map((id) => (
              <label className="checkbox-label" key={id}>
                <input
                  type="checkbox"
                  name="partyIds"
                  value={id}
                  defaultChecked
                />
                Previously selected leaseholder is no longer eligible. Clear
                this selection before saving.
              </label>
            ))}
        </div>
        {source.unavailableLeaseholders > 0 && (
          <p className="help">
            {source.unavailableLeaseholders} recorded leaseholder{" "}
            {source.unavailableLeaseholders === 1 ? "needs" : "records need"}{" "}
            account or household review before selection.
          </p>
        )}
        <label>
          Company signer
          <select
            aria-label="Intended company signer"
            name="companySignerId"
            defaultValue={companySignerId}
          >
            <option value="">Choose an active owner or manager</option>
            {source.companySigners.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name} · {s.email} · {s.role}
              </option>
            ))}
            {companySignerId &&
              !source.companySigners.some(
                (s) => s.userId === companySignerId,
              ) && (
                <option value={companySignerId}>
                  Previously selected signer is unavailable — choose another
                </option>
              )}
          </select>
        </label>
      </fieldset>
      <label>
        Private preparation notes
        <textarea
          aria-label="Agreement preparation notes"
          name="notes"
          maxLength={4000}
          defaultValue={draft.row?.package.notes || ""}
        />
        <span className="help">
          These notes stay within management preparation; they are separate from
          the uploaded agreement text.
        </span>
      </label>
    </Form>
  );
}
