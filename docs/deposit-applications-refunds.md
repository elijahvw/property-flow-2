# PF-06: deposit applications and actual manual refunds

Implemented locally after PF-05, for user testing before a batched cloud release. No cloud migration, deployment, bank action or provider refund is authorized by this implementation.

## Three explicit actions

- **Apply deposit to a charge:** an owner/finance manager reviews one lease's held funds, a named unpaid charge, exact amount, effective date and tenant-visible reason, then confirms authorization under the lease/agreement. The immutable movement reduces held funds and debt together. It creates no cash entry and is distinct from a concession or cash receipt.
- **Record deposit refund:** record a partial/full amount actually returned outside Property Flow, with date, person paid, method, optional private reference and public reason. Check payments require a check/reference number. One immutable refund source creates exactly one linked cash outflow, not an operating expense.
- **Record payment refund:** return only the currently unapplied amount of one named lease payment. Review its date, original source/version and remaining funds. Already applied cash is not silently unallocated or refunded. A fully allocated payment must follow a separately reviewed correction/disposition workflow; recording a refund does not rewrite its allocations.

New actions require a non-draft lease, current finance authority, CSRF, exact reviewed lease/account/source versions, reviewed available/remaining cents, a durable UUID/fingerprint and atomic audit writes. A date cannot be in the future. Payment refunds cannot precede the source receipt. Deposit actions cannot use deposit cash before its recorded receipt date. All calculations otherwise use current source/correction status; these are not historical as-of bank balances.

## Balances and cash reports

Valid deposit receipts exclude corrected receipts. Current held = valid receipts − active applications − active deposit refunds. Applied and returned totals are separate, with original receipt corrections shown separately. “Still to collect” compares the recorded collection requirement with valid receipts, so disposing of a funded deposit never automatically asks the tenant to pay it again. Changing an agreed collection requirement is explicit; this phase does not generate top-up charges, interest, statutory notices or deposit deadlines.

Applications reduce the named charge's remaining debt and the lease's net balance; they do not increase received cash or concession totals. A charge settled from deposit is labeled accordingly rather than cash paid/paid late. Cash payment refunds reduce that source's unapplied credit and increase the lease net balance while preserving gross receipts and old allocation IDs.

Cash reports show gross received income, paid expenses, rent-payment refunds and deposit refunds separately. Operating net = income − expenses − rent refunds. Net recorded cash movement = operating net + deposit receipts − deposit refunds. Deposit applications have no bank movement. Existing receipt classifications are preserved; this is not tax/accounting profit or bank reconciliation. Dashboard, lease ledger, tenant workspace, deposit directory, statements and source CSVs use the same current-status calculations.

Statements include application/reversal and payment-refund sources; their deposit section includes disposition totals and linked history. Corrections retain source references/IDs. Resident responses expose the authorized shared lease history and public reasons; internal notes, payment references, submission hashes and actor metadata stay out of resident responses. Historical tenant access continues to follow existing current membership/assignment/leaseholder rules.

## Correction and reversal

A deposit application can be fully reversed through a linked immutable correction. Held funds are restored, the named debt reopens, and any available cash credit can apply without moving old allocations. Partial adjustment uses a full reversal plus a newly reviewed application. Active applications must be reversed before correcting their charge.

A refund record correction is used when the original record was wrong. It creates a linked immutable correction and atomically voids the one linked cash outflow. It restores recorded available funds, creates no new cash receipt and performs no bank/provider transaction. If returned money was actually received back, do not use a record correction to fabricate that receipt; record the actual received money through the appropriate reviewed receipt workflow.

Original payment receipts with active refunds cannot be voided first. Deposit receipt corrections cannot reduce valid funds below dispositions already recorded. Current source totals, immutable foreign keys and deferred cash/correction-pair checks enforce these rules independently of the UI.

## Migration, local preview and validation

`202610160020_lease_money_movements` is additive and transactional. It adds immutable movement/reversal tables, tenant-scoped RLS, composite foreign keys, scoped runtime grants and a linked nullable cash-source ID. Existing receipts, deposit requirements/revisions, allocations, charges, references and audits retain their identities. Application rollback to a binary unaware of these movements is unsafe after movements are recorded: use a forward fix or a reviewed full restore.

The local preview preserves the prior PF-05 sample records and sessions. Its verified local backup can be restored with `--upgrade-from-pf05-preview`, which explicitly verifies the old/new schema markers and applies only PF-06 to that disposable database. Subsequent backups of the upgraded preview use ordinary `--restore-local-preview`. This switch cannot select a cloud database.

Validation covers concurrent application/refund reviews, direct concurrent runtime writers, immutable/RLS/cross-source guards, required cash source, linked correction pairs, lost-response UUID replay, audit rollback, stale funds, denied roles, resident privacy, date validation and exact statement/cash reconciliation. Browser checks cover readable month-name dates, source review, desktop/mobile layout, retained reviews and reload/retry. See the current local validation results in the development handoff; hosted/live provider acceptance remains pending the user's release decision.

Local validation: both production builds; 135 disposable finance/API/database/browser checks; 147 UI regression checks, followed by 39 focused export/layout checks; 48 safe server checks (5 intentional database-suite skips); and 18 client unit checks pass. Desktop and 390-pixel mobile screenshots were inspected. Hosted CI and cloud deployment have not run for this batch.

## Resident portal refinement — October 17, 2026 (local)

Resident financial records are view-only. Deposit and rent pages describe recorded history instead of instructing residents to apply deposits, record refunds or receipts, or correct money records. The resident portal shows an explicit online-payment availability notice and keeps agreed lease payment instructions visible. There is no payment processor or document upload in this increment. Shared history, source identities, resident privacy projections and owner/manager operating controls are preserved. Financial mutation endpoints require fresh `finance.manage`; resident aliases expose reads only. Household/invitation changes are also disabled for residents, while profile edits and maintenance request submission remain available.

Regression coverage in `server/tests/resident-portal-cases.mjs` exercises valid direct financial mutation attempts, missing resident write aliases, unchanged balances/audits and resident desktop/phone navigation with no financial/household management forms. The broader disposable finance suite retains owner/manager workflows and owner-approved invitation acceptance. Validation and release status are recorded in `docs/current-work.md`.

Validated in the isolated PR checkout: client/server production builds; 176 disposable PostgreSQL/API/browser finance checks; 12 affected lease/household browser checks; 52 server unit passes (5 database suites skipped in that unit run) and 25 client unit passes. No schema migration or provider activation is required. Hosted CI, deployment and real-account acceptance remain separate.
