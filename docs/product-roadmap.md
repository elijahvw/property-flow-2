# Property Flow product roadmap and feature register

Updated October 18, 2026. Release baseline: `e452bea` (PR #46 merged). This is the running list of product and operating capabilities, their remaining scope and the next complete user jobs. [Jira development overview](https://property-flow-dev.atlassian.net/browse/PF-43) · [Tracking workflow and issue map](jira-work-tracking.md) · [Detailed acceptance backlog](product-backlog.md) · [Monitoring coverage](monitoring-coverage.md) · [Release and preview evidence](dev-release-performance.md).

## Product direction

Make daily property management easier through connected records, rich operational detail and dependable actions. Owners manage their portfolios; managers coordinate work; staff act only within granted authority; residents receive useful self-service. Platform administration stays separate from customer operating access.

Build complete workflows from real sources: property → unit → tenant/household → lease → balances/deposits → maintenance → evidence/history. Show the right next action from actual state, preserve context across detail links, and make corrections/recovery explicit. Rich data means useful source drilldowns, accurate complete totals and trustworthy history, not crowded screens or fabricated counters.

Keep the UI clean: readable labels and dates, grouped forms, focused reviews, accessible mobile/keyboard use and progressive detail. Do not add decorative dashboards, empty navigation, nonfunctional controls, unsupported integrations or dummy features. Clearly labeled fictional preview fixtures never establish production readiness.

Stripe subscriptions and tenant collection remain last. Custom-domain setup for `propertyflow.saasapps.cloud` is in progress: versioned Terraform/deployment configuration is prepared, including the public URL when apply is skipped. DNS, certificate issuance, CloudFront/Auth0 setup, the Grafana collector's exact allowed origin and live acceptance remain manual. See [domain setup](custom-domain.md). No plan names, prices, provider activations, delivery dates or parity percentages are established here.

## Status and maintenance rules

PF IDs are stable planning IDs, not GitHub issues. Preserve completed items; split remaining scope under the same ID unless the user outcome is genuinely new. New requests, refinements and discovered gaps go into this register and the linked acceptance item in the same PR.

- **Planned:** defined outcome; implementation has not started.
- **Partial:** usable parts exist; the entry names what remains.
- **Local / PR:** implemented and locally checked; not yet on main. Add the PR when created.
- **Merged:** on main; deployment and user acceptance remain separately evidenced.
- **Deployed:** record the verified release/environment. This does not prove every workflow is accepted.
- **Accepted:** record the user's real workflow/role acceptance and any remaining limitations. Unknown stays unverified.
- **Continuous:** a standard applied and checked in each relevant increment, not an epic to declare permanently finished.

A status changes only with evidence. Passing CI does not authorize merging, deploying or provider activation. The user handles merge and deployment unless explicitly delegated. Record the exact head/release, meaningful checks, migrations and activation prerequisites; do not repeatedly rerun unrelated checks without a reason.

## Current position

PF-01–10 and the first shared-household portion of PF-11 are implemented on main. The live backend dashboard identified release `3a68657` on October 17; real owner/manager/resident acceptance is still outstanding. Source identity, tenancy permissions, immutable financial history and reviewed transitions remain the foundation.

The batch in [PR #40](https://github.com/elijahvw/property-flow-2/pull/40) merged as `8b74358`, extending directories and maintenance operations (migrations 026–028) and adding safe RUM source and monitoring/release improvements. Deployment and real-account acceptance remain unverified. The user-reported release failure during RDS `backing-up` is tracked in [PF-44](https://property-flow-dev.atlassian.net/browse/PF-44); its fix waits within the existing timeout instead of rejecting an active backup. Existing preview data and prior edits are retained. Nothing in this status authorizes an application deployment or Terraform apply.

Grafana's existing dashboard now has 21 panels; all eight existing app alert rules are enabled and evaluated Normal. The user-selected email test succeeded and notification routing targets Property Flow dev. The RUM app exists, but deployed browser ingestion, infrastructure scraping, synthetic journeys and incident/recovery acceptance remain open. See PF-27 and the coverage register.

## Implemented baseline

- Identity and administration: Auth0 cookie/CSRF sessions, platform company/user administration, explicit company membership/roles, separate Team and Tenants, invitations, company details and personal profiles with revocation boundaries.
- Inventory and context: company Overview, property workspaces, real property/unit records, resident/contact assignments, emergency contacts, private management notes and active/archive history.
- Manual operating money: recurring rent and explicit posting recovery, manual receipts/allocations, balances/unapplied credit, due/grace/past-due/paid-late states, deposit requirements/receipts/corrections, paid income/expense and source-linked reports/CSV.
- Resident service: authorized lease/household views, statements/balances/deposits, request submission/status and personal profile editing; richer additions and unfinished scope appear below.

## Running feature register

### Connected portfolio, people and leasing

- **PF-01 · Tenant workspace — Merged (#33).** Connected contact, lease and separate rent/credit/deposit history with exact source links and return context. Local directory refinements preserve property/relationship filters. Remaining: real-account acceptance and ongoing edge-case/detail improvements. [Contract](tenant-workspace.md). [Jira PF-1](https://property-flow-dev.atlassian.net/browse/PF-1).
- **PF-02 · Lease workspace — Merged (#34).** Exact lease destination with parties/unit/terms, finance and renewal links. Remaining: real-account acceptance; documents and communication join their source features when available. [Contract](lease-workflow.md). [Jira PF-2](https://property-flow-dev.atlassian.net/browse/PF-2).
- **PF-03 · Resident accounts and portal access — Unified accounts Merged (#44); invitation workflow improvements local October 18.** Auth0 is the account authority. New tenants and every lease participant require a precreated/existing account; setup/reset never creates another account. Property Flow manages setup/reset and account display-name updates. Company/property access remains separately authorized. Legacy records, identities and financial sources are retained. Local invitation improvements add fresh inviter authority, safe acceptance replay, durable creation/replacement/email and paginated history. Remaining: release of these refinements, existing-data reconciliation and real-provider acceptance. [Contract](resident-contacts.md). [Jira PF-3](https://property-flow-dev.atlassian.net/browse/PF-3).
- **PF-08 · Future-effective terms — Merged (#38).** Reviewed before/after installments, immutable change/cancellation history and billing integration. Remaining: acceptance across due/grace boundaries and conflicting transitions. [Contract](future-lease-terms.md). [Jira PF-8](https://property-flow-dev.atlassian.net/browse/PF-8).
- **PF-09 · Proration — Merged (#38).** Exact calendar-day partial rent, reviewed overrides and retained calculations. Remaining: real partial-month/renewal acceptance. [Contract](proration-renewal-transitions.md). [Jira PF-9](https://property-flow-dev.atlassian.net/browse/PF-9).
- **PF-10 · Ending and renewal handoff — Merged (#38).** Explicit end planning, ending/renewal/billing transitions and debt preservation. Remaining: end-to-end owner/resident acceptance, then links to future inspection/document tasks. [Contract](proration-renewal-transitions.md). [Jira PF-10](https://property-flow-dev.atlassian.net/browse/PF-10).
- **PF-11 · Household participation and liability — Partial.** Multiple residents, shared obligation, explicit participant access and owner-approved additions are implemented. Remaining: separately defined allocated liability, guarantor/dependent models and their financial/access consequences. Rent must never multiply by participant count. [Household scope](lease-workflow.md). [Jira PF-11](https://property-flow-dev.atlassian.net/browse/PF-11).
- **PF-23a · Portfolio and directory overhaul — Merged (#40).** Completed setup prompts disappear; counts derive from scoped records/business dates. Search/filter before pagination, useful property/unit/tenant/lease detail, exact unit history and return context. Remaining: deployment and acceptance of empty/active/archived portfolios and role boundaries. No new unit-directory migration. [Evidence](dev-release-performance.md#core-unit-directory-continuation-2026-10-16). [Jira PF-28](https://property-flow-dev.atlassian.net/browse/PF-28).

### Money, collections and portfolio understanding

- **PF-04 · Statements and collections detail — Merged (#37).** Connected statement activity/CSV with traceable sources and distinct rent, cash credit and deposits. Existing recurring charges, manual receipts/allocations, aging and posting recovery remain. Remaining: real-account statement/export acceptance. [Contract](tenant-statements.md). [Jira PF-4](https://property-flow-dev.atlassian.net/browse/PF-4).
- **PF-05 · Non-rent charges and noncash credits — Merged (#38).** Reviewed one-time charges, targeted credits and linked reversals. Remaining: real-account acceptance and explicitly scoped future financial refinements. Unapplied cash credit is not a concession. [Contract](lease-charges-credits.md). [Jira PF-5](https://property-flow-dev.atlassian.net/browse/PF-5).
- **PF-06 · Deposit applications and actual refunds — Merged (#38).** Source-linked deposit application, manual cash refunds and immutable correction history. Remaining: acceptance of partial/refunded/voided cases. Recorded money is not bank reconciliation. [Contract](deposit-applications-refunds.md). [Jira PF-6](https://property-flow-dev.atlassian.net/browse/PF-6).
- **PF-07 · Itemized move-out settlement — Merged (#38).** Guided review, versioned snapshots, applications, pause/reopen/correction history and explicit refund/end follow-up. Remaining: real-account completion acceptance; inspection/evidence links depend on PF-15/16. [Contract](move-out-settlements.md). [Jira PF-7](https://property-flow-dev.atlassian.net/browse/PF-7).
- **PF-20 · Historical reports and accounting depth — Partial.** Cash reports/CSV, lease register, balances/aging and source drilldowns exist. Remaining: defined as-of accounting/event history, reconciled portfolio statements and useful comparisons with complete filter totals. Investor distributions/trust accounting are deferred. [Jira PF-20](https://property-flow-dev.atlassian.net/browse/PF-20).
- **PF-25 · Imports, reconciliation and integrations — Planned.** Start with validated CSV preview/mapping, durable source identity, opening-balance meaning, commit summary and reconciliation. Provider sync, bank feeds, screening and external calendars require separate ownership/consent/retry contracts; no inactive connected switches. [Jira PF-25](https://property-flow-dev.atlassian.net/browse/PF-25).

### Maintenance, delegation and daily operations

- **PF-12 · Team capabilities and property scope — Partial; delegated maintenance Merged (#46).** Existing migration029 property scope plus default-off execution in032 lets an owner grant staff maintenance authority without finance/lease/team/document access. Assignment, property scope, fresh authorization and revocation gate each job. Broader capability delegation remains planned. [Contract](delegated-maintenance.md). [Acceptance](product-backlog.md). [Jira PF-12](https://property-flow-dev.atlassian.net/browse/PF-12). [PR #46](https://github.com/elijahvw/property-flow-2/pull/46).
- **PF-13 · Work orders, vendors and costs — Partial; current increments Merged (#40).** Existing resident requests/status/retry remain. Migration 026 adds management intake/detail, optional unit/category/target date and versioned audit; 027 adds private versus requester-visible immutable updates; 028 links existing paid expenses with retained correction/source history. Merged #46: assignment/acceptance, progress, completion review/reopen and a work-stage review queue, without fabricating payment (migration032). Management-only private attachments are implemented with PF-15. Local October18: focused due/assignee filters, overdue and approval attention links. Remaining: release/acceptance, vendor contact records and external update notifications. [Delegation contract](delegated-maintenance.md). Estimates/payables/splitting and resident-authored comments are not delivered. [Updates](maintenance-updates.md) · [Costs](maintenance-costs.md). [Jira PF-13](https://property-flow-dev.atlassian.net/browse/PF-13). [PR #46](https://github.com/elijahvw/property-flow-2/pull/46).
- **PF-14 · Preventive work and task calendar — Planned.** Next complete job: create recurring source-linked tasks, assign/schedule, handle missed occurrences and complete with history. Calendar/list share scope, dates and overdue definitions. Recurrence uses explicit timezone and durable occurrence IDs. Begin internally before external sync. [Jira PF-14](https://property-flow-dev.atlassian.net/browse/PF-14).

### Documents, condition evidence and resident service

- **PF-15 · Private documents and attachments — Foundation Merged (#46, migration031); scan workflow refinements local October 18.** Management-only lease/work-order uploads use bounded private PostgreSQL originals, immutable versions, quarantine, fresh access checks, audited download and archive/restore. No public frontend bucket. A pinned private ClamAV sidecar is prepared for activation; actual-engine clean/EICAR checks passed, and deployed upload/download acceptance remains pending. Remaining: explicit resident/staff sharing, resident uploads, larger private object storage and retention operations. [Contract](private-documents.md). [Jira PF-15](https://property-flow-dev.atlassian.net/browse/PF-15). [PR #46](https://github.com/elijahvw/property-flow-2/pull/46).
- **PF-16 · Move-in/out inspections — Planned.** Structured condition records, evidence, reviewed completion and comparison with source-linked settlement follow-up. Depends on PF-15; preserve original evidence and separate observation from a reviewed financial charge. [Jira PF-16](https://property-flow-dev.atlassian.net/browse/PF-16).
- **PF-17 · Agreements/signatures — Planned.** Draft/version/review/send/sign/decline/expire/cancel with an immutable signed result and audit trail. Provider activation is separate; signature status must reflect actual provider evidence. [Jira PF-17](https://property-flow-dev.atlassian.net/browse/PF-17).
- **PF-18 · Resident home and self-service — Partial; read-only portal refinement implemented locally October 17.** Home links connect rent/payments, deposits, maintenance and profile. Financial records and household/invitation history are view-only; no manual receipts, deposit dispositions, corrections or household invitation mutations are allowed for residents. Online payment processing and document uploads remain unavailable. Personal profile edits and maintenance submission remain available. Residents never edit their own role, assignment or lease authority. Remaining: richer household/access state, provider-backed payments last, documents via PF-15, and release/real-account acceptance. [Jira PF-18](https://property-flow-dev.atlassian.net/browse/PF-18).
- **PF-19 · Messages, notifications and reminders — Planned.** Durable in-app notifications and source-linked conversations first; explicit audience, unread/delivery state, retry and privacy. External email/SMS delivery is separately activated and monitored. Sending is not receipt; no pretend inbox or delivery success. [Jira PF-19](https://property-flow-dev.atlassian.net/browse/PF-19).
- **PF-21 · Vacancy, prospects and applications — Planned.** Actual availability → prospect → application → reviewed approval → tenant/lease conversion without duplicate contacts. Preserve consent and source history. Screening/syndication follow explicit provider contracts; a unit without a current lease is not automatically physically vacant. [Jira PF-21](https://property-flow-dev.atlassian.net/browse/PF-21).

### Platform, experience, performance and reliability

- **PF-22 · Company plans, usage and subscriptions — Planned.** Existing platform company/user administration remains. Add manual platform grants and server-enforced implemented entitlements first, with company-owner visibility and audited overrides. No invented limits or advertised unimplemented features. [Jira PF-22](https://property-flow-dev.atlassian.net/browse/PF-22).
- **PF-23 · UI and workflow acceptance — Continuous.** Clean, accessible responsive pages; grouped forms, explicit page-only drafts with changed-form close confirmation (W10 merged/deployed PR52; signed-in acceptance pending), separate submitted-request recovery, useful errors/loading/empty states, keyboard focus, exact source links and return context. Keep secondary/archive actions unobtrusive. Every feature must complete a real operating job across its applicable roles. [Jira PF-23](https://property-flow-dev.atlassian.net/browse/PF-23).
- **PF-24 · Capacity and responsiveness — Continuous.** Measure request/render/query latency and duplicate work before changing architecture. Use bounded server pagination/search, appropriate indexes and complete scoped totals. Track bundle size, list/detail responsiveness and representative portfolio scale. Keep meaningful CI checks; reuse valid evidence and avoid broad speculative rewrites. [Jira PF-24](https://property-flow-dev.atlassian.net/browse/PF-24).
- **PF-26 · Payment collection — Planned, last.** SaaS subscriptions and tenant rent/deposit collection are independent scopes. Model methods/consent/fees, settlement, returns/refunds/disputes, signed deduplicated webhooks and reconciliation before activation. Submitted is not settled. Manual operations must remain usable without payment connectivity. [Jira PF-26](https://property-flow-dev.atlassian.net/browse/PF-26).
- **PF-27 · Monitoring, recovery and release operations — Partial; power-control refinements local October 18.** Backend metrics/logs/traces, 21-panel Grafana dashboard, eight enabled alerts and tested email routing are established. Safe Faro RUM source and browser → API correlation are locally verified. Local: separate one-action Start/Stop development workflows, ordered database/app/scanner lifecycle, startup public readiness and CI-enforced infrastructure power inventory. Remaining: release/activation and real-session ingestion, AWS ECS/ALB/RDS then CloudFront/storage coverage, synthetic journeys, runtime/pool pressure, backup/restore drills, telemetry health/cost and incident/recovery acceptance. [Coverage and evidence](monitoring-coverage.md). [Jira PF-27](https://property-flow-dev.atlassian.net/browse/PF-27).

## Build order and next complete increments

1. **Finish current release/acceptance:** review this core/maintenance/RUM batch, retain restore points, merge/deploy under user control, verify actual role workflows and RUM ingestion. Preserve preview data; no automatic release from this task.
2. **Close monitoring gaps (PF-27):** each increment delivers one verified signal → useful view → actionable alert/runbook → controlled recovery check. AWS read-role/Terraform changes and provider activation require their own reviewed scope.
3. **Delegated maintenance (PF-12 + remaining PF-13):** capability/property scope → real vendor contacts → assignment/acceptance → progress → reviewed completion/reopen → existing paid-cost source. Staff authority must be explicitly introduced and tested, not inferred from assignment.
4. **Preventive operations (PF-14), then private evidence (PF-15/16/17):** connected tasks/calendar, documents and inspections; signatures follow once ordinary document work is dependable.
5. **Resident communication and portfolio depth (PF-18/19/20/21):** connect existing self-service, durable messages/notifications, as-of reports and vacancy/application conversion. Preserve financial events now instead of reconstructing history later.
6. **Commercialization/integration (PF-22/25/26):** manual entitlements, validated imports/reconciliation, then subscription collection and tenant payments last. PF-23/24 accompany every slice.

A new request can reprioritize this order. Keep one bounded active implementation increment unless the user asks otherwise. Include related UI/performance work the user requests, without turning it into speculative feature expansion.

## Shared product and release requirements

Fresh server-side authority, explicit company/property scope and forced RLS apply to every data path. Preserve financial source IDs, posted snapshots, exact-cent money and immutable audits; consequential changes use version checks, durable retries and atomic recording. Platform authority never bypasses customer access.

Acceptance must cover the complete job, source/detail/history, correct filtered totals, correction/recovery, role revocation, competing writes/retries and relevant mobile/keyboard paths. Include observability without private form/contact/financial data. An exposed button is not a feature; a test-only fixture is not production data.

For each PR update the relevant register entry and detailed acceptance, link evidence and state unfinished work. Record migrations, prerequisites/activation variables and material risks. Review exact-head CI and all review threads before recommending merge. Passing tests never grant merge/deployment permission.

## Local-first release batching

The local preview remains `http://127.0.0.1:5090`; [checkpoint/restore rules](dev-release-performance.md) protect existing preview data. Migrations 026–028 were applied only to isolated local databases. Keep private dumps and secrets outside Git.

Defer investor distributions/trust accounting, a separate investor portal, vendor marketplace, speculative AI, native mobile apps and broad cosmetic redesign until core operating jobs are accepted. Responsive web is required throughout.

## October 17 workflow performance audit

The local audit refines core workflows and PF-27 monitoring with isolated k6/browser tests, a measured Grafana dashboard, permission-safe page splitting, batched directory searches, contextual lease setup and pre-activation tenant selection. See [scope, fixes and acceptance](workflow-performance.md). Local/PR state; deployment and user acceptance remain unverified.


## October 18 approved platform audit implementation

[Audit A01–A17](platform-audit-2026-10-17.md) is approved for implementation. [Local workflow improvements and activation contract](platform-workflow-improvements.md) extend PF-01/02/03, PF-06/12/13/15/20 and continuous PF-23/27: invitation/access integrity and delivery recovery; role-aware persisted walkthrough and public searchable Help; contextual/mobile navigation; meaningful queues; guided cash/deposit entry; automatic configured document scans; report presets and paginated administration history. No broad RBAC/CMS/accounting rewrite. Existing provider discovery remains automatic; tuning needs measured evidence. Migrations033/034 and live SES/scanner/role/telemetry acceptance remain release prerequisites. This work has not been merged, deployed or user-accepted.


### PF-20 audit follow-up — task-focused Help search

W09 ranks title and summary matches ahead of incidental guide text, retaining related results and the normal directory order when cleared. Account guidance explicitly names password reset. Local implementation after PR52; validation, release and live acceptance tracked in [the workflow log](workflow-acceptance-2026-10-18.md). No external search service or infrastructure.

Multiword tasks such as rent payment and reset password match all query words without requiring an exact phrase.
