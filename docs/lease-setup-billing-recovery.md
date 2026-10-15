# Lease setup, billing recovery and connected people navigation

Development increment, 2026-10-15. Branch `codex/lease-setup-billing-recovery`, based on deployed main `70f6d55` (PR26). No deployment, shared database, account or identity-provider changes are performed by this implementation. Merge requires user approval; deployment is user-run. Domain setup is explicitly on hold.

## October recovery

The reported October issue is reproducible: a schedule retains the existing manual October charge and records that service month as processed. Its cursor advances to November. Voiding the manual charge does not rewind that durable history, so the next check correctly finds a future installment but previously explained it poorly.

A check now identifies the exact next service month, posting date, due date and company business date. It separately identifies a preceding installment whose original charge was voided and has no active replacement. Posting history preserves the original occurrence and offers **Review repost** for an eligible processed month. The review uses the original saved schedule terms, rather than the voided manual charge's possibly different amount. A required reason, current lease/schedule versions and final confirmation create one replacement and one audit. Available credit is allocated atomically. Original occurrence, cursor, schedule status and voided records remain unchanged. History identifies an active replacement and no longer warns that the month still lacks a charge.

Reposts require current company finance permission, Origin/CSRF, a lease write fence, company RLS, reached posting date, a nondraft lease whose term contains the service month, and no active charge for that month. Durable actor/company submission keys and fingerprints protect concurrent retries and lost committed responses. Replays recheck current authorization before returning a record. The browser stores an exact pending submission in user/company/lease-scoped tab storage so reload recovery does not generate another logical request. Reposting a stopped/completed schedule's historical eligible installment is deliberate recovery; it never resumes future billing.

## Guided records and renewal history

Lease entry now has a review step summarizing property, unit, resident, dates, rent, due day, grace and shared instructions. Back preserves the draft. Final confirmation persists the exact pending submission before posting; an ambiguous response supports the same retry after reload. Creating an active record reserves its unit; it does not sign an agreement or enable billing.

**Prepare renewal** copies context and editable payment terms into a linked draft starting after the previous recorded end date. Parent version, same unit/property/resident, current resident eligibility and permissions are checked on save. One successor per previous lease is enforced in PostgreSQL. Later renewals form a chain from the latest term, including ended history. The link is immutable and same-company composite foreign keys protect its scope. Parent and child edits cannot overlap linked terms. The existing one-active-lease-per-unit rule remains. A renewal does not end its parent, activate itself, create charges, or stop/copy a billing schedule. Stop the old schedule and review its history before changing financial terms or ending that lease.

Effective-dated midterm changes, proration, deposits, automatic activation and legal agreements remain future increments.

## Navigation and people

Property Leases uses `/company/properties/:propertyId/leases`, stays under Properties in navigation, preserves filters on reload and limits creation to that property. The global lease directory labels both **Property** and **Unit**, so identical unit labels across properties are distinguishable. Existing query-filter links remain usable. Property tab links use the property workspace route; all-company navigation is explicit.

**Team** lists owners, managers and staff, with manager/staff invitations and focused access editing. **Tenants** lists resident profiles, property assignments and activity, with resident-only invitations and owner-controlled tenant access editing. Disabling membership clears assignments; reactivation requires explicit reassignment. Managers retain resident profile/assignment management but do not gain owner invitation/access authority. Ownership transfer selects active team members. Platform administrators retain their existing broader assignment tools for deliberate role changes.

Invitation queries filter audience and current company before the latest-100 limit. Even a company owner who also has platform authority uses their current company for these scoped directories. Versioned access forms reject edits after another membership/profile change, avoiding a stale resident form restoring an obsolete role or status. Legacy API clients without an expected version retain existing behavior; the new UI always sends one. Separate screens do not grant new permissions or link identities by email.

## Readable records

Migration015 adds stable `RC-…` charge and `TX-…` cash transaction references to existing/new records. Internal API identities, allocations and money are unchanged; references cannot be updated by the runtime role. Sequences are global, may have gaps, and are operational references, not gap-free legal invoice numbering. Ledger CSVs retain both display references and separate internal ID columns for charges, payments and allocation links. Full IDs are not rendered on screen; an explicit Copy action in record details provides troubleshooting access.

Platform audit shows actor names/emails, company names, and “Automatic rent billing” for the worker. These are current directory labels; immutable original actor/company IDs remain available through Copy actions and source records. Resolving names reads the platform-authorized directory/company records only, not property/financial data outside company RLS. Unavailable identities have clear fallback labels.

## Validation and acceptance

Client/server builds and safe Node regressions pass. Disposable PostgreSQL/API/browser suites cover recovery concurrency, authorization/CSRF, stale versions, audit rollback, immutable references, lost committed responses, original history/cursor retention, renewal overlap/chain rules, company invitation scope and stale membership edits. UI regression covers review/back/reload retries, readable references, property scope, distinct Team/Tenants audiences and manager restrictions. Local evidence: 96 browser regressions; 51 safe Node checks with 5 database-suite skips (run separately); 61 finance/recovery, 19 leasing and 22 user-management checks in disposable PostgreSQL. Prior unchanged maintenance9/access40 local suites also passed; remote CI checks the full integration set. Final PR status is recorded with the handoff.

After approved merge and user-run deployment:

1. In the October ledger, confirm next check identifies November's exact posting date. Review October's voided retained occurrence, verify saved amount/due/grace, add a reason and repost. Confirm one active replacement/reference, original void/history retained, unchanged future cursor, and correct balances/credit.
2. Confirm RC/TX references in ledger/export and readable audit actors/companies. Expand details to copy an internal ID without displaying it.
3. Record a lease through review/back/confirm. Prepare a renewal draft and verify its property/unit/resident, next-day start, editable terms and parent link. Confirm the old term and its billing are unchanged; activation is blocked while another lease is active for the unit.
4. Visit property → Leases, change a status filter and reload. Confirm property heading/sidebar/context persist; only that property's leases/creation options appear. Visit all-company Leases and distinguish properties with the same unit label.
5. As owner, confirm Team excludes residents and tenant invitations; Tenants excludes staff and team invitations. Create each invitation with the intended role, share manually and accept with the matching verified account. Check profile/contact/assignment/access edits, stale-edit conflicts, disable/reassign behavior, and manager restrictions.
6. Check resident ledger/history, company isolation and revoked access with real accounts. Local fixtures do not establish deployed authenticated acceptance.

Existing CUID and Auth0 identities remain unchanged at the user's request. UUID submission keys remain in use for durable retries. No automatic fees, messages, payment provider activation, production rollout or live data mutation is included.
