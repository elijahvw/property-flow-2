import { useEditorSelection } from "../useEditorSelection";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { formatDate, formatActivityTime } from "../dates";
import { useResource } from "../useResource";
import { dollars } from "../money";
import { Form } from "./Form";
import { EditorDialog } from "./EditorDialog";
import { DraftReset } from "./DraftReset";

type Expense = {
  id: string; reference: string; occurredOn: string; amountCents: number;
  category: string; memo: string | null; version: number;
  voidedAt: string | null; voidReason: string | null;
};
type Cost = {
  id: string; version: number; createdAt: string;
  unlinkedAt: string | null; unlinkReason: string | null; entry: Expense;
};
function Failure({ error, retry }: { error?: string; retry: () => void }) {
  return error ? <div role="alert"><p>{error}</p><button onClick={retry}>Try again</button></div> : <p role="status">Loading maintenance costs…</p>;
}
export function MaintenanceCosts({ requestId, propertyId }: { requestId: string; propertyId: string }) {
  const endpoint = `/api/company/maintenance/${encodeURIComponent(requestId)}/costs`;
  const [cursor, setCursor] = useState(""), [adding, setAdding] = useState(false),
    [unlinking, setUnlinking, unlinkOpen, saveUnlinkDraft] = useEditorSelection<Cost | null>(null), [success, setSuccess] = useState("");
  const r = useResource<{ items: Cost[]; nextCursor: string | null; summary: { paidCents: string; paidCount: number } }>(`${endpoint}${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`, true, true);
  const financePath = `/company/properties/${encodeURIComponent(propertyId)}/finances`;
  const refresh = (message: string) => { setCursor(""); r.reload(); setSuccess(message); };
  return <section className="panel maintenance-costs" aria-label="Maintenance costs">
    <div className="section-heading"><h2>Paid maintenance costs</h2><button onClick={() => { setAdding(true); setSuccess(""); }}>Link existing expense</button></div>
    <p className="help">Link expenses already paid and recorded in Cash activity. Resolving a request does not record a payment. Voided expenses and unlinked records stay in history and are excluded from the total.</p>
    {success && <p className="notice" role="status">{success}</p>}
    {r.error && r.data && <Failure error={r.error} retry={r.reload} />}
    {!r.data ? <Failure error={r.error} retry={r.reload} /> : <>
      <p className="cost-total"><strong>{dollars(r.data.summary.paidCents)}</strong> · {r.data.summary.paidCount} linked paid {r.data.summary.paidCount === 1 ? "expense" : "expenses"}</p>
      {!r.data.items.length ? <p>No expenses linked to this request.</p> : <ul className="maintenance-cost-list">
        {r.data.items.map(cost => <li key={cost.id}>
          <div className="section-heading"><strong>{dollars(cost.entry.amountCents)}</strong><span className="status-pill">{cost.unlinkedAt ? "Unlinked" : cost.entry.voidedAt ? "Expense voided" : "Linked expense"}</span></div>
          <p><Link to={`${financePath}?${new URLSearchParams({ entryId: cost.entry.id, maintenanceReturn: requestId })}`}>{cost.entry.reference} · View transaction →</Link></p>
          <p className="cell-detail">Paid {formatDate(cost.entry.occurredOn)} · {cost.entry.category.replace(/_/g, " ")} · Linked {formatActivityTime(cost.createdAt)}</p>
          {cost.entry.memo && <p className="preserve-lines">{cost.entry.memo}</p>}
          {cost.unlinkedAt ? <p>Unlinked {formatActivityTime(cost.unlinkedAt)} · {cost.unlinkReason}</p> : <>
            {cost.entry.voidedAt && <p>Expense correction: {cost.entry.voidReason}</p>}
            <button className="text-button" onClick={() => setUnlinking(cost)} aria-label={`Unlink expense ${cost.entry.reference}`}>Unlink expense</button>
          </>}
        </li>)}
      </ul>}
      <div className="actions">{cursor && <button className="secondary" onClick={() => setCursor("")}>Latest cost links</button>}{r.data.nextCursor && <button className="secondary" onClick={() => setCursor(r.data!.nextCursor!)}>Older cost links</button>}</div>
    </>}
    <p><Link to={`${financePath}?${new URLSearchParams({ new: "expense", maintenanceReturn: requestId })}`}>Record a paid expense in Cash activity →</Link></p>
    <EditorDialog open={adding} title="Link a paid maintenance expense" onClose={() => setAdding(false)}>
      <ExpensePicker endpoint={endpoint} saved={() => { setAdding(false); refresh("Expense linked. Financial records are unchanged."); }} />
    </EditorDialog>
    {unlinking && <EditorDialog key={unlinking.id} open={unlinkOpen} onSaveDraft={saveUnlinkDraft} title="Unlink maintenance expense" onClose={() => setUnlinking(null)}>
      <p>{unlinking.entry.reference} · {dollars(unlinking.entry.amountCents)} · {formatDate(unlinking.entry.occurredOn)}</p>
      <p>This removes the expense from this request's cost total. The paid transaction stays in Cash activity; unlinking does not refund or void it.</p>
      <Form key={`${unlinking.id}:${unlinking.version}`} operation="maintenance.cost.unlink" label="Unlink expense" feedbackText="Maintenance expense unlinked."
        submit={async form => { await api(`${endpoint}/${encodeURIComponent(unlinking.id)}/unlink`, { method: "POST", body: { expectedVersion: unlinking.version, reason: form.get("reason") } }); setUnlinking(null); refresh("Expense unlinked; its transaction and link history are retained."); }}>
        <label>Reason (required)<textarea name="reason" aria-label="Unlink reason" required maxLength={300} rows={3} /></label>
      </Form>
    </EditorDialog>}
  </section>;
}

