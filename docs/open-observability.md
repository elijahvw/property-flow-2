# ECS and Grafana Cloud monitoring

This release keeps the existing ECS/Fargate service, ALB, private RDS, CloudFront and start/stop controls. It replaces the Datadog agent and browser/server SDKs with OpenTelemetry exporting directly to `slimpillar2069.grafana.net`'s HTTPS OTLP gateway. There is no EC2 monitoring server, Kubernetes cluster, public collector, paid monitoring plan or application schema change.

## Signals and privacy

- HTTP SERVER spans use route templates, method/status and release metadata. Real PostgreSQL operations are child spans in the same trace. SQL statements, parameters, connection details, exception messages/events and raw URLs are removed before export.
- Metrics cover API request/error rates and latency, PostgreSQL operation latency, readiness, process memory/CPU/uptime, build identity, browser operations and recurring billing health. Process CPU is relative to the current 0.25-vCPU task allocation. Unique process identities prevent overlapping tasks from writing the same cumulative metric stream. Metrics export only explicit app instruments and allowed labels; histogram cardinality is bounded.
- Safe OTLP logs retain trace/span context and fixed operation/error categories. Existing JSON operational logs continue to CloudWatch with seven-day retention. Audit events and financial history remain in PostgreSQL independently of monitoring retention.
- Browser operations and error categories use an authenticated, exact-Origin/CSRF-protected same-origin intake. There are no browser credentials, session replay, form values, raw exceptions or automatic URL capture. Batches/queues and per-user intake are bounded. Monitoring failures do not retry or interrupt a business action.
- SDK exports use bounded batches and short timeouts. A collector outage does not block request completion. API startup without a configured endpoint leaves export disabled; the deployment workflow requires complete Grafana configuration before making changes.

Native Grafana Application Observability can generate its service metrics from the HTTP traces. Use its default hosted data sources and the native OTLP log-query mode. The provisioned dashboard also exposes explicit app metrics, recent Tempo traces and correlated Loki logs. The initial scope does not install Faro session replay, continuous CPU profiling, an AWS read integration or database query-text collection. ECS/ALB/RDS infrastructure metrics remain in AWS CloudWatch; those can later be connected to Grafana with a separately reviewed read role.

## Credentials and one-time setup

