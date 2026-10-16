import { formatDate, formatMonth } from "../dates";
import { useState } from "react";
import { api, ApiError } from "../api";
import { Form } from "./Workspace";
import { dollars } from "./Finances";
import { useAuth } from "../context/AuthContext";
export type RepostReview = {
  scheduleId: string;
  occurrenceId: string;
  leaseId: string;
  expectedLeaseVersion: number;
  expectedScheduleVersion: number;
  periodOn: string;
  dueOn: string;
  postOn: string;
  amountCents: number;
  graceDays: number;
  businessDate: string;
};
type Pending = { review: RepostReview; payload: Record<string, unknown> };
export function repostStorage(
  userId: string,
  companyId: string,
  leaseId: string,
) {
  return `pf:rent-repost:${userId}:${companyId}:${leaseId}`;
}
export function pendingRepost(key: string): Pending | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null");
    return saved?.payload?.submissionKey && saved?.review?.occurrenceId
      ? saved
      : null;
  } catch {
    return null;
  }
}
export function RentRepost({
  review,
  restored,
  saved,
}: {
  review: RepostReview;
  restored?: Pending | null;
  saved: () => void;
}) {
  const auth = useAuth().data,
    key = repostStorage(
      auth!.user.id,
      auth!.membership!.companyId,
      review.leaseId,
    );
  const [pending, setPending] = useState<Pending | null>(restored ?? null);
  return (
    <Form
      label={pending ? "Retry this repost" : "Repost installment"}
      operation="rent.charge"
      successText="Installment reposted; original history retained."
      submit={async (data) => {
        const original = pending ?? {
          review,
          payload: {
            occurrenceId: review.occurrenceId,
            expectedLeaseVersion: review.expectedLeaseVersion,
            expectedScheduleVersion: review.expectedScheduleVersion,
            reason: data.get("reason"),
            submissionKey: crypto.randomUUID(),
          },
        };
        sessionStorage.setItem(key, JSON.stringify(original));
        setPending(original);
        try {
          await api(
            `/api/company/rent-schedules/${encodeURIComponent(original.review.scheduleId)}/reposts`,
            { method: "POST", body: original.payload },
          );
          sessionStorage.removeItem(key);
          saved();
        } catch (error) {
          if (
            error instanceof ApiError &&
            [400, 403, 404, 409].includes(error.status)
          ) {
            sessionStorage.removeItem(key);
            setPending(null);
          }
          throw error;
        }
      }}
    >
      <p className="eyebrow">
        One-time recovery · {formatMonth(review.periodOn)}
      </p>
      <p>
        <strong>{dollars(review.amountCents)}</strong> · due{" "}
        {formatDate(review.dueOn)} · {review.graceDays} days grace.
      </p>
      <p className="notice">
        This creates one replacement charge using the saved schedule terms. The
        original void and posting history remain. Future installments and the
        schedule's next month do not change.
      </p>
      <fieldset disabled={!!pending}>
        <label>
          Reason for reposting
          <textarea
            name="reason"
            required
            maxLength={300}
            defaultValue={String(pending?.payload.reason ?? "")}
          />
        </label>
      </fieldset>
      {pending && (
        <p role="status">
          An earlier attempt may have succeeded. Retry keeps the original
          reviewed details and identity.
        </p>
      )}
    </Form>
  );
}
