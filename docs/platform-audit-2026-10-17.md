# Property Flow platform audit and proposed work

October 17, 2026. Proposal only. No product changes, invitation sends, access changes, migrations, merges, deployments or live configuration changes were made for this audit.

The app has a coherent visual foundation and substantial connected property, lease, money and maintenance workflows. The highest value work is to simplify how users finish those jobs, resolve invitation/access defects, and add help and first-login guidance. Preserve the existing financial history, exact identity bindings, tenant records and permission boundaries. A framework rewrite or broad feature expansion is unnecessary.

## Audit scope and evidence

Reviewed the active checkout's route/capability map, shared authentication/forms/resource loading, property/unit/tenant directories, both tenant detail representations, team/platform/company administration, invitation creation/setup/acceptance, household access, leasing and transitions, rent/billing/recovery, deposits, cash activity, statements/reports, maintenance/delegation/documents, existing feature contracts and operational coverage.

Read-only browser review covered the deployed owner's overview, team and invitation form, properties/property detail, leases/lease detail, rent, deposits, cash-entry form, reports and maintenance. Inspected the property workspace at 390 × 844 and restored the viewport. The user's existing tenant invitation result and other tabs were preserved. Manager, staff, resident and platform behavior was assessed through source and isolated UI fixtures; their real provider journeys still require acceptance.

Current checks: both production builds pass; 179 UI fixture checks pass; 69 server and 25 client Node checks pass; 80 operations checks pass. Five database integration suites were intentionally skipped with all test database variables unset. Local-listener checks passed after rerunning outside the restrictive sandbox. Logs are `/tmp/pf-platform-audit-*.log`.

An additional in-memory check against the freshly built application routes reproduced two team invitation defects without a database, provider or live access mutation. Reproduction: `/tmp/pf-platform-audit-invitation.mjs`. This confirms application behavior, not a deployed exploit or a complete security assessment.

GitHub metadata confirms PRs 44, 45 and 46 are merged. Existing local notes still describe them as pending. The deployed UI exposes documents and delegated-work controls; its exact backend release, scanner configuration and provider delivery were not verified. Treat those runtime prerequisites separately from merged code.

## First batch: invitations and user access

### A01 Revalidate team invitation authority

**Confirmed defect; highest priority.** Generic team invitation acceptance checks the recipient identity, invitation expiry and company, but does not revalidate the inviter. Membership lifecycle changes do not invalidate those invitations. The isolated route check returned success and created manager membership when the inviter was disabled and no longer an owner. The setup-email endpoint does check the inviter, so completing password setup and accepting have inconsistent rules.

Recheck current inviter authority during final acceptance and invalidation/replacement, including company ownership changes, disabled users/memberships and company suspension. Keep platform/company authority distinct. Test both orders of an acceptance/revocation race.

Evidence: `server/src/application.ts` invitation routes and `clearAssignments`; compare `validContactInvitation` in `server/src/contact-invitations.ts`.

### A02 Make invitation retries and replacement dependable

**Confirmed defects and recovery gaps.** The generic team acceptance path returns `403 INVITATION_INVALID` after a prior successful acceptance, unlike contact/lease acceptance replay. A lost success response therefore looks like failure. Team creation has no durable submission key or pending-invitation deduplication, and its one-time URL disappears when the form/page is lost. Its list exposes revoke but no replacement/resend action and silently shows only the latest 100 records.

Return a safe already-accepted result only for the original recipient and intended current membership; never use replay to restore or broaden access. Deduplicate creation retries and provide explicit replace/resend/revoke actions with complete, paginated history. Rotate secrets rather than making old private tokens retrievable. Apply one consistent lifecycle to team, tenant and household entry points while preserving their different approval rules.

Evidence: `client/src/pages/Workspace.tsx` InvitationForm, Invitations and AcceptInvitation; `server/src/application.ts` generic invitation routes.

### A03 Deliver an understandable invitation journey

