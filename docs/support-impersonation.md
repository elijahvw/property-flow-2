# PF-29 · Support impersonation

The PF-29 foundation is merged. The current local refinement lets platform owners inspect every recorded account while keeping delegated support limited to eligible company users. Company ownership alone does not grant any platform authority. Migration `202610260060_owner_impersonation` and matching API/client are required for the expanded directory; deployment and real-account acceptance remain separate.

## User workflow

1. A platform owner opens **Impersonation** at `/platform/impersonation` and can start a read-only view directly. No support grant or company membership is needed for the platform owner. **Support access** separately delegates the narrower company-user workflow to a trusted active, verified sign-in account. A company owner, manager, staff member or resident gets no platform support permission from their company role; an explicit platform grant remains separate.
2. Search by name, email/company or company role. Platform owners can select any recorded account, including other platform accounts, their own account, unassigned/unverified/disabled users and members of suspended/deleted companies. The directory states the actual platform/company roles and account status. Delegated support still sees only active, verified non-platform users with active company membership/company. Filters never turn company ownership into platform authority.
3. Enter a support case reference or brief testing reason (required, maximum 200 characters) and start the session. The workspace reloads into the selected user's real destination. Use test descriptions without private contact, financial or credential information.
4. Explore the selected user's permitted pages and denied feature access. A persistent banner identifies the person, role/company, read-only state and expiry. Existing target-role controls may remain visible for access testing, but business mutations are rejected by the server. Notification read-state changes and walkthrough persistence are also blocked/suppressed.
5. Choose the banner's return action to end impersonation and reload the support workspace. Sign out remains available. An owner can revoke a support grant through the same review; current support views immediately become unavailable and cannot be revived by a later grant.
6. Review platform **Activity** for support grants/revocations and session start/end history. An allowed private-document download records the real signed-in actor and the impersonated user/context.

This workflow tests visibility and access using real source records. It does not test successful customer writes: read-only impersonation blocks saving, sending, posting money, changing access and other business mutations.

## Authority and session contract

Auth0 remains the account authority. Support delegation changes only local platform authority to `support`, giving `platform.impersonate`; only a platform owner retains `platform.manage` and can delegate/revoke support. Delegation does not alter company membership, property assignments or lease participation.

The original session `userId` remains the signed-in actor. A bounded context records the target user, selected company/membership version, reason and expiry. Each protected request loads current actor and target access. The effective principal is the actual target, with no inherited actor permissions. A platform owner viewing another platform account retains only that target's recorded platform role and actual company access, always read-only; delegated support cannot target platform accounts. Disabled/unverified targets retain empty permissions, and suspended/deleted company access stays denied. Existing company filters, transaction-local row-level security, staff selected-property grants and resident/lease checks remain in force. Sessions cannot nest, including when the target has platform impersonation authority.

The view expires after 30 minutes or an earlier absolute/idle session deadline. Actor disablement or loss of the necessary platform authority, or a changed target membership, makes it unavailable. Delegated support also loses its view when the target becomes disabled, unverified or platform-privileged, or the company becomes unavailable. An owner may inspect those denied states but cannot activate or bypass them. Company/membership pinning, including a pinned absence of membership, prevents following a transferred account into another company or silently adopting edited grants. Bootstrap retains unavailable context and the exit banner; ordinary data requests fail closed until exit. Revocation expires persisted views, so regrant does not revive them.

Requests carry an effective-identity context header. A stale tab must reload before receiving or submitting work under another identity. Start/stop and cross-tab changes reload the workspace to clear mounted customer data and unsubmitted drafts. Mutations retain exact-origin and session CSRF protection. During impersonation only read methods, harmless telemetry, explicit exit and logout are allowed. Exit/logout remain possible after actor/target access revocation while the underlying session is valid.

