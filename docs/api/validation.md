# PF-25 API documentation validation

## October 28, 2026 — Swagger parameter rendering repair

This new local repair starts from merged main `7a390f7` (PR75), which includes API PR74 at `23bcede`. API CI40442139603 and power-repair CI40594445905 passed on their own published heads. The October 27 record below retains its prepublication meaning; those results do not validate the new repair. The user's hosted console report establishes a Swagger rendering failure, not the deployed backend SHA or successful hosted resolution.

The full generated document contained 1,852 parameters, including 573 malformed scalar `schema` values across 191 operations. Empty ignored-query object schemas without `properties` were interpreted as shorthand parameter maps by `@fastify/swagger`: root keywords `type`, `additionalProperties` and `description` became fake query names. Swagger UI's ParameterRow called `schema.toJS()` on those scalar values. The expanded browser regression reproduces the caught component failure on unchanged main; emitted-parameter and empty-container unit regressions also fail before the correction.

The fix normalizes only a documentation clone's explicit empty object query/path/header containers to `properties: {}` before generation. Existing properties, references, composed schemas, required fields, enums and defaults retain normal resolution. `x-pf-query-policy` preserves ignored-query prose. No contract is attached to a business route, no handler validation/serialization/authentication changes, and no dependency update, migration, cloud setting or paid service is introduced.

The browser now serves the complete captured production document under the existing real-session owner fixture, expands each method/path one at a time, compares rendered parameter names/locations with the specification, and checks both uncaught errors and React's caught console errors. It requires zero fallback components, Try it out/Execute controls, external requests or business requests. This is documentation-rendering coverage, not full handler verification.

Retained evidence and corrections:

- `/tmp/pf-swagger-contracts-before-fix.log`, `/tmp/pf-swagger-empty-before-fix.log` and `/tmp/pf-swagger-browser-before-fix.log` reproduce the malformed parameter/fallback. Browser trace/screenshot: `/tmp/propertyflow-api-reference-xFt6r1`. An initial unit invocation preceded compilation; its prerequisite failure remains in `/tmp/pf-swagger-contracts-before-build.log` and is not the defect reproduction.
- The first fixed browser attempt reported three favicon 503 responses. Its trace `/tmp/propertyflow-api-reference-MmGEu8` and a diagnostic trace `/tmp/propertyflow-api-reference-vcNmua` identify the fixture's old 64-session-read assertion. Chromium refreshes uncached icons during deep-link history changes; the expanded 304-operation test now derives a finite request budget from its operation/tag open/close count. Console/server/network assertions remain strict. These were fixture-cap failures, not evidence of a hosted icon defect.
- The initial three-minute traversal budget expired after 273 operation selectors had been opened with no component errors. Trace `/tmp/propertyflow-api-reference-5wUQNx` records 1,142 successful HTTP200 reads before cancellation. The complete-catalog test now has a finite five-minute limit; no assertion or retry policy changed.
- Final protected Swagger browser passes all304 operations and1,279 parameter rows in230.4seconds, with1,281 authenticated reads within the2,688-read budget, no caught/uncaught/fallback errors and zero external/business requests. Log `/tmp/pf-swagger-browser-complete.log`; trace and visually inspected screenshot `/tmp/propertyflow-api-reference-1HCAM1`.
- The final fixed production UI suite passes489/489 in6.5minutes, two workers/zero retries/no source-build drift and no retained failure traces. Log `/tmp/pf-swagger-ui-final.log`; artifacts `/tmp/propertyflow-production-tests-RIJD4a`. Normal client build succeeds with a fresh-only receipt (`/tmp/pf-swagger-client-build.log`).
- Documentation/contract-focused tests16/16 pass (`/tmp/pf-swagger-api-focused.log`); all safe server tests155pass with9intentional database-gated skips (`/tmp/pf-swagger-server-units.log`); client76/76 (`/tmp/pf-swagger-client-units.log`), inventory9/9 (`/tmp/pf-swagger-inventory-tests.log`) and the final468-registration drift check (`/tmp/pf-swagger-inventory-final-check.log`) pass. Independent focused reviews, local documentation links and whitespace checks pass.
- Normal backend generation still fails at the Prisma checksum host with HTTP403 (`/tmp/pf-swagger-normal-server-build.log`); matching generated-client TypeScript compilation succeeds but is not a normal-build receipt. This repair's exact-head CI must establish normal generation after publication. Domain database/provider runners are not repeated locally for this documentation-only conversion; their CI checks and hosted acceptance remain separate.

Publication, merge, matching backend deployment and authenticated hosted acceptance remain separate. After a matching deployment, open `/api/docs/` in an own-account platform-owner session and expand formerly affected reads and writes; operation execution must stay disabled. The UI/spec access paths and authority requirements are unchanged. No live provider/database operation or deployment is performed by this repair.

## October 27 prepublication checkpoint (historical)

