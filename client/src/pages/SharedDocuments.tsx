import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useResource } from "../useResource";
import { formatDate } from "../dates";
import { monitorOperation } from "../operations";
import "../components/LeaseDocumentSharing.css";

type SharedOriginal = { id: string; title: string; versionNumber: number; filename: string; mediaType: string; byteLength: number; expiresOn: string; lease: { id: string; property: { name: string }; unit: { label: string } } };
export function SharedDocuments() {
  const [cursors, setCursors] = useState<string[]>([]), [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const resource = useResource<{ items: SharedOriginal[]; total: number; nextCursor: string | null }>(`/api/resident/documents${cursors.length ? `?cursor=${encodeURIComponent(cursors[cursors.length - 1])}` : ""}`, false, true);
  async function download(original: SharedOriginal) {
    if (busy) return;
    setBusy(original.id); setError(""); setNotice("");
    try {
      await monitorOperation("document.shared.download", async () => {
        const result = await api<{ filename: string; mediaType: string; contentBase64: string }>(`/api/resident/documents/${encodeURIComponent(original.id)}/download`, { timeoutMs: 45000 });
        const bytes = Uint8Array.from(atob(result.contentBase64), character => character.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: result.mediaType })), link = document.createElement("a");
        link.href = url; link.download = result.filename; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      setNotice(`Download prepared: ${original.filename}.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The shared original could not be downloaded. Check your current access and retry."); resource.reload(); }
    finally { setBusy(""); }
  }
  return <>
    <header className="page-heading"><p className="eyebrow">Your rental</p><h1>Shared documents</h1><p>Exact originals your company owner has shared with you as an approved leaseholder.</p></header>
    <p className="help">Access is checked for each download and can end through expiry, revocation or changes to your lease access. Newer uploads appear only after the owner shares that specific version.</p>
    <p><Link to="/resident">← My rental</Link></p>
    {error && <p role="alert" className="notice error">{error}</p>}{notice && <p role="status" className="notice">{notice}</p>}
    {resource.error && <p role="alert" className="notice error">{resource.error} <button onClick={resource.reload}>Retry shared documents</button></p>}
    {!resource.data && !resource.error && <p role="status">Loading shared documents…</p>}
    {resource.data && <><p>{resource.data.total} shared originals currently available</p>{resource.data.items.length ? <div className="shared-document-grid">{resource.data.items.map(original => <article key={original.id} className="shared-document-card"><h2>{original.title}</h2><p>{original.lease.property.name} · {original.lease.unit.label}</p><dl><div><dt>Original</dt><dd>Version {original.versionNumber} · {original.filename}</dd></div><div><dt>Size</dt><dd>{Math.ceil(original.byteLength / 1024)} KB</dd></div><div><dt>Access through</dt><dd>{formatDate(original.expiresOn)} · Company calendar</dd></div></dl><button disabled={!!busy} onClick={() => void download(original)}>{busy === original.id ? "Preparing download…" : `Download version ${original.versionNumber}`}</button></article>)}</div> : <section className="panel"><h2>No shared documents available</h2><p>Your owner can share a cleared original when your leaseholder account and property access are approved.</p></section>}<div className="actions"><button className="secondary" disabled={!cursors.length} onClick={() => setCursors(previous => previous.slice(0, -1))}>Previous documents</button><button className="secondary" disabled={!resource.data.nextCursor} onClick={() => setCursors(previous => [...previous, resource.data!.nextCursor!])}>Next documents</button></div></>}
  </>;
}
