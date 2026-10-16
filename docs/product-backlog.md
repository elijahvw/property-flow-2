# Property Flow implementation backlog

Reviewed 2026-10-15 against main `e94fe86`. PF IDs are local planning IDs, not GitHub issue numbers. No open GitHub issues were returned during this review; the existing [roadmap](product-roadmap.md) is the planning source. Every item below is **proposed / not implemented** unless its baseline explicitly identifies existing functionality. [Research](tenantcloud-workflows.md) distinguishes public product evidence from our recommendations.

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

Audience: owner/manager, assigned authorized staff and tenant requester. Dependencies: PF-12; attachments require PF-15.

Acceptance:
- Management can create a request for an offline tenant/property. Detail route includes unit/requester/category/priority/target date/assignee/history.
- Store vendors without requiring vendor login. Define acceptance, progress, completion, manager review and reopening authority.
- Separate internal notes, tenant-visible updates and shared contact projections. Reassignment revokes prior assignment-based authority.
- Distinguish estimates/actual costs and link one existing expense source; completion never fabricates a paid expense.
- Filter property/unit/status/assignee/target date; test duplicate submissions, competing updates and authorized mobile use. Board layout can follow a working list/detail flow.

### PF-14 · Preventive work and task calendar — P2

Audience: owner/manager and assigned staff. Dependencies: PF-13; lease deadlines can use PF-10 independently.

Acceptance:
- Tasks have real source/action links, dates, assignees and completion; counters derive from those records.
- Recurrence specifies timezone, next occurrence, pause/stop and missed-run recovery. Durable occurrence identity prevents duplicate work.
- Calendar/list share scope/filters and overdue definitions; manual rescheduling retains history.
- Internal calendar first; external feeds/sync require revocable scoped credentials and integration design.

## Documents and tenant service

### PF-15 · Private documents and attachments — P1 foundation

Audience: management and explicitly authorized tenant/staff. Dependencies: reviewed private-storage scope; PF-12 delegated authority.

Acceptance:
- Private object storage, bounded upload/type validation, safe filenames and appropriate scanning/quarantine. Never use the public frontend bucket.
- Every download/share checks current company/record/participant authority and version; links expire and never establish permanent public access.
- Versioned originals, explicit sharing, access audit, retention, interrupted-upload recovery and scoped orphan cleanup.
- Cover guessed object IDs, cross-company access, revocation, stale links and unsafe content. Upload alone never shares a document.

### PF-16 · Move-in/out inspections — P2

Audience: owner/manager, assigned staff and authorized tenant. Dependencies: PF-15 and unit/lease context.

Acceptance:
- Dated room/item condition, notes, evidence and reviewer identity; compare move-in/out without automatically converting differences into charges.
- Mobile draft/resume, reviewed finalization/version and correction history. Acknowledgement is distinct from provider-backed signature.
- Create reviewed maintenance/settlement references without automatic deposit deductions or duplicate expenses.

### PF-17 · Agreements and signature lifecycle — P2

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

Audience: management, scoped staff and tenant. Dependencies: PF-12/source events; attachments require PF-15.

Acceptance:
- Source-linked in-app threads/notifications have explicit recipients/visibility and never leak internal notes.
- Transactional outbox, durable message/event identity, retries, delivery/failure history and preferences precede external sending.
- Reminder preview, confirmed recipient, local-time schedule, stop rules and duplicate suppression. Recheck balance/access before dispatch; past-grace alone does not authorize sending.
- Email/SMS has separately reviewed provider activation. Queued is not delivered; delivery failure never rolls back financial work.

## Portfolio and commercialization

### PF-20 · Portfolio reports and historical accounting — P2

Audience: owner/authorized manager; tenant only their statement. Dependencies: PF-05/PF-06/PF-08 event history and PF-12 scope.

Acceptance:
- Rent roll, deposit movements/liability, aging, occupancy, maintenance cost and property cash reports drill down to complete authorized sources.
- Label cash versus billed and current versus historical/as-of. Define effective/posted/received/reversed/generated dates with opening balances.
- Historical reports use durable events/snapshots, not mutable current status filtered by old dates. Reconcile known examples and source totals.
- Preview/reconcile opening balances/imports; bank reconciliation/period controls follow. Do not market cash net as accounting profit or tax filing.

