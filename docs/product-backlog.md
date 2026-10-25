# Property Flow implementation backlog

### PF-30 · Repeatable sales demo — PR #61 follow-up

Platform owner selects an active verified Auth0 account without existing company access/platform authority. Build a clearly fictional isolated portfolio from linked source records through current business handlers, atomically with audit and retry protection. Include current properties/units, readiness/listing, tenants/leases, finances/deposits, renewal/future billing, maintenance/vendor/cost/work history, calendar/notices, inspections/agreements/private documents, prospects/applications/follow-ups and private saved tasks. Normal company/property and personal notification/task boundaries apply. Never copy customer data, change live identities for fictional people, fabricate provider success or seed real pricing.

Teardown must target a marked generation, suspend its company, revoke sessions and release its presenter account while retaining immutable history. Repeat teardown/create responses safely; a stale generation must never affect a later one. Fixture versions and `AGENTS.md` keep future feature/schema changes represented. Dependencies: existing Auth0 presenter, migrations041–053 plus054, normal scanner for actual file clearance. Local/PR validation remains distinct from release and actual-role acceptance. Next complete workflow is build → sign in/present source links → teardown → rebuild. [Contract, coverage and recovery](sales-demo.md).

Consolidation authorization, October 24, 23:16 UTC: the user requested that all useful unique PR #60 work be incorporated into [draft PR #61](https://github.com/elijahvw/property-flow-2/pull/61). **Consolidation is in progress**, including collision-safe migrations, the saved-renewal P2 fix, ports, tests and documentation. The `b68416d` 320/320 browser and 56/56 privacy results validate the pre-consolidation baseline, not the combined result. Keep PR #60 open until every unique item is preserved on the verified remote destination and combined checks/reviews are complete; only then close it with a preservation link, retaining its branch/commits. Unrelated feature development remains paused; no merge, deployment or live migration is authorized. [Consolidation inventory and prior comparison](PR60-integration-review-2026-10-24.md).

Status reconciled October 20, 2026 against main/deployed `1945049` and this feature batch. The [roadmap](product-roadmap.md) and [platform status](mvp-status.md) separate implemented, merged, deployed and accepted scope. Acceptance bullets below include the full target capability and must not be read as completed unless explicitly evidenced. PF-16 management inspections, PF-17 unsigned preparation and PF-19 in-app notifications are implemented in this unmerged batch; signatures/external delivery remain future. PF IDs are stable references; Jira updates are disabled.

Each item is an epic to split into bounded PRs. Dependencies are prerequisites, not reasons to delay unrelated work. P1 completes core operating jobs; P2 broadens coverage; P3 commercializes/connects providers. PF-23/PF-24 accompany every increment. Use the roadmap's build sequence rather than sorting solely by priority.

## Connected records

### PF-01 · Tenant detail workspace — P1, merged in #33

Audience: owner/manager; tenant receives only their authorized self-service projection. Dependencies: existing profiles, leases, rent and deposits.

Previous baseline: the resident directory opened a contact/access editor without connected lease/financial history. This increment adds the permanent workspace and source-ledger links; see [scope and validation](tenant-workspace.md). PR #33 is merged; the user reports deployment. Real-account acceptance remains separate.

Acceptance:
- Stable tenant route supports refresh, copied URLs, browser back and existing residentId entry links. Follow a ledger/lease and return to the same tenant/filter.
- Show contact/access status, properties/units, leases and linked activity; keep rent owed, unapplied cash credit and deposits separate with source drilldowns.
- Recheck company/current authority. Management notes never enter tenant responses; access revocation clears private state.
- Test no lease, multiple/future/ended leases, missing/denied records, mobile and keyboard focus. Define historical tenant access explicitly; do not bypass current assignment revocation.

### PF-02 · Individual lease workspace — P1, merged in #34

Audience: owner/manager and authorized tenant. Dependencies: existing lease/rent/deposit APIs; reuse PF-01 navigation conventions.

Previous baseline: Rent's “Lease details” link went to a property lease directory, which had no selected-lease URL. The current increment adds an exact lease route and a connected onboarding/household/invitation/terms/renewal hub. See [scope and limits](lease-workflow.md). This does not complete PF-03's offline primary-contact migration or PF-10's coordinated billing/deposit transition.

Acceptance:
- A specific lease route shows the named lease after reload/back/copied URL; old entry links still resolve.
- Connect unit/parties/term, due/grace/instructions, billing schedule, rent/deposits, renewal and supported actions. Documents appear only when implemented.
- Directory/rent/deposit links open that exact lease and preserve property context. No silent selection of another lease.
- Tenant projection excludes management actions/notes; staff gain no financial access through the new route.

### PF-03 · Offline contacts and verified portal linking — P1

Audience: owner/manager and prospective/current tenant. Dependencies: PF-01/PF-02 surfaces and additive migration design.

