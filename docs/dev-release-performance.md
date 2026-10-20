# Development release performance

Current release checkpoint — October 20: main `1945049` includes merged PRs54–57. [Deploy run 39212763617](https://github.com/elijahvw/property-flow-2/actions/runs/39212763617) passed backend/frontend rollout, migration restore-point gate, readiness/public/auth checks and backend telemetry. [Stop run 39214885405](https://github.com/elijahvw/property-flow-2/actions/runs/39214885405) subsequently succeeded. This PR adds038/039/040 without cloud changes; the user retains review, merge, Start and deployment. Dated performance/preview evidence below is historical; prior preview URLs are not assumed running. [Platform status](mvp-status.md).

Observed deploy #145 (run 38349290930): backend build/push about 69 seconds, ECS stabilization about 187 seconds, frontend build/upload/invalidation about 28 seconds, plus infrastructure and runner setup. This is a historical measured run, not a promise for later releases.

## Automatic component selection

Deploy Dev now compares each component with its own last successful release. Runtime frontend changes deploy frontend; server changes deploy backend; Terraform changes apply infrastructure and redeploy both dependent apps. Documentation, test-only and CI reporting changes skip application releases.

The release planner reads the latest completed main-branch manual release's dev-release-state GitHub artifact. It verifies workflow, event, repository, branch and account. Successful component commits advance independently; failures and skips preserve their previous baselines. Missing, expired or unusable baselines trigger a full release. Failed metadata API access fails the plan rather than silently guessing. Records expire after 90 days. The first run initializes records by releasing all components.

Main pushes still preview infrastructure. Manual plan_only=false remains required to publish. force_all=true rebuilds all components and reapplies infrastructure; use it after changing variables/secrets outside Git. run_terraform=always/never remains an explicit override. Automatic selection never suppresses a previous failed component just because the newest commit does not touch it.

This uses existing GitHub Actions artifacts and read-only Actions metadata permission, with no new AWS resources or AWS IAM grants. GitHub credentials are removed on cross-host redirects to signed artifact storage.

## Runtime release improvements

Docker layers are cached through GitHub Actions and npm ci uses committed lockfiles. Load balancer readiness uses /api/ready every 10 seconds, with two healthy checks on recovery. Keep 60 seconds for connection draining instead of the AWS default 300; longer uploads or streaming would need more. The app closes HTTP connections and its database pool on SIGTERM.

Keep ECS circuit-breaker rollback and public readiness/authentication smoke checks. A rollout timeout prints diagnostics and fails; it no longer scales the existing service to zero for automatic recovery. Frontend-only changes skip database startup and backend replacement. The backend must already be available for public smoke tests.

Stopped RDS startup, image pulls, migrations and backend rollouts can still take minutes. Measure the next runs rather than promising a fixed duration.

References:
- https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-connection-draining.html
- https://docs.aws.amazon.com/AmazonECS/latest/developerguide/load-balancer-healthcheck.html


## Local-first feature batches

Run both production builds before starting `node scripts/local-preview.mjs`. The server build can use `DATABASE_URL=postgresql://build:build@127.0.0.1:1/propertyflow_access_test`; generation does not connect to this deliberately unavailable URL. A cached `postgres:17-alpine` Docker image and a running Docker engine are required.

The preview starts at `http://127.0.0.1:5090/api/local-preview`. Choose a sample owner, manager, staff member or resident. It uses a fresh loopback-only tmpfs PostgreSQL database, all migrations, the restricted runtime role and real application APIs/session cookies/CSRF. No database URL is accepted, no cloud database is used, and external identity/email operations are stubbed off. UI edits hot reload. Server edits require a build and preview restart. Ctrl+C removes the disposable database after saving a private checkpoint.

To preserve a preview during a server refresh, privately save a full `pg_dump --no-owner` from its verified `pf-local-preview-*` tmpfs container into `/tmp/propertyflow-local-preview-backup-<name>.sql` (mode 0600) before stopping it. Restart with `node scripts/local-preview.mjs --restore-local-preview /tmp/propertyflow-local-preview-backup-<name>.sql`. Only local preview backups are supported. The restore retains records and sessions; never use a cloud/customer dump here. This is a development snapshot, not a schema-upgrade facility: restore only against the matching migration set. Remove private temporary backups when no longer needed.

Use `node scripts/test-finances.mjs` for a separate fresh disposable database, `npx playwright test -c playwright.onboarding.config.ts` for fixture/browser regression checks, and safe unit tests with database environment variables removed. The preview remains available during those tests. Capture desktop/mobile evidence for changed workflows. Bundle validated features into a reviewable release; the user decides when to publish to cloud. Existing manual deployment, migrations and readiness checks stay in place.

A one-time PF-05 preview backup can use the additional `--upgrade-from-pf05-preview` switch when restoring: the runner verifies `LeaseCredit` exists and `LeaseMovement` does not, then applies only migration `202610160020_lease_money_movements`. It does not infer arbitrary migration versions or accept an external database URL. Backups made after this upgrade use the normal restore command.


PF-07 local preview update: a verified PF-06 backup can be restored with `--upgrade-from-pf06-preview`. The runner requires `LeaseMovement` and absence of the settlement/account-profile/company-history markers, then explicitly applies migrations 021–023 to its new disposable database. The current preview preserves its existing records and sessions through this upgrade. Current-schema backups use ordinary `--restore-local-preview`. An older PF-05 backup first uses the existing PF-05 switch for migration 020, then is backed up as PF-06 before using the PF-06 switch; no generic cloud migration selector is accepted.

The current local batch includes PF-05 through PF-07, personal/company profiles and role clarity. Production client/server builds pass; 152 disposable finance/API/browser checks, 155 UI checks, 49 safe server unit checks (5 intentionally skipped DB suites), 18 client unit checks and 51 operations checks pass. Profile/company forms use short sections and changed-field reviews; settlement uses four guided steps. Preview remains `http://127.0.0.1:5090`. No cloud deployment, Terraform apply, push or PR was performed.


## PF-08 local batch update (2026-10-16)

PF-08 adds reviewed future-month rent/due/grace/instruction changes, immutable cancellation/history and effective-term billing/current views; see [contract](future-lease-terms.md). Established leases now open to details, with prompts only for an actual draft or unapproved resident requests. Tenant archive/restore is a compact detail-page action. The preview remains at http://127.0.0.1:5090 with prior sample records/sessions restored into its upgraded local tmpfs database.

Validation: both production builds pass; disposable financial/API/real-browser suite 163 passed; isolated UI suite 157 passed; client units 18 passed; operations 51 passed. Server units: 49 passed, with 5 intentional database-suite skips (the disposable financial suite covers database paths). No push, PR, cloud deployment, Terraform apply or cloud database mutation was performed. The Vite build retains its existing >500 kB chunk advisory.

## PF-09 / PF-10 local batch update (2026-10-16)

The owner subsequently authorized merge and cloud deployment of this batch in PR #38. Backend releases now create and verify an RDS snapshot before migrations, retaining this run's snapshot and the four newest other workflow snapshots. Cleanup requires the exact database, account, region, identifier pattern and all three workflow tags (`Application`, `Environment`, `BackupPurpose=pre-migration`). Unrelated backups are excluded. Failure to create/verify a restore point or inspect candidate tags stops rollout without removing older backups. Deployment IAM needs RDS create/describe/delete snapshot and tag read/add rights for these workflow-owned snapshots in addition to existing access.

PR #38 merged as `d047c8c`. The first actual deployment stopped before apply: a targeted ingestion-secret plan included the RDS tag update through module input dependencies. Recovery verifies and populates the existing named secret from Terraform's recorded output without any targeted apply; fresh installations retain the original strict bootstrap-plan guard. Neither path reads a secret value. The full infrastructure plan remains separate.

The connected AWS session verified account `800754316001`, available RDS `propertyflow-dev-db`, no automated backup retention, and main-only GitHub OIDC trust. Keep that trust unchanged. `infra/iam/propertyflow-release-prerequisites.json` adds only the prepared Grafana role management and tagged release-snapshot rights to `PropertyFlowGitHubDeploy`; existing discovery permissions already cover snapshot describe/wait. Use a supplemental managed policy because the role's existing inline policies are close to their aggregate quota. It does not grant secret reads, database data access, other database backups or broader branch trust. The separate Grafana Cloud scrape root still needs its independently scoped management credential.

Snapshot performance follow-up, prepared locally: compare migration paths with the last successfully deployed backend commit. Ordinary backend/UI/infrastructure-only changes skip RDS snapshots; missing or nonancestor release metadata conservatively requires one. For a migration release, start the snapshot before building the image and verify availability immediately before ECS rollout. Build and backup run concurrently, with five-point retention and failure-before-migration preserved. Force-all rebuilds do not themselves imply a schema change. This source change does not modify a workflow run already in progress.

Partial first/final rent and connected lease endings/renewals are ready for local owner testing; see [contract](proration-renewal-transitions.md). Renewal review now shows dates, each new charge once, the total, and billing/deposit effects. Calculation and record details are expandable. The review opens at the top and retains a visible action footer; editing restores the entered values.

Validation: both production builds pass; disposable financial/API/real-browser suite **174 passed**; UI suite **159 passed**; server units **51 passed**, with 5 intentional database-suite skips; client units **18 passed**; operations **51 passed**. The existing Vite chunk advisory remains. No push, PR, cloud deployment, Terraform apply or cloud database mutation occurred.

Docker restarted during final preview preparation and its tmpfs database was lost. The preview was recovered from the October 16, 8:19 PM EDT PF-08 backup, explicitly upgraded through migration 025. Local edits after that backup may need re-entry. The labeled fictional renewal sample was recreated with `node scripts/seed-release-preview.mjs`, which accepts no target arguments and requires the dedicated local company/session.

The preview runner now saves `/tmp/propertyflow-local-preview-backup-auto.sql` every 30 seconds and after clean shutdown. Checkpoints validate the local company, write privately with mode 0600, and replace the previous file atomically only after a complete dump. Failed checkpoints retain the prior file. A clean shutdown/checkpoint/restore was verified to preserve both sample lease IDs. Restore with `node scripts/local-preview.mjs --restore-local-preview /tmp/propertyflow-local-preview-backup-auto.sql` when its schema matches the current build. Backups remain private local development files; remove them when no longer needed. A crash can still lose edits after the last successful checkpoint.

Core workspace local follow-up (after PR #39): added shared `AGENTS.md`; established portfolios no longer mount onboarding/invitation progress. Property counts are permission-scoped and use company business dates. Lease/tenant directories preserve search/property/relationship context. Management maintenance intake adds unit/category/target date and versioned audited edits with a direct detail route. Migration 026 is additive, validated in disposable databases and in the checkpoint-restored local preview only. Existing requester ownership, assignment revocation, Staff read-only access and financial source identities remain enforced. No merge, push or deployment of this follow-up occurred.

Validation: both production builds; 159 browser fixtures (plus 41 affected-flow checks after final refinements); 20 disposable leasing checks, 11 maintenance checks and 174 financial/API/browser checks; 19 client units, 51 server units with 5 database-suite skips; 60 operations checks. Vite still reports the existing bundle-size advisory.

## Core unit-directory continuation (2026-10-16)

Units now follows the connected directory pattern: name/floor search, active/archive filters, readable space and market-rent details, and exact unit lease-history links for owners/managers. Market rent remains an asking amount, separate from lease rent. Filtering occurs in the company-scoped database query before the 50-row limit. Unknown filters and malformed input are rejected. Unit filters also constrain lease status/search/attention views; another company's unit or a mismatched property returns 404. Staff retain searchable read-only unit records without lease links or lease API authority.

Unit search, status and page live in the URL and return through lease list/detail navigation. Existing creation submission keys, dismissed drafts and optimistic editing remain intact. This continuation adds no migration, provider or deployment configuration changes; the earlier uncommitted overhaul and release-workflow changes remain preserved.

Validation: client/server production builds passed; **162 browser fixtures**, **21 disposable PostgreSQL/API/browser leasing checks**, and **70 safe Node checks** passed (five database suites intentionally skipped in the safe run). The isolated leasing runner covers exact unit/company/property filters, search beyond the first page, archive/floor filters and invalid inputs. Desktop and 390px mobile preview inspection confirmed usable rows/actions and no horizontal page overflow. Vite retains its existing >500 kB bundle advisory.

The existing preview was privately backed up before a graceful restart and restored from its final automatic checkpoint. Comparison with the pre-restart backup found no removed or changed original rows; only normal property-view audit events and a new local preview session were added. Existing browser sign-in continued successfully. The preview remains at `http://127.0.0.1:5090`, with automatic private checkpoints retained. No push, merge, deployment, Terraform apply or cloud data change occurred.

## Maintenance progress continuation (2026-10-16)

Added owner/manager progress notes with explicit internal/shared audiences, an authorized paginated timeline, append-only source records and atomic audit/idempotency. Resident views receive shared notes only on their own currently authorized requests. Management-created requests remain internal. See [the contract](maintenance-updates.md).

Migration 027 was applied only to fresh disposable test databases and a checkpoint-restored local preview. The private pre-upgrade backup is `/tmp/propertyflow-local-preview-backup-before-progress.sql` (mode 0600). The runner's explicit `--upgrade-from-core-maintenance-preview` option requires migration-026 request fields and absence of the updates table, then applies only 027. Current-schema automatic checkpoints use ordinary restore. The data comparison preserved every original business record and session identity across 37 tables; only normal session idle-expiry refreshes/new local session and view-audit activity were permitted.

Validation: both production builds, **19 maintenance database/API/browser checks**, **174 financial regressions**, **166 browser fixtures**, **70 safe Node checks** (five intentional database-suite skips), and **60 operations checks** passed. The pre-existing Vite chunk-size advisory remains. Preview and browser stay open at port 5090. No push, merge, deployment, Terraform apply or cloud database/configuration change occurred.

## Maintenance paid-cost continuation (2026-10-16)

Added explicit links from maintenance requests to existing paid expense sources, complete cost totals, reviewed unlink history, source transaction navigation and connected expense-entry/return actions. Cost data remains management-only; resolving a request creates no expense. See [the source and workflow contract](maintenance-costs.md).

Migration 028 was applied only to fresh disposable tests and a checkpoint-restored local preview. The private pre-upgrade backup is `/tmp/propertyflow-local-preview-backup-before-costs.sql` (0600). The runner's `--upgrade-from-maintenance-updates-preview` switch verifies migration-027's updates table and absence of costs, then explicitly applies only 028. Current-schema automatic checkpoints use ordinary restore. All original business rows and session identities across 38 tables were retained.

Validation passed: both production builds, **28 maintenance database/API/browser checks**, **174 financial regressions**, **171 browser fixtures**, **70 safe Node checks** (five intentional database-suite skips), and **60 operations checks**. Desktop preview and phone fixture checks cover source navigation and expense entry. The existing Vite bundle-size advisory remains. Preview/browser stay open on port 5090. No push, merge, deployment, Terraform apply or cloud database/configuration change occurred.

## Core workflow and monitoring PR — October 17, 2026

The current branch combines the local directory/maintenance batch (migrations 026–028), safe Faro RUM and browser/API correlation, the 21-panel Grafana dashboard and scoped alert provisioning, and release restore-point optimization. A migration release now ensures the database is available before starting its snapshot, overlaps snapshot creation with image build, and verifies the restore point before rollout. Nonmigration releases skip snapshots only when a known backend baseline proves no migration paths changed.

The dev frontend defaults RUM to the verified public collector on the next explicitly initiated release; repository variables may override or disable it. Local preview remains disabled. CloudWatch Terraform, synthetic journeys and full monitoring acceptance remain separate unfinished PF-27 work. The living register/acceptance statuses and concise `AGENTS.md` guidance now retain the user's production, real-data, connected-workflow, clean-UI and efficient-validation requirements.

## Jira tracking and maintenance scope review — October 17, 2026

[PF-43](https://property-flow-dev.atlassian.net/browse/PF-43) is the development overview. The dedicated Jira project records 27 roadmap epics and focused implementation, review, release, monitoring, acceptance and bug work, with native dependency/web links and an unreleased PR #40 version. The roadmap links every feature to its actual Jira issue; `docs/jira-work-tracking.md`, the identity map and `AGENTS.md` preserve the lightweight milestone-update workflow. Native GitHub app synchronization remains unverified; direct repository/PR/CI links work independently.

[PF-42](https://property-flow-dev.atlassian.net/browse/PF-42) addresses the P2 maintenance review finding: property-workspace intake now fixes its selected property to the route and only offers that property. Company-wide intake retains property choice. A two-property regression verifies creation, detail/back context and the company-wide alternative. All **16 maintenance/cost browser fixtures** and the client production build passed; the existing Vite bundle advisory remains. Fixture APIs are intercepted; no preview/database restart or mutation occurred. Merge, deployment and real-account acceptance remain user-controlled and unverified.

## RDS backup wait release fix — October 17, 2026

PR #40 merged as `8b74358`. The user then reported `scripts/dev-power.sh start-database` failing with `Cannot start from database state: backing-up`. [PF-44](https://property-flow-dev.atlassian.net/browse/PF-44) fixes both the initial state check and readiness polling to wait for an existing backup. Startup never starts an already running database and only enables the backend after `available`; shutdown also waits before attempting to stop a backing-up database. The existing timeout and unknown/unhealthy-state failures remain enforced.

Validation: **67 operations tests passed**, including six new backup/timeout/fail-closed regressions using a mocked AWS CLI; shell syntax and whitespace checks passed. No AWS power command, deployment, Terraform apply or preview/database change was performed. After merging the follow-up, the user must initiate a new Deploy Dev run from updated main; re-running the old failed job still uses the old source revision. Successful cloud release and actual RUM/workflow acceptance remain unverified.

## On-demand screens and release continuity

Workflow screens now load on demand. Frontend publication uses `scripts/deploy-frontend.sh`: publish new hashed chunks first, remove public asset source maps, then sync HTML/non-asset files with old non-asset files removed. Prior hashed chunks remain available to already-open tabs after invalidation. Do not use a whole-bucket `sync --delete`, which can break a screen loaded later by an older client. Review/prune obsolete hashed assets only after old clients no longer need them. Existing CloudFront invalidation/public verification stay in place. See [isolated workflow benchmarks and audit](workflow-performance.md).
