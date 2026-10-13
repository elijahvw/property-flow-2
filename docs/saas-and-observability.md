# Property Flow: SaaS build standard and Datadog visibility
Research date: October 12, 2026 (Eastern). Target: AWS account 800754316001, US1 Datadog, manual development start/stop, AWS development budget at most $50/month.

## Recommended architecture
There is no universal SaaS technology stack. AWS recommends consistent onboarding, tenant identity, isolation, and tenant-aware operations across whatever stack is chosen. For this project, keep the existing React/Auth0/Fastify/PostgreSQL application as a modular monolith on shared infrastructure. This is a recommendation for the current stage and budget, not a claim that every SaaS company uses this stack. [AWS SaaS design principles](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/general-design-principles.html)

Use the pooled model: companies share infrastructure while access to each company's data is enforced centrally. Shared infrastructure makes runtime isolation essential. [AWS pooled isolation](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/pool-isolation.html)

## Application conventions to adopt
These are proposed Property Flow conventions informed by the sources, not features already implemented.

- Separate platform ownership from company administration. The platform owner creates, activates and suspends companies. A company administrator manages members within their company. A tenant-facing admin role must not imply global platform access.
- Introduce Membership with userId, companyId, company role and status, unique per user/company pair. Replace the single User.companyId boundary gradually through additive migrations. Retain a distinct platform-owner permission.
- Resolve a company from its configured slug/subdomain or selected company, then verify active membership on the server. A company ID supplied by a browser is a selector, never proof of access.
- Define named permissions for property viewing, property creation, invitations and member management. Deny missing roles, inactive memberships and suspended companies. Apply the same rules to workers, downloads and exports.
- Put company IDs on tenant-owned rows; use company-scoped foreign keys and a shared data-access layer. Make the unscoped query difficult to call accidentally.
- Add PostgreSQL row-level policies as a second boundary. Use a restricted application database role and a separate migration role. Table owners and BYPASSRLS roles can bypass policies; simply enabling RLS while using dbadmin is insufficient. Test policies with the real application role and keep company context transaction-local with connection pooling. [PostgreSQL 16 row security](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)
- Store files under company-owned prefixes and issue scoped, short-lived download/upload URLs only after permission checks.
- Make invitations expire, single-use and bound to the intended identity. Record company creation, membership changes, role changes and suspension in an audit trail.
- Onboarding should be repeatable: create company, invite initial administrator, accept invitation, activate membership, select company and reach its workspace. Auth0 Organizations can provide organization membership and organization roles if the chosen plan supports the needed capabilities; app-owned memberships remain a valid starting point. [Auth0 multi-organization provisioning](https://auth0.com/docs/get-started/architecture-scenarios/multiple-organization-architecture/single-identity-provider-organizations/provisioning)
- Standardize releases: locked dependencies, commit-addressed images, additive migrations, health checks, authenticated smoke tests, two-company isolation tests and a documented rollback. Current builds still use the latest image tag; immutable deployment selection is future work.

## What exists and what was observed
Code inspection found company records, company creation, user assignment, company-filtered property routes and a global admin role. Full memberships, scoped company-administrator roles, subdomain routing and RLS remain to be built and tested.

The original landlord dashboard displayed static example numbers. PR #5 removes them and blocks protected client routes when a role is missing; its deployment has not been verified.

The authentication wrapper dropped the verifier's promise. PR #6 fixes it, and is now merged. Run 38341296522 deployed the previous commit 7577e8dcf15a1ce0982003e68037680348e66595, so it did not contain that fix. It passed readiness at deployment, but subsequent live checks returned 502. The cause of the later 502 has not been confirmed from ECS runtime logs.

## What “full visibility” should mean
A troubleshooting path should connect a browser action to its API request, backend trace, relevant database operation, correlated logs and infrastructure health.

1. Browser: RUM navigation, user actions, errors, network duration, long tasks and readable source maps. Propagate trace headers only to the app's own API. [Datadog RUM/APM connection](https://docs.datadoghq.com/tracing/other_telemetry/rum/)
2. Backend: HTTP, Auth0 calls, Prisma/PostgreSQL timings, errors and release version. Initialize the tracer before application imports. [Datadog Node.js tracing](https://docs.datadoghq.com/tracing/trace_collection/dd_libraries/nodejs/)
3. Logs: JSON application logs with trace ID/span ID, service, environment and version. Injection enables correlation, but the logs must also be exported to Datadog. Existing logs go to CloudWatch. [Node.js log/trace correlation](https://docs.datadoghq.com/tracing/other_telemetry/connect_logs_and_traces/nodejs/)
4. AWS: connect account 800754316001 using a dedicated integration role. Start with us-east-1 and ECS/Fargate, RDS, ALB and CloudFront. Verify integration permissions and actual incoming metrics. [Datadog AWS integration](https://docs.datadoghq.com/integrations/amazon-web-services/)
5. Log export: retain the current CloudWatch path and add a Datadog Forwarder subscription as the initial option. FireLens is Datadog's recommended Fargate alternative, but adds another container to the current small task. Pick one application-log export path to avoid duplicate ingestion. [Datadog Fargate log collection](https://docs.datadoghq.com/integrations/aws-fargate/)
6. Company context: attach only server-verified company identifiers to traces and logs after membership checks. Keep company IDs out of default high-cardinality custom metric tags. Avoid passwords, bearer tokens, payment details and raw customer payloads.
7. Operations: monitor public readiness, API error rate and latency, browser failures, healthy ALB targets, stopped tasks/exit reasons, task CPU/memory, database connections/storage and telemetry ingestion gaps. Intentional manual downtime should be distinguished from an incident.

A sidecar and an API key do not establish complete visibility. Ingestion must be verified in Datadog. The AWS account is not connected yet, and the Datadog connector is available but not installed in this chat.

## Delivery order and acceptance checks
1. Deploy merged PR #6 from a fresh main workflow run; confirm users and companies finish loading. Capture ECS stopped-task reasons and logs if 502 persists.
2. Deploy browser trace propagation, image release tags and public smoke checks. Confirm a request to /api/companies in RUM opens its matching APM trace.
3. Connect AWS and configure one log-forwarding path. Find the same request's JSON log from its APM trace; inspect ALB and RDS graphs for that time.
4. Build an overview dashboard with env/service/version filters and company-level trace/log search. Create actionable monitors with appropriate handling for manual stop.
5. Finish memberships and role checks, then prove Company A cannot read/write/download Company B resources through direct API calls.
6. Add RLS, subdomain routing, invitations, company suspension and production release safeguards.

Budget: these code changes add no infrastructure resources. AWS integration, log forwarding, CloudWatch requests and Datadog ingestion can add charges. Keep development sampling configurable, limit replay and retention, and review Datadog usage before the trial ends. The $50 AWS budget is an alert target, not an automatic spending cap; no paid Datadog plan or new billable infrastructure has been activated here.
