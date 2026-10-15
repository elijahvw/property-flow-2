# Property Flow product roadmap

Updated 2026-10-15. All releases remain development releases until accepted. Target customer: an owner and their managers running their own portfolio. TenantCloud informs connected workflows; we do not copy its interface or promise feature parity. This file replaces the build order in historical handoffs.

## Where we are now

Merged foundation: company/user administration, identity discovery and invitations; separate Team and Tenants management; resident profiles/property assignments; properties and units; reviewed draft/active/ended lease records and linked renewal drafts; maintenance requests; manual cash income/expense; rent charges, receipts, allocations and resident history; configurable due day/grace; past-due aging and paid-late history; opt-in recurring schedules, pause/stop and explicit recovery; Overview, property navigation, reports and CSV exports.

PR27 merged at `ada0fb5` on 2026-10-15. The user is handling dev deployment and manual acceptance; deployment completion has not yet been verified. Its linked renewal drafts do not automatically end/activate leases or change billing. Financial references are readable on screen, while exports retain both display references and internal IDs. Existing CUID/Auth0 identities remain unchanged. See [lease setup and recovery](lease-setup-billing-recovery.md).

The current engineering increment is a separate CI cleanup: one deterministic workspace dependency install, alignment with the backend's existing locked Prisma versions, headless-only browser installation and cancellation of superseded PR runs. Every test and both required check names stay. CI and deployment are different workflows; this cleanup does not change deployment or require an app deployment.

These are useful operating foundations, not a complete accounting, leasing or communications product. Real owner/manager/resident acceptance remains necessary after each deployment.

## Proposed next sequence for user review

1. **Deposits and move-in balances.** Next recommended feature increment: record a deposit requirement and money received/held separately from rent and ordinary cash income, including before move-in. Show the resident and manager a clear breakdown of rent versus deposit obligations. Follow with explicit deposit application/refund and itemized move-out settlement. Define each category's accounting treatment and keep money movements traceable; never label a deposit as rent to fit the existing model. Automatic penalties and legal settlement deadlines require confirmed lease/jurisdiction rules.
2. **Lease changes, proration and renewal handoff.** Add reviewed first/last partial-month calculations and future-effective rent/payment-term changes. Show what changes, when it takes effect and which future installments it affects. Existing manually entered partial amounts remain supported. Connect the current lease, renewal draft and billing schedule into an explicit transition workflow, preserving posted charges, allocations and historical terms. Do not silently auto-end a lease or bill a draft.
3. **Statements and reporting depth.** Deliver a connected resident statement, rent roll, deposit-held report, aging/collections drilldowns and traceable exports. Add historical as-of reporting with an explicit event/date basis, then reviewed opening balances/imports, reconciliation and period controls. Current snapshots must not masquerade as historical reports. Reporting correctness and exact money are acceptance requirements in every financial increment; this phase adds depth, not a delayed correctness fix. Cash received is not automatically profit, and held deposits are not rent revenue.
4. **Maintenance operations.** Extend the existing priority/status queue with assignee/vendor, target date, durable status history, internal versus resident-visible updates and completion costs. Connect costs to the property ledger without double counting. Keep property/unit/resident context and the next action visible. Attachments follow private storage.
5. **Private documents and inspections.** Add secure upload, authorized download, validation, sharing and access audit for property/lease/resident documents. Connect move-in/out condition checklists and evidence to settlement workflows. Use private storage, never the public frontend bucket. Signatures follow document versioning, signer identity and a real provider agreement.
6. **Resident workspace, tasks and communications.** Connect lease details, balance, charge, receipt, maintenance and shared documents. Add manager tasks/calendar from actual source records. Introduce reviewed reminders, preferences and a transactional outbox with retry/delivery history before enabling email. A past-grace balance alone must not trigger automatic collection messages.
7. **Vacancy-to-move-in.** Add unit availability, prospects, application review and conversion to an approved resident/lease. Multi-person households and shared lease responsibilities need an explicit data/access model. Screening requires consent, sensitive-data handling and provider agreements; do not add an inactive integration toggle.
8. **Integrations, with online payments last.** Start with reliable exports/calendar feeds. Accounting synchronization needs explicit authorization, account/category mapping, source identities, sync direction, retries and reconciliation. Stripe comes last: settlement, fees, refunds, disputes, webhooks and reconciliation belong in the same design as payment collection.

Each phase is a series of bounded, reviewable PRs. The next feature is proposed for user discussion, not authorization to build or activate every listed capability. The first deposit PR should cover requirement → receipt/held balance → resident/manager visibility; refund/application and full move-out settlement can follow as separate increments with clear acceptance criteria.

## Product and quality rules across every phase

- Keep the owner/manager workflow first, with appropriate resident self-service and clear platform administration boundaries.
- Preserve property context through related records. Show names and readable references instead of internal IDs. Use focused forms, explicit review where money/access changes, a clear primary action, accessible mobile layouts and truthful success/error/loading states.
- Check current company/role authority, revocation, audit rollback, durable retries, exact-cent money and concurrent edits. Use real disposable database/browser regressions for these boundaries. Do not remove tests to shorten CI.
- Add useful dashboard follow-up actions as working features arrive, rather than creating a separate dashboard of placeholder metrics.
- Feature controls must govern implemented capabilities with server enforcement. Per-company entitlements are future work when there is a concrete feature/plan model; no dummy toggles.
- Domain setup remains on hold. Private storage, email providers, payments and other external activations require their own reviewed implementation and authorization.
- Trust accounting, owner distributions and a separate investor portal stay deferred while the customer model is owners operating their own portfolios. Marketplaces, speculative AI features and broad cosmetic rewrites are lower priority than complete operating workflows.

## Release and evidence

Before a merge decision, inspect every PR comment, review and inline thread as well as exact-head CI. The user approves merges and runs deployments manually. Keep CI cleanup separate from product/deployment changes. After deployment, verify the deployed version/readiness and test real owner/manager/resident workflows and company/role boundaries. Green local fixtures are not deployed authenticated acceptance.

Research and workflow rationale: [TenantCloud notes and official sources](tenantcloud-workflows.md), [rent workflow](rent-workflow.md), [payment policy](lease-payment-policy.md), [recurring billing](recurring-rent.md), [lease setup/recovery](lease-setup-billing-recovery.md).
