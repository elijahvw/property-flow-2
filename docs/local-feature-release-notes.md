# Feature release notes — current checkpoint October 22, 2026

## October 22 — resident service, saved tasks and vacancy/applications (published in PR60)

The new batch connects resident maintenance replies to the existing timeline and management inbox, shares exact cleared lease file versions with named residents with revocation and receipt history, saves selected unfinished tasks to the user's account, and adds readiness, inquiries/follow-ups, application review and conversion into a real draft lease. Vacancy, readiness and rental listings are separate: units start Not listed for rent, and only an owner can explicitly list or remove them. Readiness and lease changes never auto-list units. Approval, acknowledgement, activation, billing, invitation and signature remain distinct actions.

Additive migrations041–045 accompany the matching client/API. Current checked-out baseline75d5342 also contains undeployed/unverified migrations038–040. No new cloud resource, provider activation, external message, public listing or payment collection. This batch is published in [PR60](https://github.com/elijahvw/property-flow-2/pull/60), implementation head `90471a3`; hosted CI remains pending. Merge, rollout and user acceptance have not occurred. The user handles merge and deployment. Before the owner-listing refinement, the client build and complete 277-case browser suite passed; disposable maintenance/leasing/finance suites passed 368/368 with no skips. The owner-listing correction then passed 25 focused browser checks, 55 disposable leasing/API checks and 28 client units plus both builds, with all 63 preview business-table fingerprints preserved. Final evidence and remaining scope are tracked in [the batch record](feature-batch-2026-10-22.md).


Current checked-out merged source is `75d5342` (PR59). Last documented deployment is `1945049`, followed by successful Stop; PR59 deployment and complete real-role acceptance remain unverified. The October 21 audit increment is included in PR60, adds no migration/cloud resource and preserves existing source/history/role boundaries. See the [full audit](platform-audit-2026-10-21.md) for findings, final validation, limitations and revised next increments.

October 21 audited changes: separate property filters/results and shortcut finder states; predictable route titles/current navigation/focus; task-grouped lease sections; main-page lease creation with input/error/recovery improvements; consistent Rent & payments wording and human activity labels; resident task guidance; transaction-fenced legacy access and required member versions; accurate safe framework errors; patched workspace/standalone backend dependencies and restricted development host configuration. Review the [product comparisons](product-experience-audit-2026-10-21.md), [forms](forms-audit-2026-10-21.md), [backend](backend-audit-2026-10-21.md) and [dependencies](dependency-audit-2026-10-21.md). Matching client/API deployment and user acceptance remain separate steps.

Validation: client production build and real server compilation pass;88 server units (five separate DB suites skipped),28 client units,88 operations checks and the power inventory guard pass. All425 disposable database/API/browser checks pass (access51, users45, maintenance122, leasing30, finance177). All252 browser scenarios have final-source passing evidence:248 passed in the broad run and39 passed in a focused rerun covering the four broad-run failures. Four full/production workspace/backend dependency scans report zero known vulnerabilities. Actual fictional-preview owner/resident/mobile/occupant privacy checks pass. Standard Prisma CLI engine download remains policy-blocked here; the real matching official WASM generator and TypeScript compiler were used. Hosted CI/rollout and production gates remain separate.

Dated sections below retain their original delivery/test statements as historical evidence.

PRs [#44](https://github.com/elijahvw/property-flow-2/pull/44), [#45](https://github.com/elijahvw/property-flow-2/pull/45) and [#46](https://github.com/elijahvw/property-flow-2/pull/46) are confirmed merged. The live UI exposes document and delegated-work controls; scanner activation and full real-role acceptance remain unverified. The October 18 release is prepared locally; cloud rollout/migrations and full real-account acceptance remain pending. Sender-domain/DKIM and controlled inbox delivery are verified. Merge, deployment and acceptance remain separate from validation.

- Private document foundation (migration031): management uploads against leases/maintenance, retained immutable versions, quarantine and a fail-closed ClamAV adapter, audited downloads, archive/restore and bounded private database storage. No public frontend storage or implicit resident/staff sharing. A pinned maintained ClamAV sidecar and loopback adapter are prepared in this release; real ClamAV clearance/rejection passed locally, with cloud upload/download acceptance pending. [Contract](private-documents.md).
- Delegated maintenance (migration032, requires staff property migration029): owner-granted execution, scoped assignments, acceptance/progress/submitted completion, management review and reopening, immutable history, safe retries and review-queue filtering. Staff keep default read-only access; financial and document authority stay separate. [Contract](delegated-maintenance.md).

Local tests use disposable PostgreSQL and fictional browser/scanner fixtures. No test or migration ran against preview/customer databases. The open preview was not restarted or migrated; the new backend endpoints require a safe local migration/restart before preview acceptance.


## October 18 — approved platform workflow audit (local)

- Invitations now recheck current inviter authority, acknowledge completed acceptance safely, deduplicate durable retries, rotate/revoke private links deliberately and provide filtered paginated history. A shared delivery/recovery UI connects team, tenant and approved household workflows. Optional SES email distinguishes provider acceptance from delivery and never automatically retries ambiguous sends.
- Tenant/account/portal state is clearer; canonical tenant links retain sources. Staff scope and default-off maintenance execution share one versioned editor. Existing financial/household/approval boundaries remain.
- Public searchable Help Center, 15 real task guides, contextual Help and a skip/resume/replay walkthrough with private server-persisted role-aware progress.
- Compact mobile navigation; meaningful attention queues; focused maintenance due/assignee filters; cash-entry intent; direct deposit setup; report date presets/source links; paginated administration activity; automatic configured document scans with quarantine recovery.
- Additive migrations033/034, dedicated restricted SES task role, verified branded sender and private maintained ClamAV sidecar. AWS requested more information before production recipient approval; verified sandbox recipient testing remains available. Preview data was preserved; deployment/migrations remain pending. [Full contract and release prerequisites](platform-workflow-improvements.md).

Validation: both production builds, the189-case UI suite plus final targeted/pagination regressions,291 disposable database integration checks,97 Node unit checks and 85 operations checks passed for the release. A real controlled Gmail received the sender delivery test with the correct signing domain and TLS. Dedicated live account/invitation/scanner/telemetry acceptance remains open. No tests used customer/preview databases.

## Development power controls

Separate **Start development** and **Stop development** Actions use the shared ordered controller, include all app/scanner task containers, preserve data and serialize with deployment. Startup verifies public readiness. CI requires lifecycle coverage for Terraform resources through `config/dev-power.json`; new services/databases or unclassified resource types fail until covered. Retained storage, routing and credentials keep their stated charges. See [power controls](dev-power.md). The smaller0.5vCPU/4GB scanner task is estimated at$27.75/month compute, an$18.74 increase over the former task at730hours, before credits/taxes and other usage.


## October 18 — explicit page-only drafts (merged and deployed, PR52)

Changed forms now ask whether to keep editing, close without saving, or save a draft and close. Save as draft is also available directly. Only explicit saving retains the mounted form, selected file, opening source version and submission key while its page stays open. Refresh, navigation or company/access changes clear unsubmitted drafts. Unchanged editors close directly; forms keep their input after errors while open.

Unsubmitted tenant/profile/financial reviews no longer write browser storage. Already-submitted requests retain separate recovery journals with their exact payload and retry identity. Interrupted submissions offer Close & keep recovery, lock the attempted form data and block draft reset; closing cannot rotate their key. Selecting a different record asks before replacing a saved draft, and preserves an interrupted request until recovery. Closing never reverses a completed write. User-management sections preserve each other’s unfinished changes after independent saves. Read-only account/picker dialogs close without draft controls. Existing authorization, financial sources and history remain unchanged. No migration or infrastructure change; development power inventory validation passes.

Validation: client production build, 28 client unit checks,205 browser fixture cases and 294 disposable database integration checks, including new close/Escape/discard/refresh/storage/source-version tests. PR52 merged3cfb816; exact-head CI39146821948 and frontend deployment39147366107passed. Public Chrome smoke passed; signed-in draft and broader role acceptance remain pending in [the workflow log](workflow-acceptance-2026-10-18.md).


## October 18 — Help search task relevance (PR53 merged, deployed and verified live)

Help Center search prioritizes guide titles, then summaries, ahead of incidental body matches. Related guides stay available, equal-ranked results keep their existing order, and clearing search restores the full directory. The account guide summary now names password reset. This addresses live finding W09 with no new service, migration or infrastructure change. Production client build,10 focused Help/invitation browser checks,390px Chrome visual verification and the power inventory guard pass. Exact-head CI39186265460and frontend deployment39187019964passed. Seven live task searches, empty-result recovery, clearing filters,390px layout and keyboard access were verified in Chrome. No backend rollout or migration.

Multiword tasks such as rent payment and reset password match all query words without requiring an exact phrase.


## October 18 — maintenance vendor contacts (local / PR)

Management can search/add/reuse vendor contacts, edit details, archive/restore, inspect immutable history and follow linked maintenance requests. Request contact selection is separate from staff execution and paid-cost recording. Directory and linked-request totals cover every matching record; all three lists use server pagination. Contact/request versions, durable retries, atomic audit and company-scoped RLS protect writes and recovery. Residents, staff and platform-only accounts receive no vendor access. Explicit drafts remain page-only. No external vendor messages, provider activation or new cloud resources.

Additive migration035 passed disposable validation; no live/preview migration was run. See [the workflow contract](maintenance-vendors.md). Both production builds,212 UI cases plus the final6 focused vendor checks,72 safe server/28 client unit checks,56 disposable maintenance integration checks and the power inventory guard pass. Coverage includes fresh role/company/RLS boundaries, concurrent creates/edits, search totals before pagination, immutable history, audit rollback, Enter search behavior, explicit drafts and committed-response-loss recovery. Live testing is deferred while the user is away from the laptop.

Unchanged contact/link saves preserve source versions and visible business history; hidden immutable retry receipts safely acknowledge a lost response after subsequent changes. Covered by a real database regression.

PR54 is open at5708688. Exact-head CI39189388351passed, CodeRabbit is successful and the unchanged-save finding is resolved. Migration035/release and live account acceptance remain pending; no live/preview database or provider changes were made.

## PF-14 preventive schedules — local, release pending

Migration036 adds management-only recurring property/unit schedules, reviewed request generation, explicit skip with reason, pause/resume, source links and immutable paginated history. Weekly/monthly/quarterly/yearly calendar recurrence retains original day and stored timezone; missed dates remain due. Atomic versioned writes and durable retry receipts prevent duplicate occurrences. Existing work-order assignment/completion/vendor/document/cost flows are reused. No new cloud resource, automatic generation or external provider. Run additive migration during authorized release. Live account acceptance remains deferred.

## PF-14 connected work calendar — local, release pending

Management can review next active schedule occurrences and unresolved request targets together by month, property, type and day. Counts cover all matching source rows before paging. Open a source and return with the same filters. Paused/finished schedules, resolved requests and unscheduled requests are excluded; the latter remain linked in the existing queue. Generated occurrences become their existing request once, while the schedule advances. No new schema, runtime resource or external calendar provider; depends on the recurring schedule increment (#55).

## PF-15 private document library — local, release pending

Documents now provides a management-only company directory across lease and maintenance attachments. Search title/latest filename/property/request; filter source, property, archive and latest scan result before complete counts/paging. Results open the exact retained source document with versions expanded and preserve return filters across source/lease sections. No file is copied, downloaded, scanned or shared by listing. New versions' scan results remain distinct from older cleared originals. Existing source workflows retain fresh authorization and quarantine controls. No new migration/resource/provider; stacked after the connected calendar (#56).

## PF-16 lease inspections — local, release pending

October 19, 2026: lease workspaces now include management move-in/out inspections with structured condition items, exact cleared evidence versions, completion review and reasoned reopening. Immutable revisions retain originals and reviewed comparisons after later corrections. Completed move-out reports carry inspection context into settlement; no financial entry is created automatically. Failed submissions retain inputs/retry identity; explicit drafts remain page-only. Migration038 adds scoped inspection/revision/evidence tables. No push, hosted migration, deployment, cloud-resource change or user acceptance. [Contract](lease-inspections.md).


## PF-17 agreement preparation — local, release pending

October 19, 2026: Lease → Agreements prepares retained document versions, intended recorded leaseholders/company signers and frozen lease details for management review. Save/version, submit, approve, request changes, reasoned reopen and cancellation retain immutable originals/history. Lease, signer and document changes invalidate current review; no upload or approval is presented as a signature. Explicit page-only editor drafts and durable submitted-request recovery are distinct. Migration039 adds company-scoped preparation/revision/original-link tables. No push/deployment/live migration, signature provider activation, invitation or financial change. [Contract](lease-agreements.md).


## October 19 implementation / October 20 PR batch — PF-19 in-app notifications

Personal company inbox and header unread count connect maintenance intake/status/requester-visible updates, preventive generated requests, staff assignment/completion review and inspection/agreement preparation review. Filter, page, mark read/unread, open the current authorized source and return with inbox context. Read state is personal, versioned and safely retryable after a lost response. Current company/role/property/source access controls all totals and opens; private notes/file contents are absent.

Additive migration040 follows038/039; immutable source events, recipient identities and exact action receipts use forced company/own-inbox RLS. Publication shares the source transaction and audit. No cloud resources, external delivery, scheduled reminders or conversations were activated. Matching API/client rollout, hosted migrations, push/deployment and live role acceptance remain deferred. [Behavior, boundaries and validation](in-app-notifications.md).


PR59 review correction: an active recorded primary/additional leaseholder remains an intended signer after a same-company promotion to staff/manager/owner. Lease participation and company role stay separate; disabled/foreign membership and company-representative authority remain enforced. The regression checks all three roles for both kinds of recorded party, retained snapshots and disabled/foreign boundaries. Server build and the122-check disposable workflow/browser suite pass after this correction.
