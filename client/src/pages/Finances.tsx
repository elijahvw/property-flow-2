import { useEditorSelection } from "../useEditorSelection";
import { recordReference } from "../record-reference";
import { formatDate } from "../dates";
import { DateField } from "../components/DateField";
import { usePropertySearchParams } from "../usePropertySearchParams";
import { RecordIdentity } from "../components/RecordIdentity";
import { Link } from "react-router-dom";
import { DraftReset } from "../components/DraftReset";
import {
  PropertyNavigation,
  propertyLink,
} from "../components/PropertyNavigation";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { EditorDialog, useEditorBusy } from "../components/EditorDialog";
import { Form } from "../components/Form";
import "./FinancialForms.css";
type Entry = {
  importedExpense?: { batchId: string; sourceNamespace: string; sourceId: string; sourceRow: number } | null;
  maintenanceCosts?: { requestId: string }[];
  movementId?:string|null; movement?:{id:string;leaseId:string;reference:string;kind:string}|null;
  reference?: string;
  depositReceiptId?: string | null;
  depositReceipt?: { leaseId: string; reference: string } | null;
  id: string;
  leaseId?: string | null;
  propertyId: string;
  property: { name: string };
  occurredOn: string;
  amountCents: number;
  kind: string;
  category: string;
  memo: string | null;
  version: number;
  voidedAt: string | null;
  voidReason: string | null;
};
type Ledger = {
  items: Entry[];
  nextCursor: string | null;
  summary: {
    incomeCents: string;
    expenseCents: string;
    netCents: string;
    depositReceivedCents?: string;rentRefundCents?:string;depositRefundCents?:string;
    cashMovementCents?: string;
  };
};
import { dollars } from "../money";
function Load({ error, retry }: { error?: string; retry: () => void }) {
  return error ? (
    <div role="alert">
      <p>{error}</p>
      <button onClick={retry}>Try again</button>
    </div>
  ) : (
    <p role="status">Loading records…</p>
  );
}
export function Finances() {
  const { data } = useAuth();
  const [, , routeProperty] = usePropertySearchParams();
  return (
    <LedgerWorkspace
      key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}:${routeProperty}`}
    />
  );
}
function LedgerWorkspace() {
  const [params, setParams, pathPropertyId] = usePropertySearchParams();
  const maintenanceReturn = params.get("maintenanceReturn") || "",
    entryId = params.get("entryId") || "";
  const [adding, setAdding] = useState(["transaction", "expense"].includes(params.get("new") || "")),
    [selected, setSelected, selectedOpen, saveSelectedDraft] = useEditorSelection<Entry | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID()),
    [kind, setKind] = useState(params.get("new") === "expense" ? "expense" : "income"),
    [filters, setFilters] = useState({
      propertyId: params.get("propertyId") || "",
      dateFrom: params.get("dateFrom") || "",
      dateTo: params.get("dateTo") || "",
    }),
    [cursor, setCursor] = useState("");
  const routeFilter = JSON.stringify([
    params.get("propertyId") || "",
    params.get("dateFrom") || "",
    params.get("dateTo") || "",
    entryId,
  ]);
  useEffect(() => {
    const [propertyId, dateFrom, dateTo] = JSON.parse(routeFilter);
    setFilters({ propertyId, dateFrom, dateTo });
    setCursor("");
  }, [routeFilter]);
  const [entryMode,setEntryMode]=useState(params.get("new")==="expense"?"expense":"income");
  const [draftProperty, setDraftProperty] = useState(filters.propertyId);
  const properties = useResource<{ id: string; name: string }[]>(
    "/api/company/properties",
  );
  const query = new URLSearchParams(
    Object.entries({ ...filters, entryId, cursor }).filter(([, v]) => v),
  );
  const r = useResource<Ledger>(`/api/company/finances?${query}`);
  const reload = () => {
    setCursor("");
    r.reload();
  };
  return (
    <>
      {filters.propertyId && <PropertyNavigation id={filters.propertyId} />}
      <header className="page-heading">
        {maintenanceReturn && <p><Link to={`/company/maintenance/${encodeURIComponent(maintenanceReturn)}?${new URLSearchParams({ propertyId: filters.propertyId, ...(pathPropertyId ? { nested: "true" } : {}) })}`}>← Back to maintenance request</Link></p>}
        <p className="eyebrow">Company operations</p>
        <h1>Cash activity</h1>
        <p>
          Record income received and expenses paid, in USD. These records do not
          collect payments. Use{" "}
          <Link to={propertyLink("/company/rent", filters.propertyId)}>
            Rent & balances
          </Link>{" "}
          to record lease payments and track balances owed. Record refundable
          deposits in{" "}
          <Link to={propertyLink("/company/deposits", filters.propertyId)}>
            Deposits
          </Link>
          ; their linked cash receipts appear here separately from income.
          Transfers are not supported.
        </p>
        <div className="actions"><button onClick={() => setAdding(true)}>Record a transaction</button><Link className="button secondary" to="/company/imports/expenses">Import paid expenses</Link></div>
        {entryId && <p className="notice">Showing the selected transaction. <button className="text-button" onClick={() => { const next = new URLSearchParams(params); next.delete("entryId"); setParams(next); setCursor(""); }}>Show all transactions</button></p>}
      </header>
      <EditorDialog
        open={adding}
        title="Record a transaction"
        onDiscard={() => { setAdding(false); setKey(crypto.randomUUID()); setEntryMode(params.get("new")==="expense"?"expense":"income"); setKind(params.get("new")==="expense"?"expense":"income"); setDraftProperty(filters.propertyId); }}
        onClose={() => setAdding(false)}
      >
        <CashEntryIntent value={entryMode} changed={value=>{setEntryMode(value);if(["income","expense"].includes(value))setKind(value);}}/>
        {["rent","deposit"].includes(entryMode)&&<section className="notice"><p>Record this against its lease so the balance and linked cash receipt update together. Do not enter it again here.</p><Link className="button" to={propertyLink(entryMode==="rent"?"/company/rent":"/company/deposits",draftProperty)}>{entryMode==="rent"?"Choose a rent account":"Choose a deposit account"}</Link></section>}
        <div hidden={["rent","deposit"].includes(entryMode)}>
        {!properties.data ? (
          <Load error={properties.error} retry={properties.reload} />
        ) : !properties.data.length ? (
          <p>Create a property first.</p>
        ) : (
          <Form
            key={key}
            operation="finance.create"
            secondaryActions={
              <DraftReset
                reset={() => {
                  setKind(params.get("new") === "expense" ? "expense" : "income");
                  setKey(crypto.randomUUID());
                }}
              />
            }
            label="Record transaction"
            submit={async (form) => {
              await api("/api/company/finances", {
                method: "POST",
                body: {
                  propertyId: form.get("propertyId"),
                  occurredOn: form.get("occurredOn"),
                  amount: form.get("amount"),
                  kind: form.get("kind"),
                  category: form.get("category"),
                  memo: form.get("memo") || null,
                  submissionKey: key,
                },
              });
              reload();
              setAdding(false);
              setKey(crypto.randomUUID());
              setParams({
                propertyId: pathPropertyId || String(form.get("propertyId")),
                ...(maintenanceReturn ? { maintenanceReturn } : {}),
              });
            }}
          >
            <label>
              <span className="financial-field-label">Transaction property <span className="financial-required" aria-hidden="true">required</span></span>
              <select
                name="propertyId"
                aria-label="Transaction property"
                required
                defaultValue={filters.propertyId}
              >
                {properties.data
                  .filter((p) => !pathPropertyId || p.id === pathPropertyId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="financial-form-row">
              <label>
                <span className="financial-field-label">Date received or paid <span className="financial-required" aria-hidden="true">required</span></span>
                <DateField name="occurredOn" aria-label="Date received or paid" required />
              </label>
              <label>
                <span className="financial-field-label">Amount (USD) <span className="financial-required" aria-hidden="true">required</span></span>
                <input
                  name="amount"
                  aria-label="Amount (USD)"
                  type="number"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  required
                />
              </label>
            </div>
            <input type="hidden" name="kind" value={kind}/>
            <label htmlFor="finance-category">Category
              <select id="finance-category" key={kind} name="category" aria-label="Category">
                {(kind === "income"
                  ? ["other", "rent"]
                  : ["repairs", "utilities", "insurance", "property_tax", "other"]
                ).map((c) => (
                  <option key={c} value={c}>
                    {c === "rent" ? "Unlinked historical rent" : c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Memo (optional)
              <textarea name="memo" maxLength={500} />
            </label>
            {kind==="income"&&<p className="help">Rent received for a saved lease belongs in <Link to={propertyLink("/company/rent",filters.propertyId)}>Rent & balances</Link>. An unlinked historical rent entry does not change a lease balance.</p>}
            <p className="help">
              To correct a saved amount, void the entry and record a
              replacement. Your original history is retained.
            </p>
          </Form>
        )}
        </div>
      </EditorDialog>
      <section className="panel">
        <h2>Transaction history</h2>
        <Form
          label="Apply filters"
          operation="page.data.load"
          submit={async (form) => {
            const next = {
              propertyId:
                pathPropertyId || String(form.get("propertyId") || ""),
              dateFrom: String(form.get("dateFrom") || ""),
              dateTo: String(form.get("dateTo") || ""),
            };
            setFilters(next);
            setParams({ ...next, ...(maintenanceReturn ? { maintenanceReturn } : {}) });
            setCursor("");
          }}
        >
          <label>
            Filter property
            <select
              name="propertyId"
              value={draftProperty}
              onChange={(e) => setDraftProperty(e.target.value)}
            >
              {!pathPropertyId && <option value="">All properties</option>}
              {properties.data
                ?.filter((p) => !pathPropertyId || p.id === pathPropertyId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            From date
            <DateField
              key={filters.dateFrom}
              name="dateFrom" aria-label="From date"
              defaultValue={filters.dateFrom}
            />
          </label>
          <label>
            Through date
            <DateField
              key={filters.dateTo}
              name="dateTo" aria-label="Through date"
              defaultValue={filters.dateTo}
            />
          </label>
        </Form>
        {r.data && r.error && <Load error={r.error} retry={r.reload} />}
        {!r.data ? (
          <Load error={r.error} retry={r.reload} />
        ) : (
          <>
            <div
              className="metric-grid"
              role="region"
              aria-label="All matching active entries"
            >
              <div>
                <span>Income received</span>
                <strong>{dollars(r.data.summary.incomeCents)}</strong>
              </div>
              <div>
                <span>Expenses paid</span>
                <strong>{dollars(r.data.summary.expenseCents)}</strong>
              </div>
              <div>
                <span>Net recorded</span>
                <strong>{dollars(r.data.summary.netCents)}</strong>
              </div>
              <div>
                <span>Deposits received</span>
                <strong>
                  {dollars(r.data.summary.depositReceivedCents || "0")}
                </strong>
              </div>
            </div>
            <p className="help">
              Rent refunds: {dollars(r.data.summary.rentRefundCents??"0")}. Deposit refunds: {dollars(r.data.summary.depositRefundCents??"0")}. Operating net subtracts rent refunds and excludes refundable deposits and deposit returns. Dates are inclusive.
              Totals exclude voided entries and include every matching page.
            </p>
            <p role="status">{r.data.items.length} transactions on this page</p>
            {!r.data.items.length ? (
              <p>No matching transactions.</p>
            ) : (
              <ul className="record-list">
                {r.data.items.map((entry) => (
                  <li key={entry.id}>
                    <h3>
                      {entry.property.name} ·{" "}
                      {entry.kind === "deposit"
                        ? "deposit receipt"
                        : entry.kind}{" "}
                      · {dollars(entry.amountCents)}
                    </h3>
                    <p>
                      {formatDate(entry.occurredOn)} ·{" "}
                      {entry.category.replace("_", " ")}
                    </p>
                    {entry.importedExpense && <p><Link to={`/company/imports/expenses?${new URLSearchParams({ importId: entry.importedExpense.batchId })}`}>Imported expense source</Link><br/><span className="help"><code>{entry.importedExpense.sourceNamespace}</code> · Source <code>{entry.importedExpense.sourceId}</code> · CSV line {entry.importedExpense.sourceRow}</span></p>}
                    {entry.movement && <p><Link to={propertyLink(entry.movement.kind==="deposit_refund"?"/company/deposits":"/company/rent",entry.propertyId,{leaseId:entry.movement.leaseId})}>Linked {recordReference(entry.movement.reference)} · Review refund and correction history →</Link></p>}
                    {entry.depositReceipt && (
                      <p>
                        <Link
                          to={propertyLink(
                            "/company/deposits",
                            entry.propertyId,
                            { leaseId: entry.depositReceipt.leaseId },
                          )}
                        >
                          Linked deposit receipt{" "}
                          {recordReference(entry.depositReceipt.reference)} · View deposit ledger
                          →
                        </Link>
                      </p>
                    )}
                    {entry.leaseId && (
                      <p>
                        <Link
                          to={`/company/rent?leaseId=${encodeURIComponent(entry.leaseId)}`}
                        >
                          Linked rent payment · View lease ledger →
                        </Link>
                      </p>
                    )}
                    {entry.memo && <p>{entry.memo}</p>}
                    {entry.maintenanceCosts?.map(cost => <p key={cost.requestId}><Link to={`/company/maintenance/${encodeURIComponent(cost.requestId)}?${new URLSearchParams({ propertyId: entry.propertyId, nested: "true" })}`}>Linked maintenance request →</Link></p>)}
                    <RecordIdentity
                      id={entry.id}
                      reference={entry.reference}
                      label="Transaction"
                    />
                    {entry.voidedAt ? (
                      <p>Voided: {entry.voidReason}</p>
                    ) : (
                      !entry.depositReceiptId && !entry.movementId && (
                        <button
                          className="secondary"
                          onClick={() => setSelected(entry)}
                        >
                          Void transaction
                        </button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="actions">
              {cursor && (
                <button onClick={() => setCursor("")}>First page</button>
              )}
              {r.data.nextCursor && (
                <button onClick={() => setCursor(r.data!.nextCursor!)}>
                  Next page
                </button>
              )}
            </div>
          </>
        )}
      </section>
      {selected && (
        <EditorDialog
          key={selected.id}
          open={selectedOpen}
          onSaveDraft={saveSelectedDraft}
          title="Void transaction"
          onClose={() => setSelected(null)}
        >
          <p>
            {selected.property.name} · {dollars(selected.amountCents)} ·{" "}
            {formatDate(selected.occurredOn)}
          </p>
          <Form
            key={`${selected.id}:${selected.version}`}
            operation="finance.void"
            label="Void transaction"
            submit={async (form) => {
              await api(
                `/api/company/finances/${encodeURIComponent(selected.id)}/void`,
                {
                  method: "POST",
                  body: {
                    expectedVersion: selected.version,
                    reason: form.get("reason"),
                  },
                },
              );
              reload();
              setSelected(null);
            }}
          >
            <label>
              Correction reason
              <input name="reason" required maxLength={300} />
            </label>
            <p className="help">
              Voiding retains history and removes this amount from totals.
            </p>
          </Form>
        </EditorDialog>
      )}
    </>
  );
}

function CashEntryIntent({value,changed}:{value:string;changed:(value:string)=>void}) {
  const {busy,uncertain}=useEditorBusy();
  return <label>What are you recording?<select disabled={busy||uncertain} aria-label="What are you recording?" value={value} onChange={event=>changed(event.target.value)}><option value="income">Other income</option><option value="expense">Paid expense</option><option value="rent">Lease rent payment</option><option value="deposit">Security deposit receipt</option></select></label>;
}
