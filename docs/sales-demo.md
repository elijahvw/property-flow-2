# Automatic sales demos

PF-30 sales demos after merged PR61/PR62. Migration `202610250055_automatic_demo_accounts` follows054; fixture version4 retains real role logins and an occupant household record, and adds a future planned move-out. No cloud infrastructure, new application secret, pricing or payment activation is added. Deployment and actual Auth0 account acceptance remain user-controlled.

## Create and present

Open platform **Companies → Manage sales demos → Build sales demo**. No user selection, manual Auth0 creation or verification-email step is required. The backend provisions eight role logins plus three prepared tenant identities without portal access, then builds one fictional source-linked company. Passwords are issued only for the eight role logins. The credential panel shows each account's email and a unique generated password:

| Role | Example person and scope |
| --- | --- |
| Owner | Full company operating access; no platform authority |
| Manager | Normal management access; no owner-only team/listing controls |
| Staff technician | Explicit maintenance execution and selected-property access; assigned upcoming work and completed history |
| Residents / leaseholders | Four distinct households with scoped rent, deposits, lease history, notifications and maintenance |
| Occupant | Recorded member of the first household, with portal approval and property assignment; no lease financial access |

Passwords start masked. **Show passwords** reveals them; **Close credentials** clears the panel. After refresh, an authorized platform owner can use **View role logins**. Credentials are not saved to browser storage or included in ordinary demo lists. Use the normal sign-in screen to present each role. Email verification is set to true only when these marked demo identities are created; `verify_email:false` suppresses verification delivery. Normal accounts retain their existing verification/setup rules. Tenant-level MFA and other Auth0 sign-in policies still apply.

Each new demo uses a random generation identifier, generated `@sales-demo.invalid` addresses, per-account passwords and an Auth0 `app_metadata.property_flow_sales_demo` ownership marker. A matching email alone is never enough to reuse, change, verify or disable an account. Provider operations require the existing configured Auth0 Management API connection and its existing read/create/update-user scopes. No verification/password email, payment, electronic signature or screening provider is invoked by demo setup.

## Recovery and teardown

Auth0 calls run outside database transactions. Before any provider write, the server durably records the generation, submission identity and encrypted credentials. A short database transaction claims a bounded five-minute operation lease; each provider step renews it. Exact generation markers recover provider success after a lost response. Fresh platform authority is checked between steps. A failed source/audit write rolls back the entire business graph while keeping the setup and owned identities available for retry.

If setup is interrupted, retry the original form or select **Resume demo setup** under **Unfinished setups**. Confirmed accounts bound to the current Auth0 issuer are reused from durable progress: a setup with ten such accounts prepared calls Auth0 only for the missing eleventh account. Earlier pending migration055 setups did not store that issuer, so their prepared subjects are checked once through the paced provider before being reused; subsequent resumes skip them. A changed recorded issuer stops resume before any provider call and requires restoring the original Auth0 connection. Completed retries return the same generation and passwords. Concurrent setup/teardown returns a useful busy conflict. After a process crash, a lease can take up to five minutes to expire before retry is allowed. A stale browser cannot silently create a second copy through the original submission.

Demo token, lookup, create and block calls share a paced lane in each server provider instance, with at least one second between requests. HTTP 429 retries honor the later of `Retry-After` (seconds or HTTP date) and `X-RateLimit-Reset`, with exponential fallback and at most three retries per request. The lifecycle shares a 110-second provider deadline, retaining room for the 60-second source transaction within the browser's three-minute budget. Other replicas may still encounter the shared tenant limit; their 429 responses use the same bounded recovery. Ordinary account operations retain their existing behavior.

If Auth0 stays limited beyond the budget, the visible error explains that progress/passwords are saved. Wait for the provider cooldown, then resume that setup rather than building another generation. No teardown, new password or manually created account is needed. Resuming an existing migration 055 setup requires no data conversion. Pending version 3 setups remain compatible; the current version 4 fixture also adds a future planned move-out example. If limits persist beyond a cooldown, inspect Auth0 tenant Management API rate-limit status and the application's sanitized `DEMO_IDENTITY_BUSY` response; do not capture credentials, tokens or provider bodies in diagnostics. Permission failures remain separate and are not retried as rate limits.

**Tear down demo → Confirm teardown** first suspends the demo company, disables its generated local users/memberships and revokes company and support sessions atomically. It then blocks only the exact marked Auth0 identities. If Auth0 is unavailable, local access stays disabled and **Teardown needs retry** remains visible. Retry finishes provider cleanup, including an ambiguous create whose subject was not yet recorded. Successful teardown removes the encrypted credential payload. Source, cash, document and audit history is retained. Build a new demo for fresh accounts/data; an old teardown cannot affect it.

A generated account moved to another company or given platform authority blocks credential reveal and teardown until its assignment is reviewed. Those actions never change a customer's assignment or identity. Version-one demos remain listed for retirement: their existing presenter account is released and preserved, rather than disabled in Auth0. Rebuild them through version4 for automatic role logins.

## Linked fixture coverage (version 4)

