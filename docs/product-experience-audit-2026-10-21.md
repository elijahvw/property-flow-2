# Property Flow product experience audit — October 21, 2026

This review starts from merged source `75d5342` (PR59). It reviews product contracts, route/navigation code, core directories, tenant and lease details, rent, cash activity, statements, resident home, assigned work, Help, forms and existing operational acceptance. Findings describe the source before the October 21 improvements unless explicitly updated by their implementation notes. It does not establish deployment, current provider configuration or real-account acceptance.

The product already has substantial connected operating records, exact-cent money, reviewed changes, history and scoped authority. The immediate product priority is to make those capabilities understandable and dependable in daily work. An additional menu item or a cosmetic refresh alone does not complete that work.

## Public comparison and design evidence

Reviewed public documentation only; no competitor account, trial or private customer screen was accessed. Product pages establish advertised capabilities and documented flows, not comparative performance, usability scores or complete feature parity. Recommendations below are our interpretation of these sources applied to Property Flow.

| Source | Relevant observed pattern | Application to Property Flow |
| --- | --- | --- |
| [AppFolio resident portal help](https://www.appfolio.com/help/online-portal) | Home exposes the amount owed and charge detail; payment review distinguishes submission from bank clearance. Maintenance and documents are resident tasks. | Make the resident's next job and exact source visible from home. Continue to describe current recorded payments honestly; online collection remains PF-26. |
| [Buildium Resident Center](https://www.buildium.com/features/resident-center/) | Organizes payments, repair requests, documents and communication together, with repair status and appointment coordination. | Treat the resident portal as a service workspace with connected state. Do not present private management originals as resident-shared documents. |
| [TenantCloud tenant profile help](https://support.tenantcloud.com/en/articles/11956582-how-do-i-view-a-tenant-profile) | A permanent person profile connects leases, transactions and requests, with actions near relevant financial state. | Keep tenant detail as a durable hub. Show corrections and deposits at their real sources rather than encouraging duplicate cash entries. Competitor deletion semantics are not a pattern to copy. |
| [DoorLoop tenant search/filter help](https://support.doorloop.com/en/articles/6187715-find-sort-and-filter-your-tenants) | The directory exposes name search and meaningful property/status/date filters, including past and future tenancies. | Make scope and active filters explicit before the result list. Explain why a former or upcoming tenant is absent. Search index and direct navigation must respect current access. The full document was available through indexed search; the direct fetch returned 404 during this review. |
| [Nielsen Norman Group: filter behavior](https://www.nngroup.com/articles/applying-filters/) | Repeated refresh, changed scroll position and interrupted selections disrupt filtering; timing should fit response speed and user intent. | Keep the search controls stable while results update. Use bounded loading feedback and preserve keyboard focus. Filters and results may share a page while remaining distinct regions. |
| [Nielsen Norman Group: modal and nonmodal dialogs](https://www.nngroup.com/articles/modal-nonmodal-dialog/) | Modals obscure context and interrupt work. Short consequential actions can justify them; work with several steps can justify a full page. | Keep focused confirmations and short edits in dialogs. Give long lease, renewal or settlement work a page with visible progress and durable recovery. Do not move every form into a popover. |
| [W3C WAI: multi-page forms](https://www.w3.org/WAI/tutorials/forms/multi-page/) | Logical stages and progress orientation help users complete long forms. | Use named sections, a stable heading and explicit previous/next/review actions when a task needs stages. Restore values when returning to a completed stage. |
| [W3C WAI: form validation](https://www.w3.org/WAI/tutorials/forms/validation/) and [labels/instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions) | Visible required-field identification and clear error feedback help users avoid and correct mistakes. | Every required input needs understandable visible guidance, associated labels and preserved values. Put errors near their fields and provide an actionable summary when several fail. |

These are product patterns, not grounds to activate payments, signatures, external messages, bank feeds or broader permissions in this batch.

## Findings and acceptance

Severity describes user impact and implementation priority. “Confirmed” means the stated source behavior was inspected; “acceptance gap” means current evidence does not prove the whole journey. Backend/security findings and form implementation details are tracked in their separate October 21 audit notes.

### UX01 — Search controls and result state need a clearer boundary (high; confirmed)

Evidence: `client/src/components/PropertySearch.tsx`, `client/src/pages/Workspace.tsx` Properties, and directory/filter structures in `Rent.tsx`, `ResidentProfiles.tsx` and `WorkOrders.tsx`. The original property finder fetches the property collection, shows the first 20 matches immediately, and combines query, list and limit explanation in the shared editor dialog. Directories also mix filtering controls with record content in the same panel.

The global finder is a shortcut to a property; a directory is a workspace for searching, comparing and acting on records. Give each a clear purpose. A finder should identify its scope, focus the search field, show a separate result region and provide a path to the full directory. A directory should have a stable search/filter region, followed by a named results region with count, applied scope and empty/error states. A separate route for every search is unnecessary.

Acceptance: search by name/address; understand what is searched; distinguish no records from no matches; clear filters; open an exact record; return with scope; keyboard and mobile work; results never silently imply that a capped list is complete. Changing filters must not move focus to the page header or interrupt typing.

### UX02 — Navigation needs predictable context and transitions (high; confirmed)

Evidence: shell route resolution and focus behavior in `client/src/App.tsx`; `PropertyNavigation.tsx`; `LeaseDetail.tsx`; `WorkOrders.tsx` AssignedWorkDetail. The original shell derives labels from a mixture of exact routes and path prefixes; property-scoped modules resolve differently from their company counterparts. Property navigation offers nine sections and the lease workspace ten. Assigned work returns to an unfiltered list through a fixed link.

Use one route description for each destination, a consistent current-location trail and exactly one current navigation item per scope. Distinguish company-wide lists from the selected property/lease. Keep search/filter updates within the same task stable. When a user opens a source, return to its originating list and filters. Page navigation should have deliberate focus/scroll behavior; query edits should retain control focus.

Acceptance: copied URLs, reload, Back/Forward and return links identify the same record and scope; mobile context remains visible; property and lease section menus are usable without horizontal discovery; notification/document/calendar entry points retain their origin. Group the occasional lease tasks by purpose rather than deleting delivered capabilities.

### UX03 — “Rent ledger” is valid accounting language but a poor universal task label (high; confirmed)

Evidence: `navigation.ts`, `PropertyNavigation.tsx`, `Rent.tsx`, `ResidentDetail.tsx`, `Statement.tsx`, `Finances.tsx`, `help-content.ts`. Current labels include “Rent & balances”, “My rent”, “Rent ledger”, “View rent & payments” and “lease ledger”. Users must infer which names refer to the same destination.

Use **Rent & payments** for the operating destination. Within a named lease, use **Account history** for posted charges, recorded payments and adjustments, and **Statement** for the dated review/export. Keep **Security deposits** separate. **Cash activity** means recorded money received/paid across sources; it is not a rent balance or a bank balance.

Acceptance: navigation, headings, links, accessible labels and Help use the same vocabulary; resident actions remain view-only for finances; “Record payment” is management entry of money actually received; nothing says “Pay rent” while online collection is unavailable. Rename presentation without changing source/event types or accounting semantics.

### UX04 — Forms need a task-based presentation policy (high; confirmed / acceptance gap)

Evidence: `EditorDialog.tsx`, `Form.tsx`, `Leasing.tsx`, `TenantForm.tsx`, `LeaseDetail.tsx` and `LeaseSettlement.tsx`. The shared dialog already protects dirty edits, retained page drafts, busy submissions and uncertain outcomes; preserve those protections. Most editors still share one modal presentation regardless of task length. A saved draft is currently page-local and explicitly clears on navigation/refresh, which is not durable task recovery.

Keep dialogs for a short focused change or consequential confirmation with enough visible record context. Use a dedicated page for complex lease creation, renewal, household review or settlement when users need several stages or source comparison. Use inline edits only where the change can be understood and validated in place. Avoid nested dialogs. Requiredness, error location, saved outcome and the difference between a draft and a completed business action must be explicit.

Acceptance: the user can review prerequisites, complete the task, recover from validation/network/version errors and understand resulting state. An uncertain financial submission keeps its original key and cannot become a fresh duplicate. Durable drafts require a separate scoped design with expiry, access revalidation and privacy; do not imply page-local memory meets that contract.

### UX05 — Resident home should show useful rental state (high; confirmed)

Evidence: `Workspace.tsx` Resident currently loads `/api/resident/properties`, lists property name/address and presents service links. Lease/financial details exist on other pages. Home does not itself show the current unit/lease, a next task, last request update or an amount due. Help tells residents to check lease information there, exceeding what the home currently presents.

PF-18 should join authorized rental state, not merely repeat navigation. Start with exact property/unit and lease participation, then role-appropriate next actions. Approved leaseholders may see reconciled amount due, due date and a statement link. Occupants must not receive money totals, including through counts or loading responses. Show source-backed request status and relevant invitation/approval state. Avoid invented payment buttons or zero balances when a dependency fails.

Acceptance: upcoming/current/ended/multiple leases, leaseholder/occupant, no property assignment and access revocation each explain the user's state; no private management notes or originals leak; failure of a balance source does not remove working maintenance/profile services. Complete the journey from a real invitation and actual sign-in separately.

### UX06 — Machine events need human labels (medium; confirmed)

Evidence: `ContactDetail.tsx` Recent activity renders `e.action.replace(/\./g, " ")`. Other views use explicit action labels. Replacing separators can expose internal naming and awkward grammar instead of a clear description.

Use the existing audit label conventions and readable event names. Identify who did what and when where the authorized source supplies it. Expand technical identifiers only on request; retain immutable source IDs for traceability.

Acceptance: each displayed event has a useful label; unknown events have a neutral fallback; no raw exception or provider identifier becomes user prose. Do not alter stored audit values.

### UX07 — Separate delivered capabilities from unfinished resident service (high; acceptance gap)

Evidence: `help-content.ts`, `docs/private-documents.md`, `docs/lease-inspections.md`, `docs/lease-agreements.md`, `docs/in-app-notifications.md`, `docs/monitoring-coverage.md`. Management-only originals, unsigned agreement review and in-app notices are real delivered foundations. Resident sharing/acknowledgement, electronic signatures, resident-authored maintenance replies and external reminders are separate unfinished workflows.

Do not label an unsigned package “signed”, a read state “acknowledged”, an accepted email send “delivered”, a recorded payment “settled” or a reviewed inspection “resident approved”. Public comparisons make these gaps useful roadmap priorities but do not justify placeholder actions.

Acceptance: source/detail/history and correction paths work for each stated role; external status claims come from provider evidence; unavailable functionality is described when relevant to the task, without inactive navigation or switches.

### UX08 — Current planning records need reconciliation (high; confirmed)

Evidence: the pre-audit README/roadmap/status describe PR59 as unmerged while `git log` shows merge `75d5342`. `product-backlog.md` PF-03 still promises offline tenant creation without a sign-in account, conflicting with the current unified-account contract and `AGENTS.md`.

Reconcile the current merged source and future acceptance. An existing/precreated Auth0 account precedes new tenancy participation; portal approval, activation and first sign-in remain distinct. Preserve historical checkpoints as dated evidence rather than current instructions. Merged source alone establishes neither deployment nor customer acceptance.

Acceptance: README, feature register, detailed acceptance and release notes agree on current source and constraints. Existing PF IDs and completed capabilities remain intact.

## Complete operating journeys to accept

| Job | Connected journey | Required role/state checks |
| --- | --- | --- |
| Set up a tenancy | Property → unit → existing/precreated person account → tenant → lease/household review → owner approval → optional portal invitation → billing/deposit setup → resulting lease | Owner/manager boundaries; no first-sign-in prerequisite; account does not itself grant access; conflicting current lease; existing tenancy; no duplicate source records. |
| Record and explain rent | Exact lease → reviewed charge/schedule → record actual receipt → allocate → amount due/credit → statement → correction/source history | Owner/manager entry; authorized leaseholder read; occupant denial; partial/overpayment, deposit application, concurrent retry and month/due/grace boundaries. |
| Repair a home | Resident or management request → target/priority → staff assignment or vendor link → progress/shared update → reviewed completion → actual paid-cost link | Current property scope/assignment; private vs shared notes; staff no finance/documents; reopen; resident status; no duplicate expense or unsupported delivery claim. |
| Renew or end a tenancy | Existing lease → reviewed future terms/renewal → household approval → inspection evidence → settlement → actual application/refund/end follow-up → retained history | Existing debt survives; deposit is distinct from income; reviewed originals remain private until explicit sharing; new lease approval is deliberate. |
| Find and return | Named search scope → filters/results → exact tenant/property/lease/source → related record → original results | Back/Forward/reload, applied filters, no-match/empty/error, cross-company denied record, keyboard/mobile and slow responses. |
| Use resident services | Invitation → existing account setup/sign-in → approved rental state → rent/statement or occupant view → repair request/update → permitted profile edit | New/existing/wrong/expired/replaced account paths; no financial or document escalation; self-edit never changes role, home or lease. |

Each journey needs actual resulting state and audit/source evidence, not simply successful navigation. Browser fixtures demonstrate local behavior; provider delivery and deployed-role acceptance require their own evidence.

## Roadmap refinement using existing PF IDs

1. **Close experience and correctness defects first — PF-23, PF-24, PF-01/02/03/18.** Implement the October 21 search, shell, forms and language improvements; reconcile status/acceptance; finish source-return context and resident home. Use the existing workflow acceptance checklist for current role journeys. Add focused regression cases for discovered bugs.
2. **Complete release/operational gates — PF-27.** Validate the merged migrations and rollback/recovery plan against disposable data. Confirm real role/provider journeys, downloaded file/export receipt, browser telemetry, backup restore and incident response. Current alert state and historical successful deployment are insufficient evidence of production readiness.
3. **Finish everyday resident collaboration — PF-15/16/19 and PF-13.** Define explicit document sharing and acknowledgement, safe resident evidence uploads and request replies; define ownership, consent, moderation/private-note boundaries and retention before implementation. Add scheduled reminders only with real delivery state, preferences, retry/duplicate protection and support visibility.
4. **Make migration into the product and reports trustworthy — PF-25 and PF-20.** Deliver CSV mapping/preview/reconciliation with durable source identity and reviewed opening balances; then define historical as-of reports and complete portfolio comparisons. No bank-reconciliation claim without a reconciled bank-source workflow.
5. **Complete the rental lifecycle — PF-21 and PF-17.** Availability → prospect → application → reviewed approval → existing person/lease conversion; then electronic signatures with explicit provider status, authenticated deduplicated webhooks and retained signed originals. Define actual availability independently from absence of an active lease.
6. **Expand authority/commercial operations deliberately — PF-12/22.** Add narrow useful capability delegations and implemented server-enforced plan entitlements. Broader permissions, investor/trust accounting and multi-company identity are separate designs, not incidental UI additions.
7. **Add provider collection last — PF-26.** Rent/deposit collection and platform subscriptions remain separate contracts, with consent, fees, failures, refunds, disputes, settlement and reconciliation. Preserve manual operation without connectivity.

No genuinely new epic is necessary for the experience audit: the work refines existing PF-23/PF-24 and the relevant operating feature IDs. AI features, native apps, marketplaces and additional dashboards should wait for observed customer work that they improve.

## Production acceptance evidence

The production gate is a verified release with completed applicable jobs, not a broad “production-grade” label. Record the exact release, migration outcome, real-role results, data/export/download receipt, performance at representative portfolio size, restoration evidence and monitoring/incident ownership. Track blocked or unverified items explicitly. This document supplies research and source findings; the parent audit's validation notes record checks actually executed for the October 21 implementation.
