import { useEffect, useState } from "react";
import { formatDate } from "../dates";
import { api, ApiError } from "../api";
import type { useAcquisitionMutation } from "../acquisition-mutations";

type Snapshot = { title: string; version: string; state: string; notes: string; details: Array<[string, string]>; leaseId?: string | null };
export function AcquisitionRecovery({ mutation, sourcePath, sourceId, resolved }: {
  mutation: ReturnType<typeof useAcquisitionMutation>; sourcePath: string; sourceId: string; resolved: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (mutation.conflict) setOpen(true); }, [mutation.conflict]);
  if (!mutation.pending) return null;
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="editor-section" aria-label="Review current acquisition source">
    <summary>Review the current source state instead of retrying</summary><p className="help">The original request stays locked. Review a fresh authorized source before deciding to stop retrying it. This does not identify who saved the current record.</p>
    <button type="button" className="secondary" disabled={busy || mutation.busy} onClick={async () => {
      setBusy(true); setError(""); setSnapshot(null); setConfirmed(false);
      try {
        if (!mutation.current()) throw new Error("Reload the workspace before reviewing this source.");
        const data = await api<Record<string, any>>(sourcePath, { expectedCompanyId: mutation.companyId });
        if (!mutation.current()) return;
        if (data.companyId && data.companyId !== mutation.companyId) { mutation.readDenied(); return; }
        const row = data.request || data.followUp || data.application || data.prospect || data.items?.[0];
        const id = row?.id || row?.unit?.id;
        if (id !== sourceId) throw new Error("The returned source differs from this request. Reload before continuing.");
        setSnapshot({ title: row.prospect?.name || row.name || row.title || row.unit?.label || "Current record", version: String(row.version ?? row.listing?.version ?? "Not recorded"), state: row.status || row.stage || `${row.state ? row.state + " · " : ""}${row.listing?.forRent ? "For rent" : "Not listed for rent"}`, notes: row.notes || row.availability?.reason || "None", details: Object.entries({ Email: row.email, Phone: row.phone, "Inquiry source": row.source, "Unit reference": row.unitId, "Desired move-in": row.desiredMoveIn?.slice(0, 10), "Follow-up type": row.kind, "Follow-up date": row.dueOn?.slice(0, 10), "Next follow-up": row.followUpOn?.slice(0, 10), "Linked lease reference": row.leaseId }).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([name, value]) => [name, String(value)] as [string, string]), leaseId: row.leaseId });
      } catch (e) {
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) mutation.readDenied();
        setError(e instanceof Error ? e.message : "The current source could not be reviewed.");
      } finally { setBusy(false); }
    }}>{busy ? "Reviewing current source…" : "Load current saved record"}</button>
    {error && <p className="notice error" role="alert">{error}</p>}
    {snapshot && <><dl className="lease-review-summary"><div><dt>Current source</dt><dd>{snapshot.title}</dd></div><div><dt>Saved version / state</dt><dd>{snapshot.version} · {snapshot.state.replace(/_/g, " ")}</dd></div>{snapshot.details.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{/^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : value}</dd></div>)}<div><dt>Current management notes</dt><dd className="preserve-lines">{snapshot.notes}</dd></div></dl><label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>I reviewed the current source and choose to stop retrying my earlier request.</label><p className="help">This clears only this browser's interrupted request. It changes no saved source, provider account, lease, access or money.</p><button type="button" className="secondary" disabled={!confirmed || busy || mutation.busy} onClick={() => { if (confirmed && mutation.useCurrent()) resolved(); }}>Keep current source and stop retrying</button></>}
  </details>;
}
