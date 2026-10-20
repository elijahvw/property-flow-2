# Live workflow acceptance and friction log

October 20 reconciliation: PRs54–57 are merged and deployed in `1945049`; deployment run 39212763617 and subsequent Stop run 39214885405 succeeded. The app remains stopped by user direction; this PR preparation performs no live testing, account writes or provider sends. Earlier “local/release pending” paragraphs are dated checkpoints. New inspections/agreement preparation/notifications are locally verified and in this PR, with migrations038–040 still undeployed. No unchecked role/workflow acceptance below is converted to a pass.

October 18, 2026. Working record for the approved [platform audit](platform-audit-2026-10-17.md), alongside the [implementation notes](platform-workflow-improvements.md). Keep this current as each journey is walked in Chrome. This is not a claim that all workflows have passed.

## How findings are recorded

Record the user goal, starting role/state, steps, observed result, impact, smallest useful correction, priority, and evidence. Separate confirmed defects from usability observations, operational prerequisites, and test-tool limitations. A proposed fix is not implemented; merged is not deployed; deployed is not verified live. Keep private links, credentials and customer data out of this log.

Priorities: P1 blocks a core task or violates a boundary; P2 creates substantial confusion or recovery effort; P3 is a useful refinement. Fix the underlying workflow with existing components where possible. Do not add a new subsystem to solve a small interaction problem.

## Findings under follow-up

### W10 · Draft retention must be explicit — P2, user requirement

**Merged and deployed in PR52; signed-in live acceptance pending.** Previously, the shared EditorDialog kept closed editors mounted, implicitly retaining unfinished forms. Tenant/contact and several financial/profile workflows also wrote unfinished drafts or reviews to browser session storage; LeaseAdjustments wrote whenever its draft state changed. The user explicitly rejected automatic draft saving.

Required behavior: unchanged forms close normally. Closing a changed form offers **Keep editing**, **Close without saving**, and **Save draft & close** where a draft can be meaningfully resumed. Provide an explicit **Save as draft** option. No silent draft creation or retention on close. Preserve current input after an error while the editor stays open. Treat a submitted request with an uncertain response separately so retry safety and posted financial history are preserved.

The user chose **page-only** drafts. Explicit saving retains the original React form, selected files, reviewed source versions and submission key in memory. Refresh, page departure or scope changes clear unsubmitted work. Changed-form Close/Escape now asks for a choice; unchanged forms close directly. Multi-step reviews no longer persist before submission. Recovery journals for already-submitted requests remain separate and keep exact retry payloads. Mutation transport/server failures have a dedicated recovery guard: close preserves the original form/key instead of offering discard, retry uses the original form data, and draft-reset actions are blocked until recovery. Restored submitted reviews start with the same guard. Switching to another record asks before replacing an explicitly saved draft; an interrupted request must be recovered first. Local validation: client build,28client unit checks and205UI cases pass. All294 disposable integration checks pass: finance 177, maintenance42, leasing/staff30 and users45. Staff property search remains usable while interrupted permission settings stay locked; search text alone does not create a draft. Coverage includes discard, Escape, saved-draft reopen, refresh, file retention, no pre-submit storage, source-version safety, immutable interrupted retries, cross-record confirmation and independent user-management sections (including a partial submit after explicitly saving a multi-section draft). PR52 merged3cfb816 after exact-head CI39146821948passed. Frontend deployment39147366107passed; public Help Center and invitation guide loaded in Chrome afterward. No backend/infra rollout or migration was needed. Signed-in draft acceptance remains pending.

### W01 · Changed household approval has an awkward owner recovery — P2

**Confirmed live; merged/deployed in PR51; targeted live recheck pending.** Create a tenant invitation, change the lease, then choose **Send or replace invitation → Create replacement link**. The server correctly refuses the stale approval, but tells the signed-in owner: “The household changed. Ask the owner for a newly reviewed invitation.” Repeating the replacement cannot succeed. Recovery required closing the dialog, revoking the old invitation, opening Invite to portal, reviewing access again, creating a link and sending it.

Local correction: a changed-approval response offers **Review current access**, opening the existing fresh review without a separate revoke step. The existing save transaction replaces old contact links atomically. Preserve explicit owner approval, version checks, old-link invalidation and invitation history. Do not silently refresh the approved scope.

### W02 · Sending a team invitation leaves an empty creation form behind — P3

**Observed live; merged/deployed in PR51; targeted live recheck pending.** After a successful team invitation send, **Done** closes delivery but leaves the blank Invite team member dialog open. An owner must close another dialog to return to the team list, without an explicit choice to invite someone else.

