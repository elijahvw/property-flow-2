# Shared-document receipts and search

This PR #60 preservation slice extends the canonical October 24 lease-document sharing workflow. It does not add PR #60's separate document-share tables or broaden its recipient/management policy. The implementation is local and awaiting combined validation; no provider action or live migration is implied.

An owner still selects an exact cleared original, a currently approved verified leaseholder, an access-through date and a reason. Account, company, property, current leaseholder participation, expiry, archive/revocation and exact original scan status remain authoritative. Managers can inspect existing access and history; occupants and staff do not gain sharing or recipient access.

## Resident workflow

`/resident/documents` searches complete currently visible results by document title, property or unit. Search is bounded to 160 characters, literal case-insensitive matching, and precedes complete counts and 50-row cursor paging. Search changes clear paging; its URL survives refresh. The list is not a directory of private uploads or financial attachments.

Download continues to recheck current access and returns only the selected original. Download now also appends an immutable sharing-history event in the same transaction as the existing audit. A support download retains the actual session actor on that event and the original audit; it does not become a resident receipt.

The resident separately opens **Confirm received** and reviews the exact original. This records a receipt only: it does not sign, approve or change a lease. `POST /api/resident/documents/:shareId/received` requires the current share version and a UUID submission key. A successful transaction updates `receivedAt`, increments the share version, appends one immutable `received` action and writes the audit together. Identical concurrent/lost-response retries return one action receipt. A changed request under the same key conflicts. Feature read-only settings block this write while permitted reads remain available; support impersonation cannot acknowledge receipt.

## New grants and interrupted confirmations

Each explicit owner review starts a new access-grant generation on the retained share record. Its current `receivedAt` resets, and earlier receipt/download events remain in complete access history. An earlier receipt replay rechecks fresh access and returns the current grant state plus its original action receipt; it never acknowledges the newer grant.

The browser keeps only an attempted receipt's share ID, original version, UUID and expected company in a separate session recovery journal. It does not persist document titles, filenames or unsubmitted form data. Reload/close recovery reuses that exact request. Fresh authority/record denial hides private details immediately; permitted-read write restrictions keep the review available. Hard account/company changes clear the private editor and cannot redirect its request into a different company.

An interrupted request can also use **Check current receipt status**, a fresh company-pinned `GET /api/resident/documents/:shareId`. Explicit acknowledgment and **Use current receipt status** clear only the local retry after reviewing the saved status. They perform no receipt write and do not claim which request recorded the result. Revoked or unavailable originals cannot be reviewed or acknowledged; their interrupted journal remains for authorized recovery.

## Schema and validation

Additive `202610240053_document_acknowledgments` extends canonical migration 046 with nullable `LeaseDocumentShare.receivedAt`, allowed `received`/`downloaded` action kinds and its narrowly granted update column. Existing shares begin unconfirmed; no receipts are inferred or backfilled. Forced company RLS, immutable original versions, append-only action permissions and existing audit behavior remain.

New real API cases live in `server/tests/document-acknowledgment-cases.mjs`; browser coverage extends `tests/ui/document-sharing.spec.ts`. They cover exact retries, later-grant isolation, audit rollback, role/recipient/company/CSRF/expiry/feature scope, complete search, session recovery, current-status acknowledgment, immediate denial hiding, support/read-only views and mobile layout. Runtime results belong to the final combined validation, not this implementation note.
