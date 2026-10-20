> Status reconciled October 20, 2026: use [current platform status](mvp-status.md) and [the roadmap](product-roadmap.md) for delivery and remaining scope. Dated branch/release/test/limitation statements below are historical checkpoints, not the current deployment or acceptance state. No historical pass is promoted to real-account acceptance.

# Property workspace: detail and edit checkpoint

Date: 2026-10-14. Base: verified origin/main `163df0b` (PR13 merged).
Branch: `codex/property-detail-edit`.
Checkout: `/Users/elijahward/Documents/Codex/2026-10-13/task-8/property-detail`.

## Delivered

Property names in the company directory link to `/company/properties/:propertyId`. The dedicated detail page shows the current name/address, breadcrumb/back navigation, loading, failed-load retry, safe 403/404 states, and a read-only staff view. Owners/managers can edit the five existing fields; failed saves retain drafts, cancellation discards drafts, successful saves update the displayed values, and forbidden/missing save responses disable further editing. Identity/company/access changes remount the page to discard old state.

GET/PATCH `/api/company/properties/:propertyId` use the existing session middleware (origin and CSRF for PATCH), company permissions, transaction-time permission refresh, company RLS, and explicit company predicates on both lookup and write. PATCH requires exactly the five bounded existing fields, rejecting extra fields and blank/non-string/oversize values. Successful reads and writes append `property.viewed` / `property.updated` audit events in the same transaction. Outside-company IDs return the same 404 as missing IDs. Platform-only authority grants no property access.

## Integration points

- `client/src/pages/PropertyDetail.tsx` owns the page and form; uses current shared CSS classes without style changes.
- `server/src/property-detail.ts` owns new routes; two small registration edits in `application.ts` integrate it with existing tenantTransaction/session controls.
- `App.tsx` adds one guarded detail route and matches the existing Properties shell title/section for nested paths.
- `Workspace.tsx` changes only the property-name cell into a link.
- `operation-lifecycle.ts` adds `property.update`.
- Focused browser coverage is in `tests/ui/property-detail.spec.ts`; PostgreSQL coverage extends the existing guarded local-only integration harness.

No dependency on PR14 or maintenance changes; no schema, delete/archive, unit, lease, financial, resident, or document work. Existing task status files were left intact. This is an independent local clone/branch because the source Git administration directory was outside writable roots; source checkout and its changes remain untouched. A reviewer can fetch/cherry-pick the local commit into the main repository later.

## Verification

- Client/server production build and TypeScript checks: passed. Build used an inert local DATABASE_URL and a copied Prisma cache in `/tmp/propertyflow-prisma-cache`; no database connection was needed for generation/build.
- `node --test server/tests/access.test.mjs server/tests/tracing.test.mjs client/tests/*.test.cjs`: 21 passed.
- `TEST_DATABASE_URL=<disposable localhost:55438/propertyflow_access_test> node --test server/tests/database-access.test.mjs`: 16 passed, zero skips. PostgreSQL 16 ran in the disposable `propertyflow-detail-test` Docker container; this harness only accepts a named isolated localhost test database. Container removed after checks.
- `node node_modules/@playwright/test/cli.js test --config=playwright.onboarding.config.ts`: 18 passed, including 6 property-detail tests and 12 existing onboarding tests. Mocked same-origin API fixtures only.
- `git diff --check`: passed.

## Stopping point and limitations

Implemented and tested local checkpoint. No push, PR, merge, deployment, paid resources, or existing database operations. Independent review is pending and required before publishing. Continue in Codex: independently review the focused diff, resolve findings, then decide whether to publish or integrate with the latest main. PR14/maintenance integrations may conflict in App.tsx or the registration area of application.ts; retain both routes/modules rather than replacing either feature.

Existing updates use last-write-wins semantics; no optimistic concurrency/version API was added in this slice. Address fields follow current schema and required-field conventions. Audit events record actor/company/target/action without copying address values. No authenticated production smoke test or visual screenshot review was performed.

## PR14 integration checkpoint (2026-10-14)

PR15: https://github.com/elijahvw/property-flow-2/pull/15. Original property head `d09987c` passed independent review, GitHub CI and completed automated Codex review with no findings. CodeRabbit skipped automatic review. Main then merged PR14 at `a6799968f9051de061ab456d7856a7d0015d98ae`, creating one conflict in the shared PostgreSQL fixture user list.

Integrated main through an ordinary merge commit. The sole manual code resolution keeps both `staff-a` (property read/write tests) and `resident-a2` (resident assignment tests). Production modules auto-merged: property links and resident management controls coexist in the list; application registration retains property-detail routes alongside resident assignment routes and opaque user-ID handling. No feature expansion or edits to maintenance work.

Combined verification passed: production build and client/server typechecks; 38 Node checks covering access, tracing, assignment retry/opaque-ID behavior and client contracts; 25 browser fixtures covering onboarding, property detail/edit and resident management; 40 isolated PostgreSQL checks including property audit/RLS and resident lifecycle concurrency. Disposable PostgreSQL container removed after verification. No existing database operations.

The branch is published solely for CI and narrow independent review of this integration commit. PR15 remains unmerged until parent reviews the new head. Combined resident/property tests are now verified; integration with the separate maintenance branch remains unverified. No deployment or main push performed. The earlier local-only stopping-point paragraph records the original checkpoint and is superseded by this section.
