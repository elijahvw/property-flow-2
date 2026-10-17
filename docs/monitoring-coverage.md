# Monitoring coverage and rollout

Reviewed October 17, 2026. Scope: Property Flow dev, Grafana stack `slimpillar2069`. No app deployment, Terraform apply, preview restart, preview database changes or new credentials were performed. Existing local changes remain intact.

## Verified and updated in Grafana

- Backend telemetry is arriving from release `3a68657`: database readiness, API traffic/latency, PostgreSQL latency, process memory/CPU, billing runs, safe logs and traces.
- The existing `propertyflow-dev-operations` dashboard in `Property Flow · Dev` now has 21 panels. It adds an API error ratio, billing freshness, workflow outcomes and p95 duration, 401/403 failures, billing outcomes/duration, build identity and direct RUM/alert links. Queries explicitly select the app and dev environment. Readiness displays Ready/Not ready; logs suppress repetitive readiness probes.
- Created Frontend Observability app `propertyflow-dev`, app ID `1169`. Its allowed origin is exactly `https://drfbeumseaytt.cloudfront.net`. No wildcard/local preview origins, geolocation or session replay were enabled. The app has not received deployed browser data yet.
- Email delivery setup initially failed because Grafana only accepts organization-member addresses. After the user added the requested member, the test to the user-selected operations address succeeded in Grafana. A successful send response does not prove inbox receipt. The saved contact point is `Property Flow operations email`; the policy matches `service=propertyflow` and `environment=dev`, leaving the default route and Grafana internal receivers intact. All eight existing Property Flow rules were resumed and visibly evaluated Normal. The newly scoped rule expressions in source await a later provisioner run; the current live rules remain the existing eight definitions.

## RUM source prepared locally

The pinned Faro 2.12.1 SDK is loaded asynchronously only when `VITE_RUM_ENABLED=true` and a valid public `VITE_FARO_COLLECTOR_URL` is supplied. Loopback previews remain disabled. The dev deployment workflow defaults these public values to enabled and the verified app-1169 collector on the next user-approved release; repository variables override them, including `VITE_RUM_ENABLED=false` to disable. Neither value is a secret. Local builds/previews stay disabled by default.

Public collector for app 1169:

`https://faro-collector-prod-us-east-3.grafana.net/collect/85fda8d97af96bb81e5f2fe4d769e991`

Signals: anonymous nonpersistent sessions, React route/view changes, LCP/INP/CLS/FCP/TTFB, navigation/resource timing, JavaScript/rejection/render errors, same-origin business API timings/status, and browser client spans. Strict W3C trace identities connect browser API requests to backend and PostgreSQL spans. Backend sampling remains server-controlled; incoming baggage/tracestate are ignored. Trace headers are excluded from authentication, readiness, operation telemetry, third-party and collector requests.

Every outgoing signal is reconstructed from explicit fields. Queries/fragments, raw record IDs, user/company/contact identity, form values, console output, DOM attribution, exception messages, arbitrary attributes, SQL and response bodies are discarded. Error category plus sanitized frame location/release remain useful for investigation. New/unknown signal types are dropped. Replay and automatic click text collection are absent. The SDK sampler requires its internal boolean `isSampled` until its own hook removes it; the real-wire test verifies that flag is absent from transport.

Dev session sampling is 100%; review actual ingestion and quotas before changing traffic/environment scope. Do not put Grafana OTLP ingestion headers, source-map upload credentials or service-account tokens in frontend variables. Source-map upload is not configured.

## Coverage still required before calling monitoring complete

