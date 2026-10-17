# Development release performance

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

Partial first/final rent and connected lease endings/renewals are ready for local owner testing; see [contract](proration-renewal-transitions.md). Renewal review now shows dates, each new charge once, the total, and billing/deposit effects. Calculation and record details are expandable. The review opens at the top and retains a visible action footer; editing restores the entered values.

Validation: both production builds pass; disposable financial/API/real-browser suite **174 passed**; UI suite **159 passed**; server units **51 passed**, with 5 intentional database-suite skips; client units **18 passed**; operations **51 passed**. The existing Vite chunk advisory remains. No push, PR, cloud deployment, Terraform apply or cloud database mutation occurred.

Docker restarted during final preview preparation and its tmpfs database was lost. The preview was recovered from the October 16, 8:19 PM EDT PF-08 backup, explicitly upgraded through migration 025. Local edits after that backup may need re-entry. The labeled fictional renewal sample was recreated with `node scripts/seed-release-preview.mjs`, which accepts no target arguments and requires the dedicated local company/session.

The preview runner now saves `/tmp/propertyflow-local-preview-backup-auto.sql` every 30 seconds and after clean shutdown. Checkpoints validate the local company, write privately with mode 0600, and replace the previous file atomically only after a complete dump. Failed checkpoints retain the prior file. A clean shutdown/checkpoint/restore was verified to preserve both sample lease IDs. Restore with `node scripts/local-preview.mjs --restore-local-preview /tmp/propertyflow-local-preview-backup-auto.sql` when its schema matches the current build. Backups remain private local development files; remove them when no longer needed. A crash can still lose edits after the last successful checkpoint.
