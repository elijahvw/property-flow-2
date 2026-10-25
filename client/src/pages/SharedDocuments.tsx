import { documentStatusLabel } from "../document-status";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth, type Bootstrap } from "../context/AuthContext";
import { useResource } from "../useResource";
import { useDebouncedValue } from "../useDebouncedValue";
import { formatActivityTime, formatDate } from "../dates";
import { monitorOperation } from "../operations";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "../components/Form";
import "../components/LeaseDocumentSharing.css";

type SharedOriginal = { id: string; version: number; receivedAt: string | null; sharedAt: string; title: string; versionNumber: number; filename: string; mediaType: string; byteLength: number; scanStatus: string; expiresOn: string; lease: { id: string; property: { name: string }; unit: { label: string } } };
type ReceiptAttempt = { shareId: string; expectedVersion: number; submissionKey: string; companyId: string };
type ReceiptResult = { id: string; version: number; receivedAt: string | null; receipt: { id: string; recordedAt: string } };
const scope = (auth: Bootstrap | null) => JSON.stringify([auth?.user.id, auth?.user.status, auth?.user.emailVerified, auth?.membership?.companyId, auth?.membership?.version, auth?.membership?.role, auth?.membership?.status, auth?.membership?.company.status, auth?.permissions, auth?.impersonation?.contextId]);
const readDenied = (error: unknown) => error instanceof ApiError && ([401, 404].includes(error.status) || error.status === 403 && ["ACCESS_DENIED", "COMPANY_ACCESS_DENIED", "FEATURE_DISABLED", "IMPERSONATION_UNAVAILABLE", "EMAIL_VERIFICATION_REQUIRED"].includes(error.code));

export function SharedDocuments() {
  const { data } = useAuth();
  return <Documents key={scope(data)}/>;
}
function Documents() {
  const { data: auth } = useAuth(), companyId = auth?.membership?.companyId;
  const [params, setParams] = useSearchParams(), search = params.get("q") || "", cursor = params.get("cursor") || "";
  const q = useDebouncedValue(search.trim(), 250), query = new URLSearchParams({ ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) });
  const [cursors, setCursors] = useState<string[]>([]), [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const resource = useResource<{ companyId: string; items: SharedOriginal[]; total: number; nextCursor: string | null }>(`/api/resident/documents${query.size ? `?${query}` : ""}`, false, true);
  const current = resource.data?.companyId === companyId ? resource.data : undefined;
  const unavailable = [401, 403, 404].includes(resource.errorStatus || 0) || !!resource.data && !current;
  const change = (nextSearch: string, nextCursor = "", history: string[] = []) => {
    setCursors(history);
    setParams({ ...(nextSearch ? { q: nextSearch } : {}), ...(nextCursor ? { cursor: nextCursor } : {}) }, { replace: true });
  };
  async function download(original: SharedOriginal) {
    if (busy || !current || !companyId) return;
    setBusy(original.id); setError(""); setNotice("");
    try {
      await monitorOperation("document.shared.download", async () => {
        const result = await api<{ filename: string; mediaType: string; contentBase64: string }>(`/api/resident/documents/${encodeURIComponent(original.id)}/download`, { timeoutMs: 45000, expectedCompanyId: companyId });
        if (!alive.current) return;
        const bytes = Uint8Array.from(atob(result.contentBase64), character => character.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: result.mediaType })), link = document.createElement("a");
        link.href = url; link.download = result.filename; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      if (alive.current) setNotice(`Download prepared: ${original.filename}.`);
    } catch (failure) {
      if (alive.current) { setError(failure instanceof Error ? failure.message : "The shared original could not be downloaded. Check your current access and retry."); resource.reload(); }
    } finally { if (alive.current) setBusy(""); }
  }
  return <>
    <header className="page-heading"><p className="eyebrow">Your rental</p><h1>Shared documents</h1><p>Exact originals your company owner has shared with you as an approved leaseholder.</p></header>
    <p className="help">Access is checked for each download and receipt confirmation. It can end through expiry, revocation or changes to your lease access. New uploads remain private until the owner shares that specific version.</p>
    <p><Link to="/resident">← My rental</Link></p>
    <section className="panel shared-document-search" aria-label="Find shared documents"><label>Search shared documents<input type="search" maxLength={160} value={search} onChange={event => change(event.target.value)} placeholder="Document title, property or unit"/></label>{search && <button className="secondary" onClick={() => change("")}>Clear document search</button>}</section>
    {search.trim() !== q && <p role="status" className="help">Updating document search…</p>}
    {!unavailable && error && <p role="alert" className="notice error">{error}</p>}{!unavailable && notice && <p role="status" className="notice">{notice}</p>}
    {resource.error && <p role="alert" className="notice error">{resource.error} <button onClick={resource.reload}>Retry shared documents</button></p>}
    {resource.data && !current && <p role="alert" className="notice error">Your company context changed. Reload the workspace before continuing.</p>}
    {!resource.data && !resource.error && <p role="status">Loading shared documents…</p>}
    {current && <><p role="status">{current.total} shared originals currently available{q ? " for this search" : ""}</p>
      {current.items.length ? <div className="shared-document-grid">{current.items.map(original => <SharedDocument key={original.id} original={original} companyId={companyId!} busy={!!busy} download={() => void download(original)} downloading={busy === original.id} changed={resource.reload} notify={setNotice}/>)}</div> : <section className="panel"><h2>{q ? "No matching shared documents" : "No shared documents available"}</h2><p>{q ? "Try another document title, property or unit." : "Your owner can share an available original when your leaseholder account and property access are approved."}</p></section>}
      <nav className="actions" aria-label="Shared document pages"><button className="secondary" disabled={!cursor} onClick={() => { const previous = cursors.at(-1) || ""; change(search, previous, cursors.slice(0, -1)); }}>{cursors.length ? "Previous documents" : "First documents"}</button><button className="secondary" disabled={!current.nextCursor} onClick={() => change(search, current.nextCursor!, [...cursors, cursor])}>Next documents</button></nav>
    </>}
  </>;
}