### PF-21 · Vacancy, prospects and applications — P2

Audience: management, scoped leasing staff and applicant. Dependencies: PF-03/PF-11; private files use PF-15.

Acceptance:
- Availability distinguishes vacant/occupied/future occupancy/unavailable/turnover using lease dates plus explicit operational exceptions.
- Inquiry → tour/task → application → review decision → approved contact/lease conversion preserves source identity; retries never duplicate people/leases.
- Sensitive applicant data has narrower authority/retention than normal contact records.
- Manual applications/availability first. Listings/syndication/screening require separate consent/provider scope.
- Optional insurance/utility responsibilities become lease-linked evidence/tasks after private documents. A checkbox never implies provider verification.

### PF-22 · Company plans, usage and subscription lifecycle — P3

Audience: platform owner administers; company owner sees/manages their plan; manager/staff/tenant have no default subscription authority. Dependencies: implemented capabilities and defined usage measures.

Acceptance:
- Versioned plans/entitlements, trial dates, trial/active/expired/suspended/cancelled states and reasoned expiring overrides. Manual grants work before payment collection.
- Define one billing-customer boundary, initially company. Do not charge each person with an owner role. Specify whether drafts/ended leases/archived records count.
- Company owner sees actual usage/next transition; platform sees lifecycle/usage/override audit without automatic access to tenant financial records.
- Server enforcement covers resource creation/background work and combines entitlements with role/property authority.
- Downgrade-over-limit never deletes operating history. Expiry/cancellation, company suspension and deletion are distinct with a reviewed retention/export policy.
- Explicitly decide effects on recurring posting, tenant access and notifications. Never silently keep money collection running behind an inaccessible owner workspace.
- Cover date boundaries/timezones, overrides, concurrent limit use and platform revocation. Prices/charge automation remain undecided.

### PF-23 · UI/UX acceptance in every increment — P1 continuous

Acceptance:
- Directory → exact detail → action → confirmation → return works for each source; copied URLs/browser back preserve meaningful context/filters.
- Reuse navigation/dialogs; full pages for connected records, dialogs for focused edits. One clear primary action; discard/destructive actions are explicit and secondary.
- Names/readable references identify records; plain labels explain financial states. Internal ID is never the only identifier.
- Draft/review recovery rechecks authority/conflicts. Background refresh never replaces an edited form or silently confirms changed money/access terms.
- Keyboard focus, labels/error association, contrast and supported mobile layouts work. Essential actions never rely on hover/color alone.
- Empty states offer real next steps; success links to saved records; retry is safe; denied/missing routes remain safe.

### PF-24 · Capacity and responsiveness — P1 continuous

Baseline: resident/maintenance directories fetch all matches; financial/report aggregates have explicit completeness bounds. Shared property context may load through multiple components; no performance gain has been measured here.

Acceptance:
- Measure authenticated latency/query count/response size and browser time on agreed portfolio sizes. Record a baseline/target before claiming improvement.
- Cursor pagination/server search for growing lists; aggregates/exports cover complete filters independently of displayed pages.
- Investigate duplicate context requests/refresh loads before caching. Cache keys/invalidation include identity, company and authority; revocation clears access.
- Large jobs need progress/recovery/private results; never silently truncate money totals.
- Use existing Grafana signals. Alert/contact activation remains a separate operating step; features require no monitoring vendor/hosting migration.
- Keep required CI/database/browser checks. Optimize measured overhead while preserving money/retry/audit/authority coverage.

### PF-25 · Imports, reconciliation and integration contracts — P2/P3

Audience: owner/authorized manager; scoped platform provider configuration. Dependencies: stable source/event identities and PF-15 for private import files.

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

## Definition of ready for the next PR

Select one bounded slice; document the user outcome, existing sources, additive schema/API changes, role/property rules, monetary/event contract, meaningful regressions and acceptance. Update backlog/handoff with evidence as work lands. Keep merged, deployed and accepted states separate. The user approves merges and deploys manually; passing tests do not grant that approval.
