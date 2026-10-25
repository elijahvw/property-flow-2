import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useResource } from "../useResource";
import { useAuth } from "../context/AuthContext";
import { Form } from "../components/Form";
import { EditorDialog } from "../components/EditorDialog";
import { formatActivityTime } from "../dates";
import { downloadReport } from "../report-export";

type Source = { row: number; values: Record<string, string>; propertyId: string | null; label: string | null; property: { id: string; name: string; version: number } | null; existingUnitId?: string; issues: { column: string; message: string }[] };
type Batch = { id: string; status: string; version: number; fileName: string; createdAt: string; committedAt: string | null; cancelledAt: string | null; preview: { rowCount: number; validCount: number; errorCount: number; rows: Source[] }; result: null | { createdCount: number; items: { row: number; unitId: string; propertyId: string; label: string }[] }; actions: { id: string; action: string; createdAt: string; detail: { reason?: string; rowCount?: number; createdCount?: number } }[] };
type Summary = Pick<Batch, "id" | "status" | "fileName" | "createdAt"> & { rowCount: number; errorCount: number; createdCount: number | null };
const base = "/api/company/imports/units";
const columns = ["propertyId", "label", "bedrooms", "bathrooms", "squareFeet", "marketRent", "floor", "notes"];
function Load({ error, reload }: { error?: string; reload: () => void }) { return error ? <p role="alert" className="notice error">{error} <button className="secondary" onClick={reload}>Try again</button></p> : <p role="status">Loading unit imports…</p>; }
const statusName = (status: string) => ({ preview: "Preview", committed: "Imported", cancelled: "Cancelled" } as Record<string, string>)[status] || status;

