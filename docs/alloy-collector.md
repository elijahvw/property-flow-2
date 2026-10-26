# Development Alloy collector and scanner review

The separate [scanner-retirement follow-up](scanner-retirement.md) removes ClamAV at the user’s request and supersedes the sizing below: 0.5 vCPU/1 GiB for the app, or 0.5 vCPU/2 GiB with Alloy. Its unscanned-file workflow and migration must ship together. The original sizing/review evidence below describes the preceding proposal.

Prepared locally on October 25, 2026. No infrastructure apply, live schedule activation,
collector connection or scanner resource reduction is claimed. This refines
PF-27 monitoring and reviews PF-15 scanner operations.

## Design and lifecycle

The user selected Alloy inside the existing `propertyflow-dev` Fargate task.
Start brings RDS up before starting the service; Stop verifies zero running and
pending service tasks before stopping RDS. App, scanner and Alloy share these
controls. No separate EC2 instance, ECS service, NAT gateway or log group is added.

Enablement defaults off until credentials are configured. Disabled preserves the
current 0.5-vCPU/4-GiB task. Enabled uses a valid 1-vCPU/5-GiB task: app 1,024 MiB,
scanner 3,072 MiB, Alloy 512 MiB, with 512 MiB task headroom. Existing scanner
image, loopback isolation, updates, concurrency limits and quarantine remain intact.

The published `grafana/alloy:v1.21.1` standard image has a private readiness
endpoint, nonessential lifecycle, restart policy, 512-MiB hard limit, bounded
log buffer and graceful stop timeout. App startup does not depend on Alloy.
Task-wide CPU/memory contention is still shared. Readiness checks verify the
current revision and all Alloy containers; they do not prove Grafana ingestion.

The bootstrap registers Fleet Management with `env=dev`, `app=propertyflow` and
sends Alloy self-metrics to this stack every 60 seconds. Per-task hostnames
distinguish collectors during rolling releases. Old inactive entries may remain.
Fargate storage is ephemeral: unsent telemetry can be lost on task replacement.

## GitHub UI activation

In repository **Settings → Secrets and variables → Actions**:

1. Add secret `GRAFANA_ALLOY_TOKEN` containing the replacement collector token
   (`set:alloy-data-write`). Keep it out of chat, source and tfvars. This differs
   from the application OTLP header and dashboard-provisioning token.
2. Add variable `GRAFANA_ALLOY_ENABLED=true`.
3. Optionally set `GRAFANA_ALLOY_ECS_METRICS_ENABLED=true` for per-container CPU,
   memory and other resource measurements. Grafana marks the native ECS metadata
   receiver experimental. This explicit opt-in enables both its configuration and
   CLI stability flag. It defaults off; no extra AWS role or Container Insights
   subscription is required for this task-local receiver.
4. Run **Deploy Dev** with `plan_only=true`, `force_all=true`,
   `run_terraform=always`; review capacity and cost. After review run the approved
   real deployment. Ingestion setup atomically writes `headers` and `alloy_token`
   to the existing secret before ECS can launch the new task. Terraform stores
   only metadata/references. No new GitHub/application secret-read grant is added.
5. Inspect Alloy's CloudWatch stream, workflow readiness, Fleet Management state,
   applied pipelines and actual hosted series. Exercise Start and Stop.

Skipping Terraform when the enabled setting differs from the deployed task fails
backend registration. Variable changes require `force_all` and Terraform; token
rotation also requires a rollout because credentials are injected at task start.

## PostgreSQL and other collection

Once connected, open Grafana Fleet Management **Remote configuration → Create
configuration pipeline** and use the PostgreSQL integration, matching both
`env=dev` and `app=propertyflow`. A remote pipeline must contain its own destination
components unless pipeline export injection is deliberately configured; bootstrap
component references are not automatically shared across remote pipelines.

Use the private RDS endpoint, verified TLS, a dedicated monitoring database user
and a separate runtime secret injected into Alloy before configuring collection.
Do not place passwords in Fleet pipelines or reuse the app's privileged database
credentials. This increment does not create a database login, change RDS settings,
export query text or activate database log collection/Database Observability.
Those remain separate setup/privacy acceptance. Existing AWS CloudWatch
collection covers managed-service metrics independently. No public RDS access is
needed because Alloy shares the existing app task's network path.

## Scanner sizing findings

