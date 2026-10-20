> Status reconciled October 20, 2026: use [current platform status](mvp-status.md) and [the roadmap](product-roadmap.md) for delivery and remaining scope. Dated branch/release/test/limitation statements below are historical checkpoints, not the current deployment or acceptance state. No historical pass is promoted to real-account acceptance.

# Property records and reports — development quality increment

Property Flow remains in development. The intended first customer is an owner managing their own portfolio through their company, with managers supporting that owner. This change adds real record fields and reports without inventing data or claiming a complete accounting system.

## Records and interaction

Property creation and editing now include building type, year built, parcel/tax ID, country code and management notes. Unit records include bedrooms (0 means studio), bathrooms in quarter increments, square feet, monthly market rent, floor and notes. These details are optional: missing data remains null and displays as “Not recorded”, rather than being guessed. Asking/market rent and contracted monthly lease rent are separate.

Property creation uses a company/actor/submission identity stored in PostgreSQL. A failed or dismissed request retains its key and draft; a successful save or deliberate “Start a new property” creates a new key. Concurrent requests and retries after a committed response is lost return the same record and create one audit. Changed details with the same key conflict. Creation and its audit commit together. Database grants prevent runtime deletion or rewriting of creation identity; existing legacy rows remain valid without fabricated keys.

Property edits require a version and compare-and-swap update. Conflicts retain the draft and offer an explicit discard/reload path. Unit edits preserve unspecified fields, and empty submitted optional fields clear them. Unit submissions with no details retain the fingerprint used by older clients, so an already committed retry remains valid after an upgrade.

Focused dialogs, grouped sections, visible field limits, validation/errors, disabled pending controls and polite dismissible success confirmations support owner/manager workflows. Property creation also gives a persistent next-step confirmation. The unit action waits for the property to load.

## Reports and accuracy contract

Owners and managers get Reports in company navigation. Staff, residents and platform authority alone do not get these company reports. Every request rechecks current company/account/membership access within the tenant transaction; the database also enforces company row policies.

- **Recorded income and expenses:** inclusive received/paid dates and optional property filter. Totals, monthly property/category groups, and source rows come from the same database transaction. Voided entries remain visible as source history and are excluded from totals. Money sums use integer cents/BigInt, returned as strings and formatted without floating-point conversion.
- **Lease register:** current saved terms/status, optional property/status filters, business date in the company's configured timezone. Monthly rent in effect includes active leases on active units with inclusive start/end dates. Future and past-end active records are flagged separately. It is not historical occupancy, rent collected or balances owed.

A generated result is a snapshot held in the browser while reviewing/exporting; it is not an immutable archived report. Changing inputs does not silently regenerate it. The result shows its captured filters/company/basis/time. Generating again reads the latest saved state. A company/access change clears the result.

The screen pages 50 source records at a time; CSV downloads contain every matching source row and the same exact totals/metadata. Text values are quoted and spreadsheet-formula prefixes neutralized; trusted money cells retain signed two-decimal numeric values. More than 10,000 matching records returns an explicit error with no partial report. Narrow filters to proceed.

These reports do not calculate charges, arrears/balances owed, deposits, tax liability, owner statements or formal financial statements. Accurate balances require a charge/payment/allocation and correction model first. Current-state voids or lease edits can change a newly regenerated prior-period report; archived period closes/history are future work.

## Verification and dev acceptance

Automated checks cover full-filter totals beyond 50 rows and 32-bit sums, void inclusion/exclusion, date boundaries, empty results, tenant/role isolation, current revocation, timezone boundaries, inclusive lease dates, report limits without silent truncation, exact/safe CSV exports, client snapshot/export consistency and company-change clearing. Property creation covers concurrent replay, changed-payload conflict, committed response loss in a real browser, atomic audit rollback, immutable runtime identity and stale concurrent edits. Unit tests cover details, partial preservation, clearing and older fingerprints.

Local validation passed: both builds; 63 browser fixtures; 46 safe Node checks (34 server/12 client, five isolated DB suites skipped there); isolated finance/report/property14, leasing 13, maintenance9, identity/admin21 and authorization/migration40 checks. The final identity-grant migration was rechecked in the property/report, leasing and full authorization harnesses. Desktop/mobile report screenshots were visually inspected.

Local validation commands:

- `DATABASE_URL=postgresql://dummy@localhost:5432/dummy npm run build`
- `node --test server/tests/*.test.mjs` and `node --test client/tests/*.test.cjs` (DB suites skip without their explicit isolated URLs).
- `./node_modules/.bin/playwright test -c playwright.onboarding.config.ts --workers=1 --reporter=line`
- `node scripts/test-finances.mjs`, `node scripts/test-leasing.mjs`, `node scripts/test-maintenance.mjs`, `node scripts/test-users.mjs`: each verifies a new cached-image, tmpfs/no-volume, ephemeral loopback database and cleans only its own resources. Finance suite includes property/report cases.

After an approved merge and user-run **dev** deployment, manually test as owner-a/manager-a in FAP: create/edit a complete property and studio unit, reload to verify persisted details, try concurrent edits in two tabs, record a lease and received/paid entries, generate/filter/export reports, void an entry and regenerate. Confirm resident-a1 can submit and view their maintenance while remaining unable to access management records/reports; confirm Company B cannot see FAP records. Existing real owner/manager login/forms were user-confirmed on main `0a60d20`; this new slice has not been deployed or accepted against real accounts.

Migration `202610150011_property_unit_details` adds nullable detail fields, property versions and creation identity plus checks/grants; it does not modify existing records' business details. No Terraform/Auth0 configuration changes. Backend and frontend must use the reviewed release together because new property creation requires a submission key and edits require a version. Obtain approval before merge. The user runs deployments; do not change shared/live databases for testing.

## Next increments

After dev acceptance: rent charges/payment allocation and balances with a reconciled transaction model; richer maintenance coordination and completion history; private authorization-controlled documents; then reporting periods, reconciliation, backup/restore and operational acceptance. Prioritize complete owner workflows and verified data before expanding report names or feature counts. No third-party-owner trust accounting or payment processing is introduced here.

Reference boundaries: [DoorLoop tenant reports](https://support.doorloop.com/en/articles/10609206-tenant-reports), [Intuit cash/accrual reporting](https://quickbooks.intuit.com/learn-support/en-global/help-article/product-preferences/choose-cash-accrual-accounting-methods-reports/L64yocn6B_ROW_en), and [OWASP CSV injection](https://community.owasp.org/attacks/CSV_Injection).
