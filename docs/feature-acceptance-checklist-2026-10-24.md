# October 24 feature acceptance and release checklist

This is the review/deployment handoff, not a production-readiness claim. **New feature development is paused.** The tenant privacy fix is locally validated, including the final 320/320 browser pass (5.4m, exit 0); coordinated draft-PR publication and CI remain pending. No merge, deployment, live migration, provider activation, customer messages or charges were performed by this continuation. The user will decide release and perform deployment.

Selected review branch: `codex/platform-controls-landlord-workflows`, based on main `75d5342732ab8fc1e67deb3de9d045855eb20dc6`. One coordinated draft PR is being prepared; use its current head/checks and the published handoff URL once available. Feature-branch CI does not deploy.

Tenant privacy validation is green locally: real users/recovery **56/56** (42.72s), final client build, all 13 client test files including six API header/uncertainty checks, independent review and final combined browser **320/320** (5.4m, exit 0). Earlier on October 24, a 319/320 verification-fixture failure was corrected; 10 repeated and 11 affected tests pass, with the failure history retained. Draft-PR publication and CI remain pending; no deployment or real-account acceptance is implied. [Exact checkpoints, failures, logs and limits](roadmap-continuation-2026-10-24.md).

## Local validation matrix

These are scoped local runs, not deployment or real-account acceptance. Unchanged-module results retain their recorded source/checkpoint; they are not every suite freshly rerun after each fixture-only change. Current draft-PR checks are the head-specific CI record once available.

| Check | Local result |
| --- | --- |
| Builds/types | Server Prisma/TypeScript and final client TypeScript/Vite pass, including whitespace-only cleanup |
| Safe server | 117 total: 109 pass/eight expected DB-suite skips; dedicated local access suite not separately rerun |
| Client | All 13 files pass, including six API header/uncertainty checks |
| Real users/tenant privacy | 56/56, authority-verified source; 42.72s |
| Real finance / leasing / maintenance | 192/192 refined finance; 40/40 leasing; 147/147 maintenance/directory |
| Roadmap / company billing / support | 34/34; 15/15; 14/14 |
| Operations | 88/88 and development power-inventory guard pass |
| Finite local capacity | Maintenance 270/270 measured responses; tenant 511/511 total reads including 240 measured, with documented tradeoffs |
| Current combined frontend | Final 320/320 pass, 5.4m, exit 0. First 319/320 fixture failure and corrected repeat 10/10/affected pre-login 11/11 remain recorded |
| Current PR CI | Pending; use coordinated draft PR's current head/checks. CI unskips access against PG 17 |

No separate lint command exists; no independent lint pass is claimed. Dedicated Terraform/RUM/OTel/monitoring checks were not rerun locally for this batch. CI uses Node 22/PG 17; local Node 24/system Chromium and temporary untracked Prisma workarounds are not release configuration. [Full logs and exact evidence](roadmap-continuation-2026-10-24.md).

Record acceptance against the actual release: SHA/PR(s): ____ · environment/schema: ____ · date: ____ · tester/role: ____ · desktop/mobile evidence: ____. Leave unchecked work unaccepted; local fixtures and screenshots do not substitute for actual-role acceptance.

## Review these issues before release

- **Material unresolved company-context issue:** property CREATE lacks the opening-company pin added to TenantForm. A same-account A→B company switch can put the old A property draft into freshly authorized B. This is not fixed by the tenant work and remains a pre-release issue for review.
- Property/unit/prospect/readiness/household control and open-form follow-ups were **not implemented** before the pause. Actual server feature modes deny writes, but some controls/forms remain active and policy refresh can lose local drafts. Do not infer platform-wide disabled buttons or draft preservation from TenantForm's tests.
- Infrastructure declares **PostgreSQL 16.3**; disposable local/CI suites use PostgreSQL 17. Target-version migration/query compatibility and native performance plans remain unverified on 16.3. Local Node 24/system Chromium/untracked Prisma environment workarounds are not release setup; CI uses Node 22/PG 17 and standard installation.
- Provider contact create/rename precedes the final database gate. Existing unique-provider lookup/reuse and explicit ambiguity handling remain, but there is no new durable provider intent or cross-system rollback guarantee. Avoid treating a denied database save as proof that no provider-side action occurred.

