# Property Flow observability standard

The current implementation and manual release runbook are [ECS and Grafana Cloud monitoring](open-observability.md). Older Datadog setup guidance has been superseded.

Keep the owner/manager-first product direction and make authorization, exact financial records and transactional audit independent of monitoring availability. OpenTelemetry provides portable traces, metrics and safe operational logs. Grafana Cloud Free hosts the initial monitoring backend; ECS/Fargate, the existing ALB/private RDS and manual start/stop controls remain.

Use route templates and bounded labels. Exclude SQL, parameters, tokens, financial/resident details, raw URLs and exception text. Never send ingestion or dashboard API credentials to the frontend, public bucket, source maps or logs. Keep deployment health and hosted ingestion as separate checks, and preserve a recovery path if either fails.

Monitoring does not establish accounting correctness or prove production readiness. Real-account acceptance, private document storage, applicable financial workflows, recovery drills and eventual production availability/security requirements remain explicit product work. Review actual AWS/Grafana usage before changing capacity or paid plans.
