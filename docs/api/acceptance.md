# PF-25 API contract acceptance

This is the API documentation increment's gap and acceptance record. Its source dependency PR73 (initial `37319bf`, final `a422c50`) is verified merged at `59fe883`. This branch began with the equivalent return-context fix cherry-pick `691c3f8`; the merged base is reconciled at local merge commit `1608d8f`, preserving both ancestries. Merge and deployment remain with the user. Existing tests and interface acceptance from the navigation increment do not validate a subsequently changed API document, guard or schema.

The [developer reference](reference.md) records actual conventions and protocol differences. [Integrated validation](validation.md) records final local results, retained failures and remaining normal-build/CI/release gates. The [route inventory](route-inventory.json) is the machine-readable production-registration snapshot. Current release claims belong in [current work](../current-work.md), [release notes](../local-feature-release-notes.md) and the existing [PF-25 register](../product-roadmap.md).

## What complete means

Track these states separately for each production method/path:

1. **Registered:** captured from actual Fastify registration, including loop/template-generated routes, automatic methods and configuration-dependent registrations.
2. **Accounted for:** represented in the contract catalog as a business operation or a named protocol exception with its source, owner and purpose.
3. **Contract reviewed:** actual parameter/body/response/error/media/status, access/scope/feature and version/retry semantics have been reviewed against the handler and shared guards.
4. **Verified:** meaningful checks exercise the applicable validation, response, authorization, context, concurrency and recovery behavior; generated schemas/spec match the reviewed contract.
5. **Released/accepted:** the matching artifacts/configuration are deployed and the applicable real account/provider workflows are accepted separately.

No state implies the next. A generated OpenAPI operation with generic objects is accounted for, not schema-complete. The initial PR73 baseline capture records 455 method/path operations: 304 explicit and 151 generated HEAD; only one has a registered structural schema, and all 455 initially carry source-evidence-only review status. These are the pre-documentation baseline, not final coverage. Current counts must come from the checked machine-readable coverage artifacts; do not infer business-contract coverage from the number of Swagger operations. No complete-contract count is established until the catalog and its review status have been reconciled with the final runtime inventory.

## Integrated local implementation

| Measure | Current source status |
| --- | --- |
| Registered methods/paths | 468 in the controlled inventory configuration: 455 original application/operations registrations plus 13 documentation infrastructure registrations. |
| Original explicit operations | 304, each source-indexed in the operation catalog. |
| Original generated HEAD | 151, accounted for with their GET counterparts. |
| Documentation infrastructure | 13 methods: six GET and seven HEAD, including bundled assets and static wildcard coverage. These are accounted protocol infrastructure, not 13 newly completed business contracts. |
| Manually source-reviewed field contracts | 304 across eight domain modules; zero duplicate or orphan definitions. Source review is not full handler verification. |
| Still awaiting manual field-contract review | Zero catalog entries remain inventory-only after the six-domain continuation. The prior15/289 checkpoint is historical. |
| Handler-verified contract status | Zero in the current coverage classification. Documentation access tests and contract-index generation do not establish business-handler parity. |
| Full documentation/release acceptance | Source-reviewed field coverage and protected UI are implemented locally. Integrated local conformance/regression passed; API-head normal build/CI, publication, deployment and applicable real-account/provider acceptance remain separate gates. |

The one original registered structural schema is telemetry. Documentation routes add their own framework schemas; these do not increase business-handler schema coverage. The inventory checks all 265 static server route declarations in the current source, while real registration expands loops and automatic methods into the counts above. It uses controlled synthetic configuration, not live database/provider configuration, and follows only bounded helper evidence. The final integrated validation record must identify changes to these counts or statuses.

## Reviewed domain coverage

| Module | Reviewed explicit operations | Current verification boundary |
| --- | ---: | --- |
| Core health/session/telemetry | 7 | Actual health schema checks; session regressions remain separate. |
| Guide and notifications | 8 | Detailed source contracts; actual notification workflows exercise projections/retries. |
| Accounts and access | 48 | Source/selector tests and actual user/support workflows. |
| Company and platform | 41 | Source contracts including sensitive no-store credential operations and versioned demo JSON. |
| Leasing and acquisition | 47 | Source contracts including conditional DTO/provider-preparation and draft recovery. |
| People, documents and household | 53 | Source contracts including resident/occupant boundaries and JSON/base64 originals. |
| Money and reports | 61 | Source contracts including exact money types, source hashes, preview/commit and durable history. |
| Maintenance | 39 | Source contracts independently reviewed; current snapshot variants explicitly typed. |

