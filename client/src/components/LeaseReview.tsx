import { useState } from "react";
import { api, ApiError } from "../api";
import { Form } from "../pages/Workspace";
export type LeaseReviewData = {
  payload: Record<string, unknown>;
  property: string;
  unit: string;
  resident: string;
};
export function leasePending(key: string): LeaseReviewData | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    return value?.payload?.submissionKey && value?.unit && value?.resident
      ? value
      : null;
  } catch {
    return null;
  }
}
export function LeaseReview({
  review,
  storageKey,
  back,
  saved,
}: {
  review: LeaseReviewData;
  storageKey: string;
  back: () => void;
  saved: (row: { id: string }) => void;
}) {
  const [pending, setPending] = useState(!!leasePending(storageKey));
  const p = review.payload;
  return (
    <Form
      label={p.previousLeaseId ? "Create renewal draft" : "Create lease record"}
      operation="lease.create"
      successText="Lease recorded."
      submit={async () => {
        sessionStorage.setItem(storageKey, JSON.stringify(review));
        setPending(true);
        try {
          const row = await api<{ id: string }>("/api/company/leases", {
            method: "POST",
            body: p,
          });
          sessionStorage.removeItem(storageKey);
          saved(row);
        } catch (error) {
          if (
            error instanceof ApiError &&
            [400, 403, 404, 409].includes(error.status)
          ) {
            sessionStorage.removeItem(storageKey);
            setPending(false);
          }
          throw error;
        }
      }}
    >
      <p className="eyebrow">
        Review lease · nothing is saved until you confirm
      </p>
      <dl className="lease-review-summary">
        <div>
          <dt>Property and unit</dt>
          <dd>
            {review.property} · {review.unit}
          </dd>
        </div>
        <div>
          <dt>Primary resident</dt>
          <dd>{review.resident}</dd>
        </div>
        <div>
          <dt>Term</dt>
          <dd>
            {String(p.startsOn)} through{" "}
            {p.endsOn ? String(p.endsOn) : "Open-ended"}
          </dd>
        </div>
        <div>
          <dt>Monthly rent</dt>
          <dd>${String(p.monthlyRent)} USD</dd>
        </div>
        <div>
          <dt>Payment terms</dt>
          <dd>
            Due day {String(p.rentDueDay)} · {String(p.graceDays)} days grace
          </dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{String(p.status)}</dd>
        </div>
        {!!p.paymentInstructions && (
          <div>
            <dt>Shared payment instructions</dt>
            <dd>{String(p.paymentInstructions)}</dd>
          </div>
        )}
      </dl>
      <p className="notice">
        {p.previousLeaseId
          ? "This creates a linked draft. End the previous lease before activating the renewal; its existing rent history stays unchanged."
          : "Creating an active lease reserves this unit. A draft can be reviewed and activated later."}{" "}
        Recurring billing is enabled separately from the rent ledger. This
        record does not create or sign a legal agreement.
      </p>
      {pending ? (
        <p role="status">
          A previous save may have succeeded. Retry preserves the original
          reviewed details and submission identity.
        </p>
      ) : (
        <button type="button" className="text-button" onClick={back}>
          Back to lease details
        </button>
      )}
    </Form>
  );
}
