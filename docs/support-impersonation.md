# PF-29 · Support impersonation

October 24, 2026: implemented and validated locally, including focused browser fixtures; review/release and real-account acceptance remain pending. The checked-out main is `75d5342` (PR59 merged); PF-29 has not been merged, deployed or accepted with real accounts. The running register uses PF-29 to preserve the historical Jira PF-28 reference under PF-23a. No Jira action is part of this increment.

## User workflow

1. A platform owner opens **Impersonation** at `/platform/impersonation`, finds a trusted support person's existing account under **Support access**, then reviews and confirms the grant. The account must be active, verified and linked to a sign-in identity. Company staff access does not grant this platform authority.
2. The owner or authorized support person searches actual company users by name, email/company or company role, then selects the intended person. The directory is paginated and excludes inactive, unverified, unavailable-company and platform accounts.
3. Enter a support case reference or brief testing reason (required, maximum 200 characters) and start the session. The workspace reloads into the selected user's real destination. Use test descriptions without private contact, financial or credential information.
4. Explore the selected user's permitted pages and denied feature access. A persistent banner identifies the person, role/company, read-only state and expiry. Existing target-role controls may remain visible for access testing, but business mutations are rejected by the server. Notification read-state changes and walkthrough persistence are also blocked/suppressed.
5. Choose the banner's return action to end impersonation and reload the support workspace. Sign out remains available. An owner can revoke a support grant through the same review; current support views immediately become unavailable and cannot be revived by a later grant.
6. Review platform **Activity** for support grants/revocations and session start/end history. An allowed private-document download records the real signed-in actor and the impersonated user/context.

This workflow tests visibility and access using real source records. It does not test successful customer writes: read-only impersonation blocks saving, sending, posting money, changing access and other business mutations.

## Authority and session contract

Auth0 remains the account authority. Support delegation changes only local platform authority to `support`, giving `platform.impersonate`; only a platform owner retains `platform.manage` and can delegate/revoke support. Delegation does not alter company membership, property assignments or lease participation.

The original session `userId` remains the signed-in actor. A bounded context records the target user, selected company/membership version, reason and expiry. Each protected request loads current actor and target access. The effective principal is the actual target, with no inherited platform authority. Existing company filters, transaction-local row-level security, staff selected-property grants and resident/lease checks remain in force. Platform owner/support accounts cannot be targets, and sessions cannot nest.

The view expires after 30 minutes or an earlier absolute/idle session deadline. Actor disablement or loss of support authority, target disablement/unverification/platform elevation, company suspension or a changed target membership makes it unavailable. Company/membership pinning prevents following a transferred account into another company or silently adopting edited grants. Bootstrap retains unavailable context and the exit banner; ordinary data requests fail closed until exit. Revocation expires persisted views, so regrant does not revive them.

Requests carry an effective-identity context header. A stale tab must reload before receiving or submitting work under another identity. Start/stop and cross-tab changes reload the workspace to clear mounted customer data and unsubmitted drafts. Mutations retain exact-origin and session CSRF protection. During impersonation only read methods, harmless telemetry, explicit exit and logout are allowed. Exit/logout remain possible after actor/target access revocation while the underlying session is valid.

Start/stop and support grant/revoke transitions use fresh server-side checks, concurrency fences/version checks and atomic immutable audits. Download audits use the original actor plus target/context. This is not an audit of every page read. Safe browser operations use the bounded names `impersonation.start`, `impersonation.stop` and `impersonation.support.update`; reasons and directory/customer fields are not telemetry labels or payloads.

## Recovery and operation

| Symptom | Action |
| --- | --- |
| A user is missing from the target list | Check the actual account's verification/status, active company membership/company and platform authority; search the correct company/role. Impersonation does not create or grant target access. |
| Support cannot open Impersonation | An owner checks the explicit support grant and account status/verification. A company staff role alone is insufficient. |
| The selected view expired or access changed | Return to the original account. Review current target/support access and start a new session if still authorized. No automatic extension or restoration occurs. |
| Another tab changed the viewing account | Reload as prompted before continuing. Do not reuse the former tab's open draft. |
| Start/stop has an interrupted or ambiguous response | Reload to inspect the server's current context/banner, then exit or begin again as appropriate. Do not assume the operation failed. |
| A grant review reports a changed account | Close the review, load the current account and reopen it before confirming. |
| An allowed read/download fails | Check current target access and document scan/quarantine state. Use platform Activity for session/download history and existing route/status/failure signals for operational diagnosis. |

Release requires additive migration `202610240041_support_impersonation` and matching API/client versions. It adds session columns, a target-account relation/index and a complete-context constraint, and widens the existing `User_platformRole_check` to allow owner/support/null. No new infrastructure, always-on process, environment variable or Auth0 configuration is needed. Preserve normal Start/Stop development controls and data/restore points; merge, cloud migration/deployment and real-account acceptance remain separate user-controlled steps.

## Validation and remaining acceptance

Local validation on October 24, 2026:

- Client and server production builds pass, including Prisma schema/client generation.
- All 10 client unit test files pass. Safe server suites pass across the combined verification runs after correcting the expected platform-owner permissions and allowing their local loopback test servers.
- The dedicated `node scripts/test-impersonation.mjs` runner passes 14 disposable PostgreSQL/API checks using fresh migrations, including the platform-role constraint, restricted runtime/RLS boundaries and a non-ASCII identity's context header, scoped reads and restored account after exit. It is wired into CI.
- Three focused browser checks pass for support grant/start/stop with failure retry; support administration denial, mobile layout without overflow and walkthrough suppression; and cross-tab reload.

The dedicated runner uses only its newly created test database. These checks do not establish cloud migration, deployment or real-account acceptance.

Remaining acceptance after authorized release: grant/revoke with actual owner/support accounts; owner/manager/staff/resident visibility and direct-route denial; selected-property and resident household/financial boundaries; safe downloads and history; expiry/revocation/stale-tab recovery; and mobile/keyboard banner/exit behavior. No production or preview data should be repurposed as a disposable test database.
