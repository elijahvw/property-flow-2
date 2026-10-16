# PF-04 · Tenant statements

The user confirmed PR #36 merged/deployed and authorized the next roadmap phase, including UI improvements. This increment connects a per-lease statement to the lease overview, tenant lease cards, management rent accounts and resident rent accounts. It works for offline contacts and shared leaseholders using the existing lease identity and financial sources.

## Statement contract

- Company owner/manager access requires `finance.manage`. Resident access requires a current verified resident membership, property assignment and approved leaseholder access through the existing shared-lease predicate. Draft leases are excluded from resident statements. Occupants have no financial access. Platform authority grants no operating access.
- The API reads the complete bounded lease source set inside the existing serializable company/RLS authorization fence. It reuses the rent calculator and deposit detail calculation. Missing/incomplete or oversized sources produce an error, never a partial balance. There are no new financial records, migrations, provider calls or background jobs.
- Rent charges use the saved due date, and receipts use their received date. Optional from/through filters are inclusive calendar dates. Blank endpoints mean all earlier/later activity. Rent period, recording timestamp, correction timestamp and recurring schedule ID remain traceable separately.
- Opening net equals currently active charges less currently active receipts dated before the period. Period charges less receipts extend it to closing net. Later-dated net activity extends closing net to the current whole-lease net. Running net follows the same deterministic source-date/type/ID order. Charge rows sort before receipt rows on the same day.
- This is **current-status reporting grouped by transaction date**, not a reconstruction of historical balances. Later corrections and allocations affect current status even for earlier date ranges. Cross-period allocations are included whenever either endpoint appears in the period, with both source dates/references/IDs. Allocation rows do not add money to net activity. Empty periods retain opening/closing and whole-lease summaries.
- Current unpaid rent and unapplied receipt credit are separate. Current unpaid timing splits future due, due today, within grace and past grace, using saved charge grace periods and the company's business date. Paid-late history is separate from unpaid debt. Deposits have their own current required, recorded-held, uncollected and excess-held summary; they do not reduce rent owed or count as rent income.
- Voided records retain their original amount/reference but have zero net effect. Allocations involving a voided source remain visible as inactive history. Neither a correction void nor a negative net balance represents money refunded.
- Management and resident statements use the same shared financial projection. Neither includes private notes, receipt memos, payment references, correction reasons, another participant's contact information, submission identities or creator IDs. The property mailing address is shown as street followed by city/state/postal code.

## Interface and export

Date filters use the shared accessible native date control with month-name display, validation and one explicit Apply action. The URL preserves selected dates and known lease/tenant/property return context. Unapplied date edits disable print/download until applied. Errors clear the document and export controls; focus/visibility refresh rechecks current access.

Activity and allocation views show 25 records per page. CSV always includes the complete selected source set, allocation details and totals, with display references and internal IDs. Exact-cent numeric cells and the existing formula-safe CSV encoder are reused. Print expands every selected source/allocation record, opens allocation details and hides application controls. Desktop tables become labeled rows on mobile.

This increment does not add non-rent charges, general noncash credits, refunds, deposit applications, move-out settlement or historical as-of accounting. PF-05/PF-06 extend these financial sources and the same statement contract after their respective event contracts are reviewed.

## Verification

Regression coverage checks exact-cent partial/overpayment, date boundaries and empty periods, all current timing states, paid-late history, void/replacement and recurring recovery, separate deposits, current role/assignment/company revocation, shared leaseholders versus occupants, private-field exclusion, oversized-source refusal, complete CSV across UI pages, formula-safe text, date/return navigation, refresh failure, print expansion and mobile layout. Validation uses disposable PostgreSQL and local browser fixtures, with no live data or identity-provider email side effects.
