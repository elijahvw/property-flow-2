# Validation and operations guidance

Read only the checks relevant to the changed area; reuse valid results until code or evidence changes. Local feedback selection does not change required CI, release checks or workflow acceptance.

## Focused feedback, then one fixed final suite

Start with the current working tree, including untracked files:

```sh
node scripts/local-validation.mjs plan
node scripts/local-validation.mjs plan --base=HEAD
```

The read-only plan prints commands for the affected UI fixtures, units, operations and existing disposable database runners. Focused UI checks use the same fixed production config, no-proxy preview and retained failure traces as the final suite; even fixture-only changes require a valid client build receipt. Supply the agreed comparison revision when `HEAD` is not the change base. Inspect the actual workflow and extend the plan when its name-based mapping misses a dependency. Unknown/shared client inputs broaden UI verification; presentation-only changes do not require a server build or every database runner. Shared form guards recommend users/finance recovery checks. Shared server, schema and build inputs retain broad integration verification; identity-provider changes include users and sales demos. No plan result is a completeness claim.

Run relevant groups while implementing; fix a failed assertion before starting another full suite. Pure units and operations checks may run together when they do not mutate the same build. Browser workflows occupy one local lane: run the existing database/browser runners sequentially, finish their container cleanup, then run the final static-client suite. Separate databases, ports, Vite caches and artifact directories are necessary for isolation but do not prevent Docker interface notifications from interrupting Chromium. Never reuse a database, cache a test result, introduce automatic full reruns, or skip a failed test to shorten feedback.

Build the final client and run the complete production-preview fixture suite after corrections:

```sh
node scripts/local-validation.mjs build client --reuse
node node_modules/@playwright/test/cli.js test -c playwright.production.config.ts
```

Use the installed CLI directly to keep the build and validation environment consistent. The committed production config serves the fixed build on loopback port5019 with an explicitly empty preview proxy, so an unhandled fixture request cannot reach a real local API. It runs every `tests/ui` spec with two workers and zero retries, and retains traces on failure. It refuses a stale/missing build receipt or a source/artifact/build-environment change during the run. Keep application source, fixture/preview source and `client/dist` fixed until it finishes. Existing required CI/release coverage remains unchanged.

The output prints a unique `/tmp/propertyflow-production-tests-*` artifact directory. Retain the original failure and trace. `browser-failures.json` summarizes at most20 retained traces with ten console/page errors of 600 characters each; it excludes network bodies, headers and snapshots and omits sensitive-looking messages. This diagnostic summary does not replace the trace or prove whether a failure is environmental. In this overhaul a retained trace exposed a real double-navigation blocker defect; transport failures and product failures require different corrections.

## Build receipts and freshness

```sh
node scripts/local-validation.mjs build client
node scripts/local-validation.mjs build server
node scripts/local-validation.mjs verify client
node --test tests/local-validation.test.mjs
python3 -m unittest discover -s tests/operations -p 'test_browser_failure_summary.py'
```

The wrapper invokes the normal workspace build; it never blesses an existing `dist` directory. A successful build receives a local receipt in `/tmp`, only if inputs remain unchanged while building. Content fingerprints cover source/config/lockfiles, the reviewed recipe, Node and installed dependency versions, and the actual output tree. Server artifacts include the generated Prisma client; generated outputs and `.tsbuildinfo` are excluded from source inputs. Failed builds invalidate the previous receipt. Extra build arguments are rejected.

`--reuse` saves only an exact, supported build whose current inputs and output hashes still match. Build `.env` files, `VITE_*`/`PRISMA_*`/`NODE_*` and npm configuration overrides, custom build hooks/configuration, external TypeScript config dependencies and `.npmrc` disable cache reuse. New Vite/Prisma config code needs an explicit input review before its reviewed hash is updated; do not approve that hash merely to make caching work. This deliberately favors a normal build over uncertain reuse.

A successful normal build with witnessed environment or build `.env` overrides can instead issue a **fresh-only** receipt for the production suite. Setup atomically consumes it once and verifies known source, artifacts and an opaque witness of relevant override values and explicit build `.env` content; teardown checks that same witness again. Unsupported custom config dependencies, hooks, `.npmrc` and external TypeScript paths remain blocked until their inputs are reviewed and modelled. No values are printed or stored in receipts. This reads only explicit repository build configuration, never AWS credential files. It does not discover credentials, grant permissions or allow a standalone record/bless command. If the fresh receipt is consumed or any input changes, build normally again before another suite.

