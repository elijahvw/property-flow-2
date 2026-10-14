# PropertyFlow MVP status

## Security review fixes — 2026-10-14

The independent reviewer blocked release of `e06cccfe1db6b05319ae8e57e336a6def073c59c` on migration ordering and adapter error classification. Both were fixed locally for re-review, with no publication or database execution.

- Renamed the **unapplied** assignment migration to `202610140003_resident_assignments`, after `202610140002_property_isolation` creates `propertyflow_runtime`. Baseline migrations are unchanged. A safe filesystem test now checks the migration ordering and role-creation prerequisite.
- Retry classification now also recognizes `P2010.meta.driverAdapterError.cause.originalCode`, the nested SQLSTATE shape emitted by installed Prisma 7.4.1 / PrismaPg. Existing supported forms remain. Six new safe tests include actual PrismaClient + PrismaPg with an in-process pg transport, exercising `40001` and `40P01` success after two failures, exhaustion after exactly three attempts with `409 ACCESS_CONFLICT`, unrelated `23503` propagation after one attempt, and migration ordering. No transport test opens a network socket or uses a database URL.
- Replaced probabilistic database race loops with authored deterministic coordination around the application's real target-lock query. A leading transaction holds the row lock; the follower's PostgreSQL backend PID is captured and `pg_blocking_pids` must prove it is blocked before release. Both ordering directions cover membership disable, account disable, company transfer, role change and ownership promotion. Tests require a real retry, verify both companies contain no residual assignments, assert denied/empty self access as appropriate, and verify reactivation requires reassignment. A real stale-snapshot exhaustion case externally changes the target MVCC tuple before each attempt and expects exactly three attempts, a 409, and no assignment or audit writes. Added a second same-company resident assigned to a distinct property and exact self-only response assertions. Dedicated race users are removed within the disposable test database to preserve baseline last-owner assumptions.

Follow-up verification: server Prisma generation/TypeScript build and client TypeScript/Vite build passed; the full safe Node subset passed **35 tests**, including the six installed-adapter/migration-order tests. Output: `/tmp/propertyflow-resident-review-fix-node-tests.txt`. `node --check server/tests/database-access.test.mjs` and `git diff --check` passed. Browser and operations results remain the prior verified **16** and **24** passes; their implementation is unchanged in this follow-up.

The strengthened PostgreSQL cases are **authored and syntax-checked, not executed**. No integration suite (including its skip path), Docker container, PostgreSQL listener, or schema reset was invoked in this follow-up. Parent reports cached Docker 28.1.1 and a postgres:17-alpine image (`b0f9560a2de0`); isolated disposable validation is pending explicit parent confirmation. The earlier Docker sandbox-access limitation does not establish runtime unavailability after approval. RLS/composite-key enforcement, deterministic races and real-DB exhaustion remain unverified until that authorized run. Stop for the same independent reviewer before publication.

---

## Resident property assignment slice — 2026-10-14

Implemented on `resident-property-assignments` from clean owner-onboarding `cb80edeb93eeec2275671eb0f2c21b0b9df2f26e`, in an isolated local clone at `/Users/elijahward/Documents/Codex/2026-10-13/task-5/resident-assignments`. The reviewed source checkout and its Git metadata were not modified. No ancestor/repository AGENTS.md was found. No push, merge, deployment, infrastructure provision, package installation, migration application, or existing database operation occurred. Stop here for independent review before publication.

### Completed behavior

- Added `ResidentPropertyAssignment(companyId, propertyId, userId, createdAt)`, primary/unique property-user pair, composite foreign keys to Property and CompanyMembership, and their required unique keys. Migration `202610140003_resident_assignments` is additive, grants runtime table access, and enables **forced company RLS** using transaction-local `app.company_id`. Existing one-company membership and property RLS remain unchanged.
- Owners/managers receive `resident.assignment.manage`; staff, residents, and platform-only authority do not. `GET /api/company/residents` lists active resident memberships with active accounts/companies, excluding unaccepted invitations. `GET /api/company/properties/:propertyId/residents` lists associations; `PUT` and `DELETE /api/company/properties/:propertyId/residents/:userId` assign/remove idempotently. Assignment uses an existing user ID, not email/invitation ID. Foreign/missing property or member returns 404; a same-company ineligible target returns 409; malformed IDs return 400; forged company headers return 403. Existing authentication, Origin/CSRF hooks and manager invitation restrictions are preserved. Mutations audit property and target IDs.
- `GET /api/resident/properties` derives company and user identity from the authenticated principal, freshly validates access transactionally, filters self even within the same company, and selects only property `id/name/address`. Query parameters cannot select another resident. Suspension denies access while retaining associations.
- Membership disable, company transfer, role change, account disable, and ownership transfer clear associations under the old company context in the same transaction. Reactivation does not restore rows. Target mutations share a user-row write lock via a no-op `updatedAt = updatedAt` UPDATE: changing the MVCC tuple forces older Serializable snapshots to retry before target validation. Serializable transactions retry at most three attempts, handling Prisma P2034 and raw PostgreSQL serialization/deadlock SQLSTATEs, then return an actionable 409. This applies to existing serial lifecycle handlers too; no externally delivered side effects occur in their callbacks.
- Property directory offers **Manage residents** to owners/managers, with accepted choices, assigned badges, removal, loading, error/retry, and empty states. Resident portal renders assigned-property cards or no-assignment guidance. UI explicitly says association is not a lease or occupancy proof. Onboarding retains truthful invitation issuance/acceptance wording and now points to Manage residents. No payment/maintenance workflows were added.