All304 definitions are marked source-reviewed, not fully handler-verified. The real-response conformance helper is exercised by the existing disposable suites; the final validation record must state which succeeded, rather than imply every branch of every operation was exercised. Historical arbitrary JSON remains explicitly unconstrained where that is the real source contract. Observed response-hygiene/coercion follow-ups are recorded in the reference; documenting them does not close their behavior cleanup.

## Gap and acceptance matrix

The baseline column describes the source before this increment; the acceptance column defines the work being checked. Current results must cite the integrated validation record rather than overwrite this baseline as if it were fresh evidence.

| Area | Inspected baseline and concrete gap | Acceptance |
| --- | --- | --- |
| Architecture | Existing single Fastify/Prisma/PostgreSQL application with same-origin REST/JSON business APIs; session redirects and telemetry differ. No architectural rewrite is needed. | Keep current endpoints, business behavior and runtime deployment. Explain actual exceptions; introduce no additional documentation service or paid platform. |
| Production surface | Routes are spread across registrations, generated loops, auth/session assembly and operations entrypoint. A text search alone misses methods/conditions. | Deterministically capture production registration, including generated HEAD and conditional demo/documentation routes; exclude fixtures. Every method/path is accounted for with source/registration evidence. |
| Request contracts | Many handlers validate allowed fields manually; generic TypeScript assertions are not runtime schemas. Required fields/limits/nullability vary. | Review exact path/query/header/body fields and media/size limits. Do not infer all accepted fields from generic objects or route names. Runtime schema adoption preserves existing rejection/coercion/hash semantics. |
| Response contracts | DTOs/selects and aggregate money/projection rules differ. A universal response envelope does not exist. | Record exact safe response fields, nullability and applicable status/content types. Schemas cannot silently drop existing recovery/context fields or expose private selections. |
| Authentication/context | Cookie sessions, Origin/CSRF checks, X-Company-ID and exact support context already exist. No bearer developer API is promised. | Document actual cookie/bootstrap flow, header/body scope pinning and stale-context recovery. Check direct unauthenticated and stale-tab access. Examples contain no active credentials. |
| Business authorization | Capabilities, company/property/lease/source scope, features and support limits intersect; transaction checks remain authoritative. | Per-operation access descriptions cover direct and transitive guards, restricted read projections and mutations. Test representative owner/manager/staff/resident/occupant/platform/support grants and denials. |
| Features | Enabled/read-only/disabled modes and dependent features are implemented, with special account/subscription recovery paths. | Contract reflects actual operation dependencies and mixed-read behavior. A read-only company cannot write through Swagger or direct API. Documentation never substitutes for guards. |
| Errors | Central handler normally returns error/code/requestId; explicit not-found/plugin/domain paths have differences. | Preserve safe actual statuses and machine codes, including malformed JSON, denied/unknown sources, conflicts, body/type limits and throttling. Do not invent universal requestId, validation422 or create201 behavior. |
| Lists/dates/money | Complete arrays, forward cursors, bidirectional tenant cursors and filtered/page-number lists coexist. Business-day and money representations vary. | Each contract states complete versus window/preview counts, opaque cursors/order/filters, date/timezone and exact money types. No generic pagination/money schema conceals real differences. |
| Review/version/retry | expectedVersion/submissionKey is common but not universal; some operations use version-only mutation or retained receipts/provider steps. | Document exact payload/source fence and replay scope per operation. Verify response-loss retry and source conflicts on consequential paths; no replacement key or silent rebase after uncertainty. |
| Protocol exceptions | OIDC uses redirects, document transfer uses JSON/base64, telemetry returns204; CSV workflows need exact handler inspection. | Explicit actual request/response protocols and content types. Inventory absent integrations as absent, rather than fabricate webhook operations. |
| Complete docs/spec exposure | No integrated protected Swagger UI/spec exists in the baseline. Company and platform owner grants differ. | `/api/docs/`, JSON/YAML spec, assets and redirects require fresh `platform.manage` and reject active impersonation, including a platform-owner actor viewing a target. Unauthenticated users, company-only users and delegated support do not receive complete internal/admin docs. |
| Documentation behavior | Interactive exploration can disclose private records or invoke an audited/sensitive GET. | Same-origin/local assets, no persisted authorization or embedded credentials, no external validator and Try it out disabled. No implicit live calls. |
| Drift and completeness | No authoritative route-to-reviewed-contract gate in the baseline. | A new/missing/changed registration or stale catalog/spec fails the coverage check. A deliberate omitted/changed operation proves the gate. Review statuses expose incomplete contracts rather than relabel them complete. |
| Release and providers | PR73, normal build prerequisites, hosted runtime and real Auth0/email acceptance remain distinct. | Verify remote dependency/head/CI, package compatibility/license/cost and matching release artifacts. No merge/deploy/provider acceptance claim from documentation or fixtures. |

