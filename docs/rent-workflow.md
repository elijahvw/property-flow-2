# Rent operations

This release connects lease terms to posted rent, manually recorded receipts, durable allocations and a resident ledger. It remains a dev release. No payment processor, email delivery, shared database mutation or deployment is part of implementation.

## Workflow

1. Activate a recorded lease with a resident and unit. Open its Rent ledger from Leases, the property tabs, Overview or Rent & balances.
2. Post a monthly charge. The form defaults to lease monthly rent and the first day of the month, or the lease start for its first partial month. Review the due date and enter an explicitly agreed partial-month amount when needed. The server validates the month and due date against the lease's term, rejects draft leases/future months, checks the reviewed lease version, and permits one active charge per lease month. Ended leases can receive historical charges within their term.
3. Record money already received. Partial payments apply to the oldest unpaid posted charge first, ordered by due date then stable record ID. Existing allocations never move retroactively when an older charge is posted. Excess remains unapplied credit and is applied automatically when another charge is posted or a payment void reopens a charge. Payments with the same received date use stable ID order. Payments dated after the company business date are rejected.
4. Review unpaid charges, past-due amounts, payments and credit separately. Past due means due before today in the company timezone. These are current balances; historical receipt dates do not create a backdated/as-of balance report. No late fees, grace period or collection policy is inferred.
5. A rent receipt is one immutable income/rent LedgerEntry linked to its lease. Finances, cash reports and Overview reuse it; charge posting itself never increases cash income. Do not enter that receipt again in Manual finances. Old manual rent entries remain unlinked; there is no guessed migration or opening balance. Correct an old manual record explicitly if replacing it with a lease-linked receipt.
6. Corrections void and replace records with a reason, retained source history and an atomic audit. Voiding a payment reopens its allocations and consumes any other available credit. Charges with active applied payments must have those payments corrected first. A void is a bookkeeping correction, not a refund. Deposits, refunds, transfers and bank reconciliation are outside this release.

Posting is an explicit monthly action per lease, not an unattended recurring billing scheduler. Bulk posting, automatic monthly scheduling, configurable due-day rules and effective-dated renewal/rent changes remain later work.

## Access and integrity

Owner/manager finance capability is required for company views and writes. Staff and platform-only accounts have no bypass. A resident gets only their own leases at currently assigned properties in their active company. Internal payment references and void reasons never appear in resident API responses/exports. Charge descriptions are explicitly labeled shared with the resident.

Mutations require exact Origin/session CSRF. Serializable transactions fence the actor, company and lease and reread current permissions. Queued permission changes cannot succeed using a stale authenticated snapshot. Tenant filters and forced RLS cover the new tables; composite keys tie charges, payments and allocations to one lease/property/company. Runtime cannot delete rent history, rewrite charge/payment amounts or update/delete allocations. A database trigger independently checks active allocation sources and prevents either source amount being exceeded.

Creation identities and fingerprints are durable and scoped by company/actor. Monthly uniqueness also prevents two different managers posting the same period. Replays return existing records without another charge, receipt or creation audit. Voided identities never implicitly create replacements. Every business write and its audit commit or roll back together.

An attempted charge/payment stores its original payload and UUID in tab-scoped sessionStorage, namespaced by user/company/lease/operation. After an ambiguous result it is restored across navigation/reload, with original fields locked for safe retry. Closing the tab can remove that recovery input; the server identity/records remain durable. Success or explicit confirmed discard removes the pending input. A definitive first-attempt validation rejection permits correction. No credentials/tokens/provider records are stored in the draft. Access denial/not-found on a subsequent read clears displayed history and closes editors; transient service failures retain visible data, show the error and disable mutations/exports.

## Views and reports

Rent & balances searches properties, units and residents and filters unpaid/credit accounts. Its summary covers the complete matching response; 25-row display pages do not change totals. Detail shows all charges/payments, retained void history, source references and payment-to-month allocations. Resident My rent uses the same balances with restricted fields and no write controls.

CSV exports use the loaded snapshot across all display pages, exact decimal money cells and formula-neutralized text. Balances CSV includes the business date; ledger CSV includes source IDs, posted/void states and historical allocation references. These are downloaded current snapshots, not archived period statements. Global account queries reject more than 1,000 leases; each query rejects more than 10,000 charges, receipts or allocations explicitly with no partial totals. Narrow to a property or lease; larger portfolios need a later aggregate/paginated service design.

## Verification

- Both builds; 46 safe Node checks (five database suites intentionally skipped in that invocation).
- Disposable PostgreSQL/API/browser: finance/report/overview/rent33, leases13, maintenance9, identity/admin21, authorization/migrations40.
- Full browser suite73 passed before adding refresh recovery; final focused recovery checks and exact-head CI are recorded in the PR.
- Real browser → cookie/CSRF Fastify → restricted Prisma → PostgreSQL test loses a committed charge response and a committed payment response, reloads the whole page, then retries. Each produces exactly one source record; original payload/key are recovered.
- Other coverage: concurrent creators/month uniqueness, mismatch, partial amounts, credits, oldest-charge allocation, void/replacement, cash report reconciliation, audit rollback, schema/RLS/grants, tenant/resident boundaries, suspension, queued permission downgrade, explicit large-scope rejection, full-page CSV and responsive save controls.

All DB checks create unique cached-image containers with tmpfs, no persistent volumes and loopback-only random ports. They remove only their own container. No shared/dev customer records are used.

## Release and manual acceptance

Additive migration `202610150012_rent_ledger`; no Terraform/Auth0 change. User approves and merges the PR, then runs Deploy Dev on main: plan_only=false, force_all=false, run_terraform=never. Backend startup applies the additive migration; both app components changed. Existing component selection/cache avoid unnecessary deployments; ECS health, readiness and rollback checks remain unchanged.

After deployment, use disposable dev data: owner/manager opens an active lease, posts an agreed month, records a partial receipt, checks remaining balance, records an overpayment, posts another eligible month and checks credit use. Verify cash income counts each receipt once; download both CSVs. Test void/replacement, resident-only own ledger and assignment removal, foreign company/staff denial, mobile forms, refresh after a simulated lost response and live account revocation. Real deployed account acceptance remains separate from local fixtures.
