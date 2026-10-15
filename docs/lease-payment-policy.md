# Lease payment policy and collections

Branch `codex/lease-payment-policies`, based on main `5750db6` (merged PR24). Development only; merge approval and user-run deployment remain required.

## Behavior

- Lease create/edit forms include rent due day (1–31), grace days (0–30) and optional resident-visible payment instructions (1,000 characters). Existing leases default to day 1/zero grace; existing posted due dates are unchanged. Older clients omitting the new PATCH fields preserve configured values.
- Due-day defaults clamp to the last day of short months. Manual charge due dates remain editable and may precede move-in; the rent/service month must still overlap the lease term. A deposit is not a monthly rent charge.
- Grace means full calendar days **after** the due date, using the company's business date. Due November 1 with five grace days is within grace through November 6 and past grace November 7. No hourly cutoff, holiday or business-day adjustment is inferred. Forms preview dates before saving/posting.
- A charge snapshots grace days when posted, under the existing lease-version fence. Later policy edits affect new charges only. Runtime grants prevent rewriting saved grace terms. Pending browser retries retain original reviewed terms and request identity, including after reload. Definitively stale lease versions require a fresh review.
- Current balances distinguish upcoming, due today, within grace, past grace, paid and voided. Past due means before today's company date; it includes unpaid charges within grace. Aging is based on original due date: 1–30, 31–60, 61–90 and 91+ days. Partial payments reduce the unpaid amount; voided receipts restore it. Voided charges are excluded.
- Rent account filters and CSV exports include collections/aging. An age filter selects accounts with money in that band; displayed/exported totals describe all charges for those matching accounts, as the UI explains. Overview collections totals aggregate the full company/property dataset independently of display caps; links open the matching collection view. Existing account-view safety caps remain fail-closed.
- Residents see their own permitted lease/payment terms and saved charge grace, without manager actions or internal payment memos. Staff and platform-only users do not gain financial access.

These are current unpaid snapshots, not historical as-of accounting statements, automatic late fees, reminders, notices, scheduled billing or legal conclusions. Policy edits are audited without copying instruction text into the audit. No automatic charge or external communication is enabled.

## Release scope

Additive migration `202610150013_lease_payment_policy`; no Terraform or Auth0 changes. Tests use disposable local databases only. No shared/live database was changed. The user approves merge and runs the normal development deployment after approval; this document is not deployment authorization.

## Manual acceptance after deployment

1. As FAP owner/manager, edit a lease: choose due day 31, five grace days and instructions. Save/reopen; confirm the exact calendar example and success feedback. Check mobile form/footer usability.
2. Post a permitted month's charge and review its due/grace dates; February must clamp correctly. Do not use rent posting for deposits. Confirm the resident sees instructions and the saved terms.
3. Set a test charge's agreed due date far enough in the past to span grace. Check Overview → follow-up → account → charge, property filters and aging CSV. Confirm grace does not add a fee.
4. Record a partial receipt and confirm unpaid/aging decrease once; void the receipt and verify they restore. Edit the lease grace policy and confirm older charges retain their original grace while a new month's charge uses the new value.
5. Verify resident isolation, staff denial and Company B isolation. Browser fixture and disposable database checks do not replace this real-account pass.

## Local verification

Client/server builds pass. Safe Node suite: 50 passed, five database suites skipped there and run separately. Browser suite: 81 passed, including desktop/mobile collection drilldowns, shared resident terms, lease policy forms, and lost-response retry with original reviewed policy. Disposable PostgreSQL checks: finance/reporting/rent/payment-policy 44, leasing 13, maintenance 9, users 21 and access integration 40. Checks cover grace boundaries, company timezone dates, leap/short months, aging reconciliation, partial receipts/voids, current role boundaries, audit rollback, immutable charge policy and concurrent lease-policy edits versus posting. No authenticated live-account acceptance was performed.

## PR review correction

PR25 review identified that the rent-list safety-cap error hid the property selector. The selector now loads independently of rent data, allowing a manager to narrow the failed query without showing fabricated totals. A browser regression starts with a capped response, selects a property and verifies recovery. Original-head CI passed; final-head CI must be checked after this correction.