## Implementation batches

1. **Registration baseline and contract ledger.** Capture actual production methods/paths and source evidence without querying a database, contacting providers or invoking business handlers. Establish operation ownership, groups, protocol classifications, coverage status and a deterministic check/write workflow. Separate documentation-generated routes from business API routes and account for both.
2. **Protected documentation integration.** Use `@fastify/swagger` 9.9.2 and `@fastify/swagger-ui` 5.2.5 with the existing Fastify5 application and OpenAPI3.0.3. Apply fresh `platform.manage` and no-active-impersonation checks to `/api/docs/`, spec, assets and redirects; preserve session/origin/security/no-store handling. Serve assets locally, disable Try it out/persistent authorization/external validation and introduce no hosted service. Include package/runtime cost and maintenance evidence in the handoff.
3. **Reviewed contracts by domain.** Populate verified requests/responses/errors and per-operation authority/retry semantics against real handlers. Start with session/context/health and representative read/write boundaries, then portfolio/people, leasing, money, maintenance, documents/notifications/saved work, and platform operations. Every remaining gap stays visible in machine-readable status; generic placeholders cannot close this batch.
4. **Completeness and compatibility checks.** Reconcile registered methods/paths, contract ledger and generated spec. Prove the drift check rejects omissions/changes. Verify documentation access and sanitized outputs, real input/error/response conventions and representative consequential recovery using existing suites. Generated client types, if introduced, derive from that verified document rather than a second contract definition.
5. **Integrated handoff and release acceptance.** Record exact changed source and checks, inspected UI/role projections where applicable, remaining contract gaps and provider/build limitations. Update the existing PF-25 entries and release record. The user reviews/merges/deploys; hosted documentation access and real-role/provider acceptance follow on matching artifacts.

These batches are the approved API phase's implementation order, not a request for another permission checkpoint. If a batch is incomplete, report its exact remaining scope and continue authorized work.

## Required integrated evidence

The final validation record must identify:

- Branch/head, PR73 dependency state and source/configuration used for registration capture.
- Actual registered method/path count, accounted operations/protocol exceptions and reviewed versus incomplete contract counts, from checked artifacts.
- Exact command/results for inventory/catalog/spec drift, deterministic generation and a deliberately omitted or changed operation.
- Authorization checks for UI/spec/assets/redirects: unauthenticated, company-only, delegated support, platform-owner, stale/revoked/impersonated context as applicable.
- Actual request/response/error checks, list/money/date compatibility and consequential retry/version cases selected from changed domains.
- Package versions, Fastify/OpenAPI compatibility, licenses, local hosting and incremental cost; no independent paid service.
- Client/server build and relevant existing regression results, including failures, expected skips and unavailable normal-build/runtime/provider prerequisites.
- Sanitized spec/UI inspection: no embedded secret/private examples, external asset fetches, persisted credentials or unintended business execution.
- Deployed/real-account acceptance that remains unverified. A passing local suite is not a deployment receipt.

Do not copy navigation increment counts into this increment as fresh validation. Historical evidence keeps its original source, scope and limitations. Tests must use existing fixtures or verified disposable databases; no live/customer data or provider mutation is implied.