Validated on `codex/api-contracts-and-swagger` after reconciling merged PR73/main `59fe8834dfc162ca102fcec9104764da4ecc21ff` at local merge `1608d8f`. The final API commit contains this record. PR73's CI40426636988 passed at its exact final head `a422c50`, including normal backend generation; that is dependency evidence, not CI for this new API increment. This increment is local, not published/deployed or accepted with real accounts.

## Result and coverage

The existing React/Vite client and single Fastify HTTP/JSON business API remain. Official free Swagger packages run inside the same backend; no new service, migration, cloud resource, provider activation or credential/grant change is required. Documentation projections never become business `route.schema`, so parsing, response serialization, permissions, source/version checks, durable submissions and financial history remain with existing handlers.

The checked inventory captures **468 registrations** from the controlled production composition: **304 explicit original operations**, **151 generated HEAD** and **13 documentation infrastructure methods**. All265 static registration sites are observed. The generated OpenAPI covers304 operations across239 paths. All304 have source-reviewed field contracts, with zero inventory-only entries, duplicates or orphans. Counts come from the catalog/registration checks, not from a text search or the number of structural runtime schemas (one original telemetry schema; documentation infrastructure has its own schemas).

The conservative **fully handler-verified count remains zero**: source review and representative real-response conformance do not prove every branch of every endpoint. Existing disposable workflows now assert successful serialized results against the documentation schemas while retaining their independent authority, error, concurrency, rollback and recovery checks. Historical fixture error handlers are not misrepresented as the production envelope. Arbitrary historical JSON is explicitly described where the source retains it; current known DTOs are not replaced with generic objects.

## Integrated checks

| Command/check | Result and evidence |
| --- | --- |
| `node scripts/api-inventory.mjs --write`, then `--check` | Pass,468 registrations; `/tmp/pf-api-inventory-final-{write,check}.log`. No handlers, sockets, DB/provider calls or startup jobs run by capture. |
| `node --test tests/api-inventory.test.mjs` |9 passed; `/tmp/pf-api-inventory-final-tests.log`. Missing/changed/added methods, shared-source drift and docs-namespace exemptions checked. |
| `node node_modules/typescript/bin/tsc -p server/tsconfig.json` | Pass on final API source; `/tmp/pf-api-final-compile.log`. This is compilation with the matching real generated client, not a normal Prisma-build receipt. |
| Safe `node --test server/tests/*.test.mjs`, integration variables unset |153 passed,9 intentional DB-gated skips; `/tmp/pf-api-server-units-final.log`. Includes17 API catalog/schema/identity/privacy/docs tests, complete-operation parity, deliberately missing operation, placeholder review rejection, all request/response schema compilation and real health conformance. |
| `node --test client/tests/*.test.cjs` |76 passed after final Help wording; `/tmp/pf-api-client-units-final.log`. |
| Normal client build wrapper | Pass, fresh-only receipt; `/tmp/pf-api-client-build-corrected.log`. Inherited trust/module overrides preserved; no cache-hit claim. |
| Fixed `playwright.production.config.ts`, system browser explicitly selected |**489/489 passed in7.0 minutes**,2 workers,0 retries, no source/build drift or retained failure traces; `/tmp/pf-api-browser-final-corrected.log`, artifacts `/tmp/propertyflow-production-tests-E33lSw`. Includes the4 API Help role/native-navigation/mobile/keyboard cases. |
| `PF_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node --test tests/api-documentation-browser.test.mjs` |1 passed against actual bundled Swagger assets and real session authentication; `/tmp/pf-api-swagger-browser-final.log`. Screenshot/trace: `/tmp/propertyflow-api-reference-Hdd5au`. No external/business/mutation request or business handler execution. |
| Operations unit discovery and development power inventory |100 passed, resource inventory complete; `/tmp/pf-api-operations.log`. No infrastructure edits/apply or Start/Stop operations. |

All disposable runners below used their own fresh tmpfs PostgreSQL, restricted runtime/RLS and isolated fictional fixtures; containers and fixture servers were cleaned before the final static-client suite. Provider behavior was stubbed; no live account/email/provider lifecycle action was performed.

| Existing runner | Passing result | Log under `/tmp` |
| --- | ---: | --- |
| `scripts/test-users.mjs` |73 | `pf-api-users-conformance.log` |
| `scripts/test-leasing.mjs` |68 | `pf-api-leasing-conformance.log` |
| `scripts/test-maintenance.mjs` |149 | `pf-api-maintenance-conformance-corrected.log` |
| `scripts/test-finances.mjs` |192 | `pf-api-finance-conformance-corrected.log` |
| `scripts/test-company-billing.mjs` |15 | `pf-api-billing-conformance.log` |
| `scripts/test-roadmap.mjs` |40 | `pf-api-roadmap-conformance.log` |
| `scripts/test-sales-demo.mjs` |26 | `pf-api-demo-conformance-corrected.log` |
| `scripts/test-impersonation.mjs` |22 | `pf-api-impersonation-final.log` |
| `scripts/test-observability.mjs` |Pass | `pf-api-observability.log`: real PostgreSQL child spans, native SERVER spans, authenticated OTLP and SQL/parameter/URL/credential redaction. |