Local correction: **Done** closes the team invitation dialog and returns to the list. A deliberate next invitation starts with a fresh form/key. Other embedded invitation forms retain their existing completion behavior.

### W03 · Latest document scan result is hidden with version history — P3

**Observed live; merged/deployed in PR51; targeted live recheck pending.** After leaving and returning to Documents, collapsed retained-version sections hide the current clean/rejected status and the clean-file download. The document title and version-upload/archive actions remain visible. Opening retained versions reveals the result.

Local correction: the latest scan status appears beside the document title while retained versions and downloads remain expandable. Full mobile/keyboard live review remains pending.

### W04 · First-time password setup and return to invitation — P2 review

**Confirmed journey interruption; recovery improvement merged/deployed in PR51; targeted live recheck pending.** The invited person moves from invitation to setup email to the identity provider, then back to sign-in and invitation acceptance. Owner setup worked. Manager password/sign-in landed at **Account access pending** despite a saved invitation; opening /invite recovered the correct review, then acceptance succeeded. The exact identity-provider return path remains under investigation. The local Access pending page now offers **Review your invitation** for a saved invitation; disabled accounts do not receive this prompt. Staff and resident journeys remain incomplete. On continuation, the original staff invitation survived a reset-email round trip: returning to /invite showed the correct sample company and staff role, and fresh sign-in was prepared. The human credential/acceptance step is still pending. Check email wording, sender consistency, which tab to return to, preserved destination, wrong-account recovery and verification instructions. Browser policy requiring the human to enter a new password is a testing constraint, not a product defect.

### W09 · Help search does not prioritize the named task — P3

**Fixed in PR53, merged/deployed and verified live in Chrome.** From public Help, search **rent**. The app returns 14 of 15 guides, placing **Post rent and record a lease payment** seventh after broad matches. The search functions, but does little to narrow this common task, especially on a phone. A subsequent live search for **rent payment** returned only the cash-activity guide, omitting the actual rent-payment guide. Empty search results and recovery to matching guides work.

All query words now match without requiring an exact phrase. Title matches precede summary and incidental body/audience matches in PR53; related results remain and clearing search restores the directory order. Password reset is named in the account summary. Production client build,10 focused Help/invitation browser checks,390px Chrome visual verification and the power guard pass. PR53 exact-head CI39186265460passed at a732ff9; mergedb8f4aa7. Auto plan39186932419and frontend deployment39187019964passed; backend/infra unchanged. Live Chrome searches for rent, rent payment, invitation, deposit, maintenance, password and reset password all put the expected guide first. No-results recovery and clearing to15guides passed. At390px the page fits, keyboard Tab reaches the first result, and opening that result loads the correct guide. Evidence: [live mobile search](acceptance-evidence/help-search-live-mobile-2026-10-18.png).

### W11 · Password setup email lacks the invitation branding — P2

**Observed live; open.** During staff recovery, the requested reset email arrived in the controlled Gmail alias, but came from `no-reply@auth0user.net`, displayed an Auth0 logo, exposed a technical confirmation URL and used “You have submitted a password change request!” copy. Invitations already use the verified Property Flow sender. This transition can look unrelated or suspicious to a first-time invitee. The earlier setup tab also showed only “some body keys are invalid”; requesting a fresh reset from the sign-in form produced a working password form.

Smallest correction to assess: configure the existing identity provider's supported email sender/template with clear Property Flow setup/reset wording and a return-to-invitation instruction. Keep one-time links and identity-provider credential handling. Do not build a second password system. Changing provider email configuration is still pending; no AWS Support action was taken. A fresh staff setup form is open for the human password step; staff acceptance remains unchecked.

## Fixed findings and release verification

- **W05 · Lease activation required tenant portal membership — P1.** Live creation of a prepared tenant and draft lease worked, but editing/activation failed with “Resident not found.” Fixed in PR50 by validating the canonical contact before the legacy membership path. Merged and deployed; live activation succeeded before tenant sign-in or portal acceptance. Disabled/ineligible accounts and foreign-company boundaries remain covered by disposable integration tests.
- **W06 · Activation review could retain Draft — P2.** Review found that opening/closing the ordinary editor before activation reused an uncontrolled Draft value. PR50 now remounts the reviewed status; reopen regression passes, and live activation showed Active and saved it. Merged, deployed, verified live.
- **W07 · Scanner cold start loaded old definitions — P1.** Cloud acceptance found the daemon could load bundled definitions before the updater finished. PR49 bounds initial update retries and starts the official initializer afterward; scanner failures do not stop unrelated app work. Merged/deployed. Live clean upload cleared; separate harmless EICAR upload rejected with download blocked.
- **W08 · Sandbox invitations failed under the task role — P1.** Actual sending exposed SES recipient-identity authorization missing from the narrow resource policy. Fixed with account/region identity resources and a mandatory exact branded From condition. IAM validation and negative sender checks passed; actual app invitations reached the controlled inbox. Infrastructure fix merged and deployed.