1. **Release RUM:** include this source in an explicitly approved frontend/backend dev release; its public defaults enable the verified collector, and repository variables can override/disable it. Verify real owner/manager/resident sessions, Web Vitals, route templates and one browser → API → PostgreSQL trace in Grafana. Synthetic wire verification is not cloud ingestion evidence.
2. **Infrastructure:** Grafana's CloudWatch scrape page has **no scrape jobs**. The separate reviewed Terraform root prepares tagged ECS/ALB/RDS metrics; it has not been applied. Review the AWS read role, resource tags, separate Terraform plan and measured collection cost before activation. Then verify CPU/memory, healthy targets, ALB/target 5xx and latency, RDS storage/memory/connections and I/O. Expand to CloudFront errors/cache/latency and relevant S3 metrics with service-appropriate dimensions/regions, rather than enabling every namespace.
3. **Availability:** inventory existing synthetic checks and add public frontend asset/load plus API readiness checks with controlled probe count/interval. Add non-destructive authenticated owner/resident journeys using dedicated test identities after their access/secret contracts are reviewed. Login redirects alone do not prove a working session or business workflow.
4. **Runtime/database pressure:** add event-loop lag, pool occupancy/waiting and timeouts; correlate RDS connections, storage, locks and slow operation trends. Current PostgreSQL spans are not full database health monitoring. Keep query text/binds and private database access out of browser/public telemetry.
5. **Business execution:** verify recurring billing recovery and durable-operation failures under retries, not merely successful HTTP responses. Existing fixed browser operations cover auth, company/property/tenant/lease, rent/deposits/settlement and maintenance; future jobs/notifications/imports need explicit bounded outcome/duration/backlog instruments as they are built.
6. **Dependencies and delivery:** monitor Auth0 login/callback/session failures at the app boundary, plus provider status/limits as available. External email, signature, storage, imports and payment delivery monitoring joins each provider activation; do not fabricate signals for providers not in use.
7. **Recovery and release:** track CI/deploy failures, ECS replacement/restarts/health, RDS backup freshness/failures and scheduled restore drills. A retained snapshot is not evidence of a successful restore.
8. **Alert acceptance:** confirm the operations email arrives, verify label routing and rule evaluation, test a controlled incident and recovery, and record who responds. Review thresholds with actual traffic; low-volume development can make percentage latency/error rules noisy. Keep app outages distinguishable from collector/query failures.
9. **Telemetry health and cost:** missing metrics, failed exports/ingestion, quotas/cardinality/volume and retention need their own checks. Review the current trial/free-plan allowance in Grafana before enabling paid streams, higher-frequency AWS collection, profiling or replay. No paid upgrade or additional collector was activated here.

## Validation

- Client production builds with RUM disabled and enabled; server TypeScript build.
- Privacy unit coverage and actual OTLP tests verify strict remote-parent handling, correlated logs/traces, stripped private data and collector-outage isolation.
- `scripts/test-rum.mjs` runs the actual built SDK in Chromium with every request intercepted. It verifies sessions/views/Web Vitals/errors/API timings/client spans on the wire, no private sentinel values, and trace-header destination boundaries. No Grafana/Auth0/preview network or database is used. Build with the enabled flag and a syntactically valid dummy collector before running it; restore the ordinary build afterward.
- Operations unit tests plus `scripts/test-grafana.py` validate the real Grafana API in an isolated tmpfs container, including all 21 panels, eight rules, and idempotent provisioning. Existing enabled/paused rule state is preserved by the provisioner; new rules remain paused until delivery is accepted.

[Grafana dashboard](https://slimpillar2069.grafana.net/d/propertyflow-dev-operations) · [Frontend RUM](https://slimpillar2069.grafana.net/a/grafana-kowalski-app/apps/1169) · [Backend privacy/runbook](open-observability.md) · [AWS setup boundary](grafana-cloudwatch.md)

Validation result: 25 client unit tests, 14 combined telemetry/privacy tests, 61 operations tests, the real SDK browser wire check, and the isolated Grafana API check passed. Both builds passed; the existing Vite main-bundle size advisory remains. Local preview and its mode-0600 checkpoints stayed running and were not restarted.

## Isolated workflow performance testing

The October 17 audit adds [local performance tests and a measured Grafana comparison](workflow-performance.md). Tests create their own disposable data and run k6/production Chromium locally. Only bounded aggregates are published to `propertyflow-local-performance`; no private records/session material or preview/cloud application traffic is exported. The manual GitHub workflow can repeat and publish a run after merge. These snapshots supplement operational/RUM monitoring; they do not establish deployed capacity or close the remaining activation/acceptance items above.