Use Grafana Cloud Free. A newly created stack may initially show the included trial; keep collection within the published Free allowances and review Cost Management and Billing. No code upgrades the plan. [Grafana pricing](https://grafana.com/pricing/).

In GitHub repository **Settings → Secrets and variables → Actions**, configure:

1. Variable `GRAFANA_OTLP_ENDPOINT`: the generated `https://otlp-gateway-….grafana.net/otlp` base URL from OpenTelemetry setup. It is not the browser stack URL.
2. Secret `GRAFANA_OTLP_HEADERS`: the generated `Authorization=Basic…` value only, without a shell command or surrounding quotes. The ingestion token needs metrics/logs/traces write scopes. Do not put it in a repository variable, source file, frontend build or chat.
3. Secret `GRAFANA_SERVICE_ACCOUNT_TOKEN`: a service-account token in this stack with **Editor** plus **Alerting → Write via Provisioning API** (`fixed:alerting.provisioning:writer`). Editor covers dashboards but does not include Grafana Cloud alert-rule provisioning. Keep the basic role Editor; no organization Admin role or secret-export role is required. Existing tokens inherit role changes. This is different from the ingestion access-policy token. Use a documented expiration and rotate before it expires. The helper is restricted to the exact selected stack URL and refuses redirects.

Terraform creates only metadata for `propertyflow-dev-grafana-otlp`. On a real infrastructure deployment, Deploy Dev first creates only this secret metadata using a guarded, targeted plan, then writes its JSON `headers` value privately from the GitHub secret before the full infrastructure plan/apply can update ECS. The guard rejects changes to any other resource or replacement/deletion of the secret. Backend-only deployments update the existing value before building the release. Plan-only runs never create or populate a secret. ECS injects it at task start. The token never enters Terraform configuration/state or a public bucket. The execution role reads only this secret; application code is no longer granted the execution role's AWS privileges.

The existing `PropertyFlowGitHubDeploy` role is missing permissions for this new secret and for retiring the separately installed Datadog CloudFormation integration. An AWS account administrator must review and attach [the supplemental managed policy](../infra/iam/propertyflow-observability-deploy.json) before the first Terraform plan/deploy. Use a customer-managed policy named `PropertyFlowObservabilityDeployment`; attach it to that existing role. Keep its existing policies and OIDC trust intact. Do not use another inline policy: the existing role's combined inline-policy size is already substantial. The supplement grants no secret reads to GitHub; the ECS execution role's narrowly scoped read is created by Terraform. The retirement-only statements may be removed after successful cleanup.

## Manual release

The user approves the PR, merges manually and runs **Deploy Dev** from the reviewed main commit:

1. First run `plan_only=true`, `force_all=true`, `run_terraform=always`. Review the plan: the existing app hosting and database stay in place; the task loses the vendor agent and gets OTLP environment/secret references, and one secret plus a scoped execution-role policy are added. Saved plans remain on the ephemeral runner because existing app settings contain secrets.
2. After review, run `plan_only=false`, `force_all=true`, `run_terraform=always`.
3. The workflow checks configuration, stages and populates the ingestion secret without logging it, replans and applies infrastructure, builds the backend, provisions the dashboard/eight rules, rolls out an immutable SHA-tagged backend, checks public readiness, verifies metrics/logs/traces for the deployed release, and deploys the frontend. Frontend sync removes old public source maps. Existing Datadog integration resources are retired only after the checked release and a second hosted-ingestion check.

The ingestion secret has an `AWSCURRENT` value before the full apply can update ECS, including the first cutover. The metadata-only bootstrap captures plan JSON privately and rejects unrelated infrastructure mutations before applying anything. The existing healthy task remains behind the ALB under the service's deployment policy. A missing/invalid credential fails the workflow; the application does not require a working exporter to serve requests. The immutable rollout check rejects a circuit-breaker rollback as a successful release. If hosted ingestion fails, the release stays red and the integration cleanup does not run; inspect the Grafana configuration and roll forward. No old task is forcibly stopped by cleanup.

## Dashboard and alerts

After successful provisioning: [Property Flow · Dev operations](https://slimpillar2069.grafana.net/d/propertyflow-dev-operations).

The eight rules cover missing telemetry, failed database readiness, API error rate, API p95 latency, app memory/CPU, recurring-billing failures and browser-operation errors. Their PromQL is evaluated against synthetic fixtures in CI, and a real disposable Grafana container checks API compatibility with an Editor token. New rules start paused. After the first successful hosted check, review the account's contact point/delivery destination and enable the rules you want. Reprovisioning preserves an existing rule's enabled/paused state and leaves unrelated folders, dashboards and rules alone. No notification receiver or message destination is silently created or changed.

For APM acceptance, make a real owner/manager request, expand its PostgreSQL child spans, inspect its linked safe log, and find the matching release in metrics. Financial actions must still be checked in the application/audit ledger; telemetry is best effort. Grafana's waiting-for-data screen is expected until the new backend is deployed. The workflow's hosted checks prove actual ingestion; unit tests alone do not.

## Datadog retirement and remaining owner steps

The root AWS stack is `DatadogIntegration`, separate from this repository's Terraform. `scripts/retire-datadog.py` is dry-run by default. The deployment no longer includes a Datadog retirement option or job. The manual script remains for explicit, separately reviewed recovery or cleanup; it is never run by deployment. It targets the inventoried nested stack, its exact empty Forwarder bucket, the app's forwarding subscription, its integration roles/functions/EventBridge connection, the exact retained API-key secret, and unused Datadog-agent task definitions. It refuses another bucket/secret, a nonempty bucket, another log group's Forwarder dependency, protected/running agent tasks or a different AWS account. It never retrieves secret values, purges bucket objects or stops tasks. A retained vendor secret is scheduled for seven-day recovery-safe deletion if CloudFormation has not already removed it.

Recovery: the EventBridge cleanup policy includes both the exact name-only ARN and the ARN with a trailing ID for the reviewed destination and connection. CloudTrail showed `DeleteApiDestination` authorizing against the name-only ARN. Keep both forms without widening to other names/accounts/regions. On a partial CloudFormation delete, the helper ignores `DELETE_COMPLETE` summaries while still inspecting retained (`DELETE_SKIPPED`) resources. Correct the policy before retrying cleanup; the already checked app does not need another rollout.

After successful cutover, the repository owner must delete the obsolete `DATADOG_API_KEY` Actions secret and any `VITE_DATADOG_*` / `DATADOG_*` variables found in repository settings. These cannot be deleted using the workflow's normal repository token. Revoke the corresponding vendor API/application keys and browser client token in Datadog, disconnect its GitHub integration, and close any trial/subscription as intended. Deleting a GitHub secret alone does not revoke the vendor key or cancel billing. Keep unrelated Auth0, database, Cognito and AWS configuration intact.

Old Git history, retained images and versioned Terraform-state history are preserved. Historical credentials in those snapshots become inert after vendor-side revocation; rewriting or purging recovery history is outside this change. Current runtime/workflows no longer consume them.

## Verification

Local checks include both builds; existing UI and disposable PostgreSQL suites; authenticated/CSRF/rate-limited browser telemetry; real PostgreSQL child-span correlation; authenticated OTLP metrics/logs/traces; exporter privacy, metric label filtering, outage isolation; real Grafana API provisioning/reprovisioning; and actual Prometheus expression evaluation. CI retains all previous suites and JUnit artifacts, adds these regressions, and removes the vendor upload step. Terraform format/validation and AWS IAM Access Analyzer validation cover the proposed configuration. No agent-run deployment, live database mutation, secret retrieval/deletion, IAM grant or provider message is part of implementation.

References: [Grafana native OTLP ingestion](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/), [Node.js instrumentation](https://grafana.com/docs/opentelemetry/instrument/node/), [Application Observability configuration](https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/application-observability/manual/configure/).


## Queued AWS metrics connection

The user requested a Terraform-managed Grafana CloudWatch connection. Its role, resource tags and separate disabled scrape job are prepared locally; see [configuration and approved activation](grafana-cloudwatch.md). Nothing has been applied. This supersedes the earlier future-work description for the AWS read integration.

## Expanded coverage review — October 17, 2026

The dedicated dashboard now has 21 panels and explicit dev/service metric scopes. Full Faro browser RUM is implemented locally and its Grafana frontend app exists, but browser ingestion awaits an approved application release. This supersedes the original operation-metrics-only browser scope; replay remains off. See [monitoring coverage, actual live evidence and remaining work](monitoring-coverage.md).

## Optional ECS Alloy collector — October 25 local increment

An optional Fleet-managed Alloy container and existing Start/Stop integration are prepared in Terraform. Collector credentials remain runtime-only, and optional experimental ECS metadata collection supports scanner sizing. PostgreSQL credentials/query-level collection are not activated by this change. See [activation, current resource evidence, schedules and limits](alloy-collector.md).
