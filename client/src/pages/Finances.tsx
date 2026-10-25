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
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { availableFeatureRoute, featureKeysForPage } from "../company-features";
import { useResource } from "../useResource";
import { EditorDialog, useEditorBusy } from "../components/EditorDialog";
import { Form } from "../components/Form";
import { useFinanceCreateRecovery, type FinanceCreateBody } from "../finance-create-recovery";
import { useTenantAttemptContext } from "../tenant-write-access";
import "./FinancialForms.css";
import "./CashWorkspace.css";
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
  const { can, data: auth } = useAuth();
  const recovery = useFinanceCreateRecovery();
  const voidContext = useTenantAttemptContext(auth);
  const [params, setParams, pathPropertyId] = usePropertySearchParams();
  const maintenanceReturn = params.get("maintenanceReturn") || "",
    entryId = params.get("entryId") || "";
  const [adding, setAdding] = useState(["transaction", "expense"].includes(params.get("new") || "")),
    [selected, setSelected, selectedOpen, saveSelectedDraft] = useEditorSelection<Entry | null>(null);
  const [key, setKey] = useState<string>(() => crypto.randomUUID()),
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
    setDraftProperty(propertyId);
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
  const writable = can("finance.manage") && !auth?.impersonation && featureKeysForPage("/company/finances", auth?.membership?.role).every(feature => (auth?.companyFeatures?.[feature] || "enabled") === "enabled");
  const deniedCurrentRead = [r.errorStatus, properties.errorStatus].some(status => status !== undefined && [401, 403, 404].includes(status));
  const voidConcealed = deniedCurrentRead || !voidContext.current();
  const voidReadPending = r.loading || properties.loading || !!r.error || !!properties.error || !r.data || !properties.data;
  useEffect(() => { if (deniedCurrentRead) recovery.readDenied(); }, [deniedCurrentRead]);
  const recoveryPropertyMismatch = !!recovery.request && !!pathPropertyId && recovery.request.body.propertyId !== pathPropertyId;
  const recoveryHidden = recovery.pending && (!recovery.request || deniedCurrentRead);
  useEffect(() => {
    if (recovery.request) {
      setKey(recovery.request.body.submissionKey);
      setKind(recovery.request.body.kind);
      setEntryMode(recovery.request.body.kind);
    }
  }, [recovery.request]);
  const financialRoute = (path: string) => availableFeatureRoute(path, auth?.companyFeatures, auth?.membership?.role);
  const applyFilters = (next: typeof filters) => {
    const search = new URLSearchParams(params);
    for (const [name, value] of Object.entries(next)) {
      if (value) search.set(name, value); else search.delete(name);
    }
    search.delete("entryId");
    setFilters(next); setDraftProperty(next.propertyId); setParams(search); setCursor("");
  };
  const clearFilters = () => applyFilters({ propertyId: pathPropertyId || "", dateFrom: "", dateTo: "" });
  const activeFilters = [
    ...(!pathPropertyId && filters.propertyId ? [{ key: "propertyId", label: properties.data?.find(property => property.id === filters.propertyId)?.name || "Selected property" }] : []),
    ...(filters.dateFrom ? [{ key: "dateFrom", label: `From ${formatDate(filters.dateFrom)}` }] : []),
    ...(filters.dateTo ? [{ key: "dateTo", label: `Through ${formatDate(filters.dateTo)}` }] : []),
  ];
  return (
    <>
      {filters.propertyId && <PropertyNavigation id={filters.propertyId} />}
      <header className="page-heading">
        {maintenanceReturn && <p><Link to={`/company/maintenance/${encodeURIComponent(maintenanceReturn)}?${new URLSearchParams({ propertyId: filters.propertyId, ...(pathPropertyId ? { nested: "true" } : {}) })}`}>← Back to maintenance request</Link></p>}
        <p className="eyebrow">Company operations</p>
        <h1>Cash activity</h1>
        <p>
          Track money already received or paid, with the source and correction history retained.
          Lease payments and refundable deposits belong to their lease accounts; their linked cash records appear here automatically.
        </p>
        {entryId && <p className="notice">Showing the selected transaction. <button className="text-button" onClick={() => { const next = new URLSearchParams(params); next.delete("entryId"); setParams(next); setCursor(""); }}>Show all transactions</button></p>}
      </header>
      <section className="cash-entry-paths" aria-label="Choose financial workflow">
        <div className="section-heading"><div><h2>Start with the right source</h2><p className="help">Record each movement once. A cash record does not collect or transfer money.</p></div></div>
        <div className="workflow-path">
          {financialRoute("/company/rent") && <Link className="workflow-step" to={propertyLink("/company/rent", filters.propertyId)}><strong>Lease rent &amp; balances</strong><span>Record a rent payment against its lease, allocate it and review what is still owed.</span><span className="cash-path-link">Open Rent &amp; payments →</span></Link>}
          {financialRoute("/company/deposits") && <Link className="workflow-step" to={propertyLink("/company/deposits", filters.propertyId)}><strong>Security deposits</strong><span>Record funds held for a lease and follow applications, refunds and retained history.</span><span className="cash-path-link">Open Deposits →</span></Link>}
          <div className="workflow-step"><strong>Other income &amp; paid expenses</strong><p>Record money already received or paid outside a linked lease receipt.</p><button disabled={recovery.pending ? recoveryHidden || recoveryPropertyMismatch : !writable || r.loading || !!r.error || properties.loading || !!properties.error} onClick={() => setAdding(true)}>Record a transaction</button>{writable && !recovery.pending && financialRoute("/company/imports/expenses") && <Link to="/company/imports/expenses">Import paid expenses →</Link>}{!writable && <p className="help">Cash activity is read-only in the current workspace.</p>}</div>
        </div>
      </section>
      {recovery.pending && <section className="notice" aria-label="Unfinished cash transaction">
        <h2>Recover the submitted transaction</h2>
        <p>A submitted cash transaction is retained in this tab. Recover its original request before recording another manual transaction.</p>
        {recovery.checking && <p role="status">Checking current access to the original property…</p>}
        {recovery.error && <p role="alert">{recovery.error}</p>}
        {recoveryHidden && !recovery.checking && recovery.canRead && <button type="button" className="secondary" onClick={recovery.retryRead}>Check cash recovery access</button>}
        {recoveryPropertyMismatch && <Link className="button secondary" to={propertyLink("/company/finances", recovery.request!.body.propertyId)}>Open original property to recover</Link>}
        {recovery.request && !recoveryHidden && !recoveryPropertyMismatch && <button type="button" className="secondary" onClick={() => setAdding(true)}>Review unfinished transaction</button>}
        {recovery.request && !writable && <p>The original review is kept. Recording and retrying are blocked while cash activity is read-only.</p>}
      </section>}
      {!recoveryHidden && !recoveryPropertyMismatch && <EditorDialog
        open={adding && !recoveryHidden && !recoveryPropertyMismatch}
        title="Record a transaction"
        hasChanges={recovery.pending}
        onDiscard={() => { if (recovery.pending) return; setAdding(false); setKey(crypto.randomUUID()); setEntryMode(params.get("new")==="expense"?"expense":"income"); setKind(params.get("new")==="expense"?"expense":"income"); setDraftProperty(filters.propertyId); }}
        onClose={() => setAdding(false)}
      >
        <CashEntryIntent value={entryMode} locked={recovery.pending || !writable} changed={value=>{setEntryMode(value);if(["income","expense"].includes(value))setKind(value);}}/>
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
            recovering={recovery.pending}
            locked={!writable || recoveryHidden || r.loading || !!r.error || properties.loading || !!properties.error}
            secondaryActions={
              !recovery.pending && <DraftReset
                reset={() => {
                  setKind(params.get("new") === "expense" ? "expense" : "income");
                  setKey(crypto.randomUUID());
                }}
              />
            }
            label="Record transaction"
            submit={async (form) => {
              const body: FinanceCreateBody = recovery.request?.body || {
                  propertyId: String(form.get("propertyId")),
                  occurredOn: String(form.get("occurredOn")),
                  amount: String(form.get("amount")),
                  kind: String(form.get("kind")) as "income" | "expense",
                  category: String(form.get("category")),
                  memo: form.get("memo") ? String(form.get("memo")) : null,
                  submissionKey: key,
              };
              await recovery.run(body);
              reload();
              setAdding(false);
              setKey(crypto.randomUUID());
              setParams({
                propertyId: pathPropertyId || body.propertyId,
                ...(maintenanceReturn ? { maintenanceReturn } : {}),
              });
            }}
          >
            <fieldset disabled={recovery.pending} className="editor-contents">
            <label>
              <span className="financial-field-label">Transaction property <span className="financial-required" aria-hidden="true">required</span></span>
              <select
                name="propertyId"
                aria-label="Transaction property"
                required
                defaultValue={recovery.request?.body.propertyId || filters.propertyId}
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
                <DateField name="occurredOn" aria-label="Date received or paid" required defaultValue={recovery.request?.body.occurredOn} />
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
                  defaultValue={recovery.request?.body.amount}
                />
              </label>
            </div>
            <input type="hidden" name="kind" value={kind}/>
            <label htmlFor="finance-category">Category
              <select id="finance-category" key={kind} name="category" aria-label="Category" defaultValue={recovery.request?.body.category}>
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
              <textarea name="memo" maxLength={500} defaultValue={recovery.request?.body.memo || ""} />
            </label>
            {kind==="income"&&<p className="help">Rent received for a saved lease belongs in <Link to={propertyLink("/company/rent",filters.propertyId)}>Rent &amp; payments</Link>. An unlinked historical rent entry does not change a lease balance.</p>}
            <p className="help">
              To correct a saved amount, void the entry and record a
              replacement. Your original history is retained.
            </p>
            </fieldset>
          </Form>
        )}
        </div>
      </EditorDialog>}
      <section className="panel directory-workbench cash-history">
        <div className="cash-history-heading"><h2>Transaction history</h2><p>Filter the complete history; totals include every matching page and exclude voided entries.</p></div>
        <div className="cash-filter-bar">
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
            applyFilters(next);
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
        </div>
        {!!activeFilters.length && <div className="filter-chips cash-active-filters" aria-label="Applied transaction filters">{activeFilters.map(filter => <button className="filter-chip" type="button" key={filter.key} aria-label={`Remove ${filter.label} filter`} onClick={() => applyFilters({ ...filters, [filter.key]: "" })}>{filter.label}<span aria-hidden="true">×</span></button>)}<button className="text-button" type="button" onClick={clearFilters}>Clear transaction filters</button></div>}
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
              {r.data.summary.depositReceivedCents !== undefined && <div>
                <span>Deposits received</span>
                <strong>
                  {dollars(r.data.summary.depositReceivedCents)}
                </strong>
              </div>}
            </div>
            <p className="help">
              {r.data.summary.rentRefundCents !== undefined && <>Rent refunds: {dollars(r.data.summary.rentRefundCents)}. </>}{r.data.summary.depositRefundCents !== undefined && <>Deposit refunds: {dollars(r.data.summary.depositRefundCents)}. </>}Operating net subtracts rent refunds and excludes refundable deposits and deposit returns. Dates are inclusive.
              Totals exclude voided entries and include every matching page.
            </p>
            <p role="status">{r.data.items.length} transactions on this page</p>
            {!r.data.items.length ? (
              <p>No matching transactions.</p>
            ) : (
              <ul className="record-list cash-records">
                {r.data.items.map((entry) => (
                  <li key={entry.id}>
                    <div className="cash-record-heading">
                    <h3>
                      {entry.property.name} ·{" "}
                      {entry.kind === "deposit"
                        ? "deposit receipt"
                        : entry.kind}{" "}
                      · {dollars(entry.amountCents)}
                    </h3>
                    <span className={`cash-record-state ${entry.voidedAt ? "is-voided" : ""}`}>{entry.voidedAt ? "Voided · history retained" : "Recorded"}</span>
                    </div>
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
                          {recordReference(entry.depositReceipt.reference)} · View deposit history
                          →
                        </Link>
                      </p>
                    )}
                    {entry.leaseId && (
                      <p>
                        <Link
                          to={propertyLink("/company/rent", entry.propertyId, { leaseId: entry.leaseId })}
                        >
                          Linked rent payment · View rent &amp; payments →
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
                          disabled={!writable}
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
            <nav className="actions directory-pagination" aria-label="Transaction history pages">
              {cursor && (
                <button onClick={() => setCursor("")}>First page</button>
              )}
              {r.data.nextCursor && (
                <button onClick={() => setCursor(r.data!.nextCursor!)}>
                  Next page
                </button>
              )}
            </nav>
          </>
        )}
      </section>
      {selected && (
        <EditorDialog
          key={selected.id}
          open={selectedOpen && !voidConcealed}
          onSaveDraft={saveSelectedDraft}
          title="Void transaction"
          onClose={() => setSelected(null)}
        >
          {!voidConcealed && <p>
            {selected.property.name} · {dollars(selected.amountCents)} ·{" "}
            {formatDate(selected.occurredOn)}
          </p>}
          {!voidConcealed && voidReadPending && <p role="status">Current cash access must be checked before this correction can continue.</p>}
          <Form
            key={`${selected.id}:${selected.version}`}
            operation="finance.void"
            locked={!writable || voidConcealed || voidReadPending}
            label="Void transaction"
            submit={async (form) => {
              if (!voidContext.current() || !writable || voidReadPending || voidConcealed)
                throw new Error("Check current cash access before continuing this correction. The original request is kept.");
              await api(
                `/api/company/finances/${encodeURIComponent(selected.id)}/void`,
                {
                  method: "POST",
                  expectedCompanyId: voidContext.companyId,
                  body: {
                    expectedVersion: selected.version,
                    reason: form.get("reason"),
                  },
                },
              );
              if (!voidContext.current()) throw new ApiError("Your workspace changed before this correction was acknowledged. Keep the original request for recovery.", 409, "FINANCE_CONTEXT_CHANGED", true);
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

function CashEntryIntent({value,changed,locked=false}:{value:string;changed:(value:string)=>void;locked?:boolean}) {
  const {busy,uncertain}=useEditorBusy();
  return <label>What are you recording?<select disabled={busy||uncertain||locked} aria-label="What are you recording?" value={value} onChange={event=>changed(event.target.value)}><option value="income">Other income</option><option value="expense">Paid expense</option><option value="rent">Lease rent payment</option><option value="deposit">Security deposit receipt</option></select></label>;
}
