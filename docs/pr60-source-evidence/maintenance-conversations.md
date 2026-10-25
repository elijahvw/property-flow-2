> Historical PR #60 source evidence, preserved from [`f5f1a2394e7eeae33ce063bfdadadb8171f9c35d`](https://github.com/elijahvw/property-flow-2/blob/f5f1a2394e7eeae33ce063bfdadadb8171f9c35d/docs/maintenance-conversations.md). This document's feature, test, dependency, preview and deployment claims describe its original dated branch; they are **not current PR #61 consolidation results**. Relative source links below point to that immutable source snapshot. Use the [current inventory](../PR60-consolidation-inventory-2026-10-24.md) and [consolidation/release gate](../PR60-integration-review-2026-10-24.md) for current status.

# Maintenance conversations

Local implementation for PF-13/PF-19. Merge, deployment, provider delivery and real-account acceptance remain separate evidence states. This extends the existing maintenance progress-update history rather than creating another message thread.

## Complete workflow

An authorized resident opens one of their maintenance requests, reads shared updates, and sends a text reply inline. Owners and managers see that reply in the same request history and their personal in-app inbox. They respond by choosing **Resident requester and management team**, or record **Management team only** notes. Internal notes remain absent from the resident timeline and its pagination cursors.

Replies remain available on resolved requests so residents can report a continuing problem. A reply never silently reopens the request, changes an assigned work stage, or changes a request version. Management uses the existing status or assigned-work review action when follow-up work is needed.

The resident receives only **You** and **Property team** author labels. Management receives the existing recorded name, with a neutral fallback. Resident responses contain no author account ID, email, private note, submission identity or sender classification. Other residents, occupants in the same unit who did not submit the request, and default staff do not inherit this conversation. Existing assigned-work authority does not grant access to management notes or this thread.

## Sources and API

`MaintenanceUpdate` remains the single append-only source. Additive migration041 adds `authorType` with a default of `team` for existing records, and enforces that resident replies use the resident-visible audience. Existing request/company foreign keys, forced company RLS and runtime SELECT/INSERT-only permissions remain. Sender and audience cannot be edited; a correction is a follow-up message.

- Existing `GET /api/company/maintenance/:requestId/updates` returns the management timeline.
- Existing `GET /api/resident/maintenance/:requestId/updates` returns only that requester's authorized shared timeline.
- Existing management POST retains explicit private/shared audience selection.
- New resident POST to the resident `/updates` endpoint accepts only `content` and a durable UUID `submissionKey`. Audience, company, requester and author are determined by the server.

Every operation rechecks current active account, verified membership and company authority. Resident operations also require the exact requester and current property assignment. These checks precede a retry lookup. Management-created requests cannot become resident conversations through a guessed ID or a later role change. Legacy resident-created records remain readable/replyable under the existing source policy.

Timeline pages filter visible records before the 50-record limit, and resolve cursors within that same visible scope. Private IDs cannot be used to infer private page positions.

## Recovery and consequential changes

A resident reply and its audit event are committed atomically with its in-app notification event. Concurrent requests with the same normalized key and exact content return the original message; changed content with that key returns a conflict. Request status and financial data are unaffected. There is no mutable reply edit action requiring an optimistic version: each message is a new immutable record, and existing request-status edits keep their version checks.

Errors preserve the reply text. An attempted resident reply is retained in a user/company/request-scoped session recovery journal before submission. A lost response freezes the attempted content and offers **Retry original reply**, including after browser refresh. Success clears that recovery record, clears the composer, returns to the latest updates and confirms the outcome. A definitive first-attempt rejection leaves the text editable. Unsubmitted typing remains a page-only draft: leaving requires confirmation, and reload/close warns before discarding it. Navigation attempted during a send waits for the result; only a confirmed save releases it, while failure retains the reply. Submitted recovery remains distinct from an unsent draft. This feature does not promise server-saved drafts or cross-device recovery.

This journal contains the user's submitted text in their browser session. It never enters telemetry. Opening another account/company/request does not select its key, and current source authorization still gates rendering and replay.

## In-app notifications and monitoring

New `maintenance.reply` events notify current verified active owners/managers, excluding the actor, through the existing bounded publisher. Management shared replies retain `maintenance.update` notifications to the resident requester. Private notes create no resident notification. Source authority is checked again when counting, listing or opening the inbox item; replies never restore revoked access. A business retry does not create another notification or mark an already-read item unread.

The inbox stores source references and template titles rather than conversation bodies. Browser outcome/duration/failure signals use the bounded `maintenance.reply` operation; no message text, private form fields or account details are captured. Existing maintenance transaction/error monitoring and inbox source/retry runbooks apply. Delivery is personal in-app notification only; no external email/SMS, push delivery or response-time promise is introduced.

## Scope and next workflow

This increment is text-only. Resident attachments, document sharing, read receipts, subscriptions, external delivery and broader conversations need their own source/privacy/authorization contracts. The next complete maintenance workflow is a real owner/manager/resident acceptance pass: report a problem → shared/private discussion → assigned work → follow-up or completion → historical source review, with assignment or membership revoked during the journey.

## Validation

`server/tests/maintenance-conversation-cases.mjs` covers concurrent durable replay, requester/staff/company/CSRF boundaries, private timeline/cursor exclusion, author redaction, append-only privileges, sender/audience constraints, audit and notification rollback, revocation leading a queued reply or retry, and a real API/browser committed-response-loss recovery after refresh. It runs inside the existing verified disposable maintenance database runner with notification publication enabled only for this test group.

`tests/ui/maintenance-conversations.spec.ts` covers reply success/recovery, editable rejection, cleared private state on revocation, management audience choice, staff denial and mobile layout. Existing maintenance fixtures retain their progress-note workflows, with resident expectations updated for the newly authorized reply action. Actual run results are recorded in the release notes and feature register; this contract does not claim deployment or live acceptance.