## Operational and verification limits

- **O01 · SES remains in sandbox.** Branded invitations work for the verified inbox and its aliases. Arbitrary-recipient production delivery is not enabled. Do not open or reply to AWS Support or retry production access without new user direction.
- **V01 · Final downloaded-file receipt is unverified.** Clean-file download completed the app form without an error, but the browser automation download event was not reported. This is not evidence that the product download failed. Confirm the downloaded original and export contents through the supported browser workflow before marking receipt verified.
- **V02 · Start/Stop.** Start previously passed; October 19 Stop run 39214885405 completed successfully after deployment1945049. No subsequent Start or complete resumed-role acceptance was performed during this PR. Inventory/sequence/recovery guards pass; a Stop success is not evidence of completed restore/incident acceptance.

## Workflow coverage

Each item stays open until its complete user journey and relevant error/recovery paths have been checked. Existing automated regressions support these checks; they do not replace real-account acceptance.

- [x] Platform owner creates a labeled sample company and invites its owner; correct owner accepts and enters the company.
- [x] Wrong account cannot accept the owner's invitation; existing account setup and sign-in recovery exercised.
- [x] Owner's first-login walkthrough appears; progress, resume through Help and skip exercised.
- [x] Help center lists guides; search and invitation guide work live. All15 public guides were subsequently opened in Chrome and their title, task steps, notes and related-guide sections verified. Their19 distinct task destinations visibly require sign-in in the signed-out session. This does not replace authenticated permission checks.
- [x] Create property → unit → prepared tenant → draft lease → occupant → active lease without portal access.
- [x] Owner reviews separate leaseholder/occupant invitation scopes; changed lease approval is rejected and a fresh invitation can be reviewed/sent.
- [x] Clean and EICAR document uploads produce distinct clear/rejected states on the live lease.
- [x] Post sample rent → record partial receipt → verify allocation and remaining balance.
- [x] Set deposit requirement → record receipt → verify held funds remain separate from rent/income.
- [x] Create maintenance → record paid-expense fixture → link existing expense once.
- [x] Generate report → reconcile source transactions, operating net, deposits and total recorded cash movement.
- [ ] Finish manager journeys. Invitation accepted live; all six guide steps completed and completion persisted after reload; owner-only Team direct route denied; attributed internal maintenance update saved. Remaining management journeys are unchecked.
- [ ] Complete staff invitation; verify default read-only access, property scope, explicit maintenance delegation, acceptance, progress, completion review and revocation.
- [ ] Complete leaseholder invitation; reconcile authorized shared rent/deposits/statements and reject management writes/private notes/documents.
- [ ] Complete occupant invitation; verify no financial access and appropriate maintenance/self-service behavior.
- [ ] Complete platform/company administration, account disable/reactivation, ownership transfer boundaries and company suspension/recovery using only approved sample accounts.
- [ ] Walk property/unit/tenant edits, search/filter/pagination, archive/restore, duplicate prevention and return navigation.
- [ ] Walk lease amendments, renewal, recurring billing, proration, move-out/settlement and supported correction/reopen paths; preserve recorded source history.
- [ ] Walk one-time charges/credits, overpayment, refunds, deposit application/return and void/replacement; use synthetic records only, with no real money movement.
- [ ] Verify document versions, archive/restore, pending-scan recovery, denied access and downloaded original receipt.
- [ ] Verify report/statement/ledger export contents and filters against complete source totals.
- [ ] Check mobile layouts, keyboard/focus, empty/loading/error states, preserved drafts, stale records and lost-response recovery across the remaining journeys.
- [ ] Check public/pre-login help, profile/verification/password recovery and return destinations across all roles.

## Deferred live testing

The user deferred live testing while away from the laptop. Preserve sample-company state and resume staff/resident/draft acceptance later; no new password requests or emails are needed during feature development. PF-13 vendor contacts are implemented locally and validated against isolated fictional fixtures/disposable PostgreSQL: both builds,212 UI cases plus6 final focused cases,72 server/28 client unit checks,56 maintenance integration checks and the power inventory guard pass. Migration035 and live acceptance remain separate.

