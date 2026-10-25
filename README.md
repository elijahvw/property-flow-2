# Property Flow

A property management application for connected portfolio records, leasing, maintenance and manual financial operations. React/Vite/TypeScript client, Fastify/Prisma/PostgreSQL API and Auth0 cookie/CSRF sessions.

## Current position

[Platform status](docs/mvp-status.md) is the current summary of implemented features, documented deployment/operating state, local work and remaining acceptance. [Roadmap](docs/product-roadmap.md) tracks stable feature IDs; [backlog](docs/product-backlog.md) retains detailed target acceptance. Jira updates are disabled.

The overhaul review stack is based on merged `47badac`: PR59, [PR61](https://github.com/elijahvw/property-flow-2/pull/61) and [PR62](https://github.com/elijahvw/property-flow-2/pull/62) are included in the local Git history. This includes the consolidated platform controls/landlord workflows and automatic sales-demo role accounts through migration055. The [substantive platform/demo overhaul](docs/platform-overhaul-2026-10-25.md) extends that baseline locally, including additive demo migration056. The [PR63 reconciliation](docs/pr63-reconciliation-2026-10-25.md) carries the current fixture 5/provider/handoff repairs; review65 →66 →63 →67. The previous complete hosted-release evidence was `1945049`. The [live AWS audit](docs/aws-audit-2026-10-25.md) observes backend `47badac` on ECS with development running; frontend/schema/provider acceptance was not reverified. The user authorized publishing this overhaul through the review stack recorded in its matrix. Merge/deployment and live operations remain separate gates. See the [preservation inventory](docs/PR60-consolidation-inventory-2026-10-24.md) and [role-based acceptance/release checklist](docs/feature-acceptance-checklist-2026-10-24.md) for the earlier consolidation evidence. Their original draft/closure statements are dated records; PR60's current remote state was not queried.

The current platform audit and local validation are tracked in [the October 25 audit](docs/platform-audit-2026-10-25.md). [AWS audit and optimization evidence](docs/aws-audit-2026-10-25.md) records the infrastructure review and any limits on live verification. [Platform experience standards](docs/platform-experience.md) define navigation, forms, visual consistency and connected workflow expectations. [AGENTS.md](AGENTS.md) is the canonical agent instruction file and requires matching documentation and meaningful validation with every behavior change. Repository Codex defaults live in [.codex/config.toml](.codex/config.toml); session sandbox and approval controls still apply.

## Workflow contracts

- [Sales demo setup, teardown, rebuild and fixture maintenance](docs/sales-demo.md).

- [Lease and household workspace](docs/lease-workflow.md), [tenant workspace](docs/tenant-workspace.md), [account/portal boundaries](docs/resident-contacts.md).
- [Rent and allocations](docs/rent-workflow.md), [cash activity and interrupted submissions](docs/cash-activity.md), [deposits](docs/security-deposits.md), [settlement](docs/move-out-settlements.md), [terms/proration/renewal](docs/proration-renewal-transitions.md).
- [Assigned maintenance](docs/delegated-maintenance.md), [vendors](docs/maintenance-vendors.md), [schedules/calendar](docs/preventive-maintenance.md), [paid expense sources](docs/maintenance-costs.md).
- [Private originals/library](docs/private-documents.md), [inspections](docs/lease-inspections.md), [unsigned agreement preparation](docs/lease-agreements.md), [in-app notifications](docs/in-app-notifications.md).
- [Release notes](docs/local-feature-release-notes.md), [live acceptance checklist](docs/workflow-acceptance-2026-10-18.md), [monitoring coverage](docs/monitoring-coverage.md), [Start/Stop controls](docs/dev-power.md).

## Local development and validation

The hosted application can remain stopped while features are built/tested locally. Follow [repository guidance](AGENTS.md) and [validation instructions](docs/agent-validation.md). Build with `npm run build --workspace=@property-flow/client`; the server's compile-only database URL is documented in that guide. Disposable runners create their own isolated local databases/browser fixtures; never point tests at development, preview or customer databases.

Preserve current source/audit history and company/property authorization. Staff execution requires explicit capability and current assignment/property scope; occupants do not inherit leaseholder finances. Documents remain private. Signature providers, external notification delivery and Stripe payments are not activated by this batch. The user controls approval, merge, Start and deployment.

Dated implementation/checkpoint documents retain their original evidence; their old branch names, test counts or rollout limitations are not current status claims.
