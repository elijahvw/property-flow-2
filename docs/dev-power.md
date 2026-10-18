# Development start and stop

Open GitHub Actions → [Start development](https://github.com/elijahvw/property-flow-2/actions/workflows/dev-start.yml) or [Stop development](https://github.com/elijahvw/property-flow-2/actions/workflows/dev-stop.yml) → **Run workflow** on `main`. Each action uses the same checked controller; no build or redeployment is required. The existing **Dev Start or Stop** action remains available. There is no automatic schedule.

Start brings `propertyflow-dev-db` online, waits for database availability, then sets `propertyflow-dev` in `propertyflow-dev-cluster` to one running task. Stop sets the service to zero tasks, waits for it to stop, then stops the database. Both actions verify account `800754316001` and use region `us-east-1`. Requests serialize with Deploy Dev. Failed waits make the run fail; check its logs rather than assuming the environment changed state. Starting can take several minutes. The workflow requires existing application resources; it does not create them.

The app and ClamAV scanner run in the same ECS task, so both stop and start together. ECS waits for scanner health; startup then checks the public homepage, database readiness and authentication rejection. The scanner updates its signatures automatically. Until its loaded definitions are current, originals remain quarantined and can be retried.

`config/dev-power.json` is the inventory of targets and retained resource types, with reasons and remaining costs. `scripts/validate-dev-power.py` runs before cloud changes, in CI, and against the compiled Terraform plan before apply (including nested modules/counts, without printing private plan values). A new ECS service/database, a removed target, or an unclassified Terraform resource fails validation until its lifecycle is implemented or retention is explicitly justified. Changes to task containers are automatically covered by service start/stop. Every infrastructure PR must update this inventory and its operational tests; `AGENTS.md` records that requirement.

Routine shutdown is a pause, not `terraform destroy`. It retains the database, original documents, credentials, images and public domain configuration. Do not use destruction to save development compute charges.

The deployment role additionally needs `rds:StartDBInstance` and `rds:StopDBInstance` on `arn:aws:rds:us-east-1:800754316001:db:propertyflow-dev-db`. Its existing policy supplies discovery and ECS update permissions.

Stopping retains database data and avoids backend/container and database compute charges while stopped. Storage, the load balancer, its public addresses, and other retained resources still incur charges. This is a cost reduction, not a billing cap. Grafana Cloud is configured on its Free plan; review actual monitoring usage and retained AWS resources.

AWS automatically starts RDS after seven consecutive stopped days. With manual-only controls, run stop again if you leave development off for longer; do not assume it remains off indefinitely. See [AWS RDS stopping documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html).

The static website remains served while the backend is stopped, but sign-in-dependent API operations will be unavailable. A manual Deploy Dev run can also start infrastructure; use the power workflow for ordinary on/off control, without rebuilding the application.

Actual Deploy Dev runs start an existing database and wait for availability before Terraform can restore ECS tasks. After uploading the backend image, deployment checks database availability again and restores at least one ECS task, including when Terraform is skipped. Infrastructure previews do not start either resource. A first deployment may create a missing database; permission errors still fail the run.