Chromium154.0.8037.57 and Playwright1.58.2 were used. The bundled browser was absent; no claim is made that it was tested locally. Existing browser helpers now consistently honor the explicit supported path without changing assertions, retries or fixture contents.

## Findings retained and corrected

- Initial maintenance run:124/149 passed. Browser helpers still launching the absent bundled browser were corrected to use the established helper. Vendor history's retained partial JSON snapshots were described accurately instead of requiring the current writer's complete snapshot. Fresh149/149 passes. Test-generated notification PNGs were archived under `/tmp/pf-api-notification-evidence`; original dated evidence files were preserved.
- Initial finance run:156/192 passed. Real statement country codes can be null, and effective-term helpers return a compact changed-term shape or a finite full baseline selection. Documentation now describes both exact outputs; downstream setup failures disappeared in the fresh192/192 run. No financial handler changed.
- Initial demo run:21/26 passed. Historical persisted keys/fingerprints are strings, not necessarily today's UUID/hex request formats. Corrected only those response fields, retaining strict new request rules and exact response properties. Remaining browser launch sites use the established helper; fresh26/26 passes.
- The first full UI invocation omitted `PF_CHROMIUM_EXECUTABLE_PATH`, so browsers could not launch. It was interrupted, not called a product regression or a passing run. Original `/tmp/pf-api-browser-final.log` and `/tmp/propertyflow-production-tests-HmGSSs` remain. After setting the already verified browser path and correcting stale Help wording, a new normal client build/fresh receipt preceded the passing489-case frozen aggregate; no automatic retries or weakened checks.
- Early docs HEAD handling first exposed injection-versus-wire differences, then a `null` payload conflicted with Fastify's generated HEAD wrapper. The docs-scoped empty-string suppression preserves correct statuses and physically bodyless HEAD responses; focused units and fresh real-session22-case validation pass. Original logs remain under `/tmp/pf-api-real-session-tests*`.
- The first real Swagger browser selector assumed an index-only group. Exact source grouping was corrected and the test now reads the reviewed Rental applications contract, actual response fields and readiness503. Original `/tmp/pf-api-swagger-browser.log` remains; final1/1 passes.
- Independent reviews found and corrected a truthy-placeholder completeness loophole and a docs-prefix exemption that could hide new source routes. Review status plus substantive contract metadata is now required; every resolved operation is checked. Only exact known documentation operations with actual plugin provenance receive infrastructure classification. Custom docs-prefix source routes retain their real authorization evidence and business contract obligation. Focused regressions pass.

## Packages, maintenance and remaining release gates

Pinned `@fastify/swagger`9.9.2 and `@fastify/swagger-ui`5.2.5 match official Fastify5 compatibility. Both root and standalone server locks include the25 added package entries; no existing resolved versions/integrities changed. Direct test devDependencies `ajv`8.20.0 and `ajv-formats`3.0.1 name already-installed dependencies and add no packages. Normal lock-only generation and standalone offline `npm ci --workspaces=false --ignore-scripts --dry-run` pass. Licenses are free/open source; the reference uses existing hosting, with no independent paid service. Verification/tarball and packaging logs remain under `/tmp/pf-api-deps-*`.

The normal backend build is still locally blocked by HTTP403 fetching the Prisma engine checksum from `binaries.prisma.sh` (`/tmp/pf-api-server-build.log`). The Prisma schema is unchanged against merged main; the matching real Prisma7.10.1 client from the first increment is retained, with prior full87-model source/generated DMMF proof. Final TypeScript and real PostgreSQL checks pass, but do not substitute for normal generation. API-head CI must establish its normal build after publication. The pre-existing standalone client-lock mismatch is unchanged; the verified client path is the root workspace install/build used by CI.

Source review observed existing response-hygiene/coercion issues, documented in the reference: replay-only opaque deposit `submissionHash`, full company metadata in platform-user projections, and legacy feature-override coercion. They are not silently removed by a documentation change. Historical `RentCharge.termsSnapshot` and versioned demo manifests retain their actual JSON representation. These are explicit behavior follow-ups, not hidden inventory-only contract gaps.

Fixture7 data/source relationships and lifecycle remain unchanged; API documentation introduces no demo fixture change or version bump. Existing bounded request instrumentation covers docs requests, and privacy regressions pass; no private RUM payload, replay, provider activation or new telemetry stream is enabled.

After a separately authorized matching backend/client deployment, sign in normally as an existing platform owner in their own account, then use **Help → API reference**, `/api/docs/`, `/api/docs/json` or `/api/docs/yaml` on that same application origin. Cookies work automatically. Docs/UI/spec/assets require fresh `platform.manage` and deny impersonation, company-only owners and delegated support. The reference cannot execute operations. [Local launch/access instructions](reference.md#opening-the-reference-locally-and-after-deployment) describe prerequisites; no hosted Swagger URL or successful hosted access is verified here. Merge, deployment and real-account/provider acceptance remain with the user.
