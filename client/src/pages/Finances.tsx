import { Link, useSearchParams } from "react-router-dom";
import { DraftReset } from "../components/DraftReset";
import { PropertyNavigation } from "../components/PropertyNavigation";
import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "./Workspace";
type Entry = {
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
  summary: { incomeCents: string; expenseCents: string; netCents: string };
};
export function dollars(value: string | number) {
  const amount = BigInt(value),
    negative = amount < 0n,
    absolute = negative ? -amount : amount;
  return `${negative ? "-" : ""}$${(absolute / 100n).toLocaleString("en-US")}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
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
  const [routeParams] = useSearchParams();
  return (
    <LedgerWorkspace
      key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}:${routeParams.get("propertyId") || ""}`}
    />
  );
}
function LedgerWorkspace() {
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.get("new") === "transaction"),
    [selected, setSelected] = useState<Entry | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID()),
    [kind, setKind] = useState("income"),
    [filters, setFilters] = useState({
      propertyId: params.get("propertyId") || "",
      dateFrom: params.get("dateFrom") || "",
      dateTo: params.get("dateTo") || "",
    }),
    [cursor, setCursor] = useState("");
  const [draftProperty, setDraftProperty] = useState(filters.propertyId);
  const properties = useResource<{ id: string; name: string }[]>(
    "/api/company/properties",
  );
  const query = new URLSearchParams(
    Object.entries({ ...filters, cursor }).filter(([, v]) => v),
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
        <p className="eyebrow">Company operations</p>
        <h1>Manual finances</h1>
        <p>
          Record income received and expenses paid, in USD. These records do not
          collect payments. Use <Link to="/company/rent">Rent & balances</Link>{" "}
          to record lease payments and track balances owed. Keep deposits and
          transfers outside this ledger.
        </p>
        <button onClick={() => setAdding(true)}>Record a transaction</button>
      </header>
      <EditorDialog
        open={adding}
        title="Record a transaction"
        onClose={() => setAdding(false)}
      >
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
                  setKind("income");
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
              setParams({ propertyId: String(form.get("propertyId")) });
            }}
          >
            <label>
              Transaction property
              <select
                name="propertyId"
                required
                defaultValue={filters.propertyId}
              >
                {properties.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date received or paid
              <input name="occurredOn" type="date" required />
            </label>
            <label>
              Amount (USD)
              <input
                name="amount"
                type="number"
                min="0.01"
                max="1000000"
                step="0.01"
                required
              />
            </label>
            <label>
              Transaction type
              <select
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="income">Income received</option>
                <option value="expense">Expense paid</option>
              </select>
            </label>
            <label htmlFor="finance-category">Category</label>
            <select id="finance-category" key={kind} name="category">
              {(kind === "income"
                ? ["rent", "other"]
                : ["repairs", "utilities", "insurance", "property_tax", "other"]
              ).map((c) => (
                <option key={c} value={c}>
                  {c.replace("_", " ")}
                </option>
              ))}
            </select>
            <label>
              Memo (optional)
              <textarea name="memo" maxLength={500} />
            </label>
            <p className="help">
              To correct a saved amount, void the entry and record a
              replacement. Your original history is retained.
            </p>
          </Form>
        )}
      </EditorDialog>
      <section className="panel">
        <h2>Transaction history</h2>
        <Form
          label="Apply filters"
          operation="page.data.load"
          submit={async (form) => {
            setFilters({
              propertyId: String(form.get("propertyId") || ""),
              dateFrom: String(form.get("dateFrom") || ""),
              dateTo: String(form.get("dateTo") || ""),
            });
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
              <option value="">All properties</option>
              {properties.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            From date
            <input
              name="dateFrom"
              type="date"
              defaultValue={filters.dateFrom}
            />
          </label>
          <label>
            Through date
            <input name="dateTo" type="date" defaultValue={filters.dateTo} />
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
            </div>
            <p className="help">
              Dates are inclusive. Totals exclude voided entries and include
              every matching page.
            </p>
            <p role="status">{r.data.items.length} transactions on this page</p>
            {!r.data.items.length ? (
              <p>No matching transactions.</p>
            ) : (
              <ul className="record-list">
                {r.data.items.map((entry) => (
                  <li key={entry.id}>
                    <h3>
                      {entry.property.name} · {entry.kind} ·{" "}
                      {dollars(entry.amountCents)}
                    </h3>
                    <p>
                      {entry.occurredOn.slice(0, 10)} ·{" "}
                      {entry.category.replace("_", " ")}
                    </p>
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
                    {entry.voidedAt ? (
                      <p>Voided: {entry.voidReason}</p>
                    ) : (
                      <button
                        className="secondary"
                        onClick={() => setSelected(entry)}
                      >
                        Void transaction
                      </button>
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
          open
          title="Void transaction"
          onClose={() => setSelected(null)}
        >
          <p>
            {selected.property.name} · {dollars(selected.amountCents)} ·{" "}
            {selected.occurredOn.slice(0, 10)}
          </p>
          <Form
            key={`${selected.id}:${selected.version}`}
            operation="finance.void"
            label={`Void transaction ${selected.id}`}
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
