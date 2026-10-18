# Live workflow acceptance and friction log

October 18, 2026. Working record for the approved [platform audit](platform-audit-2026-10-17.md), alongside the [implementation notes](platform-workflow-improvements.md). Keep this current as each journey is walked in Chrome. This is not a claim that all workflows have passed.

## How findings are recorded

Record the user goal, starting role/state, steps, observed result, impact, smallest useful correction, priority, and evidence. Separate confirmed defects from usability observations, operational prerequisites, and test-tool limitations. A proposed fix is not implemented; merged is not deployed; deployed is not verified live. Keep private links, credentials and customer data out of this log.

Priorities: P1 blocks a core task or violates a boundary; P2 creates substantial confusion or recovery effort; P3 is a useful refinement. Fix the underlying workflow with existing components where possible. Do not add a new subsystem to solve a small interaction problem.

## Findings under follow-up

### W01 · Changed household approval has an awkward owner recovery — P2

**Confirmed live; local correction validated, not yet deployed.** Create a tenant invitation, change the lease, then choose **Send or replace invitation → Create replacement link**. The server correctly refuses the stale approval, but tells the signed-in owner: “The household changed. Ask the owner for a newly reviewed invitation.” Repeating the replacement cannot succeed. Recovery required closing the dialog, revoking the old invitation, opening Invite to portal, reviewing access again, creating a link and sending it.

Local correction: a changed-approval response offers **Review current access**, opening the existing fresh review without a separate revoke step. The existing save transaction replaces old contact links atomically. Preserve explicit owner approval, version checks, old-link invalidation and invitation history. Do not silently refresh the approved scope.

### W02 · Sending a team invitation leaves an empty creation form behind — P3

**Observed live; local correction validated, not yet deployed.** After a successful team invitation send, **Done** closes delivery but leaves the blank Invite team member dialog open. An owner must close another dialog to return to the team list, without an explicit choice to invite someone else.

Local correction: **Done** closes the team invitation dialog and returns to the list. A deliberate next invitation starts with a fresh form/key. Other embedded invitation forms retain their existing completion behavior.

### W03 · Latest document scan result is hidden with version history — P3

**Observed live; local correction validated, not yet deployed.** After leaving and returning to Documents, collapsed retained-version sections hide the current clean/rejected status and the clean-file download. The document title and version-upload/archive actions remain visible. Opening retained versions reveals the result.

Local correction: the latest scan status appears beside the document title while retained versions and downloads remain expandable. Full mobile/keyboard live review remains pending.

### W04 · First-time password setup and return to invitation — P2 review

**Confirmed journey interruption; local recovery improvement validated, not yet deployed.** The invited person moves from invitation to setup email to the identity provider, then back to sign-in and invitation acceptance. Owner setup worked. Manager password/sign-in landed at **Account access pending** despite a saved invitation; opening /invite recovered the correct review, then acceptance succeeded. The exact identity-provider return path remains under investigation. The local Access pending page now offers **Review your invitation** for a saved invitation; disabled accounts do not receive this prompt. Staff and resident journeys remain incomplete. Check email wording, sender consistency, which tab to return to, preserved destination, wrong-account recovery and verification instructions. Browser policy requiring the human to enter a new password is a testing constraint, not a product defect.

## Fixed findings and release verification

- **W05 · Lease activation required tenant portal membership — P1.** Live creation of a prepared tenant and draft lease worked, but editing/activation failed with “Resident not found.” Fixed in PR50 by validating the canonical contact before the legacy membership path. Merged and deployed; live activation succeeded before tenant sign-in or portal acceptance. Disabled/ineligible accounts and foreign-company boundaries remain covered by disposable integration tests.
- **W06 · Activation review could retain Draft — P2.** Review found that opening/closing the ordinary editor before activation reused an uncontrolled Draft value. PR50 now remounts the reviewed status; reopen regression passes, and live activation showed Active and saved it. Merged, deployed, verified live.
- **W07 · Scanner cold start loaded old definitions — P1.** Cloud acceptance found the daemon could load bundled definitions before the updater finished. PR49 bounds initial update retries and starts the official initializer afterward; scanner failures do not stop unrelated app work. Merged/deployed. Live clean upload cleared; separate harmless EICAR upload rejected with download blocked.
- **W08 · Sandbox invitations failed under the task role — P1.** Actual sending exposed SES recipient-identity authorization missing from the narrow resource policy. Fixed with account/region identity resources and a mandatory exact branded From condition. IAM validation and negative sender checks passed; actual app invitations reached the controlled inbox. Infrastructure fix merged and deployed.

## Operational and verification limits

- **O01 · SES remains in sandbox.** Branded invitations work for the verified inbox and its aliases. Arbitrary-recipient production delivery is not enabled. Do not open or reply to AWS Support or retry production access without new user direction.
- **V01 · Final downloaded-file receipt is unverified.** Clean-file download completed the app form without an error, but the browser automation download event was not reported. This is not evidence that the product download failed. Confirm the downloaded original and export contents through the supported browser workflow before marking receipt verified.
- **V02 · Start/Stop.** The deployed Start development action passed against the running environment. Inventory/sequence/recovery checks pass in automation. A real live Stop/Start cycle has not been performed; schedule it only after active acceptance work is safe to interrupt.

## Workflow coverage

Each item stays open until its complete user journey and relevant error/recovery paths have been checked. Existing automated regressions support these checks; they do not replace real-account acceptance.

- [x] Platform owner creates a labeled sample company and invites its owner; correct owner accepts and enters the company.
- [x] Wrong account cannot accept the owner's invitation; existing account setup and sign-in recovery exercised.
- [x] Owner's first-login walkthrough appears; progress, resume through Help and skip exercised.
- [x] Help center lists guides; search and invitation guide work live.
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

## Evidence and next action

All live writes are confined to the explicitly authorized, labeled sample company. No real payment, vendor dispatch or support correspondence occurred. PR48, PR49 and PR50 are deployed; migrations033/034 were verified. Screenshots in `/tmp`: `pf-live-document-scanning.jpg`, `pf-live-lease-activated.jpg`, `pf-live-sample-report.jpg`, `pf-live-invitation-help.jpg`.

Local follow-up validation: client production build and 25 focused invitation/tenant/document UI cases passed. No server schema or authority changes. Next: complete staff password/sign-in, review and release the focused follow-up, then continue resident/staff role acceptance and the unchecked journeys. Keep this log updated with new findings and verified resolutions; do not silently convert unchecked coverage into a pass.
