import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { Form } from "./Form";
import type { Lease } from "../pages/Leasing";
import { dollars } from "../money";
import { DateField } from "./DateField";
import { EditorDialog } from "./EditorDialog";
import { DraftReset } from "./DraftReset";
import { formatDate, formatMonth } from "../dates";
import { downloadReport, moneyCell } from "../report-export";
import { recordReference } from "../record-reference";
import "./LeaseLifecycle.css";
type Calculation = {
  periodOn: string;
  fromOn: string;
  throughOn: string;
  throughExclusiveOn: string;
  days: number;
  daysInMonth: number;
  monthlyCents: number;
  calculatedCents: number;
  partial: boolean;
  rounding: string;
  amountCents?: number;
  dueOn?: string;
  graceDays?: number;
  reason?: string;
  overrideReason?: string | null;
};
type ProrationRecord = {
  id: string;
  reference: string;
  chargeId: string;
  snapshot: Calculation;
  createdAt: string;
  charge: { reference: string; voidedAt: string | null };
};
type ProrationData = {
  lease: Lease;
  calculation: Calculation;
  dueOn: string;
  existing: null | { id: string; reference: string };
  history: ProrationRecord[];
};
type ProrationPreview = {
  snapshot: Calculation;
  sourceHash: string;
  expectedLeaseVersion: number;
};
type TransitionHistory = {
  id: string;
  reference: string;
  kind: string;
  endsOn: string;
  reason: string;
  createdAt: string;
  successorId?: string | null;
  snapshot?: TransitionPreview;
};
type TransitionData = {
  lease: Lease;
  successor: Lease | null;
  current: { rentCents: number };
  businessDate: string;
  balances: { outstandingCents: string; creditCents: string };
  deposit: null | { heldCents: string };
  history: TransitionHistory[];
};
type TransitionPreview = {
  kind: string;
  endsOn: string;
  reason: string;
  ready: boolean;
  readyOn: string;
  blockers: string[];
  businessDate: string;
  oldFinal: {
    calculation: Calculation;
    recordedCharge: null | {
      id: string;
      reference: string;
      amountCents: number;
      dueOn: string;
    };
    scheduledAmountCents: number;
  };
  oldInstallments?: {
    periodOn: string;
    amountCents: number;
    dueOn: string;
    graceDays: number;
    action: string;
    amountOverride: boolean;
    calculation: Calculation;
  }[];
  projectedBalances?: { outstandingCents: string; creditCents: string };
  oldBilling: null | { status: string; action: string };
  pauseBilling: boolean;
  newTerm: null | {
    lease: Lease;
    terms: { rentCents: number; rentDueDay: number; graceDays: number };
    first: Calculation;
    last: Calculation | null;
    firstDueOn: string;
    firstAmountCents: number;
    firstOverrideReason: string | null;
    billing: string;
  };
  balances: { outstandingCents: string; creditCents: string };
  deposit: null | { heldCents: string };
  sourceHash: string;
};
type Review<T> = {
  body: Record<string, unknown>;
  preview: T;
  attempted?: boolean;
};
function useReview<T>(name: string, id: string) {
  const { data } = useAuth(),
    key = `pf:${name}:${data?.user.id}:${data?.membership?.companyId}:${id}`;
  const [value, setValue] = useState<Review<T> | null>(() => {
    try {
      const r = JSON.parse(sessionStorage.getItem(key) || "null");
      return r?.attempted && r?.body?.submissionKey && r.preview ? r : null;
    } catch {
      return null;
    }
  });
  const retain = (r: Review<T>) => {
    if (r.attempted) sessionStorage.setItem(key, JSON.stringify(r));
    setValue(r);
  };
  const clear = () => {
    sessionStorage.removeItem(key);
    setValue(null);
  };
  return { value, retain, clear };
}
function refreshed(id: string) {
  window.dispatchEvent(
    new CustomEvent("lease-lifecycle-changed", { detail: id }),
  );
}
function Load({ error, reload }: { error?: string; reload: () => void }) {
  return error ? (
    <p className="notice error" role="alert">
      {error}{" "}
      <button className="secondary" onClick={reload}>
        Refresh review
      </button>
    </p>
  ) : (
    <p role="status">Loading lease review…</p>
  );
}
export function ProrationMath({ value: c }: { value: Calculation }) {
  return (
    <section className="proration-calculation">
      <div className="section-heading">
        <div>
          <p className="record-kicker">{formatMonth(c.periodOn)}</p>
          <h3>Partial rent calculation</h3>
        </div>
        <strong>{dollars(c.amountCents ?? c.calculatedCents)}</strong>
      </div>
      <dl className="lifecycle-facts">
        <div>
          <dt>Included dates</dt>
          <dd>
            {formatDate(c.fromOn)} – {formatDate(c.throughOn)}
          </dd>
        </div>
        <div>
          <dt>Included days</dt>
          <dd>
            {c.days} of {c.daysInMonth} calendar days
          </dd>
        </div>
        <div>
          <dt>Agreed monthly rent</dt>
          <dd>{dollars(c.monthlyCents)}</dd>
        </div>
        <div>
          <dt>Calculated rent</dt>
          <dd>{dollars(c.calculatedCents)}</dd>
        </div>
      </dl>
      <p className="help">
        Both displayed dates are included. The period ends before{" "}
        {formatDate(c.throughExclusiveOn)}. Calculation: monthly rent × {c.days}{" "}
        ÷ {c.daysInMonth}; round the final result once to the nearest cent, half
        up.
      </p>
      {c.overrideReason && (
        <p className="notice">
          Agreed override: {dollars(c.amountCents ?? c.calculatedCents)} ·{" "}
          {c.overrideReason}
        </p>
      )}
      {c.dueOn && (
        <p className="help">
          Due {formatDate(c.dueOn)} · {c.graceDays ?? 0} calendar days grace.
        </p>
      )}
      {c.reason && <p>{c.reason}</p>}
    </section>
  );
}
export function LeaseProration({
  lease,
  changed,
}: {
  lease: Lease;
  changed: () => void;
}) {
  const { data } = useAuth();
  return (
    <ProrationWorkspace
      key={`${lease.id}:${data?.user.id}:${data?.membership?.companyId}`}
      lease={lease}
      changed={changed}
    />
  );
}
function ProrationWorkspace({
  lease,
  changed,
}: {
  lease: Lease;
  changed: () => void;
}) {
  const root = `/api/company/leases/${encodeURIComponent(lease.id)}/proration`,
    months = Array.from(
      new Set([
        lease.startsOn.slice(0, 7),
        ...(lease.endsOn ? [lease.endsOn.slice(0, 7)] : []),
      ]),
    ),
    [month, setMonth] = useState(months[0]),
    [open, setOpen] = useState(false),
    [draft, setDraft] = useState<ProrationData | null>(null),
    review = useReview<ProrationPreview>("proration", lease.id),
    r = useResource<ProrationData>(
      `${root}?periodOn=${encodeURIComponent(month + "-01")}`,
      true,
      !open,
    ),
    d = r.data?.lease ? r.data : undefined;
  const monthOptions = months.join(",");
  useEffect(() => {
    if (!months.includes(month) && !open) setMonth(months[0]);
  }, [monthOptions, month, open]);
  const clear = () => {
    review.clear();
    setOpen(false);
    setDraft(null);
  };
  return (
    <div className="lifecycle-workspace">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="record-kicker">First & final months</p>
            <h2>Partial rent</h2>
            <p className="help">
              Review the exact included dates and agreed amount before posting a
              charge.
            </p>
          </div>
        </div>
        <label className="lifecycle-month">
          Rent month
          <select
            aria-label="Partial rent month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m + "-01")}
              </option>
            ))}
          </select>
        </label>
        {!d || r.error ? (
          <Load
            error={
              r.error ||
              (r.data && !d
                ? "This lease review is unavailable. Refresh and try again."
                : undefined)
            }
            reload={r.reload}
          />
        ) : (
          <>
            <ProrationMath value={d.calculation} />
            {!d.calculation.partial ? (
              <p className="notice">
                This is a full calendar month under the recorded dates. Use
                regular monthly rent posting.
              </p>
            ) : d.existing ? (
              <p className="notice">
                This month already has {recordReference(d.existing.reference)}.
                Review rent and payments before making a separately recorded
                charge or credit difference.
              </p>
            ) : d.lease.status === "draft" ? (
              <p className="notice">
                This lease is a draft. The calculation is available now;
                activate the record before posting. A renewal review includes
                the first rent charge.
              </p>
            ) : (
              !review.value && (
                <button
                  onClick={() => {
                    setDraft((prev) => prev || d);
                    setOpen(true);
                  }}
                >
                  Review partial rent charge
                </button>
              )
            )}
            <div className="actions">
              <Link
                to={`/company/rent?leaseId=${encodeURIComponent(lease.id)}&leaseReturn=${encodeURIComponent(lease.id)}`}
              >
                Open rent & payments →
              </Link>
            </div>
            <p className="help">
              Policy: actual days in this calendar month. An agreed manual
              override requires a reason. Posting keeps one active monthly rent
              charge; recurring billing recognizes it and does not create
              another.
            </p>
          </>
        )}
        {review.value && (
          <div className="notice movement-pending">
            <span>A partial rent review is retained.</span>
            <button className="secondary" onClick={() => setOpen(true)}>
              Resume partial rent review
            </button>
            <DraftReset reset={clear} />
          </div>
        )}
      </section>
      {d?.history?.length ? <ProrationHistory rows={d.history} /> : null}
      <EditorDialog
        open={open} hasChanges={!!review.value}
        title={review.value ? "Confirm partial rent" : "Review partial rent"}
        onClose={() => setOpen(false)} onDiscard={clear}
      >
        {review.value ? (
          <>
            <ProrationMath value={review.value.preview.snapshot} />
            <Form
              recovering={!!review.value.attempted}
              label="Confirm partial rent charge"
              operation="rent.charge"
              feedbackText="Reviewed partial rent posted once."
              secondaryActions={
                !review.value.attempted && draft ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={review.clear}
                  >
                    Back to calculation details
                  </button>
                ) : undefined
              }
              submit={async (f) => {
                if (f.get("confirmed") !== "on")
                  throw new Error("Confirm the calculation and agreed charge.");
                const retained = { ...review.value!, attempted: true };
                review.retain(retained);
                await api(root, {
                  method: "POST",
                  body: { ...retained.body, confirmed: true },
                });
                clear();
                r.reload();
                changed();
                refreshed(lease.id);
              }}
            >
              <label className="movement-confirm">
                <input type="checkbox" name="confirmed" required />I confirm the
                included dates, day-count policy, rounding and agreed charge.
              </label>
              <p className="help">
                This posts rent owed. It records no payment and does not change
                existing posted rent.
              </p>
              <DraftReset reset={clear} />
            </Form>
          </>
        ) : null}
        {draft && (
          <div hidden={!!review.value}>
            <ProrationEditor
              snapshot={draft}
              root={root}
              reviewed={review.retain}
            />
          </div>
        )}
      </EditorDialog>
    </div>
  );
}
function ProrationEditor({
  snapshot: d,
  root,
  reviewed,
}: {
  snapshot: ProrationData;
  root: string;
  reviewed: (r: Review<ProrationPreview>) => void;
}) {
  const [override, setOverride] = useState("");
  return (
    <Form
      reviewOnly
      label="Preview partial rent"
      operation="page.data.load"
      successText=""
      submit={async (f) => {
        const body = {
          periodOn: d.calculation.periodOn,
          fromOn: d.calculation.fromOn,
          throughOn: d.calculation.throughOn,
          policy: "actual_calendar_month",
          dueOn: f.get("dueOn"),
          overrideAmount: override || null,
          overrideReason: override ? f.get("overrideReason") : null,
          reason: f.get("reason"),
          expectedLeaseVersion: d.lease.version,
        };
        const preview = await api<ProrationPreview>(root + "/preview", {
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
      <ProrationMath value={d.calculation} />
      <fieldset className="form-section">
        <legend>Charge details</legend>
        <label>
          Partial rent due date
          <DateField
            aria-label="Partial rent due date"
            name="dueOn"
            required
            defaultValue={d.dueOn.slice(0, 10)}
          />
        </label>
        <label>
          Reason shown to the tenant
          <textarea name="reason" required maxLength={500} rows={3} />
        </label>
      </fieldset>
      <details className="lifecycle-override">
        <summary>Use an agreed amount instead</summary>
        <label>
          Agreed partial rent (USD) · optional
          <input
            name="overrideAmount"
            type="number"
            min="0.01"
            step="0.01"
            max="1000000"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
          />
        </label>
        {override && (
          <label>
            Reason for agreed amount
            <textarea name="overrideReason" required rows={3} maxLength={500} />
          </label>
        )}
      </details>
    </Form>
  );
}
function ProrationHistory({ rows }: { rows: ProrationRecord[] }) {
  const [page, setPage] = useState(0);
  return (
    <details className="panel lifecycle-history">
      <summary>Reviewed partial rent history · {rows.length}</summary>
      <button
        className="text-button"
        onClick={() =>
          downloadReport("partial-rent-history.csv", [
            [
              "Reference",
              "Source ID",
              "Charge ID",
              "From included",
              "Through included",
              "Through exclusive",
              "Included days",
              "Calendar days",
              "Monthly rent USD",
              "Calculated USD",
              "Agreed USD",
              "Policy",
              "Rounding",
              "Override reason",
              "Reason",
              "Recorded at",
              "Voided",
            ],
            ...rows.map((r) => [
              r.reference,
              r.id,
              r.chargeId,
              r.snapshot.fromOn,
              r.snapshot.throughOn,
              r.snapshot.throughExclusiveOn,
              String(r.snapshot.days),
              String(r.snapshot.daysInMonth),
              moneyCell(String(r.snapshot.monthlyCents)),
              moneyCell(String(r.snapshot.calculatedCents)),
              moneyCell(
                String(r.snapshot.amountCents ?? r.snapshot.calculatedCents),
              ),
              "actual_calendar_month",
              r.snapshot.rounding,
              r.snapshot.overrideReason || "",
              r.snapshot.reason || "",
              r.createdAt,
              r.charge.voidedAt ? "yes" : "no",
            ]),
          ])
        }
      >
        Download proration history
      </button>
      {rows.slice(page * 5, page * 5 + 5).map((r) => (
        <article key={r.id}>
          <div className="section-heading">
            <h3>{recordReference(r.reference)}</h3>
            <span className="tenant-status neutral">
              {r.charge.voidedAt ? "Charge voided" : "Recorded"}
            </span>
          </div>
          <ProrationMath value={r.snapshot} />
          <p className="section-caption">
            {recordReference(r.charge.reference)} · Recorded{" "}
            {formatDate(r.createdAt)}
          </p>
        </article>
      ))}
      {rows.length > 5 && (
        <nav className="actions" aria-label="Proration history pages">
          <button
            className="secondary"
            disabled={!page}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>
            Page {page + 1} of {Math.ceil(rows.length / 5)}
          </span>
          <button
            className="secondary"
            disabled={(page + 1) * 5 >= rows.length}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </details>
  );
}
export function LeaseTransition({
  leaseId,
  changed,
}: {
  leaseId: string;
  changed: () => void;
}) {
  const { data } = useAuth();
  return (
    <TransitionWorkspace
      key={`${leaseId}:${data?.user.id}:${data?.membership?.companyId}`}
      id={leaseId}
      changed={changed}
    />
  );
}
function TransitionWorkspace({
  id,
  changed,
}: {
  id: string;
  changed: () => void;
}) {
  const root = `/api/company/leases/${encodeURIComponent(id)}/transition`,
    review = useReview<TransitionPreview>("handoff", id),
    [open, setOpen] = useState(false),
    [draft, setDraft] = useState<TransitionData | null>(null),
    r = useResource<TransitionData>(root, true, !open),
    d = r.data?.lease ? r.data : undefined;
  const clear = () => {
    review.clear();
    setOpen(false);
    setDraft(null);
  };
  return (
    <div className="lifecycle-workspace">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="record-kicker">Lease dates & rent</p>
            <h2>Renew or end lease</h2>
            <p className="help">
              Review the lease dates, rent charges and billing in one place.
            </p>
          </div>
          {d &&
            !r.error &&
            !review.value &&
            (d.lease.status === "active" ||
              d.successor?.status === "draft") && (
              <button
                onClick={() => {
                  setDraft((prev) => prev || d);
                  setOpen(true);
                }}
              >
                Review lease change
              </button>
            )}
        </div>
        {!d || r.error ? (
          <Load
            error={
              r.error ||
              (r.data && !d
                ? "This lease review is unavailable. Refresh and try again."
                : undefined)
            }
            reload={r.reload}
          />
        ) : (
          <>
            <dl className="lifecycle-facts">
              <div>
                <dt>Current lease ends</dt>
                <dd>{formatDate(d.lease.endsOn, "Open ended")}</dd>
              </div>
              <div>
                <dt>Renewal</dt>
                <dd>
                  {d.successor ? (
                    <Link
                      to={`/company/leases/${encodeURIComponent(d.successor.id)}`}
                    >
                      {formatDate(d.successor.startsOn)} · {d.successor.status}
                    </Link>
                  ) : (
                    "No linked renewal yet"
                  )}
                </dd>
              </div>
              <div>
                <dt>Unpaid charges</dt>
                <dd>{dollars(d.balances.outstandingCents)}</dd>
              </div>
              <div>
                <dt>Deposit held</dt>
                <dd>{dollars(d.deposit?.heldCents ?? "0")}</dd>
              </div>
            </dl>
            <p className="help">
              A renewal keeps the same property and unit. Existing balances and
              deposits stay with the current lease.
            </p>
          </>
        )}
        {review.value && (
          <div className="notice movement-pending">
            <span>You have an unfinished lease review.</span>
            <button
              className="secondary"
              onClick={() => {
                if (!review.value?.attempted && d)
                  setDraft((prev) => prev || d);
                setOpen(true);
              }}
            >
              Resume lease review
            </button>
            <DraftReset reset={clear} />
          </div>
        )}
      </section>
      {d?.history?.length ? (
        <details className="panel lifecycle-history">
          <summary>Lease change history · {d.history.length}</summary>
          {d.history.map((h) => (
            <details key={h.id}>
              <summary>
                {formatDate(h.createdAt)} ·{" "}
                {
                  (
                    {
                      plan_end: "End date planned",
                      end: "Lease ended",
                      renew: "Renewal completed",
                    } as Record<string, string>
                  )[h.kind]
                }{" "}
                · {recordReference(h.reference)}
              </summary>
              <p>
                Lease ended: {formatDate(h.endsOn)} · {h.reason}
              </p>
              {h.snapshot && <TransitionSummary value={h.snapshot} />}
            </details>
          ))}
        </details>
      ) : null}
      <EditorDialog
        open={open} hasChanges={!!review.value}
        title={
          review.value
            ? review.value.preview.kind === "renew"
              ? "Review renewal"
              : review.value.preview.kind === "end"
                ? "Review lease ending"
                : "Review end date"
            : "Lease dates & rent"
        }
        onClose={() => setOpen(false)} onDiscard={clear}
      >
        {review.value ? (
          <>
            {review.value.preview.ready ? (
              <div className="lease-review-confirmation">
                <Form
                  label={transitionAction(review.value.preview.kind)}
                  recovering={!!review.value.attempted}
                  operation="lease.update"
                  feedbackText="Reviewed lease transition saved. Prior money and history retained."
                  secondaryActions={
                    !review.value.attempted && draft ? (
                      <button
                        className="secondary"
                        type="button"
                        onClick={review.clear}
                      >
                        Edit details
                      </button>
                    ) : (
                      <DraftReset reset={clear} />
                    )
                  }
                  submit={async (f) => {
                    if (f.get("confirmed") !== "on")
                      throw new Error(
                        "Confirm the reviewed lease, billing and deposit effects.",
                      );
                    const retained = { ...review.value!, attempted: true };
                    review.retain(retained);
                    await api(root, {
                      method: "POST",
                      body: { ...retained.body, confirmed: true },
                    });
                    clear();
                    r.reload();
                    changed();
                    refreshed(id);
                  }}
                >
                  <TransitionSummary value={review.value.preview} />
                  <label className="movement-confirm">
                    <input type="checkbox" name="confirmed" required />
                    These dates and charges match the lease agreement.
                  </label>
                </Form>
              </div>
            ) : (
              <>
                <TransitionSummary value={review.value.preview} />
                <div className="actions">
                  <button className="secondary" onClick={review.clear}>
                    Edit details
                  </button>
                  <DraftReset reset={clear} />
                </div>
              </>
            )}
          </>
        ) : null}
        {draft && (
          <div hidden={!!review.value}>
            <TransitionEditor
              snapshot={draft}
              root={root}
              reviewed={review.retain}
              initialBody={review.value?.body}
            />
          </div>
        )}
      </EditorDialog>
    </div>
  );
}
function TransitionEditor({
  snapshot: d,
  root,
  reviewed,
  initialBody,
}: {
  snapshot: TransitionData;
  root: string;
  reviewed: (r: Review<TransitionPreview>) => void;
  initialBody?: Record<string, unknown>;
}) {
  const [initial] = useState(initialBody ?? {});
  const [kind, setKind] = useState(
      typeof initial.kind === "string"
        ? initial.kind
        : d.successor?.status === "draft"
          ? "renew"
          : !d.lease.endsOn
            ? "plan_end"
            : "end",
    ),
    [billing, setBilling] = useState(
      initial.newBilling === "recurring" ? "recurring" : "manual",
    ),
    [override, setOverride] = useState(
      typeof initial.firstAmount === "string" ? initial.firstAmount : "",
    );
  return (
    <Form
      reviewOnly
      label="Review changes"
      operation="page.data.load"
      successText=""
      submit={async (f) => {
        const body = {
          kind,
          endsOn: f.get("endsOn"),
          expectedLeaseVersion: d.lease.version,
          expectedSuccessorVersion:
            kind === "renew" ? d.successor?.version : null,
          newBilling: kind === "renew" ? billing : "none",
          firstDueOn: kind === "renew" ? f.get("firstDueOn") || null : null,
          firstAmount: kind === "renew" ? override || null : null,
          firstOverrideReason:
            kind === "renew" && override ? f.get("firstOverrideReason") : null,
          reason: f.get("reason"),
          depositDisposition: "retain_old_ledger",
        };
        const preview = await api<TransitionPreview>(root + "/preview", {
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
      <fieldset className="form-section">
        <legend>Action & dates</legend>
        <label>
          What would you like to do?
          <select
            aria-label="Lease action"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {d.lease.status !== "ended" && (
              <>
                <option value="plan_end">Set an end date</option>
                <option value="end">End lease</option>
              </>
            )}
            {d.successor?.status === "draft" && (
              <option value="renew">Renew lease</option>
            )}
          </select>
        </label>
        <label>
          Current lease end date
          <DateField
            key={d.lease.id}
            aria-label="Current lease end date"
            name="endsOn"
            required
            min={d.lease.startsOn.slice(0, 10)}
            defaultValue={
              typeof initial.endsOn === "string"
                ? initial.endsOn
                : d.lease.endsOn?.slice(0, 10) || d.businessDate
            }
          />
        </label>
        <p className="help">
          The current lease includes this date. A renewal starts the following
          day. You can review future changes now and complete them when the date
          arrives.
        </p>
      </fieldset>
      {kind === "renew" && d.successor && (
        <fieldset className="form-section">
          <legend>Renewal rent</legend>
          <p>
            {d.successor.property.name} · {d.successor.unit.label} · Starts{" "}
            {formatDate(d.successor.startsOn)}
          </p>
          <label>
            Future rent charges
            <select
              aria-label="Future rent charges"
              value={billing}
              onChange={(e) => setBilling(e.target.value)}
            >
              <option value="manual">Record future rent manually</option>
              <option value="recurring">
                Create future rent charges automatically
              </option>
            </select>
          </label>
          <p className="help">
            The review shows the first rent charge and any partial-month amounts
            before you save.
          </p>
          <label>
            First rent due date · optional
            <DateField
              name="firstDueOn"
              aria-label="First rent due date"
              defaultValue={
                typeof initial.firstDueOn === "string" ? initial.firstDueOn : ""
              }
            />
          </label>
          <p className="help">
            Leave blank to use the new lease's agreed due day for its first
            month.
          </p>
          <details className="lifecycle-override">
            <summary>Use an agreed first amount instead</summary>
            <label>
              Agreed first rent (USD) · optional
              <input
                type="number"
                min="0.01"
                step="0.01"
                max="1000000"
                value={override}
                onChange={(e) => setOverride(e.target.value)}
              />
            </label>
            {override && (
              <label>
                Reason for first rent override
                <textarea
                  name="firstOverrideReason"
                  defaultValue={
                    typeof initial.firstOverrideReason === "string"
                      ? initial.firstOverrideReason
                      : ""
                  }
                  required
                  maxLength={500}
                  rows={3}
                />
              </label>
            )}
          </details>
        </fieldset>
      )}
      <fieldset className="form-section">
        <legend>Reason for the change</legend>
        <label>
          Reason for the lease change
          <textarea
            name="reason"
            required
            maxLength={500}
            rows={3}
            defaultValue={
              typeof initial.reason === "string" ? initial.reason : ""
            }
          />
        </label>
        <p className="notice">
          Any deposit stays on the current lease for separate settlement or
          refund. A renewal deposit is recorded separately.
        </p>
      </fieldset>
    </Form>
  );
}
function transitionAction(kind: string) {
  return kind === "renew"
    ? "Complete renewal"
    : kind === "end"
      ? "End lease"
      : "Save end date";
}
function TransitionSummary({ value: p }: { value: TransitionPreview }) {
  const oldRows = p.oldInstallments ?? [],
    toPost = oldRows.filter((i) => i.action === "post"),
    existing = oldRows.filter((i) => i.action === "retain"),
    newFirst = p.newTerm?.firstAmountCents ?? 0,
    total = toPost.reduce((n, i) => n + i.amountCents, 0) + newFirst;
  const label =
    p.kind === "renew"
      ? "renewal"
      : p.kind === "end"
        ? "lease ending"
        : "end date";
  return (
    <div className="renewal-review">
      <section>
        <h3>Lease dates</h3>
        <div className="renewal-date-cards">
          <div>
            <span>Current lease ends</span>
            <strong>{formatDate(p.endsOn)}</strong>
          </div>
          {p.newTerm && (
            <div>
              <span>Renewal starts</span>
              <strong>{formatDate(p.newTerm.lease.startsOn)}</strong>
            </div>
          )}
        </div>
      </section>
      {!!p.blockers.length && (
        <div className="notice error" role="status">
          <strong>Before you can save this {label}</strong>
          <ul>
            {p.blockers.map((b) => (
              <li key={b}>
                {b
                  .replace(/handoff/g, "change")
                  .replace(
                    /Post or review the final rent month before completing this change\. Use Partial rent for a partial final month\./,
                    "Review the final rent before saving.",
                  )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <section className="renewal-charges">
        <h3>{p.kind === "plan_end" ? "Charges" : "Charges to add now"}</h3>
        {p.kind === "plan_end" ? (
          <p>Saving the end date adds no rent charges.</p>
        ) : (
          <>
            <p className="help">
              These are rent charges owed, not payments received.
            </p>
            <ul>
              {toPost.map((i) => (
                <li key={i.periodOn}>
                  <div>
                    <strong>Current lease · {formatMonth(i.periodOn)}</strong>
                    <span>
                      {formatDate(i.calculation.fromOn)} –{" "}
                      {formatDate(i.calculation.throughOn)}
                    </span>
                    <small>
                      Due {formatDate(i.dueOn)} · {i.graceDays} days grace
                    </small>
                  </div>
                  <strong>{dollars(i.amountCents)}</strong>
                </li>
              ))}
              {p.newTerm && newFirst > 0 && (
                <li>
                  <div>
                    <strong>Renewal · first rent</strong>
                    <span>
                      {formatDate(p.newTerm.first.fromOn)} –{" "}
                      {formatDate(p.newTerm.first.throughOn)}
                    </span>
                    <small>
                      Due {formatDate(p.newTerm.firstDueOn)} ·{" "}
                      {p.newTerm.terms.graceDays} days grace
                    </small>
                  </div>
                  <strong>{dollars(newFirst)}</strong>
                </li>
              )}
            </ul>
            {total > 0 ? (
              <div className="renewal-charge-total">
                <span>Total new charges</span>
                <strong>{dollars(total)}</strong>
              </div>
            ) : (
              <p>No new rent charges will be added.</p>
            )}
          </>
        )}
        {existing.length > 0 && (
          <p className="help">
            Already recorded on the current lease:{" "}
            {dollars(existing.reduce((n, i) => n + i.amountCents, 0))}. Those
            charges stay unchanged.
          </p>
        )}
        {oldRows.some((i) => i.action === "retain_voided") && (
          <p className="help">Previously voided rent will remain voided.</p>
        )}
      </section>
      <section className="renewal-billing">
        <h3>Billing & deposit</h3>
        <ul>
          {p.oldBilling && (
            <li>
              {p.oldBilling.action === "stop"
                ? "Stop recurring rent on the current lease."
                : p.oldBilling.action === "pause"
                  ? "Pause current billing until you review the partial final month."
                  : p.oldBilling.status === "paused"
                    ? "Keep the current billing schedule paused."
                    : "Keep current billing running through the recorded lease end."}
            </li>
          )}
          {p.newTerm && (
            <li>
              {p.newTerm.billing === "recurring"
                ? `Enable monthly rent of ${dollars(p.newTerm.terms.rentCents)} for the renewal. The first charge above will not be added again.`
                : "After the first charge above, record future rent manually."}
            </li>
          )}
          {p.newTerm?.last?.partial && p.newTerm.billing === "recurring" && (
            <li>
              Final renewal month: {dollars(p.newTerm.last.calculatedCents)} for{" "}
              {formatDate(p.newTerm.last.fromOn)} –{" "}
              {formatDate(p.newTerm.last.throughOn)}.
            </li>
          )}
          <li>
            {BigInt(p.deposit?.heldCents ?? "0") > 0n
              ? `The current lease's ${dollars(p.deposit!.heldCents)} deposit stays with that lease for separate settlement or refund.`
              : "No deposit is recorded on the current lease."}
          </li>
          {BigInt(p.balances.outstandingCents) > 0n && (
            <li>
              Existing unpaid charges of {dollars(p.balances.outstandingCents)}{" "}
              remain due on the current lease.
            </li>
          )}
          {BigInt(p.balances.creditCents) > 0n && (
            <li>
              Current payment credit: {dollars(p.balances.creditCents)}. It
              applies to new current-lease charges first; any remainder stays
              with that lease.
            </li>
          )}
        </ul>
      </section>
      <details className="renewal-calculation-details">
        <summary>How these amounts were calculated</summary>
        <p className="help">
          Partial rent uses the actual days in each calendar month, with both
          dates included. The final result is rounded once to the nearest cent,
          half up.
        </p>
        {oldRows
          .filter((i) => i.calculation.partial || i.amountOverride)
          .map((i) => (
            <div key={i.periodOn}>
              <h4>Current lease · {formatMonth(i.periodOn)}</h4>
              <ProrationMath
                value={{
                  ...i.calculation,
                  amountCents: i.amountCents,
                  dueOn: i.dueOn,
                  graceDays: i.graceDays,
                  overrideReason:
                    i.action === "retain" &&
                    i.amountCents !== i.calculation.calculatedCents
                      ? "Previously recorded amount stays unchanged"
                      : i.amountOverride
                        ? "Previously agreed billing amount"
                        : null,
                }}
              />
            </div>
          ))}
        {!oldRows.length && p.oldFinal.calculation.partial && (
          <ProrationMath value={p.oldFinal.calculation} />
        )}{" "}
        {p.newTerm && (
          <>
            <h4>Renewal · first rent</h4>
            <ProrationMath
              value={{
                ...p.newTerm.first,
                amountCents: p.newTerm.firstAmountCents,
                dueOn: p.newTerm.firstDueOn,
                graceDays: p.newTerm.terms.graceDays,
                overrideReason: p.newTerm.firstOverrideReason,
              }}
            />
            {p.newTerm.last?.partial && (
              <>
                <h4>Renewal · final rent</h4>
                <ProrationMath value={p.newTerm.last} />
              </>
            )}
          </>
        )}
      </details>
      <details className="renewal-calculation-details">
        <summary>Reason & retained records</summary>
        <p>{p.reason}</p>
        <p className="help">
          The recorded household and portal approvals stay as reviewed. Lease
          history, balances and deposits remain traceable to their original
          records. Saving records the lease change; it does not collect money or
          send a notice.
        </p>
      </details>
    </div>
  );
}
export function ResidentLifecycleHistory({ leaseId }: { leaseId: string }) {
  const p = useResource<ProrationRecord[]>(
      `/api/resident/leases/${encodeURIComponent(leaseId)}/proration`,
    ),
    t = useResource<TransitionHistory[]>(
      `/api/resident/leases/${encodeURIComponent(leaseId)}/transition`,
    );
  return (
    <>
      {p.error || t.error ? (
        <p className="notice error" role="alert">
          Lease history could not be loaded. {p.error || t.error}
        </p>
      ) : null}
      {p.data?.length ? <ProrationHistory rows={p.data} /> : null}
      {t.data?.length ? (
        <details className="panel lifecycle-history">
          <summary>Lease ending history · {t.data.length}</summary>
          {t.data.map((h) => (
            <article key={h.id}>
              <h3>
                {h.kind === "plan_end"
                  ? "Recorded final date"
                  : h.kind === "renew"
                    ? "Previous term ended"
                    : "Lease ended"}{" "}
                · {formatDate(h.endsOn)}
              </h3>
              <p>{h.reason}</p>
              <p className="section-caption">
                Recorded {formatDate(h.createdAt)} ·{" "}
                {recordReference(h.reference)}
              </p>
            </article>
          ))}
        </details>
      ) : null}
    </>
  );
}
