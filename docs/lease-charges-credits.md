# PF-05: lease charges and noncash credits

Local implementation after merged/deployed PR #37 (`b539516`). This work is held for a later user-approved batched release. No cloud migration or deployment has run.

## Recording and accounting

Owners and managers can review a one-time utilities, parking, pet, damage or other agreed charge for a specific lease. A tenant-visible description, amount, effective date and due date are required. Effective dates cannot be in the future; due dates can. Recurring rent continues using its existing schedule and monthly uniqueness rules. Posting a charge records an obligation, not cash income.

A credit note or concession reduces one named unpaid charge, up to its currently remaining amount. It never creates cash, an unapplied noncash balance or a refundable deposit. Reviewed charge/lease versions and remaining cents are checked again when saved. Existing cash allocations retain their source IDs and amounts. Cash still applies to the oldest unpaid due date, with rent first when due dates tie; posting a new charge consumes available receipt credit.

Credits are immutable. Correct them through a linked full reversal with a tenant-visible reason and effective date no earlier than the credit. Reversal reopens the obligation and consumes available unapplied cash without moving old allocations. Active credits must be reversed before voiding their charge. Charge/payment voids remain corrections, not refunds. Actual refunds and deposit applications are PF-06.

Cash received, noncash reductions, unpaid rent, other unpaid charges and unapplied receipt credit are distinguished. A charge settled using a credit is not labeled cash paid or paid late. Statements show both the original credit and its reversal; summaries subtract only active credits. One-time charges/credits/reversals use effective dates, monthly rent uses due dates and cash uses received dates. Date ranges use current status/current allocations at generation, not historical as-of accounting. Deposit money remains separate.

Existing cash-report receipt classification is retained for compatibility; these reports record cash, not accrual charge revenue. No new cash entry is created for a charge, credit or reversal. Exports retain source references and IDs for reconciliation. The UI shows readable references such as “Charge #101” and omits one-action internal-ID dropdowns.

## Integrity and validation

Migration `202610160019_lease_charges_credits` is additive and transactional. Existing rent charges default to `kind=rent`; old identities, allocations, references and audits remain. The runtime can insert/read immutable credits and reversals within forced company RLS. Composite foreign keys, lease locks and database triggers protect current remaining amounts and charge corrections independently of API validation. Application mutations require current authority, CSRF, reviewed versions, durable submission keys and atomic audit writes. A lost response can be retried with the original saved review.

Disposable PostgreSQL/API/browser checks cover source reconciliation, resident privacy, concurrent cash/credit writers, direct database restrictions, immutable reversal, correction guards, authorization loss, audit rollback and browser reload/retry recovery. These checks never use shared databases.

## Tenant directory and setup refinements

Directory rows show actual property/unit lease relationships, role, dates and current/upcoming/draft/former status, including departed occupants and historical leases. Portal assignments do not substitute for lease association. Search includes property and unit names. Bounded complete queries fail explicitly rather than showing partial associations.

Archive/restore is available directly in the directory, uses the current full profile/version, and preserves all rental, financial and audit history. Current/upcoming/draft relationships block archiving; departed occupants can be archived while their former shared lease continues. Pending invitations are revoked on archive. Archive does not independently disable an existing account or restore permissions. Explicit archive/restore events retain actor/time and before/after status alongside the existing profile-update audit.

Tenant details offer “Record a lease” only in confirmed empty rental history. Existing current, upcoming, draft or historical leases are shown with their exact workflow links. Loading or failed lease checks do not suggest creating another lease. Archived profiles do not offer lease creation.
