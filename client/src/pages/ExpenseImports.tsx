import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { formatActivityTime, formatDate } from "../dates";
import { dollars } from "../money";
import { downloadReport } from "../report-export";
import { useResource } from "../useResource";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "../components/Form";
import { propertyLink } from "../components/PropertyNavigation";
import "./ExpenseImports.css";

type Group = { propertyId: string; propertyName: string; category: string; amountCents: string; count: number };
type Row = {
  row: number; values: Record<string, string>; sourceId: string | null; propertyId: string | null;
  occurredOn: string | null; amountCents: number | null; category: string | null; memo: string | null;
  property: { id: string; name: string; version: number } | null;
  existingSource?: { id: string; ledgerEntryId: string; propertyId: string; reference: string; voidedAt: string | null; samePayload: boolean };
  issues: { column: string; message: string }[];
};
type Batch = {
  id: string; companyId: string; status: "preview" | "committed" | "cancelled"; version: number;
  fileName: string; sourceNamespace: string; createdAt: string; committedAt: string | null; cancelledAt: string | null;
  preview: { rowCount: number; validCount: number; errorCount: number; totalCents: string; totalsComplete?: boolean; groups: Group[]; rows: Row[] };
  result: null | { createdCount: number; totalCents: string; items: { row: number; sourceId: string; ledgerEntryId: string; reference: string; propertyId: string; amountCents: number }[] };
  actions: { id: string; action: string; createdAt: string; detail: { reason?: string; rowCount?: number; createdCount?: number } }[];
};
type Summary = Pick<Batch, "id" | "status" | "version" | "fileName" | "sourceNamespace" | "createdAt"> & { rowCount: number; errorCount: number; totalCents: string; createdCount: number | null };
type Review = { kind: "commit" | "cancel"; version: number; key: string; rowCount: number; totalCents: string; groups: Group[]; sourceNamespace: string; fileName: string };
const base = "/api/company/imports/expenses";
const columns = ["sourceId", "propertyId", "occurredOn", "amount", "category", "memo"];
const categories: Record<string, string> = { repairs: "Repairs", utilities: "Utilities", insurance: "Insurance", property_tax: "Property tax", other: "Other operating expense" };
const statusLabel = (status: Batch["status"]) => ({ preview: "Saved preview", committed: "Imported", cancelled: "Cancelled" })[status];
const cashSource = (propertyId: string, ledgerEntryId: string) => propertyLink("/company/finances", propertyId, { entryId: ledgerEntryId });

function Load({ error, retry }: { error?: string; retry: () => void }) {
  return error ? <p className="notice error" role="alert">{error} <button className="secondary" onClick={retry}>Retry expense imports</button></p> : <p role="status">Loading expense imports…</p>;
}

