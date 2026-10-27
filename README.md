# Property Flow

A property management application for connected portfolio records, leasing, maintenance and manual financial operations. React/Vite/TypeScript client, Fastify/Prisma/PostgreSQL API and Auth0 cookie/CSRF sessions.

## Current position

[Platform status](docs/mvp-status.md) is the current summary of implemented features, documented deployment/operating state, local work and remaining acceptance. [Roadmap](docs/product-roadmap.md) tracks stable feature IDs; [backlog](docs/product-backlog.md) retains detailed target acceptance. Jira updates are disabled.

Merged main `2ff16da` includes PR72 account controls, PR71 company/demo refinements and the earlier platform, scanner-retirement and observability work. The first approved simplification increment is implemented locally: compact daily navigation, contextual specialist tools, Today/Resume saved work and a guided move-in journey on existing lease records. It reuses current components and handlers with no new service, dependency or migration. [Current work](docs/current-work.md) records exact source and validation; deployment and real-user acceptance remain separate.

The later API architecture and complete access-controlled OpenAPI/Swagger documentation phase is [planned under PF-25](docs/product-backlog.md#pf-25--imports-reconciliation-and-integration-contracts--p2p3). Prefer existing capabilities and maintained OSS; a paid service needs a concrete integration, cost and maintenance benefit. [Current status](docs/mvp-status.md) · [dated AWS audit](docs/aws-audit-2026-10-25.md) · [release/role checklist](docs/feature-acceptance-checklist-2026-10-24.md).

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