### Verified checks

Used Node v24.1.0, existing cached dependency versions, and copied ignored node_modules using APFS cloning from the source checkout. Prisma generation used a dummy localhost URL and copied schema-engine cache under `/tmp/pf-prisma-cache` after the default cache location was blocked; no database connection or download occurred. Deployment/CI remains documented for Node 22, which was not executed locally.

- `XDG_CACHE_HOME=/tmp/pf-prisma-cache DATABASE_URL=postgresql://dummy@127.0.0.1:5432/dummy npm run build --workspace=server`: passed (Prisma generation + TypeScript). Final subsequent server compilation passed after adding raw serialization retry handling.
- `npm run build --workspace=@property-flow/client`: passed (TypeScript + Vite). `./node_modules/.bin/tsc -p client/tsconfig.json --noEmit`: passed.
- `env -u TEST_DATABASE_URL -u DATABASE_URL -u RUNTIME_DATABASE_URL node --test server/tests/access.test.mjs server/tests/resident-assignments.test.mjs server/tests/tracing.test.mjs client/tests/*.test.cjs`: **29 passed** (21 existing, 8 new). Final output: `/tmp/propertyflow-resident-node-tests.txt`. New route fixtures cover permission boundaries, forged headers, invalid IDs, foreign/missing equivalence, inactive/disabled/suspended eligibility, duplicates/removal, same-company self isolation/minimal fields, lifecycle cleanup including ownership transfer, reactivation, and bounded ORM/raw serialization retry behavior. These fixtures assert transaction scopes/locks and do not prove real database concurrency.
- `./node_modules/.bin/playwright test -c playwright.onboarding.config.ts --reporter=line`: **16 passed** (12 existing, 4 new). Localhost listening required sandbox escalation, which was approved. All APIs were intercepted; no real sessions/accounts/database. New browser fixtures cover manager assignment/removal, 409 recovery, staff gating, resident cards/empty/error retry, and pending resource loading. Existing onboarding mobile/scope-change coverage remains green.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/operations -p 'test_*.py'`: **24 passed**, with no infrastructure dispatch.
- `git diff --check`: passed.
- `env -u TEST_DATABASE_URL -u DATABASE_URL -u RUNTIME_DATABASE_URL node --test server/tests/database-access.test.mjs`: **skipped**, explicitly without any database URL. No schema-resetting suite ran against a database.

### Unverified database checks and review risks

Added PostgreSQL integration cases for forced RLS, unscoped/foreign-company reads and inserts, both composite foreign keys, duplicate assignment/self minimal output, and repeated overlapping assignment versus membership/account revocation. Increased the isolated suite pool to four connections so future Promise.all race tests can actually overlap. **These cases have not executed.** No local PostgreSQL binary was found; Docker daemon access was sandbox-blocked. PGlite packages exist but are not a substitute for real multi-connection PostgreSQL locking/concurrency validation.

Safe future approach: start a fresh throwaway PostgreSQL cluster/container on an unused loopback port with a unique container/volume or a new temporary data directory, verify the listener/process and empty cluster, create only `propertyflow_access_test`, and supply its local admin URL to the integration suite. That suite intentionally drops/recreates public and changes its cluster-local runtime role, so the hostname/database-name guard alone is insufficient evidence of disposability. Never point it at an existing development/test/shared database. The cluster must be verified disposable before execution and removed afterward. No cluster/container was created in this task.

Independent review should focus on the no-op user write-lock/snapshot fence and adapter serialization error mapping, old-company RLS cleanup before composite-key membership changes, migration rollout/index lock impact, and fresh actor/self authorization. Authenticated acceptance, real PostgreSQL race/RLS/constraint tests, and remote CI remain required before release. Direct administrative SQL that changes role/status is outside these application handlers and must clear associations explicitly; company suspension intentionally retains rows. Pending invitations remain unassignable; no email is automatically delivered.

### Remaining MVP work

Independent review and the database/live-auth checks above; maintenance submission/manager queue/status lifecycle; lease/payment workflows; property detail/edit/units. The prior owner-onboarding evidence below is historical, and its statement that property assignment was absent is superseded by this slice.

---

Updated 2026-10-14 for the focused owner onboarding slice. Source baseline: `f15e7b43256790ba3acabf08025f707d3771cbc9` (PR12 head), verified clean on `codex/access-overhaul`. Implementation branch: `codex/owner-onboarding`. No push, merge, infrastructure changes, deployment or database operations in this task.

## Cohort decision and implemented behavior

The user confirmed administrator-assisted company creation and initial owner assignment for the first cohort. Self-service company creation is outside this slice. Before assignment, `/access` explains the administrator path and invitation acceptance. Existing disabled-account/membership/company screens and API permission guards remain in force. One company membership per person remains unchanged.

PR12 provides Auth0 PKCE, server cookie sessions, platform administration, company permissions, company-scoped property creation/listing, profile/settings, and invitations with verified-email acceptance. Platform authority alone grants no company property access. There are no property detail/edit/unit routes or operational maintenance dashboards.

This slice addresses three concrete usability failures:

- Active assigned owners landed in Properties without next-step guidance. Properties now includes a company-access, first-property, and resident-invitation checklist. It opens the existing property form and links to company settings and Team. Only active company owners with all required capabilities mount the checklist or its invitation request. Manager/staff/resident/platform-only users do not see it.
- Owners who also have platform authority could reach Team but could not create invitations: the platform-user API requires an explicit company ID. Team now passes the current membership company ID. Existing server validation and authorization remain unchanged.
- Creating a Team invitation refreshed memberships instead of the separate invitation list. The list now remounts and reloads after successful invitation creation, showing the new record immediately while preserving the one-time link.

Property progress uses the existing accessible company directory and refreshes after creation. Invitation progress filters `/api/invitations` by the current company and resident role, including for a company owner who also has platform authority. It records issuance only, including historical accepted/expired/revoked records; the Team list shows their actual status. It never asserts acceptance, property assignment, occupancy, maintenance readiness or automatic email delivery. The endpoint exposes the latest 100 invitations; absence is explicitly described as absence from available records, rather than proof that no invitation was ever issued.

Each resource has loading, error and retry states. Empty records remain incomplete. Check-progress reloads both resources; returning from Team fetches invitations again. The existing resource hook was moved unchanged into `client/src/useResource.ts`, retaining scope-based invalidation and abort handling.

## Auth and routing review

Checked logged-out protected pages, failed/loading bootstrap guard behavior, role landings, disabled/new-user states, capability navigation, safe return paths, invitation secret preservation, callback expiry handling and terminal redirect destinations. No concrete auth/routing blocker was found in this source review and fixture checks. No authentication/security design change was made. Live successful Auth0 callbacks remain unverified.

## Verification in this slice

Local Node v24.1.0 and Playwright 1.58.2; documented deployment/CI runtime is Node 22. Dependencies were reused from the clean source checkout; no package or lockfile change. See reproducibility details below.

- `./node_modules/.bin/tsc -p server/tsconfig.json --outDir server/dist`: passed; builds the source exercised by server unit tests without Prisma generation or database access.
- `env -u TEST_DATABASE_URL -u DATABASE_URL -u RUNTIME_DATABASE_URL node --test server/tests/access.test.mjs server/tests/tracing.test.mjs client/tests/*.test.cjs`: **21 passed**. Includes 2 added tests for role landings and locally rejected callback bindings, plus existing permission, CSRF, logout, redirects, tracing and client guards.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests/operations -p 'test_*.py'`: **24 passed**; no infrastructure command dispatched.
- `./node_modules/.bin/tsc -p client/tsconfig.json --noEmit` and `./node_modules/.bin/tsc -p server/tsconfig.json --noEmit`: passed.
- `npm run build --workspace=@property-flow/client`: passed (TypeScript + Vite).
- `./node_modules/.bin/playwright test -c playwright.onboarding.config.ts`: **12 passed on the review-fix rerun** (original implementation: 10 passed). Isolated same-origin API fixtures, no real accounts or database. Covers owner navigation/create/invite/return, stale Team list regression, independent failure/retry, loading, non-owner/anonymous/disabled landings, suspended/disabled/platform-only checklist gating, filtering other-company/non-resident records, session company changes, dual company/platform owner invitation creation, old responses released after new-company data, and mobile document/checklist overflow assertions. Mobile screenshot: `/tmp/propertyflow-owner-onboarding-mobile.png`.

The localhost browser server required sandbox escalation after a listen EPERM; the authorized fixture test command succeeded. No database test was run: PostgreSQL integration tests drop/recreate schema and require a verified disposable database. Live sessions, successful OIDC exchange, invitation email matching/acceptance, replay races and database RLS/migrations were not reverified here. Browser fixture tests prove frontend behavior, not server authorization or release readiness.

## Independent review follow-up and reproducibility

The reviewer found the dual-role invitation compatibility defect described above. The added fixture requires an explicit matching company ID for platform-authorized invitation POSTs and asserts the exact payload, one-time acceptance link, refreshed Team record, and checklist progress after returning. The delayed-scope test waits for both old requests, switches company, waits for both new empty responses, and only then releases the old responses; newer progress remains intact. At 390px, the browser asserts document scroll width does not exceed viewport width and the checklist stays within its bounds.

CI now installs Chromium (with Linux dependencies) and runs `npx playwright test -c playwright.onboarding.config.ts --reporter=line,junit` in the existing lint-and-test job. `PLAYWRIGHT_JUNIT_OUTPUT_FILE=test-results/onboarding.xml` feeds the existing report artifact/upload steps. The focused config starts only a localhost Vite server; all API calls are intercepted fixtures. No additional service, database or deployment is needed for this suite. Workflow wiring is source-reviewed only; no remote CI run was dispatched.

The original implementation temporarily used this exact root dependency symlink in the task worktree:

```sh
ln -s /Users/elijahward/Documents/Codex/2026-10-12/existing-saas-foundations-project-best-use/work/auth-overhaul/node_modules node_modules
```

That symlink supplied React, TypeScript, Vite, Playwright and the previously generated Prisma client. Chromium was already installed under `/Users/elijahward/Library/Caches/ms-playwright/chromium-1208` (headless shell also cached). No package installation or browser download was performed. The symlink was removed before the original clean handoff, explaining why a reviewer without dependencies could not rerun Node/Playwright tests.

For this follow-up, dependencies were copied into an ordinary ignored worktree directory using macOS APFS cloning, preserving the source dependency tree:

```sh
cp -cR /Users/elijahward/Documents/Codex/2026-10-12/existing-saas-foundations-project-best-use/work/auth-overhaul/node_modules node_modules
```

This ignored directory is retained for local review. For a fresh checkout without that cache, use Node 22, install from the root lockfile, generate Prisma client using only a dummy build URL, and install Chromium. These preparation commands do not run migrations or require a live database:

```sh
npm ci
DATABASE_URL=postgresql://dummy@127.0.0.1:5432/dummy npm run build --workspace=server
npx playwright install chromium
# On Linux, use: npx playwright install --with-deps chromium
```

The fresh-install path was not executed locally; local validation used the copied dependencies above. To reproduce the safe test subset, run the listed Node/TypeScript/build commands, excluding `server/tests/database-access.test.mjs` and any schema-resetting integration suite, then:

```sh
PLAYWRIGHT_JUNIT_OUTPUT_FILE=/tmp/propertyflow-onboarding-review.xml ./node_modules/.bin/playwright test -c playwright.onboarding.config.ts --reporter=line,junit
```

Follow-up results: 21 Node tests, 12 browser fixture tests, both TypeScript checks, client build and `git diff --check` passed. Server source was recompiled into `server/dist` before the Node tests. Browser JUnit evidence: `/tmp/propertyflow-onboarding-review.xml`; updated screenshot: `/tmp/propertyflow-owner-onboarding-mobile.png`. The original 24 operations tests remain the prior result; this fix does not change operational logic. No disposable database integration or live authenticated acceptance was run.

## Remaining work and known limits

1. Parent-arranged review of the follow-up fix and CI execution, then authenticated browser acceptance using separate assigned-owner/resident accounts in the existing development environment.
2. Resident-to-property assignment is absent. Accepted invitations create company membership only. Build that isolation boundary before property-specific resident maintenance access.
3. Maintenance submission, manager queue and status lifecycle are absent. Lease/payment workflows and real operational summaries are also absent.
4. Property management supports creation/listing only; detail/edit/units remain follow-on work.
5. Invitation list truncation may hide older issuance (explicitly disclosed). Completion denotes issuance, even if later revoked/expired; usefulness depends on reviewing the Team status. Automatic invitation delivery does not exist.
6. Existing platform invitations are global for platform owners. The checklist filters them locally; no endpoint or server permission changes were introduced.

## Historical release evidence

The earlier audit record is `/Users/elijahward/Documents/Codex/2026-10-13/task/PROPERTYFLOW-MVP-STATUS.md`. Its parent-supplied evidence confirms successful development deployment of PR12 merge `d4760b32718da5b9e8b5a6a8e6bc51dbcc15979f`: [Deploy Dev run 38497232143](https://github.com/elijahvw/property-flow-2/actions/runs/38497232143), and [PR CI run 38495106759](https://github.com/elijahvw/property-flow-2/actions/runs/38495106759). Those are historical results, not a fresh verification or a deployment of this slice. Authenticated acceptance remains outstanding; production deployment is not claimed.
