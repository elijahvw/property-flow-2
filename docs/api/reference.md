# Property Flow API developer reference

This reference describes the existing Fastify application and the PF-25 API documentation increment. It does not grant access to customer records or authorize a live request. Business APIs remain compatible with the application; introducing OpenAPI documentation does not replace their current authorization, review, concurrency or recovery rules.

## Source and delivery state

This increment starts from PR73's navigation checkpoint `37319bf`, with its narrowly reviewed reauthentication fix `a422c50` also incorporated (local equivalent `691c3f8`). GitHub confirms PR73 merged at `59fe883`; its exact final head passed CI40426636988, including the normal server build. The API branch reconciled that merged base at local merge commit `1608d8f`; its original equivalent cherry-pick is retained without rewriting history. The API increment is neither merged, deployed nor accepted with real accounts merely because local checks pass. The user retains merge and deployment control.

The machine-readable [route inventory](route-inventory.json) records the registered production surface and source evidence. Its route coverage is different from a fully reviewed request/response contract. The initial PR73 business/operations baseline captures **455 method/path operations: 304 explicit operations and 151 generated HEAD operations**; one operation has a registered structural schema. These are baseline counts before documentation routes, not a claim of complete schema coverage. The final checked artifacts own current counts. See [acceptance and remaining gaps](acceptance.md) for the distinction and implementation batches. Current feature and release state remains in [PF-25](../product-backlog.md#pf-25--imports-reconciliation-and-integration-contracts--p2p3) and [current work](../current-work.md).

The integrated local implementation accounts for **468 registrations**: those 455 original operations plus 13 documentation infrastructure methods (six GET and seven HEAD, including static assets). All **304 explicit application operations** now have manually source-reviewed field contracts, with **zero inventory-only gaps**, zero orphan contracts and zero duplicate definitions. This advances the first15-reviewed/289-pending foundation. No operation is classified as fully handler-verified by that conservative coverage status: representative real-response conformance, existing access/recovery tests and release acceptance are separate evidence. The protected UI and full source-reviewed catalog are implemented locally; integrated validation and real-account acceptance remain separate. The eight domain modules in `server/src/api/` retain review metadata rather than claiming validation from registration counts. Their schemas are documentation projections; attaching them to live route schemas would change parsing/serialization and needs a separate compatibility change.

## Architecture and protocol

Property Flow runs one TypeScript/Fastify application backed by Prisma/PostgreSQL. The React client uses same-origin HTTP JSON business endpoints under `/api/`; there is no parallel GraphQL or browser-to-database business interface. Resource URLs identify canonical records. Consequential domain actions use their existing explicit action endpoints; documenting REST does not mean renaming every action, changing a verb, adding `/v1`, or rebuilding the server.

The same application also serves protocol-specific operations:

| Operation family | Actual protocol and constraints |
| --- | --- |
| Sign-in and callback | `GET /api/auth/login` and `GET /api/auth/callback` implement Auth0 OIDC authorization-code flow with PKCE, state, nonce and a short-lived login-binding cookie. They redirect; they are not JSON credential exchange endpoints. |
| Logout | `POST /api/auth/logout` revokes the local session and returns a JSON `logoutUrl` for the browser's provider logout navigation. It is not a redirect response from that API call. |
| Liveness/readiness | `/`, `/api/health` and `/api/ready` report health; readiness performs a database check. They do not create a user session or grant business access. |
| Private document transfer | Current upload and download handlers use JSON with `contentBase64`, filename and media type. A path ending in `/download` does not imply a binary stream. Ordinary uploads are bounded to 5 MiB decoded and supported PDF, PNG, JPEG or UTF-8 text content. Reads retain exact source/version/share authorization. |
| CSV imports and report exports | Import preview receives CSV text inside a JSON request. Report APIs and client export code must be checked individually; a CSV user workflow does not establish a `text/csv` HTTP response. |
| Browser telemetry | `POST /api/telemetry` accepts a separately validated, bounded telemetry payload and returns `204` with no response body. It is not a general user-data logging endpoint. |
| Automatically registered methods | Fastify's generated `HEAD` routes belong in coverage. HTTP methods cannot be silently dropped from inventory because a developer wrote only `get()`. |
| Conditional routes | Sales-demo registration can be disabled by an application option. Coverage records the production registration configuration and distinguishes such conditions; fixture-only servers are not the production API. |

Only actual registrations belong in the inventory. No payment-provider, signature, scanner, bank-feed or other webhook is implied by an integration name. Add a protocol exception only when a handler exists and its authentication, content type and failure behavior have been inspected.

Source: [application assembly](../../server/src/index.ts), [business registrations](../../server/src/application.ts), [session protocol](../../server/src/sessions.ts), [private documents](../../server/src/private-documents.ts), [resident document downloads](../../server/src/lease-document-shares.ts), [unit imports](../../server/src/unit-imports.ts), [telemetry](../../server/src/browser-telemetry.ts).

## External dependencies and standards choices

Auth0 OIDC and its Management API are outbound identity dependencies, not additional Property Flow business APIs. The exposed callback remains a redirect protocol; provider searches, account preparation and password/verification operations retain their own permissions, cooldowns and uncertain outcomes. Optional invitation email uses the existing SESv2 adapter only when its sender/region configuration exists; provider acknowledgment does not prove delivery and an ambiguous send is not automatically replayed. PostgreSQL is accessed by the server, never directly by browser components. Existing optional OpenTelemetry/Faro export destinations are observability dependencies, not new business endpoints. None is provisioned or activated by this documentation increment.

React/Vite and one Fastify REST/JSON application already provide the requested single frontend/backend approach. Keep resource URLs and explicit domain actions compatible; introducing a second API framework, microservices, generated client or runtime validation rewrite would add maintenance without solving this documentation job. The official Fastify Swagger plugins generate and serve the reference inside the current deployment at no separate license/service charge. This is an API documentation change, not a claim to have standardized every legacy list envelope or parser.

Official references used for compatibility and behavior: [Fastify validation/serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [@fastify/swagger compatibility and transforms](https://github.com/fastify/fastify-swagger#compatibility), [@fastify/swagger-ui compatibility and configuration](https://github.com/fastify/fastify-swagger-ui#compatibility), [OpenAPI3.0.3](https://spec.openapis.org/oas/v3.0.3.html) and [Swagger UI configuration](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/). The pinned9.x/5.x plugin lines support Fastify5. OpenAPI3.0.3 matches the installed integrations; protocol-specific responses and documentation-only transforms preserve current handlers.

## Authentication and documentation access

The browser signs in through `/api/auth/login` and receives a server-managed, HTTP-only session cookie. Secure deployments use `__Host-pf-session`; the local nonsecure configuration uses `pf-session`. The session cookie uses path `/` and SameSite Strict. The temporary OIDC login cookie uses SameSite Lax so the callback can bind the original transaction. Provider access/refresh tokens are not supplied to page components or copied into examples.

An authenticated `GET /api/bootstrap` returns the current account projection, membership, permissions, effective company feature modes, CSRF token and support-view context. Use the existing [client API helper](../../client/src/api.ts) and AuthContext for browser calls; do not create a second token store or manually persist bootstrap secrets. Cookies follow same-origin browser rules. Application responses are marked no-store; logging and telemetry must not record cookies, CSRF values or private response contents.

Sign in through the normal application, return to your own platform-owner account if viewing another account, then open `/api/docs/` on that same origin. JSON and YAML specifications use `/api/docs/json` and `/api/docs/yaml`. Static assets and any entry redirects belong to the same protected surface. The complete documentation requires a freshly checked `platform.manage` permission and rejects an active impersonation/support-view context, including one started by a platform owner. Delegated support and company-only owners cannot read it. Platform ownership, company ownership and delegated support are different grants. A public subset needs an explicit exposure decision and its own filtered contract, rather than an unprotected copy of the complete specification. Viewing an operation never grants permission to execute it.

OpenAPI describes cookie authentication; it is not a public bearer-token integration promise. The selected integration uses OpenAPI **3.0.3**, `@fastify/swagger` 9.9.2 and `@fastify/swagger-ui` 5.2.5 with Fastify5 inside the existing application. Swagger uses locally served assets and same-origin URLs, with **Try it out disabled**, no persistent authorization and no external validator. No active cookies, credentials or production payload examples are embedded. Reads can disclose private data or create audit events, so a GET-only execution mode would also need an explicit reviewed change.

## Opening the reference locally and after deployment

1. Use the existing local setup with a local/development database and configured Auth0 application. From the repository root run `npm ci`, then `npm run dev`. This uses the existing client on port 5010 and backend on port 5011; it does not create accounts or grant access.
2. Sign in through the normal application at the exact configured `APP_ORIGIN`. The account needs the existing **platform owner** grant (`platform.manage`). Company owner and delegated Support roles are insufficient. Leave any impersonation session first.
3. Open **Help → API reference → Open API reference**, or append `/api/docs/` to that same application origin. The browser sends its existing HttpOnly session cookie; Swagger does not need an API key or a copied OAuth token. HTTPS uses `__Host-pf-session`; HTTP local development uses `pf-session`. Use the same hostname used for sign-in.
4. The OpenAPI JSON is at `/api/docs/json`; YAML is at `/api/docs/yaml`. These are protected by the same fresh session/role checks as the UI and assets. Read operation details and the coverage metadata: all304 explicit operations are source-reviewed; actual-handler verification and release acceptance remain separate.
5. The explorer cannot execute business requests: Try it out and persisted authorization are disabled. To perform a real job use its normal application workflow, including the existing review, authorization, company scope, CSRF and safe-retry behavior.

For example, **only if** the configured application origin is `http://127.0.0.1:5010`, the local UI is `http://127.0.0.1:5010/api/docs/` and JSON is `http://127.0.0.1:5010/api/docs/json`. This is a launch example, not a claim that a persistent local server or Auth0 session is running. The source-bound `127.0.0.1` development listener is not a hosted service.

Hosted Swagger is unavailable until the matching backend and Help client are deployed through the user's release process. There are no new migrations, credentials, grants or infrastructure resources. Existing `/api/*` routing must reach the backend, and the existing origin/session configuration must remain intact. No hosted documentation URL has been verified by this local increment; after deployment use the **verified application origin** plus the paths above and check both authorized access and anonymous/company/support denial. Do not expose an unprotected exported spec or change grants to get past a denial.

## Request context and authorization

| Input or rule | Existing behavior |
| --- | --- |
| `Cookie` | The browser sends the existing server session. Expired or invalid sessions return `401 SIGN_IN_REQUIRED`; clients restart normal sign-in recovery. Cookie values are never part of documentation examples. |
| `Origin` and `X-CSRF-Token` | Authenticated methods other than GET, HEAD and OPTIONS require the configured same origin and the session's CSRF token. Domain mutation guards recheck the write context. Common failures include `CSRF_REJECTED` and `CSRF_INVALID`; do not collapse them into an invented universal code. |
| `X-Company-ID` | Where a scoped handler consumes this optional header, it must match the current membership company. The client supplies it for operations with an explicit `expectedCompanyId`. It cannot switch a person into an unrelated company or widen platform access. Some account operations also pin company identity in their request body; document those fields individually. |
| `X-Impersonation-ID` | Carries the exact current support-view context from bootstrap; ordinary context is empty. Apart from bootstrap and designated exit operations, a mismatch returns `409 IMPERSONATION_CONTEXT_CHANGED`. Do not fabricate, decode into authority, or retain it across an account/company change. |
| Route and query IDs | IDs are untrusted input. Resolve them through current authorized company/property/lease/source scope. A valid-looking ID does not establish access. |
| Role and capability | Current account, verification, membership and company status determine capabilities. Server guards reread authority; a client-visible button or cached bootstrap is not the authorization source. |
| Feature mode | Required features intersect permissions. `disabled` denies reads/writes for those features; `read_only` permits authorized safe methods but rejects mutations with `SUBSCRIPTION_READ_ONLY`. `enabled` grants no missing role/property/lease authority. Mixed summaries may omit disabled projections. |
| Support view | Effective target authority applies; support does not inherit additional company grants. Business mutations are read-only, with explicitly implemented context-exit/telemetry exceptions. Expiry, target changes and revocation are revalidated. Documentation must state support restrictions per operation. |
| Transactions | Scoped operations use transaction-local company context, explicit filters, current permission checks and existing database row-level security. A schema-valid request is still subject to these checks and source-state rules. |

Capabilities currently distinguish company owner, manager, staff and resident from platform owner/support. Staff normally have property-read access; an explicit maintenance execution grant adds only scoped assigned work. Residents use self-service projections. Leaseholders' authorized financial access does not extend automatically to occupants. Active owners of suspended companies retain the implemented subscription-read recovery path, not ordinary operating authority.

Source: [capabilities and company scope](../../server/src/access.ts), [session/context checks](../../server/src/sessions.ts), [feature dependencies and modes](../../server/src/company-features.ts), [transaction guards](../../server/src/operational.ts), [support eligibility](../../server/src/impersonation-access.ts). See also [access contract](../access-overhaul.md) and [support workflow](../support-impersonation.md).

## Parameters, dates, money and lists

Request bodies are normally JSON objects. Many handlers use an explicit allowed-field list and reject unknown fields. Structural contracts must record real required/optional fields, nullability, lengths, enums and limits from the handler and its validators. Adding runtime schemas needs compatibility review: Fastify/Ajv coercion, defaults or removal of additional properties must not silently alter existing requests or durable submission hashes.

Dates used as business days are validated calendar dates such as `YYYY-MM-DD`. Timestamps are separate values. Company timezone and returned business date determine operational cutoffs; never convert a business day using an arbitrary browser or server timezone. Describe each actual field's format; not every string containing a date uses the same projection.

USD inputs accepted by the shared `cents()` validator are decimal **strings**, with at most two fractional digits and a maximum of USD 1,000,000. Responses may use integer cent fields or decimal strings for aggregate cent totals. Preserve each operation's exact representation and sign conventions. Do not infer a uniform floating-point money schema from a field name or round values through JavaScript binary decimal arithmetic. Rent, deposits and ordinary recorded cash remain separate source operations.

There is no universal list envelope or universal pagination contract today:

| Pattern | Meaning |
| --- | --- |
| Complete array | Some existing directories return a complete bounded array. Local filtering/paging is valid only for that complete array. Any cap/error behavior belongs in its operation contract. |
| Forward cursor | Shared `page()` returns up to 50 `items` and `nextCursor`; it does not supply a full matching total. A missing `total` is not zero. |
| Tenant directory/rental history | Returns `items`, complete `total`, `pageSize`, `nextCursor`, `previousCursor` and company/business-date context. `cursor` and `before` are mutually exclusive. Opaque cursors bind authorized scope/filter/order; do not decode or reuse them with changed filters. Tenant previews are bounded related-record previews, not complete rental history. |
| Import history | Returns up to 50 items, a company-wide total and `nextCursor`; inspect whether a count covers all records or a particular filter before displaying it. |
| Other filtered/page-number lists | Each operation defines supported filters, ordering, total semantics and bounds. The reference does not promise that every list accepts `page`, `limit`, `q` or the same cursor. |

Source: [shared validators/paging](../../server/src/operational.ts), [tenant directory](../../server/src/tenant-directory.ts), [import lists](../../server/src/unit-imports.ts), [business-date reporting](../../server/src/reports.ts), [rent workflow](../rent-workflow.md).

## Versions, review and safe retry

Review state, saved drafts and already-submitted requests are distinct. Keep a reviewed version and original submitted payload together. A background refresh must not silently replace the values/version used for a consequential review.

Many mutations accept `expectedVersion` and a UUIDv4 `submissionKey` **in the JSON body**. Others use different source-version fields, version checks without a durable key, domain-specific receipts or retained pending operations. There is no universal `Idempotency-Key`, `If-Match` or ETag contract. Document each route rather than adding these headers to every example.

For handlers using the shared submission helper:

1. Generate a UUIDv4 once for the intended operation. Preserve it with the exact reviewed payload, actor/company/source context and source versions.
2. Submit once using the current authorized context.
3. If transport fails, times out, or the response is unreadable after submission, the result can be uncertain. Check the canonical source/receipt or retry through that operation's implemented recovery using the original key and payload. Do not generate a replacement key just because the response was lost.
4. A reused key with different details fails with `409 SUBMISSION_MISMATCH`. A stale source/review can fail with `409 RECORD_CHANGED` or a domain-specific conflict. Re-read and deliberately review a new action after resolving the original operation; do not automatically rewrite an uncertain request.
5. Reauthenticate after a definitive `401`. Hide private work after authority loss and recover only through a fresh authorized read. An account/company/support-context change cannot transfer an old submission into the new context.

The browser helper marks interrupted writes, unreadable successful write responses and server failures as potentially uncertain. That client signal is not proof of rollback or a blanket guarantee that any write can be replayed. Version-only mutations must be checked through their own source/history and recovery contract. Honor `Retry-After` when supplied for provider throttling; preserve resumable provider work rather than restarting a lifecycle operation.

Source: [API helper](../../client/src/api.ts), [submission helpers](../../server/src/operational.ts), [task drafts](../../server/src/task-drafts.ts), [financial recovery](../cash-activity.md), [demo lifecycle](../sales-demo.md).

## Errors and status codes

The centralized error handler normally returns `{ error, code, requestId }`. `error` is safe user-facing text; clients branch on `code` and HTTP status, not message wording. The production not-found fallback currently returns `{ error, code }` without `requestId`. Rate-limit/plugin and explicit handler responses must be verified individually rather than assumed to use a single envelope.

| Status | Common meaning; actual operations may be narrower |
| --- | --- |
| `200` | Many existing successful reads and mutations. Do not document every creation as `201` merely from its POST method. |
| `204` | Implemented bodyless telemetry success. Do not parse a required JSON response. |
| `302` | Existing authentication redirects; OpenAPI must describe the response and `Location` where applicable. |
| `400` | Invalid input, invalid JSON or failed structural validation. |
| `401` | Sign-in required or session expired. |
| `403` | Current role/scope, CSRF, verification, feature or support-view denial. |
| `404` | Missing or unavailable authorized source; it must not disclose foreign-company existence. |
| `409` | Source/version/submission conflict or a documented domain/state/limit issue. Preserve the specific machine code. |
| `413`, `415` | Request-size or supported-content-type failure. |
| `422` | Certain completeness limits, such as a resident overview that cannot return complete totals. Not a universal validation status. |
| `429` | Request/provider throttling. `Retry-After` is present only where the actual handler/plugin supplies it. |
| `503` | Centralized unexpected service failure; submission state may be uncertain. |

Only statuses/codes confirmed in a route and its shared guards belong in that operation's contract. A table of possible global failures is not evidence that all statuses occur on every route. Error descriptions and examples must not include provider tokens, submitted private values, SQL/bind values, stack contents or unrelated record details.

Source: [error handler](../../server/src/request-errors.ts), [production not-found handler](../../server/src/index.ts), [telemetry response](../../server/src/browser-telemetry.ts), [resident completeness checks](../../server/src/resident-workspace.ts).

## Operation groups and contract expectations

Group documentation around the work developers support:

- Session and personal account: sign-in/callback/logout, bootstrap, profile, verification and password recovery.
- Portfolio and people: properties, units, tenant profiles/contacts, membership/property access and invitations.
- Leasing: availability, prospects, applications, leases, households, terms, renewals, inspections and agreement preparation.
- Money: rent schedules/charges/receipts/allocations, deposits, settlements, recorded cash and reports. Keep tenant money separate from platform subscription billing.
- Maintenance: requests, replies/updates, assignment/execution/review, vendors, preventive work, calendar and costs.
- Documents, notifications and saved work: exact source/version sharing, own inbox/preferences and private task drafts.
- Platform administration: companies, users, plans/manual SaaS billing, support grants/viewing, demo lifecycle and sensitive account operations.
- Operations: health/readiness, telemetry, documentation UI/spec/assets and actual protocol exceptions.

Every operation needs its exact method/path, stable operation ID, source registration, purpose/current caller, audience, cookie/context requirements, capability/feature/scope rules, path/query/header parameters, body/media/size requirements, safe response shape and actual status/error variants. Include list completeness, business dates/money, version/retry/review semantics and sensitive/no-store behavior where relevant.

An inventory match, a generated summary, an unbounded `object`, or a generic error response does not complete that contract. Structural schemas supplement current business and authorization checks. Reviewed response schemas require special care: Fastify serialization can omit undeclared fields, so attaching a documentation schema to runtime responses without checking the DTO can break compatibility or hide required recovery fields.

Examples use fictional values and minimal permitted metadata. Do not embed passwords, bearer tokens, cookies, CSRF values, private document contents, real customer identifiers or private financial/contact payloads. Sensitive credential-reveal operations can document field names and disclosure restrictions without recording a returned credential.

The [acceptance matrix](acceptance.md) tracks source inventory, reviewed schema coverage, drift checks and real-role/release gates separately. Keep this reference, machine-readable inventory, generated OpenAPI and actual handler behavior aligned in the same change.

## Maintaining the inventory

From the repository root, `node scripts/api-inventory.mjs --summary` reports the captured registration counts and `node scripts/api-inventory.mjs --check` compares the checked snapshot with current registration/source evidence. After reviewing a legitimate change, `node scripts/api-inventory.mjs --write` refreshes that snapshot; refreshing does not approve a changed contract or complete its schema review.

The inventory executes Fastify registration only under its documented controlled synthetic configuration. It substitutes a database-access-denying client, does not load `.env`, suppresses startup jobs/listeners and never injects requests or contacts providers. It associates methods/paths with TypeScript registrations, hashes and source evidence. Evidence follows direct handler code and a bounded helper layer; it cannot prove dynamic branches, every projection or runtime output. It also checks that static server route declarations have not been left unexecuted or unloaded. The coverage and contract checks account for these limits rather than treating source extraction as a schema generator or a live-environment route count.

## Maintaining reviewed contracts

The catalog is split by actual operating domain: core/session protocols7, personal guide/notifications8, accounts/access48, company/platform41, leasing/acquisition47, people/documents/household53, money/reports61 and maintenance39 (304 total). Read the handler and its current shared validators, selection/serializer, transaction and authorization helpers before changing a contract. Dynamic stored JSON is described as such; it is not an excuse to replace a known DTO with an untyped object. Historical `RentCharge.termsSnapshot` and versioned demo manifests explicitly retain their actual unconstrained/extended JSON behavior.

After review, run `node scripts/api-inventory.mjs --write`, then `node scripts/api-inventory.mjs --check`, `node --test tests/api-inventory.test.mjs` and the compiled `server/tests/api-contracts.test.mjs` checks. The contract gate requires every registered operation to have a reviewed entry and rejects duplicates/orphans; schema compilation and generated-spec parity are independent checks. Registration and shared-source changes fail the checked inventory until reviewed/regenerated. A regenerated hash is not proof that a human or agent reviewed the changed contract.

Existing disposable workflows use `api-contract-assertions.mjs` to validate successful real serialized responses against the reviewed schemas. Existing denial/error/version/retry tests remain independent; historical fixture error handlers are not misrepresented as the production envelope. Report the actual suites/coverage rather than turning source-reviewed status into full handler verification. CI includes protected real-session GET/HEAD access and an actual bundled Swagger browser check with no external/business requests.

Observed source hygiene follow-ups stay explicit: deposit receipt replay currently returns an optional opaque `submissionHash` (not a retry token), and platform-user membership projections retain full company metadata. Documentation includes field names/types without values or examples; this increment does not silently remove response fields. Legacy subscription feature overrides also have a documented coercion edge. Review any cleanup as a compatible behavior change with its own access/response tests.

## Documentation infrastructure and inherited methods

The complete business specification excludes its own UI/spec assets to avoid recursive documentation. They are explicitly accounted protocol infrastructure, protected by the same fresh own-account platform-owner gate, no-store policy and impersonation denial. None executes a business operation.

| Registered method/path | Purpose and response |
| --- | --- |
| `GET`, `HEAD /api/docs` | Entry redirect to the trailing-slash UI; the GET registration also serves `/api/docs/` as an alias with HTML200. Redirect302 has no JSON success body. |
| `HEAD /api/docs/` | Explicit bodyless UI headers, matching authorized GET access. |
| `GET`, `HEAD /api/docs/json` | Generated OpenAPI JSON200; owner session required. |
| `GET`, `HEAD /api/docs/yaml` | Generated OpenAPI YAML200; owner session required. |
| `GET`, `HEAD /api/docs/static/index.html` | Bundled HTML reference200. |
| `GET`, `HEAD /api/docs/static/swagger-initializer.js` | Local JavaScript initializer200, with operation execution and external requests disabled. |
| `GET`, `HEAD /api/docs/static/*` | Bundled JS/CSS/images and other local assets200, standard conditional304 where applicable, unavailable asset404. The wildcard remains inside the protected scope. |

These13 registered methods accept no business body or company selector. UI query configuration is disabled. Missing/expired session returns401; missing authority or active impersonation returns403; stale support context can return409 before the docs guard. Production errors use the safe shared envelope; the app not-found fallback has only error/code. HEAD responses contain no payload, including denials. Source/registration evidence is in the inventory and guarded runtime behavior is tested in the validation record.

The151 original generated HEAD methods inherit their exact GET route, parameters, current authorization/status/headers and any read/audit effects while returning no body. They are not another151 manually reviewed business operations. The inventory names each GET counterpart; source-authored docs-prefix routes cannot borrow the plugin exception or its authentication evidence.
