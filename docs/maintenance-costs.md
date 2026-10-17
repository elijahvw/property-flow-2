# Maintenance paid expense sources

Local continuation of the core overhaul, October 16, 2026. No merge or cloud deployment is authorized.

## Operating workflow

An owner or manager opens a maintenance request and chooses **Link existing expense**. Eligible sources are unvoided paid expense transactions from the same company and property. Search by transaction reference or memo operates before pagination. The review identifies the selected transaction, date, amount and memo; it creates an association without changing money, making a resident charge or recording another expense.

When the expense has not yet been recorded, **Record a paid expense in Finances** opens the existing property-scoped form with Expense paid and Repairs selected. Record the actual paid transaction there, return through **Back to maintenance request**, and explicitly choose it in the link editor. Creation and linking are separate actions; leaving the expense unlinked does not make it missing from financial reports.

Each linked source opens its exact transaction in Finances, with a return link to the maintenance request. Finances also identifies the active maintenance association. Its selected-transaction filter uses the same company/property authority and whole-filter summary as the ordinary directory. Clearing that selection or applying new filters returns to the broader history.

The maintenance total sums all active links to unvoided expense sources, independently of the visible page. Voided sources and unlinked records remain visible in link history but leave the total. A transaction can have at most one active maintenance link. Correct an association with **Unlink expense**, a reviewed link version and a reason; then explicitly link the original source to the intended request with a new submission. Unlinking never voids or refunds the transaction. Resolving, reopening or editing a request never fabricates a payment or changes its costs.

This slice covers actual paid sources. Estimates, invoices payable, expense splitting across requests, vendors, reimbursement and resident chargebacks are not implemented by these controls.

## Authority, history and retries

Cost APIs require both current `maintenance.manage` and `finance.manage` inside the existing authorization transaction. Staff, residents and platform authority alone cannot read or mutate costs. The resident request projection contains no cost links, amounts or financial source identifiers. Company context and explicit scope filters apply to every query.

Composite request/property/company and entry/property/company foreign keys prevent mismatched associations. Forced RLS covers the new table. A partial unique index enforces one active link per expense, including independent database writers. The database validates that a new link starts active and references an unvoided USD expense. Linking orders against expense correction through the ledger row lock; later voids are reflected in totals without deleting history.

Source identity, creator, creation time and submission fingerprint are immutable. Restricted update grants and a database trigger allow only one versioned unlink with its author/time/reason. Links cannot be deleted by the runtime role or silently reactivated. Consequential link/unlink changes audit atomically.

Creation retains a durable company/author submission key and the selected expense/version fingerprint. A lost response retries one association and one audit event; changing a committed submission requires reviewing records and deliberately clearing the draft. Replay after unlink returns that retained unlinked record rather than restoring it. Unlink retries retain the same reviewed version/reason; conflicting corrections fail explicitly. Background refresh never silently upgrades a selected expense version.

## Local schema and checks

Additive migration `202610160028_maintenance_costs` creates the link table, composite source keys, indexes, RLS, grants and guard. Existing request, note and financial values remain unchanged. Eventual coordinated deployment must apply migrations 026–028 before serving this backend; no external provider or infrastructure activation is part of this increment.

The preview was backed up privately to `/tmp/propertyflow-local-preview-backup-before-costs.sql` (0600), then restored into a fresh disposable database with `--upgrade-from-maintenance-updates-preview`. That explicit switch verifies the prior updates table exists and the cost table does not, then applies only 028. Current-schema automatic checkpoints use ordinary restore. The comparison preserved every original business record and session identity across 38 tables, allowing only normal session idle-expiry refreshes and local session/view-audit activity.

Both production builds passed. Validation passed: 28 disposable maintenance database/API/browser checks; 174 financial regressions; 171 browser fixtures; 70 safe Node checks with five intentional database-suite skips; and 60 operations checks. Coverage includes competing links, source voiding races, lost committed responses for link/unlink, complete paginated totals, candidate search, cross-property/company rejection, current-access revocation, audit rollback, RLS, immutable history, exact transaction navigation and the phone workflow. The existing Vite bundle-size advisory remains. Real-account cloud acceptance is separate.
