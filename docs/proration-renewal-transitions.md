> Status reconciled October 20, 2026: use [current platform status](mvp-status.md) and [the roadmap](product-roadmap.md) for delivery and remaining scope. Dated branch/release/test/limitation statements below are historical checkpoints, not the current deployment or acceptance state. No historical pass is promoted to real-account acceptance.

# Reviewed partial rent and lease renewal (PF-09 / PF-10)

Implemented as one local batch on 2026-10-16. No PR, push, cloud migration, Terraform apply or deployment is authorized by this work. Existing PF-05–PF-08, company/account profiles and the tenant/lease UI improvements remain in the same local candidate.

## Owner experience

The current local/PR move-out correction connects **Move-out & settlement** to this review: select a future move-out date, enter its reason and choose **Review planned move-out**. The date/reason open **Set an end date** without writing sources or replacing an unfinished lease review. Review effects and explicitly save; the lease stays active until a later final ending. A partial final month can still require the existing reviewed billing pause, which is shown before confirmation. Reconciled sales-demo fixture5 includes a real planned-end source for its offline tenant while preserving the presentation anchor and all ten walkthrough stops; older posted history is not rewritten.

During [the reconciled handoff](pr63-reconciliation-2026-10-25.md), **Retained move-out plan** keeps the original date/reason and leave protection until the prefilled target editor mounts and explicitly acknowledges them. Loading/failed context reads and older unfinished reviews do not consume the plan. **Retry lease review** only refreshes context; **Return to move-out details** restores the source editor under its guard; **Discard retained move-out plan** asks for confirmation. A canceled leave keeps the input. Adoption transfers protection to the target's normal unsaved-changes guard rather than marking a transition saved. The ordinary review/agreement/**Save end date** sequence remains required.

Unsubmitted handoff state is page-only and does not replace the existing submitted-transition journal, original request/key or reviewed versions. Actual actor/company/authority changes clear private handoff state; same-authority read-only changes retain input while locking writes. Current combined validation remains pending; dated validation below applies to its original checkpoint.

**Partial rent** reviews the first or final calendar month of a recorded lease. It shows the included dates, monthly rent, exact calendar day count and agreed charge. A manual amount override requires a reason. Calculation review and posting are separate actions. A posted month is never silently recomputed; corrections use its original ledger and separately reviewed differences.

The **Renewal** section offers **Renew or end lease**. The owner chooses a lease action and dates; a linked draft also offers manual or automatic future rent. **Review changes** presents dates, each new charge once, and plain billing/deposit effects. Day-count mathematics and record details are collapsed by default. The final action is **Complete renewal**, **End lease** or **Save end date**, with an explicit agreement checkbox. The review footer remains available while scrolling. Retained reviews can be resumed; edits retain inputs, and potentially committed saves keep their original submission identity.

The latest UI revision responds to owner feedback that the original review was repetitive and too technical: no “handoff,” “cutoff,” “zero lead days” or duplicate current-month calculation appears in the normal confirmation. Shared resident terms include readable proration and ending history, with internal actor/submission fields and successor financial details excluded.

## PF-09 calculation contract

- One supported, explicitly reviewed policy: actual included calendar days / actual days in the calendar month. Both displayed dates are included. The stored exclusive end date is the following calendar day.
- Monthly cents × included days / calendar days uses integer arithmetic. Round the final fraction once to the nearest cent, half up. No floating-point daily-rate rounding, 30-day assumption, elapsed-DST-hour calculation or inferred legal policy.
- Coverage is the exact intersection of the lease dates and the selected month. Full months use ordinary rent posting. February/leap years, 28/29/30/31-day months and a one-day lease are covered. A zero-cent rounded result requires an explicitly agreed positive amount or no charge; no invalid zero charge is inserted.
- The accepted calculation, dates, rounding, monthly rent, actual amount, reason, override reason, due date and grace policy are retained. Company business date/timezone are recorded with the review. Effective lease terms are selected for the rent month.
- Posting creates one ordinary monthly rent charge and one immutable `LeaseProration` source atomically, with audit and normal credit allocation. A recurring worker recognizes the active charge rather than duplicating it. A void retains the accepted calculation and source history.
- Preview/save share the lease fence with term edits and worker posting. Current authority, lease version and source fingerprint are rechecked. Source changes reject confirmation; identical interrupted saves replay once.

