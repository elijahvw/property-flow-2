# Property Flow platform status

Updated October 26, 2026 from checked-out Git history and repository contracts. Source, deployment and real-account acceptance are separate states.

## Current source and audit

**Merged source and verification follow-up:** main `e8b87c7` includes user-merged PR64/68 and PR65/66/63/67. Optional Alloy/manual starts, the daily 3 a.m. America/New_York Stop definition, scanner retirement 057 and fixture6 are merged source. Stop is effective unless `DEV_AUTO_STOP=false`. New/pending originals remain **Not scanned**; historical verdicts and rejected/unknown blocking remain under existing exact-source authority. [Current reconciliation](pr64-pr68-reconciliation-2026-10-25.md).

The final fixed production suite passes **459/459 in 8.6 minutes**, two workers/zero retries/no source-build drift. Additional document/demo coverage passes maintenance 149, roadmap 40 and demo 22; safe server 128+nine expected DB skips, client 70 and operations 100 pass. The follow-up preserves these regressions, explicit lease startup readiness and current documentation. Its application/schema/infra/workflow source matches merged main. All 59 earlier migration files and published 057 are unchanged. Earlier 458/459 and remote 459/459 stages retain their distinct provenance. Publication CI/review and actual cloud rollout/role acceptance remain separate gates; no production-ready or bug-free claim is made.

The [October 25 first-pass audit](platform-audit-2026-10-25.md) records its discovered defects, fixes and validation; the [substantive continuation](platform-overhaul-2026-10-25.md) records the broader current source and final checks. The [platform experience contract](platform-experience.md) and [AGENTS.md](../AGENTS.md) define how future changes preserve navigation, form behavior, workflow continuity and current documentation. This broad audit is authorized by the current request; older feature-development pauses below are historical.

First-pass local audit validation passed: 406 production-client browser fixtures, 120 safe server checks (nine intentional database skips), 15 client test files, 92 operations checks, client build/server TypeScript compilation and Terraform configuration validation. Six fresh disposable database runners also pass; their separate counts, setup limitations and corrected initial failures are in the audit. No new hosted deployment, Terraform apply or real-provider acceptance is implied.

Owners/managers have connected inventory, accounts/households/leases, manual rent/cash/deposits/settlement, reports, maintenance/vendors/preventive/calendar, private documents/sharing, inspections/unsigned agreements, notifications/preferences, availability/prospects/applications, reviewed imports and saved tasks. Platform controls include company plans/manual SaaS billing, support impersonation and isolated sales demos. These capabilities retain their individual documented limits and role boundaries. [Feature register](product-roadmap.md) · [acceptance backlog](product-backlog.md).

## Deployment and acceptance

