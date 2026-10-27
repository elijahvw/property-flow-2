import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { tenantEditorScope, useTenantAttemptContext, useTenantEditorRecord } from "../tenant-write-access";
import { leasePath } from "../lease-links";
import { EditorDialog } from "../components/EditorDialog";
import type { TaskDraft } from "../components/TaskDraft";
import { LeaseCreate, LeaseRenewal, type Lease } from "./Leasing";
import { SavedInspectionTask } from "../components/LeaseInspections";
import { monitorOperation } from "../operations";

type DraftSummary = Pick<TaskDraft, "id" | "companyId" | "title" | "kind" | "version" | "savedAt" | "expiresAt" | "unavailable" | "sourceIssue">;
const dateTime = (value: string) => new Date(value).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const date = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export function SavedDrafts() {
  const [params] = useSearchParams(), { data } = useAuth(), id = params.get("draftId"), scope = tenantEditorScope(data);
  const requestedVersion = params.get("taskVersion") || "", revision = /^\d{1,10}$/.test(requestedVersion) ? requestedVersion : "";
  return id ? <SavedTask key={`${scope}:${id}:${revision}`} id={id}/> : <DraftList key={scope}/>;
}
function useDraftDeletion() {
  const { data } = useAuth(), context = useTenantAttemptContext(data);
  const [error, setError] = useState(""), [deleting, setDeleting] = useState<string | null>(null);
  const readOnly = !!data?.impersonation || data?.companyFeatures?.leasing !== undefined && data.companyFeatures.leasing !== "enabled";
  const blocked = (row: DraftSummary) => readOnly || row.kind === "inspection" && data?.companyFeatures?.inspections !== undefined && data.companyFeatures.inspections !== "enabled";
  const remove = async (row: DraftSummary, complete: () => void) => {
    if (deleting || blocked(row) || !context.current() || row.companyId !== context.companyId) return;
    if (!window.confirm("Delete this saved draft? Your source records will remain unchanged.")) return;
    setDeleting(row.id); setError("");
    try {
      await monitorOperation("draft.delete", () => api(`/api/company/task-drafts/${encodeURIComponent(row.id)}`, {
        method: "DELETE", body: { expectedVersion: row.version }, expectedCompanyId: context.companyId,
      }));
      if (context.current()) complete();
    } catch (caught) { if (context.current()) setError(caught instanceof Error ? caught.message : "Unable to delete this draft."); }
    finally { setDeleting(null); }
  };
  return { error, deleting, readOnly, blocked, remove };
}
function DraftList() {
  const { data } = useAuth(), r = useResource<{ companyId: string; items: DraftSummary[]; hasMore: boolean }>("/api/company/task-drafts", true, true);
  const deletion = useDraftDeletion();
  const wrongCompany = r.data && r.data.companyId !== data?.membership?.companyId;
  return <>
    <header className="page-heading"><p className="eyebrow">Your work</p><h1>Saved drafts</h1><p>Continue your unfinished lease, renewal or inspection tasks. Drafts are private to your account and company. Saving a draft never posts money, changes a lease or submits an inspection.</p></header>
    {deletion.error && <p role="alert" className="notice error">{deletion.error}</p>}
    {deletion.readOnly && <p className="notice" role="status">Saved tasks are read-only under your current access settings.</p>}
    {wrongCompany ? <p role="alert">Your company changed. Reload the workspace to review its saved tasks.</p>
      : r.error ? <p role="alert">{r.error} <button onClick={r.reload}>Try again</button></p>
      : !r.data ? <p role="status">Loading saved drafts…</p>
      : <section className="panel" aria-label="Your saved tasks">
        {!r.data.items.length ? <p>No saved drafts. Choose Save task draft in a supported task when you want to continue later.</p>
          : <ul>{r.data.items.map(row => <li className="record-card" key={row.id}>
            <h2><Link to={`?draftId=${encodeURIComponent(row.id)}`}>{row.title}</Link></h2>
            <p>Saved {dateTime(row.savedAt)} · Expires {date(row.expiresAt)}</p>
            {row.unavailable && <p className="notice" role="status">{row.sourceIssue}</p>}
            <div className="actions"><Link className="button" to={`?draftId=${encodeURIComponent(row.id)}`}>{row.unavailable ? "Review unavailable task" : "Continue task"}</Link><button className="secondary" disabled={!!deletion.deleting || deletion.blocked(row)} onClick={() => void deletion.remove(row, r.reload)}>Delete draft</button></div>
          </li>)}</ul>}
        {r.data.hasMore && <p className="notice">Only the first 100 saved tasks are shown. Delete tasks you no longer need, then reload to review the rest.</p>}
        <p className="help">Drafts expire 30 days after the latest save. Uploaded files and pending submitted financial requests are not stored here.</p>
      </section>}
  </>;
}
function SavedTask({ id }: { id: string }) {
  const { data } = useAuth(), scope = tenantEditorScope(data), r = useResource<TaskDraft>(`/api/company/task-drafts/${encodeURIComponent(id)}`, true, true), navigate = useNavigate();
  const task = useTenantEditorRecord(r, scope), deletion = useDraftDeletion();
  if (!task || task.companyId !== data?.membership?.companyId || task.id !== id) return <section className="status-panel"><h1>Saved task</h1>{r.error ? <p role="alert">{r.error} <button onClick={r.reload}>Try again</button></p> : <p role="status">{task ? "Your task context changed. Reload the workspace." : "Loading your saved task…"}</p>}<Link to="/company/drafts">Back to saved drafts</Link></section>;
  if (task.unavailable) return <section className="status-panel"><h1>Saved task needs attention</h1><p role="alert">{task.sourceIssue}</p><p>The original source is unchanged. This saved task cannot be resumed in its current state.</p>{deletion.error && <p role="alert">{deletion.error}</p>}<div className="actions"><Link to="/company/drafts">Back to saved drafts</Link><button className="secondary" disabled={!!deletion.deleting || deletion.blocked(task)} onClick={() => void deletion.remove(task, () => navigate("/company/drafts"))}>Delete draft</button></div></section>;
  return <EditorDialog presentation="page" title={task.title} open onClose={() => navigate("/company/drafts")} backLabel="Back to saved drafts"><SavedTaskContent key={task.id} task={task}/></EditorDialog>;
}
function SavedTaskContent({ task }: { task: TaskDraft }) {
  const navigate = useNavigate();
  if (task.kind === "lease_create") return <LeaseCreate propertyId={task.propertyId} propertyName={task.property?.name || "Property"} initialTask={task} saved={row => navigate(leasePath(row.id, { ...task.context, onboarding: "move-in" }))}/>;
  if (task.kind === "inspection") return <SavedInspectionTask task={task} saved={id => navigate(leasePath(task.sourceId!, { ...task.context, section: "inspections", inspectionId: id }))}/>;
  return <RenewalTask task={task}/>;
}
function RenewalTask({ task }: { task: TaskDraft }) {
  const navigate = useNavigate(), lease = useResource<Lease>(`/api/company/leases/${encodeURIComponent(task.sourceId!)}`, true, true);
  if (!lease.data) return <p role={lease.error ? "alert" : "status"}>{lease.error || "Loading the current lease…"}</p>;
  if (!lease.data.endsOn) return <p role="alert">The current lease has no end date. Return to Saved drafts to review or remove this unavailable renewal task.</p>;
  return <LeaseRenewal previous={lease.data} initialTask={task} saved={row => navigate(leasePath(row.id, task.context))}/>;
}