## Release/schema/configuration gates

- [ ] Confirm the actual deployed SHA and migration history. Checked-out base `75d5342` includes PR59/038–040; the last known hosted `1945049` may need **all pending 038→050**, not only 041 onward. Do not infer deployed state from merged main or dated screenshots.
- [ ] Review matching server/client artifacts, PR findings and required CI. Local safe server 117 means 109 passes/eight expected DB-suite skips; the dedicated local access suite was not separately rerun. CI unskips access against PG 17 and runs the dedicated integration runners. A configured job is not a completed CI result.
- [ ] Use the existing ordered rollout/Start/Stop controls and verify its pre-migration restore-point gate, backend migration/readiness and matching frontend release. No new infrastructure, provider credentials or runtime activation variable is introduced by 041–050. Repository CloudFront API forwarding already uses AllViewerAndCloudFrontHeaders; live company-header forwarding still needs acceptance.
- [ ] Review migration execution/locks. Read-only audit found no concrete blocker, but 041/042 have no explicit transaction wrapper; 046 constraints and 050's normal index can block writes. On partial failure inspect migration status/schema/logs; never blindly resolve migration history, drop tables or rerun mutations.
- [ ] Keep a verified restore point and compatible application artifacts. Old binaries ignore new feature/impersonation/reply/preference semantics, so binary-only rollback after activation is not automatically safe. Prefer a coordinated forward correction or reviewed restore procedure; restoration must account for writes since the snapshot. Preserve audits, imported sources, invoices and receipts; do not use destructive down-migrations as corrections. [Release/restore-point workflow](dev-release-performance.md).
- [ ] Use a dedicated test company and actual test-role accounts. Auth0 account-first identity rules remain; no email matching/automatic portal grant. Do not activate billing collection or repurpose customer data as disposable test data. Set only explicitly chosen plan prices; no prices/plans/invoices/charges are seeded.

| Scope | Migration / change |
| --- | --- |
| Already in base, possibly not hosted | 038 lease inspections; 039 agreement preparation; 040 in-app notifications |
| Preserved original request | **041** support impersonation; **042** configurable monthly plans/features/usage/manual company billing |
| Continued product work | **043** unit availability/readiness; **044** unit CSV imports; **045** manual prospect pipeline; **046** explicit leaseholder document sharing |
| Continued product work | **047** paid-expense imports; **048** requester maintenance replies; **049** personal in-app preferences; **050** maintenance ordering index/directory support |
| No additional migration | Historical cash cutoff/comparison; prospect source-return and preferred-unit hint; tenant directory/independent rental history/query refinement; grouped forms and tenant access/recovery/privacy fixes |

## Run each workflow across its boundaries

For every applicable item: use an actual authorized role, then a denied role/other-company account; inspect source/history and direct links; repeat at desktop and 390px with keyboard focus. A read-only area must still reject writes server-side. Only the tenant paths have the new complete control/draft/revocation behavior; the broader form gaps above remain known. For retries use controlled test interruptions and the original submission, not a second financial/contact record. Record unexpected behavior with the exact role/path/source and retained result.

### Platform owner and explicitly granted support

- [ ] **041 · Impersonation:** `/platform/impersonation` → grant/revoke support → select a real owner/manager/staff/resident → required reason → visible read-only banner → exit. Verify actual target/property/lease boundaries, denied business writes, downloads/audit attribution, stale tabs, expiry and revoke/restore. Support has no platform plan/company management. Impersonation cannot validate successful customer writes. [Contract](support-impersonation.md).
- [ ] **042 · Monthly plans/company policy:** `/platform/plans`, `/platform/companies/:companyId` → publish a chosen USD monthly revision → assign lifecycle/billing details → reasoned enabled/read-only/disabled override/expiry. Retain old revisions and version-conflict recovery; direct URLs/nested operations obey fresh role/company policy. No company feature grants a role/property/lease.
- [ ] **042 · Usage/manual company billing:** company Usage → UTC period/current resource counts; issue one reviewed monthly invoice → record a clearly labeled manual test receipt → partial receipt/reversal/void/reissue/history. Lost response replays the original once; stale company/plan review requires explicit re-review. Use fictional evidence only in the dedicated test company; real books require actual external receipt. No tenant ledger posting, collection/email, bank settlement or metered charging is implied. An active company owner sees only their own `/company/subscription`, including allowed suspended-company billing recovery; manager/staff/resident/support cannot administer it. [Contract](company-subscriptions.md).

