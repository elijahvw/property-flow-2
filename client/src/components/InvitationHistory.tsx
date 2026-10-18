import { useEffect, useState } from "react";
import { api } from "../api";
import { formatDate } from "../dates";
import { useResource } from "../useResource";
import { useDebouncedValue } from "../useDebouncedValue";
import { EditorDialog } from "./EditorDialog";
import { InvitationDelivery, invitationDeliveryLabel, type InvitationResult } from "./InvitationDelivery";

type Row = InvitationResult & { email: string; role: string; participantRole?: string | null; acceptedAt: string | null; revokedAt: string | null; company?: { name: string } };
export function InvitationHistory({ platform = false, audience }: { platform?: boolean; audience?: "team" | "tenants" }) {
  const [query, setQuery] = useState(""), [status, setStatus] = useState(""), [page, setPage] = useState(1), [selected, setSelected] = useState<Row | null>(null), [error, setError] = useState("");
  const search = useDebouncedValue(query, 250);
  const params = new URLSearchParams({ page: String(page), ...(audience ? { audience } : {}), ...(search ? { q: search } : {}), ...(status ? { status } : {}) });
  const r = useResource<{ items: Row[]; total: number; pageSize: number } | Row[]>(`/api/invitations?${params}`, false, true);
  const items = Array.isArray(r.data) ? r.data : r.data?.items;
  const rows = items?.filter(row => !audience || (audience === "team" ? row.role !== "resident" : row.role === "resident"));
  const total = Array.isArray(r.data) ? rows?.length || 0 : r.data?.total || 0;
  useEffect(()=>{if(r.data&&!Array.isArray(r.data)){const last=Math.max(1,Math.ceil(r.data.total/25));if(page>last)setPage(last);}},[r.data,page]);
  return <section className="panel">
    <h2>{platform ? "Platform invitations" : audience === "team" ? "Team invitations" : audience === "tenants" ? "Tenant invitations" : "Invitations"}</h2>
    <div className="filters"><label>Find invitation<input type="search" value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label><label>Invitation status<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="expired">Expired</option><option value="revoked">Revoked</option></select></label></div>
    {error && <p role="alert" className="notice error">{error}</p>}
    {r.error ? <p role="alert">{r.error} <button onClick={r.reload}>Reload invitations</button></p> : !rows ? <p role="status">Loading invitations…</p> : !rows.length ? <p>{query || status ? "No invitations match these filters." : "No invitations yet."}</p> : <><p className="help">{total} matching invitations</p><ul className="record-list">{rows.map(row => {
      const label = row.acceptedAt ? "Accepted" : row.revokedAt ? "Revoked" : Date.parse(row.expiresAt) <= Date.now() ? "Expired" : "Pending";
      return <li key={row.id}><div><strong>{row.email}</strong><p>{row.participantRole || row.role}{platform && row.company ? ` · ${row.company.name}` : ""} · Expires {formatDate(row.expiresAt)}</p><span className="help">{invitationDeliveryLabel(row)}</span></div><span className="badge">{label}</span>{!row.acceptedAt && !row.revokedAt && <div className="actions"><button className="secondary" onClick={() => setSelected(row)}>Send or replace</button><button className="text-button" onClick={async () => { setError(""); try { await api(`/api/invitations/${encodeURIComponent(row.id)}/revoke`, { method: "POST", body: { expectedVersion: row.version } }); r.reload(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to revoke this invitation."); } }}>Revoke</button></div>}</li>;
    })}</ul><nav className="actions" aria-label="Invitation pages"><button className="secondary" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous invitations</button><span>Page {page}</span><button className="secondary" disabled={page * 25 >= total} onClick={() => setPage(value => value + 1)}>Next invitations</button></nav></>}
    {selected && <EditorDialog open title={`Invitation for ${selected.email}`} onClose={() => { setSelected(null); r.reload(); }}><InvitationDelivery key={selected.id} initial={selected} changed={r.reload} done={() => { setSelected(null); r.reload(); }} /></EditorDialog>}
  </section>;
}
