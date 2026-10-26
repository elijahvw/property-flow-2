import { documentAvailable, documentStatusLabel } from "../document-status";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { formatActivityTime, formatDate } from "../dates";
import { Form } from "./Form";
import { EditorDialog } from "./EditorDialog";
import "./LeaseDocumentSharing.css";

type Recipient = { id: string; name: string | null; email: string };
type Original = { id: string; number: number; filename: string; scanStatus: string; byteLength: number };
type Share = { id: string; documentVersionId: string; userId: string; version: number; expiresOn: string; reason: string; revokedAt: string | null; receivedAt: string | null; createdAt: string; recipient: Recipient | null; versionNumber: number | null; filename: string | null; status: string };
type Context = { document: { id: string; title: string; version: number; archivedAt: string | null }; today: string; versions: Original[]; eligibleResidents: Recipient[]; items: Share[]; total: number; nextCursor: string | null };
type Review = { kind: "grant" | "revoke"; key: string; original: Original; recipient: Recipient; share: Share | null; expectedDocumentVersion: number };
const label = (value: string) => ({ active: "Shared", expired: "Expired", revoked: "Revoked", unavailable: "Access unavailable" } as Record<string, string>)[value] || value;

export function LeaseDocumentSharing({ leaseId, documentId, sourceVersion }: { leaseId: string; documentId: string; sourceVersion: number }) {
  const [visited, setVisited] = useState(false);
  return <details className="document-sharing" onToggle={event => { if (event.currentTarget.open) setVisited(true); }}>
    <summary>Leaseholder sharing &amp; access history</summary>
    {visited && <SharingPanel leaseId={leaseId} documentId={documentId} sourceVersion={sourceVersion}/>}
  </details>;
}
function SharingPanel({ leaseId, documentId, sourceVersion }: { leaseId: string; documentId: string; sourceVersion: number }) {
  const { can } = useAuth(), owner = can("company.manage");
  const base = `/api/company/leases/${encodeURIComponent(leaseId)}/documents/${encodeURIComponent(documentId)}/shares`;
  const [cursors, setCursors] = useState<string[]>([]), [open, setOpen] = useState(false), [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [review, setReview] = useState<Review | null>(null), [historyId, setHistoryId] = useState("");
  const resource = useResource<Context>(`${base}${cursors.length ? `?cursor=${encodeURIComponent(cursors[cursors.length - 1])}` : ""}`, true);
  useEffect(() => { resource.reload(); }, [sourceVersion]);
  if (!resource.data) return resource.error ? <p className="notice error" role="alert">{resource.error} <button onClick={resource.reload}>Reload sharing</button></p> : <p role="status">Loading document access…</p>;
  const context = resource.data;
  const reset = () => { setOpen(false); setChoosing(false); setReview(null); setError(""); };
  async function prepare(form: FormData) {
    const documentVersionId = String(form.get("original") || ""), userId = String(form.get("recipient") || "");
    const original = context.versions.find(row => row.id === documentVersionId), recipient = context.eligibleResidents.find(row => row.id === userId);
    if (!original || !recipient || busy) return;
    setBusy(true); setError("");
    try {
      const latest = await api<Context>(`${base}?${new URLSearchParams({ documentVersionId, userId })}`);
      const exact = latest.versions.find(row => row.id === documentVersionId), eligible = latest.eligibleResidents.find(row => row.id === userId);
      if (!exact || !documentAvailable(exact.scanStatus) || !eligible || latest.document.archivedAt) throw new Error("The selected original or leaseholder access changed. Reload sharing and review again.");
      setReview({ kind: "grant", key: crypto.randomUUID(), original: exact, recipient: eligible, share: latest.items[0] || null, expectedDocumentVersion: latest.document.version });
      setChoosing(false); setOpen(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Sharing could not be prepared."); }
    finally { setBusy(false); }
  }
  function revoke(share: Share) {
    const original = context.versions.find(row => row.id === share.documentVersionId);
    if (!original) return;
    setReview({ kind: "revoke", key: crypto.randomUUID(), original, recipient: share.recipient || { id: share.userId, name: "Former or unavailable account", email: "" }, share, expectedDocumentVersion: context.document.version });
    setOpen(true);
  }
  return <div className="document-sharing-content">
    <div className="section-heading"><div><h4>Who can download this original?</h4><p className="help">Only explicitly selected, approved leaseholders receive access. A shared version stays fixed when a newer file is uploaded.</p></div>{owner && <button className="secondary" disabled={!!review || !!context.document.archivedAt || !context.eligibleResidents.length || !context.versions.some(row => documentAvailable(row.scanStatus))} onClick={() => { setChoosing(true); setOpen(true); setError(""); }}>Share a document version</button>}</div>
    {context.document.archivedAt && <p className="notice">Archiving revoked resident access. After restoration, the company owner can review new grants.</p>}
    {!context.document.archivedAt && !context.eligibleResidents.length && <p className="help">No verified leaseholders currently have approved account and property access on this active or upcoming lease.</p>}
    {!owner && <p className="help">Company owners grant or revoke access. Managers can review sharing and retained history.</p>}
    {resource.error && <p className="notice error" role="alert">{resource.error} <button onClick={resource.reload}>Reload sharing</button></p>}
    {review && !open && <p className="notice">A document access review is retained for this page. <button className="secondary" onClick={() => setOpen(true)}>Continue access review</button></p>}
    <p>{context.total} access records</p>
    {context.items.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Leaseholder</th><th scope="col">Original</th><th scope="col">Access and receipt</th><th scope="col">Through</th><th scope="col">Actions</th></tr></thead><tbody>{context.items.map(share => <tr key={share.id}><td>{share.recipient?.name || share.recipient?.email || "Former or unavailable account"}{share.recipient?.email && <p className="help">{share.recipient.email}</p>}</td><td>Version {share.versionNumber} · {share.filename}</td><td>{label(share.status)}<p className="help">{share.receivedAt ? `Receipt confirmed ${formatActivityTime(share.receivedAt)}` : "Receipt not confirmed for this grant"}</p></td><td>{formatDate(share.expiresOn)}</td><td><div className="actions">{owner && !share.revokedAt && <button className="secondary" disabled={!!review} onClick={() => revoke(share)}>Revoke access</button>}<button className="link-button" onClick={() => setHistoryId(previous => previous === share.id ? "" : share.id)}>Access history</button></div>{historyId === share.id && <ShareHistory endpoint={`${base}/${encodeURIComponent(share.id)}/history`}/>}</td></tr>)}</tbody></table></div> : <p>No versions of this document have been shared.</p>}
    <p className="help">Receipt confirmation records that the leaseholder received this grant's original. It is not a signature or approval. Earlier confirmations remain in access history after a new owner review.</p>
    <div className="actions"><button className="secondary" disabled={!cursors.length} onClick={() => setCursors(previous => previous.slice(0, -1))}>Previous access records</button><button className="secondary" disabled={!context.nextCursor} onClick={() => setCursors(previous => [...previous, context.nextCursor!])}>Next access records</button></div>
    <EditorDialog open={open} title={review?.kind === "revoke" ? "Revoke document access" : "Share a lease document"} onClose={() => setOpen(false)} onDiscard={reset} onSaveDraft={() => setOpen(false)} busy={busy}>
      {choosing && !review ? <form className="workflow-form" onSubmit={event => { event.preventDefault(); void prepare(new FormData(event.currentTarget)); }}>
        <fieldset><legend>Choose the original</legend><label>Document version<select name="original" required defaultValue=""><option value="" disabled>Choose an available original</option>{context.versions.filter(row => documentAvailable(row.scanStatus)).map(row => <option key={row.id} value={row.id}>Version {row.number} · {row.filename} · {documentStatusLabel(row.scanStatus)}</option>)}</select></label></fieldset>
        <fieldset><legend>Choose the leaseholder</legend><label>Approved leaseholder<select name="recipient" required defaultValue=""><option value="" disabled>Choose a leaseholder</option>{context.eligibleResidents.map(row => <option key={row.id} value={row.id}>{row.name || row.email} · {row.email}</option>)}</select></label><p className="help">Account, property and household access are checked again before sharing.</p></fieldset>
        {error && <p className="notice error" role="alert">{error}</p>}<div className="actions"><button type="submit" disabled={busy}>{busy ? "Loading review…" : "Review selected access"}</button></div>
      </form> : review && <Form key={review.key} operation={review.kind === "grant" ? "document.share" : "document.revoke"} label={review.kind === "grant" ? "Confirm document sharing" : "Confirm revocation"} feedbackText={review.kind === "grant" ? "Document access saved." : "Document access revoked."} secondaryActions={<button className="secondary" type="button" onClick={() => { reset(); resource.reload(); }}>Discard review &amp; reload</button>} submit={async form => {
        await api(review.kind === "grant" ? base : `${base}/${encodeURIComponent(review.share!.id)}/revoke`, { method: "POST", body: review.kind === "grant" ? { documentVersionId: review.original.id, userId: review.recipient.id, expiresOn: String(form.get("expiresOn") || ""), reason: String(form.get("reason") || ""), expectedVersion: review.share?.version ?? null, expectedDocumentVersion: review.expectedDocumentVersion, submissionKey: review.key } : { expectedVersion: review.share!.version, reason: String(form.get("reason") || ""), submissionKey: review.key } });
        reset(); resource.reload();
      }}>
        <fieldset><legend>Reviewed original and recipient</legend><dl className="sharing-review-facts"><div><dt>Document</dt><dd>{context.document.title}</dd></div><div><dt>Exact original</dt><dd>Version {review.original.number} · {review.original.filename}<span className="help"> · {documentStatusLabel(review.original.scanStatus)}</span></dd></div><div><dt>Leaseholder</dt><dd>{review.recipient.name || review.recipient.email}{review.recipient.email && <span className="help"> · {review.recipient.email}</span>}</dd></div></dl></fieldset>
        <fieldset><legend>{review.kind === "grant" ? "Access duration and reason" : "Revocation reason"}</legend>{review.kind === "grant" && <><label>Access through (company calendar date)<input name="expiresOn" type="date" required min={context.today} defaultValue={review.share?.expiresOn || ""}/></label><p className="help">Access ends earlier if leaseholder approval, lease access or the shared source becomes unavailable.</p></>}<label>{review.kind === "grant" ? "Sharing reason" : "Reason for revocation"}<textarea name="reason" required maxLength={500}/></label></fieldset>
        {review.kind === "revoke" && <p className="help">Revocation blocks future downloads. Files already downloaded remain with their recipient.</p>}
      </Form>}
    </EditorDialog>
  </div>;
}
function ShareHistory({ endpoint }: { endpoint: string }) {
  const [cursors, setCursors] = useState<string[]>([]);
  const resource = useResource<{ items: { id: string; action: string; createdAt: string; detail: { reason?: string; expiresOn?: string } }[]; nextCursor: string | null }>(`${endpoint}${cursors.length ? `?cursor=${encodeURIComponent(cursors[cursors.length - 1])}` : ""}`);
  if (!resource.data) return resource.error ? <p role="alert">{resource.error} <button onClick={resource.reload}>Retry history</button></p> : <p role="status">Loading access history…</p>;
  return <div className="sharing-history"><ol>{resource.data.items.map(event => <li key={event.id}><strong>{({ grant: "Access granted", revoke: "Access revoked", source_archived: "Revoked by document archival", received: "Receipt confirmed", downloaded: "Original downloaded" } as Record<string, string>)[event.action] || event.action}</strong> · {formatActivityTime(event.createdAt)}{event.detail.reason && <p>{event.detail.reason}</p>}{event.detail.expiresOn && <p>Access through {formatDate(event.detail.expiresOn)}</p>}</li>)}</ol><div className="actions"><button className="secondary" disabled={!cursors.length} onClick={() => setCursors(previous => previous.slice(0, -1))}>Previous history</button><button className="secondary" disabled={!resource.data.nextCursor} onClick={() => setCursors(previous => [...previous, resource.data!.nextCursor!])}>Next history</button></div></div>;
}
