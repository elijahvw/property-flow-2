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
