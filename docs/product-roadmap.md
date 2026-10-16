# Property Flow product roadmap

Updated 2026-10-15. Repository baseline: main `e94fe86`. This replaces the build order in historical handoffs. The [implementation backlog](product-backlog.md) contains dependencies and acceptance criteria; [workflow research](tenantcloud-workflows.md) records sources and limits.

## Product direction

Build a complete daily operating product for owners managing their own portfolios. Managers and staff work in the same company workspace with appropriate authority; tenants receive connected self-service. The platform owner administers customer companies, access and eventually subscriptions. Platform authority alone must not grant access to customer operating records.

Competitive coverage is the long-term target across leasing, balances/accounting, maintenance, documents, communications and vacancy management. A navigation entry does not establish parity: users must be able to finish the underlying job. Use original interface, copy and implementation. TenantCloud's investor-owner portal serves a different customer model from our platform-owner console.

Keep the main application ahead of subscription commercialization. Stripe, both subscription collection and tenant rent collection, remains last. Domain setup remains on hold. This review does not establish plan names, prices or delivery dates.

## Implemented baseline

These capabilities exist on main and must not be rebuilt as future promises:

- Platform company/user administration, identity discovery/invitations, membership/role enforcement, separate Team and Tenants audiences.
- Properties, unit details, resident assignments and contact/emergency/private-note profiles; company Overview and persistent property workspaces.
- Reviewed draft/active/ended leases, linked renewal drafts, due day/grace/payment instructions and current lease-register reporting.
- Immutable rent charges, manual receipts/allocations, balances, unapplied receipt credit, past-due aging, paid-late history, recurring schedules and explicit posting recovery.
- Refundable deposit requirements/revisions, manual receipts, recorded held/uncollected/excess balances, correction history, resident visibility and linked cash sources.
- Manual paid income/expense, cash reports/CSV and tenant maintenance submission with priority, management status updates and durable retry.
- CI installation improvements and ECS/Grafana monitoring. Monitoring is an operational concern, not the next feature project.

PRs #29–32 are merged through `e94fe86`; [PR #32](https://github.com/elijahvw/property-flow-2/pull/32) records cleanup recovery. The previous session verified app release `36286ad`, hosted metrics/logs/traces and approved Datadog cleanup. The original [deployment run](https://github.com/elijahvw/property-flow-2/actions/runs/38815801266) still records a failure from its first cleanup attempt; recovery does not rewrite that result. This review did not redeploy or repeat live acceptance. Grafana rules were provisioned initially paused; active notifications are not established here.

Implemented does not mean user-accepted. Real owner/manager/resident acceptance remains required after deployment. Recorded deposits do not prove bank reconciliation; current reports are not historical as-of accounting. Existing unapplied payment credit is not a general concession, credit-note or refund capability.

## Build order

### 1. Connected tenant and lease work

Deliver **PF-01 → PF-02**, then **PF-03**: true tenant/lease detail destinations, shared property/unit/tenant context, and offline contacts with optional verified portal access. A landlord should be able to record an existing tenant/lease before inviting them to log in.

Include PF-23 navigation/accessibility work. Preserve existing financial source IDs, authorization and audit history during contact migration. The user subsequently requested multiple residents per lease, resident-initiated invitations, owner approval for every addition, and connected onboarding/renewal workflows. Bring the initial shared-household portion of PF-11 into PF-02 under that explicit direction; emergency contacts remain separate. See [lease workflow scope](lease-workflow.md). Do not repeat the property workspace already implemented or spend this phase on a new visual theme.

### 2. Financial understanding and completion

Deliver **PF-04 → PF-05 → PF-06 → PF-07**: tenant statements, non-rent charges/noncash adjustments, manual refunds/deposit applications and itemized move-out settlement. Update management, tenant views and reports in each money increment.

Keep due, within-grace, past-grace, unpaid and paid-late distinct. Separate rent owed, cash credit, refundable deposits and operating income. Correction voids are never represented as money returned. Manual operation must work without a bank/payment connection.

### 3. Lease changes and renewals

Deliver **PF-08 → PF-09 → PF-10**: future-effective terms, reviewed proration and explicit end/renewal/billing transitions. PF-08 can begin after the connected lease page without waiting for the entire financial phase. Preserve charge snapshots and posted money. Renewal drafts never silently start billing; lease ending never erases debt.

