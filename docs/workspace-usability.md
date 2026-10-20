> Status reconciled October 20, 2026: use [current platform status](mvp-status.md) and [the roadmap](product-roadmap.md) for delivery and remaining scope. Dated branch/release/test/limitation statements below are historical checkpoints, not the current deployment or acceptance state. No historical pass is promoted to real-account acceptance.

# Workspace usability and resident profiles

This change builds on merged/deployed main `85535b3` (PR20). It is a development branch. Merge requires Elijah's approval; Elijah runs deployments. No live database, Auth0 account, grant, or deployment was changed while implementing it.

## What the walkthrough found

The signed-in dev session was owner-a in FAP. Leases, properties and Team were inspected without submitting forms. Forms, directories and sensitive actions shared long pages. Property onboarding occupied most of the first screen, user management opened below its directory, and unit/lease/finance records each exposed edit forms immediately. Textareas also lacked the styling applied to other fields. The owner checklist incorrectly said maintenance was unavailable.

The manager report has two plausible navigation causes addressed here: `/access` unconditionally rendered a pending screen after access became active, and Sign in reused the current route even when it belonged to a previous, more privileged account. Active accounts now leave `/access` for their server-selected destination. Normal sign-in returns through `/dashboard`; invitation sign-in retains `/invite`. Direct unauthorized navigation still displays an access error. Company permissions remain unchanged: owners manage Team and ownership, owners/managers manage operations and resident profiles, staff read properties, residents use their own rental/request pages.

## Product patterns used

- [DoorLoop tenant overview and edit workflow](https://support.doorloop.com/en/articles/6189780-view-and-edit-tenant-information): a selected person's overview brings together contact information, emergency contacts and access. Adopted focused resident profiles and explicit edit actions.
- [DoorLoop property creation](https://support.doorloop.com/en/articles/6085796-add-a-new-property): deliberate creation flow followed by relevant next steps. Adopted a focused property form and links from property details to units, residents, leases, maintenance and finances.
- [Rentvine property management](https://www.rentvine.com/properties): related records grouped around a property. Used the existing property detail route as the operational entry point.
- [Buildium Resident Center](https://www.buildium.com/features/resident-center/): residents have a focused portal for their own workflows. Kept resident navigation separate from company administration.

These are workflow references, not claims that Property Flow implements those products' accounting, payments, screening, documents or messaging capabilities.

## Delivered behavior

- Shared native modal editors: visible immediately, named for assistive technology, keyboard focus contained, Escape/Close returns focus, background scrolling locked, and dismissal blocked during saves. Closed creation editors retain their draft and existing submission identity; successful creation resets it.
- Focused create/edit controls for users, company profiles, properties, assignments, invitations/ownership, units, leases, maintenance and manual ledger corrections. Directories show records rather than an edit form per row.
- User management includes application display name, company access, verification/password setup help, account status and account-specific activity. Activity is filtered on the server before the 100-event limit.
- A searchable Residents directory for owners/managers, with contact name/phone, emergency contact name/phone, internal notes, current property assignments and company-specific recent activity involving the resident as actor or target. Sign-in email and company roles are not edited in the contact form.
- Company contact records live on `CompanyMembership`, not Auth0 or the global user. Transfers clear the previous company's contact fields. Bootstrap and access-administration responses use explicit membership allowlists so resident contact/emergency details and notes are only returned through company-scoped profile endpoints. Updates require the current version and create one audit event in the same transaction.
- Property search, compact onboarding, consistent textareas, a stronger navigation hierarchy, responsive forms and finance summary cards showing real totals.

## Release requirements

Additive migration `202610140010_resident_profiles` must run before the new backend serves requests. Existing memberships receive null optional contact fields. No Terraform changes or new Auth0 permissions are required. Use the existing reviewed dev release/migration workflow after merge approval. Do not run migrations manually against dev while reviewing this branch.

## Next product work

First accept these workflows with real owner/manager/resident accounts in both companies: invitation acceptance, property assignment/removal, contact editing, role restrictions, units/lease setup, maintenance submission/status and ledger corrections. The user has confirmed owner-a/FAP and manager-a invitation/login, but this is not full acceptance.

Then add useful property/unit attributes (property type, beds/baths/size) and better scoped record navigation; improve maintenance coordination with real assignees and history; introduce private documents only with private storage and authorized downloads. Payment processing, screening, notifications and company feature entitlements need real service/authorization designs and separate review. Do not add empty dashboards, fictional counts, dummy feature flags, or controls that do not persist real data.

Existing limits remain: some directories are unpaginated; property creation predates the durable-key contract used for maintenance/units/leases/finances; financial tracking is manual, lease records are not signed documents, and invitation links are shared by the operator. A full reload discards browser-only drafts. These should be addressed as bounded follow-ups, without implying missing integrations exist.

## Verification at publication

- Client and server production builds passed.
- 59 browser fixture checks passed; the final user-summary/audit refresh change also passed its focused 9-test rerun. Desktop and 390px mobile screenshots were inspected; modal focus containment, restoration and busy dismissal have regression coverage.
- 50 real PostgreSQL/API/browser checks passed across fresh tmpfs-only disposable harnesses: users/profiles21, maintenance9, units/leases12, finance8. This includes committed-response-loss replay after dismissing/reopening maintenance and finance forms, current authorization, target/actor audit filtering before limits, contact transfer clearing, stale edits and audit rollback.
- 43 safe Node checks passed (server33/client10), with five database suites intentionally skipped in the no-database unit run and exercised via isolated harnesses as applicable.
- No live authenticated acceptance is claimed for the new release. The existing deployed application was only navigated read-only; all new profile writes used isolated fixtures/databases.

Evidence logs: `/tmp/pf-usability-build-last.log`, `/tmp/pf-usability-ui-final.log`, `/tmp/pf-usability-user-ui-final.log`, `/tmp/pf-usability-users-locked.log`, `/tmp/pf-usability-maintenance2.log`, `/tmp/pf-usability-leasing.log`, `/tmp/pf-usability-finances-final.log`, `/tmp/pf-usability-node.log`, `/tmp/pf-usability-client-node.log`. Preview screenshots: `/tmp/propertyflow-property-editor-desktop.png`, `/tmp/propertyflow-resident-profile-desktop.png`, `/tmp/propertyflow-resident-profile-mobile.png`.

Automated review follow-up: excluded the new contact columns from platform user/company reads and membership mutation responses, and included resident-authored company events in resident activity. Disposable regressions exercise each affected response, same-company contact preservation and foreign-company event exclusion.