function ExpensePicker({ endpoint, saved }: { endpoint: string; saved: () => void }) {
  const [query, setQuery] = useState(""), [cursor, setCursor] = useState(""),
    [selected, setSelected] = useState<Expense | null>(null), [key, setKey] = useState(() => crypto.randomUUID());
  const r = useResource<{ items: Expense[]; nextCursor: string | null }>(`${endpoint}/candidates?${new URLSearchParams(Object.entries({ q: query, cursor }).filter(([, value]) => value))}`, true, true);
  return <>
    <p>Choose an unvoided expense from this property. An expense can be actively linked to one maintenance request at a time.</p>
    <label>Find paid expense<input type="search" value={query} maxLength={200} placeholder="Transaction reference or memo" onChange={e => { setQuery(e.target.value); setCursor(""); }} /></label>
    {r.error && r.data && <Failure error={r.error} retry={r.reload} />}
    {!r.data ? <Failure error={r.error} retry={r.reload} /> : <>
      {!r.data.items.length ? <p>No eligible expenses match. Record the paid expense in Cash activity first, or adjust your search.</p> : <fieldset className="form-section"><legend>Available paid expenses</legend>
        {r.data.items.map(entry => <label className="expense-choice" key={entry.id}>
          <input type="radio" name="expense-choice" value={entry.id} checked={selected?.id === entry.id} onChange={() => setSelected(entry)} />
          <span><strong>{entry.reference} · {dollars(entry.amountCents)}</strong><span className="cell-detail">{formatDate(entry.occurredOn)} · {entry.category.replace(/_/g, " ")}</span>{entry.memo && <span className="cell-detail">{entry.memo}</span>}</span>
        </label>)}
      </fieldset>}
      <div className="actions">{cursor && <button type="button" className="secondary" onClick={() => setCursor("")}>Latest expenses</button>}{r.data.nextCursor && <button type="button" className="secondary" onClick={() => setCursor(r.data!.nextCursor!)}>Older expenses</button>}</div>
    </>}
    {selected && <Form key={key} operation="maintenance.cost.link" label="Link expense" feedbackText="Maintenance expense linked."
      secondaryActions={<DraftReset reset={() => { setSelected(null); setKey(crypto.randomUUID()); r.reload(); }} />}
      submit={async () => { await api(endpoint, { method: "POST", body: { entryId: selected.id, expectedEntryVersion: selected.version, submissionKey: key } }); setSelected(null); setKey(crypto.randomUUID()); r.reload(); saved(); }}>
      <fieldset className="form-section"><legend>Review selected expense</legend><p>{selected.reference} · {dollars(selected.amountCents)} · {formatDate(selected.occurredOn)}</p>{selected.memo && <p className="preserve-lines">{selected.memo}</p>}<p className="help">This links the existing payment; it creates no new transaction or resident charge. If the expense has changed, clear this draft and choose its latest record.</p></fieldset>
    </Form>}
  </>;
}