| Area | Connected source examples |
| --- | --- |
| Accounts and access | Verified role logins; Jamie Wells has an active offline lease and no portal membership/issued credentials/sign-in history; Drew Patel has an unaccepted invitation with no email delivery; Robin Lane is an archived former tenant |
| Portfolio | Two populated properties, active/vacant/turnover units, an archived storage unit, imported inventory, separately reviewed readiness and explicit owner listing intent |
| Leasing/households | Four online households, a non-portal active tenant, primary leaseholder plus approved nonfinancial occupant, a draft renewal, a future planned end for the offline tenant with occupancy still active, an ended lease and personal saved lease task |
| Rent/collections | Three months of charges and receipts, paid/partial/unpaid balances, calendar proration for mid-month move-in, parking concession, corrected/reversed credit and unapplied cash credit |
| Deposits/move-out | Held and pending deposits; reviewed repair charge and settlement, deposit application, manual refund linked to cash outflow, retained ended-lease ledger and archived tenant history |
| Billing schedules/terms | Upcoming recurring rent, a paused rent schedule and future-effective terms |
| Maintenance | Resident intake, private team notes, shared updates, resident reply, assigned upcoming staff work and accepted/submitted/approved completion history, vendor contact and reused paid-expense source |
| Preventive/calendar | Active due safety schedule and a paused filter-service schedule, source-linked work dates and tour follow-up |
| Pipeline | Draft, approved and rejected manual applications, complete decision history, ready-unit prospect and dated tour; no external screening result |
| Imports | Committed unit and paid-expense imports, retained source/results, invalid unit-row preview and duplicate expense-source preview requiring correction |
| Documents | Quarantined sample, an exact bundled inert text original, explicit owner share, resident received/download history and archived original |
| Inspection/agreement review | Submitted inspection, completed move-in baseline and comparative move-out review; unsigned draft and reviewed agreement preparation with exact intended signers/original |
| Personal notices | Read/unread management notices, requester/staff deliveries, source links, preference/history example and opted-out work notices |
| Reports | Statement, collections, historical cash, property/portfolio totals and exports from the same charges, receipts, refunds, corrections and import sources |
| Platform controls | Generated roles are actual support-view targets; company profile/features/usage remain available to the existing platform administrator. Pricing is unconfigured until the administrator chooses a real configured plan; no global plan prices, fake SaaS invoices or support grants are invented |

All entries in the shipped company feature catalog have representative linked sources, enforced by the coverage regression. `DEMO_FEATURE_COVERAGE` and this matrix must change when new feature areas ship. Individual screens can show useful missing/pending/archived states; the demo does not pretend every provider or future feature is activated.

Only the exact bundled UTF-8 text constant is cleared by the private factory's deterministic content validator. It contains no active content and is labeled a fictional original. No live ClamAV result is claimed. Other originals remain quarantined until the real application scanner checks them; normal user uploads always use the configured application scanner. Reviewed agreements remain unsigned. Provider-backed collection, signatures, external messages, screening, bank reconciliation, and unimplemented roadmap features are not fabricated.

For a sales walkthrough, sign in as owner and compare **Tenants**: Jordan (online leaseholder), Jamie (offline active lease), Drew (invitation pending), Robin (archived, ended lease and settlement). Follow Jamie's lease to partial-month rent, pending deposit and a future planned move-out; its lease remains active until the final ending is reviewed. In **Move-out & settlement**, choose a future date to carry it and the reason into **Review end date**, check the effects, and save the plan. Final settlement follows the actual departure. Follow Robin's lease through baseline/move-out, itemization, applied deposit and refund source. Show Jordan's concession/correction and excess cash, then shared original/receipt history and unsigned reviewed package. Use the application/import lists for approved/rejected and validation/recovery cases. Sign in as resident and occupant to compare financial/document access, and as staff to show selected-property assigned work. Manager has operational queues, read/unread notices and saved preference history; owner-only actions remain denied.

## Credential protection and maintenance

The existing `AUTH0_WEB_CLIENT_SECRET` derives a separate AES-256-GCM key through HKDF with a demo-specific purpose. Random nonces and the generation ID as authenticated data prevent cross-generation substitution. Passwords are encrypted in `SalesDemoSetup.credentialsCipher`; they appear only in authenticated, CSRF-protected, freshly authorized, audited POST responses with `Cache-Control:no-store`. Lists, audits, telemetry and provider DTOs exclude passwords. App/client secrets are never returned. Initial generated passwords may stop working if changed separately in Auth0; rebuild to reset the demo.

Retain the application secret while existing encrypted credentials are needed. Rotating it makes older credential payloads unreadable; restore the prior secret or tear down/rebuild. Teardown can block known demo identities without decrypting passwords. No plaintext passwords, dumps or credential artifacts belong in Git or diagnostics.

Keep the seed, coverage matrix, identity lifecycle and role-access regressions current as features change; bump `SALES_DEMO_SEED_VERSION` for fixture changes. Never upgrade posted demo history in place. The no-login examples have no company membership or issued password; account preparation alone never grants portal authority. Fixed browser operations are `sales_demo.create`, `sales_demo.teardown` and `sales_demo.credentials`; source/setup/reveal/retirement audit events contain safe identifiers only. Standard request failure/duration monitoring covers the platform endpoints. Use `node scripts/test-sales-demo.mjs` for disposable API/browser validation and the provider/credential unit tests. These checks simulate Auth0 and do not establish live provider or deployed acceptance.
