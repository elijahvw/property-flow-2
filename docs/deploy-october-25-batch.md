# Deploying the October 25 batch

This is one combined development release from `main`, covering PR61/62/65/66/63/67,
the Alloy/shutdown change in PR64 and scanner retirement in PR68. Merge status is
checked separately from deployment. No live database, IAM, Actions settings or
AWS configuration was inspected or changed for this checklist.

## Before the deployment

1. Finish merging the chosen PRs, with current CI/review. PR68 integrates the
   platform/demo work and PR64 without reverting their changes. Its scanner
   migration is `202610250057_retire_document_scanning`, after immutable
   `202610250056_demo_rebuild_plans`. Demo fixture6 combines the source walkthrough,
   planned future move-out and ordinary unscanned uploads.
2. Check the target's actual full migration ledger/schema and restore point before
   starting the new backend: startup automatically applies pending migrations.
   Follow the [schema/release checklist](feature-acceptance-checklist-2026-10-24.md#release-schemaconfiguration-gates).
   A target with the incompatible PR60 October22 chain needs reconciliation first.
   Never blindly mark migrations applied, rewrite checksums or drop history.
3. Preserve the existing Auth0 web and Management API settings. The M2M grant needs
   `read:users`, `create:users`, `update:users`, and the configured database
   connection must allow the web application. Keep `AUTH0_WEB_CLIENT_SECRET`
   unchanged while existing encrypted demo credentials are needed. New demo
   capabilities reuse this configuration; no payment provider or new application
   secret is required. See [demo recovery/key continuity](sales-demo.md).
4. In GitHub **Settings → Secrets and variables → Actions**, retain the existing
   AWS role/region, Terraform state/lock, database and Auth0 configuration. The
   monitoring preflight also needs variable `GRAFANA_OTLP_ENDPOINT` and secrets
   `GRAFANA_OTLP_HEADERS` and `GRAFANA_SERVICE_ACCOUNT_TOKEN` (Grafana Editor service
   account). Verify that the release role has the existing snapshot permissions
   in `infra/iam/propertyflow-release-prerequisites.json`.
5. To activate Alloy, add a fresh secret `GRAFANA_ALLOY_TOKEN` using a collector
   token with `set:alloy-data-write`, and variable `GRAFANA_ALLOY_ENABLED=true`.
   Leave it disabled if that token is not ready. Experimental ECS container
   metrics are a separate opt-in through `GRAFANA_ALLOY_ECS_METRICS_ENABLED=true`.
   Do not paste tokens into issues, docs or chat.
6. Review the infrastructure change: scanner-free ECS is 0.5vCPU/1GiB without
   Alloy or 0.5vCPU/2GiB with it. RDS gains seven-day backup retention and deletion
   protection; zero-to-seven retention can interrupt service, so use a suitable
   maintenance window. Review an ECR lifecycle preview before applying the
   untagged-older-than-30-days policy; tagged releases are retained. See the
   [AWS audit and outstanding acceptance](aws-audit-2026-10-25.md).

## GitHub Actions UI

1. Open **Actions → Deploy Dev → Run workflow**, select branch **main**, set
   **plan_only=true**, **force_all=true**, **run_terraform=always**, and run it.
   Inspect the plan for the expected changes and any unintended deletion or
   replacement. A plan does not prove the target schema/provider configuration.
2. After the prerequisite checks and plan review, start a new run from **main**
   with **plan_only=false**, **force_all=true**, **run_terraform=always**.
   That run generates and applies its own plan; it does not reuse the prior run's
   saved plan. Recheck any intervening source/configuration changes.
3. Keep Terraform enabled for this first scanner-free release. Backend registration
   deliberately refuses the old scanner-bearing task definition. The workflow
   stages collector credentials when enabled, applies infrastructure, verifies a
   pre-migration RDS snapshot before backend rollout, then deploys matching API and
   client artifacts. The migration snapshot is **after Terraform apply**, so it is
   not a backup gate for every infrastructure change. Obtain an earlier verified
   restore point before the infrastructure change if needed for this rollout.
4. Check backend migration logs, running task/container health, public readiness,
   frontend/backend release match and telemetry. Test private upload/download,
   explicit **Not scanned** status, rejected historical file denial and the exact
   owner/resident sharing boundaries. Use a dedicated demo company for actual
   Auth0 role sign-in/recovery/rebuild acceptance; never use customer data.

A push/merge to `main` currently starts planning only; deployment mutations require
the explicit non-plan dispatch. The separate Stop workflow runs daily at3a.m.
`America/New_York` once PR64 reaches `main`; starts remain manual.
`DEV_AUTO_STOP=false` suspends scheduled stops. This is a scheduled cutoff rather
than idle detection, and GitHub may delay schedules.

## Separate PostgreSQL deep monitoring

Alloy installation/Fleet connection does not itself configure PostgreSQL deep
metrics. That still needs a dedicated monitoring database user, verified TLS,
separate runtime secret injection and a configured Fleet collection pipeline.
Those are separate activation work and do not block the application release.
See [Alloy setup and remaining scope](alloy-collector.md).