Baseline: contact fields are on CompanyMembership; Lease.residentId references User. A user currently has one company membership. Recording a primary leaseholder and granting portal access are coupled. PF-03a now adds a company-owned contact identity bridge/backfill and dual writes without switching authorization or forms; see [contract and rollout](resident-contacts.md). The current PF-03b review adds offline primary leaseholder forms and, at the user’s explicit request, optional invitations and verified same-profile linking.

Delivered foundation: contact identity/backfill and compatibility. Current review: contact/lease creation UI with connected optional invitations and verified linking, as requested by the user. Preserve existing source IDs/history or provide explicit migration mappings; do not rebuild financial records.

Acceptance:
- Add an offline tenant and record a lease/manual rent/deposit without sending an invitation or creating an identity-provider user.
- Preview/confirm invitation; verified acceptance links the intended company/contact. Email matching alone never grants authority or merges identities.
- Duplicate suggestions require review. Merging contacts cannot silently combine money or household liability.
- Revoking portal access retains business history. Former tenants remain searchable under an explicit archive policy.
- Test backfill/retry/rollback, concurrent linking, changed email, existing membership elsewhere and revoked invitation. Multi-company login membership is a separate design, not an assumed side effect.

## Financial and lease completion

### PF-04 · Tenant statement and collections detail — P1

Audience: owner/manager and authorized tenant. Dependencies: PF-02 and existing money sources. Works before PF-03 and adapts to contacts afterward.

Acceptance:
- Dated charges, receipts, allocations/corrections and reconciled closing rent balance; identify future, due, within-grace, past-grace and paid-late states.
- Unapplied receipt credit and deposits remain separate. Explain transaction-date and current-status basis; do not claim historical as-of reporting.
- Management and tenant totals reconcile for shared records. Private references/notes stay private; CSV includes display/internal IDs and complete filtered totals.
- Cover partial/overpayment, void/replacement, recurring repost, empty period and cross-company access. Later movement types extend this statement instead of creating another ledger.

### PF-05 · Other charges, credit notes and concessions — P1

Audience: owner/manager; tenant sees their obligations/adjustments. Dependencies: PF-04 and reviewed monetary source/event contract.

Baseline: unapplied credit from recorded cash already exists. General non-rent charges and noncash concessions/credit notes are different capabilities.

Acceptance:
- Review category, exact amount, effective/due date, lease and reason. Distinguish amount owed, cash received and noncash adjustment types.
- Immutable adjustment/reversal links, durable replay and original terms. No generic “edit balance” endpoint.
- Define allocation order, remaining credit and reversal behavior. Screens/exports reconcile without classifying noncash credit as received cash.
- Start with one-time manual categories. Recurring lease charges and late-fee policies are follow-up slices.
- Before automated fees: explicit opt-in terms, caps/compounding/partial-payment policy, effective dates, preview and duplicate-run prevention. Confirm applicable lease/jurisdiction rules in that implementation scope.

### PF-06 · Deposit applications and actual manual refunds — P1

Audience: owner/manager and authorized tenant. Dependencies: PF-05 accounting contract and existing deposit history.

Acceptance:
- Record partial/full money actually returned with date/method/reference and reviewed remaining available funds. A receipt correction is never represented as a refund.
- Apply authorized deposits to named outstanding charges through an immutable noncash transfer; debt and held funds change together without another cash receipt.
- Separate received, applied, returned, corrected and remaining-held balances. Provide explicit correction/reversal paths for each movement.
- Refund creates one linked outflow; application creates no bank movement. Statement/deposit/cash reports reconcile exactly once.
- Concurrent applications/refunds cannot exceed held funds. Test simultaneous requests, lost responses, rollback and denied roles. Provider refunds remain PF-26.

### PF-07 · Itemized move-out settlement — P1

Audience: owner/manager and tenant. Dependencies: PF-05/PF-06; connects PF-10 transition and later PF-16 evidence.

Acceptance:
- Review actual move-out date, remaining charges, supported deductions, deposit disposition, residual debt/refund and forwarding details before commitment.
- Every amount links to a source; preserve settlement versions and correction/reopen history.
- Ending never marks unpaid money paid, waives debt or deletes records. No deletion/recreation as a correction path.
- Initial release permits manual evidence references. Deadline/notice rules need explicit review/configuration; never invent statutory defaults or imply inspection/signature support.

### PF-08 · Future-effective lease terms — P1

Audience: owner/manager and tenant. Dependencies: PF-02; event contract compatible with PF-05/PF-20.

Acceptance:
- Preview before/after rent, due/grace/instructions, effective date and exact future installments affected. Preserve prior terms/reason.
- Posted charges retain snapshots; term changes never mutate payment/allocation history.
- Define overlap, cancellation and worker-posting races; serialize posting against term changes.
- Backdated changes require explicit already-posted difference handling, not silent recomputation.

### PF-09 · Reviewed proration — P1

Audience: owner/manager and tenant. Dependencies: PF-08 terms and PF-05 adjustment contract.