Start/stop and support grant/revoke transitions use fresh server-side checks, concurrency fences/version checks and atomic immutable audits. Queued company and platform reads recheck the original actor, expiry and pinned target context inside their transaction. Company-view/download audits retain the signed-in actor plus impersonated target/context. Download audits use the original actor plus target/context. This is not an audit of every page read. Safe browser operations use the bounded names `impersonation.start`, `impersonation.stop` and `impersonation.support.update`; reasons and directory/customer fields are not telemetry labels or payloads.

## Recovery and operation

| Symptom | Action |
| --- | --- |
| A user is missing from the target list | Platform owners can search any synced record; clear company/role filters for unassigned or platform-only accounts. Delegated support must still meet its active/verified company-user boundaries. Impersonation never provisions a missing sign-in account or grants target access. |
| Support cannot open Impersonation | An owner checks the explicit support grant and account status/verification. A company staff role alone is insufficient. |
| The selected view expired or access changed | Return to the original account. Review current target/support access and start a new session if still authorized. No automatic extension or restoration occurs. |
| Another tab changed the viewing account | Reload as prompted before continuing. Do not reuse the former tab's open draft. |
| Start/stop has an interrupted or ambiguous response | Reload to inspect the server's current context/banner, then exit or begin again as appropriate. Do not assume the operation failed. |
| A grant review reports a changed account | Close the review, load the current account and reopen it before confirming. |
| An allowed read/download fails | Check current target access and document scan/quarantine state. Use platform Activity for session/download history and existing route/status/failure signals for operational diagnosis. |

The foundation uses migration `202610240041_support_impersonation`; the owner-wide directory additionally requires additive migration `202610260060_owner_impersonation` and matching API/client versions. The new constraint permits an impersonated account with either a complete company/version pin or neither value. It never permits a partial pin. It adds session columns, a target-account relation/index and a complete-context constraint, and widens the existing `User_platformRole_check` to allow owner/support/null. No new infrastructure, always-on process, environment variable or Auth0 configuration is needed. Preserve normal Start/Stop development controls and data/restore points; merge, cloud migration/deployment and real-account acceptance remain separate user-controlled steps.

The review URL `/platform/impersonation?supportUserId=<encoded user ID>` opens that account's separate support-grant review using an exact ID filter. Company deletion/demo diagnostics may link here; viewing the link never grants or revokes authority. Platform owners review a revoke explicitly, and support views disable grant/revoke/start controls while impersonating.

## Validation and remaining acceptance

Current local owner-wide refinement: fresh `node scripts/test-impersonation.mjs` passed **18/18**, including owner inspection of platform/self/unassigned/disabled/unverified and unavailable-company accounts, company-owner-only denials, pinned absence of membership, owner downgrade, and queued actor/context revocation. A disposable negative proof temporarily removed only the compiled actor/session share locks: the new pure-target-lock race returned HTTP200 instead of403 and failed its assertion. The artifact was restored byte-for-byte in `finally`; no application source was changed by that proof. Earlier failed/mutant logs remain retained locally. Final combined builds/browser evidence belongs to the current release record; these checks do not establish live acceptance.

Local validation on October 24, 2026:

- Client and server production builds pass, including Prisma schema/client generation.
- All 10 client unit test files pass. Safe server suites pass across the combined verification runs after correcting the expected platform-owner permissions and allowing their local loopback test servers.
- The dedicated `node scripts/test-impersonation.mjs` runner passes 14 disposable PostgreSQL/API checks using fresh migrations, including the platform-role constraint, restricted runtime/RLS boundaries and a non-ASCII identity's context header, scoped reads and restored account after exit. It is wired into CI.
- Three focused browser checks pass for support grant/start/stop with failure retry; support administration denial, mobile layout without overflow and walkthrough suppression; and cross-tab reload.

The dedicated runner uses only its newly created test database. These checks do not establish cloud migration, deployment or real-account acceptance.

Remaining acceptance after authorized release: grant/revoke with actual owner/support accounts; owner/manager/staff/resident visibility and direct-route denial; selected-property and resident household/financial boundaries; safe downloads and history; expiry/revocation/stale-tab recovery; and mobile/keyboard banner/exit behavior. No production or preview data should be repurposed as a disposable test database.