export function ExpenseImports() {
  const { data } = useAuth();
  return <ExpenseWorkspace key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.impersonation?.contextId || ""}`}/>;
}

function ExpenseWorkspace() {
  const { data } = useAuth();
  const readOnly = !!data?.impersonation || !!data?.companyFeatures && (data.companyFeatures.finances !== "enabled" || data.companyFeatures.leasing !== "enabled" || data.companyFeatures.properties !== "enabled");
  const [params, setParams] = useSearchParams(), selected = params.get("importId") || "";
  const [cursors, setCursors] = useState<string[]>([]);
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(false);
  const [namespace, setNamespace] = useState(""), [fileName, setFileName] = useState("paid-expenses.csv"), [csv, setCsv] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID()), [reading, setReading] = useState(false), [fileError, setFileError] = useState("");
  const readVersion = useRef(0);
  const directory = useResource<{ items: Summary[]; total: number; nextCursor: string | null }>(`${base}${cursors.length ? `?cursor=${encodeURIComponent(cursors[cursors.length - 1])}` : ""}`);
  const properties = useResource<{ id: string; name: string; address: string }[]>("/api/company/properties");
  const select = (id: string) => setParams(previous => { const next = new URLSearchParams(previous); id ? next.set("importId", id) : next.delete("importId"); return next; });
  const discard = () => { ++readVersion.current; setOpen(false); setDraft(false); setNamespace(""); setFileName("paid-expenses.csv"); setCsv(""); setKey(crypto.randomUUID()); setFileError(""); setReading(false); };
  const begin = () => { setDraft(true); setOpen(true); };
  async function choose(file?: File) {
    if (!file) return;
    const current = ++readVersion.current;
    if (file.size > 256 * 1024) { setReading(false); setFileError("Choose a UTF-8 CSV file of at most 256 KiB. Your previous input is preserved."); return; }
    setReading(true); setFileError("");
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (current !== readVersion.current) return;
      setCsv(text); setFileName(file.name.slice(0, 200));
    } catch { if (current === readVersion.current) setFileError("The file could not be read as UTF-8 CSV. Your previous input is preserved."); }
    finally { if (current === readVersion.current) setReading(false); }
  }
  return <>
    <header className="page-heading"><p className="eyebrow">Operating expense import</p><h1>Import paid expenses</h1><p>Bring already-paid operating expenses into your property cash records, with a saved review before anything is posted.</p></header>
    <ol className="expense-import-steps" aria-label="Expense import workflow"><li><strong>1. Prepare</strong><span>Stable source IDs and actual paid dates</span></li><li><strong>2. Review</strong><span>Every row, property and amount</span></li><li><strong>3. Import</strong><span>Confirm once, then follow the cash sources</span></li></ol>
    <div className="actions"><button disabled={readOnly} onClick={begin}>{draft ? "Continue expense preview" : "New expense preview"}</button><button className="secondary" onClick={() => downloadReport("paid-expense-import-template.csv", [columns])}>Download blank expense CSV</button></div>
    <p className="help">This records paid repairs, utilities, insurance, property tax and other operating expenses. Tenant payments, rent, deposits, refunds and opening balances use their own workflows.</p>
    <details className="panel expense-import-help"><summary>CSV format, source IDs and property directory</summary>
      <div className="expense-import-help-grid"><section><h2>File format</h2><p>Required columns: <code>sourceId</code>, <code>propertyId</code>, <code>occurredOn</code>, <code>amount</code>, <code>category</code>. <code>memo</code> is optional.</p><ul><li>Use dates as YYYY-MM-DD and positive USD amounts, up to $1,000,000 per row.</li><li>Categories: repairs, utilities, insurance, property_tax, other.</li><li>Up to 500 rows and 256 KiB. Quoted commas, double quotes and multiline notes are supported.</li></ul></section><section><h2>Keep source identities stable</h2><p>Choose one namespace for the same bookkeeping source across every file. Each source ID must identify the original expense and stay unchanged between imports.</p><p>Already-imported source IDs remain reserved after a cash entry is voided. Follow that source to correct it; changing the namespace to import it again would duplicate the expense.</p></section></div>
      <h2>Current company properties</h2>{!properties.data ? <Load error={properties.error} retry={properties.reload}/> : properties.data.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Property</th><th scope="col">Exact property ID</th></tr></thead><tbody>{properties.data.map(property => <tr key={property.id}><td><Link to={`/company/properties/${encodeURIComponent(property.id)}`}>{property.name}</Link><br/><span className="help">{property.address}</span></td><td><code>{property.id}</code></td></tr>)}</tbody></table></div> : <p>Add the property before importing expenses against it. <Link to="/company/properties">Open properties</Link></p>}
    </details>
    <EditorDialog open={open} title="Prepare paid expense preview" description="Identify the source, then choose or paste a CSV. Creating a preview saves rows for review without posting cash entries." onClose={() => setOpen(false)} onDiscard={discard} onSaveDraft={() => setOpen(false)}>
      <Form key={key} operation="expense.import.preview" label="Create expense preview" feedbackText="Expense preview saved for review." submit={async form => {
        if (reading) throw new Error("Wait for the selected file to finish loading.");
        const batch = await api<Batch>(base + "/preview", { method: "POST", body: { sourceNamespace: String(form.get("sourceNamespace") || ""), fileName: String(form.get("fileName") || ""), csv: String(form.get("csv") || ""), submissionKey: key } });
        setOpen(false); setDraft(false); setKey(crypto.randomUUID()); directory.reload(); select(batch.id);
      }}>
        <fieldset><legend>1. Source identity</legend><p className="help">Use the same namespace on later files from this source. It is part of duplicate detection, independently of a file's name.</p><div className="form-grid"><label>Source namespace<input aria-label="Source namespace" name="sourceNamespace" required maxLength={100} pattern={"[a-z0-9][a-z0-9._\\-]{0,99}"} value={namespace} onChange={event => setNamespace(event.target.value)} autoCapitalize="none" spellCheck={false}/><span className="help">Lowercase letters, digits, dots, underscores and hyphens.</span></label><label>Import file name<input name="fileName" required maxLength={200} value={fileName} onChange={event => setFileName(event.target.value)}/></label></div></fieldset>
        <fieldset><legend>2. Expense source rows</legend><p className="help">Choose a file or paste CSV below. Keep the original source ID on each row; amounts and dates alone do not identify an expense.</p><label>Choose expense CSV<input type="file" accept=".csv,text/csv" onChange={event => void choose(event.target.files?.[0])}/></label>{reading && <p role="status">Reading expense CSV…</p>}{fileError && <p className="notice error" role="alert">{fileError}</p>}<label>Expense CSV contents<textarea aria-label="Expense CSV contents" name="csv" required rows={10} value={csv} onChange={event => setCsv(event.target.value)} spellCheck={false}/></label><details><summary>Show required columns</summary><code className="expense-import-columns">{columns.join(",")}</code><p className="help">Paid dates cannot be future company dates. A preview with any invalid or duplicate row cannot be imported.</p></details></fieldset>
      </Form>
    </EditorDialog>
    {selected ? <ExpenseDetail key={selected} id={selected} readOnly={readOnly} back={() => select("")} changed={directory.reload} fresh={begin}/> : <section className="panel"><h2>Expense import history</h2>{!directory.data ? <Load error={directory.error} retry={directory.reload}/> : <>{directory.error && <Load error={directory.error} retry={directory.reload}/>}<p>{directory.data.total.toLocaleString()} saved {directory.data.total === 1 ? "import" : "imports"}</p>{directory.data.items.length ? <div className="table-wrap"><table><thead><tr><th scope="col">File / source</th><th scope="col">Created</th><th scope="col">State</th><th scope="col">Rows</th><th scope="col">Validated USD total</th></tr></thead><tbody>{directory.data.items.map(batch => <tr key={batch.id}><td><button className="link-button" onClick={() => select(batch.id)}>{batch.fileName}</button><br/><code>{batch.sourceNamespace}</code></td><td>{formatActivityTime(batch.createdAt)}</td><td>{statusLabel(batch.status)}{batch.errorCount > 0 && ` · ${batch.errorCount} rows need correction`}</td><td>{batch.rowCount}</td><td>{dollars(batch.totalCents)}</td></tr>)}</tbody></table></div> : <p>No expense previews have been saved. Start with the original paid-expense records and their stable source IDs.</p>}<Pager previous={!!cursors.length} next={!!directory.data.nextCursor} back={() => setCursors(value => value.slice(0, -1))} forward={() => setCursors(value => [...value, directory.data!.nextCursor!])}/></>}</section>}
  </>;
}

function Pager({ previous, next, back, forward }: { previous: boolean; next: boolean; back: () => void; forward: () => void }) {
  return <div className="actions"><button className="secondary" disabled={!previous} onClick={back}>Previous expense imports</button><button className="secondary" disabled={!next} onClick={forward}>Next expense imports</button></div>;
}

function Totals({ totalCents, groups, incomplete = false }: { totalCents: string; groups: Group[]; incomplete?: boolean }) {
  return <><p className="expense-import-total"><span>{incomplete ? "Validated subtotal" : "Complete import total"}</span><strong>{dollars(totalCents)} USD</strong></p>{incomplete && <p className="help">Only valid rows are included in this amount. Every row must be valid before the whole file can be imported.</p>}{groups.length > 0 && <div className="table-wrap"><table><caption>{incomplete ? "Validated rows" : "All reviewed rows"} by property and category</caption><thead><tr><th scope="col">Property</th><th scope="col">Category</th><th scope="col">Rows</th><th scope="col">USD</th></tr></thead><tbody>{groups.map(group => <tr key={`${group.propertyId}:${group.category}`}><td>{group.propertyName}</td><td>{categories[group.category] || group.category}</td><td>{group.count}</td><td>{dollars(group.amountCents)}</td></tr>)}</tbody></table></div>}</>;
}

function ExpenseDetail({ id, readOnly, back, changed, fresh }: { id: string; readOnly: boolean; back: () => void; changed: () => void; fresh: () => void }) {
  const resource = useResource<Batch>(`${base}/${encodeURIComponent(id)}`, true);
  const [page, setPage] = useState(0), [review, setReview] = useState<Review | null>(null), [open, setOpen] = useState(false);
  if (!resource.data) return <><button className="link-button" onClick={back}>← Expense import history</button><Load error={resource.error} retry={resource.reload}/></>;
  const batch = resource.data, rows = batch.preview.rows.slice(page * 50, (page + 1) * 50);
  const reset = () => { setOpen(false); setReview(null); };
  const begin = (kind: Review["kind"]) => { if (!review) setReview({ kind, version: batch.version, key: crypto.randomUUID(), rowCount: batch.preview.rowCount, totalCents: batch.preview.totalCents, groups: batch.preview.groups, sourceNamespace: batch.sourceNamespace, fileName: batch.fileName }); setOpen(true); };
  return <>
    <button className="link-button" onClick={back}>← Expense import history</button>
    <section className="panel"><div className="section-heading"><div><p className="eyebrow">{statusLabel(batch.status)}</p><h2>{batch.fileName}</h2><p>Source namespace: <code>{batch.sourceNamespace}</code> · Saved {formatActivityTime(batch.createdAt)}</p></div>{batch.status === "preview" && <div className="actions">{review && !open && <button onClick={() => setOpen(true)}>Continue expense import review</button>}<button disabled={readOnly || !!review || batch.preview.errorCount > 0} onClick={() => begin("commit")}>Review {batch.preview.rowCount} paid {batch.preview.rowCount === 1 ? "expense" : "expenses"}</button><button className="secondary" disabled={readOnly || !!review} onClick={() => begin("cancel")}>Cancel expense preview</button></div>}</div>
      {resource.error && <Load error={resource.error} retry={resource.reload}/>}
      <p><strong>{batch.preview.validCount} valid {batch.preview.validCount === 1 ? "row" : "rows"}</strong> · {batch.preview.errorCount} rows need correction · {batch.preview.rowCount} rows total</p>
      {batch.preview.errorCount > 0 && <div className="notice"><strong>Nothing can be posted from this preview yet.</strong><p>Correct each marked source row and create a fresh preview. Existing sources, including voided entries, must be corrected through their original cash record.</p><button className="secondary" disabled={readOnly} onClick={fresh}>Create a fresh expense preview</button></div>}
      {batch.result && <p className="notice" role="status">Imported {batch.result.createdCount} paid {batch.result.createdCount === 1 ? "expense" : "expenses"} totaling {dollars(batch.result.totalCents)} on {formatActivityTime(batch.committedAt)}. The cash entries and their source identities are retained.</p>}
      {batch.status === "cancelled" && <p className="notice">Cancelled {formatActivityTime(batch.cancelledAt)}. Source rows and import history remain available.</p>}
      <Totals totalCents={batch.preview.totalCents} groups={batch.preview.groups} incomplete={batch.preview.errorCount > 0}/>
      <h3>Source row review</h3><p className="help">Amounts and totals cover the whole preview. Source rows are displayed 50 at a time.</p>
      <div className="table-wrap"><table className="expense-import-rows"><caption>Rows {page * 50 + 1}–{Math.min((page + 1) * 50, batch.preview.rowCount)} of {batch.preview.rowCount}</caption><thead><tr><th scope="col">Line / source ID</th><th scope="col">Property</th><th scope="col">Paid date</th><th scope="col">Category / memo</th><th scope="col">USD</th><th scope="col">Review / cash source</th></tr></thead><tbody>{rows.map(row => {
        const created = batch.result?.items.find(item => item.row === row.row);
        return <tr key={row.row}><td>{row.row}<br/><code>{row.sourceId || row.values.sourceId || "Missing source ID"}</code></td><td>{row.property ? <Link to={`/company/properties/${encodeURIComponent(row.property.id)}`}>{row.property.name}</Link> : row.values.propertyId || "Missing property ID"}</td><td>{row.occurredOn ? formatDate(row.occurredOn) : row.values.occurredOn || "Missing paid date"}</td><td>{row.category ? categories[row.category] || row.category : row.values.category || "Missing category"}{row.values.memo && <p className="expense-import-memo">{row.values.memo}</p>}</td><td>{row.amountCents != null ? dollars(row.amountCents) : row.values.amount || "Missing amount"}</td><td>{row.issues.length > 0 ? <ul>{row.issues.map((issue, index) => <li key={index}><strong>{issue.column}:</strong> {issue.message}</li>)}</ul> : "Ready"}{row.existingSource && <p><Link to={cashSource(row.existingSource.propertyId, row.existingSource.ledgerEntryId)}>{row.existingSource.reference}</Link><br/><span className="help">{row.existingSource.voidedAt ? "Voided source; identity remains reserved." : row.existingSource.samePayload ? "Already recorded; do not import again." : "Source ID already has different recorded details."}</span></p>}{created && <p><Link to={cashSource(created.propertyId, created.ledgerEntryId)}>Open {created.reference}</Link></p>}</td></tr>;
      })}</tbody></table></div>
      <div className="actions"><button className="secondary" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous expense rows</button><span>Page {page + 1} of {Math.max(1, Math.ceil(batch.preview.rowCount / 50))}</span><button className="secondary" disabled={(page + 1) * 50 >= batch.preview.rowCount} onClick={() => setPage(value => value + 1)}>Next expense rows</button></div>
    </section>
    <section className="panel"><h3>Expense import activity</h3><ol className="record-list">{batch.actions.map(event => <li key={event.id}><strong>{({ preview: "Preview saved", commit: "Paid expenses imported", cancel: "Preview cancelled" } as Record<string, string>)[event.action] || event.action}</strong> · {formatActivityTime(event.createdAt)}{event.detail.reason && <p>{event.detail.reason}</p>}</li>)}</ol></section>
    <EditorDialog open={open} title={review?.kind === "cancel" ? "Cancel expense preview" : "Confirm paid expense import"} description="The opening preview version and submitted details remain fixed while this review is open." onClose={() => setOpen(false)} onDiscard={() => { reset(); resource.reload(); }} onSaveDraft={() => setOpen(false)}>
      {review && <Form key={review.key} operation={review.kind === "commit" ? "expense.import.commit" : "expense.import.cancel"} label={review.kind === "commit" ? "Import confirmed paid expenses" : "Confirm expense cancellation"} feedbackText={review.kind === "commit" ? "Paid operating expenses imported." : "Expense preview cancelled."} submit={async form => {
        await api(`${base}/${encodeURIComponent(id)}/${review.kind}`, { method: "POST", body: { expectedVersion: review.version, submissionKey: review.key, ...(review.kind === "commit" ? { confirmedPaid: form.get("confirmedPaid") === "on", confirmedNotRecorded: form.get("confirmedNotRecorded") === "on" } : { reason: String(form.get("reason") || "") }) } });
        reset(); resource.reload(); changed();
      }}>
        <fieldset><legend>Reviewed import</legend><dl className="expense-review-facts"><div><dt>File</dt><dd>{review.fileName}</dd></div><div><dt>Stable source namespace</dt><dd><code>{review.sourceNamespace}</code></dd></div><div><dt>Source rows</dt><dd>{review.rowCount}</dd></div></dl><Totals totalCents={review.totalCents} groups={review.groups}/></fieldset>
        {review.kind === "commit" ? <fieldset><legend>Confirm actual paid expenses</legend><p className="help">Every reviewed row is imported together. This creates cash expense records without sending a payment, crediting a tenant or reconciling a bank account.</p><label className="expense-import-confirm"><input name="confirmedPaid" type="checkbox" required/><span>I confirm these operating expenses were actually paid on the recorded dates.</span></label><label className="expense-import-confirm"><input name="confirmedNotRecorded" type="checkbox" required/><span>I have checked that these expenses are not already recorded in Property Flow, including outside this import source.</span></label></fieldset> : <fieldset><legend>Cancellation reason</legend><label>Why cancel this saved preview?<textarea name="reason" required maxLength={500} rows={3}/></label><p className="help">Cancellation retains the submitted rows and history. It does not alter any cash entry.</p></fieldset>}
        <p className="help">If the preview, properties or source identities changed, keep the failed review for reference, then discard it and create a fresh preview. An interrupted request must be retried with these original details.</p>
      </Form>}
    </EditorDialog>
  </>;
}
