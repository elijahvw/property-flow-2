> Status reconciled October 20, 2026: use [current platform status](mvp-status.md) and [the roadmap](product-roadmap.md) for delivery and remaining scope. Dated branch/release/test/limitation statements below are historical checkpoints, not the current deployment or acceptance state. No historical pass is promoted to real-account acceptance.

> October 17 account policy: new tenants and every leaseholder/occupant require a precreated or existing Auth0 account, including people who have not signed in. Portal access still needs the existing membership/property/role approvals. Earlier references below to recording new participants without an account are superseded. Historical records remain intact. See [resident accounts](resident-contacts.md).

# Connected lease, household and invitation workflow

Development increment, 2026-10-15, branch `codex/lease-households` based on the tested tenant/forms PR #33 (`7207bb9`). This implements PF-02 and the initial shared-household portion of PF-11 following the user's explicit request to bring household support and a coherent onboarding/renewal flow forward. Merge and dev deployment remain manual and user-approved.

## Workflow

Record lease → review rental/terms → permanent `/company/leases/:leaseId` workspace → household → invitations/owner approvals → terms/activation review → deposit and rent/billing sources. The workspace provides named sections, clear next steps, exact copied URLs, an existing-property breadcrumb, and return paths from source ledgers. Tenant/filter and lease-directory context survives the relevant drilldowns. Overview lease-ending links open the specific lease's renewal section.

Current lease creation and renewal review, durable submission identities, term validation, manually posted money, recurring billing, corrections, reports, contact/access management and role gates remain. Existing directory actions are retained. This does not add automatic document signing, payments, proration, deposit refunds, or coordinated end/activate/billing transitions.

New lease setup shows rental/terms, review/record, then household/invitation/billing stages. A successful creation opens the household section instead of abandoning the user in a directory. PF-03b permits a company-owned tenant profile as primary without a login. Selecting an active linked tenant explicitly connects their current resident account to the property; the review explains the access. Additional household records already support names/contact details without a login. No guessed email matching merges records or grants authority.

## Household and owner control

One lease and unit can contain multiple leaseholders and occupants. Each record has a name, role, start date, optional end date/email/phone, optional explicitly linked account, current version and removal timestamp. End dates are inclusive. Emergency contacts remain on the contact profile and are not household members. The existing lease's rent/deposit sources stay on the lease; participant count does not multiply rent or allocate individual shares.

Owners add/edit/remove residents and choose a current leaseholder profile as primary contact. Removing a resident immediately revokes this lease's financial/invitation access and retains the original record and audit history. Other leases and separately assigned property access are not silently removed. Managers retain existing lease operations and can read households/request invitations; they cannot approve new residents or mutate the roster. Removed records are historical; re-entry/merging timelines and a full contact model remain PF-03/PF-11 follow-up work.

Existing primary residents are backfilled into the roster while retaining exact User/Lease/source identities and terms. New leases create their primary roster entry atomically. Primary-contact changes retain former parties; removal is a distinct reviewed action. Management tenant workspaces include linked household history and label shared totals as lease totals rather than personal shares.

Current verified, active company residents with current property access can read the shared rent/deposit sources when they are an approved linked leaseholder whose recorded end date has not passed. Upcoming leaseholders can review deposits/balances before move-in. Occupants never gain financial access through a household record. Additional leaseholders cannot read draft renewal finances. Current primary access remains compatible, including existing future/ended records, unless the primary is removed or their recorded end date passes. All existing tenant self-service privacy projections remain in place.

## Invitations

Resident lease and invitation history is view-only. Residents contact their property manager for household changes; both resident invitation creation and cancellation return a fresh-authorized 403 without modifying records. Managers can request invitations and cancel their own unapproved requests; owners approve/revoke requests and directly create reviewed invitations. Requests do not create roster entries, memberships, property assignments or usable acceptance links. Historical resident requests remain readable by their original requester, with changes managed by the owner. The owner Overview attention queue links directly to leases awaiting approval and preserves that filter on return.

Approved links are shown once, expire after 72 hours, and are shared manually. No email is sent by this increment. Acceptance requires the exact matching verified email, current account/company access and a currently authorized approving owner. It atomically creates or retains an active same-company resident membership, property assignment, roster entry, accepted state and audit. Existing foreign-company, staff/manager/owner, or disabled memberships cannot be transferred, promoted or reactivated by an invitation. Acceptance retries acknowledge an existing current roster entry without recreating revoked access. Ambiguous invitation creation/approval refreshes its status; if a one-time link was lost, revoke and recreate it.