## Evidence and next action

All live writes are confined to the explicitly authorized, labeled sample company. No real payment, vendor dispatch or support correspondence occurred. PR48, PR49 and PR50 are deployed; migrations033/034 were verified. Screenshots in `/tmp`: `pf-live-document-scanning.jpg`, `pf-live-lease-activated.jpg`, `pf-live-sample-report.jpg`, `pf-live-invitation-help.jpg`, `pf-live-public-help.jpg`, `pf-live-help-rent-search.jpg`.

PR51 validation: client production build, 25 focused invitation/tenant/document UI cases and full CI passed. Merged as `5c76f8c`; deployment `39142308369` passed frontend/public/authentication checks. Backend unchanged. No schema or authority changes. Targeted signed-in rechecks remain pending. PR53 mergedb8f4aa7after exact-head CI39186265460passed. Frontend deployment39187019964passed and W09 search was verified live; all15 public guides and 19 signed-out task gates were also checked. W11 password-email branding remains open. Live staff/resident testing is deferred at the user’s request; preserve the invitation/company state and request fresh credential recovery only when testing resumes. Current build increment: PF-13 vendor contacts in PR54 (5708688), with migration035 validated only on disposable databases. Exact-head CI39189388351passed; no unresolved review findings remain. Next: review/release this increment separately and continue the next bounded roadmap feature; resume role/draft acceptance when the user is available. Keep this log updated with new findings and verified resolutions; do not silently convert unchecked coverage into a pass.

## PF-14 preventive maintenance — local isolated checks, release pending

Recurring property/unit schedules connect to ordinary requests with retained due date, source and history. Review before create/skip, required skip reason, pause/resume, prospective edits and explicit page-only drafts are implemented. No live database/provider/account interaction; signed-in acceptance stays deferred. Validation and PR references are recorded below when complete.

Local evidence: 70 disposable maintenance API/browser checks passed, including different-actor racing writes, atomic rollback, immutable source/history, reviewed timezone and committed-response-loss recovery. 82 server units/28 client units passed (5 database suites intentionally delegated to disposable runners). Both production builds and the Start/Stop inventory guard pass. Full UI regression:217 passed with two final label/count corrections; all17 focused schedule/Help checks passed after correction. Mobile proof `docs/acceptance-evidence/preventive-local-mobile-2026-10-18.png` uses fictional isolated records. No live migration, merge or deployment.

## PF-14 connected work calendar — isolated validation

The month calendar and agenda use real next schedule occurrences and unresolved request targets, complete day/month counts and source return context.77 disposable maintenance API/browser checks and 34 affected UI cases pass. Both production builds and power inventory pass. Tests include29items beyond a page, empty selected day with unchanged month counts, exact generate/replay/skip transitions, month boundaries, retained timezone, denied roles, revoked/suspended scope, keyboard/mobile controls and real API source-return navigation. Fictional local evidence is retained separately; no production migration, merge, deployment or user-account testing. Hosted CI and live acceptance remain distinct.

## PF-15 private document library — isolated validation

Management-only cross-source metadata search/filter/paging opens and focuses the exact document at its source with expanded versions and retained return filters. Archive/restore and latest-vs-historical scan state are verified; quarantined latest uploads remain blocked even when an earlier original is cleared. No live accounts, files or production data were used. Initial84 disposable maintenance API/browser checks passed; final source/lease section and full UI regressions are recorded before PR. No migration or new cloud resource/provider; merge/deployment/live acceptance remain pending.

Final local library evidence: all230UI fixtures,84disposable maintenance/API/browser checks and28client units pass. Both production builds pass. The real browser verifies maintenance and lease source focus, latest quarantine versus older cleared versions, return filters and lease section changes. Screenshots use fictional local data only. Calendar PR56 index review is resolved in0d864d5 (migration037);78disposable calendar/maintenance checks, including real PostgreSQL range-index eligibility, pass. The library is rebased on that fix; final combined85-check run passed on a new disposable database.


## New feature acceptance after the user-run release

- [ ] Management completes move-in → reviewed report → move-out comparison → settlement source navigation; confirm no automatic charges/deposit deductions.
- [ ] Management prepares exact agreement versions/signers, submits/reviews/requests changes, verifies source staleness and retained originals; every result remains unsigned.
- [ ] Owner/manager/staff/requester inboxes receive only intended real workflow events; verify read/unread, current-access revocation, filtered source return and recovery after uncertain actions.
- [ ] Verify matching client/API and migrations038/039/040, new safe operation signals and complete live role/mobile/error acceptance without using real money or activating external delivery.