The last complete deployment evidence previously recorded here was `1945049` (PR57): [Deploy Dev39212763617](https://github.com/elijahvw/property-flow-2/actions/runs/39212763617) and subsequent [Stop39214885405](https://github.com/elijahvw/property-flow-2/actions/runs/39214885405), October19. The [October 25 live AWS audit](aws-audit-2026-10-25.md) now observes ECS task26 configured for backend `47badac`, with one running task and RDS available. This supersedes the old stopped-state assumption. Frontend artifacts, actual schema state, deployment workflow records and real Auth0/email/scanner/account acceptance were not reverified. This audit's local refinements and prepared infrastructure protection have not been deployed/applied.

Use the [release and role checklist](feature-acceptance-checklist-2026-10-24.md) for schema/provider gates and remaining acceptance. Migrations must use the canonical chain and matching artifacts; foreign PR60 schemas require explicit reconciliation. Tests must use disposable databases. Merge/deployment/live configuration and customer/provider actions remain separate from local audit work.

Electronic signatures, automatic collection, complete historical accounting/bank reconciliation, wider document sharing/uploads, external/scheduled notifications and remaining monitoring/restore acceptance are still future or partial scope. Account creation and exact Auth0 identity never implicitly grant company/property/portal authority. Actual Auth0 demo provisioning, role sign-ins, teardown and rebuild remain release acceptance steps. No platform-wide bug-free or production acceptance claim is made.

Jira tracking remains disabled. The repository is the current tracking source; [release notes](local-feature-release-notes.md) retain checkpoint evidence. PR60's current remote closure state was not checked.

## Historical October 20–24 status snapshots

The following preserves the original checkpoint text and test counts. Its “current,” “paused,” “draft,” “unmerged” and deployment statements apply to those dated snapshots; the source summary above supersedes them.

Consolidation authorization, October 24, 23:16 UTC: the user requested that all useful unique PR #60 work be incorporated into [draft PR #61](https://github.com/elijahvw/property-flow-2/pull/61). **Consolidation is in progress**, including collision-safe migrations, the saved-renewal P2 fix, ports, tests and documentation. The `b68416d` 320/320 browser and 56/56 privacy results validate the pre-consolidation baseline, not the combined result. Keep PR #60 open until every unique item is preserved on the verified remote destination and combined checks/reviews are complete; only then close it with a preservation link, retaining its branch/commits. Unrelated feature development remains paused; no merge, deployment or live migration is authorized. [Consolidation inventory and prior comparison](PR60-integration-review-2026-10-24.md).

The completed tenant directory/history snapshot is locally validated: refined server build/safe 109+eight expected skips/SQL 7/finance 192 and unchanged client build/client 13/full browser 320 pass. Final repeated matrix passes 511/511 reads/24 scenarios, including 2,001 people, with exact privacy/count/source/fingerprint/cleanup invariants. At 2k, refined default is 262.10 ms median/43,003 bytes and former 224.49 ms, improving the first paged run; the old eager all-record API remains faster (144.03 ms) and larger (1,535,493 bytes), with different populations. Repeated graphs, portal-pending loops and growing metadata remain costs; timed history grain<=3 is distinct from the functional 1,001-lease API proof. No universal speed/constant-work/deployed SLO or live acceptance is claimed.

Tenant leasing controls/form recovery/privacy are locally validated: strengthened real users 56/56, final client build/client 13 (including six API header/uncertainty checks), independent review and final combined browser 320/320 (5.4m, exit 0) pass. Authoritative access/company/read-feature denials hide private review immediately; fresh pinned reads restore only permitted access while exact journals remain retained. Read-only/CSRF/impersonation-read-only preserve allowed reads. Compact comparisons, explicit duplicate consent, create receipt versus PATCH-no-receipt recovery, admin exemptions and saved-account Continue are retained. The first 319 fixture failure/corrected 10-repeat/11-affected history remains recorded. **Unrelated feature development is paused; authorized PR #60 consolidation is in progress, and all combined port/check/review evidence remains pending in the [inventory](PR60-integration-review-2026-10-24.md).** No merge/deploy/live migration, new administrative portal gate or provider activation. Existing provider create/rename before the final DB gate still lacks a new durable-intent/rollback guarantee.

The source-return loop (290/290 browser, 35/35 real handoff), preferred-unit fix (307/307 browser, 40/40 real API) and prior measured maintenance 050 checkpoint remain separately complete locally. Original fixture failures, immutable baselines, fingerprints and scan/metadata limits remain recorded. The newly selected form work has separate pending validation; earlier directory/form passes do not validate it. Timed tours remain unselected. All changes are unmerged/undeployed; real-account acceptance remains pending. [Current evidence and remaining scope](roadmap-continuation-2026-10-24.md).

October 24 earlier 049 checkpoint: requester replies 048 and personal in-app notice preferences 049 are locally validated. Frozen 049 source passes both builds, 139 maintenance/preferences API cases, 34 roadmap cases, 15 billing and 14 impersonation cases, 108 safe server tests with eight expected database-suite skips, all 11 client unit files, 88 operations checks and the power guard. Focused preference browser 10/10 and complete browser 273/273 pass; independent review has no remaining confirmed issue. Company/account preferences use four default-enabled optional areas, future deliveries only, immutable history/exact current replay and current company/source authority. The dated 047/048 checkpoints below retain their own evidence. None is deployed or user-accepted. A subsequent cash/deposit refinement passes 18 scoped browser cases and the centralized 050 client build after the protected frozen 049 baseline capture. The complete 273-case 049 pass predates that UI refinement. Subsequent 050 changes and revalidation are tracked in the current note above. [Current contracts, logs and scoped evidence](roadmap-continuation-2026-10-24.md).

October 24, 2026 local continuation: checked-out main is `75d5342` (PR59 merged), without evidence here of a newer cloud deployment. PF-29 support impersonation 041 and PF-22 configurable monthly plans/features/usage/manual billing 042 are preserved and locally validated in their contracts. Current source was inspected before adding PF-20 cash cutoff/comparison reports, PF-21 availability/turnover/manual prospects, PF-25 reviewed unit CSV/paid operating-expense imports and PF-15 explicit leaseholder document sharing (043–047). The combined local checkpoint passes 34 fresh-database roadmap API checks, the complete 260-case browser fixture suite, server/Prisma/TypeScript and client builds, safe units, operations and the development power inventory guard. Existing maintenance 122/122, leasing 30/30, finance 177/177 and user 45/45 pass through fresh 047 databases (374 baseline checks). Current billing 15/15 and impersonation 14/14 reruns pass without skips; earlier PF-22/29 evidence is kept separate. The backlog remains incomplete, and no local increment is deployed or user-accepted. The user prefers local work and publication after returning where feasible; merge/deployment/live data/provider actions remain separate. [Current matrix, continuation, form-quality evidence and remaining workflows](roadmap-continuation-2026-10-24.md). The dated release/deployment history below remains evidence for its stated checkpoint.

Verified October 20, 2026 from current main, GitHub PR/deployment records and local release checks. This is the current status entry point; dated implementation checkpoints below are historical. The [roadmap](product-roadmap.md) tracks scope and the [acceptance log](workflow-acceptance-2026-10-18.md) retains unfinished real-account testing.

## Current release and operating state

Main is `1945049` ([merged PR57](https://github.com/elijahvw/property-flow-2/pull/57)). PRs54–57 are merged: vendor contacts, preventive schedules, maintenance calendar and private document library. [Deploy Dev run 39212763617](https://github.com/elijahvw/property-flow-2/actions/runs/39212763617) successfully rolled out the matching backend/frontend and passed database readiness, public/authentication checks and hosted backend metrics/logs/traces on October 19. The release contains migrations035–037.

[Dev stop run 39214885405](https://github.com/elijahvw/property-flow-2/actions/runs/39214885405) subsequently succeeded on October 19. The user reports the app stopped; it has not been started, deployed or changed in the cloud during this PR preparation. Current AWS resource state and a fresh live health check were not queried. A later Start and complete signed-in acceptance remain separate from the successful deployment/Stop records.

## New batch — PR59 awaiting review, merge and deployment

[PR59](https://github.com/elijahvw/property-flow-2/pull/59) targets main with the following features:

- **PF-16 inspections:** lease move-in/out condition items, retained private evidence, save/submit/review/reopen, immutable comparison and settlement source navigation. Observations never create charges or deduct deposits. Management only. [Contract](lease-inspections.md).
- **PF-17 agreement preparation:** versioned unsigned document packages, exact intended recorded signers, source-change detection, preparation approval/requested changes/reopen/cancel and retained originals/history. Management approval is not an electronic signature. [Contract](lease-agreements.md).
- **PF-19 in-app notifications:** personal inbox/header unread count, read/type filters, complete authorized totals, read/unread, safe retry and exact source/return links for maintenance, assigned work, inspections and agreement reviews. Current role/property/source access applies to every count/open/replay. No external email/SMS or scheduled reminders. [Contract](in-app-notifications.md).

Apply additive migrations038→039→040 through the existing reviewed backend rollout and deploy the matching client/API. No new service, task, provider or infrastructure configuration is needed. Source events, versions, audit, original evidence and retry identities remain durable and company scoped.

## Implemented platform foundation

Owners/managers have connected properties, units, tenants/accounts/households, leases/renewals/terms/proration, rent posting and recurring schedules, manual receipts/allocations/credits, deposits/refunds/settlement, cash reports/CSV, maintenance assignment/execution/review, vendors, preventive work, calendar and private documents/library. Staff default to read-only properties; explicit execution is limited to their current assignment/property. Resident self-service exposes only authorized rental/financial/request/profile records; occupants do not inherit leaseholder finances. Auth0 identity, company authority and portal approval stay separate. Invitations, verification/setup recovery, Help, explicit page-only drafts and source navigation are connected.

## Remaining scope and readiness

The platform is a substantial development product with connected operating workflows; it is not fully accepted for production. Staff/leaseholder/occupant journeys and remaining owner/manager financial, export, draft/recovery and administration scenarios remain unchecked in the live acceptance log. Auth0 password-email branding remains open; SES is sandbox-only. No new support request, setup email, password request or provider activation is part of this batch.

Electronic signatures, conversations, scheduled/external notifications, resident document sharing/uploads, full as-of accounting/reconciliation, imports, vacancy/applications and company entitlements remain future or partial scope. Stripe subscriptions and payment collection stay last. Backend telemetry passed the last deployment check; role-complete browser telemetry, infrastructure collection, synthetics and controlled incident/restore acceptance retain their documented gaps. Tests, merged code, deployment and user acceptance are different evidence states.

Jira updates are disabled. Repository docs and PR evidence are the current tracking source. No production-readiness percentage or completion date is claimed.

## Release-checkout validation

Both production builds passed, along with 122 maintenance/notification,30 leasing and 177 finance disposable PostgreSQL/API/browser checks (329 total), the full 230 UI suite,85 server units (5 other database suites skipped here),28 client units and 88 operations checks. Documentation relative links, diff and Start/Stop inventory guards passed. These results support PR review, not real-account acceptance or a cloud rollout claim. Hosted exact-head CI is checked separately after publication.

## Historical implementation checkpoints

The following records preserve their original dates, branch names, test counts and limitations. Their “current” or “not deployed” statements refer to those dates, not the platform state above.

> Current checkpoint — 2026-10-15: PR28 was approved and manually merged by the user at `fbc82f5`. Continue PR29 / `codex/deposits-move-in` in `prelogin-users`. This increment implements reviewed refundable deposit requirements/revisions, durable manual receipts with one linked cash source, current held/uncollected balances, corrections, resident visibility and dual-identifier CSV. Other property tabs now use nested property workspace routes. See [scope and acceptance](security-deposits.md). Tests use disposable local data only. PR27 deployment completion remains unverified; this increment is not deployed. User approves merges and performs deployments. No shared/live DB/account changes, messages/providers, Stripe or domain setup. Earlier checkpoints are historical.

> Current checkpoint — 2026-10-15: PR27 is merged at `ada0fb5`; the user is deploying manually, with completion/acceptance not yet verified. Continue `codex/ci-cleanup` in `prelogin-users`. CI cleanup keeps every test and required check, consolidates install with backend-aligned locked versions, downloads only the used headless shell and cancels superseded runs. See [CI scope](ci-cleanup.md) and [roadmap](product-roadmap.md) for completed capabilities and the proposed next feature order. New PR merge requires approval. No deployment, shared/live DB/account changes or domain setup. Earlier checkpoints are historical.

> Current checkpoint — 2026-10-15: continue `codex/lease-setup-billing-recovery` in `prelogin-users`, based on deployed main `70f6d55` / merged PR26. Deploy Dev38779588216 and public version/readiness/auth checks passed; user found October retained-then-voided recovery and navigation/people workflow gaps. This increment adds explicit audited durable installment reposts, readable financial references/audit actors, reviewed lease setup/linked renewal drafts, property-scoped lease routes and separate Team/Tenants audiences. See [scope and acceptance](lease-setup-billing-recovery.md). No merge/deploy/shared data changes are authorized. User approves merges and runs deployments; domain setup is on hold. Earlier checkpoints are historical.

> Current checkpoint — 2026-10-15: continue `codex/recurring-rent-billing` in `prelogin-users`, based on main `842c8b0` / merged PR25. User-run Deploy Dev38771155784 and public version/readiness/auth smoke passed; real-account acceptance remains manual. New opt-in reviewed rent schedules, durable background posting/pause/stop/history and paid-late history are implemented; see [scope and acceptance](recurring-rent.md). Preserve the owner/manager-first direction and [roadmap](product-roadmap.md). User approves merges and runs deployments. No shared/live DB changes, automatic fees, messages or provider activations. Earlier checkpoints are historical.

> Current checkpoint — 2026-10-15: continue `codex/lease-payment-policies` in `prelogin-users`, based on deployed main `5750db6` / PR24. Lease payment settings, saved charge grace terms, past-due aging and connected collections are implemented; see [payment-policy scope](lease-payment-policy.md) and the [revised product roadmap](product-roadmap.md). Roadmap order in older checkpoints below is historical and superseded. User approves merges and runs deployments; do not merge, deploy or modify shared/live data. No automatic fees, reminders or paid integrations.

## Administrator foundation correction — 2026-10-14

Main e842ae1 (PR17+18) is deployed and public/backend checks passed. User's FAP company is Company A. The administrator setup was confusing because local users were conflated with Auth0 identities and company creation accepted only a name. The prelogin-user-management branch now supports pre-login Auth0 discovery/provisioning, explicit verification/setup controls, clear local-role assignment and complete persisted company profiles. Both creation and editing have retry/concurrency protection; no placeholder company feature controls were added. Existing pre-login work was retained before modification. Detailed audit, setup and test evidence is maintained at the top of docs/access-overhaul.md.

This is implementation/test evidence, not deployed acceptance. New M2M environment bindings require a reviewed Terraform plan/apply and Auth0 permissions validation during the later user-run deployment. No live account or database change was made as part of this code work. Obtain merge approval after PR comments/reviews/CI.

## Manual property finances — review checkpoint, 2026-10-14

The second feature slice follows units/leases PR #17 and remains separate on `codex/manual-finances-mvp`. Owners and managers can record income received or expenses paid by property, date, USD amount, category and optional memo. Staff, residents and platform-only users have no financial access. No payment processing, bank connections, balances owed, deposits or transfers are included.

Create requests use company/actor-scoped durable UUID keys and normalized fingerprints. Exact retries return the current record, including void status; changed details with the same key return conflict. Current account/company/membership authority is rechecked before replay. Creation and audit are atomic.

Amounts are positive integer cents up to USD 1,000,000 per entry. Monetary details and retry identities cannot be edited by the runtime database role, and deletion is denied. Correct an entry by voiding it with a reason and creating a replacement. Void requests use versions, retain the original details and one reason, and replay safely after a lost response. Forced RLS and composite property/company foreign keys provide database boundaries.

History supports property and inclusive date filters and 50-row keyset pages. Income, expenses and net summarize every matching nonvoided record, independently of the page, using bigint sums serialized as exact decimal cents. Voided history stays visible. History filtering/paging does not remount the transaction draft or rotate its submission key; the explicit new transaction action does. Drafts are cleared when the session/company changes and are not persisted across navigation/reload.

Verification: 8 fresh tmpfs PostgreSQL/API/browser checks cover same-key concurrency, mismatch, roles/CSRF/tenant boundaries, validation, void concurrency/replay, exact totals across 53 matching rows, atomic audit rollback, forced RLS, immutable grants, current suspension/revocation, stale versions, and a real browser commit-response-loss retry producing one record/audit. Independent read-only Bugbot review found no actionable issue. All 41 browser fixtures pass serially and additionally cover filter/pagination draft preservation, corrections, role gates and company reset. Both builds pass; 40 safe Node checks pass with 4 DB suites skipped in that pass. Dedicated disposable runners separately pass finance 8, units/leases 12 and maintenance 9. CI now accepts PRs targeting codex/** branches so stacked feature PRs receive the same checks before retargeting to main. Finance PR #18 is https://github.com/elijahvw/property-flow-2/pull/18.

Units/leases PR #17 CI initially exposed a stale-edit fixture race; its reload assertion now waits for the response and refreshed form. Exact-head CI at ad890cd is green. Automated review of the implementation at692720a completed with no findings; CodeRabbit skipped its review. Neither feature is merged or deployed. Dev remains main143432d; authenticated acceptance requires the manual test accounts described below. Documents still require separately designed private storage and are not implemented in this slice.

# PropertyFlow MVP status

## Units and lease records checkpoint — 2026-10-14

Worktree `<project>/units-leases`, branch `codex/units-leases-mvp`, based on deployed main `143432db915e4aff9d999260e24febdfbfa45897`. Existing maintenance/source worktrees were preserved. User authorized continued feature work while offline; merge and further deployment still require approval.

Owners/managers can create, rename, archive and restore property units; staff retain read-only unit access. Owners/managers can create and edit draft/active/ended lease records for currently active accepted residents assigned to that property, with start/end dates and exact integer-cent monthly rent in USD. End dates are inclusive record dates; open-ended records are allowed except for ended status. Unit/resident identity is immutable on an existing lease. Status is manually maintained, not inferred occupancy, signed-contract validity or payment status. There is one manually active lease per unit, enforced by a PostgreSQL partial unique index; drafts/ended history remain available. Leases do not grant resident access or automatically restore assignments. Manager history survives resident revocation/transfer; ended records remain editable afterward.

New Unit/Lease tables are additive, forced-company-RLS protected and linked by same-company/property composite foreign keys. Runtime role has no DELETE grant. Both creation workflows have durable company/creator UUID keys and original-payload fingerprints with transactional audit; mismatched retries return 409, and unit replay after rename returns the original ID. All operational access takes the requester User write fence and Company SHARE lock before fresh permission checks. Lease eligibility shares the resident revocation lock; Unit write fences coordinate activation/edit/archive. Expected record versions prevent lost edits. Units/leases have 50-row keyset pages. Form drafts and keys clear on access/company changes; unit-picker pagination retains lease fields, selected unit and retry key. Availability is authoritatively rechecked on save.

Verified: client/server builds; **32 safe Node regressions**, **36 browser fixtures**, **12 real PostgreSQL/API/browser checks** including creation response loss, concurrent lease activation, stale edits, audit rollback, RLS/composite boundaries, revocation and six suspension-leading operations, and keyset pagination. Existing maintenance **9 real PostgreSQL/API/browser checks** remain green. Logs `/tmp/pf-units-leases-node.log`, `/tmp/pf-units-leases-browser.log`, `/tmp/pf-units-leases-pg.log`, `/tmp/pf-units-leases-maintenance.log`. Independent Bugbot found one picker-pagination draft/key issue, then verified the corrected implementation and regression with no residual findings. Reviewer did not independently rerun databases. CI includes `node scripts/test-leasing.mjs`, which creates and removes only its own verified cached-image/tmpfs/no-volume/loopback PostgreSQL and Vite resources.

Limits: USD-only internal records, one primary resident per record, manually maintained statuses, no signatures, notice/renewal workflows, legal document generation, automated billing or payment processing. Unit names use exact case-sensitive uniqueness. Existing assigned-resident picker is unpaginated. Live real-account acceptance remains deferred by the user; new features are not deployed. Next foundation: basic manual property income/expense tracking ahead of documents.

## Approved development release and manual acceptance setup

PR16 merged at `143432d`. Deploy Dev run **38510462932** completed successfully from that exact main revision, with frontend/backend rebuild and `run_terraform=never`: https://github.com/elijahvw/property-flow-2/actions/runs/38510462932. Development AWS account in us-east-1, one running stable ECS task; running app image digest matches the SHA-tagged release, ALB target healthy. Public homepage, DB readiness, unauthenticated bootstrap 401, API 404 and frontend deep-link smoke checks pass. App: https://drfbeumseaytt.cloudfront.net. This verifies rollout/public smoke only, not real owner/manager/resident acceptance. User has no test accounts yet and will perform a manual pass before providing emails for automation.

Create seven distinct verified login identities in two test companies, using the existing platform administrator to create companies and assign initial owners:
- Company A: owner, manager, staff, resident A1, resident A2.
- Company B: owner and resident B1.
- Keep a platform-only admin identity available for platform/company-boundary checks; do not reuse one company identity across companies.
- Owners invite the other company members through Team; copy invitation links explicitly because the app does not send email automatically. Each invite must be accepted while signed in as its exact verified email.
- Create properties A1, A2 and B1. Assign resident A1 only to A1, resident A2 to A1 and A2, and resident B1 only to B1. This tests both property access and same-property request ownership.
- Exercise owner/manager operations, staff/resident/platform-only denials, invitation mismatch/reuse, assignment removal/reactivation, cross-company direct routes, resident submission/retry and manager resolution/reopen. Do not claim these checks passed before actual account testing.

## PR16 company-suspension review correction

Automated Codex review of d9b0765 found a P1 race between maintenance authorization and concurrent company suspension (https://github.com/elijahvw/property-flow-2/pull/16#discussion_r4266623453). The requester lock alone did not order company-status updates. Maintenance now takes `SELECT Company FOR SHARE` before rereading authorization and holds it through commit. PostgreSQL Company updates already take an incompatible row lock; no platform-route behavior change is necessary. SHARE permits maintenance operations by different users concurrently, while Serializable detects a company changed since an older snapshot and retries before authorization.

Added ten deterministic real PostgreSQL orderings across new creation, idempotent replay, resident listing, manager listing and manager status updates. Suspension-leading operations wait at the company fence, retry and return 403 without maintenance audit writes. Maintenance-leading operations pause after authorization; the actual platform suspension API waits until maintenance commits, then subsequent maintenance returns 403. Disposable runner passed **9 tests, zero skipped**, retaining lost committed browser response, one-row/one-audit replay, mismatch/scoping, rollback and existing revocation/RLS coverage (/tmp/pf-pr16-company-races.log). Server compilation and the **32-test** safe Node subset passed. Earlier CI for 2d1b404 completed successfully, but does not validate this new production change; new-head CI and review are required. No merge, deploy or existing database operation performed.

## Maintenance PR publication and CI follow-up

User authorized branch push and PR creation, with review of every comment/review and CI followed by explicit merge approval; deployment remains prohibited. PR #16: https://github.com/elijahvw/property-flow-2/pull/16, initially published at d9b0765. CI run 38508769666 passed operations, server/PostgreSQL checks, client tests/build and Terraform validation, then caught a maintenance loading fixture's ambiguous locator: property and request-list resources can simultaneously render identical loading statuses. The fixture now deliberately holds both resources and scopes assertions to their respective sections, preserving the assertion that submission controls remain absent until property loading completes. Integrated fixtures reran locally: 29 passed, zero failures (/tmp/pf-pr16-fixture-fix.log). This is a test-only correction; fresh remote CI/reviews remain required for the new head. CodeRabbit is rate-limited, not an approving review. No merge, deployment or existing database operation occurred.

## Trey guidance supplied by the user

This is a development environment. PRs #13–15 were merged and checked; nothing was deployed during wrap-up. Maintenance idempotency is implemented locally in `3c5def0`, but publication, remote CI, review of every PR conversation comment/review body/inline thread, and explicit user merge approval remain required. Confirm durable committed-response-loss replay and regression coverage against the exact proposed head before merging; CI alone does not establish readiness. Deployment requires separate user authorization.

After an approved dev deployment, perform real authenticated acceptance with owner, manager and resident accounts: invitations and acceptance, property assignments, role/company boundaries and revocation, and maintenance submission/retry/list/status changes end to end. No acceptance run or deployment is authorized by this guidance alone.

Keep implementation in this Codex chat to avoid overlapping changes with Trey. Maintain the landlord/manager-first direction. Next build order: units/lease records, basic manual financial tracking, then documents unless usability testing establishes greater document urgency. Manual financial tracking does not authorize payment processing or paid integrations. Private documents require secure private storage and authorization-controlled access; never store them in the existing public frontend bucket. Secure storage design and provisioning are future separately scoped work.

## Durable maintenance submission continuation — 2026-10-13 (America/New_York)

Integrated fetched main `80988021799712a80b8d0bcfd64041e705706d94` with ordinary merge `1999787`, preserving existing maintenance/assignment commits and main's property detail/edit routes. Resolved only App imports and status-document markers by retaining both sides. Source assignment checkout was untouched. PRs 13–15 are confirmed merged; read their complete conversation timelines, review bodies and inline threads through GitHub tools. PR14's sole substantive opaque-subject finding is resolved and its implementation retained; the CodeRabbit default docstring warning is nonblocking. Maintenance has no remote PR.

New submissions require a UUID v4 key, normalized to lowercase. Nullable additive key/fingerprint columns preserve historical rows; a unique company/requester/key index protects durable uniqueness. A canonical normalized payload SHA-256 fingerprint rejects mismatched reuse with 409. Request, key, fingerprint and creation audit commit in one Serializable transaction under the existing requester write lock. Replay first refreshes account/membership/company permissions and checks the original property assignment; revoked access never receives the stored request. Valid replay returns the same ID and current status without another creation audit. Form retries retain the key after ambiguous transport loss; only the explicit Start a new request action rotates the mounted form key and clears its fields. All controls, including new-request, are disabled while saving. Drafts are not persisted across page reloads/navigation.

Validation on Node 24.1.0 and cached PostgreSQL 17/Chromium:

- Client and server builds passed (Prisma generation with dummy localhost URL; no database connection).
- Safe authorization/assignment/tracing/client Node subset: **32 passed** (`/tmp/pf-idempotency-regressions.log`).
- Maintenance fixture browsers: **4 passed**; integrated owner/property/assignment/maintenance browser fixtures: **29 passed** (`/tmp/pf-idempotency-ui.log`, `/tmp/pf-idempotency-all-ui.log`).
- PostgreSQL/API/real browser suite: **8 passed, zero skipped**, including commit-then-abort/retry (one row/creation audit), explicit new request, three concurrent attempts, uppercase key replay, unique-index enforcement, mismatched fields, same key across requester/company, original assignment revocation, current-status replay and audit-failure rollback/retry (`/tmp/pf-idempotency-postgres.log`). Existing forced RLS/composite property and revocation ordering regressions remain green.
- New reproducible runner `node scripts/test-maintenance.mjs`: **8 passed**, creates its own cached-image exact-ID PostgreSQL container with tmpfs/no volumes and loopback ephemeral port, verifies these properties, starts its own Vite fixture server, and cleans both in finally (`/tmp/pf-idempotency-runner.log`). CI now runs this after Chromium setup so the real browser/PostgreSQL regressions do not silently skip. Remote CI was not dispatched.
- Independent Bugbot source review found **no actionable findings** in the merged maintenance/idempotency implementation. Reviewer inspected test implementations and passing evidence, without independently rerunning database tests. The additional runner/CI wiring was author-reviewed and locally executed.

All task-created disposable containers and fixture servers were removed. No deployment, shared/live database modification, push, PR creation, or merge into main occurred. Landlord/manager-first balanced product scope remains unchanged. Live Auth0 acceptance, remote CI and user-approved publication/merge remain outstanding; local checks do not claim release readiness. Before a merge decision refresh all PR comments/reviews/threads and CI against the exact proposed head and obtain explicit user approval. A merge may trigger the repository's deployment workflow; the current no-deploy instruction must be honored when arranging any future merge.

## Maintenance review stopping point — 2026-10-14

Independent review reproduced a publication blocker: a committed creation response lost in transit followed by UI retry creates duplicate maintenance requests and creation audits. No implementation fix is being made at this stopping point. `CODEX-HANDOFF.md` records the exact branch/dependencies, real browser/API reproduction references in `/tmp/propertyflow-maintenance-review.AQgsal`, durable idempotency next task, current PR/main observations and approval boundaries. Prior test evidence does not establish release readiness. Maintenance remains local/unpublished.

---

## Maintenance dependency integration stopping point — 2026-10-14

Maintenance commit `c7aef20` retains validated harness `1cf022e` (source `496a663`). The assignment opaque-subject fix `d3f5c3081c086a7141e82c1a702302b9806dae92` is now integrated as `7764a31`. Only the docs insertion conflicted; both maintenance and upstream evidence sections were preserved. This supersedes the pending opaque-ID integration statements below. No feature expansion or source-worktree modification occurred. Server Prisma/TypeScript build passed; affected safe Node subset passed **28 tests, zero failures/skips** (`/tmp/propertyflow-maintenance-dependency-tests.txt`). Existing maintenance PostgreSQL/browser evidence remains as recorded below; no database rerun was needed for this dependency-only integration. Independent maintenance review is in progress; do not publish/merge/deploy without parent/user approval.

---

## Bounded maintenance requests — 2026-10-14

Implemented on `maintenance-requests-mvp` in the isolated maintenance checkout, starting from committed assignment head `940c905`. The source's dirty harness was left untouched; final harness commit `496a663caf65706a54460022fb0021afdc0466d0` was safely cherry-picked as `1cf022e`. The assignment author is separately correcting opaque Auth0 subject validation; that upcoming dependency must be integrated before publication. Maintenance never validates authenticated subject IDs with the property/request ID whitelist.

Resident creation accepts only propertyId, title (1–160 characters), description (1–4000), and priority low/normal/high. Company and requester come from the session. Resident list returns only their own requests for currently assigned properties; owner/manager list returns company history, with status/property filters. Staff and platform-only users have no maintenance access. Statuses open/in_progress/resolved permit any transition, including reopening; repeated same-status updates do not create audit changes. Creation and actual status changes are audited without copying request descriptions into audit detail. Minimal responses contain request fields and property name, without requester email/identity or company identifiers. All mutations require same Origin and session CSRF token, independently of the shared session middleware.

Conservative MVP policy: removing an assignment, transferring company membership, disabling account/membership, or changing resident role removes resident request access. Managers retain old-company history after removal/transfer. Reactivation does not recreate assignments; explicit reassignment to the original property restores access to that resident's own history. Company suspension denies access and preserves history. This models authorization associations, not leases, occupancy or tenant readiness.

Every maintenance transaction locks the actor User row with the existing no-op write pattern, then rereads active company role/authorization inside a Serializable transaction before setting local company RLS scope. Resident creation checks a same-company current assignment; resident reads additionally filter same-company requester ownership and a current property assignment. Assignment revocation/transfer locks the same resident tuple, forcing a stale waiting transaction to retry and revalidate. A request transaction ordered before revocation may complete; transactions ordered after committed revocation fail creation or return no resident records. Transactions retry at most three times via the existing adapter-aware retry helper. Manager status updates rely on Serializable write conflicts to retry concurrent updates and audit the actual preceding status. No external side effects occur in retry callbacks.

Additive migration `202610140004_maintenance_requests` follows assignments. It creates company and composite company/property foreign keys, restrictive requester User FK (not membership FK, to retain history), checked lengths/priority/status, indexes and forced company RLS for the existing restricted runtime role. RLS intentionally enforces only company scope: same-company resident ownership/eligibility remains an application responsibility. No baseline migration or existing database was modified.

UI adds company Maintenance and resident My requests navigation, creation/status forms, actual matching status counts, status/property filters, empty/loading/error/retry/success states. Counts explicitly refer to matching requests. No fictional assignee, due date or overdue claim is introduced. No attachments, vendors, finances, notifications, payments, infrastructure, invitation or membership rule changes.

Validation executed:

- Client TypeScript/Vite and server Prisma generation/TypeScript builds passed using a dummy loopback build URL (no database connection).
- Focused maintenance real PostgreSQL suite: **6 tests passed, zero failures/skips** (two top-level tests plus four integration subtests). Includes real cookie/session auth, role/company/resident isolation, strict input/identity/priority validation, Origin/CSRF, all status transitions, audit records, forced RLS, composite property FK, and lifecycle history. Two deterministically blocked User-lock cases prove creation and reads wait before assignment removal, then deny/empty after retry. Also covers membership disable/reactivation, role change, account disable/reactivation, company transfer and suspension. Log: `/tmp/propertyflow-maintenance-final-postgres.txt`.
- **4 Playwright maintenance fixture tests passed** on an isolated `127.0.0.1:5017` Vite server using `playwright.maintenance.config.ts`: submit failure/retry/success and real counts, manager status/filter/error retry, no-assignment controls, delayed loading controls. Fixtures verify frontend behavior, not live Auth0 acceptance.
- Existing safe Node regression subset: **25 passed, zero failures/skips** (access, assignment, installed adapter retry, tracing). The assignment real-DB suite was not duplicated or rerun.
- Database tests used only cached postgres:17-alpine image `b0f9560a2de0`, unique exact container IDs, no mounts/volumes, tmpfs data, loopback-only ephemeral ports and test credentials. Empty public schema was asserted before migrations. Containers `07415bc02c1d0639a61a0ef656aa8707bdacbd7e96ed5a840ae683c62319857b` (49479), `f62dd2d4b64bd501510f0eed3083dc57bad9dd8b2488a352ed663119bd2ebf18` (49529), and `074000e3bd50c4fdc133be9c7419ae6a5b267206d861030397325f86ba87796e` (49579) were used only for incremental test changes and removed by exact ID afterward.

Remaining review/release issues: independent security review required; upstream opaque-subject assignment fix pending integration; live Auth0/browser acceptance and remote CI not run. Maintenance-specific creation-leading revocation ordering, concurrent manager updates and forced retry exhaustion were not independently stress-tested (the shared assignment/retry helper has prior validation). Lists are unpaginated for this bounded MVP and may need pagination as real volume grows. No user-visible assignee/due dates/status timeline; audit history is retained internally for a separately scoped follow-on. Migration was executed as SQL on fresh disposable PostgreSQL, not through a fresh maintenance-specific Prisma migrate-deploy/upgrade run. Direct administrative SQL must preserve assignment cleanup/locking conventions. No push, PR publication, merge or deployment is authorized or performed for this slice.

---

## PR14 opaque identity review fix — 2026-10-14

PR14 was not merged. Both approval-review attempts were blocked; the user then stopped merge pending the P2 finding [Accept opaque Auth0 subject identifiers](https://github.com/elijahvw/property-flow-2/pull/14#discussion_r4266365871). The existing assignment handler incorrectly applied property-ID syntax and a 200-character limit to persisted identity-provider subjects. [Auth0 documents provider-specific formats and permitted punctuation](https://support.auth0.com/center/s/article/What-is-the-format-of-the-user-id-and-can-I-use-special-characters).

User identifiers now use a separate opaque validator: preserve the exact string, including case and punctuation, without trimming/normalization; reject only nonstrings, empty values, NUL (unsupported by PostgreSQL text), and values above a 4096-byte UTF-8 request safety bound. Property IDs retain their existing grammar/200-character bound. Assignment PUT/DELETE, target membership/account lifecycle routes and ownership transfer all use the opaque user-ID validator. Production Fastify router parameter length now permits 4096 decoded characters; otherwise its default 100-character route limit would still block long subjects before validation. The handler byte bound and existing 64-KiB request body limit remain enforced. These limits comfortably support long external-provider subjects; IDs above 4096 bytes are explicitly unsupported and rejected rather than silently transformed.

Verified safe checks: **38 Node tests passed** (`/tmp/propertyflow-opaque-id-node-tests.txt`), **19 Playwright fixture tests passed**, server Prisma generation/TypeScript build passed with a dummy database URL, database test syntax and `git diff --check` passed. API fixtures round-trip plus, >200-character, external-provider Unicode/punctuation and encoded slash/query/percent IDs, verify exact lock/audit targets, assignment/removal and lifecycle/ownership support, and reject empty/NUL/oversized inputs. Browser fixtures verify exact percent-encoded PUT/DELETE paths for plus, long and external-provider IDs. Added a persisted-ID PostgreSQL regression for CI; it has not run locally, and prior 38-test independent DB evidence predates this fix.

PR comment gate checked all conversation comments, review bodies and inline comments/threads through paginated REST lists (`per_page=100`, counts 2/1/1, so no further page exists) plus thread state. Only the opaque-ID P2 finding is substantive; CodeRabbit explicitly skipped its review, and the Codex summary points to that same finding. The inline thread remains unresolved for renewed reviewer validation; no automated finding was falsely marked resolved. Recheck all comment/review pages before reporting ready and again before any future merge. New head requires renewed review and user approval. No merge, manual migration or deployment occurred.

---

## Independent PostgreSQL validation and PR handoff — 2026-10-14

The independent reviewer validated a corrected temporary copy of `940c905e05094a454dbc359d5adfed79592f4464`. Applied the reviewed `harness-and-race.patch` locally: each controlled Fastify instance now registers its own session plugin (required for cookie/session authentication), and all five lifecycle changes run in both lock orderings with both absent and preexisting assignments. The final database test file matches the independently tested copy byte-for-byte; application and migration contents are unchanged from the tested correction.

Independent evidence retained at `/tmp/propertyflow-db-review.l3vfgG`:

- `freshcli-fresh-deploy.log`: real Prisma migrate deploy successfully applied all **four** migrations in correct order to an empty disposable PostgreSQL 17 cluster, with Property and ResidentPropertyAssignment forced RLS enabled.
- `upgrade-database.log`: upgraded the populated `cb80ede` baseline using Prisma migrate deploy, preserving every existing table record; runtime assignment/API reads work and unscoped assignment reads are denied.
- `fresh-database-access.test.log`: **38 tests passed**, zero failures/skips, including **20** deterministically coordinated assignment/lifecycle races (five changes, both orderings, absent/preexisting assignment), same-company resident isolation, real three-attempt exhaustion, company/role/account cleanup, composite keys, forced RLS, authorization and invitation/session behavior.
- `fresh-deadlock.log`: actual PostgreSQL wait cycle produced nested P2010 / `40P01`; serializable retry recovered, with transaction attempts `[1,2]`.
- `fresh-runtime-boundary.log`: real runtime SELECT/INSERT/UPDATE/DELETE respect assignment company RLS, rollback does not leak company scope, and the database-backed assignment endpoint denies anonymous requests, wrong/missing CSRF and wrong Origin while permitting valid mutation.
- `fresh-isolation.json`, `freshcli-isolation.json`, `upgrade-isolation.json`: uniquely identified fresh containers using the cached postgres:17-alpine image `b0f9560a2de0`, loopback-only ports, no mounts, tmpfs database storage, and verified empty clusters before resets. Corresponding `*-cleanup.json` files confirm all three containers were removed. No existing/shared/development database was used.

Safe handoff checks: **35 Node tests passed** again (`/tmp/propertyflow-resident-final-node-tests.txt`), and database test syntax / `git diff --check` passed. Prior server/client builds, 16 browser fixture tests and 24 operations tests remain verified. No additional local database run was needed after applying the exact independently tested harness patch. Live Auth0/browser acceptance remains outstanding; Node 22 CI validation is pending the PR.

User authorization now permits the focused branch push and PR creation, with notification and approval before merge. No merge, auto-merge or deployment is authorized in this task. Reviewed workflow triggers: CI runs for PRs targeting main; Deploy Dev listens only to main push or explicit dispatch, and application deployment jobs additionally require explicit dispatch. No branch-push/PR deployment trigger or workflow_run deployment exists. PR13 onboarding has merged to main (`163df0bd0d85fb870092b1e96a21acd5e2c55fef`); the assignment PR must contain only the diff after `cb80ede`.

Earlier statements below that PostgreSQL tests were unexecuted or publication was paused describe the historical stages and are superseded by this validation/authorization record.

---

## Security review fixes — 2026-10-14

The independent reviewer blocked release of `e06cccfe1db6b05319ae8e57e336a6def073c59c` on migration ordering and adapter error classification. Both were fixed locally for re-review, with no publication or database execution.

- Renamed the **unapplied** assignment migration to `202610140003_resident_assignments`, after `202610140002_property_isolation` creates `propertyflow_runtime`. Baseline migrations are unchanged. A safe filesystem test now checks the migration ordering and role-creation prerequisite.
- Retry classification now also recognizes `P2010.meta.driverAdapterError.cause.originalCode`, the nested SQLSTATE shape emitted by installed Prisma 7.4.1 / PrismaPg. Existing supported forms remain. Six new safe tests include actual PrismaClient + PrismaPg with an in-process pg transport, exercising `40001` and `40P01` success after two failures, exhaustion after exactly three attempts with `409 ACCESS_CONFLICT`, unrelated `23503` propagation after one attempt, and migration ordering. No transport test opens a network socket or uses a database URL.
- Replaced probabilistic database race loops with authored deterministic coordination around the application's real target-lock query. A leading transaction holds the row lock; the follower's PostgreSQL backend PID is captured and `pg_blocking_pids` must prove it is blocked before release. Both ordering directions cover membership disable, account disable, company transfer, role change and ownership promotion. Tests require a real retry, verify both companies contain no residual assignments, assert denied/empty self access as appropriate, and verify reactivation requires reassignment. A real stale-snapshot exhaustion case externally changes the target MVCC tuple before each attempt and expects exactly three attempts, a 409, and no assignment or audit writes. Added a second same-company resident assigned to a distinct property and exact self-only response assertions. Dedicated race users are removed within the disposable test database to preserve baseline last-owner assumptions.

Follow-up verification: server Prisma generation/TypeScript build and client TypeScript/Vite build passed; the full safe Node subset passed **35 tests**, including the six installed-adapter/migration-order tests. Output: `/tmp/propertyflow-resident-review-fix-node-tests.txt`. `node --check server/tests/database-access.test.mjs` and `git diff --check` passed. Browser and operations results remain the prior verified **16** and **24** passes; their implementation is unchanged in this follow-up.

The strengthened PostgreSQL cases are **authored and syntax-checked, not executed**. No integration suite (including its skip path), Docker container, PostgreSQL listener, or schema reset was invoked in this follow-up. Parent reports cached Docker 28.1.1 and a postgres:17-alpine image (`b0f9560a2de0`); isolated disposable validation is pending explicit parent confirmation. The earlier Docker sandbox-access limitation does not establish runtime unavailability after approval. RLS/composite-key enforcement, deterministic races and real-DB exhaustion remain unverified until that authorized run. Stop for the same independent reviewer before publication.

---

## Resident property assignment slice — 2026-10-14

Implemented on `resident-property-assignments` from clean owner-onboarding `cb80edeb93eeec2275671eb0f2c21b0b9df2f26e`, in an isolated local clone. The reviewed source checkout and its Git metadata were not modified. No ancestor/repository AGENTS.md was found. No push, merge, deployment, infrastructure provision, package installation, migration application, or existing database operation occurred. Stop here for independent review before publication.

### Completed behavior

- Added `ResidentPropertyAssignment(companyId, propertyId, userId, createdAt)`, primary/unique property-user pair, composite foreign keys to Property and CompanyMembership, and their required unique keys. Migration `202610140003_resident_assignments` is additive, grants runtime table access, and enables **forced company RLS** using transaction-local `app.company_id`. Existing one-company membership and property RLS remain unchanged.
- Owners/managers receive `resident.assignment.manage`; staff, residents, and platform-only authority do not. `GET /api/company/residents` lists active resident memberships with active accounts/companies, excluding unaccepted invitations. `GET /api/company/properties/:propertyId/residents` lists associations; `PUT` and `DELETE /api/company/properties/:propertyId/residents/:userId` assign/remove idempotently. Assignment uses an existing user ID, not email/invitation ID. Foreign/missing property or member returns 404; a same-company ineligible target returns 409; malformed IDs return 400; forged company headers return 403. Existing authentication, Origin/CSRF hooks and manager invitation restrictions are preserved. Mutations audit property and target IDs.
- `GET /api/resident/properties` derives company and user identity from the authenticated principal, freshly validates access transactionally, filters self even within the same company, and selects only property `id/name/address`. Query parameters cannot select another resident. Suspension denies access while retaining associations.
- Membership disable, company transfer, role change, account disable, and ownership transfer clear associations under the old company context in the same transaction. Reactivation does not restore rows. Target mutations share a user-row write lock via a no-op `updatedAt = updatedAt` UPDATE: changing the MVCC tuple forces older Serializable snapshots to retry before target validation. Serializable transactions retry at most three attempts, handling Prisma P2034 and raw PostgreSQL serialization/deadlock SQLSTATEs, then return an actionable 409. This applies to existing serial lifecycle handlers too; no externally delivered side effects occur in their callbacks.
- Property directory offers **Manage residents** to owners/managers, with accepted choices, assigned badges, removal, loading, error/retry, and empty states. Resident portal renders assigned-property cards or no-assignment guidance. UI explicitly says association is not a lease or occupancy proof. Onboarding retains truthful invitation issuance/acceptance wording and now points to Manage residents. No payment/maintenance workflows were added.

### Verified checks

Used Node v24.1.0, existing cached dependency versions, and copied ignored node_modules using APFS cloning from the source checkout. Prisma generation used a dummy localhost URL and copied schema-engine cache under `/tmp/pf-prisma-cache` after the default cache location was blocked; no database connection or download occurred. Deployment/CI remains documented for Node 22, which was not executed locally.

- `XDG_CACHE_HOME=/tmp/pf-prisma-cache DATABASE_URL=postgresql://dummy@127.0.0.1:5432/dummy npm run build --workspace=server`: passed (Prisma generation + TypeScript). Final subsequent server compilation passed after adding raw serialization retry handling.
- `npm run build --workspace=@property-flow/client`: passed (TypeScript + Vite). `./node_modules/.bin/tsc -p client/tsconfig.json --noEmit`: passed.
- `env -u TEST_DATABASE_URL -u DATABASE_URL -u RUNTIME_DATABASE_URL node --test server/tests/access.test.mjs server/tests/resident-assignments.test.mjs server/tests/tracing.test.mjs client/tests/*.test.cjs`: **29 passed** (21 existing, 8 new). Final output: `/tmp/propertyflow-resident-node-tests.txt`. New route fixtures cover permission boundaries, forged headers, invalid IDs, foreign/missing equivalence, inactive/disabled/suspended eligibility, duplicates/removal, same-company self isolation/minimal fields, lifecycle cleanup including ownership transfer, reactivation, and bounded ORM/raw serialization retry behavior. These fixtures assert transaction scopes/locks and do not prove real database concurrency.
- `./node_modules/.bin/playwright test -c playwright.onboarding.config.ts --reporter=line`: **16 passed** (12 existing, 4 new). Localhost listening required sandbox escalation, which was approved. All APIs were intercepted; no real sessions/accounts/database. New browser fixtures cover manager assignment/removal, 409 recovery, staff gating, resident cards/empty/error retry, and pending resource loading. Existing onboarding mobile/scope-change coverage remains green.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/operations -p 'test_*.py'`: **24 passed**, with no infrastructure dispatch.
- `git diff --check`: passed.
- `env -u TEST_DATABASE_URL -u DATABASE_URL -u RUNTIME_DATABASE_URL node --test server/tests/database-access.test.mjs`: **skipped**, explicitly without any database URL. No schema-resetting suite ran against a database.

### Unverified database checks and review risks

Added PostgreSQL integration cases for forced RLS, unscoped/foreign-company reads and inserts, both composite foreign keys, duplicate assignment/self minimal output, and repeated overlapping assignment versus membership/account revocation. Increased the isolated suite pool to four connections so future Promise.all race tests can actually overlap. **These cases have not executed.** No local PostgreSQL binary was found; Docker daemon access was sandbox-blocked. PGlite packages exist but are not a substitute for real multi-connection PostgreSQL locking/concurrency validation.

Safe future approach: start a fresh throwaway PostgreSQL cluster/container on an unused loopback port with a unique container/volume or a new temporary data directory, verify the listener/process and empty cluster, create only `propertyflow_access_test`, and supply its local admin URL to the integration suite. That suite intentionally drops/recreates public and changes its cluster-local runtime role, so the hostname/database-name guard alone is insufficient evidence of disposability. Never point it at an existing development/test/shared database. The cluster must be verified disposable before execution and removed afterward. No cluster/container was created in this task.

Independent review should focus on the no-op user write-lock/snapshot fence and adapter serialization error mapping, old-company RLS cleanup before composite-key membership changes, migration rollout/index lock impact, and fresh actor/self authorization. Authenticated acceptance, real PostgreSQL race/RLS/constraint tests, and remote CI remain required before release. Direct administrative SQL that changes role/status is outside these application handlers and must clear associations explicitly; company suspension intentionally retains rows. Pending invitations remain unassignable; no email is automatically delivered.

### Remaining MVP work

Independent review and the database/live-auth checks above; maintenance submission/manager queue/status lifecycle; lease/payment workflows; property detail/edit/units. The prior owner-onboarding evidence below is historical, and its statement that property assignment was absent is superseded by this slice.

---

Updated 2026-10-14 for the focused owner onboarding slice. Source baseline: `f15e7b43256790ba3acabf08025f707d3771cbc9` (PR12 head), verified clean on `codex/access-overhaul`. Implementation branch: `codex/owner-onboarding`. No push, merge, infrastructure changes, deployment or database operations in this task.

## Cohort decision and implemented behavior

The user confirmed administrator-assisted company creation and initial owner assignment for the first cohort. Self-service company creation is outside this slice. Before assignment, `/access` explains the administrator path and invitation acceptance. Existing disabled-account/membership/company screens and API permission guards remain in force. One company membership per person remains unchanged.

PR12 provides Auth0 PKCE, server cookie sessions, platform administration, company permissions, company-scoped property creation/listing, profile/settings, and invitations with verified-email acceptance. Platform authority alone grants no company property access. There are no property detail/edit/unit routes or operational maintenance dashboards.

This slice addresses three concrete usability failures:

- Active assigned owners landed in Properties without next-step guidance. Properties now includes a company-access, first-property, and resident-invitation checklist. It opens the existing property form and links to company settings and Team. Only active company owners with all required capabilities mount the checklist or its invitation request. Manager/staff/resident/platform-only users do not see it.
- Owners who also have platform authority could reach Team but could not create invitations: the platform-user API requires an explicit company ID. Team now passes the current membership company ID. Existing server validation and authorization remain unchanged.
- Creating a Team invitation refreshed memberships instead of the separate invitation list. The list now remounts and reloads after successful invitation creation, showing the new record immediately while preserving the one-time link.

Property progress uses the existing accessible company directory and refreshes after creation. Invitation progress filters `/api/invitations` by the current company and resident role, including for a company owner who also has platform authority. It records issuance only, including historical accepted/expired/revoked records; the Team list shows their actual status. It never asserts acceptance, property assignment, occupancy, maintenance readiness or automatic email delivery. The endpoint exposes the latest 100 invitations; absence is explicitly described as absence from available records, rather than proof that no invitation was ever issued.

Each resource has loading, error and retry states. Empty records remain incomplete. Check-progress reloads both resources; returning from Team fetches invitations again. The existing resource hook was moved unchanged into `client/src/useResource.ts`, retaining scope-based invalidation and abort handling.

## Auth and routing review

Checked logged-out protected pages, failed/loading bootstrap guard behavior, role landings, disabled/new-user states, capability navigation, safe return paths, invitation secret preservation, callback expiry handling and terminal redirect destinations. No concrete auth/routing blocker was found in this source review and fixture checks. No authentication/security design change was made. Live successful Auth0 callbacks remain unverified.

## Verification in this slice

Local Node v24.1.0 and Playwright 1.58.2; documented deployment/CI runtime is Node 22. Dependencies were reused from the clean source checkout; no package or lockfile change. See reproducibility details below.

- `./node_modules/.bin/tsc -p server/tsconfig.json --outDir server/dist`: passed; builds the source exercised by server unit tests without Prisma generation or database access.
- `env -u TEST_DATABASE_URL -u DATABASE_URL -u RUNTIME_DATABASE_URL node --test server/tests/access.test.mjs server/tests/tracing.test.mjs client/tests/*.test.cjs`: **21 passed**. Includes 2 added tests for role landings and locally rejected callback bindings, plus existing permission, CSRF, logout, redirects, tracing and client guards.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/operations -p 'test_*.py'`: **24 passed**; no infrastructure command dispatched.
- `./node_modules/.bin/tsc -p client/tsconfig.json --noEmit` and `./node_modules/.bin/tsc -p server/tsconfig.json --noEmit`: passed.
- `npm run build --workspace=@property-flow/client`: passed (TypeScript + Vite).
- `./node_modules/.bin/playwright test -c playwright.onboarding.config.ts`: **12 passed on the review-fix rerun** (original implementation: 10 passed). Isolated same-origin API fixtures, no real accounts or database. Covers owner navigation/create/invite/return, stale Team list regression, independent failure/retry, loading, non-owner/anonymous/disabled landings, suspended/disabled/platform-only checklist gating, filtering other-company/non-resident records, session company changes, dual company/platform owner invitation creation, old responses released after new-company data, and mobile document/checklist overflow assertions. Mobile screenshot: `/tmp/propertyflow-owner-onboarding-mobile.png`.

The localhost browser server required sandbox escalation after a listen EPERM; the authorized fixture test command succeeded. No database test was run: PostgreSQL integration tests drop/recreate schema and require a verified disposable database. Live sessions, successful OIDC exchange, invitation email matching/acceptance, replay races and database RLS/migrations were not reverified here. Browser fixture tests prove frontend behavior, not server authorization or release readiness.

## Independent review follow-up and reproducibility

The reviewer found the dual-role invitation compatibility defect described above. The added fixture requires an explicit matching company ID for platform-authorized invitation POSTs and asserts the exact payload, one-time acceptance link, refreshed Team record, and checklist progress after returning. The delayed-scope test waits for both old requests, switches company, waits for both new empty responses, and only then releases the old responses; newer progress remains intact. At 390px, the browser asserts document scroll width does not exceed viewport width and the checklist stays within its bounds.

CI now installs Chromium (with Linux dependencies) and runs `npx playwright test -c playwright.onboarding.config.ts --reporter=line,junit` in the existing lint-and-test job. `PLAYWRIGHT_JUNIT_OUTPUT_FILE=test-results/onboarding.xml` feeds the existing report artifact/upload steps. The focused config starts only a localhost Vite server; all API calls are intercepted fixtures. No additional service, database or deployment is needed for this suite. Workflow wiring is source-reviewed only; no remote CI run was dispatched.

The original implementation temporarily used this exact root dependency symlink in the task worktree:

```sh
# Replace /path/to/dependency-checkout with an existing local checkout.
ln -s /path/to/dependency-checkout/node_modules node_modules
```

That symlink supplied React, TypeScript, Vite, Playwright and the previously generated Prisma client. Chromium was already installed in the local Playwright browser cache (headless shell also cached). No package installation or browser download was performed. The symlink was removed before the original clean handoff, explaining why a reviewer without dependencies could not rerun Node/Playwright tests.

For this follow-up, dependencies were copied into an ordinary ignored worktree directory using macOS APFS cloning, preserving the source dependency tree:

```sh
cp -cR /path/to/dependency-checkout/node_modules node_modules
```

This ignored directory is retained for local review. For a fresh checkout without that cache, use Node 22, install from the root lockfile, generate Prisma client using only a dummy build URL, and install Chromium. These preparation commands do not run migrations or require a live database:

```sh
npm ci
DATABASE_URL=postgresql://dummy@127.0.0.1:5432/dummy npm run build --workspace=server
npx playwright install chromium
# On Linux, use: npx playwright install --with-deps chromium
```

The fresh-install path was not executed locally; local validation used the copied dependencies above. To reproduce the safe test subset, run the listed Node/TypeScript/build commands, excluding `server/tests/database-access.test.mjs` and any schema-resetting integration suite, then:

```sh
PLAYWRIGHT_JUNIT_OUTPUT_FILE=/tmp/propertyflow-onboarding-review.xml ./node_modules/.bin/playwright test -c playwright.onboarding.config.ts --reporter=line,junit
```

Follow-up results: 21 Node tests, 12 browser fixture tests, both TypeScript checks, client build and `git diff --check` passed. Server source was recompiled into `server/dist` before the Node tests. Browser JUnit evidence: `/tmp/propertyflow-onboarding-review.xml`; updated screenshot: `/tmp/propertyflow-owner-onboarding-mobile.png`. The original 24 operations tests remain the prior result; this fix does not change operational logic. No disposable database integration or live authenticated acceptance was run.

## Remaining work and known limits

1. Parent-arranged review of the follow-up fix and CI execution, then authenticated browser acceptance using separate assigned-owner/resident accounts in the existing development environment.
2. Resident-to-property assignment is absent. Accepted invitations create company membership only. Build that isolation boundary before property-specific resident maintenance access.
3. Maintenance submission, manager queue and status lifecycle are absent. Lease/payment workflows and real operational summaries are also absent.
4. Property management supports creation/listing only; detail/edit/units remain follow-on work.
5. Invitation list truncation may hide older issuance (explicitly disclosed). Completion denotes issuance, even if later revoked/expired; usefulness depends on reviewing the Team status. Automatic invitation delivery does not exist.
6. Existing platform invitations are global for platform owners. The checklist filters them locally; no endpoint or server permission changes were introduced.

## Historical release evidence

The earlier audit record is kept outside the repository. Its parent-supplied evidence confirms successful development deployment of PR12 merge `d4760b32718da5b9e8b5a6a8e6bc51dbcc15979f`: [Deploy Dev run 38497232143](https://github.com/elijahvw/property-flow-2/actions/runs/38497232143), and [PR CI run 38495106759](https://github.com/elijahvw/property-flow-2/actions/runs/38495106759). Those are historical results, not a fresh verification or a deployment of this slice. Authenticated acceptance remains outstanding; production deployment is not claimed.