The managed October25 environment supplies `NODE_EXTRA_CA_CERTS` and `NODE_PATH`, so its receipts are fresh-only. Preserve that inherited trust/module configuration; do not clear it to produce a cache-hit claim. Each separate focused or final browser run therefore needs a new normal client build, even if source is unchanged. A standard checkout without unsupported overrides can reuse an unchanged build. Real production `VITE_*` or `.env` settings also use the fresh-only path.

The server wrapper always runs `npx prisma generate && tsc -p tsconfig.json` with a dummy, unreachable localhost database URL and no runtime database URL. It never substitutes compile-only output for a successful normal build. The current managed environment's normal Prisma engine download receives403 from `binaries.prisma.sh`; that path remains blocked here. Matching alternate generation/compilation evidence, where recorded in a dated validation report, is separate and cannot create a normal-build receipt.

## Runtime and independent checks

- Client: React/Vite/TypeScript. Server: Fastify/Prisma/PostgreSQL. Identity: Auth0 OIDC. Follow adjacent conventions and keep database migrations additive where practical.
- Client build: `npm run build --workspace=@property-flow/client`.
- Server build: `DATABASE_URL=postgresql://build:build@127.0.0.1:1/propertyflow_access_test npm run build --workspace=server` (Prisma generation and compilation; no database connection).
- Safe units after building: `node --test server/tests/*.test.mjs` and `node --test client/tests/*.test.cjs`, with integration database variables unset.
- Operations checks: `python3 -m unittest discover -s tests/operations -p 'test_*.py'`.
- Use existing disposable database runners for integration tests (`scripts/test-maintenance.mjs`, `scripts/test-finances.mjs` and related runners). Never point tests at development/customer data.
- Use the existing browser fixture suite for UI regressions and verify changed flows in the local preview. Run checks appropriate to the change; add meaningful coverage for authorization, data integrity and consequential behavior.
- Keep the client build fixed while production-preview browser checks run; rebuilding deletes/replaces hashed assets. Keep development source fixed during disposable browser workflows to avoid HMR resetting the task being tested. In the October25 managed environment, Chromium reported `ERR_NETWORK_CHANGED` and failed lazy module imports while concurrent Docker runners changed interfaces. Run database/browser runners sequentially when reproducing that failure, then run the static-client suite with no container startup/cleanup in flight. Preserve diagnostics and distinguish these transport failures from an application assertion or authorization defect; do not loosen the assertion to hide them.
- Monitoring must accompany shipped workflows: bounded outcome/duration/failure signals, safe logs/traces and an actionable alert/runbook when needed. Preserve RUM privacy; never capture private form/contact/financial data or enable replay implicitly. See `docs/monitoring-coverage.md` for remaining coverage and activation evidence.

Run safe units after the matching build with integration variables explicitly unset:

```sh
node --test client/tests/*.test.cjs
env -u DATABASE_URL -u RUNTIME_DATABASE_URL -u TEST_DATABASE_URL -u TEST_USERS_DATABASE_URL -u TEST_IMPERSONATION_DATABASE_URL -u TEST_FINANCES_DATABASE_URL -u TEST_COMPANY_BILLING_DATABASE_URL -u TEST_MAINTENANCE_DATABASE_URL -u TEST_LEASING_DATABASE_URL -u TEST_SALES_DEMO_DATABASE_URL -u TEST_ROADMAP_DATABASE_URL node --test server/tests/*.test.mjs
python3 -m unittest discover -s tests/operations -p 'test_*.py'
python3 scripts/validate-dev-power.py
```

## Observed feedback cost, October25

These are reported durations at local checkpoints, not a controlled speed comparison. TAP/Playwright durations exclude parent-runner build/database setup and cleanup; the separately labelled build-wrapper measurements cover a different operation. Source, failures, test counts and concurrent load differed; a later fast run cannot validate an earlier or changed build.

