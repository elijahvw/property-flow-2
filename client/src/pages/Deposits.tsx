import { usePropertySearchParams } from "../usePropertySearchParams";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { EditorDialog } from "../components/EditorDialog";
import {
  PropertyNavigation,
  propertyLink,
} from "../components/PropertyNavigation";
import { RecordIdentity } from "../components/RecordIdentity";
import { Form } from "./Workspace";
import { dollars } from "./Finances";
import { downloadReport, moneyCell } from "../report-export";
type Summary = {
  requiredCents: string;
  heldCents: string;
  outstandingCents: string;
  excessHeldCents: string;
  pastDueCents: string;
};
type Lease = {
  id: string;
  propertyId: string;
  version: number;
  status: string;
  startsOn: string;
  endsOn: string | null;
  property: { name: string };
  unit: { label: string };
  resident?: { name: string | null; email: string };
};
type Receipt = {
  id: string;
  reference: string;
  occurredOn: string;
  amountCents: number;
  method: string;
  paymentReference?: string | null;
  memo?: string | null;
  cashEntry: {
    id: string;
    reference: string;
    version: number;
    voidedAt: string | null;
    voidReason?: string | null;
  };
};
type Account = {
  id: string;
  reference: string;
  leaseId: string;
  propertyId: string;
  requiredCents: number;
  dueOn: string;
  version: number;
  summary: Summary;
  lease: Lease;
  receipts: Receipt[];
  revisions?: {
    id: string;
    version: number;
    requiredCents: number;
    dueOn: string;
    reason: string;
    createdAt: string;
  }[];
};
type Detail = { businessDate: string; lease: Lease; account: Account | null };
type Kind = "setup" | "terms" | "receipt" | "void";
type Review = {
  kind: Kind;
  receiptId?: string;
  payload: Record<string, unknown>;
  lines: [string, string][];
};
function pending(key: string): Review | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(key) || "null");
    return p &&
      ["setup", "terms", "receipt", "void"].includes(p.kind) &&
      Array.isArray(p.lines) &&
      p.payload &&
      (p.kind === "void"
        ? typeof p.receiptId === "string"
        : typeof p.payload.submissionKey === "string")
      ? p
      : null;
  } catch {
    return null;
  }
}
function amount(value: FormDataEntryValue | null, allowZero = false) {
  const s = String(value || "");
  if (!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(s))
    throw new Error("Enter a USD amount with at most two decimal places.");
  const [whole, fraction = ""] = s.split("."),
    cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents > 100000000n || (!allowZero && cents === 0n))
    throw new Error(
      "Enter an amount greater than zero and no more than $1,000,000.",
    );
  return { value: s, cents };
}
function DepositMetrics({ summary }: { summary: Summary }) {
  return (
    <div
      className="rent-metrics"
      role="region"
      aria-label="Security deposit balances"
    >
      <div>
        <span>Deposit required</span>
        <strong>{dollars(summary.requiredCents)}</strong>
      </div>
      <div>
        <span>Recorded held balance</span>
        <strong>{dollars(summary.heldCents)}</strong>
        <small>Separate from rent income</small>
      </div>
      <div>
        <span>Still to collect</span>
        <strong>{dollars(summary.outstandingCents)}</strong>
        <small>{dollars(summary.pastDueCents)} past due</small>
      </div>
      {BigInt(summary.excessHeldCents) > 0n && (
        <div>
          <span>Held above requirement</span>
          <strong>{dollars(summary.excessHeldCents)}</strong>
          <small>No automatic refund or rent credit</small>
        </div>
      )}
    </div>
  );
}
function Load({ error, retry }: { error?: string; retry: () => void }) {
  return error ? (
    <div className="notice error" role="alert">
      {error}{" "}
      <button className="secondary" onClick={retry}>
        Try deposit information again
      </button>
    </div>
  ) : (
    <p role="status">Loading deposit information…</p>
  );
}
export function Deposits({ resident = false }: { resident?: boolean }) {
  const { data } = useAuth(),
    [params] = usePropertySearchParams();
  return (
    <DepositDirectory
      key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}:${params.get("propertyId") || ""}`}
      resident={resident}
    />
  );
}
function DepositDirectory({ resident }: { resident: boolean }) {
  const [params, setParams] = usePropertySearchParams(),
    propertyId = params.get("propertyId") || "",
    leaseId = params.get("leaseId") || "";
  const r = useResource<{
    businessDate: string;
    summary: Summary;
    accounts: Account[];
  }>(
    `${resident ? "/api/resident" : "/api/company"}/deposits${propertyId ? "?" + new URLSearchParams({ propertyId }) : ""}`,
    true,
    true,
  );
  const [query, setQuery] = useState(""),
    [view, setView] = useState("all"),
    [page, setPage] = useState(0);
  const rows = r.data?.accounts.filter(
    (a) =>
      `${a.lease.property.name} ${a.lease.unit.label} ${a.lease.resident?.name || ""} ${a.lease.resident?.email || ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (view === "all" ||
        BigInt(
          a.summary[
            view === "uncollected" ? "outstandingCents" : "pastDueCents"
          ],
        ) > 0n),
  );
  return (
    <>
      {propertyId && !resident && <PropertyNavigation id={propertyId} />}
      <header className="page-heading">
        <p className="eyebrow">{resident ? "Your rental" : "Money"}</p>
        <h1>Security deposits</h1>
        <p>
          Track the refundable deposit separately from rent. Receipts record
          money already received; this platform does not collect or hold funds.
        </p>
        {!resident && (
          <Link
            className="button"
            to={propertyLink("/company/rent", propertyId)}
          >
            Choose a lease to set up a deposit
          </Link>
        )}
      </header>
      {r.error && <Load error={r.error} retry={r.reload} />}{" "}
      {!r.data ? (
        !r.error && <Load retry={r.reload} />
      ) : (
        <>
          <DepositMetrics summary={r.data.summary} />
          <section className="panel">
            <div className="section-heading">
              <h2>Deposit accounts</h2>
              <span className="badge">As of {r.data.businessDate}</span>
            </div>
            <div className="form-grid">
              <label>
                Find deposit account
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Property, unit or tenant"
                />
              </label>
              <label>
                Deposit view
                <select
                  value={view}
                  onChange={(e) => {
                    setView(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">All accounts</option>
                  <option value="uncollected">Still to collect</option>
                  <option value="past_due">Past due</option>
                </select>
              </label>
            </div>
            {!rows?.length ? (
              <div className="empty-state">
                <h3>
                  {query || view !== "all"
                    ? "No matching deposit accounts"
                    : "No security deposits set up yet"}
                </h3>
                <p>
                  {resident
                    ? "Your owner or manager records the agreed deposit requirement and receipts."
                    : "Open a lease's rent ledger and choose Set up deposit. A requirement can be due before move-in."}
                </p>
              </div>
            ) : (
              <ul className="record-list">
                {rows
                  .slice(
                    Math.min(
                      page,
                      Math.max(0, Math.ceil(rows.length / 25) - 1),
                    ) * 25,
                    (Math.min(
                      page,
                      Math.max(0, Math.ceil(rows.length / 25) - 1),
                    ) +
                      1) *
                      25,
                  )
                  .map((a) => (
                    <li key={a.id}>
                      <div>
                        <h3>
                          {a.lease.property.name} · Unit {a.lease.unit.label}
                        </h3>
                        <p>
                          {a.lease.resident?.name ||
                            a.lease.resident?.email ||
                            "Your lease"}{" "}
                          · Due {a.dueOn.slice(0, 10)}
                        </p>
                        <p>
                          {dollars(a.summary.heldCents)} held ·{" "}
                          {dollars(a.summary.outstandingCents)} still to collect
                        </p>
                        <RecordIdentity
                          id={a.id}
                          reference={a.reference}
                          label="Deposit account"
                        />
                      </div>
                      <Link
                        className="button secondary"
                        to={propertyLink(
                          resident ? "/resident/deposits" : "/company/deposits",
                          propertyId,
                          { leaseId: a.leaseId },
                        )}
                      >
                        Open deposit account
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
            {!!rows?.length && (
              <div className="actions">
                <button
                  className="secondary"
                  disabled={page === 0}
                  onClick={() => setPage(Math.max(0, page - 1))}
                >
                  Previous deposit accounts
                </button>
                <button
                  className="secondary"
                  disabled={(page + 1) * 25 >= rows.length}
                  onClick={() => setPage(page + 1)}
                >
                  Next deposit accounts
                </button>
              </div>
            )}
          </section>
        </>
      )}
      {leaseId && (
        <EditorDialog
          open
          title="Security deposit account"
          onClose={() => setParams(propertyId ? { propertyId } : {})}
        >
          <DepositPanel leaseId={leaseId} resident={resident} />
          <p>
            <Link
              to={propertyLink(
                resident ? "/resident/rent" : "/company/rent",
                propertyId,
                { leaseId },
              )}
            >
              View rent ledger
            </Link>
          </p>
        </EditorDialog>
      )}
    </>
  );
}
export function DepositPanel({
  leaseId,
  resident = false,
  changed,
}: {
  leaseId: string;
  resident?: boolean;
  changed?: () => void;
}) {
  const { data } = useAuth();
  return (
    <DepositAccountPanel
      key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}:${leaseId}`}
      leaseId={leaseId}
      resident={resident}
      changed={changed}
    />
  );
}
function DepositAccountPanel({
  leaseId,
  resident,
  changed,
}: {
  leaseId: string;
  resident: boolean;
  changed?: () => void;
}) {
  const auth = useAuth().data,
    root = `${resident ? "/api/resident" : "/api/company"}/deposits/${encodeURIComponent(leaseId)}`,
    r = useResource<Detail>(root, true, true),
    key = `pf:deposit:${auth?.user.id}:${auth?.membership?.companyId}:${leaseId}`,
    retained = pending(key);
  const [editor, setEditor] = useState<{
      kind: Kind;
      snapshot: Detail;
      receipt?: Receipt;
      restored?: Review;
      revision?: string;
    } | null>(null),
    [open, setOpen] = useState(false);
  const start = (kind: Kind, receipt?: Receipt) => {
    if (!r.data) return;
    if (retained) {
      setEditor({ kind: retained.kind, snapshot: r.data, restored: retained });
    } else if (editor?.kind !== kind || editor?.receipt?.id !== receipt?.id) {
      setEditor({ kind, snapshot: r.data, receipt });
    }
    setOpen(true);
  };
  const current = r.data?.account;
  return (
    <section
      className="panel deposit-account"
      aria-label="Security deposit account"
    >
      <div className="section-heading">
        <div>
          <h2>Refundable security deposit</h2>
          <p className="help">
            A separate requirement and held balance; never an automatic rent
            credit.
          </p>
        </div>
        {r.data && !r.error && !resident && !current && (
          <button className="secondary" onClick={() => start("setup")}>
            Set up deposit
          </button>
        )}
      </div>
      {r.error && <Load error={r.error} retry={r.reload} />}{" "}
      {!r.data ? (
        !r.error && <Load retry={r.reload} />
      ) : (
        <>
          <p>
            <strong>
              {r.data.lease.property.name} · Unit {r.data.lease.unit.label}
            </strong>
            {r.data.lease.resident && (
              <>
                {" "}
                · {r.data.lease.resident.name || r.data.lease.resident.email}
              </>
            )}
          </p>
          {!resident && retained && (
            <button className="secondary" onClick={() => start(retained.kind)}>
              Recover pending deposit save
            </button>
          )}
          {!current ? (
            <p>No deposit requirement recorded for this lease.</p>
          ) : (
            <>
              <DepositMetrics summary={current.summary} />
              <p className="help">
                Due {current.dueOn.slice(0, 10)} · company date{" "}
                {r.data.businessDate}. Held balance reflects nonvoided receipts
                recorded here, not a verified bank balance.
              </p>
              <RecordIdentity
                id={current.id}
                reference={current.reference}
                label="Deposit account"
              />
              {!resident && !r.error && (
                <div className="actions">
                  <button
                    disabled={!!retained || r.data.lease.status === "draft"}
                    onClick={() => start("receipt")}
                  >
                    Record deposit received
                  </button>
                  <button
                    className="secondary"
                    disabled={!!retained}
                    onClick={() => start("terms")}
                  >
                    Change deposit requirement
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      downloadReport(
                        `security-deposit-${current.reference}.csv`,
                        [
                          [
                            "Property",
                            r.data!.lease.property.name,
                            "Unit",
                            r.data!.lease.unit.label,
                          ],
                          [
                            "Account reference",
                            current.reference,
                            "Account internal ID",
                            current.id,
                          ],
                          [
                            "Required USD",
                            moneyCell(current.summary.requiredCents),
                            "Held USD",
                            moneyCell(current.summary.heldCents),
                          ],
                          [
                            "Still to collect USD",
                            moneyCell(current.summary.outstandingCents),
                            "Business date",
                            r.data!.businessDate,
                          ],
                          [
                            "Receipt reference",
                            "Receipt internal ID",
                            "Cash reference",
                            "Cash internal ID",
                            "Received date",
                            "Amount USD",
                            "Method",
                            "Payment reference",
                            "Status",
                            "Internal note",
                            "Void reason",
                          ],
                          ...current.receipts.map((x) => [
                            x.reference,
                            x.id,
                            x.cashEntry.reference,
                            x.cashEntry.id,
                            x.occurredOn.slice(0, 10),
                            moneyCell(String(x.amountCents)),
                            x.method,
                            x.paymentReference || "",
                            x.cashEntry.voidedAt ? "Voided" : "Received",
                            x.memo || "",
                            x.cashEntry.voidReason || "",
                          ]),
                        ],
                      )
                    }
                  >
                    Download deposit CSV
                  </button>
                </div>
              )}
              {r.data.lease.status === "draft" && !resident && (
                <p className="notice">
                  The requirement is planned. Activate the lease record before
                  recording a deposit received; future leases can receive money
                  before move-in.
                </p>
              )}
              <h3>Deposit receipts</h3>
              {!current.receipts.length ? (
                <p>No deposit received yet.</p>
              ) : (
                <ul className="record-list">
                  {current.receipts.map((receipt) => (
                    <li key={receipt.id}>
                      <div>
                        <strong>
                          {dollars(receipt.amountCents)} ·{" "}
                          {receipt.cashEntry.voidedAt ? "Voided" : "Received"}
                        </strong>
                        <p>
                          {receipt.occurredOn.slice(0, 10)} ·{" "}
                          {receipt.method.replace(/_/g, " ")}
                        </p>
                        {!resident && receipt.paymentReference && (
                          <p>Payment reference: {receipt.paymentReference}</p>
                        )}
                        {!resident && receipt.memo && (
                          <p className="preserve-lines">{receipt.memo}</p>
                        )}
                        {receipt.cashEntry.voidReason && (
                          <p>Voided: {receipt.cashEntry.voidReason}</p>
                        )}
                        <RecordIdentity
                          id={receipt.id}
                          reference={receipt.reference}
                          label="Deposit receipt"
                        />
                        {!resident && (
                          <p className="help">
                            Cash source {receipt.cashEntry.reference}
                          </p>
                        )}
                      </div>
                      {!resident && !receipt.cashEntry.voidedAt && !r.error && (
                        <button
                          className="secondary"
                          disabled={!!retained}
                          onClick={() => start("void", receipt)}
                        >
                          Correct deposit receipt
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!resident && current.revisions && (
                <details>
                  <summary>Requirement history · latest 100 changes</summary>
                  <ol className="activity-list">
                    {current.revisions.map((revision) => (
                      <li key={revision.id}>
                        <strong>
                          {dollars(revision.requiredCents)} required · due{" "}
                          {revision.dueOn.slice(0, 10)}
                        </strong>
                        <p>
                          {revision.reason} · version {revision.version}
                        </p>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </>
          )}
          {!resident && !r.error && editor && (
            <EditorDialog
              open={open}
              title={
                editor.kind === "receipt"
                  ? "Record security deposit received"
                  : editor.kind === "void"
                    ? "Correct deposit receipt"
                    : "Security deposit requirement"
              }
              onClose={() => setOpen(false)}
            >
              <DepositEditor
                key={`${editor.kind}:${editor.receipt?.id || ""}:${editor.restored?.payload.submissionKey || ""}:${editor.revision || ""}`}
                detail={editor.snapshot}
                kind={editor.kind}
                receipt={editor.receipt}
                restored={editor.restored}
                storageKey={key}
                reload={async () => {
                  const snapshot = await api<Detail>(root);
                  setEditor({
                    ...editor,
                    snapshot,
                    restored: undefined,
                    revision: crypto.randomUUID(),
                    kind:
                      editor.kind === "setup" && snapshot.account
                        ? "terms"
                        : editor.kind,
                    receipt: editor.receipt
                      ? snapshot.account?.receipts.find(
                          (x) => x.id === editor.receipt!.id,
                        )
                      : undefined,
                  });
                  r.reload();
                }}
                saved={() => {
                  setOpen(false);
                  setEditor(null);
                  r.reload();
                  changed?.();
                }}
              />
            </EditorDialog>
          )}
        </>
      )}
    </section>
  );
}
function DepositEditor({
  detail,
  kind,
  receipt,
  restored,
  storageKey,
  saved,
  reload,
}: {
  detail: Detail;
  kind: Kind;
  receipt?: Receipt;
  restored?: Review;
  storageKey: string;
  saved: () => void;
  reload: () => Promise<void>;
}) {
  const [review, setReview] = useState<Review | null>(restored || null),
    [uncertain, setUncertain] = useState(!!restored),
    [stale, setStale] = useState(false);
  const base = `/api/company/deposits/${encodeURIComponent(detail.lease.id)}`,
    current = detail.account;
  return (
    <>
      {review && (
        <Form
          label={
            uncertain
              ? "Retry this deposit save"
              : kind === "receipt"
                ? "Confirm deposit received"
                : kind === "void"
                  ? "Void this deposit receipt"
                  : "Save deposit requirement"
          }
          operation={
            kind === "receipt"
              ? "deposit.receipt"
              : kind === "void"
                ? "deposit.void"
                : kind === "terms"
                  ? "deposit.update"
                  : "deposit.setup"
          }
          submit={async () => {
            sessionStorage.setItem(storageKey, JSON.stringify(review));
            setUncertain(true);
            try {
              await api(
                kind === "void"
                  ? `/api/company/deposit-receipts/${encodeURIComponent(review.receiptId!)}/void`
                  : base + (kind === "receipt" ? "/receipts" : ""),
                {
                  method: kind === "terms" ? "PATCH" : "POST",
                  body: review.payload,
                },
              );
              sessionStorage.removeItem(storageKey);
              saved();
            } catch (error) {
              if (
                error instanceof ApiError &&
                [400, 409].includes(error.status)
              ) {
                sessionStorage.removeItem(storageKey);
                setUncertain(false);
                setStale(error.status === 409);
              }
              throw error;
            }
          }}
        >
          <p className="eyebrow">Review before saving</p>
          <dl className="lease-review-summary">
            {review.lines.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="notice">
            {kind === "receipt"
              ? "Record only money already received. This creates one linked cash receipt, separate from rent income and rent credit."
              : kind === "void"
                ? "This corrects a recording error and reduces the recorded held balance. It does not refund or transfer money. Record the correct receipt separately if needed."
                : "Changing a requirement does not move money, refund a tenant or apply a deposit to rent. Use this for the refundable security deposit agreed for this lease."}
          </p>
          {uncertain ? (
            <p role="status">
              A previous save may have succeeded. Retry keeps its original
              reviewed details and submission identity.
            </p>
          ) : (
            <button
              type="button"
              className="text-button"
              onClick={() => setReview(null)}
            >
              Back to deposit details
            </button>
          )}
        </Form>
      )}
      {stale && (
        <Form
          label="Load current details and reset draft"
          operation="page.data.load"
          successText=""
          submit={reload}
        >
          <p className="notice">
            This save conflicts with the current record. Load the latest details
            and review a fresh draft before saving again. Your existing review
            remains here until you choose to reset it.
          </p>
        </Form>
      )}
      <div hidden={!!review}>
        <Form
          label={
            kind === "receipt"
              ? "Review deposit receipt"
              : kind === "void"
                ? "Review receipt correction"
                : "Review deposit requirement"
          }
          operation="page.data.load"
          successText=""
          submit={async (f) => {
            const context: [string, string][] = [
              [
                "Property and unit",
                `${detail.lease.property.name} · ${detail.lease.unit.label}`,
              ],
              [
                "Tenant",
                detail.lease.resident?.name ||
                  detail.lease.resident?.email ||
                  "Resident on this lease",
              ],
            ];
            if (kind === "void") {
              const reason = String(f.get("reason") || "");
              setReview({
                kind,
                receiptId: receipt!.id,
                payload: {
                  expectedVersion: receipt!.cashEntry.version,
                  reason,
                },
                lines: [
                  ...context,
                  ["Receipt", receipt!.reference],
                  ["Amount to void", dollars(receipt!.amountCents)],
                  ["Reason", reason],
                ],
              });
              return;
            }
            const parsed = amount(f.get("amount"), kind === "terms");
            if (kind === "receipt") {
              const occurredOn = String(f.get("occurredOn")),
                method = String(f.get("method")),
                paymentReference = String(f.get("paymentReference") || ""),
                memo = String(f.get("memo") || "");
              setReview({
                kind,
                payload: {
                  amount: parsed.value,
                  occurredOn,
                  method,
                  paymentReference: paymentReference || null,
                  memo: memo || null,
                  expectedVersion: current!.version,
                  expectedLeaseVersion: detail.lease.version,
                  submissionKey: crypto.randomUUID(),
                },
                lines: [
                  ...context,
                  ["Deposit received", dollars(String(parsed.cents))],
                  ["Received date", occurredOn],
                  ["Payment method", method.replace(/_/g, " ")],
                  ...(paymentReference
                    ? [
                        ["Payment reference", paymentReference] as [
                          string,
                          string,
                        ],
                      ]
                    : []),
                  [
                    "Held after receipt",
                    dollars(
                      String(BigInt(current!.summary.heldCents) + parsed.cents),
                    ),
                  ],
                  ...(memo
                    ? [["Internal note", memo] as [string, string]]
                    : []),
                ],
              });
            } else {
              const dueOn = String(f.get("dueOn")),
                reason = String(f.get("reason") || "");
              setReview({
                kind,
                payload: {
                  amount: parsed.value,
                  dueOn,
                  expectedLeaseVersion: detail.lease.version,
                  submissionKey: crypto.randomUUID(),
                  ...(kind === "terms"
                    ? { expectedVersion: current!.version, reason }
                    : {}),
                },
                lines: [
                  ...context,
                  [
                    "Refundable deposit required",
                    dollars(String(parsed.cents)),
                  ],
                  ["Deposit due date", dueOn],
                  ...(kind === "terms"
                    ? [["Reason for change", reason] as [string, string]]
                    : []),
                ],
              });
            }
          }}
        >
          <p>
            <strong>
              {detail.lease.property.name} · Unit {detail.lease.unit.label}
            </strong>
          </p>
          {kind !== "void" && (
            <label>
              {kind === "receipt"
                ? "Deposit amount received (USD)"
                : "Refundable deposit required (USD)"}
              <input
                name="amount"
                inputMode="decimal"
                required
                maxLength={11}
                defaultValue={
                  kind === "terms"
                    ? (current!.requiredCents / 100).toFixed(2)
                    : kind === "receipt" &&
                        BigInt(current!.summary.outstandingCents) > 0n
                      ? (
                          Number(current!.summary.outstandingCents) / 100
                        ).toFixed(2)
                      : ""
                }
                placeholder="0.00"
              />
            </label>
          )}
          {(kind === "setup" || kind === "terms") && (
            <>
              <label>
                Deposit due date
                <input
                  name="dueOn"
                  type="date"
                  required
                  defaultValue={
                    current?.dueOn.slice(0, 10) ||
                    detail.lease.startsOn.slice(0, 10)
                  }
                />
              </label>
              <p className="help">
                Use the agreed due date, including a date before move-in. This
                is a refundable security deposit, not advance rent or a
                nonrefundable fee.
              </p>
            </>
          )}
          {kind === "receipt" && (
            <>
              <label>
                Deposit received date
                <input
                  name="occurredOn"
                  type="date"
                  required
                  max={detail.businessDate}
                  defaultValue={detail.businessDate}
                />
              </label>
              <label>
                Deposit payment method
                <select name="method" required defaultValue="">
                  <option value="" disabled>
                    Choose the method received
                  </option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                  <option value="check">Check</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Deposit payment reference (optional)
                <input name="paymentReference" maxLength={100} />
              </label>
              <label>
                Internal deposit receipt note (optional)
                <textarea name="memo" maxLength={500} />
              </label>
              <p className="help">
                Receipts above the requirement remain held separately. They are
                not automatically applied to rent or refunded.
              </p>
            </>
          )}
          {(kind === "terms" || kind === "void") && (
            <label>
              {kind === "void"
                ? "Deposit correction reason"
                : "Reason for deposit change"}
              <textarea name="reason" required maxLength={300} />
            </label>
          )}
        </Form>
      </div>
    </>
  );
}
