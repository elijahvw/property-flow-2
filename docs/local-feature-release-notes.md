# Local feature release notes — October 17, 2026

PRs [#44](https://github.com/elijahvw/property-flow-2/pull/44), [#45](https://github.com/elijahvw/property-flow-2/pull/45) and [#46](https://github.com/elijahvw/property-flow-2/pull/46) are confirmed merged. The live UI exposes document and delegated-work controls; scanner activation and full real-role acceptance remain unverified. The October 18 release is prepared locally; cloud rollout/migrations and full real-account acceptance remain pending. Sender-domain/DKIM and controlled inbox delivery are verified. Merge, deployment and acceptance remain separate from validation.

- Private document foundation (migration031): management uploads against leases/maintenance, retained immutable versions, quarantine and a fail-closed ClamAV adapter, audited downloads, archive/restore and bounded private database storage. No public frontend storage or implicit resident/staff sharing. A pinned maintained ClamAV sidecar and loopback adapter are prepared in this release; real ClamAV clearance/rejection passed locally, with cloud upload/download acceptance pending. [Contract](private-documents.md).
- Delegated maintenance (migration032, requires staff property migration029): owner-granted execution, scoped assignments, acceptance/progress/submitted completion, management review and reopening, immutable history, safe retries and review-queue filtering. Staff keep default read-only access; financial and document authority stay separate. [Contract](delegated-maintenance.md).

Local tests use disposable PostgreSQL and fictional browser/scanner fixtures. No test or migration ran against preview/customer databases. The open preview was not restarted or migrated; the new backend endpoints require a safe local migration/restart before preview acceptance.


## October 18 — approved platform workflow audit (local)

- Invitations now recheck current inviter authority, acknowledge completed acceptance safely, deduplicate durable retries, rotate/revoke private links deliberately and provide filtered paginated history. A shared delivery/recovery UI connects team, tenant and approved household workflows. Optional SES email distinguishes provider acceptance from delivery and never automatically retries ambiguous sends.
- Tenant/account/portal state is clearer; canonical tenant links retain sources. Staff scope and default-off maintenance execution share one versioned editor. Existing financial/household/approval boundaries remain.
- Public searchable Help Center, 15 real task guides, contextual Help and a skip/resume/replay walkthrough with private server-persisted role-aware progress.
- Compact mobile navigation; meaningful attention queues; focused maintenance due/assignee filters; cash-entry intent; direct deposit setup; report date presets/source links; paginated administration activity; automatic configured document scans with quarantine recovery.
- Additive migrations033/034, dedicated restricted SES task role, verified branded sender and private maintained ClamAV sidecar. AWS declined the initial production recipient request; verified sandbox recipient testing remains available, and production approval is outstanding. Preview data was preserved; deployment/migrations remain pending. [Full contract and release prerequisites](platform-workflow-improvements.md).

Validation: both production builds, the189-case UI suite plus final targeted/pagination regressions,291 disposable database integration checks,97 Node unit checks and84 operations checks passed for the release. A real controlled Gmail received the sender delivery test with the correct signing domain and TLS. Dedicated live account/invitation/scanner/telemetry acceptance remains open. No tests used customer/preview databases.

## Development power controls

Separate **Start development** and **Stop development** Actions use the shared ordered controller, include all app/scanner task containers, preserve data and serialize with deployment. Startup verifies public readiness. CI requires lifecycle coverage for Terraform resources through `config/dev-power.json`; new services/databases or unclassified resource types fail until covered. Retained storage, routing and credentials keep their stated charges. See [power controls](dev-power.md). The smaller0.5vCPU/4GB scanner task is estimated at$27.75/month compute, an$18.74 increase over the former task at730hours, before credits/taxes and other usage.
