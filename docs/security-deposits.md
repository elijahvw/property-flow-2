# Refundable deposits and property workspaces

Development increment, 2026-10-15. Based on main `fbc82f5` (PR28 merged by the user). This is implemented review scope, not deployed acceptance.

## Connected workflow

Owners/managers open a lease's Rent ledger → Set up deposit → review agreed refundable amount and independent due date → save. The due date may precede move-in. A draft lease may have a planned requirement, but it must be activated before recording money. Future active leases may receive deposits before their term starts.

Record deposit received opens a focused form for amount, actual received date, method and optional private reference/note, followed by a money review. The Deposits directory shows requirements, recorded held amounts, uncollected and past-due amounts, including excess held above a reduced requirement. Residents see their own authorized nondraft lease's requirement and receipts; private notes/references, management revisions and correction reasons are excluded by the API.

Changing the requirement needs a reason and current versions. Every revision is immutable. Correct deposit receipt explicitly voids a recording error while keeping the original receipt/cash source/audit. This is not a refund. Reduced requirements and excess receipts do not silently move money or become rent credit.

Property tabs now stay under `/company/properties/:propertyId/{leases,maintenance,rent,deposits,finances,reports}`. The property header and tabs remain visible, the Properties sidebar stays selected, forms and API filters retain that property, and an explicit All company link leaves the workspace. Maintenance status and finance/report filters survive refresh. Existing company-wide routes and legacy property query links remain supported. Rent/deposit/cash drilldowns retain their property context.

## Data and accounting contract

Migration `202610150016_security_deposits` adds DepositAccount, immutable DepositRevision and immutable DepositReceipt. Requirement and receipt display references use DA-/DR- sequences; current internal CUID/Auth0 identities remain intact. UI uses readable references and names, with explicit Copy internal ID; CSV keeps display and internal identifiers for accounts, receipts and linked cash entries.

Each receipt has exactly one matching LedgerEntry (`kind=deposit`, `category=security_deposit`). The source and cash row commit atomically with their audit. Composite foreign keys bind company/property/lease/account; forced company RLS and narrow runtime grants protect sources. Deferred source/snapshot triggers prohibit orphan receipts or terms without matching revisions. Cash amounts/date/creator must match the receipt, and receipt identities/history cannot be edited or deleted by runtime SQL.

Deposit cash rows have no rent lease-payment link and cannot enter rent allocations or payment credit. Finance/report operating income and net exclude deposits; separate deposit-received and net cash-movement totals include the receipt once. Generic cash void rejects these sources and directs corrections through the deposit ledger. Active deposit money also prevents demoting its lease to draft. Held means recorded nonvoided receipt total, not a verified bank balance.

Amounts use validated integer cents and BigInt aggregation; account/receipt USD limits are $1,000,000 each. Directory scopes are bounded at 1,000 accounts/10,000 receipts and fail explicitly instead of returning partial totals; detail supports 10,000 receipts and the latest 100 requirement revisions, labeled accordingly. These are current snapshots; no historical as-of report is claimed.

Mutations use actor/company-scoped durable submission UUIDs and payload fingerprints, current authority, serializable transactions, a lease write fence, reviewed record versions, CSRF/origin checks and atomic audits. Exact committed retries precede stale-version checks. Browser pending reviews survive refresh; ambiguous network/5xx/authorization failures retain their identity for authorized retry. Definitive validation/version conflicts permit returning to the preserved input. Reads share the current-user authorization lock so concurrent panels do not artificially conflict; mutations/access changes retain an exclusive fence. Current-role revocation is still checked inside each transaction.

## Validation and manual acceptance

Local evidence: client/server builds; safe Node checks; Python operational checks; complete browser suite; fresh tmpfs PostgreSQL finance/deposit, leasing, user, maintenance and access lifecycle suites. Specific deposit coverage includes concurrent retries, changed-payload conflicts, audit rollback, stale edits, forbidden future receipts, pre-move-in collection, resident privacy/current assignment, role/company revocation, immutable runtime sources, deferred guards, source/report reconciliation, excess held and lost-response recovery after browser reload. Browser cases cover property tabs/filter refresh/permissions, reviewed forms, mobile layout, complete CSV and shrinking pagination. Exact counts and hosted CI are recorded with the PR after completion.

After an approved manual merge and user-run dev deployment:

1. As owner/manager, open the same property's tabs. Confirm nested URLs, property name, restricted property choices, filter refresh and intentional All company links. Staff must be denied financial and management routes.
2. On a future lease, configure a $1,500 refundable requirement due before move-in. Review, go back, change details, save. Record $750 actually received; verify $750 held/$750 to collect and the resident view.
3. Compare rent, cash transactions and cash report: deposit does not reduce rent or increase operating income; cash source appears once with linked DR-/TX- references. Export retains both references and internal identifiers.
4. Change requirement to $500 with a reason. Confirm $250 excess remains held, no rent credit/refund and a retained revision. Correct the erroneous receipt through Deposits, confirm history remains and totals recalculate once.
5. Test current company and resident property assignment boundaries, disabled membership, and an unauthorized direct link. Test a lost-response retry in controlled dev acceptance if feasible; automated tests already exercise it against an isolated database.

No Terraform/Auth0/provider changes are required. The eventual user-run Deploy Dev release must include backend migrations and frontend; do not deploy a frontend-only cutover. This work does not deploy or modify a shared database. Inspect every PR comment/review/thread and exact-head CI, then obtain user merge approval.

## Next increments

Deposit application/refunds and itemized move-out settlement need their own immutable movement types, balances, reviewed authority and accounting/legal rules. No automatic refunds, penalties, interest, statutory deadline calculations, trust/bank reconciliation, notifications, documents or payments are activated here. Next roadmap work remains reviewed lease changes/proration, deeper statements/reports, maintenance operations and private documents/inspections; Stripe and domain setup stay deferred.

Workflow references: [TenantCloud lease setup](https://support.tenantcloud.com/en/articles/11942612-how-do-i-create-a-lease). The separate refundable-deposit treatment is consistent with [IRS rental-income guidance](https://www.irs.gov/taxtopics/tc414); nonrefundable fees/advance rent require separate categories and are not disguised as deposits.
