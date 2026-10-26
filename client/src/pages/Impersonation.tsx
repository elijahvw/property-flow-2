import { useSearchParams } from "react-router-dom";
import { useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { useDebouncedValue } from "../useDebouncedValue";
import { monitorOperation } from "../operations";
import { EditorDialog } from "../components/EditorDialog";
import { openSupportSession, roleLabel, impersonationRole } from "../impersonation";

type Target = {
  id: string; name: string | null; email: string; platformRole?: string | null; status?: string; emailVerified?: boolean;
  membership: { companyId: string; role: string; status?: string; company: { id: string; name: string; status?: string } } | null;
};
type SupportUser = {
  id: string; name: string | null; email: string; status: string; emailVerified: boolean;
  platformRole: string | null; updatedAt: string; hasIdentity: boolean;
};
type Directory<T> = { items: T[]; nextCursor: string | null };
export function Impersonation() {
  const { can, data: auth } = useAuth();
  const owner = auth?.user.platformRole === "owner";
  const readOnly = !!auth?.impersonation;
  const [query, setQuery] = useState(""), [role, setRole] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const search = useDebouncedValue(query.trim(), 250);
  const params = new URLSearchParams({ q: search, ...(role ? { role } : {}), ...(cursors.length ? { cursor: cursors[cursors.length - 1] } : {}) });
  const resource = useResource<Directory<Target>>(`/api/impersonation/users?${params}`, false, true);
  const [selected, setSelected] = useState<Target | null>(null), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [uncertain, setUncertain] = useState(false);
  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || busy || readOnly) return;
    setBusy(true); setError("");
    try {
      const result = await monitorOperation("impersonation.start", () => api<{ destination: string }>("/api/impersonation", {
        method: "POST", body: { userId: selected.id, reason: reason.trim() },
      }));
      openSupportSession(result.destination);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Impersonation could not start.");
      setUncertain(failure instanceof ApiError && failure.submissionUncertain);
      setBusy(false);
    }
  }
  return <>
    <header className="page-heading"><p className="eyebrow">Platform support</p><h1>Impersonation</h1><p>View an existing user's workspace with their current role, company and property access.</p></header>
    <p className="notice">Support sessions are read-only and expire after 30 minutes. Changes are disabled. Each session records who started it, the selected user and the reason.</p>
    <section className="panel" aria-labelledby="impersonation-users-title">
      <h2 id="impersonation-users-title">Choose a user</h2>
      <p className="help">{owner ? "Platform owners can inspect any recorded account, including platform accounts and users without active company access. The selected account keeps its actual permissions and denied states; nothing is activated or granted." : "Delegated support can view only active, verified users with an active company membership. Platform accounts are excluded."}</p>
      <div className="impersonation-filters">
        <label>Find a user or company<input type="search" value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setCursors([]); }}/></label>
        <label>Company role<select value={role} onChange={event => { setRole(event.target.value); setCursors([]); }}><option value="">All roles</option>{["owner", "manager", "staff", "resident"].map(value => <option key={value} value={value}>{roleLabel(value)}</option>)}</select></label>
      </div>
      {resource.error && <p className="notice error" role="alert">{resource.error} <button className="secondary" onClick={resource.reload}>Retry user list</button></p>}
      {!resource.data && !resource.error && <p role="status">Loading users…</p>}
      {resource.data && <>
        {resource.data.items.length ? <div className="table-wrap"><table><thead><tr><th scope="col">User</th><th scope="col">Company</th><th scope="col">Role</th><th scope="col">Account state</th><th scope="col">Action</th></tr></thead><tbody>{resource.data.items.map(person => <tr key={person.id}><td><strong>{person.name || person.email}</strong><br/><span className="help">{person.email}</span></td><td>{person.membership?.company.name || "No company assigned"}</td><td>{impersonationRole(person)}</td><td>{person.status === "disabled" ? "Disabled account" : person.status === "active" ? "Active account" : "Account state unavailable"}{person.emailVerified === false && <span className="cell-detail">Email not verified</span>}{person.membership?.status === "disabled" && <span className="cell-detail">Company membership disabled</span>}{person.membership?.company.status && person.membership.company.status !== "active" && <span className="cell-detail">Company {person.membership.company.status}</span>}</td><td><button className="secondary" disabled={readOnly} onClick={() => { setSelected(person); setReason(""); setError(""); setUncertain(false); }}>View as {person.name || person.email}</button></td></tr>)}</tbody></table></div> : <p role="status">No users match these filters.</p>}
        <div className="actions"><button className="secondary" disabled={!cursors.length} onClick={() => setCursors(previous => previous.slice(0, -1))}>Previous users</button><button className="secondary" disabled={!resource.data.nextCursor} onClick={() => setCursors(previous => [...previous, resource.data!.nextCursor!])}>Next users</button></div>
      </>}
    </section>
    <EditorDialog open={!!selected} title="Start impersonation" onClose={() => setSelected(null)} busy={busy} draftable={false}>
      {selected && <form onSubmit={start}>
        <p>You will view <strong>{selected.name || selected.email}</strong> as {impersonationRole(selected)}{selected.membership && <> at <strong>{selected.membership.company.name}</strong></>}.</p>
        <p className="help">The user's existing property and resident access applies. You can explore available features; saving, sending and other changes are disabled.</p>
        <label>Support case or testing reason<textarea required maxLength={200} value={reason} onChange={event => setReason(event.target.value)} disabled={busy || uncertain}/></label>
        <p className="help">Required for the activity record. Use a case reference or brief test description; keep private information out.</p>
        {error && <p className="notice error" role="alert">{error}</p>}
        {uncertain ? <p>The session may already have started. <button type="button" onClick={() => window.location.reload()}>Reload session</button></p> : <button type="submit" disabled={busy || !reason.trim()}>{busy ? "Starting…" : "Start read-only session"}</button>}
      </form>}
    </EditorDialog>
    {can("platform.manage") && <SupportAccess/>}
  </>;
}

