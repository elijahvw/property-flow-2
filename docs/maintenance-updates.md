> Status reconciled October 20, 2026: use [current platform status](mvp-status.md) and [the roadmap](product-roadmap.md) for delivery and remaining scope. Dated branch/release/test/limitation statements below are historical checkpoints, not the current deployment or acceptance state. No historical pass is promoted to real-account acceptance.

# Maintenance progress updates

## October 24 continuation · Requester replies 048 locally validated

After the combined local 047 baseline passed, resident replies on their own maintenance request were implemented and locally validated through 048. Server/Prisma and client builds, safe units (108 passes/eight expected database-suite skips), all 11 client unit files, roadmap 34/34 and maintenance 131/131 pass. Focused maintenance browser checks pass 14/14, plus one overlapping 390px viewport recheck; these do not replace the earlier full 260-case 047 baseline. Independent review has no remaining actionable issues. It is local only; no merge, live migration, deployment or real-account acceptance is established. The dated October 16 contract and evidence below describe the existing team-update foundation.

The original resident requester can add shared text replies in the existing request timeline. Current verified account, resident membership, company, requester identity, property assignment and maintenance/resident-portal feature checks apply before both writes and exact retries; support impersonation remains read-only. The server fixes the shared audience and accepts no recipient, role, status or URL from the composer. Team-only notes remain filtered before resident pagination/cursor lookup. Management-created requests do not gain a resident conversation or portal grant.

Additive 048 retains immutable `authorType` as `team` or `requester`; existing updates remain `team`, and the database requires requester updates to use resident-visible audience and match the original request's requester/company. The request's original `requesterId` is immutable. Creation-time provenance survives later membership/role changes. Resident timelines distinguish “You” and “Property team” without exposing staff identities, author type/IDs or submission metadata; management retains actual requester/source context.

Replies append rather than edit/delete history. A follow-up on a resolved request leaves its status/version unchanged until management uses the existing status/work-review workflow; replying never changes assignment, work acceptance or money. Text, source audit and fixed management in-app notices commit atomically. Company/author submission keys and exact payload fingerprints, including fixed resident audience/requester author type, prevent duplicate replies/notices or management-key reuse across concurrency and lost responses. Current requester/property/company/source-history checks precede receipt lookup. Uncertain writes preserve the original disabled payload for retry, with existing page-only draft/discard semantics. A correction is another reply.

The distinct `maintenance.reply` event selects current eligible company management in the source transaction, excludes the actor and links back to the request. It copies no reply text into notification records. Disabled/read-only notifications do not block an authorized reply or imply delivery. No staff reply grant, arbitrary conversation, attachment, email/SMS or new provider is included. The fixed `maintenance.reply` outcome/duration operation and sanitized HTTP/error signals cover replies; team updates retain `maintenance.update`. Immutable `maintenance.reply.recorded` audit stores update ID/audience, without reply text. Telemetry excludes private reply text and identities. See [the contract, logs and rendered evidence](roadmap-continuation-2026-10-24.md#checkpoint-4--requester-maintenance-replies-048-locally-validated).

## October 16 foundation checkpoint

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
