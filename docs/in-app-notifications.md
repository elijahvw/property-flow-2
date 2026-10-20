# In-app notifications — PF-19

October 20, 2026: implemented and prepared in this PR on deployed main `1945049`. Review, merge, migration rollout, deployment and real-account acceptance remain pending. Apply additive migration040 after038/039 with the matching API/client. No provider, queue, scheduler or new cloud resource is required; existing Start/Stop behavior is preserved.

## Connected job

Active company members open Account → Notifications or the header bell. The inbox supports all/read/unread and maintenance/assigned-work/inspection/agreement filters, complete authorized totals and 25-item pages. The unread header count covers every currently accessible delivery, independent of inbox filters. Refresh is explicit, on visible focus/return and about every minute while visible; this is not instant delivery. Failure hides an unconfirmed header count instead of inventing zero.

Open source confirms current authorization on the server, marks read and returns a fixed local source path. Maintenance opens its exact management or requester detail, staff work its assigned-work detail, and lease reviews the exact inspection/agreement section. Back to notifications preserves filters/page; lease sections and reauthentication retain the return context. Source details perform their normal independent authorization. Mark read/unread changes only the recipient's inbox state. Read is not proof of review, acceptance or delivery acknowledgement.

## Initial event coverage

- Other current active verified owners/managers receive new resident/management maintenance intake, manually generated preventive requests, submitted work completion, inspections submitted for review, and agreement preparations submitted for review.
- Current active verified staff with explicit maintenance execution and access to that property receive assignment/reassignment, reopening and completion approval for work currently assigned to them.
- An active verified resident requester with current access to the request property receives actual status changes, including assigned-work status transitions, and explicitly requester-visible management updates. Internal notes and management-created work do not create requester deliveries.
- An agreement preparation's original creator receives approval/requested-changes notices while still active verified management in the same company.

Actors are excluded. Recipients are selected once during the source transaction; new grants or activation do not backfill earlier events. At most 1,000 eligible management recipients are supported per event; exceeding that bound rejects the source action explicitly rather than silently dropping recipients. These are automatic workflow notices; there is no manual sending/composer, conversation, scheduled reminder, financial alert, external email/SMS or signature-provider activation in this increment.

## Privacy and authority

`notification.read` permits active owners/managers/staff/residents to inspect and update their own inbox. It grants no source authority. Platform-only and unassigned users have no company inbox. Every list/count/action/open/replay rechecks the active verified account, current membership and active company under the existing authorization fence. Predicates enforce the delivery's original audience and current source/company/property authority **before** count and pagination. Demotion cannot expose the former management projection; reassignment/execution/property revocation hides former staff deliveries. A requester cannot read a neighbor's notice or source. Legitimately restoring access may make retained deliveries visible again without resetting their read state.

Events store fixed kind/source IDs and actor only, not copied free-text notes, contacts or document contents. Safe current source title/property/unit are resolved only after authorization. No file download, signing, payment, invitation or access grant is triggered by reading a notice. The server chooses source paths; a body cannot supply a URL or arbitrary recipient/content.

## Integrity and retention

`NotificationEvent` retains one immutable company/event key and composite source references. `InboxNotification` retains immutable recipient/audience/event identity; only versioned read state changes. `NotificationAction` retains exact action/payload retry receipts, including no-ops. All tables force company RLS; inbox reads/updates and receipt reads/inserts additionally require transaction-local `app.notification_user_id`. That value is set only after current account authorization and does not persist through the pool. Domain publishers have company-scoped delivery insertion authority; there is no public publishing API.

Source write, source audit, event and deliveries commit atomically. Business replay does not republish, backfill or reset read state. Read/unread/open use an opening version, UUID submission key, atomic receipt and audit. Late retry of an older committed/no-op read cannot overwrite a later unread action. Retry authorization precedes receipt lookup. Stale versions return 409; lost transport/5xx retains the exact submitted action/key in the open inbox and disables replacement actions until recovery. Nothing is stored in browser storage. History and original source relationships are retained; deletion of referenced sources is restricted.

## Validation and operations

`server/tests/notification-cases.mjs` uses the real application/publisher and a new isolated company in the tmpfs-only PostgreSQL runner. It covers audiences, actor exclusion, business/read replay and concurrency, no-op recovery, safe projection, staff/current requester boundaries, company and role revocation, rollback, exact lease sources, complete paging, immutable history, composite foreign keys, forced own-inbox RLS and authorization fencing. The browser uses that real isolated API for header count, recovery after commit/response loss, exact source/filtered return, conflict messages and phone layout. Older destructive fixture cleanup injects a disabled publisher until the notification suite; production uses the real publisher by default.

Fixed browser operation `notification.state` exports only outcome/duration; shared `page.data.load` covers inbox/count loads. Existing sanitized HTTP spans and API error metrics cover publication/action failures. No titles, source IDs, query filters, note contents or recipient identities are telemetry labels. Operational diagnosis: check401/403 before restoring access,409 before retrying a reviewed version, and5xx/publication errors before retrying the original business operation. Inspect retained source/event/action/audit counts with authorized company access when diagnosing duplicates; never resend notices manually or disable RLS/history guards. There is no background delivery backlog or external delivery success claim. Live telemetry and real-role acceptance remain unverified until an authorized release.