## PF-10 ending and renewal contract

**Save end date** keeps the term active. If an active schedule would reach a newly partial final month without a recorded charge, planning pauses it for explicit review/resumption rather than allowing an unnoticed full-month charge. No new schedule or charge is created by this planning action.

**End lease** records an actual ending on or after the included final date. **Complete renewal** ends the predecessor and activates its linked draft on or after the draft start date. These dates must be consecutive, in the same unit/property/company. Future transitions can be previewed but cannot prematurely end/activate occupancy. There is no unattended future activation job in this increment.

The completed review includes every remaining recorded-schedule month through its cutoff plus the final old month, up to 1,200 months. Existing charges remain unchanged; voided history remains suppressed. New missing charges are individually identified and posted on confirmation. First/final partial months use the reviewed calendar calculation unless an existing schedule already holds an explicit agreed amount. Unknown older manually billed months are not invented. Original payment credit applies through the existing allocation rules; unpaid debt and any leftover credit remain on the old lease.

Renewal confirmation posts its reviewed first rent once, optionally including a reasoned manual override. Automatic billing starts with the reviewed first-period amount/due date, zero posting lead days and an explicitly calculated partial final-period amount where applicable. It recognizes the already-posted first charge. A draft never starts billing independently. Rent-free renewals use manual billing. Previously accepted partial amounts remain explicit schedule overrides when PF-08 later changes ordinary monthly terms.

The old open schedule stops, the successor activates, first/final charges, optional next schedule, immutable transition/proration sources and audit commit together. Lease and unit write fences prevent two active occupants/schedules. A worker racing the transition either completes before the review is invalidated or observes stopped billing after completion. A failed audit rolls everything back. Durable replay cannot leave a second first charge or schedule.

Deposits stay on their original lease for separately recorded settlement/refund; no deposit or payment source is copied, automatically returned or transferred. A new deposit remains a separate recorded requirement/receipt. Current and projected old balances are captured in the transition review. Ending never marks debt paid or waived.

Household additions, primary-contact changes and portal approvals remain owner-controlled separate reviewed actions. The handoff uses the draft's existing reviewed household and validates the current primary contact/property eligibility. Resident draft finance access is denied for primary and additional leaseholders. Historical records remain available only under existing current company/property and approved leaseholder authority; ending grants no permanent or broader access. Staff remains read-only for properties.

## Storage and local verification

Migration `202610160025_proration_transitions` adds immutable `LeaseProration` and `LeaseTransition` source tables with forced company RLS, compound lease/property/company foreign keys and no runtime UPDATE/DELETE grants. Reviewed snapshots and actor/submission identities are retained. Normal public DTOs omit internal actor/submission details.

The local preview was privately backed up and restored into a fresh loopback-only tmpfs database with the new migration. During final preparation Docker restarted and discarded that database. Recovery used the October 16, 8:19 PM EDT PF-08 backup; local edits made after that backup may need re-entry. A clearly named **Release preview · Unit B** and offline **Release Preview Resident** were recreated through the local API to let the owner test partial rent and a linked renewal without modifying their original sample lease. No real invitations or money were sent. The runner now saves private automatic checkpoints every 30 seconds and on clean shutdown; checkpoint/restore preservation of both sample lease IDs was verified.

Production builds, calendar unit cases, restricted-role PostgreSQL/API tests, real-browser interrupted-save tests and the full UI suite are used for this batch. Final counts are recorded in [local release notes](dev-release-performance.md). Owner acceptance in the local browser remains required before packaging a cloud release.