### Company owner/manager: inventory, leasing and access

- [ ] **043 · Availability:** `/company/availability` → property/unit → review actual lease dates → explicitly ready/turnover/unavailable with reason → history. Missing leases mean unconfirmed physical readiness, and later tenancy makes old confirmation stale. Check stale-version/replay and denied staff/resident access; no listing publication/reservation.
- [ ] **044 · Inventory CSV:** `/company/imports/units` → actual property IDs and allowed headers → preview every row → review/commit or cancel → batch/source/history. Invalid rows block the whole batch; changed property/duplicates require fresh review; interrupted commit retains the original result. Maximum 500 rows/256 KiB. It imports units, not people/leases/opening money.
- [ ] **045 · Prospects:** `/company/prospects` → inquiry/follow-up/application/review/decision/reopen → explicitly reviewed existing tenant/lease conversion. Keep source versions/history; never infer identity by email or grant portal access. Tour/follow-up is date-only, not a timed appointment.
- [ ] **Source-return/preferred unit:** from a filtered page-two prospect open tenant/account/lease setup, save/follow source, use tabs/history/reauth, then Back to prospect with the same filters/page. A valid active same-property unit hint beyond the first 50 is advisory; manual review/drafts/uncertain payload win. Invalid/archived/wrong-property hints require manual choice, with no unrelated fallback, rent prefill or reservation.
- [ ] **Tenant directory/history:** `/company/residents` → search/property/rental/access/archive filters → next/previous → tenant → Rental history → lease source → return. Totals/global property choices cover complete filters; preview<=3 is not full history. Exact contact/user aliases and participant roles/effective dates remain discoverable independently of financial/invitation caps. Use seeded large examples where available; do not manufacture 1,001 real leases for acceptance. Automated 1,001-lease completeness and timed history grain<=3 are separate evidence.
- [ ] **Tenant control/privacy:** create/edit tenant, keep a draft, then change policy from another authorized session. Same-identity read-only preserves draft/version and permitted reads. Authoritative access/company/read-feature denial immediately hides private review; pending original journal survives. Restore only after fresh pinned CREATE-directory/PATCH-contact reauthorization. CSRF_INVALID/IMPERSONATION_READ_ONLY are not read-scope denial. Verify admin access-removal/generic reset exemptions, contact-specific reset's leasing gate, support actual-role views and saved-account Continue; no new administrative resident_portal gate.
- [ ] **Tenant recovery/duplicates:** committed create/lost response → later 403 → exact receipt retry yields one result. An uncommitted create encountering a later same-name active/archived contact offers deliberate separate-person review: only explicit duplicateReviewed false→true may change, retaining UUID/company/core details. PATCH has no receipt: fresh comparison shows differences first/neutral matches/all fields, close-and-keep retains retry, and explicit acknowledgment/Use current is local discard, not proof the earlier edit saved. Changing company cannot redirect the old tenant draft into another company.

### Financial/document workflows and resident experience