Tokens remain hashed in storage and absent from list/audit responses. The existing `/invite` flow handles lease and generic company invitations; generic invitations keep their previous membership-only behavior. Lease links include a public lease hint; both the hint and token are captured/removed before monitoring. A matching verified recipient first reviews the owner company, property/unit, role, dates and financial-access meaning. Previewing creates no membership or access; acceptance remains a separate explicit action.

## Renewal

The lease's renewal section guides review of the old household, term, balances/deposit, next-term draft and the explicit old/new transition. Existing durable renewal creation is reused. A draft links back to the predecessor; the predecessor links to its existing successor instead of presenting another creation action.

The reviewed current household carries into the new draft, including record-only occupants; removed/expired parties are not copied. Copied additional participants retain their account links for identity continuity but have portal approval disabled for the new term. Owners explicitly review/approve each linked leaseholder before that person can view the new term or request invitations; draft financial access remains blocked. Household changes increment the lease version, so an older renewal review cannot silently absorb a changed roster. Charges, receipts, deposits, schedules and invitations are not copied or activated. Owners still explicitly review the new household/terms and perform the existing end/activate/billing steps. PF-10 will coordinate those financial transition operations.

## Security and form behavior

The new roster table has forced company RLS, composite lease/property/company boundaries, immutable identity/submission columns and no runtime DELETE grant. Mutations use current actor/company authorization, serializable retries, reviewed versions, target-user/lease fences, CSRF and atomic audit. All profile/lease sources remain scoped to the current company. Bounded roster/candidate/invitation responses fail explicitly instead of presenting incomplete selections.

Forms group fields with visible labels, required/optional guidance and month-name dates. Household edits focus the first field. One Manage action per roster row opens focused editing; removal requires an explicit confirmation. Section changes retain mounted household/invitation drafts, and dismissed term/renewal editors preserve their reviewed snapshot. A background refresh never silently replaces a term edit's version. Authorization failure clears the workspace and editors. Browser reload does not promise durable recovery of every unsaved household/contact field; durable lease/renewal reviewed submissions retain their existing recovery contract.

## Validation

Use the existing production builds, full UI suite and disposable PostgreSQL finance/household and leasing suites. Coverage includes nonempty primary backfill, unchanged financial sources, shared balance reconciliation, occupant denial, role/company boundaries, current verification/assignment checks, owner-only mutation/approval, pending invitations, exact verified acceptance, acceptance replay, removal replay, primary changes, predecessor/successor household carry-forward, audit rollback, deterministic owner revocation, manager/resident cancellation boundaries, explicit renewal portal review, recipient preview/acceptance, owner approval queues, draft/version recovery and phone layouts. No live database/customer record, real invitation/message or deployment is used for these checks. Local checks passed: client/server builds and TypeScript, 131 UI browser checks, 94 disposable PostgreSQL/API/browser finance/household checks, 19 leasing checks, 22 user checks, and 61 Node checks (5 DB suites skipped in that safe run and exercised separately where relevant). Whitespace and local documentation links passed. Hosted CI/review must be read against the exact PR head before readiness.

## Existing tenant on an existing lease — October 17

Company owners can open an existing lease, choose **Leaseholders & occupants → Add existing tenant**, select an active tenant from the same company's directory, and choose leaseholder or occupant. The existing tenant/account identities are reused. An earlier property assignment is not required: the final owner-authorized transaction connects an existing active resident account to that property and records its assignment audit together with the household record. Unassigned accounts still require normal portal activation. Disabled/transferred accounts remain ineligible. Leaseholder approval continues to gate shared finances; occupants receive no financial authority. Source rent/deposit records and earlier household history are retained. Failed audits roll back the household addition and any new property grant; retry reuses the same committed record.


## October 20 feature batch

Lease sections now include [Inspections](lease-inspections.md) and [unsigned Agreements](lease-agreements.md). Exact private document versions, comparison/review history, current source authority and bounded source/return context apply. [Personal notifications](in-app-notifications.md) connect review events to these sections. None signs a lease, grants household access or moves money. Review/merge/deployment/real-account acceptance remain pending for this batch.
