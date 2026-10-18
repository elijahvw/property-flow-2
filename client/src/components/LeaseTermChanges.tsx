import {ResidentLifecycleHistory} from "./LeaseLifecycle";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { api } from "../api";
import { Form } from "./Form";
import { dollars } from "../money";
import { DateField } from "./DateField";
import { EditorDialog } from "./EditorDialog";
import { DraftReset } from "./DraftReset";
import { formatDate, formatMonth } from "../dates";
import { recordReference } from "../record-reference";
import { downloadReport, moneyCell } from "../report-export";
import "./LeaseTermChanges.css";
type Policy = {
  rentCents: number;
  rentDueDay: number;
  graceDays: number;
  paymentInstructions: string | null;
  effectiveOn?: string | null;
};
type Change = Policy & {
  id: string;
  reference: string;
  effectiveOn: string;
  before: Policy;
  reason: string;
  createdAt: string;
  status: string;
  cancellation: null | { id: string; reason: string; createdAt: string };
};
type Data = {
  businessDate: string;
  lease: Policy & {
    id: string;
    version: number;
    status: string;
    property: { name: string };
    unit: { label: string };
  };
  current: Policy;
  baseline: Policy;
  changes: Change[];
  pending: Change | null;
  earliestEffectiveOn: string;
  schedule: null | { id: string; status: string };
};
type Installment = {
  periodOn: string;
  before: {
    amountCents: number;
    dueOn: string;
    postOn: string;
    graceDays: number;
  };
  after: {
    amountCents: number;
    dueOn: string;
    postOn: string;
    graceDays: number;
  };
  action: string;
  amountOverride: boolean;
  dueOverride: boolean;
};
type Preview = {
  kind: "change" | "cancel";
  effectiveOn: string;
  reason: string;
  before: Policy;
  after: Policy;
  installments: Installment[];
  continues: boolean;
  horizonDescription: string;
  schedule: null | { id: string; status: string };
  sourceHash: string;
  expectedLeaseVersion: number;
};
type Review = {
  kind: "change" | "cancel";
  changeId?: string;
  body: Record<string, unknown>;
  preview: Preview;
  attempted?: boolean;
};
function retained(key: string): Review | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(key) || "null");
    return r && r.attempted &&
      ["change", "cancel"].includes(r.kind) &&
      typeof r.body?.submissionKey === "string" &&
      Array.isArray(r.preview?.installments)
      ? r
      : null;
  } catch {
    return null;
  }
}
function PolicyDetails({ value }: { value: Policy }) {
  return (
    <>
      <dl className="term-policy-facts">
        <div>
          <dt>Monthly rent</dt>
          <dd>{dollars(value.rentCents)}</dd>
        </div>
        <div>
          <dt>Rent due</dt>
          <dd>Day {value.rentDueDay}</dd>
        </div>
        <div>
          <dt>Grace period</dt>
          <dd>
            {value.graceDays} {value.graceDays === 1 ? "day" : "days"}
          </dd>
        </div>
      </dl>
      <div className="term-instructions">
        <span>Payment instructions</span>
        <p>{value.paymentInstructions || "Not supplied"}</p>
      </div>
    </>
  );
}
function Compare({ before, after }: { before: Policy; after: Policy }) {
  return (
    <div className="term-comparison">
      <section>
        <h3>Before</h3>
        <PolicyDetails value={before} />
      </section>
      <section>
        <h3>After the effective date</h3>
        <PolicyDetails value={after} />
      </section>
    </div>
  );
}
export function ResidentLeaseTerms() {
  const { leaseId = "" } = useParams();
  return (
    <>
      <nav className="record-breadcrumb">
        <Link to={`/resident/leases/${encodeURIComponent(leaseId)}/statement`}>
          ← Back to tenant statement
        </Link>
      </nav>
      <header className="page-heading">
        <p className="record-kicker">My rental</p>
        <h1>Lease terms & changes</h1>
        <p>Your current terms and the recorded changes to come.</p>
      </header>
      <LeaseTermChanges leaseId={leaseId} resident />
      <ResidentLifecycleHistory leaseId={leaseId}/>
    </>
  );
}
export function LeaseTermChanges({
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
    <TermsWorkspace
      key={`${leaseId}:${data?.user.id}:${data?.membership?.companyId}`}
      leaseId={leaseId}
      resident={resident}
      changed={changed}
    />
  );
}
function TermsWorkspace({
  leaseId,
  resident,
  changed,
}: {
  leaseId: string;
  resident: boolean;
  changed?: () => void;
}) {
  const { data: auth } = useAuth(),
    root = `/api/${resident ? "resident" : "company"}/leases/${encodeURIComponent(leaseId)}/terms`,
    storage = `pf:lease-terms:${auth?.user.id}:${auth?.membership?.companyId}:${leaseId}`;
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<{ data: Data; changeId?: string } | null>(
      null,
    ),
    [review, setReview] = useState<Review | null>(() =>
      resident ? null : retained(storage),
    ),
    [historyPage, setHistoryPage] = useState(0);
  const r = useResource<Data>(root, true, !open),
    d = r.data;
  useEffect(() => {
    const refresh = (e: Event) => {
      if ((e as CustomEvent).detail === leaseId && !open) r.reload();
    };
    window.addEventListener("lease-terms-changed", refresh);
    return () => window.removeEventListener("lease-terms-changed", refresh);
  }, [leaseId, open]);
  const clear = () => {
    sessionStorage.removeItem(storage);
    setReview(null);
    setDraft(null);
    setOpen(false);
  };
  if (!d)
    return (
      <section className="panel">
        {r.error ? (
          <>
            <p className="notice error" role="alert">
              {r.error}
            </p>
            <button className="secondary" onClick={r.reload}>
              Refresh terms
            </button>
          </>
        ) : (
          <p role="status">Loading lease terms…</p>
        )}
      </section>
    );
  const rows = d.changes.slice().reverse(),
    page = Math.min(historyPage, Math.max(0, Math.ceil(rows.length / 10) - 1));
  return (
    <div className="lease-term-workspace">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="record-kicker">Lease agreement</p>
            <h2>Current payment terms</h2>
            <p className="help">
              As of {formatDate(d.businessDate)} · {d.lease.property.name} ·{" "}
              {d.lease.unit.label}
            </p>
          </div>
          {!resident && !review && !d.pending && (
            <button
              disabled={!!r.error || d.lease.status !== "active"}
              onClick={() => {
                setDraft((prev) => prev || { data: d });
                setOpen(true);
              }}
            >
              Schedule a term change
            </button>
          )}
        </div>
        {r.error ? (
          <p className="notice error" role="alert">
            Current terms could not be refreshed. {r.error}{" "}
            <button className="secondary" onClick={r.reload}>
              Refresh terms
            </button>
          </p>
        ) : (
          <PolicyDetails value={d.current} />
        )}
        {d.current.effectiveOn && (
          <p className="section-caption">
            In effect since {formatDate(d.current.effectiveOn)}
          </p>
        )}
        {!resident && d.lease.status !== "active" && (
          <p className="help">
            Future term changes require an active lease record.
          </p>
        )}
        <p className="help">
          Due days 29–31 use the last day of shorter months. Grace is counted in
          calendar days after the due date.
        </p>
        {review && !resident && (
          <div className="notice movement-pending">
            <span>An unfinished terms review is retained.</span>
            <button className="secondary" onClick={() => setOpen(true)}>
              Resume terms review
            </button>
            <DraftReset reset={clear} />
          </div>
        )}
      </section>
      {!r.error && d.pending && (
        <section className="panel scheduled-term-card">
          <div className="section-heading">
            <div>
              <p className="record-kicker">Upcoming change</p>
              <h2>Starts {formatDate(d.pending.effectiveOn)}</h2>
              <p>{d.pending.reason}</p>
            </div>
            <span className="tenant-status">Scheduled</span>
          </div>
          <Compare before={d.pending.before} after={d.pending} />
          <div className="actions">
            <span className="section-caption">
              {recordReference(d.pending.reference)}
            </span>
            {!resident && !review && (
              <button
                className="text-button"
                onClick={() => {
                  setDraft(
                    (prev) => prev || { data: d, changeId: d.pending!.id },
                  );
                  setOpen(true);
                }}
              >
                Cancel scheduled change
              </button>
            )}
          </div>
          <p className="help">
            This changes future agreed terms. Posted rent and recorded payments
            stay unchanged.{" "}
            {resident
              ? "Contact management if you need to discuss this change."
              : "Review or cancel this change before scheduling another."}
          </p>
        </section>
      )}
      {!resident && (
        <details className="panel term-guidance">
          <summary>How future changes work</summary>
          <p>
            Changes start with a full future rent month. Review the affected
            installments before saving. Active billing uses the effective terms;
            paused billing stays paused. A missing schedule stays manual.
          </p>
          <p>
            Previously reviewed first/final installment amounts and the first
            due-date override are retained and identified in the preview. No
            automatic proration or late fee is added.
          </p>
          <p>
            Recorded rent months, including voided history, cannot be repriced.
            Use a separately reviewed charge or credit for an agreed difference.
          </p>
          <Link
            to={`/company/rent?leaseId=${encodeURIComponent(leaseId)}&leaseReturn=${encodeURIComponent(leaseId)}`}
          >
            Review charges, credits & billing →
          </Link>
        </details>
      )}
      {!!rows.length && (
        <details className="panel term-history">
          <summary>
            Term change history · {rows.length}{" "}
            {rows.length === 1 ? "record" : "records"}
          </summary>
          <div className="section-heading">
            <p className="help">
              Original terms, reasons and cancellations are retained.
            </p>
            <button
              className="text-button"
              onClick={() =>
                downloadReport("lease-term-history.csv", [
                  [
                    "Reference",
                    "Source ID",
                    "Effective date",
                    "Status",
                    "Reason",
                    "Before monthly rent USD",
                    "After monthly rent USD",
                    "Before due day",
                    "After due day",
                    "Before grace days",
                    "After grace days",
                    "Before instructions",
                    "After instructions",
                    "Recorded at",
                    "Cancellation source ID",
                    "Cancellation date",
                    "Cancellation reason",
                  ],
                  ...rows.map((c) => [
                    c.reference,
                    c.id,
                    c.effectiveOn.slice(0, 10),
                    c.status,
                    c.reason,
                    moneyCell(String(c.before.rentCents)),
                    moneyCell(String(c.rentCents)),
                    String(c.before.rentDueDay),
                    String(c.rentDueDay),
                    String(c.before.graceDays),
                    String(c.graceDays),
                    c.before.paymentInstructions || "",
                    c.paymentInstructions || "",
                    c.createdAt,
                    c.cancellation?.id || "",
                    c.cancellation?.createdAt || "",
                    c.cancellation?.reason || "",
                  ]),
                ])
              }
            >
              Download term history
            </button>
          </div>
          {rows.slice(page * 10, page * 10 + 10).map((c) => (
            <article key={c.id}>
              <div className="section-heading">
                <div>
                  <h3>
                    {formatDate(c.effectiveOn)} · {recordReference(c.reference)}
                  </h3>
                  <p>{c.reason}</p>
                </div>
                <span className="tenant-status neutral">
                  {(
                    {
                      cancelled: "Cancelled",
                      scheduled: "Scheduled",
                      superseded: "Previous terms",
                      in_effect: "In effect",
                    } as Record<string, string>
                  )[c.status] || c.status}
                </span>
              </div>
              <details>
                <summary>Compare recorded terms</summary>
                <Compare before={c.before} after={c} />
              </details>
              {c.cancellation && (
                <p className="term-cancelled">
                  Cancelled {formatDate(c.cancellation.createdAt)} ·{" "}
                  {c.cancellation.reason}
                </p>
              )}
              <p className="section-caption">
                Recorded {formatDate(c.createdAt)}
              </p>
            </article>
          ))}
          {rows.length > 10 && (
            <nav className="actions" aria-label="Term history pages">
              <button
                className="secondary"
                disabled={!page}
                onClick={() => setHistoryPage(page - 1)}
              >
                Previous changes
              </button>
              <span>
                Page {page + 1} of {Math.ceil(rows.length / 10)}
              </span>
              <button
                className="secondary"
                disabled={(page + 1) * 10 >= rows.length}
                onClick={() => setHistoryPage(page + 1)}
              >
                Next changes
              </button>
            </nav>
          )}
        </details>
      )}
      {!resident && (
        <EditorDialog
          open={open} hasChanges={!!review}
          title={
            review
              ? review.kind === "cancel"
                ? "Confirm term cancellation"
                : "Confirm future terms"
              : draft?.changeId
                ? "Cancel scheduled term change"
                : "Plan future lease terms"
          }
          description={`${d.lease.property.name} · ${d.lease.unit.label}`}
          onClose={() => setOpen(false)} onDiscard={clear}
        >
          {review ? (
            <>
              <p className="record-kicker">
                {review.kind === "cancel"
                  ? "Cancel upcoming terms"
                  : "Future change"}{" "}
                · {formatDate(review.preview.effectiveOn)}
              </p>
              <p>{review.preview.reason}</p>
              <Compare
                before={review.preview.before}
                after={review.preview.after}
              />
              <InstallmentReview preview={review.preview} />
              <Form
                recovering={!!review.attempted}
                label={
                  review.kind === "cancel"
                    ? "Confirm cancellation"
                    : "Confirm term change"
                }
                operation="lease.update"
                feedbackText={
                  review.kind === "cancel"
                    ? "Future term change cancelled. History retained."
                    : "Future lease terms saved. Posted financial records are unchanged."
                }
                secondaryActions={
                  !review.attempted && draft ? (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        sessionStorage.removeItem(storage);
                        setReview(null);
                      }}
                    >
                      Back to term details
                    </button>
                  ) : undefined
                }
                submit={async (form) => {
                  if (form.get("confirmed") !== "on")
                    throw new Error(
                      "Confirm the reviewed installment effects.",
                    );
                  if (r.error)
                    throw new Error("Refresh lease terms before saving.");
                  const attempt = { ...review, attempted: true };
                  sessionStorage.setItem(storage, JSON.stringify(attempt));
                  setReview(attempt);
                  await api(
                    root +
                      (review.kind === "cancel"
                        ? `/${encodeURIComponent(review.changeId!)}/cancel`
                        : ""),
                    {
                      method: "POST",
                      body: { ...review.body, confirmed: true },
                    },
                  );
                  clear();
                  r.reload();
                  changed?.();
                  window.dispatchEvent(
                    new CustomEvent("lease-terms-changed", { detail: leaseId }),
                  );
                }}
              >
                <label className="movement-confirm">
                  <input type="checkbox" name="confirmed" required />I confirm
                  these terms and installment effects reflect the agreed lease
                  change. Posted charges will not be changed.
                </label>
                <p className="help">
                  Saving a term change does not send a notice, sign an agreement
                  or move money. Retry an interrupted save using this same
                  review.
                </p>
                <DraftReset reset={clear} />
              </Form>
            </>
          ) : null}
          {draft && (
            <div hidden={!!review}>
              <TermsEditor
                root={root}
                snapshot={draft.data}
                changeId={draft.changeId}
                reviewed={(value) => {

                  setReview(value);
                }}
              />
            </div>
          )}
        </EditorDialog>
      )}
    </div>
  );
}
function TermsEditor({
  root,
  snapshot,
  changeId,
  reviewed,
}: {
  root: string;
  snapshot: Data;
  changeId?: string;
  reviewed: (r: Review) => void;
}) {
  const [step, setStep] = useState(0),
    [first, setFirst] = useState<Record<string, FormDataEntryValue>>({}),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const current = snapshot.current;
  return (
    <Form
      reviewOnly
      label={
        changeId
          ? "Review cancellation"
          : step === 0
            ? "Continue to new terms"
            : "Review future terms"
      }
      operation="page.data.load"
      successText=""
      secondaryActions={
        step === 1 ? (
          <button
            type="button"
            className="secondary"
            onClick={() => setStep(0)}
          >
            Previous step
          </button>
        ) : undefined
      }
      submit={async (form) => {
        const captured = { ...first, ...Object.fromEntries(form) };
        setFirst(captured);
        if (!changeId && step === 0) {
          setStep(1);
          return;
        }
        const body = changeId
          ? {
              reason: String(captured.reason),
              expectedLeaseVersion: snapshot.lease.version,
            }
          : {
              effectiveOn: String(captured.effectiveOn),
              monthlyRent: String(captured.monthlyRent),
              rentDueDay: Number(captured.rentDueDay),
              graceDays: Number(captured.graceDays),
              paymentInstructions: captured.paymentInstructions || null,
              reason: String(captured.reason),
              expectedLeaseVersion: snapshot.lease.version,
            };
        const preview = await api<Preview>(
          root +
            (changeId
              ? `/${encodeURIComponent(changeId)}/cancel-preview`
              : "/preview"),
          { method: "POST", body },
        );
        reviewed({
          kind: changeId ? "cancel" : "change",
          changeId,
          body: {
            ...body,
            sourceHash: preview.sourceHash,
            submissionKey: crypto.randomUUID(),
          },
          preview,
        });
      }}
    >
      {!changeId && (
        <div className="term-form-step">
          <p className="record-kicker">Step {step + 1} of 2</p>
          <h3 tabIndex={-1} ref={heading}>
            {step === 0 ? "When & why" : "New payment terms"}
          </h3>
        </div>
      )}
      <fieldset
        hidden={step !== 0}
        disabled={step !== 0}
        className="form-section"
      >
        <legend>
          {changeId ? "Cancellation reason" : "Effective date & reason"}
        </legend>
        {!changeId && (
          <>
            <label>
              Effective date
              <DateField
                name="effectiveOn"
                aria-label="Effective date"
                required
                min={snapshot.earliestEffectiveOn.slice(0, 10)}
                defaultValue={snapshot.earliestEffectiveOn.slice(0, 10)}
              />
            </label>
            <p className="help">
              Use the first day of a full future rent month. Earliest available:{" "}
              {formatDate(snapshot.earliestEffectiveOn)}.
            </p>
          </>
        )}
        <label>
          {changeId
            ? "Cancellation reason shown to the tenant"
            : "Reason shown to the tenant"}
          <textarea name="reason" required rows={3} maxLength={500} />
        </label>
        {changeId && (
          <p className="help">
            Cancellation keeps the original change and its history. The preview
            shows which future installments return to the prior terms.
          </p>
        )}
      </fieldset>
      {!changeId && (
        <fieldset
          hidden={step !== 1}
          disabled={step !== 1}
          className="form-section"
        >
          <legend>Rent & payment terms</legend>
          <div className="term-form-grid">
            <label>
              New monthly rent (USD)
              <input
                name="monthlyRent"
                required
                type="number"
                min="0.01"
                max="1000000"
                step="0.01"
                defaultValue={(current.rentCents / 100).toFixed(2)}
              />
            </label>
            <label>
              New rent due day
              <select
                name="rentDueDay"
                aria-label="New rent due day"
                defaultValue={current.rentDueDay}
              >
                {Array.from({ length: 31 }, (_, i) => (
                  <option value={i + 1} key={i + 1}>
                    Day {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <label>
              New grace period (days)
              <input
                name="graceDays"
                type="number"
                required
                min={0}
                max={30}
                step={1}
                defaultValue={current.graceDays}
              />
            </label>
          </div>
          <label>
            New payment instructions · optional
            <textarea
              name="paymentInstructions"
              maxLength={1000}
              rows={3}
              defaultValue={current.paymentInstructions || ""}
            />
          </label>
          <p className="help">
            These instructions are shared with approved leaseholders. Grace uses
            calendar days; no automatic late fee or proration is added.
          </p>
        </fieldset>
      )}
    </Form>
  );
}
function InstallmentReview({ preview: p }: { preview: Preview }) {
  const [page, setPage] = useState(0),
    index = Math.min(
      page,
      Math.max(0, Math.ceil(p.installments.length / 12) - 1),
    );
  return (
    <section className="term-installment-review">
      <h3>Affected installments</h3>
      <p className="help">{p.horizonDescription}</p>
      <p className="notice">
        {!p.schedule
          ? "No recurring schedule is enabled. These terms will be used for future rent months; posting remains manual until billing is separately enabled."
          : p.schedule.status === "paused"
            ? "The schedule stays paused. These terms apply if you explicitly resume billing."
            : "Active billing will use the terms for each rent month when posting is due."}
      </p>
      {p.installments.length ? (
        <ol className="term-installments">
          {p.installments.slice(index * 12, index * 12 + 12).map((i) => (
            <li key={i.periodOn}>
              <h4>{formatMonth(i.periodOn)}</h4>
              <div className="term-installment-values">
                <div>
                  <span>Before</span>
                  <strong>{dollars(i.before.amountCents)}</strong>
                  <p>
                    Due {formatDate(i.before.dueOn)} · {i.before.graceDays} days
                    grace
                  </p>
                </div>
                <div>
                  <span>After</span>
                  <strong>{dollars(i.after.amountCents)}</strong>
                  <p>
                    Due {formatDate(i.after.dueOn)} · {i.after.graceDays} days
                    grace
                  </p>
                  {p.schedule && <p>Posts {formatDate(i.after.postOn)}</p>}
                </div>
              </div>
              {(i.amountOverride || i.dueOverride) && (
                <p className="term-override">
                  Previously reviewed{" "}
                  {i.amountOverride ? "first/final amount" : ""}
                  {i.amountOverride && i.dueOverride ? " and " : ""}
                  {i.dueOverride ? "first due date" : ""} retained.
                </p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p>
          No remaining installments in the recorded schedule horizon. The lease
          terms still change; no schedule is started or extended.
        </p>
      )}
      {p.installments.length > 12 && (
        <nav className="actions" aria-label="Affected installment pages">
          <button
            className="secondary"
            disabled={!index}
            onClick={() => setPage(index - 1)}
          >
            Previous installments
          </button>
          <span>
            Page {index + 1} of {Math.ceil(p.installments.length / 12)}
          </span>
          <button
            className="secondary"
            disabled={(index + 1) * 12 >= p.installments.length}
            onClick={() => setPage(index + 1)}
          >
            Next installments
          </button>
        </nav>
      )}
      <button
        className="text-button"
        onClick={() =>
          downloadReport("reviewed-future-installments.csv", [
            [
              "Rent month",
              "Before amount USD",
              "After amount USD",
              "Before due date",
              "After due date",
              "Before grace days",
              "After grace days",
              "After posting date",
              "Billing state",
              "Amount override retained",
              "First due override retained",
            ],
            ...p.installments.map((i) => [
              i.periodOn.slice(0, 7),
              moneyCell(String(i.before.amountCents)),
              moneyCell(String(i.after.amountCents)),
              i.before.dueOn.slice(0, 10),
              i.after.dueOn.slice(0, 10),
              String(i.before.graceDays),
              String(i.after.graceDays),
              p.schedule ? i.after.postOn.slice(0, 10) : "",
              i.action,
              i.amountOverride ? "yes" : "no",
              i.dueOverride ? "yes" : "no",
            ]),
          ])
        }
      >
        Download installment preview
      </button>
    </section>
  );
}