Complete **PF-11** after PF-03/PF-05 contracts settle. Its initial shared-household/approval workflow accompanies PF-02 at the user's request. Begin with one shared obligation and explicit participant access. Separately allocated liability is an additional increment; rent never multiplies by the number of participants.

### 4. Maintenance operations and delegated work

Deliver **PF-12 → PF-13 → PF-14**: scoped team authority, work-order details/assignment/vendor contacts, and preventive work/source-linked tasks/calendar. Managers coordinate work; staff receive explicit property/work-order permissions. Include manager-created requests for offline tenants, private versus tenant-visible updates, target dates, completion review and linked costs.

PF-12/PF-13 are an independent operating slice after connected navigation; they need not wait for every lease feature. Attachments require PF-15. Vendor contact records do not require a vendor login.

### 5. Private documents and condition evidence

Deliver **PF-15 → PF-16**, then **PF-17**: private documents/versioning/sharing, inspections and agreement/signature lifecycle. Connect evidence to leases, work orders and settlement. Use private storage, never the public frontend bucket.

PF-07 initially supports reviewed manual settlement references and connects inspection evidence when available. Storage provisioning/signature-provider activation need reviewed implementation scopes; e-signatures must not delay every financial improvement.

### 6. Connected resident service and portfolio depth

Deliver **PF-18 → PF-19**: coherent tenant home and durable in-app communication/notifications, followed by separately activated external delivery. Tenant improvements to balances/lease/maintenance ship with their source features before this phase; this phase connects them.

Deliver **PF-20** deeper reports/as-of history and **PF-21** vacancy → prospect → application → approved tenant conversion. Capture financial events needed for history in PF-05/PF-06/PF-08 rather than reconstructing them later. Screening and syndication follow explicit provider contracts.

### 7. Platform commercialization and integrations

Deliver **PF-22** company subscription lifecycle and server-enforced implemented entitlements, using manual platform grants first. Company owners see their own plan/usage; platform owners administer assignments/overrides. Managers/staff/tenants do not inherit subscription authority.

Deliver **PF-25** imports/reconciliation/integration contracts, then **PF-26** subscription collection followed by tenant payments. Both payment scopes require independent review. Fees, settlements, refunds, disputes, webhooks and reconciliation belong with collection. PF-24 performance work accompanies every phase.

## First reviewable increments

1. **PF-01, implemented locally / review pending:** tenant detail route, linked leases/balances and return navigation, using existing data. Includes the requested shared form/date/UI improvements; see [scope](tenant-workspace.md).
2. **PF-02:** exact lease workspace and working links to rent/deposits/terms/renewal, using existing data.
3. **PF-03a:** offline contact identity/backfill with compatibility; **PF-03b:** contact forms and verified invitation/linking. Do not combine a people/identity rewrite into one PR.
4. **PF-04:** statement and traceable CSV from existing charges/receipts/allocations with separate credit/deposit summaries.
5. **PF-05a:** reviewed one-time non-rent charges/noncash credits; then PF-06 money movements after their accounting contract is settled.

If the contact migration needs longer review, PF-12/PF-13 provide the next independent feature slice. Keep one active implementation increment unless the user requests parallel work. Group UI improvements and optimizations requested during a feature increment with that feature, as the user authorized. Keep the resulting PR coherent and its validation proportional to the combined changes.

## Shared product and release requirements

- The backlog is proposed work, not approval to merge/deploy, change shared data or activate providers.
- Ship one complete job per increment, including relevant owner/tenant/manager/staff experiences. Staff-specific capabilities are assignment/scope/permissions, not a duplicate product.
- Preserve current company/role/revocation checks, forced RLS, exact-cent money, immutable source history, durable retries, atomic audit and concurrency controls. Enforce permissions on APIs and direct URLs, not only buttons.
- Preserve property context, names/readable references, focused forms, clear review, recoverable drafts, accessible mobile layouts and truthful loading/error/success states. Totals cover complete filters, not visible pages.
- Reuse existing sources/components. Measure slow requests and duplicate loads before caching or rewriting. Keep required CI/database/browser checks; meaningful regressions protect changed boundaries.
- Inspect every PR comment/review/thread and exact-head CI before requesting merge approval. The user approves merges and deploys manually. This documentation change needs no deployment.

Defer investor distributions/trust accounting, separate investor portal, vendor marketplace, speculative AI, native mobile applications and broad cosmetic redesign until core operating jobs are accepted. Responsive web is required throughout.
