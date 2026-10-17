# Future-effective lease terms (PF-08)

Implemented locally for owner review on 2026-10-16. No cloud migration, deployment, PR or push is part of this batch.

## Owner workflow

An established lease opens to a concise overview of its agreement, household, billing and deposit record. It does not replay onboarding. Only draft activation and actual unapproved resident requests appear as prompts. Portal invitations, recurring billing and deposits are optional; their absence is not presented as incomplete onboarding. Tenant archive/restore lives under **More tenant actions** on the tenant detail page, with its existing confirmation, current-lease checks and preserved history.

**Terms & changes** shows current payment terms, one upcoming change and retained history. Owners and managers can plan a new monthly rent, due day, calendar grace period and shared payment instructions. The two-step form captures a tenant-visible reason and effective date before payment details, then requires a separate review/confirmation. Residents with current approved leaseholder access can read the same public terms and history; occupants cannot see lease finances. Staff remains read-only for properties and cannot fetch these management records.

## Effective-date and billing contract

- A change begins on the first day of a full future month, strictly after the company's current business date, inside an active recorded lease term. Mid-month proration belongs to PF-09. Linked end/renewal transitions remain PF-10.
- Only one uncancelled future change may exist. Cancel it before replacing it. Once a change takes effect, a later future change can be recorded. Due days 29–31 clamp to the last day of shorter months.
- Preview shows before/after terms and every remaining installment in a bounded lease/schedule horizon, up to 1,200 months. Open-ended records show the next 12 installments and explicitly state that the same rule continues monthly. Larger scopes fail explicitly instead of showing partial results as complete.
- Previously reviewed first/final installment amounts and first due-date overrides remain in force and are identified individually. A new due day cannot put the second installment before the retained first due date.
- Active recurring billing resolves terms for each installment's rent month. Paused billing stays paused; manual billing stays manual. Scheduling terms never creates, resumes or extends billing. Manual posting suggests the selected month's agreed rent/due date, permits explicit amount/due-date overrides and saves that month's effective grace policy.
- Any recorded monthly rent charge on or after the proposed effective month blocks a change or cancellation, including voided history. Separately reviewed PF-05 charges/credits handle agreed differences. Monthly charges, payments and allocations are never silently recalculated.
- Current rent views, lease details/register, tenant workspace and company overview resolve terms by the company business date. Future terms can govern an early-posted future installment without prematurely changing today's displayed monthly rent.

## History, authorization and consistency

`LeaseTermChange` retains the original policy, replacement policy, effective date, public reason, actor, timestamp and durable submission identity. A cancellation is a separate immutable event. Neither event is updated/deleted by the runtime role. Forced company RLS and compound lease/property/company foreign keys apply. The original lease financial baseline becomes immutable once any term history exists; ordinary lease edits cannot bypass the versioned history. Renewal drafts remain independent and allow their own new terms.

New monthly charges retain a DB-generated effective-policy snapshot, applicable change ID, actual charged amount and due date. Existing historical rows are not backfilled with invented snapshots. First/final overrides and manual amounts remain distinguishable from agreed monthly rent.

Term saves, cancellations, schedule posting, manual posting and lease edits share the lease write fence. The server rechecks current authority, lease version and a fingerprint of the complete term/schedule/recorded-rent review. Audit writes and event/version changes commit atomically. Identical interrupted saves replay once; changed payloads and stale reviews reject. The user's scoped review/submission key survives tab reload. Saved changes do not send legal notices, sign documents or move money.

Migration `202610160024_future_lease_terms` is local-only at this stage. `scripts/local-preview.mjs --restore-local-preview /tmp/propertyflow-local-preview-backup-<name>.sql --upgrade-from-pf07-preview` upgrades a verified PF-07 preview backup into a new loopback-only tmpfs database. The existing local preview's records and sessions were backed up privately and restored before applying this migration.

## Validation

- Client and server production builds passed.
- Disposable PostgreSQL restricted-role/API/real-browser suite: **163 passed**, including full PF-05–PF-07 regression coverage and PF-08 previews, roles, immutability, cancellation, source conflicts, audit rollback, independent owner/manager concurrency, posting/cancellation races, paused billing, effective snapshots, partial overrides and lost-response retry across reload.
- Isolated UI suite: **157 passed**, including active lease details without onboarding, real draft/approval prompts, mobile layout and tenant archive/restore from details.
- Server units: **49 passed, 5 intentional database-suite skips**; client units: **18 passed**; operations checks: **51 passed**.


PF-09/PF-10 follow-up: reviewed calendar-day partial rent and connected ending/renewal transitions are now implemented in the same local candidate; see [contract](proration-renewal-transitions.md). The older future-terms scope above describes PF-08 itself.
