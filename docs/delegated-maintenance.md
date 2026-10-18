# Delegated maintenance — local increment (PF-12/PF-13)

October 17, 2026: implemented locally; no merge, deployment, live provider change or user acceptance. Builds on the existing migration029 staff property scope; migration032 adds default-off execution and immutable work events.

An owner opens Team → staff member → Property access and may separately enable maintenance execution. Staff defaults remain read-only. The grant supplies only `maintenance.execute`: no finance, leases, tenant profiles, team administration, maintenance intake, management notes or documents. Changing role/disabling membership or transferring company clears execution authority. Property selections remain an independent requirement; assignment itself grants nothing.

Management opens an existing maintenance request → Assigned work, selects currently active/verified staff with execution and property authority, and records an assignment note. Management may unassign/reassign while unresolved. Reassignment requires acceptance again and immediately removes the previous teammate's read/write/replay access. Disabled/transferred/revoked assignees remain historical references; management can explicitly reassign.

Staff use Assigned work to search/filter/page their own jobs and open a job with property/unit, issue, priority and target date. The complete workflow is:

1. Assigned → teammate accepts → request in progress.
2. Accepted → record team progress notes or submit completion.
3. Submitted → completion awaiting management review; request remains in progress.
4. Management approves → request resolved, or reopens → awaiting acceptance.
5. A resolved job can be reopened with a reason and accepted again.

Management can perform execution actions on behalf of a teammate; actor identity remains in immutable audit/event history. Work notes are shared with the current assignee and management. Existing internal management notes and resident-visible updates remain separate. Resident request/status projections do not expose assignees, work notes, capability grants or reviewer identities. Management's work-stage filter includes a completion-review queue and survives a detail round trip.

Existing assigned requests cannot bypass review through the old status editor/API: edit issue details there, and use Assigned work for status transitions. Completion never creates a paid expense, payment, deposit disposition or allocation. Existing paid-cost links remain management/finance-only.

Every list/detail/action checks fresh active company/membership, current capability, current assignment and current property scope, under company RLS. Consequential actions require a frozen opening version and durable submission key, retain before/after audit and roll back on audit failure. Failed drafts retain note/action/key on dismiss and background refresh; discard/reload is explicit. Revoked access clears visible job content and the editor. Old work events remain immutable after reassignment or completion.

Safe `maintenance.work` outcome/duration/failure signals complement existing server route metrics and status audits. No free-text note or assignee/contact identifiers enter telemetry. On409, preserve the draft, review refreshed work and deliberately discard/reopen before applying a different action. On403/404, review current owner grant, property scope and assignment; do not broaden other roles.

Remaining PF-13: vendor contact records, richer due/assignee directory filters, resident-authored discussion and external dispatch. PF-15 management-only documents are attached to requests; staff document sharing requires separate explicit authorization work. Estimates/payables and automatic payments remain undelivered.