Acceptance:
- Show inclusive/exclusive dates, day-count policy, rounding and exact first/last partial-period amount. Preserve accepted inputs and reasoned manual overrides.
- Normal recurring billing never duplicates the partial charge.
- Cover February/leap year, 28/29/30/31-day months, company timezone, same-day term and concurrent amendment. Policy is explicit, not inherited from competitor defaults.

### PF-10 · Renewal and lease-end handoff — P1

Audience: owner/manager and tenant. Dependencies: PF-08/PF-09; settlement money uses PF-07.

Baseline: linked renewal drafts and ended status exist; coordinated end/activate/billing transition remains incomplete.

Acceptance:
- Review predecessor/successor, last old installment, new terms/start, billing cutoff/start and deposit disposition.
- Prevent overlapping unit occupancy/duplicate billing when a worker races approval. Ending stops only the reviewed future work.
- Draft renewal never bills; retry cannot leave two active schedules or an untraceable partial transition.
- Retain debt/history for authorized management. Define tenant historical access separately from current occupancy/property authority.

### PF-11 · Households and co-tenant responsibility — P1

Audience: owner/manager and tenant participants. Dependencies: PF-03/PF-05/PF-08 contracts.

User-directed initial slice accompanies PF-02: one shared lease ledger, leaseholder/occupant roster, effective dates, owner-controlled additions/removals/primary contact, leaseholder invitation requests with owner approval for every new resident, and current linked leaseholder financial access. Existing primary residents are backfilled without replacing leases or money. Additional residents can be recorded without logins. Guarantor/dependent-specific models, full contact migration, separately allocated liability and recurring-term transitions remain future scope.

Acceptance:
- Distinguish responsible tenant, occupant/dependent, guarantor and emergency contact with effective dates and sharing rights.
- Begin with one shared obligation; participant count never multiplies rent. Separately billed shares are a later increment with exact-cent portions summing to the agreed total.
- Review/audit adding/removing participants. Preserve historical responsibility and prevent another household's private information appearing in statements.
- Occupant/minor records do not create login access. Participant changes never silently alter financial liability.

## Maintenance and delegation

### PF-12 · Granular team authority and property scope — P1

Audience: owner/manager/staff. Dependencies: existing access model; precedes delegated PF-13 work.

Baseline: managers have company-wide lease/finance/maintenance management but no member/company management; staff have only property.read. Team property scope/work-assignment authority is absent.

Acceptance:
- Owner grants reviewed capabilities/property scope; separate view, execution, finance and team-administration authority.
- Explicit migration/defaults preserve intended existing access. Never silently widen staff authority or unexpectedly restrict managers.
- Enforce scope in list/detail/write/search/export/tasks/documents and current-user transaction checks. Revocation invalidates stale screens/actions.
- Assignment alone cannot authorize unrelated leases, finance or private contact notes. Cover reassignment and immediate revocation.

### PF-13 · Work orders and vendor contacts — P1

Current delivery: Implemented on main: intake, work assignment/review, vendor contacts and paid-expense links; external dispatch, estimates/payables and full acceptance remain open.

