# PropertyFlow MVP status

Updated 2026-10-14 for the focused owner onboarding slice. Source baseline: `f15e7b43256790ba3acabf08025f707d3771cbc9` (PR12 head), verified clean on `codex/access-overhaul`. Implementation branch: `codex/owner-onboarding`. No push, merge, infrastructure changes, deployment or database operations in this task.

## Cohort decision and implemented behavior

The user confirmed administrator-assisted company creation and initial owner assignment for the first cohort. Self-service company creation is outside this slice. Before assignment, `/access` explains the administrator path and invitation acceptance. Existing disabled-account/membership/company screens and API permission guards remain in force. One company membership per person remains unchanged.

PR12 provides Auth0 PKCE, server cookie sessions, platform administration, company permissions, company-scoped property creation/listing, profile/settings, and invitations with verified-email acceptance. Platform authority alone grants no company property access. There are no property detail/edit/unit routes or operational maintenance dashboards.

This slice addresses two concrete usability failures:

- Active assigned owners landed in Properties without next-step guidance. Properties now includes a company-access, first-property, and resident-invitation checklist. It opens the existing property form and links to company settings and Team. Only active company owners with all required capabilities mount the checklist or its invitation request. Manager/staff/resident/platform-only users do not see it.
- Creating a Team invitation refreshed memberships instead of the separate invitation list. The list now remounts and reloads after successful invitation creation, showing the new record immediately while preserving the one-time link.

Property progress uses the existing accessible company directory and refreshes after creation. Invitation progress filters `/api/invitations` by the current company and resident role, including for a company owner who also has platform authority. It records issuance only, including historical accepted/expired/revoked records; the Team list shows their actual status. It never asserts acceptance, property assignment, occupancy, maintenance readiness or automatic email delivery. The endpoint exposes the latest 100 invitations; absence is explicitly described as absence from available records, rather than proof that no invitation was ever issued.

Each resource has loading, error and retry states. Empty records remain incomplete. Check-progress reloads both resources; returning from Team fetches invitations again. The existing resource hook was moved unchanged into `client/src/useResource.ts`, retaining scope-based invalidation and abort handling.

## Auth and routing review

Checked logged-out protected pages, failed/loading bootstrap guard behavior, role landings, disabled/new-user states, capability navigation, safe return paths, invitation secret preservation, callback expiry handling and terminal redirect destinations. No concrete auth/routing blocker was found in this source review and fixture checks. No authentication/security design change was made. Live successful Auth0 callbacks remain unverified.

## Verification in this slice

Local Node v24.1.0; documented deployment/CI runtime is Node 22. Dependencies were reused from the clean source checkout; no install or lockfile change.

- `./node_modules/.bin/tsc -p server/tsconfig.json --outDir server/dist`: passed; builds the source exercised by server unit tests without Prisma generation or database access.
- `env -u TEST_DATABASE_URL -u DATABASE_URL -u RUNTIME_DATABASE_URL node --test server/tests/access.test.mjs server/tests/tracing.test.mjs client/tests/*.test.cjs`: **21 passed**. Includes 2 added tests for role landings and locally rejected callback bindings, plus existing permission, CSRF, logout, redirects, tracing and client guards.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/operations -p 'test_*.py'`: **24 passed**; no infrastructure command dispatched.
- `./node_modules/.bin/tsc -p client/tsconfig.json --noEmit` and `./node_modules/.bin/tsc -p server/tsconfig.json --noEmit`: passed.
- `npm run build --workspace=@property-flow/client`: passed (TypeScript + Vite).
- `./node_modules/.bin/playwright test -c playwright.onboarding.config.ts`: **10 passed**. Isolated same-origin API fixtures, no real accounts or database. Covers owner navigation/create/invite/return, stale Team list regression, independent failure/retry, loading, non-owner/anonymous/disabled landings, suspended/disabled/platform-only checklist gating, filtering other-company/non-resident records, session company changes, and mobile layout. Mobile screenshot: `/tmp/propertyflow-owner-onboarding-mobile.png`.

The localhost browser server required sandbox escalation after a listen EPERM; the authorized fixture test command succeeded. No database test was run: PostgreSQL integration tests drop/recreate schema and require a verified disposable database. Live sessions, successful OIDC exchange, invitation email matching/acceptance, replay races and database RLS/migrations were not reverified here. Browser fixture tests prove frontend behavior, not server authorization or release readiness.

## Remaining work and known limits

1. Parent-arranged independent review, then authenticated browser acceptance using separate assigned-owner/resident accounts in the existing development environment.
2. Resident-to-property assignment is absent. Accepted invitations create company membership only. Build that isolation boundary before property-specific resident maintenance access.
3. Maintenance submission, manager queue and status lifecycle are absent. Lease/payment workflows and real operational summaries are also absent.
4. Property management supports creation/listing only; detail/edit/units remain follow-on work.
5. Invitation list truncation may hide older issuance (explicitly disclosed). Completion denotes issuance, even if later revoked/expired; usefulness depends on reviewing the Team status. Automatic invitation delivery does not exist.
6. Existing platform invitations are global for platform owners. The checklist filters them locally; no endpoint or server permission changes were introduced.

## Historical release evidence

The earlier audit record is `/Users/elijahward/Documents/Codex/2026-10-13/task/PROPERTYFLOW-MVP-STATUS.md`. Its parent-supplied evidence confirms successful development deployment of PR12 merge `d4760b32718da5b9e8b5a6a8e6bc51dbcc15979f`: [Deploy Dev run 38497232143](https://github.com/elijahvw/property-flow-2/actions/runs/38497232143), and [PR CI run 38495106759](https://github.com/elijahvw/property-flow-2/actions/runs/38495106759). Those are historical results, not a fresh verification or a deployment of this slice. Authenticated acceptance remains outstanding; production deployment is not claimed.
