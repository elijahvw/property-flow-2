# Property Flow

A property management application for connected portfolio records, leasing, maintenance and manual financial operations. React/Vite/TypeScript client, Fastify/Prisma/PostgreSQL API and Auth0 cookie/CSRF sessions.

## Current position

[Platform status](docs/mvp-status.md) is the current summary of implemented features, latest verified deployment, stopped development environment, this PR and remaining acceptance. [Roadmap](docs/product-roadmap.md) tracks stable feature IDs; [backlog](docs/product-backlog.md) retains detailed target acceptance. Jira updates are disabled.

Merged main `75d5342` includes PR59 inspections, unsigned agreement preparation and personal in-app notifications (migrations 038–040). The last documented hosted release remains `1945049`; current cloud state was not inspected here. [Draft PR #61](https://github.com/elijahvw/property-flow-2/pull/61) contains the locally validated platform-owner/manual monthly billing and landlord workflow baseline and is consolidating useful unique work from [PR #60](https://github.com/elijahvw/property-flow-2/pull/60). Ports, canonical migrations and combined checks are in progress; baseline tests do not establish the consolidated result. Review the [preservation inventory](docs/PR60-integration-review-2026-10-24.md) and [role-based acceptance/release checklist](docs/feature-acceptance-checklist-2026-10-24.md). Neither PR is merged or deployed, and PR #60 remains open until verified preservation/closure gates pass. Tests, merged source, deployment and real-account acceptance are distinct.

## Workflow contracts

- [Sales demo setup, teardown, rebuild and fixture maintenance](docs/sales-demo.md).

- [Lease and household workspace](docs/lease-workflow.md), [tenant workspace](docs/tenant-workspace.md), [account/portal boundaries](docs/resident-contacts.md).
- [Rent and allocations](docs/rent-workflow.md), [deposits](docs/security-deposits.md), [settlement](docs/move-out-settlements.md), [terms/proration/renewal](docs/proration-renewal-transitions.md).
- [Assigned maintenance](docs/delegated-maintenance.md), [vendors](docs/maintenance-vendors.md), [schedules/calendar](docs/preventive-maintenance.md), [paid expense sources](docs/maintenance-costs.md).
- [Private originals/library](docs/private-documents.md), [inspections](docs/lease-inspections.md), [unsigned agreement preparation](docs/lease-agreements.md), [in-app notifications](docs/in-app-notifications.md).
- [Release notes](docs/local-feature-release-notes.md), [live acceptance checklist](docs/workflow-acceptance-2026-10-18.md), [monitoring coverage](docs/monitoring-coverage.md), [Start/Stop controls](docs/dev-power.md).

## Local development and validation

The hosted application can remain stopped while features are built/tested locally. Follow [repository guidance](AGENTS.md) and [validation instructions](docs/agent-validation.md). Build with `npm run build --workspace=@property-flow/client`; the server's compile-only database URL is documented in that guide. Disposable runners create their own isolated local databases/browser fixtures; never point tests at development, preview or customer databases.

Preserve current source/audit history and company/property authorization. Staff execution requires explicit capability and current assignment/property scope; occupants do not inherit leaseholder finances. Documents remain private. Signature providers, external notification delivery and Stripe payments are not activated by this batch. The user controls approval, merge, Start and deployment.

Dated implementation/checkpoint documents retain their original evidence; their old branch names, test counts or rollout limitations are not current status claims.
