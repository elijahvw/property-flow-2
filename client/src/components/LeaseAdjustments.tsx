import { useEffect, useState } from "react";
import type { Account, Entry } from "../pages/Rent";
import { useAuth } from "../context/AuthContext";
import { api, ApiError } from "../api";
import { Form } from "./Form";
import { dollars } from "../money";
import { formatDate, formatMonth } from "../dates";
import { recordReference } from "../record-reference";
import { DateField } from "./DateField";
import { EditorDialog } from "./EditorDialog";
import "./LeaseAdjustments.css";

export type LeaseCredit = {
  id: string;
  reference: string;
  chargeId: string;
  amountCents: number;
  kind: string;
  effectiveOn: string;
  reason: string;
  createdAt: string;
  reversal: null | {
    id: string;
    reference: string;
    effectiveOn: string;
    reason: string;
    createdAt: string;
  };
};
type Draft = {
  attempted?: boolean;
  mode: "charge" | "credit" | "reverse";
  submissionKey: string;
  expectedLeaseVersion: number;
  category: string;
  kind: string;
  effectiveOn: string;
  dueOn: string;
  amount: string;
  reason: string;
  chargeId: string;
  expectedChargeVersion: number;
  expectedRemainingCents: string;
  chargeLabel: string;
  creditId: string;
  creditLabel: string;
};
const categories: Record<string, string> = {
  utilities: "Utilities",
  parking: "Parking",
  pet: "Pet charge",
  damage: "Damage",
  other: "Other agreed charge",
};
export function chargeName(charge: Entry) {
  return charge.kind === "one_time"
    ? charge.memo || categories[charge.category ?? "other"]
    : `${formatMonth(charge.periodOn)} rent`;
}
function amountInCents(value: string) {
  if (!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value)) return "0";
  const [whole, fraction = ""] = value.split(".");
  return String(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
}
function pending(key: string): Draft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return value && value.attempted === true &&
      ["charge", "credit", "reverse"].includes(value.mode) &&
      typeof value.submissionKey === "string" &&
      Number.isInteger(value.expectedLeaseVersion) &&
      [
        "amount",
        "reason",
        "effectiveOn",
        "dueOn",
        "category",
        "kind",
        "chargeId",
        "expectedRemainingCents",
        "chargeLabel",
        "creditId",
        "creditLabel",
      ].every((k) => typeof value[k] === "string")
      ? value
      : null;
  } catch {
    return null;
  }
}
export function LeaseAdjustments({
  account,
  today,
  resident,
  stale,
  changed,
}: {
  account: Account;
  today: string;
  resident: boolean;
  stale: boolean;
  changed: () => void;
}) {
  const { data } = useAuth();
  const storageKey = `pf-lease-adjustment:${data?.user.id}:${data?.membership?.companyId}:${account.lease.id}`;
  const [draft, setDraft] = useState<Draft | null>(() => pending(storageKey));
  const [open, setOpen] = useState(false),
    [review, setReview] = useState(!!draft?.attempted);
  const unpaid = (account.charges ?? []).filter(
    (c) => !c.voidedAt && BigInt(c.remainingCents ?? "0") > 0n,
  );
  useEffect(() => {
    try {
      if (draft?.attempted) sessionStorage.setItem(storageKey, JSON.stringify(draft));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* The current draft still works when storage is unavailable. */
    }
  }, [draft, storageKey]);
  const update = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : null));
  const selectCharge = (charge: Entry | undefined): Partial<Draft> => ({
    chargeId: charge?.id ?? "",
    expectedChargeVersion: charge?.version ?? 1,
    expectedRemainingCents: charge?.remainingCents ?? "0",
    chargeLabel: charge ? (chargeName(charge) ?? "Charge") : "",
  });
  const start = (mode: Draft["mode"], credit?: LeaseCredit) => {
    setDraft({
      mode,
      submissionKey: crypto.randomUUID(),
      expectedLeaseVersion: account.lease.version,
      category: "utilities",
      kind: "credit_note",
      effectiveOn: today,
      dueOn: today,
      amount: credit
        ? `${Math.floor(credit.amountCents / 100)}.${String(credit.amountCents % 100).padStart(2, "0")}`
        : "",
      reason: "",
      chargeId: "",
      expectedChargeVersion: 1,
      expectedRemainingCents: "0",
      chargeLabel: "",
      ...selectCharge(unpaid[0]),
      creditId: credit?.id ?? "",
      creditLabel: credit ? recordReference(credit.reference) : "",
    });
    setReview(false);
    setOpen(true);
  };
  const credits = account.credits ?? [];
  return (
    <section
      className="panel lease-adjustments"
      aria-label="One-time charges and credits"
    >
      <div className="section-heading">
        <div>
          <h2>One-time charges & credits</h2>
          <p>Agreed charges and noncash reductions, connected to this lease.</p>
        </div>
        {!resident && !draft && (
          <div className="actions">
            <button
              className="secondary"
              disabled={stale || account.lease.status === "draft"}
              onClick={() => start("charge")}
            >
              Add one-time charge
            </button>
            <button
              className="secondary"
              disabled={
                stale || !unpaid.length || account.lease.status === "draft"
              }
              onClick={() => start("credit")}
            >
              Record credit
            </button>
          </div>
        )}
      </div>
      {!resident && draft && (
        <div className="notice adjustment-resume">
          <span>
            You have an unfinished{" "}
            {draft.mode === "charge"
              ? "charge"
              : draft.mode === "reverse"
                ? "credit reversal"
                : "credit note"}
            .
          </span>
          <button className="secondary" onClick={() => setOpen(true)}>
            Resume review
          </button>
        </div>
      )}
      <p className="help">
        A credit reduces a selected unpaid charge. It is not a payment or
        refundable cash. Existing payments keep their allocations.
      </p>
      {credits.length > 0 && (
        <ul className="adjustment-history">
          {[...credits].reverse().map((credit) => (
            <li key={credit.id}>
              <div>
                <h3>
                  {credit.kind === "concession" ? "Concession" : "Credit note"}{" "}
                  · {dollars(credit.amountCents)}
                </h3>
                <p>{credit.reason}</p>
                <small>
                  {recordReference(credit.reference)} ·{" "}
                  {formatDate(credit.effectiveOn)} ·{" "}
                  {credit.reversal ? "Reversed" : "Applied to charge"}
                </small>
                {credit.reversal && (
                  <div className="adjustment-reversal">
                    <strong>
                      Credit reversed ·{" "}
                      {formatDate(credit.reversal.effectiveOn)}
                    </strong>
                    <p>{credit.reversal.reason}</p>
                  </div>
                )}
              </div>
              {!resident && !credit.reversal && (
                <button
                  className="secondary"
                  disabled={stale || !!draft}
                  onClick={() => start("reverse", credit)}
                >
                  Reverse {recordReference(credit.reference).toLowerCase()}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!resident && (
        <EditorDialog
          open={open && !!draft} hasChanges={!!draft?.attempted}
          title={
            draft?.mode === "charge"
              ? "Add one-time charge"
              : draft?.mode === "reverse"
                ? "Reverse a credit"
                : "Record a credit"
          }
          onClose={() => setOpen(false)}
          onDiscard={() => { setDraft(null); setReview(false); setOpen(false); }}
        >
          {draft && (
            <>
              <div className="adjustment-context">
                <strong>
                  {account.lease.property.name} · {account.lease.unit.label}
                </strong>
                <span>
                  {draft.mode === "charge"
                    ? "Adds an amount owed; no cash is recorded."
                    : draft.mode === "reverse"
                      ? "Restores the obligation reduced by this credit; no cash changes hands."
                      : "Reduces the selected obligation; no cash is recorded."}
                </span>
              </div>
              {!review ? (
                <form
                  className="workflow-form adjustment-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setReview(true);
                  }}
                >
                  <fieldset>
                    <legend>
                      {draft.mode === "charge"
                        ? "Charge details"
                        : draft.mode === "reverse"
                          ? draft.creditLabel
                          : "Credit details"}
                    </legend>
                    {draft.mode === "charge" && (
                      <label>
                        Charge category
                        <select
                          aria-label="Charge category"
                          value={draft.category}
                          onChange={(event) =>
                            update({ category: event.target.value })
                          }
                        >
                          {Object.entries(categories).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {draft.mode === "credit" && (
                      <>
                        <label>
                          Charge to reduce
                          <select
                            required
                            value={draft.chargeId}
                            onChange={(event) =>
                              update(
                                selectCharge(
                                  unpaid.find(
                                    (c) => c.id === event.target.value,
                                  ),
                                ),
                              )
                            }
                          >
                            {!unpaid.some((c) => c.id === draft.chargeId) && (
                              <option value={draft.chargeId}>
                                {draft.chargeLabel || "Choose an unpaid charge"}
                              </option>
                            )}
                            {unpaid.map((charge) => (
                              <option key={charge.id} value={charge.id}>
                                {chargeName(charge)} ·{" "}
                                {dollars(charge.remainingCents ?? "0")} unpaid
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="help">
                          Reviewed unpaid amount:{" "}
                          {dollars(draft.expectedRemainingCents)}. Credit must
                          not exceed this amount.
                        </p>
                        <label>
                          Credit type
                          <select
                            value={draft.kind}
                            onChange={(event) =>
                              update({ kind: event.target.value })
                            }
                          >
                            <option value="credit_note">
                              Credit note · agreed reduction or correction
                            </option>
                            <option value="concession">
                              Concession · agreed discount
                            </option>
                          </select>
                        </label>
                      </>
                    )}
                    {draft.mode !== "reverse" && (
                      <label>
                        Amount (USD)
                        <input
                          inputMode="decimal"
                          required
                          pattern="(0|[1-9][0-9]{0,6})(\.[0-9]{1,2})?"
                          value={draft.amount}
                          onChange={(event) =>
                            update({ amount: event.target.value })
                          }
                          placeholder="0.00"
                        />
                      </label>
                    )}
                    <div className="adjustment-date-grid">
                      <label>
                        Effective date
                        <DateField
                          aria-label="Adjustment effective date"
                          required
                          max={today}
                          value={draft.effectiveOn}
                          onChange={(event) =>
                            update({ effectiveOn: event.target.value })
                          }
                        />
                      </label>
                      {draft.mode === "charge" && (
                        <label>
                          Due date
                          <DateField
                            aria-label="One-time charge due date"
                            required
                            value={draft.dueOn}
                            onChange={(event) =>
                              update({ dueOn: event.target.value })
                            }
                          />
                        </label>
                      )}
                    </div>
                    <label>
                      {draft.mode === "charge"
                        ? "Description shown to the tenant"
                        : "Reason shown to the tenant"}
                      <textarea
                        required
                        maxLength={500}
                        rows={3}
                        value={draft.reason}
                        onChange={(event) =>
                          update({ reason: event.target.value })
                        }
                      />
                    </label>
                    <p className="help">
                      Use a clear explanation for the statement. Keep private
                      management notes in the tenant profile.
                    </p>
                  </fieldset>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setDraft(null);
                        setOpen(false);
                      }}
                    >
                      Discard draft
                    </button>
                    <button type="submit">
                      Review{" "}
                      {draft.mode === "charge"
                        ? "charge"
                        : draft.mode === "reverse"
                          ? "reversal"
                          : "credit"}
                    </button>
                  </div>
                </form>
              ) : (
                <Form
                  recovering={!!draft.attempted}
                  operation="finance.create"
                  label={
                    draft.mode === "charge"
                      ? "Post one-time charge"
                      : draft.mode === "reverse"
                        ? "Confirm credit reversal"
                        : "Apply credit"
                  }
                  feedbackText={
                    draft.mode === "charge"
                      ? "Charge posted. Lease balance updated."
                      : "Credit history saved. Lease balance updated."
                  }
                  secondaryActions={!draft.attempted &&
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setReview(false)}
                    >
                      Back to details
                    </button>
                  }
                  submit={async () => {
                    if (stale)
                      throw new Error(
                        "Refresh the lease before confirming this change.",
                      );
                    const root = `/api/company/rent/${encodeURIComponent(account.lease.id)}`;
                    const shared = {
                      effectiveOn: draft.effectiveOn,
                      expectedLeaseVersion: draft.expectedLeaseVersion,
                      submissionKey: draft.submissionKey,
                    };
                    const attempt = { ...draft, attempted: true };
                    sessionStorage.setItem(storageKey, JSON.stringify(attempt));
                    setDraft(attempt);
                    try { await api(
                      draft.mode === "charge"
                        ? `${root}/one-time-charges`
                        : draft.mode === "reverse"
                          ? `${root}/credits/${encodeURIComponent(draft.creditId)}/reverse`
                          : `${root}/credits`,
                      {
                        method: "POST",
                        body:
                          draft.mode === "charge"
                            ? {
                                ...shared,
                                category: draft.category,
                                dueOn: draft.dueOn,
                                amount: draft.amount,
                                description: draft.reason,
                              }
                            : draft.mode === "reverse"
                              ? { ...shared, reason: draft.reason }
                              : {
                                  ...shared,
                                  chargeId: draft.chargeId,
                                  kind: draft.kind,
                                  amount: draft.amount,
                                  reason: draft.reason,
                                  expectedChargeVersion:
                                    draft.expectedChargeVersion,
                                  expectedRemainingCents:
                                    draft.expectedRemainingCents,
                                },
                      },
                    );
                    } catch (error) {
                      if (!draft.attempted && error instanceof ApiError && [400,403,404,409,422].includes(error.status)) {
                        sessionStorage.removeItem(storageKey);
                        setDraft({ ...draft, attempted: false });
                      }
                      throw error;
                    }
                    sessionStorage.removeItem(storageKey);
                    setDraft(null);
                    setOpen(false);
                    setReview(false);
                    changed();
                  }}
                >
                  <section className="adjustment-review">
                    <h3>Review before saving</h3>
                    <dl>
                      <div>
                        <dt>
                          {draft.mode === "reverse"
                            ? "Credit to reverse"
                            : "Amount"}
                        </dt>
                        <dd>
                          {draft.mode === "reverse"
                            ? draft.creditLabel
                            : dollars(amountInCents(draft.amount))}
                        </dd>
                      </div>
                      <div>
                        <dt>Effective date</dt>
                        <dd>{formatDate(draft.effectiveOn)}</dd>
                      </div>
                      {draft.mode === "charge" ? (
                        <>
                          <div>
                            <dt>Category</dt>
                            <dd>{categories[draft.category]}</dd>
                          </div>
                          <div>
                            <dt>Due date</dt>
                            <dd>{formatDate(draft.dueOn)}</dd>
                          </div>
                        </>
                      ) : (
                        draft.mode === "credit" && (
                          <div>
                            <dt>Charge</dt>
                            <dd>{draft.chargeLabel}</dd>
                          </div>
                        )
                      )}
                      <div>
                        <dt>Tenant-visible explanation</dt>
                        <dd>{draft.reason}</dd>
                      </div>
                    </dl>
                    <p>
                      {draft.mode === "charge"
                        ? "Unapplied receipt credit may automatically apply, oldest due charge first. One-time charges have no added grace period or automatic late fees."
                        : "This does not record a payment, create cash credit or issue a refund. Original records remain in the history."}
                    </p>
                  </section>
                </Form>
              )}
            </>
          )}
        </EditorDialog>
      )}
    </section>
  );
}
