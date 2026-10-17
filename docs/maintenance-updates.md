# Maintenance progress updates

Local continuation of the core workspace overhaul, October 16, 2026. No cloud deployment or merge is authorized.

## Workflow

Owners and managers can add a progress update from an individual maintenance request. The editor defaults to management-only visibility. A request submitted by a resident also offers a resident-visible audience. Management-created requests, and records without verifiable resident creation history, permit internal notes only. This does not assign a tenant or grant portal access.

Updates retain their text, audience, author identity and recorded time. They cannot be edited, deleted or silently republished through the application. Corrections are follow-up updates. Recording an update does not change the request status, resolve the work, create a financial expense or send email/text notifications. Status changes continue through the existing versioned request editor.

The timeline shows the latest 50 authorized updates, with older/latest page controls. Internal notes and shared updates have explicit labels for management. Residents see only shared updates on their own requests while their current company membership and property assignment authorize access. Resident responses identify the author as “Property team”; they omit staff identities and submission metadata. Residents cannot add updates in this increment. Staff retain their existing read-only property authority and cannot read maintenance updates.

## Integrity and access

Every list and creation operation rechecks current membership/company authority inside the existing authorization transaction and company RLS context. The update/request composite foreign key independently prevents company mismatches. Forced RLS applies to the new table. The runtime role has SELECT/INSERT privileges only.

Shared visibility is filtered before pagination, including cursor lookup, so private notes cannot displace shared results or supply a resident cursor. The existing request-detail activity projection excludes note events and bodies. Update audit metadata records only the update ID and audience; note content remains in the authorized source table.

Creation uses a durable company/author submission key and payload fingerprint containing request, text and audience. Note and audit commit together. Retrying the same draft after a lost response returns the original update; changing text, request or audience with that key requires restoring the original draft or deliberately clearing it. Replays recheck current access. Concurrent identical requests produce one note and one audit event. Append-only notes do not invalidate an independent request-status draft.

The editor preserves input, audience and submission identity after errors, dismissal and background refresh. Successful creation resets the editor. A full page reload discards browser-only drafts, as in the existing maintenance intake workflow.

## Local schema and validation

Additive migration `202610160027_maintenance_updates` creates the update table, composite request key, scoped index and restricted grants. It does not alter existing request or financial values. Eventual coordinated deployment must apply both core migrations 026 and 027 before serving this backend. No provider, infrastructure or live configuration changes are required by this increment.

For a verified pre-update local checkpoint containing migration 026 but no `MaintenanceUpdate` table, use `node scripts/local-preview.mjs --restore-local-preview /tmp/propertyflow-local-preview-backup-before-progress.sql --upgrade-from-core-maintenance-preview`. The switch verifies the prior schema and applies only 027 to a newly restored disposable database. Current-schema checkpoints use ordinary restore without that switch. No external database URL is accepted.

Both production builds passed. Validation passed: 19 disposable maintenance checks, including privacy, pagination, concurrent replay, response loss, atomic audit rollback, forced RLS and revocation/suspension ordering; 174 disposable finance checks; 166 UI fixtures; and 70 safe Node checks, with five database suites intentionally skipped in the safe run. Desktop/390px preview inspection and schema-upgrade preservation were checked locally. Existing business records and session identities across 37 tables were retained. Cloud delivery and real-account acceptance are not established by these checks.