Local 048 validated continuation: requester-authored replies in the existing shared maintenance timeline, with immutable `authorType` (`team`/`requester`), current requester/property/source-history authority, exact replay and fixed `maintenance.reply` management in-app notices. The server fixes the resident-visible audience; the database rejects requester-authored internal notes. Resolved follow-ups leave request status/version unchanged. Management internal/shared updates already exist and remain unchanged. Server/Prisma/client builds, safe units/all 11 client files, roadmap 34/34, maintenance 131/131 and focused browser 14/14 pass, with one overlapping 390px viewport recheck. The complete 260 browser pass remains the 047 baseline. See the [selected bounded contract](roadmap-continuation-2026-10-24.md#checkpoint-4--requester-maintenance-replies-048-locally-validated).

Audience: owner/manager, assigned authorized staff and tenant requester. Dependencies: PF-12; attachments require PF-15.

Acceptance:
- Management can create a request for an offline tenant/property. Detail route includes unit/requester/category/priority/target date/assignee/history.
- Store vendors without requiring vendor login. Define acceptance, progress, completion, manager review and reopening authority.
- Separate internal notes, tenant-visible updates and shared contact projections. Reassignment revokes prior assignment-based authority.
- Distinguish estimates/actual costs and link one existing expense source; completion never fabricates a paid expense.
- Filter property/unit/status/assignee/target date; test duplicate submissions, competing updates and authorized mobile use. Board layout can follow a working list/detail flow.

### PF-14 · Preventive work and task calendar — P2

Current delivery: Merged/deployed #55/#56: reviewed recurring requests and source-derived month calendar. Automatic generation/external sync remain outside scope; real-account acceptance is pending.

Audience: owner/manager and assigned staff. Dependencies: PF-13; lease deadlines can use PF-10 independently.

Acceptance:
- Tasks have real source/action links, dates, assignees and completion; counters derive from those records.
- Recurrence specifies timezone, next occurrence, pause/stop and missed-run recovery. Durable occurrence identity prevents duplicate work.
- Calendar/list share scope/filters and overdue definitions; manual rescheduling retains history.
- Internal calendar first; external feeds/sync require revocable scoped credentials and integration design.

## Documents and tenant service

### PF-15 · Private documents and attachments — P1 foundation

Current delivery: Merged/deployed: private PostgreSQL originals, immutable versions, ClamAV quarantine/scan, management library and source download. Local 046 adds explicit owner-granted access to a selected cleared lease-document version for an eligible leaseholder, with retained grant/revoke history, expiry and fresh recipient/source checks. The combined 34-check roadmap API suite and two focused sharing browser cases pass within the full 260-case browser run. Release/real-role acceptance, wider staff sharing, resident uploads, larger private object storage and retention operations remain future. [Current sharing contract and evidence](roadmap-continuation-2026-10-24.md).

Audience: management and explicitly authorized tenant/staff. Dependencies: reviewed private-storage scope; PF-12 delegated authority.

Acceptance:
- Private object storage, bounded upload/type validation, safe filenames and appropriate scanning/quarantine. Never use the public frontend bucket.
- Every download/share checks current company/record/participant authority and version; links expire and never establish permanent public access.
- Versioned originals, explicit sharing, access audit, retention, interrupted-upload recovery and scoped orphan cleanup.
- Cover guessed object IDs, cross-company access, revocation, stale links and unsafe content. Upload alone never shares a document.

### PF-16 · Move-in/out inspections — P2

Current delivery: This PR implements management-only structured inspections, retained evidence, reviewed completion/reopen, comparison and settlement navigation. Staff/resident participation and signatures remain future. See [contract](lease-inspections.md).

Audience: owner/manager, assigned staff and authorized tenant. Dependencies: PF-15 and unit/lease context.

Acceptance:
- Dated room/item condition, notes, evidence and reviewer identity; compare move-in/out without automatically converting differences into charges.
- Mobile draft/resume, reviewed finalization/version and correction history. Acknowledgement is distinct from provider-backed signature.
- Create reviewed maintenance/settlement references without automatic deposit deductions or duplicate expenses.

### PF-17 · Agreements and signature lifecycle — P2

Current delivery: This PR implements management-only versioned unsigned preparation, exact document/signers, source freshness and review/correction. Sending/signing/decline/expiry/webhooks/signed originals remain unimplemented. See [contract](lease-agreements.md).

Audience: management and named tenant signers. Dependencies: PF-15/PF-11 and reviewed provider scope.

Acceptance:
- Versioned document/template and recipients, prepared/sent/completed/declined/expired/voided states, retained completion evidence.
- Explicit recipient/send review; changes invalidate prior signing request while executed originals remain retained.
- Signature and operational lease activation are distinct. Authenticate/deduplicate callbacks; revoked/expired parties cannot access unrelated documents.

### PF-18 · Coherent tenant home/self-service — P1 incremental, P2 completion

Audience: tenant. Dependencies: source features as delivered; does not wait for every document/message capability.

Acceptance:
- Current home/unit/lease, due/within-grace/past-grace, payment instructions, receipts/credit/deposits and maintenance connect to exact authorized records.
- Expose only implemented actions; online payment arrives with PF-26.
- Distinguish contact edits, login-identity changes and household/lease changes. Approval requests never silently amend authority/terms.
- Mobile/accessibility/loading/retry/source-freshness behavior works for multiple leases, no current home and revoked access without stale private content.

### PF-19 · Messages, notifications and controlled reminders — P2

Current delivery: This PR implements atomic in-app source events, fixed recipients, own inbox/unread state, safe read/open replay and current source access. General conversations, scheduled reminders and external provider delivery remain future; locally validated personal preferences are recorded below. External delivery must use a separately reviewed outbox; the current synchronous in-app event transaction is not an external delivery queue. See [contract](in-app-notifications.md).

Local 048 source-event continuation validated: a resident's reply to their own maintenance request uses fixed `maintenance.reply` to notify eligible management through the retained source/inbox machinery, without arbitrary recipients, free-text notification copies or external delivery. Business replay never republishes or resets read state; disabled/read-only notifications do not block an authorized source reply. This is bounded request conversation scope; general messaging and reminder/provider work remain separate. Maintenance131/131, roadmap 34/34 and focused browser 14/14 pass, plus an overlapping mobile check; full 047 browser evidence remains separate. [Contract and scoped evidence](roadmap-continuation-2026-10-24.md#checkpoint-4--requester-maintenance-replies-048-locally-validated).

Personal in-app preferences 049 are locally validated: company + exact account scope, four default-enabled optional source areas including assigned work with a duty explanation, existing feature gates and future recipients only. Immutable events/deliveries/read state stay retained; no hide/backfill/access grant. Own versioned settings, immutable receipts/history and the separate company generation/shared publication fence retain exact current replay and save/publication ordering. Opening expectedCompanyId and all DTO company metadata are checked against current scope; a stale company A0→B0 editor cannot write new-company defaults. Both builds, 139 maintenance/preferences API checks,34 roadmap,15 billing/14 impersonation, safe units/client 11/ops 88/power guard, focused preference browser 10/10 and full frozen browser 273/273 pass. Release/real-role acceptance remain pending; no external channel or provider is added. [Contract and evidence](roadmap-continuation-2026-10-24.md#checkpoint-5--personal-in-app-notice-preferences).

Audience: management, scoped staff and tenant. Dependencies: PF-12/source events; attachments require PF-15.

Acceptance:
- Source-linked in-app threads/notifications have explicit recipients/visibility and never leak internal notes.
- Transactional outbox, durable message/event identity, retries, delivery/failure history and preferences precede external sending.
- Reminder preview, confirmed recipient, local-time schedule, stop rules and duplicate suppression. Recheck balance/access before dispatch; past-grace alone does not authorize sending.
- Email/SMS has separately reviewed provider activation. Queued is not delivered; delivery failure never rolls back financial work.

## Portfolio and commercialization

### PF-20 · Portfolio reports and historical accounting — P2

Audience: owner/authorized manager; tenant only their statement. Dependencies: PF-05/PF-06/PF-08 event history and PF-12 scope.

Local validated continuation: historical recorded cash plus same-cutoff period comparisons use immutable `LedgerEntry` amount/source, creation and void evidence, separately from business dates. Native company-timezone day boundaries include DST; current labels are explicit. Complete CSV/source totals reject oversized reports. No migration or financial posting is added. The combined 34-check roadmap API suite and two historical-cash browser cases pass within the full 260-case browser run; legacy finance regression passes 177/177. Historical lease/allocation state and broader accounting/reconciliation remain unfinished. [Contract and evidence](roadmap-continuation-2026-10-24.md).

Acceptance:
- Rent roll, deposit movements/liability, aging, occupancy, maintenance cost and property cash reports drill down to complete authorized sources.
- Label cash versus billed and current versus historical/as-of. Define effective/posted/received/reversed/generated dates with opening balances.
- Historical reports use durable events/snapshots, not mutable current status filtered by old dates. Reconcile known examples and source totals.
- Preview/reconcile opening balances/imports; bank reconciliation/period controls follow. Do not market cash net as accounting profit or tax filing.

### PF-21 · Vacancy, prospects and applications — P2

Audience: management, scoped leasing staff and applicant. Dependencies: PF-03/PF-11; private files use PF-15.

Local validated continuation: owner/manager availability and turnover board from actual units/leases plus explicit readiness/block state, versioned reasoned changes, durable retries and immutable history (migration 043). Company staff/residents/platform-only authority gain no management access. A missing lease remains unconfirmed physical readiness; a later tenancy makes an old confirmation stale. The 045 management prospect pipeline adds reviewed links to existing eligible tenant/lease records. The combined 34-check roadmap API suite, three availability and four prospect browser cases pass within the full 260-case browser run; the existing leasing integration runner passes 30/30 through 047. Public applicant/provider work and release/real-role acceptance remain separate. [Contract and evidence](roadmap-continuation-2026-10-24.md).


PF-21/PF-23 source-return loop is locally complete: closed prospect/pipeline context survives tenant/account/lease setup, saves/tabs/current/history/reauth and returns to the same source. Both builds, safe 108/eight expected skips, all 12 client files/helper 8, nav 12, lease 31, real 35/35 and full 290/290 pass; review is clear and dated fixture/import attempts remain retained. There is no schema/domain body/identity/access/conversion behavior change. [Completed contract](roadmap-continuation-2026-10-24.md#checkpoint-8--pf-21pf-23-prospect-source-return-loop-locally-validated).

The confirmed preferred-unit hint fix is complete locally: the hint already exists on setup links but LeaseCreate previously ignored it. Fresh existing lease-directory metadata with status/version offers only the exact active same-property unit, even beyond the first 50 choices. Manual edits, reviews and journal/key/payload take precedence; invalid hints offer manual recovery without unrelated fallback. Property/auth/refresh guards apply. No endpoint/schema/rent/readiness/reservation/grant/active-slot/review-policy expansion is included; source is frozen, both builds/safe server 108/eight expected skips/client 12 pass, and review is clear after retaining review through archived options and enforcing version-monotonic metadata. Focused browser 17/17 plus existing 25/25 and real leasing/API 40/40 pass, including original payload/key recovery after all units archive. The complete browser run passes 307/307 (6.1m, exit 0) on the same source; fixture diagnoses remain retained. No new migration is introduced; release/real-role acceptance remains pending. [Completed hint contract](roadmap-continuation-2026-10-24.md#checkpoint-9--preferred-unit-setup-hint-locally-validated). Timed tours remain unselected.

Read-only remaining-work audit: the existing tour stage/date-only follow-up queue is delivered; it is not a timed appointment/host workflow. The maintenance calendar and current four notification areas do not include prospects. Internal source-linked timed-tour coordination is an unselected candidate requiring timezone/DST, host/current-access, versioned reschedule/cancel/history and notification-scope decisions; no applicant messaging, new account or portal grant is implied. [Actual state and bounded candidate](roadmap-continuation-2026-10-24.md#read-only-pf-21-tourstasks-audit).
Acceptance:
- Availability distinguishes vacant/occupied/future occupancy/unavailable/turnover using lease dates plus explicit operational exceptions.
- Inquiry → tour/task → application → review decision → approved contact/lease conversion preserves source identity; retries never duplicate people/leases.
- Sensitive applicant data has narrower authority/retention than normal contact records.
- Manual applications/availability first. Listings/syndication/screening require separate consent/provider scope.
- Optional insurance/utility responsibilities become lease-linked evidence/tasks after private documents. A checkbox never implies provider verification.

### PF-22 · Company plans, usage and subscription lifecycle — P1, local

Audience: platform owner administers; company owner sees their own plan, usage and billing; manager/staff/tenant/support have no default subscription authority. Dependencies: implemented capabilities, fresh company/role/property authority and defined usage measures. The user selected monthly plans on October 24, 2026.

Local increment: configurable immutable USD monthly plan revisions, reasoned/versioned company lifecycle and expiring feature overrides, current effective feature modes, feature-area UTC request analytics and separately defined current resource aggregates. The platform company detail reuses existing profile/settings authority. Manual calendar-month SaaS invoices retain company/plan/price snapshots; actual off-platform receipts, reversals, void/reissue, complete outstanding totals and source history remain separate from tenant money. Company owners have their own plan/usage/invoice projection and suspended-company billing recovery. Fresh direct-API/transaction/background checks combine features with existing roles/property/lease scope; disabled mixed summaries omit unavailable financial projections. No plans/prices, automatic collection or production usage are invented.

Acceptance:
- Versioned plans/entitlements, trial dates, trial/active/expired/suspended/cancelled states and reasoned expiring overrides. Manual grants work before payment collection.
- Define one billing-customer boundary, initially company. Do not charge each person with an owner role. Specify whether drafts/ended leases/archived records count.
- Company owner sees actual usage/next transition; platform sees lifecycle/usage/override audit without automatic access to tenant financial records.
- Server enforcement covers resource creation/background work and combines entitlements with role/property authority.
- Downgrade-over-limit never deletes operating history. Expiry/cancellation, company suspension and deletion are distinct with a reviewed retention/export policy.
- Explicitly decide effects on recurring posting, tenant access and notifications. Never silently keep money collection running behind an inaccessible owner workspace.
- Cover date boundaries/timezones, overrides, concurrent limit use and platform revocation. Monthly prices are configured explicitly; automatic collection, metered charging and quotas remain separate scope.

Delivery state: implemented and validated locally; review/release and real-company acceptance remain pending. Both builds and the subsequent server TypeScript check pass. Safe server units report 94 passes and seven intended database-suite skips (101 total); all 11 client unit test files pass. Dedicated billing checks pass 15/15 through fresh migration 042 with the restricted runtime role, and impersonation regression passes 14/14. All six focused browser scenarios pass, including draft/retry/correction, private print scope, mobile usage/invoices, stale-charge review and disabled-feature projections. Two review findings were corrected and narrowly re-reviewed without residual findings. First-issue review shows exact price/recipient and fences both subscription/company versions; a committed original payload stays replayable after source changes. Additive migration 042 follows 041 and introduces metadata, daily counters and separate SaaS billing/history tables with immutable runtime grants. It adds no provider configuration, environment variable, cloud resource or always-on job. Next complete workflow: review/release and real-company plan assignment → access/usage → monthly invoice → receipt/correction → company-owned history and recovery. Taxes, proration, quotas, automated renewal/invoice generation, self-service plan changes and provider collection remain outstanding. No merged, deployed or accepted status is claimed. [Workflow, measures, runbook and evidence](company-subscriptions.md).

### PF-23 · UI/UX acceptance in every increment — P1 continuous

Tenant leasing controls/form recovery/privacy are locally validated: strengthened real users 56/56, final client build/client 13 (six API header/uncertainty checks), independent review and final browser 320/320 (5.4m, exit 0) pass. Authoritative denials hide private UI immediately; pinned fresh CREATE/PATCH reads restore only permitted access, retaining exact journals. Read-only/CSRF/impersonation-read-only, administrative access-removal/reset exemptions, support actual-role views and saved-account Continue remain intact. Compact comparison/explicit duplicate consent preserve UUID/company/core details; create receipts and PATCH explicit no-write Use current remain distinct. The first 319 verification-fixture failure and corrected 10-repeat/11-affected history are retained. Unrelated feature development is paused; authorized PR #60 consolidation is in progress, and all combined port/check/review evidence remains pending in the [inventory](PR60-integration-review-2026-10-24.md), without merge/deploy/live migration or provider activation. Provider create/rename before final DB gating retains its existing external-consistency limit. [Completed contract and validation](roadmap-continuation-2026-10-24.md#checkpoint-11--tenant-leasing-write-controls-and-form-recovery-locally-validated).

Acceptance:
- Directory → exact detail → action → confirmation → return works for each source; copied URLs/browser back preserve meaningful context/filters.
- Reuse navigation/dialogs; full pages for connected records, dialogs for focused edits. One clear primary action; discard/destructive actions are explicit and secondary.
- Names/readable references identify records; plain labels explain financial states. Internal ID is never the only identifier.
- Draft/review recovery rechecks authority/conflicts. Background refresh never replaces an edited form or silently confirms changed money/access terms.
- Keyboard focus, labels/error association, contrast and supported mobile layouts work. Essential actions never rely on hover/color alone.
- Empty states offer real next steps; success links to saved records; retry is safe; denied/missing routes remain safe.

### PF-24 · Capacity and responsiveness — P1 continuous

Local 050 is consolidated: both builds, 147/147 API cases with 100 identical timestamps, corrected 282/282 browser cases, finance 177/177, roadmap 34/34, safe 108/eight expected database skips, client 11, ops 88/power guard and final 270/270 quiet paged samples pass. Exact count/privacy/deep+reverse/source invariants and zero idle transactions are recorded on the finished fingerprints. Original real/API/browser failures, pre-range artifacts and the native BitmapOr harness-assertion diagnosis remain retained, not replaced. Complete counts/search scans and all-same-time filtering remain costs; description-search p95 is1,005.44ms locally. This is no universal/constant-work/production-capacity/SLO or live acceptance claim.

Tenant directory/independent rental history is locally validated: exact aliases/roles/effective dates, complete filtered totals/global properties, bounded three-rental previews/50-row history/hash cursors and unchanged legacy/write/invitation/financial/picker caps. Current refined server build/safe 109+eight skips/SQL 7/finance 192 and unchanged client build/client 13/browser 320 pass. Final refined matrix passes 511/511 reads/24 scenarios/2,001 people with source/privacy/count/fingerprint/cleanup invariants. At 2k, default is 262.10 ms median/43,003 bytes versus first paged 684.11 ms; former 224.49 versus 1,963.93 ms. The old eager all-record API remains faster at 144.03 ms and larger at 1,535,493 bytes, with different populations. Portal-pending loops/repeated graphs/previews/global metadata remain costs; timed history grain<=3 is separate from the functional 1,001-lease API cap proof. No universal speed/constant-work/deployed SLO/live acceptance is claimed. Preserve the protected baseline, first regression, both diagnostics and original fixture findings. [Final evidence and tradeoffs](roadmap-continuation-2026-10-24.md#checkpoint-10--pf-24-tenant-directory-and-rental-history-locally-validated).

Acceptance:
- Measure authenticated latency/query count/response size and browser time on agreed portfolio sizes. Record a baseline/target before claiming improvement.
- Cursor pagination/server search for growing lists; aggregates/exports cover complete filters independently of displayed pages.
- Investigate duplicate context requests/refresh loads before caching. Cache keys/invalidation include identity, company and authority; revocation clears access.
- Large jobs need progress/recovery/private results; never silently truncate money totals.
- Use existing Grafana signals. Alert/contact activation remains a separate operating step; features require no monitoring vendor/hosting migration.
- Keep required CI/database/browser checks. Optimize measured overhead while preserving money/retry/audit/authority coverage.

### PF-25 · Imports, reconciliation and integration contracts — P2/P3

Audience: owner/authorized manager; scoped platform provider configuration. Dependencies: stable source/event identities and PF-15 for private import files.

Local validated continuation: reviewed unit-inventory CSV imports are bounded to 500 rows/256 KiB and use actual property IDs plus existing unit validation. Complete per-row preview, immutable source/fingerprint, property-version/duplicate revalidation, atomic commit/cancel, durable replay and result/source history use migration 044. Paid operating-expense imports 047 retain stable company/source-namespace/source-ID uniqueness, exact original cash linkage and explicit paid/not-previously-recorded review before atomic commit. Voiding an expense never permits reposting its retained source ID; malformed Unicode IDs are rejected before storage. The combined 34-check roadmap API suite, two unit-import and three expense-import browser cases pass within the complete 260-case browser run; legacy finance regression passes 177/177. Account/contact/lease identities, opening balances, other tenant-money imports and broader reconciliation remain separate work. [Contract and evidence](roadmap-continuation-2026-10-24.md).

Acceptance:
- Import preview, validation, property/unit/contact mapping, source identity, opening-balance meaning, commit summary and reconciliation. Retry never duplicates money.
- CSV/export/internal reconciliation first. External accounting declares consent/scopes, category mapping, sync direction and local/remote ownership.
- Preserve remote IDs and expose errors/retries; deduplicate out-of-order sync and reconcile corrections/deletions/disconnection. No inactive “connected” switches.
- Calendar tokens are scoped/revocable with minimum data. Bank feeds and screening each need separate activation decisions.

### PF-26 · Payment providers, last — P3

Audience: platform/company owner for subscriptions; company owner/finance manager/tenant for rent. Dependencies: PF-22 subscriptions; PF-05/PF-06/PF-20/PF-25 tenant money.

Acceptance:
- Separate SaaS subscription collection and tenant rent/deposit collection. Never mix company subscription debt with lease debt or bank balances.
- Hosted methods/onboarding, consent, fees, payout/settlement states, partial payment, refunds and disputes modeled before activation.
- Signed deduplicated webhooks, out-of-order replay, failed/returned payments, allocation reversal and bank/provider reconciliation. Submitted is not settled.
- Owner/tenant see actual fees/status; charge recurrence is separate from consent to automatic payment collection.
- Sandbox acceptance/reconciliation and reviewed production activation precede real collection. This backlog authorizes no provider account or payment action.

### PF-27 · Monitoring, recovery and release operations — P1, partial

Audience: platform operator and product team. Dependencies: the app's real workflows and separately reviewed infrastructure/provider activation.

Current evidence and remaining work: [monitoring coverage register](monitoring-coverage.md). Backend metrics/logs/traces, the 21-panel dashboard, enabled rules and tested email routing exist. RUM source is locally verified; real deployed sessions, AWS scrape jobs and full recovery acceptance remain open.

Acceptance:
- Each operating layer has a verified signal, useful scoped view, actionable threshold/runbook and an owner; distinguish application, dependency and telemetry failures.
- Verify real-session Web Vitals, sanitized views/errors/API timings and browser → API → PostgreSQL correlation. No identity, private form/financial/contact values, tokens, SQL/binds or implicit replay.
- Add reviewed infrastructure/synthetic/runtime/backup coverage in bounded increments. Explicitly verify failure and recovery; a configured integration or retained snapshot alone is insufficient evidence.
- Track ingestion/cardinality/retention and current allowance/cost. Do not enable paid streams, high-volume logs or credentials/providers merely to populate empty dashboards.
- Release checks cover safe additive migration, verified restore point, immutable release identity and post-release role/workflow acceptance. User authorization governs deployment and cloud changes.

### PF-29 · Support impersonation — P1, local

Audience: platform owners and explicitly authorized support accounts. Company staff authority alone grants no impersonation access. Sources/dependencies: existing Auth0-backed application accounts, current company membership, staff property grants, resident/lease participation, cookie/CSRF sessions, immutable audit history and additive migration 041. [Workflow and runbook](support-impersonation.md).

Acceptance:
- A platform owner grants/revokes support access to an existing active, verified sign-in account through a versioned review. Support authority permits impersonation only; it grants no platform company/user administration or support delegation.
- Search and page actual active, verified company members by person/company and role. Select a real company owner, manager, staff member or resident, enter a brief reason and start a read-only session. Platform accounts cannot be targets; nested impersonation is denied.
- Navigation and API access use the target's current company, role, selected-property scope and resident/lease participation. Forged company/record IDs remain denied. Support authority never merges with target grants.
- Show the selected user, role/company, expiry and a persistent return control. Centrally reject business mutations while viewing; telemetry, explicit exit and logout remain available. Testing write success requires a separately authorized test-account workflow.
- Retain the original signed-in actor. Start/stop, support grants/revocations and document-download history identify the real actor and relevant target; reasons stay out of telemetry. Changes commit atomically with their audit events.
- End access after 30 minutes or an earlier session deadline. Fresh actor/target status and authority checks, pinned company/membership version and stale-tab request context prevent silent identity/scope changes. Expired/revoked/unavailable views retain the exit banner; support regrant cannot revive an expired view.
- Failed or ambiguous starts/stops offer reload/recovery without silently claiming completion. Identity transitions reload the workspace, clearing prior mounted data and unsubmitted drafts. Concurrent requests produce one transition and consistent history.
- Validate support delegation boundaries, actual role/company/property/resident access, business-write denial, CSRF, expiry/revocation/access changes, stale tabs, concurrent transitions and audit attribution in disposable tests and browser fixtures. Complete real-account/mobile/keyboard acceptance after authorized release.

Delivery state: implemented and validated locally; review/release and real-account acceptance remain pending. Both builds, all 10 client unit test files, safe server suites across the combined verification runs and 14 dedicated disposable integration checks pass. Fresh migrations, restricted runtime/RLS and non-ASCII identity context headers are covered; the dedicated runner is wired into CI. Three focused browser checks pass for grant/start/stop and retry, support administration denial, mobile layout, walkthrough suppression and cross-tab reload. No new runtime variable, Auth0 configuration or cloud resource is required. Migration 041 extends session context and widens the existing platform-role constraint to owner/support/null. Matching migration/API/client release remains pending; no deployed/user-accepted claim is made.

## Definition of ready for the next PR

Select one bounded slice; document the user outcome, existing sources, additive schema/API changes, role/property rules, monetary/event contract, meaningful regressions and acceptance. Update backlog/handoff with evidence as work lands. Keep merged, deployed and accepted states separate. The user approves merges and deploys manually; passing tests do not grant that approval.
