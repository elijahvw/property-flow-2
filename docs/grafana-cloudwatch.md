# Grafana Cloud AWS metrics through Terraform

Prepared locally at the user's request. No IAM role, resource tags, Grafana registration or collection has been applied. The application deployment remains on hold until the user approves a batched cloud release.

The dev root creates `propertyflow-dev-grafana-cloudwatch` in account `800754316001`, trusting Grafana's AWS account `008923505280` only with the supplied External ID `3678509`. Its inline policy grants `cloudwatch:GetMetricData`, `cloudwatch:ListMetrics` and `tag:GetResources`. Those discovery/query APIs require wildcard resources. Resource tags limit the scrape selection, not IAM authority.

Existing ECS cluster/service, RDS instance, ALB and target group receive `Application=propertyflow` and `Environment=dev` tags. The load balancer is still part of the current CloudFront/API architecture; this change does not remove it.

A separate Terraform root at `infra/terraform/grafana-cloud` discovers the regional Cloud Provider API URL from stack `slimpillar2069`, verifies its Prometheus instance ID matches the External ID, registers the reviewed role ARN and defines a disabled-by-default scrape job. No manually copied regional URL is needed. It selects standard ECS, RDS and ApplicationELB metrics every five minutes in `us-east-1`, filtered by the two app tags. No Container Insights, metric streams, AWS collector, extra log ingestion or new paid plan is enabled. CloudWatch API requests and Grafana ingestion can still incur usage charges; inspect actual volume after approved activation.

## Approved release sequence

1. An AWS administrator reviews the supplemental deployment-role policy `infra/iam/propertyflow-grafana-cloudwatch-deploy.json` if the existing deployment role lacks scoped IAM creation/tagging/policy rights. This grants management of only the named Grafana read role. Do not replace the deployment role's existing policies or OIDC trust.
2. Review the ordinary dev infrastructure plan, including the role's exact trust/External ID and tag changes. Apply only with the user's cloud-release approval. Capture `grafana_cloudwatch_role_arn`.
3. Initialize the separate Grafana root using a distinct encrypted remote-state key such as `grafana-cloud/dev.tfstate`, with the existing state bucket/lock table/region. Never reuse the dev infrastructure state key.
4. Supply a Grafana Cloud access-policy token through the process environment (`GRAFANA_CLOUD_ACCESS_POLICY_TOKEN` for stack discovery, `GRAFANA_CLOUD_PROVIDER_ACCESS_TOKEN` for Cloud Provider configuration). It needs stack read and integration management read/write access for this stack. The same correctly scoped token can be provided in both environment variables. Keep tokens out of chat, source, tfvars, browser URLs and logs. Existing OTLP-ingestion and Grafana service-account tokens have different purposes.
5. Plan with the exact output role ARN and `collection_enabled=false`; review and apply account registration/job creation only after approval. Then review a second plan setting collection enabled and approve activation. Keep the root separate from routine app deploys, so application releases never require this management credential.
6. Verify actual ECS/RDS/ALB series in Grafana, the selected tags/region and AWS/Grafana usage. Disabling collection keeps the job configuration for recovery. Existing application OpenTelemetry traces, metrics and safe logs remain independent.

Backend-disabled init/validate can run without AWS/Grafana credentials and is included in CI. Validation does not prove live role assumption or successful ingestion; those need the approved cloud activation checks above.

References: [Grafana CloudWatch metric scrape configuration](https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-infrastructure/monitor-cloud-provider/aws/cloudwatch-metrics/config-cw-metric-scrape/), [supported services](https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-infrastructure/monitor-cloud-provider/aws/cloudwatch-metrics/services/).
