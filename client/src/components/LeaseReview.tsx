import { formatDate } from "../dates";
import { useRef, useState } from "react";
import { api, ApiError } from "../api";
import { Form } from "./Form";
import { useEditorBusy } from "./EditorDialog";
import { useAuth } from "../context/AuthContext";
import { useTenantAttemptContext } from "../tenant-write-access";
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
  prepare,
  finished,
  completedElement,
  failed,
}: {
  review: LeaseReviewData;
  storageKey: string;
  back: () => void;
  saved: (row: { id: string }) => void;
  prepare?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  finished?: () => Promise<void>;
  completedElement?: { current: HTMLElement | null };
  failed?: (error: unknown) => void;
}) {
  const editor = useEditorBusy(), auth = useAuth().data;
  const context = useTenantAttemptContext(auth);
  const [pending, setPending] = useState(!!leasePending(storageKey));
  const attempt = useRef<LeaseReviewData | null>(leasePending(storageKey));
  const p = review.payload;
  return (
    <Form
      recovering={pending}
      label={p.previousLeaseId ? "Create renewal draft" : "Create lease record"}
      operation="lease.create"
      successText="Lease recorded."
      submit={async () => {
        if (!context.current()) throw new ApiError("Your company or account changed. Reload the workspace before continuing this lease.", 409, "LEASE_CONTEXT_CHANGED", pending);
        const wasRecovering = pending || !!leasePending(storageKey);
        const prepared = attempt.current || { ...review, payload: prepare ? await prepare(p) : p };
        attempt.current = prepared;
        sessionStorage.setItem(storageKey, JSON.stringify(prepared));
        setPending(true);
        try {
          const row = await api<{ id: string }>("/api/company/leases", {
            method: "POST",
            body: prepared.payload,
            expectedCompanyId: context.companyId,
          });
          if (!context.current()) throw new ApiError("Your company or account changed before the lease result was acknowledged. Keep the original request for recovery.", 409, "LEASE_CONTEXT_CHANGED", true);
          sessionStorage.removeItem(storageKey);
          editor.completed(completedElement?.current || undefined);
          void finished?.();
          saved(row);
        } catch (error) {
          failed?.(error);
          if (
            !wasRecovering && error instanceof ApiError && !error.submissionUncertain &&
            !["IMPERSONATION_CONTEXT_CHANGED", "SUBMISSION_MISMATCH"].includes(error.code) &&
            [400, 403, 404, 409].includes(error.status)
          ) {
            sessionStorage.removeItem(storageKey);
            setPending(false);
            attempt.current = null;
          }
          if (error instanceof ApiError && ["IMPERSONATION_CONTEXT_CHANGED", "SUBMISSION_MISMATCH"].includes(error.code)) error.submissionUncertain = true;
          throw error;
        }
      }}
    >
      <p className="eyebrow">
        {pending ? "Review lease · checking previous save" : "Review lease · nothing is saved until you confirm"}
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
            {formatDate(String(p.startsOn))} through{" "}
            {formatDate(p.endsOn ? String(p.endsOn) : null, "Open ended")}
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
      {!!p.residentContactId&&<p className="help">This connects the tenant to this property. An active linked resident account receives property access; shared financial access follows the approved leaseholder role. A profile without an account remains available for tracking.</p>}
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
