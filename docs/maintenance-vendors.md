# Vendor contacts and maintenance links — PF-13

Local feature increment, October 18, 2026. Migration035 and release are pending. Live account testing is deferred at the user's request.

## Complete operating job

From Maintenance, open **Vendor directory**, search existing contacts, and add a vendor when needed. The company directory stores a name, optional service, contact person, email, phone and private notes. Search and active/archived filters run before pagination; matching totals cover the complete filtered directory. Normalized names prevent accidental duplicates, including archived contacts. Restore an existing contact instead of creating it again.

Open a vendor to edit contact details or change its active/archived status, view linked requests, and inspect recorded history. Archiving keeps the contact, history and existing maintenance links, while excluding it from new choices. Restoration reuses the same record. The directory filters survive a detail round trip; linked requests provide a return to the vendor. A request-origin link also provides a return to that exact request.

From a request's **Vendor contact** section, review contact details and choose an active vendor, replace the contact or remove the link. The vendor's record shows its currently linked requests. History retains the names reviewed when a link changed, even if the contact is renamed later. Vendor/contact and history lists are bounded and paginated. History is loaded when opened.

Vendor contacts have no sign-in account or portal authority. Linking is an internal recordkeeping action; it does not notify or dispatch the vendor, assign an employee, change maintenance work status, create a payable, or record a payment. Staff execution and management completion review remain in the existing Assigned work workflow. Paid expenses retain their existing source/link workflow. External dispatch, estimates and payables remain future PF-13 scope.

## Integrity, access and drafts

Only current active, verified company owners/managers with `maintenance.manage` can read or change the directory, contacts, links or history. Each operation rechecks authority under the existing authorization fence, sets transaction-local company context and applies explicit company filters and forced RLS. Platform authority, staff execution and resident access do not expose vendor contacts or private notes. Resident and assigned-staff request projections remain unchanged.

Each change requires a durable submission key; edits require the opening vendor version, and links require the opening request version plus the reviewed vendor version. Lost responses retry the same payload/key and acknowledge the committed action without repeating it. Competing/stale changes require a fresh review. Contact/link writes, immutable VendorAction history and AuditEvent recording commit atomically. Keeping unchanged contact details or the same vendor link does not bump a source version or add a visible audit/history entry. A hidden immutable retry receipt preserves the acknowledgement if a response is lost, including after a later real change; it cannot restore the older state. Company-scoped foreign keys prevent cross-company associations. There is no hard-delete endpoint.

The shared editor supplies explicit page-only draft saving, changed-form close choices and a separate immutable retry guard for uncertain submissions. No unsubmitted contact data is written to browser storage or saved automatically. Refresh or leaving the page clears unsubmitted work.

## Release, signals and recovery

Additive migration `202610180035_maintenance_vendors` creates Vendor/VendorAction and adds a nullable vendor reference to existing maintenance requests. It preserves all existing requests and financial sources. Apply through the normal reviewed migration deployment with its restore point. The live and preview databases have not been migrated for this feature.

The existing database holds these records; no extra service, provider, background job or cloud resource is introduced. Existing Start/Stop lifecycle coverage applies. Bounded `vendor.save` and `maintenance.vendor` operation signals accompany existing request/error metrics. Contact names, email, phone, notes, search text and snapshots must stay out of telemetry; URL queries and record IDs remain scrubbed.

For403/404, review current management authority/company scope. For duplicate names, search active and archived contacts. For409, preserve input, inspect the current contact/request, then explicitly discard/reopen to review the new version. An uncertain mutation retries the original request; do not manufacture a new contact or submission key to bypass recovery. A failed audit rolls back both source and action history. External email receipt is not part of this feature's success state.

Validation and PR state are recorded in [the workflow log](workflow-acceptance-2026-10-18.md) and [release notes](local-feature-release-notes.md). Real-account acceptance remains separate from automated fixture/database validation.