**Confirmed product gap.** Current invitations require the owner to copy/share a private link. The recipient then requests password setup, leaves for email, signs in, verifies status as needed, and accepts. Team acceptance does not preview the company and role; tenant and lease invitations have richer reviews. The UI exposes internal terms such as Auth0 account preparation throughout routine user flows.

Offer an actual invitation email with an application link, clear delivery/request status, retry and copy-link fallback. Use one recipient page that identifies the company, purpose and proposed access, then shows only the next required step. Recognize an existing/verified account, give wrong-account users a clear switch-account action, and explain expired/revoked links with a recovery path. Keep approval and verified identity checks. External delivery needs a real provider integration and acceptance; requesting an email must not be labeled delivered.

Acceptance: a new and existing team member, tenant, leaseholder and occupant can each finish from their actual inbox; expired/replaced/wrong-account/provider-failure cases recover without duplicate accounts or unintended grants.

### A04 Present one clear person and access workspace

**Confirmed usability fragmentation.** Tenant details render through contact-based and user-based workspaces with different account controls. Property Residents manages property access, while Tenants, household membership and portal status carry separate decisions. Team management has no search/filter/pagination experience. Staff property scope and maintenance authority are separate forms; saving one closes the editor.

Use a consistent tenant presentation with clearly named sections for contact details, rental/household records, portal status and access. Keep Team separate because employee and tenant jobs differ. Show account existence, verification, invitation, membership and property/lease access as distinct understandable states with a next action. Give Team search/status filters and a focused access editor that lets the owner complete property scope and optional maintenance authority without reopening it. Add a deliberate conflict-resolution path to existing records; never merge identities by email or replace historical source IDs.

Keep manager requests/owner approvals explicit. This is presentation and workflow consolidation, not a new customizable permissions system.

Evidence: `ResidentProfiles.tsx`, `ResidentDetail.tsx`, `ContactDetail.tsx`, `PropertyResidents.tsx`, `LeaseHousehold.tsx`, and Team/StaffPropertyEditor in `Workspace.tsx`.

## Second batch: onboarding, help and interface clarity

### A05 Add first-login guidance by role

**Confirmed missing capability.** There is a first-property empty-state prompt and contextual lease setup, but no first-login walkthrough or persisted tour progress.

Add a short, skippable, resumable walkthrough after successful sign-in/acceptance. Owners/managers learn the property → unit → tenant → lease path and daily overview. Residents learn their rental, money visibility, profile and maintenance requests. Staff learn property scope and assigned work where granted. Use actual setup state, avoid repeating completed tasks, and provide Replay walkthrough in Help. Persist completion per user/company with a simple version. Do not force a tour on every login or block urgent work.

Evidence: `OwnerOnboarding.tsx`, `LeaseDetail.tsx`, `AuthContext.tsx`, route map and schema.

### A06 Add a task-based Help Center

**Confirmed missing capability.** Repository documentation exists, but no in-app Help Center route/navigation or contextual help destinations exist.

Start with lightweight, versioned articles and simple search. Cover getting started; invitations/password setup/sign-in; people/roles; properties/units; tenants/households; leases/renewals/move-out; rent/billing/corrections; deposits; maintenance; documents; reports/exports. Add Help to the shell and relevant task links beside confusing actions. Make general sign-in/invitation help accessible before login. Articles should explain prerequisites, steps, expected result and recovery, with links into the actual app. Keep permissions accurate and clarify recorded versus transferred money. An external CMS or AI assistant is unnecessary for this first version.

### A07 Reduce redundant navigation and inconsistent wording

**Confirmed usability issue.** Property navigation exposes nine destinations; leases expose eight. Labels vary between Tenants/Residents, Rent & balances/Rent & charges, and Finances/Manual finances. Source history is useful, but equal emphasis on every possible action increases reading and choice.

Use consistent language and one primary action per task state. Retain contextual shortcuts when they save navigation. Group occasional lease changes and administration behind clear secondary navigation. Rename cash activity to explain its purpose. Keep property/lease context, current filters, source drilldowns and return links. Replace repeated technical explanation with concise inline guidance and Help links; retain consequence summaries before financial or access changes.

### A08 Improve the mobile shell and dense views