- [ ] **Historical cash, no migration:** `/company/reports` → Historical recorded cash → business dates/recording cutoff/comparison → source/CSV/print. Later backdated entries/voids do not rewrite the earlier known state; company timezone/DST cutoff and current-label disclosure remain visible. Exact period deltas are not normalized/accrual profit/historical lease balances.
- [ ] **047 · Paid-expense CSV:** `/company/imports/expenses` → namespace/sourceId/property/date/amount/category → per-row errors/exact totals → paid/not-recorded confirmations → commit/history/cash source/backlink. Retry once; retained duplicate namespace/source IDs remain blocked even after void. Partial invalid totals are labeled and cannot commit. No rent/deposits/opening balances or bank reconciliation imports.
- [ ] **Daily money forms:** `/company/finances`, `/company/rent`, `/company/deposits` → cash expense/rent receipt/deposit receipt/disposition. Check required labels/paired desktop fields/mobile stack, error focus/input retention, method changes, review/source versions and sticky actions. Exact lost-response retry never duplicates money; corrections retain history. Use manual evidence only—these controls do not collect/refund provider funds.
- [ ] **046 · Owner-granted documents:** lease Documents → explicitly share selected cleared versions with eligible leaseholder → `/resident/documents` download → expiry/revoke. Occupants/unselected households/other companies receive no inheritance; current scan/source/access gates recheck every open/download. Preserve exact-version history; this is not general public sharing/uploads.
- [ ] **048/050 · Maintenance:** `/company/maintenance` and `/resident/maintenance` → filters/complete counts/50-row pages → detail/source/back. Original requester adds a shared reply; team-only notes stay private and resident labels do not expose staff identities. Resolved follow-up leaves status/version unchanged. Retry retains one update/audit/event; revoke access and test direct/stale links. Legacy >1,000-array failure is explicit, never silent truncation.
- [ ] **049 · Personal notices:** `/account/notifications` → four optional company/account areas → save/retry/history. Defaults enabled; disabling affects future deliveries only, retaining old inbox/read state. Late replay returns current settings/original receipt without restoring older choices; company-switch drafts cannot write new-company defaults. Work responsibility/role/source access remain unchanged; no external delivery/reminder activation.
- [ ] **Resident/staff boundaries:** actual requester/leaseholder/occupant and selected-property staff sessions show only permitted home/rent/deposit/terms/statement/documents/assigned work. Residents cannot post money, edit roles/assignments/household authority or share files. Staff do not gain management/import/plan authority; check exact-source navigation and denial after role/property removal.

### Existing connected platform smoke regressions

- [ ] Properties/units → account-first tenant → lease draft/household → invitations/owner approvals → activation/renewal/future terms/exit retain original identity, source versions and correction history. Property company-pin and non-tenant draft/control gaps remain the explicit exceptions above.
- [ ] Rent/deposit ledgers, allocations/credits/movements, settlement/statement and void/reversal views reconcile with their original sources; billed and cash are not conflated.
- [ ] Maintenance delegation/vendors/preventive schedules/calendar retain due/source returns and current property assignments; inspections/unsigned agreement preparation/private library retain exact cleared versions, review/reopen/history. Preparation approval is not a signature; an inspection does not deduct a deposit.
- [ ] Help, overview, notifications, empty/error states, mobile scroll/focus and offline reauthentication return to the intended source without creating a record or carrying private UI across an actual identity/company denial.

## Evidence and unfinished scope

[Detailed local evidence](roadmap-continuation-2026-10-24.md) · [form/viewport evidence](form-layout-2026-10-24.md) · [role acceptance log](workflow-acceptance-2026-10-18.md). Repository tenant controls/recovery/directory/history images are local fixture captures, with byte-identical /tmp originals retained. The legacy-named notifications-local-{desktop,mobile}-2026-10-19.png images were regenerated by an October 24 local maintenance rerun: they are **not immutable original October 19 snapshots**.

Remaining work is not selected for this pause: property CREATE company pin; broader non-tenant control/draft recovery; tenant picker scale and graph/portal/global-metadata costs; timed tours; broader historical/accrual/opening/liability/guarantor/household accounting and financial imports/reconciliation; wider delegation/document uploads/sharing/retention; broader conversations/reminders; monthly renewal/invoicing automation/quotas/self-service; external screening/syndication/signatures/calendar/bank/payment collection and consent; provider/database durable consistency; PG16.3 and real-role/cloud forwarding/telemetry/incident/restore/operational acceptance. No universal capacity/SLO or timed history>3 claim follows from the local benchmark; the old eager 2k API remains faster in API-only latency, although much larger and capped.
