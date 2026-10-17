import { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import { useResource } from "../useResource";
import { Form } from "./Form";
import { PersonalAddressFields } from "../pages/AccountProfile";
import type { Statement } from "../statement";
import { statementPath } from "../statement";
import { dollars } from "../money";
import { formatDate, formatMonth } from "../dates";
import { recordReference } from "../record-reference";
import { downloadReport, moneyCell } from "../report-export";
import { DateField } from "./DateField";
import { EditorDialog } from "./EditorDialog";
import { DraftReset } from "./DraftReset";
import { Address } from "./Address";
import "./LeaseSettlement.css";
type Snapshot = {
  basis: string;
  lease: {
    id: string;
    status: string;
    startsOn: string;
    endsOn: string | null;
    property: { name: string };
    unit: { label: string };
  };
  financial: Pick<Statement, "current" | "items" | "allocations">;
  deposit: {
    id: string;
    reference: string;
    heldCents: string;
    returnedCents: string;
    appliedCents: string;
    receipts: {
      id: string;
      reference: string;
      occurredOn: string;
      amountCents: number;
      voidedAt: string | null;
    }[];
    movements: NonNullable<Statement["deposit"]>["movements"];
  } | null;
  schedules: {
    id: string;
    status: string;
    version: number;
    nextPeriodOn: string;
  }[];
  itemizedApplications?: {
    id: string;
    reference: string;
    chargeId: string;
    amountCents: number;
    evidenceReference: string;
  }[];
};
type Revision = {
  id: string;
  reference: string;
  version: number;
  action: string;
  movedOutOn: string;
  reason: string;
  forwarding?: Record<string, string | null>;
  snapshot: Snapshot;
  createdAt: string;
  actorLabel?: string;
};
type Data = {
  businessDate: string;
  lease: Snapshot["lease"] & { version: number };
  settlement: { id: string; status: string; version: number } | null;
  latest: Revision | null;
  revisions: Revision[];
  nextBeforeVersion: number | null;
  sourceChanged: boolean;
  current?: Snapshot;
  activeBillingCount?: number;
};
type Preview = {
  sourceHash: string;
  before: Snapshot;
  after: {
    outstandingCents: string;
    depositHeldCents: string;
    paymentCreditCents: string;
  };
  applications: {
    chargeId: string;
    amountCents: number;
    evidenceReference: string;
    charge: Statement["items"][number];
  }[];
  pauseSchedules: Snapshot["schedules"];
  plannedAppliedCents: string;
};
type Review = {
  body: Record<string, unknown>;
  preview: Preview;
  attempted?: boolean;
};
const chargeLabel = (c: Statement["items"][number]) =>
  c.description || `${formatMonth(c.periodOn)} rent`;
function retained(key: string): Review | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(key) || "null");
    return r &&
      r.body &&
      typeof r.body.submissionKey === "string" &&
      r.preview?.before?.financial
      ? r
      : null;
  } catch {
    return null;
  }
}
function Totals({
  outstanding,
  held,
  credit,
}: {
  outstanding: string;
  held: string;
  credit: string;
}) {
  return (
    <dl className="settlement-totals">
      <div>
        <dt>Charges still unpaid</dt>
        <dd>{dollars(outstanding)}</dd>
        <p>Remains due on the lease</p>
      </div>
      <div>
        <dt>Deposit available to return</dt>
        <dd>{dollars(held)}</dd>
        <p>Requires a recorded refund</p>
      </div>
      <div>
        <dt>Unapplied payment credit</dt>
        <dd>{dollars(credit)}</dd>
        <p>Separate from the deposit</p>
      </div>
    </dl>
  );
}
export function ResidentSettlement() {
  const { leaseId = "" } = useParams();
  return (
    <>
      <nav className="record-breadcrumb">
        <Link to={statementPath(leaseId, true)}>
          ← Back to tenant statement
        </Link>
      </nav>
      <header className="page-heading">
        <p className="record-kicker">My rental</p>
        <h1>Move-out settlement</h1>
        <p>The saved review and its original financial sources.</p>
      </header>
      <LeaseSettlement leaseId={leaseId} resident />
    </>
  );
}
export function LeaseSettlement({
  leaseId,
  resident = false,
}: {
  leaseId: string;
  resident?: boolean;
}) {
  const { data } = useAuth();
  return (
    <SettlementWorkspace
      key={`${leaseId}:${data?.user.id}:${data?.membership?.companyId}`}
      leaseId={leaseId}
      resident={resident}
    />
  );
}
function SettlementWorkspace({
  leaseId,
  resident,
}: {
  leaseId: string;
  resident: boolean;
}) {
  const { data: auth } = useAuth(),
    root = `/api/${resident ? "resident" : "company"}/leases/${encodeURIComponent(leaseId)}/settlement`,
    key = `pf:settlement:${auth?.user.id}:${auth?.membership?.companyId}:${leaseId}`;
  const [before, setBefore] = useState<number | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [draft, setDraft] = useState<Data | null>(null),
    [review, setReview] = useState<Review | null>(() =>
      resident ? null : retained(key),
    ),
    [open, setOpen] = useState(false),
    [reopening, setReopening] = useState(false);
  const [reopenKey, setReopenKey] = useState(() => crypto.randomUUID()),
    [reopenBody, setReopenBody] = useState<Record<string, unknown> | null>(
      null,
    );
  const r = useResource<Data>(
      root + (before ? `?beforeVersion=${before}` : ""),
      true,
      !open,
    ),
    d = r.data;
  useEffect(() => {
    const refresh = (e: Event) => {
      if ((e as CustomEvent).detail === leaseId && !open) r.reload();
    };
    window.addEventListener("lease-money-changed", refresh);
    return () => window.removeEventListener("lease-money-changed", refresh);
  }, [leaseId, open]);
  const clear = () => {
    sessionStorage.removeItem(key);
    setReview(null);
    setDraft(null);
    setOpen(false);
  };
  const history = d?.revisions || [],
    revision =
      (selected ? history.find((v) => v.id === selected) : null) ||
      (before ? history[0] : null) ||
      d?.latest;
  if (r.error)
    return (
      <section className="panel">
        <h2>Settlement unavailable</h2>
        <p className="notice error" role="alert">
          {r.error}
        </p>
        <button className="secondary" onClick={r.reload}>
          Refresh settlement
        </button>
      </section>
    );
  if (!d) return <p role="status">Loading move-out settlement…</p>;
  return (
    <div className="settlement-workspace">
      <section className="panel settlement-intro">
        <div className="section-heading">
          <div>
            <p className="record-kicker">Move-out review</p>
            <h2>
              {resident
                ? `${d.lease.property.name} · ${d.lease.unit.label}`
                : "Move-out settlement"}
            </h2>
            <p>
              {d.settlement?.status === "finalized"
                ? "A settlement is saved. Review its sources and complete any remaining steps."
                : d.settlement
                  ? "The settlement is open for a revised review. Earlier versions remain in history."
                  : "Bring posted charges, deposit funds and remaining balances into one itemized review."}
            </p>
          </div>
          <span className="tenant-status">
            {d.settlement?.status === "finalized"
              ? "Saved"
              : d.settlement
                ? "Reopened"
                : "Not yet reviewed"}
          </span>
        </div>
        {!resident && (
          <details className="settlement-guidance">
            <summary>How settlement works</summary>
            <ol className="settlement-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Review the ledger</strong>
                  <p>
                    Record agreed charges or credits before preparing the
                    settlement.
                  </p>
                  <Link
                    to={`/company/rent?leaseId=${encodeURIComponent(leaseId)}&leaseReturn=${encodeURIComponent(leaseId)}`}
                  >
                    Review rent & charges →
                  </Link>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Prepare & confirm</strong>
                  <p>
                    Record the actual move-out, supporting references and any
                    deposit applications.
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Complete the follow-up</strong>
                  <p>
                    Record refunds actually paid and review the lease end
                    separately.
                  </p>
                </div>
              </li>
            </ol>
          </details>
        )}
        {!resident && d.current && (
          <>
            <p className="section-caption">
              Current recorded balances · As of {formatDate(d.businessDate)}
            </p>
            <Totals
              outstanding={d.current.financial.current.outstandingCents}
              held={d.current.deposit?.heldCents || "0"}
              credit={d.current.financial.current.creditCents}
            />
            <div className="actions">
              {!review && d.settlement?.status !== "finalized" && (
                <button
                  disabled={d.lease.status === "draft"}
                  onClick={() => {
                    setDraft((prev) => prev || d);
                    setOpen(true);
                  }}
                >
                  Prepare settlement
                </button>
              )}
              {d.settlement?.status === "finalized" && (
                <button
                  className="secondary"
                  onClick={() => setReopening(true)}
                >
                  Reopen for a revised review
                </button>
              )}
              <Link
                to={statementPath(leaseId, false, { statementFrom: "lease" })}
              >
                View current statement →
              </Link>
            </div>
            {d.lease.status === "draft" && (
              <p className="help">
                An actual move-out settlement requires an active or ended lease.
              </p>
            )}
          </>
        )}
        {review && !resident && (
          <div className="notice movement-pending">
            <span>Your unfinished settlement review is retained.</span>
            <button className="secondary" onClick={() => setOpen(true)}>
              Resume settlement review
            </button>
            <DraftReset reset={clear} />
          </div>
        )}
      </section>
      {!resident && d.settlement?.status === "finalized" && (
        <section className="panel settlement-followup">
          <h2>Finish the move-out</h2>
          <p>
            A saved settlement records the review. Complete the remaining
            actions using their original records.
          </p>
          <div className="settlement-links">
            <Link
              to={`/company/deposits?leaseId=${encodeURIComponent(leaseId)}&leaseReturn=${encodeURIComponent(leaseId)}`}
            >
              <strong>Return deposit funds</strong>
              <span>
                Record money already returned and retain its payment reference.
              </span>
            </Link>
            <Link
              to={`/company/rent?leaseId=${encodeURIComponent(leaseId)}&leaseReturn=${encodeURIComponent(leaseId)}`}
            >
              <strong>Resolve rent & payment credit</strong>
              <span>Record refunds or collect the remaining balance.</span>
            </Link>
            <Link
              to={`/company/leases/${encodeURIComponent(leaseId)}?section=overview`}
            >
              <strong>Review lease end</strong>
              <span>
                {d.lease.status === "active"
                  ? "This lease remains active. Review terms and its end date."
                  : `Current lease status: ${d.lease.status}.`}
              </span>
            </Link>
          </div>
          <p className="help">
            Reopening preserves all prior reviews and money movements. It does
            not reverse applications or resume recurring billing.
          </p>
        </section>
      )}
      {revision ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="record-kicker">Saved history</p>
              <h2>
                {revision.action === "reopened"
                  ? "Settlement reopened"
                  : "Itemized settlement"}{" "}
                · Version {revision.version}
              </h2>
              <p>
                {recordReference(revision.reference)} · Saved{" "}
                {formatDate(revision.createdAt)}
                {revision.actorLabel ? ` · ${revision.actorLabel}` : ""}
              </p>
            </div>
            <button
              className="secondary"
              onClick={() => exportRevision(revision)}
            >
              Download this review
            </button>
          </div>
          {d.sourceChanged && revision.id === d.latest?.id && (
            <p className="notice">
              There is new financial, lease or billing activity since this saved
              review. Its recorded amounts are preserved.{" "}
              {resident
                ? "See your current statement for updated balances."
                : "Review the current statement before taking another action."}
            </p>
          )}
          <div className="settlement-history-toolbar">
            <label>
              Saved version
              <select
                value={revision.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {!history.some((v) => v.id === d.latest?.id) && d.latest && (
                  <option value={d.latest.id}>
                    Version {d.latest.version} · {d.latest.action}
                  </option>
                )}
                {history.map((v) => (
                  <option key={v.id} value={v.id}>
                    Version {v.version} · {v.action} · {formatDate(v.createdAt)}
                  </option>
                ))}
              </select>
            </label>
            <nav className="actions" aria-label="Settlement history pages">
              {before && (
                <button
                  className="text-button"
                  onClick={() => {
                    setBefore(null);
                    setSelected(null);
                  }}
                >
                  Latest versions
                </button>
              )}
              {d.nextBeforeVersion && (
                <button
                  className="text-button"
                  onClick={() => {
                    setBefore(d.nextBeforeVersion);
                    setSelected(null);
                  }}
                >
                  Older versions
                </button>
              )}
            </nav>
          </div>
          <div className="settlement-facts">
            <div>
              <span className="section-caption">Actual move-out date</span>
              <p>
                <strong>{formatDate(revision.movedOutOn)}</strong>
              </p>
            </div>
            <div>
              <span className="section-caption">
                Reason shared with the tenant
              </span>
              <p>{revision.reason}</p>
            </div>
          </div>
          <Totals
            outstanding={revision.snapshot.financial.current.outstandingCents}
            held={revision.snapshot.deposit?.heldCents || "0"}
            credit={revision.snapshot.financial.current.creditCents}
          />
          {!!revision.snapshot.itemizedApplications?.length && (
            <>
              <h3>Deposit applied in this version</h3>
              <ol className="settlement-lines">
                {revision.snapshot.itemizedApplications.map((a) => (
                  <li key={a.id}>
                    <div>
                      <strong>
                        {revision.snapshot.financial.items.find(
                          (c) => c.id === a.chargeId,
                        )
                          ? chargeLabel(
                              revision.snapshot.financial.items.find(
                                (c) => c.id === a.chargeId,
                              )!,
                            )
                          : "Retained charge"}
                      </strong>
                      <p>{a.evidenceReference}</p>
                      <span className="section-caption">
                        {recordReference(a.reference)}
                      </span>
                    </div>
                    <strong>{dollars(a.amountCents)}</strong>
                  </li>
                ))}
              </ol>
            </>
          )}
          <SavedSources key={revision.id} snapshot={revision.snapshot} />
          {!resident && revision.forwarding && (
            <details className="settlement-source">
              <summary>Forwarding details · management only</summary>
              {revision.forwarding.status === "provided" ? (
                <>
                  <Address
                    street={revision.forwarding.addressLine1}
                    line2={revision.forwarding.addressLine2}
                    city={revision.forwarding.city}
                    region={revision.forwarding.region}
                    postalCode={revision.forwarding.postalCode}
                    country={revision.forwarding.country}
                  />
                  <p>
                    {revision.forwarding.email} {revision.forwarding.phone}
                  </p>
                </>
              ) : (
                <p>Not supplied at this review.</p>
              )}
            </details>
          )}
          <p className="help">{revision.snapshot.basis}</p>
        </section>
      ) : resident ? (
        <section className="panel">
          <h2>No settlement saved yet</h2>
          <p>Your property team’s saved move-out review will appear here.</p>
        </section>
      ) : null}

      {!resident && (
        <>
          <EditorDialog
            open={open}
            title={
              review
                ? "Confirm move-out settlement"
                : "Prepare move-out settlement"
            }
            description={`${d.lease.property.name} · ${d.lease.unit.label}`}
            onClose={() => setOpen(false)}
          >
            {review ? (
              <>
                <p className="record-kicker">Review before saving</p>
                <div className="settlement-facts">
                  <div>
                    <span className="section-caption">
                      Actual move-out date
                    </span>
                    <p>{formatDate(String(review.body.movedOutOn))}</p>
                  </div>
                  <div>
                    <span className="section-caption">
                      Reason shared with tenant
                    </span>
                    <p>{String(review.body.reason)}</p>
                  </div>
                </div>
                <ForwardingReview
                  forwarding={
                    review.body.forwarding as Record<string, string | null>
                  }
                />
                <h3>Balances after the proposed applications</h3>
                <Totals
                  outstanding={review.preview.after.outstandingCents}
                  held={review.preview.after.depositHeldCents}
                  credit={review.preview.after.paymentCreditCents}
                />
                <ol className="settlement-lines">
                  {review.preview.applications.map((a) => (
                    <li key={a.chargeId}>
                      <div>
                        <strong>{chargeLabel(a.charge)}</strong>
                        <p>{a.evidenceReference}</p>
                        <span className="section-caption">
                          Unpaid before {dollars(a.charge.remainingCents)}
                        </span>
                      </div>
                      <strong>{dollars(a.amountCents)}</strong>
                    </li>
                  ))}
                </ol>
                {!review.preview.applications.length && (
                  <p>No deposit applications proposed.</p>
                )}
                <p className="notice">
                  {review.preview.pauseSchedules.length} active recurring
                  schedule(s) will be paused. Deposit applications will be
                  recorded as of the company’s current date. Refunds must be
                  recorded after money is actually returned.
                </p>
                <Form
                  label="Save settlement"
                  operation="finance.create"
                  feedbackText="Move-out settlement saved. Review the remaining follow-up steps."
                  secondaryActions={
                    !review.attempted && draft ? (
                      <button
                        className="secondary"
                        type="button"
                        onClick={() => {
                          sessionStorage.removeItem(key);
                          setReview(null);
                        }}
                      >
                        Back to settlement details
                      </button>
                    ) : undefined
                  }
                  submit={async (form) => {
                    if (form.get("confirmed") !== "on")
                      throw new Error("Confirm the reviewed settlement.");
                    const attempt = { ...review, attempted: true };
                    sessionStorage.setItem(key, JSON.stringify(attempt));
                    setReview(attempt);
                    await api(root, {
                      method: "POST",
                      body: { ...attempt.body, confirmed: true },
                    });
                    clear();
                    setBefore(null);
                    setSelected(null);
                    r.reload();
                    window.dispatchEvent(
                      new CustomEvent("lease-money-changed", {
                        detail: leaseId,
                      }),
                    );
                  }}
                >
                  <label className="movement-confirm">
                    <input type="checkbox" name="confirmed" required />I have
                    reviewed the sources and supporting references, and confirm
                    any deposit applications are authorized under the lease or
                    agreement.
                  </label>
                  <p className="help">
                    Saving preserves an itemized version. It does not send
                    money, end the lease or waive debt. Retry an interrupted
                    save with this same review.
                  </p>
                  <DraftReset reset={clear} />
                </Form>
              </>
            ) : null}
            {draft && (
              <div hidden={!!review}>
                <SettlementEditor
                  data={draft}
                  root={root}
                  reviewed={(next) => {
                    sessionStorage.setItem(key, JSON.stringify(next));
                    setReview(next);
                  }}
                />
              </div>
            )}
          </EditorDialog>
          <EditorDialog
            open={reopening}
            title="Reopen settlement review"
            onClose={() => setReopening(false)}
          >
            <Form
              key={reopenKey}
              label="Reopen settlement"
              operation="lease.update"
              feedbackText="Settlement reopened. Earlier reviews and money history are preserved."
              submit={async (form) => {
                const body = reopenBody || {
                  reason: String(form.get("reason")),
                  expectedLeaseVersion: d.lease.version,
                  expectedSettlementVersion: d.settlement?.version,
                  submissionKey: reopenKey,
                };
                setReopenBody(body);
                await api(root + "/reopen", { method: "POST", body });
                setReopening(false);
                setReopenBody(null);
                setReopenKey(crypto.randomUUID());
                setBefore(null);
                setSelected(null);
                r.reload();
              }}
            >
              <label>
                Reason for reopening shown to the tenant
                <textarea
                  name="reason"
                  required
                  rows={3}
                  maxLength={500}
                  readOnly={!!reopenBody}
                  defaultValue={String(reopenBody?.reason || "")}
                />
              </label>
              <p className="help">
                This preserves prior reviews. Money movements and billing
                schedules keep their current state.
              </p>
              <DraftReset
                reset={() => {
                  setReopenBody(null);
                  setReopenKey(crypto.randomUUID());
                }}
              />
            </Form>
          </EditorDialog>
        </>
      )}
    </div>
  );
}
function SettlementEditor({
  data,
  root,
  reviewed,
}: {
  data: Data;
  root: string;
  reviewed: (r: Review) => void;
}) {
  const [step, setStep] = useState(0),
    [values, setValues] = useState<Record<string, FormDataEntryValue>>({}),
    stepHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    stepHeading.current?.focus();
  }, [step]);
  const [forwarding, setForwarding] = useState(
      data.latest?.forwarding?.status || "not_supplied",
    ),
    [lines, setLines] = useState<
      {
        key: string;
        chargeId: string;
        amount: string;
        evidenceReference: string;
      }[]
    >([]);
  const charges = data.current!.financial.items.filter(
      (c) =>
        c.type === "charge" && !c.voidedAt && BigInt(c.remainingCents) > 0n,
    ),
    held = data.current?.deposit?.heldCents || "0";
  return (
    <Form
      label={step === 3 ? "Review settlement" : "Continue"}
      operation="page.data.load"
      successText=""
      secondaryActions={
        step > 0 ? (
          <button
            type="button"
            className="secondary"
            onClick={() => setStep((s) => s - 1)}
          >
            Previous step
          </button>
        ) : undefined
      }
      submit={async (form) => {
        const captured = { ...values, ...Object.fromEntries(form) };
        setValues(captured);
        if (step < 3) {
          setStep((s) => s + 1);
          return;
        }
        const body = {
          movedOutOn: String(captured.movedOutOn),
          reason: String(captured.reason),
          forwarding:
            forwarding === "not_supplied"
              ? { status: forwarding }
              : {
                  status: forwarding,
                  ...Object.fromEntries(
                    [
                      "addressLine1",
                      "addressLine2",
                      "city",
                      "region",
                      "postalCode",
                      "country",
                      "email",
                      "phone",
                    ].map((k) => [k, captured[k] || null]),
                  ),
                },
          applications: lines.map(({ key: _key, ...line }) => line),
          pauseBilling: form.get("pauseBilling") === "on",
          expectedLeaseVersion: data.lease.version,
          expectedSettlementVersion: data.settlement?.version ?? 0,
        };
        const preview = await api<Preview>(root + "/preview", {
          method: "POST",
          body,
        });
        reviewed({
          body: {
            ...body,
            sourceHash: preview.sourceHash,
            submissionKey: crypto.randomUUID(),
          },
          preview,
        });
      }}
    >
      <div className="settlement-progress">
        <p className="record-kicker">Step {step + 1} of 4</p>
        <h3 tabIndex={-1} ref={stepHeading}>
          {
            [
              "Move-out details",
              "Forwarding details",
              "Deposit applications",
              "Recurring billing",
            ][step]
          }
        </h3>
        <div aria-hidden="true">
          {[0, 1, 2, 3].map((n) => (
            <span className={n <= step ? "complete" : ""} key={n} />
          ))}
        </div>
      </div>
      <fieldset
        className="form-section"
        hidden={step !== 0}
        disabled={step !== 0}
      >
        <legend>1 · Move-out details</legend>
        <label>
          Actual move-out date
          <DateField
            name="movedOutOn"
            aria-label="Actual move-out date"
            min={data.lease.startsOn.slice(0, 10)}
            max={data.businessDate}
            defaultValue={
              data.latest?.movedOutOn.slice(0, 10) || data.businessDate
            }
            required
          />
        </label>
        <label>
          Reason shown to the tenant
          <textarea
            name="reason"
            maxLength={500}
            rows={3}
            required
            placeholder="Describe the move-out review and any agreed adjustments."
          />
        </label>
      </fieldset>
      <fieldset
        className="form-section"
        hidden={step !== 1}
        disabled={step !== 1}
      >
        <legend>2 · Forwarding details</legend>
        <p className="help">
          These details are for management. They are excluded from the tenant’s
          settlement view.
        </p>
        <label>
          Forwarding address
          <select
            value={forwarding}
            onChange={(e) => setForwarding(e.target.value)}
          >
            <option value="not_supplied">Not supplied yet</option>
            <option value="provided">Record a forwarding address</option>
          </select>
        </label>
        <div hidden={forwarding !== "provided"}>
          {forwarding === "provided" && (
            <>
              <PersonalAddressFields
                required
                value={data.latest?.forwarding || {}}
              />
              <div className="profile-fields">
                <label>
                  Forwarding email · optional
                  <input
                    name="email"
                    type="email"
                    maxLength={254}
                    defaultValue={data.latest?.forwarding?.email || ""}
                  />
                </label>
                <label>
                  Forwarding phone · optional
                  <input
                    name="phone"
                    type="tel"
                    maxLength={40}
                    defaultValue={data.latest?.forwarding?.phone || ""}
                  />
                </label>
              </div>
            </>
          )}
        </div>
      </fieldset>
      <fieldset
        className="form-section"
        hidden={step !== 2}
        disabled={step !== 2}
      >
        <legend>3 · Itemized deposit applications</legend>
        <div className="movement-context">
          <span>Deposit currently held</span>
          <strong>{dollars(held)}</strong>
          <p>
            Use existing unpaid charges. Record missing charges in the rent
            ledger before continuing.
          </p>
        </div>
        {lines.map((line, index) => (
          <div className="settlement-application" key={line.key}>
            <div className="section-heading">
              <h4>Application {index + 1}</h4>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  setLines((previous) =>
                    previous.filter((l) => l.key !== line.key),
                  )
                }
                aria-label={`Remove application ${index + 1}`}
              >
                Remove
              </button>
            </div>
            <label>
              Charge for application {index + 1}
              <select
                aria-label={`Charge for application ${index + 1}`}
                required
                value={line.chargeId}
                onChange={(e) =>
                  setLines((old) =>
                    old.map((l) =>
                      l.key === line.key
                        ? { ...l, chargeId: e.target.value }
                        : l,
                    ),
                  )
                }
              >
                <option value="">Choose an unpaid charge</option>
                {charges.map((c) => (
                  <option
                    key={c.id}
                    value={c.id}
                    disabled={lines.some(
                      (l) => l.key !== line.key && l.chargeId === c.id,
                    )}
                  >
                    {chargeLabel(c)} · {dollars(c.remainingCents)} unpaid
                  </option>
                ))}
              </select>
            </label>
            <label>
              Application {index + 1} amount (USD)
              <input
                required
                inputMode="decimal"
                pattern="(0|[1-9][0-9]{0,6})([.][0-9]{1,2})?"
                placeholder="0.00"
                value={line.amount}
                onChange={(e) =>
                  setLines((old) =>
                    old.map((l) =>
                      l.key === line.key ? { ...l, amount: e.target.value } : l,
                    ),
                  )
                }
              />
            </label>
            <label>
              Supporting reference for application {index + 1}
              <textarea
                required
                maxLength={500}
                rows={2}
                value={line.evidenceReference}
                placeholder="Lease clause, agreed itemization or inspection reference"
                onChange={(e) =>
                  setLines((old) =>
                    old.map((l) =>
                      l.key === line.key
                        ? { ...l, evidenceReference: e.target.value }
                        : l,
                    ),
                  )
                }
              />
            </label>
            <p className="help">
              This reference is shared with the tenant. It records your evidence
              reference; no document is uploaded here.
            </p>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={
            lines.length >= Math.min(charges.length, 25) || BigInt(held) <= 0n
          }
          onClick={() =>
            setLines((old) => [
              ...old,
              {
                key: crypto.randomUUID(),
                chargeId: "",
                amount: "",
                evidenceReference: "",
              },
            ])
          }
        >
          Add deposit application
        </button>
        <p className="help">
          You can save with no applications. Held deposit funds then remain
          available for a separately recorded return.
        </p>
      </fieldset>
      <fieldset
        className="form-section"
        hidden={step !== 3}
        disabled={step !== 3}
      >
        <legend>4 · Recurring billing</legend>
        {data.activeBillingCount ? (
          <>
            <label className="movement-confirm">
              <input name="pauseBilling" type="checkbox" required />
              Pause the {data.activeBillingCount} reviewed active recurring
              schedule(s) when saving.
            </label>
            <p className="help">
              Previously posted charges remain. Review the lease’s end date
              separately.
            </p>
          </>
        ) : (
          <p>No active recurring schedules to pause.</p>
        )}
      </fieldset>
    </Form>
  );
}
function SavedSources({ snapshot }: { snapshot: Snapshot }) {
  const [page, setPage] = useState(0),
    items = snapshot.financial.items,
    index = Math.min(page, Math.max(0, Math.ceil(items.length / 20) - 1));
  return (
    <details className="settlement-source">
      <summary>
        Review original financial sources · {items.length} rent / charge records
      </summary>
      <ol className="settlement-lines">
        {items.slice(index * 20, index * 20 + 20).map((i) => (
          <li key={`${i.type}:${i.id}`}>
            <div>
              <strong>
                {i.type === "charge"
                  ? chargeLabel(i)
                  : i.description || i.type.replace(/_/g, " ")}
              </strong>
              <p className="section-caption">
                {formatDate(i.date)} · {recordReference(i.reference)} ·{" "}
                {i.voidedAt ? "Voided" : i.status.replace(/_/g, " ")}
              </p>
            </div>
            <strong>{dollars(i.amountCents)}</strong>
          </li>
        ))}
      </ol>
      {items.length > 20 && (
        <nav className="actions" aria-label="Saved financial sources">
          <button
            className="secondary"
            disabled={!index}
            onClick={() => setPage(index - 1)}
          >
            Previous sources
          </button>
          <span>
            Page {index + 1} of {Math.ceil(items.length / 20)}
          </span>
          <button
            className="secondary"
            disabled={(index + 1) * 20 >= items.length}
            onClick={() => setPage(index + 1)}
          >
            Next sources
          </button>
        </nav>
      )}
      <p>
        {snapshot.deposit?.receipts.length || 0} deposit receipts ·{" "}
        {snapshot.deposit?.movements?.length || 0} deposit movements. The
        download includes all source IDs, references and allocations.
      </p>
    </details>
  );
}
function exportRevision(r: Revision) {
  const s = r.snapshot;
  downloadReport(`move-out-review-v${r.version}.csv`, [
    [
      "Section",
      "Reference",
      "Source ID",
      "Date",
      "Description / reason",
      "Amount USD",
      "Related source ID",
      "Status",
    ],
    [
      "Settlement",
      r.reference,
      r.id,
      r.movedOutOn.slice(0, 10),
      r.reason,
      "",
      "",
      `${r.action} · version ${r.version}`,
    ],
    ["Saved at", "", "", r.createdAt, s.basis, "", "", ""],
    ...s.financial.items.map((i) => [
      "Rent activity",
      i.reference,
      i.id,
      i.date,
      i.description || i.type,
      moneyCell(i.amountCents),
      i.relatedId || "",
      i.voidedAt ? "voided" : i.status,
    ]),
    ...s.financial.allocations.map((a) => [
      "Allocation",
      "",
      a.id,
      a.createdAt,
      "Payment allocated to charge",
      moneyCell(a.amountCents),
      `${a.receiptId} → ${a.chargeId}`,
      a.active ? "active" : "inactive",
    ]),
    ...(s.deposit?.receipts || []).map((p) => [
      "Deposit receipt",
      p.reference,
      p.id,
      p.occurredOn.slice(0, 10),
      "Deposit received",
      moneyCell(String(p.amountCents)),
      s.deposit!.id,
      p.voidedAt ? "voided" : "active",
    ]),
    ...(s.deposit?.movements || []).map((m) => [
      "Deposit movement",
      m.reference,
      m.id,
      m.effectiveOn.slice(0, 10),
      m.reason,
      moneyCell(String(m.amountCents)),
      m.chargeId || m.accountId || "",
      m.reversal ? "reversed" : m.kind,
    ]),
    ...(s.itemizedApplications || []).map((a) => [
      "Application in this version",
      a.reference,
      a.id,
      "",
      a.evidenceReference,
      moneyCell(String(a.amountCents)),
      a.chargeId,
      "applied",
    ]),
    [
      "Balance",
      "",
      "",
      "",
      "Charges still unpaid",
      moneyCell(s.financial.current.outstandingCents),
      "",
      "",
    ],
    [
      "Balance",
      "",
      "",
      "",
      "Deposit available to return",
      moneyCell(s.deposit?.heldCents || "0"),
      "",
      "",
    ],
    [
      "Balance",
      "",
      "",
      "",
      "Unapplied payment credit",
      moneyCell(s.financial.current.creditCents),
      "",
      "",
    ],
    ...s.schedules.map((b) => [
      "Billing schedule",
      "",
      b.id,
      b.nextPeriodOn.slice(0, 10),
      `Version ${b.version}`,
      "",
      "",
      b.status,
    ]),
  ]);
}

function ForwardingReview({
  forwarding: f,
}: {
  forwarding: Record<string, string | null>;
}) {
  return (
    <div className="movement-context">
      <h3>Forwarding details · management only</h3>
      {f.status === "provided" ? (
        <>
          <Address
            street={f.addressLine1}
            line2={f.addressLine2}
            city={f.city}
            region={f.region}
            postalCode={f.postalCode}
            country={f.country}
          />
          <p>
            {f.email || "No forwarding email"}
            {f.phone ? ` · ${f.phone}` : ""}
          </p>
        </>
      ) : (
        <p>Not supplied at this review.</p>
      )}
    </div>
  );
}
