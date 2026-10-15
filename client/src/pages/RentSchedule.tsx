import {
  RentRepost,
  pendingRepost,
  repostStorage,
  type RepostReview,
} from "./RentRepost";
import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "./Workspace";
import { dollars } from "./Finances";
type Lease = {
  id: string;
  version: number;
  status: string;
  startsOn: string;
  endsOn: string | null;
  rentCents: number;
  rentDueDay?: number;
  graceDays?: number;
};
type Installment = {
  periodOn: string;
  postOn: string;
  dueOn: string;
  amountCents: number;
  action: string;
};
type Schedule = {
  id: string;
  status: string;
  version: number;
  firstPeriodOn: string;
  lastPeriodOn: string | null;
  nextPeriodOn: string;
  amountCents: number;
  firstAmountCents: number | null;
  lastAmountCents: number | null;
  firstDueOn: string | null;
  dueDay: number;
  graceDays: number;
  leadDays: number;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
};
type Data = {
  schedule: Schedule | null;
  preview: Installment[];
  history: {
    id: string;
    periodOn: string;
    outcome: string;
    createdAt: string;
    currentCharge?: {
      id: string;
      reference?: string;
      amountCents: number;
      dueOn: string;
    } | null;
    scheduleId?: string;
    charge?: {
      reference?: string;
      id: string;
      amountCents: number;
      dueOn: string;
      voidedAt: string | null;
    } | null;
  }[];
  nextCursor: string | null;
};
type Reviewed = {
  payload: Record<string, unknown>;
  config: Schedule;
  preview: Installment[];
  businessDate: string;
};
function Preview({ items }: { items: Installment[] }) {
  return (
    <ol className="billing-preview">
      {items.map((item) => (
        <li key={item.periodOn}>
          <strong>
            {item.periodOn.slice(0, 7)} · {dollars(String(item.amountCents))}
          </strong>
          <span>
            Post {item.postOn.slice(0, 10)} · due {item.dueOn.slice(0, 10)}
          </span>
          <small>
            {
              (
                {
                  post: "Will post when scheduled",
                  existing: "Already posted — no duplicate",
                  suppressed: "Previously voided — manual review only",
                  already_processed:
                    "Already processed — no automatic replacement",
                } as Record<string, string>
              )[item.action]
            }
          </small>
        </li>
      ))}
    </ol>
  );
}
export function RentSchedule({
  lease,
  businessDate,
  changed,
}: {
  lease: Lease;
  businessDate: string;
  changed: () => void;
}) {
  const auth = useAuth().data,
    key = `pf:rent-schedule:${auth?.user.id}:${auth?.membership?.companyId}:${lease.id}`;
  const [cursor, setCursor] = useState(""),
    [open, setOpen] = useState(false),
    [manage, setManage] = useState<Schedule | null>(null),
    [note, setNote] = useState("");
  const r = useResource<Data>(
    `/api/company/rent/${encodeURIComponent(lease.id)}/schedule${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    true,
    true,
  );
  const schedule = r.data?.schedule;
  const repostKey = repostStorage(
    auth!.user.id,
    auth!.membership!.companyId,
    lease.id,
  );
  const [repost, setRepost] = useState<{
      review: RepostReview;
      restored?: ReturnType<typeof pendingRepost>;
    } | null>(null),
    [repostOpen, setRepostOpen] = useState(false),
    [repostError, setRepostError] = useState("");
  const retainedRepost = pendingRepost(repostKey);
  let recoverable = false;
  try {
    recoverable = !!sessionStorage.getItem(key);
  } catch {}
  const refreshed = () => {
    r.reload();
    changed();
  };
  return (
    <section className="panel recurring-rent" aria-label="Recurring rent">
      <div className="section-heading">
        <div>
          <h2>Recurring rent</h2>
          <p className="help">
            Reviewed monthly charges, separate from receiving a payment.
          </p>
        </div>
        {r.data &&
          !r.error &&
          (!schedule || ["stopped", "completed"].includes(schedule.status)) &&
          lease.status === "active" && (
            <button className="secondary" onClick={() => setOpen(true)}>
              Set up recurring rent
            </button>
          )}
      </div>
      {recoverable && (
        <button className="secondary" onClick={() => setOpen(true)}>
          Recover reviewed schedule
        </button>
      )}
      {r.error ? (
        <div role="alert" className="notice error">
          {r.error}
          <button className="text-button" onClick={r.reload}>
            Retry billing schedule
          </button>
        </div>
      ) : !r.data ? (
        <p role="status">Loading billing schedule…</p>
      ) : !schedule ? (
        <p>
          Manual billing. No automatic rent charges are enabled.
          {lease.status !== "active" &&
            " Activate the lease before setting up a schedule."}
        </p>
      ) : (
        <>
          <div className="billing-status">
            <strong className={`collection-badge ${schedule.status}`}>
              {schedule.status}
            </strong>
            <span>
              {dollars(String(schedule.amountCents))} each month · due day{" "}
              {schedule.dueDay} · {schedule.graceDays} days grace
            </span>
          </div>
          <p className="help">
            Posts {schedule.leadDays} calendar days before due.{" "}
            {schedule.firstPeriodOn.slice(0, 7)} through{" "}
            {schedule.lastPeriodOn?.slice(0, 7) || "lease end or manual stop"}.{" "}
            {schedule.firstAmountCents !== null &&
              `First month ${dollars(String(schedule.firstAmountCents))}. `}
            {schedule.lastAmountCents !== null &&
              `Final month ${dollars(String(schedule.lastAmountCents))}.`}
          </p>
          {schedule.status === "paused" && (
            <p className="notice">
              Paused. Resuming catches up due, unprocessed months using the
              saved terms, one installment per check.
            </p>
          )}
          {schedule.lastErrorCode && (
            <p role="alert" className="notice error">
              Automatic posting needs attention ({schedule.lastErrorCode}).
              Review the lease and try the next installment again. No incomplete
              charge is saved.
            </p>
          )}
          {["active", "paused"].includes(schedule.status) && (
            <>
              <Preview items={r.data.preview || []} />
              <div className="actions">
                <button
                  className="secondary"
                  disabled={!!r.error}
                  onClick={() => setManage(schedule)}
                >
                  Manage billing schedule
                </button>
                {schedule.status === "active" && (
                  <Form
                    operation="account.update"
                    label="Check next installment"
                    successText="Billing check complete."
                    submit={async () => {
                      const result = await api<{
                        outcome: string;
                        periodOn?: string;
                        postOn?: string;
                        dueOn?: string;
                        businessDate?: string;
                        previousInstallment?: {
                          periodOn: string;
                          voided: boolean;
                        } | null;
                      }>(
                        `/api/company/rent-schedules/${encodeURIComponent(schedule.id)}/run`,
                        { method: "POST", body: {} },
                      );
                      setNote(
                        result.outcome === "not_due"
                          ? result.periodOn && result.postOn
                            ? `Next installment ${result.periodOn.slice(0, 7)} posts ${result.postOn.slice(0, 10)} (due ${result.dueOn?.slice(0, 10)}; company date ${result.businessDate}).${result.previousInstallment?.voided ? ` ${result.previousInstallment.periodOn.slice(0, 7)} was already processed and its charge is now voided. Review a repost below to bill that month again.` : ""}`
                            : "The next installment is not due for posting yet."
                          : "Billing check complete. Review the posting history.",
                      );
                      refreshed();
                    }}
                  >
                    <span className="help">
                      Automatic checks run about every minute while the service
                      is available.
                    </span>
                  </Form>
                )}
              </div>
            </>
          )}
          <p className="help">
            {schedule.lastCheckedAt
              ? `Last automatic/manual check ${new Date(schedule.lastCheckedAt).toLocaleString()}.`
              : "Waiting for the first billing check."}{" "}
            Saved billing amounts and grace do not change when instructions are
            edited. Stop and review a replacement schedule to change billing
            terms.
          </p>
        </>
      )}
      {note && (
        <p role="status" className="notice">
          {note}
        </p>
      )}
      {repostError && <p role="alert">{repostError}</p>}
      {retainedRepost && (
        <button
          className="secondary"
          onClick={() => {
            setRepost({
              review: retainedRepost.review,
              restored: retainedRepost,
            });
            setRepostOpen(true);
          }}
        >
          Recover pending repost
        </button>
      )}
      {!!r.data?.history?.length && (
        <details>
          <summary>Posting history · latest page</summary>
          <ul className="record-list">
            {r.data.history.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>
                    {row.periodOn.slice(0, 7)} ·{" "}
                    {row.outcome === "posted"
                      ? "Automatically posted"
                      : row.outcome === "existing"
                        ? "Existing charge retained"
                        : "Voided month skipped"}
                  </strong>
                  <p className="help">
                    {row.charge &&
                      `${dollars(String(row.charge.amountCents))} · due ${row.charge.dueOn.slice(0, 10)}${row.charge.voidedAt ? " · now voided" : ""} · `}
                    {new Date(row.createdAt).toLocaleString()}
                  </p>
                </div>
                {row.currentCharge &&
                  row.currentCharge.id !== row.charge?.id && (
                    <p className="help">
                      Current replacement:{" "}
                      {row.currentCharge.reference || "Rent charge"} ·{" "}
                      {dollars(row.currentCharge.amountCents)}
                    </p>
                  )}
                {row.currentCharge === null &&
                  (row.charge?.voidedAt || row.outcome === "suppressed") &&
                  (!row.scheduleId || row.scheduleId === schedule?.id) && (
                    <Form
                      operation="page.data.load"
                      label={`Review repost for ${row.periodOn.slice(0, 7)}`}
                      submit={async () => {
                        setRepostError("");
                        const review = await api<RepostReview>(
                          `/api/company/rent-schedules/${encodeURIComponent(row.scheduleId || schedule!.id)}/repost-preview`,
                          { method: "POST", body: { occurrenceId: row.id } },
                        );
                        setRepost({ review });
                        setRepostOpen(true);
                      }}
                    >
                      <span className="help">
                        This month is voided. Automatic checks will not recreate
                        it.
                      </span>
                    </Form>
                  )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {cursor && (
        <button className="text-button" onClick={() => setCursor("")}>
          Latest posting history
        </button>
      )}
      {r.data?.nextCursor && (
        <button
          className="text-button"
          onClick={() => setCursor(r.data!.nextCursor!)}
        >
          Older posting history
        </button>
      )}
      <EditorDialog
        open={repostOpen}
        title="Review installment repost"
        onClose={() => setRepostOpen(false)}
      >
        {repost && (
          <RentRepost
            key={repost.review.occurrenceId}
            review={repost.review}
            restored={repost.restored}
            saved={() => {
              setRepostOpen(false);
              setRepost(null);
              refreshed();
            }}
          />
        )}
      </EditorDialog>
      <EditorDialog
        open={open}
        title="Set up recurring rent"
        onClose={() => setOpen(false)}
      >
        <ScheduleSetup
          key={key}
          lease={lease}
          businessDate={businessDate}
          storageKey={key}
          saved={() => {
            setOpen(false);
            refreshed();
          }}
        />
      </EditorDialog>
      <EditorDialog
        open={!!manage}
        title="Manage billing schedule"
        onClose={() => setManage(null)}
      >
        {manage && (
          <Form
            key={`${manage.id}:${manage.version}`}
            label="Save billing status"
            operation="account.update"
            submit={async (f) => {
              await api(
                `/api/company/rent-schedules/${encodeURIComponent(manage.id)}`,
                {
                  method: "PATCH",
                  body: {
                    status: f.get("status"),
                    expectedVersion: manage.version,
                  },
                },
              );
              setManage(null);
              refreshed();
            }}
          >
            <label>
              Billing status
              <select name="status" defaultValue={manage.status}>
                <option value="active">Active — post scheduled rent</option>
                <option value="paused">
                  Paused — retain terms and next month
                </option>
                <option value="stopped">
                  Stopped — review a new schedule to restart
                </option>
              </select>
            </label>
            <p className="notice">
              Pausing retains unprocessed months. Resuming catches up any that
              are due. Stopping preserves all charges and history and cannot be
              undone. No payments or charges are removed.
            </p>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setManage(null);
                r.reload();
              }}
            >
              Close and load current status
            </button>
          </Form>
        )}
      </EditorDialog>
    </section>
  );
}
function ScheduleSetup({
  lease,
  businessDate,
  storageKey,
  saved,
}: {
  lease: Lease;
  businessDate: string;
  storageKey: string;
  saved: () => void;
}) {
  const restore = () => {
    try {
      const v = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      return v?.payload?.submissionKey && v?.preview && v?.config
        ? (v as Reviewed)
        : null;
    } catch {
      return null;
    }
  };
  const [reviewed, setReviewed] = useState<Reviewed | null>(restore),
    [pending, setPending] = useState(!!reviewed),
    [draft, setDraft] = useState<Record<string, string>>({});
  const firstMonth =
    lease.startsOn.slice(0, 7) > businessDate.slice(0, 7)
      ? lease.startsOn.slice(0, 7)
      : businessDate.slice(0, 7);
  if (reviewed)
    return (
      <Form
        key="review"
        label={
          pending ? "Retry enabling this schedule" : "Enable recurring rent"
        }
        operation="account.update"
        successText="Recurring rent enabled."
        submit={async () => {
          sessionStorage.setItem(storageKey, JSON.stringify(reviewed));
          setPending(true);
          await api(
            `/api/company/rent/${encodeURIComponent(lease.id)}/schedules`,
            { method: "POST", body: reviewed.payload },
          );
          sessionStorage.removeItem(storageKey);
          setReviewed(null);
          setPending(false);
          setDraft({});
          saved();
        }}
      >
        <p className="eyebrow">Step 2 of 2 · Review and enable</p>
        <p>
          {dollars(String(reviewed.config.amountCents))} monthly · due day{" "}
          {reviewed.config.dueDay} · {reviewed.config.graceDays} days grace ·
          post {reviewed.config.leadDays} days before due.
        </p>
        <p className="help">
          Rent months {reviewed.config.firstPeriodOn.slice(0, 7)} through{" "}
          {reviewed.config.lastPeriodOn?.slice(0, 7) ||
            "lease end or manual stop"}
          . First amount{" "}
          {dollars(
            String(
              reviewed.preview[0]?.amountCents ?? reviewed.config.amountCents,
            ),
          )}
          ; final amount{" "}
          {dollars(
            String(
              reviewed.config.lastPeriodOn?.slice(0, 10) ===
                reviewed.config.firstPeriodOn.slice(0, 10)
                ? (reviewed.preview[0]?.amountCents ??
                    reviewed.config.amountCents)
                : (reviewed.config.lastAmountCents ??
                    reviewed.config.amountCents),
            ),
          )}
          .{" "}
          {reviewed.config.firstDueOn &&
            `First due date ${reviewed.config.firstDueOn.slice(0, 10)}.`}
        </p>
        <Preview items={reviewed.preview} />
        <p className="notice">
          This enables automatic rent charges, including any previewed dates
          already reached. First/final partial amounts are explicit; no
          automatic proration, late fees, deposits or payments. Existing and
          voided months are never automatically replaced.
        </p>
        <p className="help">
          The schedule remains company-owned if its creator changes roles.
          Company suspension pauses processing. Lease status and term boundaries
          still apply.
        </p>
        {pending ? (
          <p role="status">
            An earlier attempt may have succeeded. Retry uses the same reviewed
            details and identity. Check the current schedule before discarding
            this retry.
          </p>
        ) : (
          <button
            type="button"
            className="text-button"
            onClick={() => setReviewed(null)}
          >
            Back to schedule details
          </button>
        )}
        <button
          className="text-button"
          type="button"
          onClick={() => {
            if (
              confirm(
                "Discard these reviewed details and any pending retry? This does not stop an existing schedule. Check its current status before enabling another.",
              )
            ) {
              sessionStorage.removeItem(storageKey);
              setReviewed(null);
              setPending(false);
            }
          }}
        >
          Discard reviewed schedule
        </button>
      </Form>
    );
  return (
    <Form
      key="configure"
      label="Review schedule"
      operation="page.data.load"
      submit={async (f) => {
        const strings = Object.fromEntries(
          Array.from(f.entries()).map(([k, v]) => [k, String(v)]),
        );
        setDraft(strings);
        const payload = {
          firstPeriodOn: String(f.get("firstMonth")) + "-01",
          lastPeriodOn: f.get("lastMonth")
            ? String(f.get("lastMonth")) + "-01"
            : null,
          firstDueOn: f.get("firstDueOn") || null,
          firstAmount: f.get("firstAmount") || null,
          lastAmount: f.get("lastAmount") || null,
          leadDays: Number(f.get("leadDays")),
          expectedVersion: lease.version,
          submissionKey: crypto.randomUUID(),
        };
        const result = await api<Omit<Reviewed, "payload">>(
          `/api/company/rent/${encodeURIComponent(lease.id)}/schedule-preview`,
          { method: "POST", body: payload },
        );
        setReviewed({ ...result, payload });
      }}
    >
      <p className="eyebrow">Step 1 of 2 · Billing dates and partial months</p>
      <p>
        {dollars(String(lease.rentCents))} monthly from this lease · due day{" "}
        {lease.rentDueDay ?? 1} · {lease.graceDays ?? 0} days grace. Edit the
        lease first if these terms need changing.
      </p>
      <div className="form-grid">
        <label>
          First rent month
          <input
            name="firstMonth"
            type="month"
            required
            min={businessDate.slice(0, 7)}
            defaultValue={draft.firstMonth || firstMonth}
          />
        </label>
        <label>
          Last rent month (optional)
          <input
            name="lastMonth"
            type="month"
            defaultValue={draft.lastMonth ?? lease.endsOn?.slice(0, 7) ?? ""}
          />
        </label>
        <label>
          Post days before due
          <input
            name="leadDays"
            type="number"
            required
            min="0"
            max="28"
            step="1"
            defaultValue={draft.leadDays ?? "0"}
          />
        </label>
        <label>
          First due date override (optional)
          <input
            name="firstDueOn"
            type="date"
            defaultValue={draft.firstDueOn || ""}
          />
        </label>
        <label>
          First partial amount (USD, optional)
          <input
            name="firstAmount"
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]{1,2})?"
            defaultValue={draft.firstAmount || ""}
          />
        </label>
        <label>
          Final partial amount (USD, optional)
          <input
            name="lastAmount"
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]{1,2})?"
            defaultValue={draft.lastAmount || ""}
          />
        </label>
      </div>
      <p className="help">
        Blank partial amounts use full monthly rent. Due days 29–31 clamp to
        month end. The first agreed due date may precede move-in. Older rent
        needs manual review and posting; enabling never silently backfills
        earlier months.
      </p>
    </Form>
  );
}
