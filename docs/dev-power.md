# Development start and stop

After the first deployment, open GitHub Actions → Dev Start or Stop → Run workflow. Select branch `main`, choose `start` or `stop`, and run it. There is no automatic schedule.

Start brings `propertyflow-dev-db` online, waits for database availability, then sets `propertyflow-dev` in `propertyflow-dev-cluster` to one running task. Stop sets the service to zero tasks, waits for it to stop, then stops the database. Both actions verify account `800754316001` and use region `us-east-1`. Requests serialize with Deploy Dev. Failed waits make the run fail; check its logs rather than assuming the environment changed state. Starting can take several minutes. The workflow requires existing application resources; it does not create them.

The deployment role additionally needs `rds:StartDBInstance` and `rds:StopDBInstance` on `arn:aws:rds:us-east-1:800754316001:db:propertyflow-dev-db`. Its existing policy supplies discovery and ECS update permissions.

Stopping retains database data and avoids backend/container and database compute charges while stopped. Storage, the load balancer, its public addresses, and other retained resources still incur charges. This is a cost reduction, not a billing cap. Grafana Cloud is configured on its Free plan; review actual monitoring usage and retained AWS resources.

AWS automatically starts RDS after seven consecutive stopped days. With manual-only controls, run stop again if you leave development off for longer; do not assume it remains off indefinitely. See [AWS RDS stopping documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html).

The static website remains served while the backend is stopped, but sign-in-dependent API operations will be unavailable. A manual Deploy Dev run can also start infrastructure; use the power workflow for ordinary on/off control, without rebuilding the application.

Actual Deploy Dev runs start an existing database and wait for availability before Terraform can restore ECS tasks. After uploading the backend image, deployment checks database availability again and restores at least one ECS task, including when Terraform is skipped. Infrastructure previews do not start either resource. A first deployment may create a missing database; permission errors still fail the run.
