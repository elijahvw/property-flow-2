> Historical PR #60 source evidence, preserved from [`f5f1a2394e7eeae33ce063bfdadadb8171f9c35d`](https://github.com/elijahvw/property-flow-2/blob/f5f1a2394e7eeae33ce063bfdadadb8171f9c35d/docs/resident-document-sharing.md). This document's feature, test, dependency, preview and deployment claims describe its original dated branch; they are **not current PR #61 consolidation results**. Relative source links below point to that immutable source snapshot. Use the [current inventory](../PR60-consolidation-inventory-2026-10-24.md) and [consolidation/release gate](../PR60-integration-review-2026-10-24.md) for current status.

# Resident document sharing — PF-15 / PF-18

October 22, 2026 local implementation. This extends the existing private document library; it does not publish a bucket, activate a provider or establish deployment/customer acceptance. Migration `202610220042_document_sharing` is additive and follows the merged private-document/inspection/agreement foundations.

## User outcome

An owner or manager can share an explicitly selected, scan-cleared lease document version with one named eligible resident at a time. The resident sees that exact copy in **My documents**, can download it through the authenticated application, and may choose **Confirm received**. Management can review sharing/receipt/download history and revoke future access. A later uploaded version stays private until separately reviewed and shared.

Existing uploads, earlier versions, management maintenance attachments, inspection evidence and unsigned agreement packages keep their current private defaults. Sharing a file does not sign it, activate a lease, change a household, grant finance authority, send email or authorize a resident upload.

## Complete workflow

1. Open the exact lease's Documents section. Upload/scan through the established private-original workflow if needed.
2. Expand **Resident sharing** on a document. Choose a specific cleared retained version and one named currently eligible leaseholder or occupant. The review names the person and exact version before **Share selected version**.
3. The share is recorded atomically with audit history. To share with another person, make another explicit selection. A duplicate active share to the same participant/version is rejected rather than creating another grant.
4. The named resident opens **My documents**, identifies property, unit, title, version, filename and shared date, and downloads the source copy. Search/paging operate on their complete currently authorized set.
5. **Confirm received** records receipt of that version. It is optional and explicitly distinct from agreement, acceptance of terms or an electronic signature.
6. Management reviews the sharing record and recent activity. **Revoke access** stops subsequent list/download/receipt access; prior receipt/history and the private original remain retained. It cannot delete a copy already downloaded by the recipient.

## Authority and source identity

Each share pins company, lease, document, exact document-version, exact participant and recipient account. Composite database foreign keys prevent substituting another company's record, another document's version or another lease's participant. Source identity is immutable. The runtime can update only version/revoked/received state; actions are append-only and tables use forced company RLS.

Creation requires current owner/manager `lease.manage`, a non-draft lease, an unarchived document, an exact clean version, and an approved non-removed leaseholder/occupant with an active verified resident account, current same-company membership and property assignment. Account/contact/identity existence alone never grants access. Existing explicit contact-to-account mappings are honored; email matching never links a recipient. Approved upcoming participation is supported consistently with existing pre-move-in lease access; ended/removed participation is denied using the company's current business date.

Every resident list/count, receipt and download rechecks current membership, assignment, participant account/approval/removal/end date, source archive/scan state and explicit share revocation. Occupants may receive an explicitly shared file without receiving financial data. Staff and other residents cannot use management endpoints or another recipient's share ID. Resident projections omit creator identity, internal IDs/keys/hashes, management metadata and other recipients.

Company/user authorization fences and participant/contact/document/share locks protect meaningful operations. Exact participant and fallback contact rows are fenced too, including retained household records whose account mapping is through the contact rather than `participant.userId`. Source archive and explicit revocation are rechecked through the download transaction; authorization/source changes cannot restore grants through a stale request. Normal management retrieval of archived private originals remains available through its existing route, while resident sharing is hidden until the source is active again. Explicit revocation remains permanent; restoring a document never restores a revoked share. Management distinguishes a retained sharing record from currently available access.

## Retry and correction

Share creation, revocation and receipt each use a durable UUID/payload fingerprint. Same-key replay returns the retained result without another grant/transition/audit; mismatched details return conflict. A revoked creation replay returns the original revoked record and never recreates authority. Expected document/share versions prevent silently adopting a newer source or overwriting another transition.

Forms retain the attempted data/key after an uncertain response and disable conflicting field changes/refresh until retry. A stale review can explicitly refresh sharing options before making a new selection. Refreshing ordinary list data does not replace a draft or broaden recipients. Reloading the page shows the saved authoritative result; this focused sharing form is not a durable long-task draft.

Share/receipt/revoke/download state and audit recording commit together. A failed audit rolls back the operation, including the download history; file bytes are not returned before that transaction succeeds. Downloads use `api.ts` cookie/CSRF conventions, private `no-store` JSON responses and a short-lived local download Blob, never public storage URLs. The original content is served only after current exact-version authorization.

## History, scale and privacy

Management sharing history is paginated at 25 records with a complete count. Each row shows the last five share actions and explicitly states when more retained history exists. Initial sharing and download/receipt/revoke actions retain immutable audit evidence. Residents see their own shared/received state; they do not see other recipients or internal actor details. Download history records authorized retrieval; it is not proof that a person read or understood a file.

No new external worker/provider/storage is required. Existing private scanning must actually clear the original before sharing. Browser operations use bounded `document.share`, `document.receipt` and existing `document.download` names; resource loads use the existing page-load signals. Private titles, filenames, person/source IDs, bytes and form values are not telemetry dimensions. Existing HTTP status/duration monitoring applies to the authenticated routes.

For 409, retain the attempted review and reload current sharing/source versions before a new attempt. For an uncertain outcome, retry the original action/key. For 403/404, recheck current company/role/assignment/household/share scope; do not bypass it by exposing the private original route. A quarantine/scanner error requires correcting the original scan workflow, not marking a shared copy clean manually.

## Validation and release evidence

Targeted PostgreSQL/API cases in `server/tests/document-sharing-cases.mjs` cover default privacy, quarantine, explicit recipients, role/company/CSRF/guessed-ID boundaries, exact-version pinning, creation/revoke/receipt concurrency and replay, stale versions, changed membership/assignment/household/archive, source-lock rechecks, forced RLS/composite foreign keys/immutable history and audit rollback. The maintenance runner supplies its existing deterministic scanner and disposable database; no live account or file is used.

`tests/ui/resident-documents.spec.ts` covers mobile search/paging/download, optional receipt with lost-response recovery, revoked metadata removal, explicit cleared-version/recipient selection, share retry/revoke and stale-review refresh. The focused five-case browser suite passed locally (17.9 seconds, `/tmp/propertyflow-sharing-playwright.log`); subsequent client and server TypeScript checks passed. Final PostgreSQL/API and integrated browser results are recorded by the batch validation notes. A test's presence, an earlier run or source review alone is not evidence of deployment.

Release needs additive migration 042, normal generated Prisma client/build, role and original-file receipt acceptance against the released application, current scanner readiness, and an ordinary restore/release plan. Existing deployment/power controls are unchanged. Explicit staff sharing, resident uploads, electronic signatures, resident inspection acknowledgement, external delivery/reminders, larger object storage and retention administration remain separate scopes.