function readAttempt(key: string, shareId: string, companyId: string): ReceiptAttempt | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null") as ReceiptAttempt | null;
    return value?.shareId === shareId && value.companyId === companyId && Number.isSafeInteger(value.expectedVersion) && value.expectedVersion > 0 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.submissionKey) ? value : null;
  } catch { return null; }
}
function SharedDocument({ original, companyId, busy, downloading, download, changed, notify }: { original: SharedOriginal; companyId: string; busy: boolean; downloading: boolean; download: () => void; changed: () => void; notify: (message: string) => void }) {
  const { data: auth } = useAuth(), storageKey = `pf:document-receipt:${auth?.user.id}:${companyId}:${original.id}`;
  const [attempt, setAttempt] = useState(() => readAttempt(storageKey, original.id, companyId)), [review, setReview] = useState<ReceiptAttempt | null>(null), [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Pick<SharedOriginal, "version" | "receivedAt"> | null>(null), [sending, setSending] = useState(false), [denied, setDenied] = useState(false);
  const [checked, setChecked] = useState<SharedOriginal | null>(null), [checking, setChecking] = useState(false), [checkError, setCheckError] = useState(""), [acceptCurrent, setAcceptCurrent] = useState(false);
  const alive = useRef(true), openingScope = useRef(scope(auth)), latestScope = useRef(scope(auth)); latestScope.current = scope(auth);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const currentContext = () => alive.current && openingScope.current === latestScope.current && auth?.membership?.companyId === companyId;
  const current = saved && saved.version >= original.version ? { ...original, ...saved } : original;
  const readOnly = !!auth?.impersonation || [auth?.companyFeatures?.documents, auth?.companyFeatures?.leasing, auth?.companyFeatures?.resident_portal].some(mode => mode === "read_only" || mode === "disabled");
  const endpoint = `/api/resident/documents/${encodeURIComponent(original.id)}`;
  const begin = () => { setReview(attempt || { shareId: original.id, expectedVersion: current.version, submissionKey: crypto.randomUUID(), companyId }); setOpen(true); setChecked(null); setAcceptCurrent(false); setCheckError(""); notify(""); };
  if (denied) return <p className="notice error" role="alert">Shared-document access is unavailable. Private details are hidden; any interrupted receipt confirmation is kept.</p>;
  return <article className="shared-document-card">
    <h2>{original.title}</h2><p className="help">{documentStatusLabel(original.scanStatus)}</p><p>{original.lease.property.name} · {original.lease.unit.label}</p>
    <dl><div><dt>Original</dt><dd>Version {original.versionNumber} · {original.filename}</dd></div><div><dt>Size</dt><dd>{Math.max(1, Math.ceil(original.byteLength / 1024))} KB</dd></div><div><dt>First shared</dt><dd>{formatActivityTime(original.sharedAt)}</dd></div><div><dt>Access through</dt><dd>{formatDate(original.expiresOn)} · Company calendar</dd></div></dl>
    <div className="actions"><button disabled={busy || sending} onClick={download}>{downloading ? "Preparing download…" : `Download version ${original.versionNumber}`}</button>{(!current.receivedAt || attempt) && <button className="secondary" disabled={busy || sending || readOnly && !attempt} onClick={begin}>{attempt ? readOnly ? "Review interrupted confirmation" : "Retry original confirmation" : "Confirm received"}</button>}</div>
    {current.receivedAt && <p role="status" className="notice">Receipt confirmed {formatActivityTime(current.receivedAt)}</p>}
    {attempt && <p className="help">An interrupted receipt confirmation is kept with its original request. It does not confirm a later owner-reviewed grant.</p>}
    {readOnly && <p className="help">Receipt confirmation is read-only under the current workspace settings. Existing confirmations and interrupted requests are retained.</p>}
    <p className="help">This confirms receipt only. It does not sign or approve the document.</p>
    <EditorDialog open={open} title="Confirm document receipt" busy={sending || checking} onClose={() => { setOpen(false); if (!attempt) setReview(null); }}>
      {review && <><fieldset disabled={readOnly}><Form key={review.submissionKey} operation="document.shared.received" label={attempt ? "Retry original confirmation" : "Confirm received"} recovering={!!attempt} feedbackText="Document receipt recorded. This is not a signature." submit={async () => {
        if (readOnly || !currentContext()) throw new Error("Reload the current workspace before confirming this document receipt.");
        const payload = attempt || review, wasRecovering = !!attempt;
        setSending(true);
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(payload)); setAttempt(payload);
          const result = await api<ReceiptResult>(`${endpoint}/received`, { method: "POST", expectedCompanyId: payload.companyId, body: { expectedVersion: payload.expectedVersion, submissionKey: payload.submissionKey } });
          if (!currentContext() || result.id !== payload.shareId) {
            if (alive.current) { setDenied(true); changed(); }
            throw new ApiError("The workspace changed before the result was acknowledged. The original receipt confirmation is kept.", 409, "DOCUMENT_CONTEXT_CHANGED", true);
          }
          sessionStorage.removeItem(storageKey); setAttempt(null); setReview(null); setOpen(false); setSaved({ version: result.version, receivedAt: result.receivedAt });
          notify(result.receivedAt ? "Receipt confirmed for this access grant. This is not a signature." : "Your earlier receipt was recorded. The current owner-reviewed access grant has not been confirmed."); changed();
        } catch (error) {
          if (!wasRecovering && error instanceof ApiError && !error.submissionUncertain && !["IMPERSONATION_CONTEXT_CHANGED", "SUBMISSION_MISMATCH", "DOCUMENT_CONTEXT_CHANGED"].includes(error.code) && [400, 401, 403, 404, 409].includes(error.status)) { sessionStorage.removeItem(storageKey); setAttempt(null); }
          if (error instanceof ApiError && ["IMPERSONATION_CONTEXT_CHANGED", "SUBMISSION_MISMATCH", "DOCUMENT_CONTEXT_CHANGED"].includes(error.code)) error.submissionUncertain = true;
          if (readDenied(error)) { setDenied(true); changed(); }
          throw error;
        } finally { if (alive.current) setSending(false); }
      }}>
        <dl className="sharing-review-facts"><div><dt>Document</dt><dd>{original.title}</dd></div><div><dt>Exact original</dt><dd>Version {original.versionNumber} · {original.filename}</dd></div></dl><p>Confirm that you received this exact shared version. This records a receipt only; it does not sign, approve or change your lease.</p>
      </Form></fieldset>
      {attempt && <section className="document-receipt-recovery" aria-label="Review current receipt status"><h3>Review current receipt status</h3><p className="help">A fresh read makes no changes. It does not prove which request recorded a receipt.</p><button className="secondary" disabled={sending || checking} onClick={async () => {
        setChecking(true); setCheckError(""); setChecked(null); setAcceptCurrent(false);
        try {
          if (!currentContext()) throw new Error("Reload the workspace before reviewing this document.");
          const result = await api<{ companyId: string; document: SharedOriginal }>(endpoint, { expectedCompanyId: companyId });
          if (!currentContext()) return;
          if (result.companyId !== companyId || result.document.id !== original.id) { setDenied(true); changed(); throw new Error("This document context changed. Reload the workspace."); }
          setChecked(result.document);
        } catch (error) { if (alive.current) { setCheckError(error instanceof Error ? error.message : "Receipt status is unavailable."); if (readDenied(error)) { setDenied(true); changed(); } } }
        finally { if (alive.current) setChecking(false); }
      }}>{checking ? "Checking current status…" : "Check current receipt status"}</button>{checkError && <p role="alert" className="notice error">{checkError}</p>}
      {checked && <><p>{checked.receivedAt ? `Current receipt confirmed ${formatActivityTime(checked.receivedAt)}.` : "No receipt is confirmed for the current access grant."} Current saved version {checked.version}; original reviewed version {attempt.expectedVersion}.</p><label className="checkbox-label"><input type="checkbox" checked={acceptCurrent} disabled={sending || checking} onChange={event => setAcceptCurrent(event.target.checked)}/>I reviewed the current status. Stop retrying my earlier confirmation and keep the saved record as it is.</label><button className="secondary" disabled={!acceptCurrent || sending || checking} onClick={() => {
        if (!acceptCurrent || !checked || !currentContext() || sending) return;
        sessionStorage.removeItem(storageKey); setAttempt(null); setReview(null); setOpen(false); setSaved({ version: checked.version, receivedAt: checked.receivedAt }); notify("Current status kept. This cleared only the local interrupted confirmation; receipt history was not changed."); changed();
      }}>Use current receipt status</button></>}
      </section>}</>}
    </EditorDialog>
  </article>;
}