| Workload | Reported duration | Scope and limitation |
| --- | --- | --- |
| Pre-reconciliation fixed production UI suite | 7.8m | 454/454 passed; final integrated fixture gate, without retries |
| Earlier complete UI stages | 12.0m / 8.5m / 7.6m | Different 452–453-case snapshots retained failures for correction; not passing final gates or matching speed comparisons |
| Guard-focused UI | 1.2m | Latest 41 passed; different coverage from the earlier 33-case31.4s checkpoint |
| Client units | 3.188s | Latest 69 passed; excludes production build |
| Safe server units | 11.764s | Latest 127 passed and nine explicitly database-gated skips; not integration evidence |
| Users disposable workflow | 57.519s | Latest isolated 56 passed; excludes parent-runner setup and cleanup |
| Sales demo disposable workflow | 66.727s | Latest isolated 19 passed; excludes parent-runner setup and cleanup |
| Finance disposable workflow | 441.9s | 192 passed with other work competing; not an isolated benchmark |
| Normal client build wrapper | 22.630s / 23.358s | Two normal builds in the managed fresh-only environment; neither was a cache hit |

The PR63 repair checkpoint adds new reported durations: five handoff fixtures9.9s, focused provider 25 in 17.3s (including the retained demo pacing), safe server 130+nine skips20.7s, client 69 in 8.2s, fresh demo 22 in 84.5s, leasing 66 in 62.7s and users 56 in 65.2s. The final 459/459 gate passes in 8.4m with zero retries and no source/build drift. These remain separate workloads, excluding parent runner setup/cleanup; they do not prove an apples-to-apples speedup. Initial27/30 focused UI results exposed three prefilled-textarea selector failures; accessible textbox roles retained the exact-value assertions. The controlled15-second telemetry flush passes3/3 without weakening no-domain-write assertions.

The main saving is focused feedback before one final frozen aggregate. Vite-only bundle output of 0.5–0.9s excludes TypeScript and must not be presented as a complete build measurement. Measure a normal build and a verified reuse separately only in an eligible environment; preserve unsupported inputs and report fresh-only behavior honestly.

## Running Codex CLI on an EC2 checkout

No host migration, provisioning, installation or AWS action is implied by this guide. Prepare the intended checkout on the host, read its `AGENTS.md`, and inspect branch and working tree before continuing unpublished work. Use the repository's Node requirement (`^22.12.0 || >=24.0.0`) and committed `package-lock.json`; install the locked dependency tree with `npm ci` when authorized. Python3 is required for operations checks and failure summaries. Do not copy temporary database dumps, `.env` files, demo credentials or AWS credentials as a task handoff.

Browser checks require an installed matching Playwright Chromium plus its Linux dependencies, or an explicitly supplied compatible browser path such as `PF_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`. Installing a browser (`node node_modules/@playwright/test/cli.js install chromium`) is a separate host setup step, with no assumption it has already happened. Disposable database runners require a usable Docker daemon and their PostgreSQL17 image; they manage fresh isolated fixtures and never need a customer/development database. Check each runner's prerequisites before execution.

The users, leasing and finance disposable suites and their imported browser cases use `launchFixtureBrowser` from `server/tests/browser-fixture.mjs`. It honors `PF_CHROMIUM_EXECUTABLE_PATH` while retaining the caller's launch options; an explicit `executablePath` option takes precedence. With no override they use Playwright's normal bundled browser. Record the actual browser version when using a system executable; it is not evidence that the matching bundled browser was tested.

Normal Prisma generation must be able to obtain the matching engine from `binaries.prisma.sh` or an already valid standard engine cache; a compile-only workaround is not equivalent. No live AWS/Auth0 credentials are assumed for the build, fixture suite or stubbed-provider disposable workflows. Keep actual provider, email, document-access, payment and hosted deployment acceptance separate; scanner retirement does not produce a new malware verdict. Use the focused-plan and full-suite commands above on the target host; retain the actual branch, source/build fingerprints, commands and outcome in its handoff.

For agent-usage diagnosis, read numeric usage/config fields only. Do not re-ingest the current chat transcript, Grafana tool-result bodies or full browser trees: they recursively copy existing context. Compare per-request input before/after compaction; cumulative input grows across calls and cannot prove the current context size.
