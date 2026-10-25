> Historical PR #60 source evidence, preserved from [`f5f1a2394e7eeae33ce063bfdadadb8171f9c35d`](https://github.com/elijahvw/property-flow-2/blob/f5f1a2394e7eeae33ce063bfdadadb8171f9c35d/docs/task-drafts.md). This document's feature, test, dependency, preview and deployment claims describe its original dated branch; they are **not current PR #61 consolidation results**. Relative source links below point to that immutable source snapshot. Use the [current inventory](../PR60-consolidation-inventory-2026-10-24.md) and [consolidation/release gate](../PR60-integration-review-2026-10-24.md) for current status.

# Saved task drafts

October 22, 2026 — local implementation of PF-02/PF-10/PF-16/PF-23 refinements. Migration `202610220043_task_drafts` is additive. Source, local validation, deployment and real-account acceptance remain separate.

## Supported work

Owners and managers can save an unfinished new lease, linked renewal, or inspection observation text. **Saved drafts** lists only their own company/account tasks, with saved and expiry dates, a Continue task action and version-checked deletion. The source property and current lease/inspection are read again on resume. Saving a task changes no lease, inspection, rent charge, payment or deposit.

Save task draft keeps partial typed values, including incomplete dates and amounts, so users can finish later. The editor's Save draft & close also uses durable storage for these supported tasks. Other editors retain their existing explicitly described page-only drafts; they are not silently upgraded to arbitrary server-side form storage.

New lease setup restores the exact requested unit, including units outside the first page, through the scoped unit endpoint. An archived, inaccessible or wrong-property unit requires another explicit choice; it never silently becomes the first unit. Related directory filter context is stored as allowlisted fields rather than a browser URL.

Inspection task drafts contain observation text and original item keys. Existing evidence links remain attached to their source inspection. Changes to evidence selection must first be saved as actual observations; attempting to save such changes into a text-only task explains this restriction. Files, file contents, upload payloads, OAuth/provider tokens and arbitrary form fields are not accepted by this API.

The combined task values must fit within **48 KiB of serialized UTF-8 JSON**. Inspection drafts still allow at most 100 items and 1,000 characters per note, subject to that combined limit. Directory filter context has a separate **1,536-byte UTF-8 JSON** limit. Multibyte text counts by its encoded bytes. Oversized drafts return a clear validation error asking the user to shorten observation notes, reduce items, or shorten/clear directory filters. These limits leave room for PostgreSQL's JSON text spacing below its storage constraints; field-valid input does not become an unexpected database error merely because its combined text is too large.

## Review, concurrency and recovery

Source property, selected unit, tenant account/contact, lease and inspection versions are captured as applicable. A resumed stale task shows a source-change warning and requires an explicit source check. Lease and renewal tasks always return to editable details and the existing review step. Restored inspection text requires explicit observation review. The final domain APIs still validate current access, eligibility, unit conflicts and record versions; a saved task grants no authority.

Every saved task has an independent version. Another browser's update produces a conflict rather than overwriting newer text. Creation and the latest update have durable replay identities. Task saves retry the original attempted body after an interrupted response; a deterministic error allows correction. Refresh/reopen is the recovery path for a conflicting task version. No draft applies itself automatically.

A saved task retains one domain action key. The exact reviewed values are checkpointed before an already-saved task is submitted. This prevents a retained task from creating another source when post-success draft cleanup fails. The normal domain submission hash still rejects altered-payload reuse. A confirmed successful source response releases the navigation guard before opening its resulting record.

Already-submitted requests remain distinct. Their existing frozen payload and original submission identity are used for recovery; Save task draft rejects them. Financial requests are not a supported task kind and are never copied into this store. Do not infer bank settlement, external delivery or legal signature from a saved or submitted task.

## Access, retention and navigation

All operations authenticate and reread current membership/company permissions. Initial tasks require `lease.manage`; staff, residents and platform-only accounts have no task access. Explicit company/property/source filters supplement forced row-level security bound to company and personal user context. Another manager cannot inspect, edit or delete the author's task. Audit events contain task kind/source identifiers without draft text. No new cloud resource or provider is required.

Tasks expire 30 days after their latest save. Expired tasks stop returning content immediately and are physically removed during the author's next successful draft creation. There is currently no global purge worker for inactive accounts; that operational retention limitation remains explicit. Users may delete their own accessible tasks earlier. An expired/missing/inaccessible task exposes no saved values.

One supported React Router blocker aggregates every editor, including native dialogs and retained page drafts. It covers links, Back/Forward and programmatic navigation. A query change is allowed without a warning only when the editor/source context is retained; changing a draft/source/property/unit identity is protected. Same-directory Back preserves the mounted page task. Pending submission navigation waits for its result; a failed request stays on the form with its error. Explicit discard or confirmed completion releases the guard synchronously. Native refresh/tab close retains the browser's unsaved warning. URL-controlled search fields retain synchronous router updates.

## Validation

`server/tests/task-draft-cases.mjs` covers real PostgreSQL/API personal/company/role boundaries, CSRF, strict payload privacy, create/update replay, stale versions and explicit review, supported renewal/inspection sources, direct RLS context, deletion and expiry. The leasing disposable runner passed all 51 checks with these cases and the successful lease-recovery redirect regression. `server/tests/task-drafts.test.mjs` supplies pure allowlist/partial-text checks and combined UTF-8 size checks for otherwise valid multibyte observations and directory context.

The targeted browser run passed all 12 saved-task and router-guard cases: refresh and simulated sign-out/sign-in restoration, exact-unit selection, source review, retained cleanup failure with one action/source, distinct interrupted recovery, sidebar/prerequisite/finder navigation, cross-route Back/Forward, native-dialog Back, programmatic context changes and pending failure handling. A final dedicated close-save regression checks that the hidden confirmation form is persisted to the server before closing. Broader final validation and actual deployment/acceptance belong in the running feature register and release evidence.
