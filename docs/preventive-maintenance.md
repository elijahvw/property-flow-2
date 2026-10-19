# Preventive maintenance — PF-14

Management can create recurring maintenance schedules for a property and optional active unit, review the next occurrence, create its ordinary maintenance request, or skip it with a required reason. A request links back to the schedule and the schedule retains its generated requests and skipped dates. Assignment, execution, approval/reopen, private documents, vendor contacts and paid costs use the existing request workflow.

## Calendar contract

Weekly, monthly, quarterly and yearly intervals use date-only calendar arithmetic. The company timezone is captured on creation and remains explicit even if company settings change. First and optional inclusive last due dates anchor recurrence. Month repeats clamp to the last day of shorter months and recover the original day afterward; leap-day yearly schedules recover February 29 in leap years. Next dates advance from the reviewed occurrence, never from today. There is no silent catch-up or automatic job generation. Management may deliberately create upcoming work early.

Active, paused, finished, due-now, overdue and upcoming views filter before pagination/counts. Due now includes today; overdue is strictly before the plan's local today. Paused plans retain their next date; finished plans have no next date. Edit instructions/category/priority and pause/resume prospectively; existing requests retain their snapshot. To change cadence, dates or location, pause and replace the schedule explicitly. Creating a request advances the schedule, not the request's work status. No external calendar, notifications, service dispatch or payment occurs.

## Integrity and access

Migration036 adds PreventivePlan, immutable PreventiveOccurrence and immutable PreventiveAction. All have forced company RLS; composite property/unit/request FKs prevent foreign sources. Occurrences are unique by plan and due date. Owner/manager maintenance permission is checked freshly inside the shared actor/company fence on every read, mutation and retry. Plan row locks order different actors' writes. Expected version plus the reviewed due date protect occurrence actions; UUID/hash receipts replay the exact committed result even after later work. Unchanged edits retain only a hidden retry receipt, preserving source versions and visible history. New request, occurrence, next date, receipt and audits commit atomically. Runtime cannot modify/delete occurrences/history. Platform authority, contact records or staff assignment grant no schedule management access. Residents receive no plan projection; assigned staff use the existing limited work-order projection.

Shared editors retain only explicitly saved page-memory drafts. Uncertain submissions freeze the exact original payload/key for retry. Request and skip reviews keep separate explicit drafts. No unfinished form is stored in browser storage or the database. Every list/history has bounded pages and complete scoped totals.

## Operations and validation

Uses existing application/database resources; no new always-on resources or provider configuration. Start/Stop inventory remains unchanged and validated. Browser signals preventive.save and preventive.occurrence use existing bounded duration/outcome/failure telemetry; paths redact IDs and capture no instructions or skip reasons. For failures, check scoped permission, plan version/status, source unit status and transaction failure. Retry the original uncertain request; never create a second occurrence to guess its outcome.

Local verification uses disposable tmpfs PostgreSQL plus real API/browser and fixture UI tests: date boundaries, complete paging/filter combinations, exact replay, different-actor races, stale versions, pause/resume, skip reason/history, end dates, unchanged edits, RLS/immutable/composite constraints, role/CSRF isolation, revocation/suspension and atomic audit rollback. Production builds and existing affected maintenance/UI regressions are required. Migration/live-account acceptance stays pending until release; local evidence is not live acceptance.
