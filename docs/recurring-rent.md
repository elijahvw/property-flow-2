> Status reconciled October 20, 2026: use [current platform status](mvp-status.md) and [the roadmap](product-roadmap.md) for delivery and remaining scope. Dated branch/release/test/limitation statements below are historical checkpoints, not the current deployment or acceptance state. No historical pass is promoted to real-account acceptance.

# Recurring rent and payment history

Development increment on `codex/recurring-rent-billing`, based on merged/deployed main `842c8b04b35e62174a37ad4a25e295758afcb4c9` (PR25). Do not merge or deploy without the user's approval; the user runs deployments.

## Verified previous release

The user merged PR25 and deployed main842c8b0. Manual Deploy Dev run [38771155784](https://github.com/elijahvw/property-flow-2/actions/runs/38771155784) succeeded: backend, frontend and release recording passed, Terraform apply was skipped. Public smoke checks found frontend version842c8b0 and payment-policy code, homepage/lease/rent deep links200, `/api/ready`200 with DB connected, and both protected rent APIs401 JSON without a session. This is rollout/public smoke evidence, not authenticated real-account acceptance.

## What this increment adds

From a lease's Rent ledger, an owner/manager can choose **Set up recurring rent**, enter schedule dates and review concrete installments before explicitly enabling. Existing leases remain manual; migrations enable no schedules. A charge is an amount owed, not a collected payment.

The monthly amount, due day and grace are saved from the reviewed lease version. Configure the first/last service month, a zero-to-28-day posting lead, an optional first agreed due date (including before move-in), and explicit positive first/final partial amounts. Blank partial amounts use the full monthly rent; there is no automatic proration. Due days29–31 clamp to month end. First due dates must not delay the processing of a later installment. Older service months need manual review/posting; new schedules start this month or later. An ending lease bounds the schedule automatically. The review includes the full range/partial amounts and up to three concrete installments.

An active schedule is company-owned authorization to bill its lease, independent of the creator's later account role. Billing is separate from login/property access: removing a resident's portal access does not waive contractual rent. Company suspension prevents processing. Lease status and dates still bound processing. Changes to lease dates, rent, status, due day or grace require **stopping** any active/paused schedule first; shared instruction edits remain allowed. Stop and explicitly review a replacement to change billing terms. Posted charges are never rewritten.

**Pause** keeps terms and the next unprocessed month. Resuming catches up due, unprocessed months, one per check. **Stop** is final for that schedule. Completed/stopped history stays available. A replacement cannot automatically recreate an already processed or deliberately voided month. Existing manual charges remain intact, including manual corrections that replaced an earlier voided charge. Further corrections remain explicit manual operations.

The manager sees upcoming dates, state, last check/error and paginated posting history. **Check next installment** runs one safe recovery check; it does not post future installments early. API failures preserve existing ledger information, while schedule load failures block schedule configuration until recovered. Interrupted activation retains the exact reviewed request and UUID in scoped tab session storage, including across reload; recovery remains available even if the original activation already created the schedule.

## Automatic processing and durable identity

The HTTP service starts a background sweep on startup and about every minute. Only explicitly enabled schedules are processed. It uses the restricted runtime role, company-by-company RLS context, bounded/keyset scans and a time budget. Multiple ECS replicas can run the worker: a shared lease write fence plus Serializable retry and a permanent unique company/lease/service-month occurrence coordinate worker, manager, manual charge, pause and lease-edit operations.

Each completed installment transaction includes charge creation, available-credit allocation, occurrence, audit and cursor advance. A crash/audit failure rolls all of these back. Existing/voided months are recorded as retained/suppressed rather than posted again. Worker audits identify `system:rent-billing`; scheduled charges retain the schedule authorizer and source schedule ID. Monetary schedule fields, source schedule links and occurrence history cannot be rewritten/deleted by the runtime. Same-company/property/lease foreign keys and forced RLS apply to both new tables.

Failure records contain a safe error code/last attempt time; retries do not overwrite newer progress or pause/stop state. Worker scans do not overlap within a process and shutdown waits for current work. No request, browser tab or human login is required to post after activation. If the service/database is off, billing resumes when it returns, one unprocessed month per check; this is not a midnight deadline guarantee or a separately monitored job service. Large ledgers that hit existing allocation safety caps fail closed and require operator review rather than partial financial writes. Schedule attention is currently visible on each lease ledger, not a centralized billing-operations dashboard.

## Paid late versus currently up to date

A charge remains **Paid late** if any applied, non-voided receipt was received after that charge's saved grace-through date. Fully settled charges show their settlement date (latest received date among applied receipts). The current account independently shows **Up to date — no past-due rent** when appropriate. Future unpaid rent does not make today's account past due.

This uses the manually recorded `occurredOn` receipt date, not when a manager entered it or when credit was allocated. A receipt entered later but dated on the last grace day is within grace. Partial receipts can include an after-grace portion while the charge remains unpaid. Voiding/correcting a receipt recomputes standing/history from active sources; audit retains the correction trail. Manager and resident ledgers and ledger CSV retain the timing; managers can filter accounts by paid-late history. This is current truth from active receipts, not an immutable credit score, a historical as-of report or an assertion that self-entered receipt dates have been independently verified.

No automatic fees, notices, messages, deposits, payment processing, provider connection, infrastructure changes or live/shared database mutations are included. Additive migration014 creates schedule/occurrence storage and a nullable source schedule on charges. Guided initial lease activation, effective-dated rent changes and renewals remain future increments in the roadmap.

## Validation and acceptance

Local checks: client/server builds, 51 safe Node checks (five DB suites run separately), 88 browser fixtures (87 in the initial full run plus the added one-month review regression, with all seven new workflow cases rechecked locally) with mobile/desktop inspection, disposable PostgreSQL finance/reporting/rent/schedules/payment-history integration54, existing leasing 13, users21, maintenance9 and access40. The financial suite includes a real browser → Fastify → PostgreSQL committed-response-loss activation/reload/replay. Current exact totals and PR CI are recorded in the PR description. These checks do not claim authenticated dev acceptance.

After approved merge and user-run dev deployment:

1. On a dedicated test lease, set due day31/grace5. Review a recurring schedule with a first partial amount, final month/amount and posting lead. Verify the dates before enabling. Confirm no schedule or charge appears merely from previewing.
2. Enable, wait for a check or use Check next installment. Confirm one posted charge/history row and expected credit allocation. Reload/recheck; no duplicate. Pause and verify no processing; resume only after reviewing the catch-up notice. Stop before editing financial lease terms.
3. Test an active manual charge and a deliberately voided month. Automatic posting must retain/skip them. A replacement schedule must not recreate a processed month.
4. For a fresh test charge due October1 with grace5, record the full payment received October10. Expect Paid late, settlement October10, zero overdue and Up to date. Repeat separately with October6 received date; expect paid within grace. Use actual permitted lease months/dates if these example dates are outside the test lease.
5. Check partial payments and receipt void/correction. Confirm late amounts, remaining balance and aging recompute once. View as the resident: shared terms and timing are visible, internal memo and manager schedule controls are absent. Verify staff and Company B denials.
