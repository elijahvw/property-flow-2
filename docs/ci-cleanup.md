# CI cleanup without reducing test coverage

Development change based on merged PR27/main `ada0fb5`. The user merges and deploys manually; this change does not alter deployment, app behavior, shared databases, accounts or Auth0. It needs its own PR approval.

## Baseline and changes

PR27 exact-head run 38789117014 passed. Its log shows 96 browser tests in 53.2 seconds; browser installation plus those tests took about 73 seconds. The maintenance/leasing/finance/users disposable suites together took about 33 seconds, including startup/cleanup. These tests protect different layers: UI fixtures check interaction contracts; real PostgreSQL/API/browser suites check permissions/RLS, concurrency, audit rollback and committed-response-loss recovery. Removing one would reduce coverage.

The old workflow ran root `npm install`, then a second `npm ci --prefix server`. The root lock resolved Prisma/client/adapter 7.4.1 and Node types 20.19.33, while the standalone backend lock used 7.4.2 and 20.19.35. The workspace lock now matches those existing backend direct versions and the associated Prisma engines. No declared dependency ranges or standalone backend lock changes are required; unrelated transitive versions stay unchanged. Both clean local and CI builds verify the single install.

CI now uses one root `npm ci --no-audit --no-fund`. Removing npm's install-time audit request does not remove a security test: the workflow had no audit gate, and `npm install` only printed an advisory summary. A deliberate vulnerability-scanning gate is separate work. No test command, suite, filter, assertion, reporter, artifact or Terraform check is removed.

All current browser tests use the default headless Chromium shell. Installation adds `--only-shell` to avoid downloading the unused full browser; system dependencies and the headless shell remain installed. The installed Playwright CLI supports this option. If a future suite needs a headed browser or a specified full-browser channel, its install must be extended accordingly.

Workflow concurrency is grouped by workflow and PR number (ref fallback), with cancellation of older in-progress runs for that same PR. Different PRs and deployment workflows remain independent. The latest revision still runs the complete suite. Existing required job identifiers `lint-and-test` and `terraform-validate` stay unchanged. This does not bypass branch protection.

## Verification

Local validation passed: clean workspace `npm ci`, both builds, 51 safe Node checks (5 database suites skipped there and run separately), 24 Python operations checks, all 96 browser fixtures, and disposable PostgreSQL/API/browser suites: finance61, leasing19, users22, maintenance9 and access40. All eight test commands are identical to the baseline; no test source/config files changed. Inspect the exact-head remote CI and all PR comments/reviews before asking for approval. No hosted-run speedup is promised until measured; package downloads, runner startup and CPU vary. The earlier full-browser download took only part of the 20 seconds of setup, so this change should save overhead rather than make CI instantaneous.

Official references: [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/), [Playwright headless-shell installation](https://playwright.dev/docs/browsers#chromium-headless-shell), [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