**Confirmed visual issue; refinement.** At 390 × 844, the account/sign-out area and top bar occupy roughly the first 250 pixels before the property context/content. Long contextual navigation requires horizontal discovery. Existing mobile, dialog and focus fixture checks pass; that does not make the layout efficient.

Move account actions into a compact menu, shorten mobile chrome, make the current context and available sections obvious, and keep the next task visible sooner. Refine long financial panels, filters, table actions and small supporting text. Preserve the current visual identity and semantic/focus behavior. Check keyboard, zoom and touch as well as screen width; avoid a wholesale redesign.

### A09 Preserve the user's destination through sign-in

**Confirmed source behavior.** Except for `/invite`, sign-in always returns to `/dashboard`, even when initiated from a protected record link or expired session.

Restore the authorized record/task after sign-in using a strictly validated internal return destination, including only safe context parameters. Keep existing durable drafts and retry keys, provide a visible resume state, and clear user/company private state on identity changes as appropriate. Do not weaken redirect validation to retain arbitrary URLs.

Evidence: `AuthContext.tsx` signIn, `ProtectedRoute.tsx`, `access.ts` safeReturnTo and existing scoped draft components.

## Third batch: finish daily jobs with fewer detours

### A10 Turn the overview into an actionable work queue

**Confirmed usability issue.** Needs attention shows rent-past-grace and maintenance follow-ups even when their counts are zero. It already links drafts, lease endings and resident approvals; build on that foundation.

Show only actual outstanding work, with an explicit clear state. Include pending resident approval, maintenance completion awaiting review/overdue targets and billing problems where the underlying records establish them. Prioritize urgency and link directly to the right filtered task. Keep informational portfolio metrics separate. Start with live record-derived tasks rather than building a general notification/workflow engine.

Evidence: `Overview.tsx` attention-list and `server/src/overview.ts`.

### A11 Make property, unit and lease setup a connected checklist

**Refinement of existing implementation.** Reviewed lease creation, tenant reuse, household controls, billing recovery and linked renewal transitions already exist. They should not be rebuilt.

Surface the current missing prerequisite and its exact next action from the record: add unit, choose/create tenant, review lease, add household, optionally invite, configure billing and deposit. After saving, return to the same job. Make active lease, portal activation and recurring billing clearly separate states. Show setup only while incomplete. Bring the existing renewal/end/settlement blockers into a readable completion sequence with visible resulting state.

Acceptance: both an existing tenancy and a new tenancy can be entered without prior tenant sign-in; renewal and move-out finish while preserving old charges, documents and deposit sources.

### A12 Route financial entry by the user's intent

**Confirmed confusion risk.** Manual finances defaults to unlinked income categorized as rent, while Rent & balances records lease-linked payments. A user can record rent in the wrong place and leave the lease balance unchanged. Deposit setup sends the user to the rent directory to choose a lease.

Provide clear entry actions for rent payment, deposit receipt, other income and expense. Route lease money to its ledger and show that linked receipts already appear in cash activity. Let deposit setup choose its lease directly. Keep one underlying financial record and the existing correction/review/retry rules. Make outstanding rent, cash received, unapplied cash, noncash credits and refundable deposits understandable without repeating long explanations on every screen. Do not infer a bank balance or claim the app moved money.

Evidence: `Finances.tsx` header and new-transaction form; `Deposits.tsx` setup link; existing rent/deposit/ledger server contracts.

### A13 Finish the maintenance operating experience

**Refinement; delegation is already implemented.** Management intake, requester-visible updates, paid-cost sources, staff assignment/acceptance and completion review are present. Existing updates do not notify their audience.

Make unassigned, awaiting acceptance, in progress, due/overdue and awaiting review work immediately findable; add focused assignee/date filters and clear next actions. Present assignment, work stage and request status together without conflating them. Make shared updates and internal notes unmistakable. Start with a small in-app activity/attention surface for meaningful changes; add external notifications only with actual delivery/retry behavior. Vendor contacts can follow when required by real work, without introducing procurement/accounting scope.

### A14 Make document upload complete a usable job