Read-only live inspection found revision 26, release `47badac`, running one
0.5-vCPU/4-GiB task, with app/scanner hard limits of 1,024/3,072 MiB. The scanner
limit is a ceiling, not constant actual consumption; Fargate bills task capacity.

The preceding 14 days of `AWS/ECS` service MemoryUtilization returned 266 hourly
samples: mean hourly average 36.7445%, maximum 67.2852%. Against 4,096 MiB these
correspond to about 1,505 MiB average and 2,756 MiB peak for the whole service/task
population. They do not identify scanner working-set peaks or establish scan
capacity during signature updates and concurrent uploads.

ClamAV's published Docker guidance recommends at least 3 GiB. Signature engines
and FreshClam load testing consume substantial RAM. Concurrent database reload
is already disabled; do not count that as a new saving. Dropping to 1–2 GiB could
kill the scanner and leave files quarantined. Do not disable signature testing
or detection databases to reduce the apparent footprint.

Before lowering the cap, measure per-container CPU/memory, working set versus
cache, restarts and app latency through cold start, signature updates, clean/EICAR
acceptance and two concurrent maximum-size uploads. The optional metadata receiver
supports this gate. Retaining the current cap does not prove it is the smallest
possible allocation; this increment makes no unmeasured saving claim.

## Costs and GitHub schedules

Public Linux/x86 N. Virginia prices checked October 25, 2026: Fargate CPU
$0.04048/vCPU-hour, memory $0.004445/GiB-hour. At 176 monthly hours the extra
0.5-vCPU/1-GiB capacity is about $4.34. A `t3.small` at $0.0208/hour, public IPv4
at $0.005/hour and 16-GiB gp3 at $0.08/GiB-month totals about $5.82. Estimates
exclude telemetry, logs, transfer and tax, and do not cap the existing account at
$30. No new paid monitoring plan is enabled.

Schedules are workflow YAML and can be edited through GitHub's web editor.
**Run workflow** still runs immediately. The user selected manual starts only and an automatic stop every day at 3 a.m.
Eastern. There is no scheduled start. The stop schedule is active after the
workflow reaches `main`; setting repository variable `DEV_AUTO_STOP=false`
suspends automatic stops while preserving the manual Stop button. Unset or
`true` keeps scheduled stops enabled. The `America/New_York` timezone handles
DST. Workflows retain the deployment concurrency group. GitHub
may delay/drop schedules; they are neither a hard cutoff nor idle detection and
do not inspect active Codex jobs. Change clock times by reviewing a YAML edit.

## Validation and remaining acceptance

Run the operations suite and power inventory, Terraform format/validate, ECR
mocked-provider tests, and `python3 scripts/test-alloy-config.py`. That script
renders the actual template and validates stable/experimental modes with pinned
Alloy. Local verification passed: 97 operations tests, four mocked Terraform runs,
both rendered Alloy modes validated with v1.21.1, root Terraform validation,
recursive formatting, actionlint v1.7.12 and the development power inventory.
These checks do not start AWS resources, access real databases or prove hosted
collection. Actual rollout, token scopes, Fleet connection, database
provisioning and scanner capacity acceptance remain unverified until exercised.

References: [Fleet registration](https://grafana.com/docs/grafana-cloud/send-data/fleet-management/set-up/onboard-collectors/standalone-alloy/),
[ECS telemetry](https://grafana.com/docs/alloy/latest/collect/ecs-opentelemetry-data/),
[ClamAV memory guidance](https://docs.clamav.net/manual/Installing/Docker.html#memory-ram-requirements),
[GitHub schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Main integration — October25, 2026

This branch now includes merged main `44747bd` (PR65/66/63/67). The roadmap conflict preserves the platform/demo recovery work and the RDS/ECR protections. Application source and schema are unchanged from that main; its459-case browser evidence remains valid for those unchanged paths.

The combined infrastructure source passes103 operations checks, the development power inventory, recursive Terraform formatting, backend-free root validation, four mocked ECR/Alloy Terraform tests, and rendered stable/experimental Alloy configuration validation using v1.21.1. Workflow/validation-recipe source is unchanged from the prior green CI/actionlint checkpoint. No account-backed plan, Terraform apply, credential read, collector activation, Start/Stop or schedule activation occurred here. Final published-head CI/review remain required.

PR68 remains a separate dependent change. Its scanner retirement uses057 after the immutable056 demo migration and combines document examples with fixture6. Merge64 into main first, then update68's target to main and recheck before merging. Merging64 activates the documented3a.m.Eastern shutdown; Alloy remains disabled until separately configured.
