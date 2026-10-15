# Property Flow product roadmap

Updated 2026-10-15. This replaces the build order in older checkpoints. All releases remain development releases until accepted. Target customer: an owner and their managers running their own portfolio. Stripe/payment processing comes last. Roadmap entries are planned capabilities, not existing functionality or authorization to activate providers.

## Current foundation and this increment

Already available: company/user administration and invitations, property assignments, resident profiles, property/unit records, draft/active/ended leases, maintenance requests, manual cash income/expense, reports/CSV, property navigation and Overview, monthly rent posting, manual receipts, allocations and resident rent history. These are useful foundations; they do not yet constitute a complete accounting or leasing system.

Merged/deployed PR25 adds lease due-day, grace-period and shared payment instructions; saved charge grace terms; past-due/grace classifications; aging; collection filters/exports; and Overview follow-up links. It does not generate fees, invoices on a schedule, reminders or legal notices. See [payment policy](lease-payment-policy.md).

## Build order

1. **Reliable recurring billing and guided lease setup.** Current follow-up: opt-in reviewed schedules, background posting, pause/stop and durable history, plus paid-late receipt history; see [recurring rent](recurring-rent.md). Guided initial lease activation, effective-dated changes and renewal records remain next within this phase. Connect property/unit → resident → term → rent schedule and payment terms → review → activation. Separate service period, invoice generation date and due date. Add explicit first/last partial-month previews, schedule pause/end, effective-dated rent changes and renewal records. Preserve posted charges and payment history. Require durable scheduled-run identities, retry/backfill controls and a visible run history before enabling automation. Retain manual posting as a safe, duplicate-protected recovery path.
2. **Deposits and move-out settlement.** Track deposits separately from rent income, including collection before move-in, held balance, permitted application, refund and itemized settlement. Add other charge categories only with explicit accounting treatment. Never represent a deposit as rent to bypass the current monthly-charge model. Establish the applicable lease/jurisdiction requirements before automatic penalties or settlement deadlines.
3. **Maintenance operations.** Add priority, assignee/vendor, target date, status history, internal versus resident-visible updates, completion costs and related property/unit/lease context. Give managers an actionable queue and residents a clear progress trail. Link costs to the cash ledger without double counting. Add attachments after private storage exists.
4. **Private documents and inspections.** Provision private storage with authorization-controlled downloads, upload validation, retention and access audit. Add lease/property/resident document sharing and move-in/out condition checklists. Documents must never use the public frontend bucket. Add electronic signatures only after document versions, signer identity and an actual provider contract are defined.
5. **Resident workspace, tasks and communications.** Connect balance → charge → receipt, lease terms, maintenance and shared documents. Add a manager task calendar driven by actual lease/billing/maintenance events. Build explicit reminder previews, delivery preferences and a transactional outbox with retries and delivery audit before enabling email. Do not send collection messages automatically merely because a balance is past grace.
6. **Accounting accuracy and reporting depth.** Expand traceable charge/payment/deposit statements, rent roll, aging and collection reports; distinguish current snapshots from historical as-of reports. Add opening balances/import review and bank reconciliation with immutable source identity and correction trails. Cash received is not automatically profit; deposits and transfers need separate treatment. Add period controls before representing reports as final accounting statements.
7. **Vacancy-to-move-in workflow.** Add availability, prospect/application review and conversion to an approved resident/lease after the core operating workflows are dependable. Screening needs consent, sensitive-data handling and provider agreements; it is not a placeholder toggle.
8. **Integrations, then online payments.** Start with documented exports and calendar feeds. Add accounting synchronization only with explicit authorization, account/category mapping, stable source IDs, direction of sync, duplicate protection, retries and reconciliation. Payment processing comes last: payment lifecycle, settlement, refunds, disputes, webhooks and reconciliation must be designed together, rather than treating a successful checkout as settled rent.

Each item is a reviewable series of increments, not a single large rewrite. Recurring billing is the current review increment after deployed payment policies and collections. Maintenance and private-storage work can follow without waiting for payment processing.

## Changes to the older roadmap

- Replace “documents next” with recurring billing and deposits first; private storage remains a prerequisite for document features.
- Replace isolated screens with connected workflows and contextual next actions. Keep primary Save/Review actions visually above optional reset/add-another controls.
- Defer trust accounting, owner distributions and an owner-investor portal until the customer model includes managing other owners' funds.
- Defer marketplaces, AI assistants, broad cosmetic rewrites and integration catalogs without working underlying capabilities.
- Keep company boundaries, current permission checks, auditability, idempotency, exact money, accessible responsive forms and regression coverage as acceptance requirements on every increment.
- Company feature controls should govern implemented capabilities and enforce server permissions; do not add decorative entitlement switches.

## Research basis

The design reference is TenantCloud's connected property and lease workflows, not its visual design or feature-for-feature duplication. [Research notes and official sources](tenantcloud-workflows.md) explain the decisions and gaps.

Before merging an increment: inspect every PR comment, review and thread as well as exact-head CI. The user approves merges and runs deployments. After deployment, test real owner/manager and resident paths plus company/role boundaries. A green fixture test is not evidence that live account acceptance passed.