**Confirmed source prerequisite; live configuration unverified.** Private originals/versioning, quarantine, scan and audited download exist. Scanning is a separate manual action. A configured maintained ClamAV executable/definitions is required, and the release notes do not establish that it is running. An unconfigured scanner correctly leaves every upload quarantined.

Show scanner availability before promising usable uploads, configure/verify the runtime, and make normal upload proceed through scanning with visible pending/success/failure state and a recovery action. Retain quarantine on any failure. Keep version history available but collapsed by default. Management-only access remains the current scope; deliberate resident/staff document sharing is a separate permission-aware increment if needed. Do not start with an object-storage migration or signature provider.

Evidence: `PrivateDocuments.tsx`, `server/src/document-scanner.ts`, `server/src/private-documents.ts`, `docs/private-documents.md`.

### A15 Make reporting easier to find and repeat

**Confirmed limited surface; existing correctness should be preserved.** Reports offers cash income/expenses and lease register. Balances/aging, deposits and statements live in other modules with their own exports.

Offer useful report presets and direct links to existing balances/aging, deposits and statements. Add simple date presets and remember safe filters. Keep generated/exported snapshots aligned and preserve source drilldowns. Explain the report's date basis; historical as-of accounting, bank reconciliation, investor reporting and a report-builder engine remain separate future work.

### A16 Improve administration visibility without expanding authority

**Refinement.** Company owner setup, role guidance, pre-login account provisioning, membership editing and filtered user history already exist. Some history/directory views are capped, and the platform directory performs full provider reconciliation on mount/focus/interval.

Keep platform administration visibly distinct from company operations, add a clear owner-setup/access status, and replace ambiguous conflicts with actionable explanations. Paginate/filter histories before promising a complete view. Measure provider synchronization and duplicate requests; use bounded refresh/cooldown only if measurements justify it. Preserve automatic discovery and fresh server authorization. A user belonging to multiple companies is a separate data-model decision, not a quick switcher UI.

## Acceptance and release batch

### A17 Verify real journeys and recoverability

**Required acceptance, not a proven outage.** Passing fixture checks does not validate real Auth0/email delivery, deployed migrations, scanner definitions, recurring jobs or operational recovery.

Use dedicated identities to verify owner, manager, read-only staff, delegated staff, leaseholder, occupant, unverified and disabled states. Cover new/existing/expired/replaced invitations, wrong-account login, refresh/back/phone layout, interrupted saves, duplicate retries, concurrent access edits and revocation. Verify a new company setup, established portfolio, lease renewal/move-out, manual rent/deposit correction, maintenance review and document clearance/download from their actual sources. No real customer financial/access mutations are needed for this acceptance suite.

Confirm deployed release/migrations/provider configuration, real browser-to-API telemetry, actionable alerts and restore/recovery evidence. Reconcile stale release notes with the verified merged/deployed state. Use existing monitoring/performance infrastructure; do not add speculative caches, microservices or new tracing vendors.

## Recommended sequence and scope boundaries

1. **Access and invitation repair:** A01–A04, with actual provider journey acceptance. These contain the confirmed access/recovery defects and the user's most immediate pain.
2. **Guidance and clarity:** A05–A09, building walkthrough and Help around the corrected invitation/access behavior.
3. **Daily operating refinements:** A10–A16 in small complete workflow batches. Reuse the existing leasing, finance, maintenance and document implementations.
4. **Acceptance for each batch:** A17 accompanies each release; it is not a final cleanup phase.

Preserve the existing modern shell, correct shared source records, immutable history, tenant/staff boundaries, consequential reviews and useful contextual shortcuts. Defer broad custom RBAC, a CMS, AI support, generalized automation, full accounting/bank reconciliation, large imports, listings/applications, inspection/signature systems and preventive calendars until a defined operating need justifies them. Subscription and tenant payment processing remain last.

The user approved implementation on October 17. See [local implementation and remaining activation/acceptance](platform-workflow-improvements.md). The findings above remain the original audit evidence; local implementation, merge, deployment and real-provider acceptance are distinct.
