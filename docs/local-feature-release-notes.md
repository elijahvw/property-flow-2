# Local feature release notes — October 17, 2026

Proposed in [PR #46](https://github.com/elijahvw/property-flow-2/pull/46), stacked after #45/#44. CI and deployment are separate from local validation.

PR implementation; not merged, deployed or accepted. The user will handle deployment after merging the pending stack.

- Private document foundation (migration031): management uploads against leases/maintenance, retained immutable versions, quarantine and a fail-closed ClamAV adapter, audited downloads, archive/restore and bounded private database storage. No public frontend storage or implicit resident/staff sharing. Real scan/download activation requires a maintained ClamAV runtime; not configured or verified here. [Contract](private-documents.md).
- Transaction recovery: PrismaPg serialization/deadlock conflicts surfaced directly at COMMIT now retry the whole transaction within the existing five-attempt bound; unrelated errors propagate. Deterministic installed-adapter regressions cover success, exhaustion and non-retry errors.
- Delegated maintenance (migration032, requires staff property migration029): owner-granted execution, scoped assignments, acceptance/progress/submitted completion, management review and reopening, immutable history, safe retries and review-queue filtering. Staff keep default read-only access; financial and document authority stay separate. [Contract](delegated-maintenance.md).

Local tests use disposable PostgreSQL and fictional browser/scanner fixtures. No test or migration ran against preview/customer databases. The open preview was not restarted or migrated; the new backend endpoints require a safe local migration/restart before preview acceptance.
