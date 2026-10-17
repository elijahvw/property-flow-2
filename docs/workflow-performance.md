# Workflow audit and performance tests

October 17, 2026. Local implementation; application deployment and user acceptance remain separate. This batch builds on the unified Auth0 accounts in PR #44. Jira tracking is disabled.

## Measured tests in Grafana

[Property Flow · Local workflow performance](https://slimpillar2069.grafana.net/d/propertyflow-local-performance) contains real before/after measurements. These are **saved local run snapshots**, not live production telemetry or cloud-generated traffic. The dashboard time picker does not change the sample window; each run records its measurement time, Git revision/local-change marker and client-build fingerprint.

`scripts/test-performance.mjs` creates a fresh loopback-only tmpfs PostgreSQL container, applies migrations, seeds fictional data, and runs the production client and actual application APIs with the restricted runtime role. No database or application URL is accepted. The existing preview, development site and customer databases are never targets. It removes only its own container and private fixture files on completion or interruption.

The fixed fixture contains 20 properties, 200 units, 200 tenant accounts/contacts, 200 leases/participants, 200 rent charges, 200 partial receipts/allocations, 200 deposit requirements with immutable revisions, and 100 maintenance requests. Auth0 and email use simulated providers. The read workload checks that source-record fingerprints stay unchanged; normal immutable view audits are allowed.

- **API:** k6 2.3.0, five concurrent users for 20 seconds, eight management reads per iteration. Every response must be successful JSON. Overall p95 <750 ms and p99 <1,500 ms; each route p95 <750 ms; zero failed requests/checks. Staff and resident management-read denials are checked separately.
- **Browser:** five fresh Chromium desktop contexts per screen, real session/bootstrap and APIs, external requests blocked. Measures navigation through API success and rendered heading/two animation frames; records median/max, business API request count and gzip size of scripts actually fetched. Budget per screen: <135 KB gzip JavaScript, <2.5 seconds to rendered view, ≤6 business API requests.
- **Limits:** these loopback results measure a repeatable local baseline, not deployed capacity, network conditions, Auth0 latency, write throughput or payment processing. Browser samples are small; compare repeated runs on the same machine. Reduced JavaScript is a measured transfer-size improvement; similar local render times do not establish a latency improvement.

## Run and publish

Install [official k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) 2.3.0, use the existing npm dependencies/Chromium, and cache `postgres:17-alpine`. Build both workspaces first:

```sh
DATABASE_URL=postgresql://build:build@127.0.0.1:1/propertyflow_access_test npm run build --workspace=server
npm run build --workspace=@property-flow/client
node scripts/test-performance.mjs after
```

`K6_BIN` can select a local executable. Reports are mode-0600 `propertyflow-performance-<label>.json` files in the OS temporary directory. To compare another checked-out production build, set `PF_PERFORMANCE_CLIENT_BUILD` to its absolute `client/dist` directory; it is copied privately before testing so a concurrent build cannot change the run. The unsplit PR44 baseline intentionally fails the new JavaScript budget while its API gates pass.

Generate the dedicated dashboard from one to ten sanitized reports:

```sh
node scripts/performance-dashboard.mjs /tmp/propertyflow-performance-baseline.json /tmp/propertyflow-performance-after.json > /tmp/propertyflow-performance-dashboard.json
```

On macOS substitute the actual OS temporary paths printed by the runner. Publish that dashboard through the connected Grafana plugin, or run `python3 scripts/publish-performance.py <report paths>` using the existing Editor service-account token in `GRAFANA_SERVICE_ACCOUNT_TOKEN`. The publisher is restricted to this stack, folder and dashboard, rejects redirects, logs no credentials/API bodies, and verifies every panel query. It replaces this dedicated snapshot view with the supplied runs; retain reports as needed for later comparisons.

The **Local workflow performance** GitHub workflow is manual and needs no AWS access or application credentials. It uploads only the aggregate report/dashboard with 30-day retention. `publish_grafana=true` explicitly publishes the current run using the existing repository Grafana secret; default false. It is available after this workflow reaches the default branch. No new token, hosted load generator, subscription, paid plan, scheduled job or public collector is required. k6 usage reporting is disabled; private session material is excluded from metrics and removed afterward.

## Workflow audit results and changes

The audit follows the connected operating paths rather than removing consequential reviews:

- **Sign-in, account preparation and tenant management:** PR44 creates/reuses the exact Auth0 account before participation, with in-platform password reset and name synchronization. This audit found the new-lease selector still excluded prepared accounts without portal membership. It now includes those same-company tenant records while excluding disabled, transferred and nonresident members; selecting one creates no account or grant. A disposable regression covers the pre-activation case and disabled-account removal.
- **Properties and units:** directories retain search/property context, readable source labels and staff read-only boundaries. Unit searches now wait 250 ms after typing before querying the API; input and shareable URLs update immediately. Pending results are announced, and persisted URLs load directly without delay.
- **Lease creation and household changes:** the sole property is selected once automatically; multiple-property portfolios still require a choice. New tenant/account wording agrees with Auth0 preparation. Multiple tenant candidates require an explicit primary choice instead of silently selecting the first person. Existing-tenant household reuse from PR44 retains participant/property-grant audits, role approval boundaries and original lease/financial IDs. Error and response-loss drafts remain intact.
- **Lease and maintenance directories:** batched search requests reduce work while typing. Filters, deep links, pagination, return context, empty/error/retry states and management/resident boundaries remain covered by the browser suite.
- **Rent, deposits, financial corrections, statements and reports:** shared currency formatting is extracted unchanged. Existing reviewed posting/correction steps remain because they protect source identities, exact totals, durable retries and immutable history. Residents retain read-only financial projections; there is no payment processor or resident manual-recording control. The disposable financial and browser suites cover these paths and mobile layout.
- **Screen loading across roles:** shared form code is extracted unchanged and pages load on demand behind the existing permission gates. The workspace shell remains visible during chunk loading. This removes the single bundle containing every screen, with no private-data caching or weakened server authorization.
- **Release continuity:** new chunks upload before HTML; old hashed chunks remain available for existing tabs. Source maps are removed and obsolete non-asset public files are still deleted. The release planner includes upload-helper changes. Old hashed assets accumulate across releases; review/prune only after old clients no longer need them. No live bucket/deployment change was performed by the audit.

## Recorded result

The [PR44-client baseline](../tests/performance/results/2026-10-17-baseline.json) and [new-client result](../tests/performance/results/2026-10-17-after.json) use the same backend and fixture in the isolated PR checkout. The new-client run completed 1480 API requests with zero failures and a worst route p95 of 106.22 ms. Both API runs passed; the old client exceeded the new 135 KB JavaScript budget. All eight new-client screens passed their browser budgets. Overview JavaScript fell from 166,148 to 68,158 gzip bytes (59%); screens ranged from 68,158 to 117,181 bytes. Browser median times were similar; this is not evidence of improved deployed latency.

## Validation and acceptance

Both production builds, 175 full browser fixtures, 30 disposable account lifecycle checks, 177 disposable financial checks, 82 safe Node checks (plus five intentional database-suite skips) and the operations checks pass locally. The clean PR checkout independently passed both builds, all 175 browser fixtures and the 30 lifecycle checks. Performance reports and the Grafana dashboard contain only reconstructed aggregate fields; sentinel tests verify private fields cannot pass through. The actual Infinity backend queries were executed for every data panel, not just saved as dashboard JSON.

Outstanding acceptance is real users completing their daily work after an approved release, external Auth0/email delivery and deployed-browser/RUM coverage already recorded in the monitoring register. Isolated performance evidence does not close those items or prove that every future usability issue has been found.