function SupportAccess() {
  const { data: auth } = useAuth();
  const readOnly = !!auth?.impersonation;
  const [params, setParams] = useSearchParams();
  const supportUserId = params.get("supportUserId") || "";
  const [query, setQuery] = useState(""), [cursors, setCursors] = useState<string[]>([]);
  const search = useDebouncedValue(query.trim(), 250);
  const queryParams = new URLSearchParams({ q: search, ...(supportUserId ? { userId: supportUserId } : {}), ...(cursors.length ? { cursor: cursors[cursors.length - 1] } : {}) });
  const resource = useResource<Directory<SupportUser>>(`/api/platform/support-access?${queryParams}`, true, true);
  const [selected, setSelected] = useState<SupportUser | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState("");
  async function save() {
    if (!selected || busy || readOnly) return;
    setBusy(true); setError(""); setSaved("");
    try {
      const enabled = selected.platformRole !== "support";
      await monitorOperation("impersonation.support.update", () => api(`/api/platform/users/${encodeURIComponent(selected.id)}/support-access`, {
        method: "PATCH", body: { enabled, updatedAt: selected.updatedAt },
      }));
      setSaved(enabled ? "Support access granted." : "Support access revoked. Active support sessions have ended.");
      setSelected(null); resource.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Support access could not be changed.");
      resource.reload();
    } finally { setBusy(false); }
  }
  return <section className="panel" aria-labelledby="support-access-title">
    <h2 id="support-access-title">Support access</h2>
    {supportUserId && <p className="notice">Reviewing the linked account’s separate platform support grant. Company ownership does not grant this permission. <button type="button" className="text-button" onClick={() => { const next = new URLSearchParams(params); next.delete("supportUserId"); setParams(next); setCursors([]); }}>Show all support accounts</button></p>}
    <p>Grant trusted support staff permission to start read-only sessions across companies. This platform permission is separate from their company role. Only platform owners can grant or revoke it.</p>
    <label>Find a support account<input type="search" value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setCursors([]); }}/></label>
    {saved && <p className="notice" role="status">{saved}</p>}
    {resource.error && <p className="notice error" role="alert">{resource.error} <button className="secondary" onClick={resource.reload}>Retry support list</button></p>}
    {!resource.data && !resource.error && <p role="status">Loading support accounts…</p>}
    {resource.data && <>
      {resource.data.items.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Account</th><th scope="col">Access</th><th scope="col">Action</th></tr></thead><tbody>{resource.data.items.map(person => {
        const eligible = person.status === "active" && person.emailVerified && person.hasIdentity;
        return <tr key={person.id}><td><strong>{person.name || person.email}</strong><br/><span className="help">{person.email}</span></td><td>{person.platformRole === "owner" ? "Platform owner" : person.platformRole === "support" ? "Support enabled" : "No support access"}{!eligible && person.platformRole !== "support" && <p className="help">Requires an active, verified sign-in account.</p>}</td><td>{person.platformRole !== "owner" && <button className="secondary" disabled={readOnly || person.platformRole !== "support" && !eligible} onClick={() => { setSelected(person); setError(""); }}>{person.platformRole === "support" ? "Revoke" : "Grant"} support access for {person.name || person.email}</button>}</td></tr>;
      })}</tbody></table></div> : <p role="status">No support accounts match this search.</p>}
      <div className="actions"><button className="secondary" disabled={!cursors.length} onClick={() => setCursors(previous => previous.slice(0, -1))}>Previous support accounts</button><button className="secondary" disabled={!resource.data.nextCursor} onClick={() => setCursors(previous => [...previous, resource.data!.nextCursor!])}>Next support accounts</button></div>
    </>}
    <EditorDialog open={!!selected} title={selected?.platformRole === "support" ? "Revoke support access" : "Grant support access"} onClose={() => setSelected(null)} busy={busy} draftable={false}>
      <p>{selected?.platformRole === "support" ? "End active impersonation sessions and prevent new sessions for" : "Allow read-only impersonation of company users across the platform for"} <strong>{selected?.name || selected?.email}</strong>.</p>
      {error && <p className="notice error" role="alert">{error} Close and reopen this review to load the latest account before retrying.</p>}
      <button disabled={readOnly || busy || !!error} onClick={() => void save()}>{busy ? "Saving…" : selected?.platformRole === "support" ? "Confirm revoke" : "Confirm grant"}</button>
    </EditorDialog>
  </section>;
}