export function UnitImports() {
  const { data } = useAuth();
  return <ImportWorkspace key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}`}/>;
}
function ImportWorkspace() {
  const [params, setParams] = useSearchParams(), selected = params.get("importId") || "";
  const [cursors, setCursors] = useState<string[]>([]), [open, setOpen] = useState(false);
  const [csv, setCsv] = useState(""), [fileName, setFileName] = useState("units.csv"), [key, setKey] = useState(() => crypto.randomUUID());
  const [fileError, setFileError] = useState(""), [reading, setReading] = useState(false);
  const directory = useResource<{ items: Summary[]; total: number; nextCursor: string | null }>(`${base}${cursors.length ? `?cursor=${encodeURIComponent(cursors[cursors.length - 1])}` : ""}`);
  const properties = useResource<{ id: string; name: string; address: string }[]>("/api/company/properties");
  const select = (id: string) => setParams(previous => { const next = new URLSearchParams(previous); if (id) next.set("importId", id); else next.delete("importId"); return next; });
  const reset = () => { setCsv(""); setFileName("units.csv"); setKey(crypto.randomUUID()); setOpen(false); setFileError(""); };
  async function choose(file?: File) {
    if (!file) return;
    if (file.size > 256 * 1024) { setFileError("Choose a CSV file of at most 256 KiB."); return; }
    setReading(true); setFileError("");
    try { const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); setCsv(text); setFileName(file.name.slice(0, 200)); }
    catch { setFileError("This file could not be read as UTF-8 CSV. Your previous input is preserved."); }
    finally { setReading(false); }
  }
  return <>
    <header className="page-heading"><p className="eyebrow">Inventory import</p><h1>Import units</h1><p>Preview a CSV against your existing properties, review every row, then create the units together.</p></header>
    <div className="actions"><button onClick={() => setOpen(true)}>New import preview</button><button className="secondary" onClick={() => downloadReport("unit-import-template.csv", [columns])}>Download blank CSV template</button></div>
    <details className="panel"><summary>CSV columns and property IDs</summary><p>Required columns: <strong>propertyId</strong> and <strong>label</strong>. Optional: bedrooms, bathrooms, squareFeet, marketRent, floor and notes. Use exact property IDs from this directory. Unit names are unique within each property, including archived units. Bathrooms use quarter increments; marketRent is a USD amount.</p><p>Each file supports up to 500 units and 256 KiB. Quoted cells support commas, double quotes and multiple lines.</p>
      {!properties.data ? <Load error={properties.error} reload={properties.reload}/> : properties.data.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Property</th><th scope="col">Property ID</th></tr></thead><tbody>{properties.data.map(property => <tr key={property.id}><td><Link to={`/company/properties/${encodeURIComponent(property.id)}`}>{property.name}</Link><br/>{property.address}</td><td><code>{property.id}</code></td></tr>)}</tbody></table></div> : <p>Add a property before importing its units. <Link to="/company/properties">Open properties</Link></p>}
    </details>
    <EditorDialog open={open} title="Create unit import preview" onClose={() => setOpen(false)} onDiscard={reset} onSaveDraft={() => setOpen(false)}>
      <Form key={key} operation="unit.import.preview" label="Create preview" feedbackText="Unit import preview created." submit={async form => {
        if (reading) throw new Error("Wait for the selected file to finish loading.");
        const batch = await api<Batch>(base + "/preview", { method: "POST", body: { csv: String(form.get("csv") || ""), fileName: String(form.get("fileName") || ""), submissionKey: key } });
        setOpen(false); setKey(crypto.randomUUID()); directory.reload(); select(batch.id);
      }}><label>Choose a CSV file<input type="file" accept=".csv,text/csv" onChange={event => void choose(event.target.files?.[0])}/></label>{reading && <p role="status">Reading CSV file…</p>}{fileError && <p role="alert" className="notice error">{fileError}</p>}<label>Import file name<input name="fileName" required maxLength={200} value={fileName} onChange={event => setFileName(event.target.value)}/></label><label>CSV contents<textarea name="csv" required rows={12} value={csv} onChange={event => setCsv(event.target.value)}/></label><p className="help">Creating a preview saves the submitted rows for review. Only the later import confirmation creates active units.</p></Form>
    </EditorDialog>
    {selected ? <ImportDetail key={selected} id={selected} back={() => select("")} changed={directory.reload} fresh={() => setOpen(true)}/> : <section className="panel"><h2>Import history</h2>{!directory.data ? <Load error={directory.error} reload={directory.reload}/> : <>{directory.error && <Load error={directory.error} reload={directory.reload}/>}<p>{directory.data.total} saved imports</p>{directory.data.items.length ? <div className="table-wrap"><table><thead><tr><th scope="col">File</th><th scope="col">Created</th><th scope="col">State</th><th scope="col">Rows</th></tr></thead><tbody>{directory.data.items.map(batch => <tr key={batch.id}><td><button className="link-button" onClick={() => select(batch.id)}>{batch.fileName}</button></td><td>{formatActivityTime(batch.createdAt)}</td><td>{statusName(batch.status)}{batch.status === "preview" && batch.errorCount > 0 && ` · ${batch.errorCount} rows need correction`}</td><td>{batch.createdCount ?? batch.rowCount}</td></tr>)}</tbody></table></div> : <p>No unit imports have been saved.</p>}<div className="actions"><button className="secondary" disabled={!cursors.length} onClick={() => setCursors(previous => previous.slice(0, -1))}>Previous imports</button><button className="secondary" disabled={!directory.data.nextCursor} onClick={() => setCursors(previous => [...previous, directory.data!.nextCursor!])}>Next imports</button></div></>}</section>}
  </>;
}
function ImportDetail({ id, back, changed, fresh }: { id: string; back: () => void; changed: () => void; fresh: () => void }) {
  const resource = useResource<Batch>(`${base}/${encodeURIComponent(id)}`, true);
  const [page, setPage] = useState(0), [action, setAction] = useState<{ kind: "commit" | "cancel"; version: number; key: string } | null>(null), [open, setOpen] = useState(false);
  if (!resource.data) return <><button className="link-button" onClick={back}>← Import history</button><Load error={resource.error} reload={resource.reload}/></>;
  const batch = resource.data, rows = batch.preview.rows.slice(page * 50, (page + 1) * 50);
  const start = (kind: "commit" | "cancel") => { if (!action) setAction({ kind, version: batch.version, key: crypto.randomUUID() }); setOpen(true); };
  const reset = () => { setAction(null); setOpen(false); };
  return <>
    <button className="link-button" onClick={back}>← Import history</button>
    <section className="panel"><h2>{batch.fileName}</h2>{resource.error && <Load error={resource.error} reload={resource.reload}/>}<p>{statusName(batch.status)} · Created {formatActivityTime(batch.createdAt)}</p><p><strong>{batch.preview.validCount} valid rows</strong> · {batch.preview.errorCount} rows need correction · {batch.preview.rowCount} rows total</p>
      {batch.status === "preview" && <div className="actions">{action && !open && <button onClick={() => setOpen(true)}>Continue import review</button>}<button disabled={!!action || batch.preview.errorCount > 0} onClick={() => start("commit")}>Import {batch.preview.rowCount} units</button><button className="secondary" disabled={!!action} onClick={() => start("cancel")}>Cancel this preview</button><button className="secondary" onClick={fresh}>Create a fresh preview</button></div>}
      {batch.preview.errorCount > 0 && <p className="notice">Correct the marked rows in your CSV, then create a new preview. This saved preview remains in history.</p>}
      {batch.result && <p className="notice" role="status">Created {batch.result.createdCount} active units on {formatActivityTime(batch.committedAt)}. Follow the property links below to review the resulting inventory.</p>}
      {batch.status === "cancelled" && <p className="notice">Cancelled {formatActivityTime(batch.cancelledAt)}. Submitted source rows and history are retained.</p>}
      <p>Rows {page * 50 + 1}–{Math.min((page + 1) * 50, batch.preview.rowCount)} of {batch.preview.rowCount}</p>
      <div className="table-wrap"><table><thead><tr><th scope="col">CSV line</th><th scope="col">Property</th><th scope="col">Unit</th><th scope="col">Optional details</th><th scope="col">Review</th></tr></thead><tbody>{rows.map(row => <tr key={row.row}><td>{row.row}</td><td>{row.property ? <Link to={`/company/properties/${encodeURIComponent(row.property.id)}/units?q=${encodeURIComponent(row.label || "")}`}>{row.property.name}</Link> : row.values.propertyId || "Missing property ID"}</td><td>{row.values.label || "Missing unit name"}{batch.result?.items.find(item => item.row === row.row) && <p className="help">Unit ID: {batch.result.items.find(item => item.row === row.row)!.unitId}</p>}</td><td>{columns.slice(2).filter(key => row.values[key]).map(key => <div key={key}><strong>{key}:</strong> <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{row.values[key]}</span></div>)}</td><td>{row.issues.length ? <ul>{row.issues.map((issue, index) => <li key={index}>{issue.column}: {issue.message}</li>)}</ul> : "Ready"}</td></tr>)}</tbody></table></div>
      <div className="actions"><button className="secondary" disabled={!page} onClick={() => setPage(previous => previous - 1)}>Previous rows</button><button className="secondary" disabled={(page + 1) * 50 >= batch.preview.rowCount} onClick={() => setPage(previous => previous + 1)}>Next rows</button></div>
    </section>
    <section className="panel"><h3>Import activity</h3><ol className="record-list">{batch.actions.map(event => <li key={event.id}><strong>{({ preview: "Preview saved", commit: "Units imported", cancel: "Preview cancelled" } as Record<string, string>)[event.action] || event.action}</strong> · {formatActivityTime(event.createdAt)}{event.detail.reason && <p>{event.detail.reason}</p>}</li>)}</ol></section>
    <EditorDialog open={open} title={action?.kind === "cancel" ? "Cancel unit import" : "Confirm unit import"} onClose={() => setOpen(false)} onDiscard={reset} onSaveDraft={() => setOpen(false)}>
      {action && <Form operation={action.kind === "commit" ? "unit.import.commit" : "unit.import.cancel"} label={action.kind === "commit" ? "Confirm import" : "Confirm cancellation"} feedbackText={action.kind === "commit" ? "Unit inventory imported." : "Import preview cancelled."} submit={async form => {
        await api(`${base}/${encodeURIComponent(id)}/${action.kind}`, { method: "POST", body: { expectedVersion: action.version, submissionKey: action.key, ...(action.kind === "cancel" ? { reason: String(form.get("reason") || "") } : {}) } });
        reset(); resource.reload(); changed();
      }}><p>{action.kind === "commit" ? `Create all ${batch.preview.rowCount} reviewed units together. The server rechecks current properties, duplicate unit names and your access before creating inventory.` : "Cancel this preview while retaining its source rows and activity history."}</p>{action.kind === "cancel" && <label>Cancellation reason<textarea name="reason" required maxLength={500}/></label>}</Form>}
    </EditorDialog>
  </>;
}
