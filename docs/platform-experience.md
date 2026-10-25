# Platform experience and feature delivery contract

Property Flow supports daily property management through connected, trustworthy records. Keep the existing calm interface: light neutral backgrounds, white working surfaces, dark readable text, green primary actions, restrained borders and useful spacing. The canonical visual values live in `client/src/design-tokens.css`; `index.css` supplies the control/type baseline and `workspace-patterns.css` supplies shared directory/workflow structure. Extend these foundations before adding another visual system or decorative metrics without a real source.

This contract defines expectations for new and refined features. It is not evidence that every existing screen or live workflow has passed acceptance. [AGENTS.md](../AGENTS.md) makes it part of feature delivery; [the roadmap](product-roadmap.md) and [backlog](product-backlog.md) retain scope and unfinished acceptance.

## Shared visual foundation

Use semantic `--pf-*` tokens for background, surface/subtle/selected states, text/muted text, border strength, accent, focus, warning and critical states. Use the existing spacing scale, control/surface/feature radii, content width and subtle shadow instead of introducing page-specific near-duplicate values. Status meaning must include text; color alone cannot communicate authority, overdue work or completion. Keep secondary actions quieter than the task's main action, and reserve warning/critical treatments for an actual source state.

Use scoped CSS for a workflow's arrangement. A local fix must not change unrelated tables, headings or controls through an unqualified global selector. Shared pattern changes need rendered checks on more than one adopting workspace, with real loaded, empty and unavailable states. Loading placeholders must reflect expected content without claiming a count or status; investigate observed layout movement before reserving arbitrary space.

## Navigation and connected records

Keep each primary destination in one task group using `client/src/navigation.ts`. Workspace contains portfolio entry points; Operations contains leasing and maintenance jobs; Finance contains rent, deposits, cash and reporting; Administration contains company/team/platform configuration; Account contains personal tasks and Help. Platform, company and resident authority remain distinct even when one account can see several contexts. Prospects and Applications have separate, accurate labels.

The universal **Search workspace** control and Ctrl+K/Command+K finder reuse that destination metadata, including existing secondary workspaces and useful task terms. Results intersect the current role and company feature availability; read-only pages are identified. Property names/addresses are searched only for a typed query when property access is available. The finder does not search tenant names, lease contents or private document text. A property-read failure must not remove permitted task/page results or clear the query. Keep arrow-key selection, Enter, Escape, explicit empty/error recovery and successful-navigation focus working.

On small screens, Menu opens a drawer rather than pushing the current page out of reach. It traps keyboard focus, makes the covered content inert, preserves page position and restores the trigger on dismissal. Escape closes it; the drawer's search handoff closes the drawer before opening the finder. A navigation attempt still passes the editor's leave/recovery guard, and canceled navigation keeps the original source and unfinished work.

A new feature needs an obvious entry from the appropriate existing workspace and a useful next step. Prefer a detail section or secondary action when the job belongs to an existing record. Add a primary menu item only for a distinct recurring job. Do not create a second directory or competing route for the same source records. Keep route registration, navigation placement, page titles/breadcrumbs, permission/feature projections and Help consistent.

Directories identify records by useful names and property/unit context, with search, clear status, complete filtered totals and bounded pages where needed. Detail URLs must survive reload and copied links. Source links open the exact source and retain allowed property, filter, tab and return context. Browser Back and explicit return controls must remain intelligible. Denied or missing sources must never silently open another record.

Adopt the shared `.directory-workbench` anatomy: scope, labeled filters, `.directory-result-summary`, active filter chips, records, then a named paging landmark. `DirectoryView` presents removable filters and reset while leaving source/URL decisions with the caller; removal/reset returns focus to the summary. Keep the originating property/unit and permitted source-return context when clearing directory choices. Mobile rows must retain their field labels and meaningful source actions.

Use `useDirectoryPage` and `DirectoryPagination` only for a complete already-loaded list. Filtering must happen across that complete list before slicing its visible page. These helpers must never page a server cursor window as if it were the full dataset or invent a total. Server-paged tenants retain their complete filtered total and source cursors. Unit/lease cursor responses expose counts for the current page and whether later results exist; label those limits honestly. Reset/clamp paging after filters or refreshed membership change the available list.

Platform Users has two different jobs: local name/email/company/status filters search the synced accounts, while **Check exact email** performs an explicit complete-email provider lookup beyond the provider directory limit. Label these separately; a local filtered count is not proof of every provider account. Team filters cover the complete returned company team before its local paging. Account status, company membership, company status, verification and company role remain distinct facts in tables and mobile cards.

Keep one prominent primary action per task. Show setup prompts only while setup is missing. Use progressive detail for history and secondary actions; keep archive, destructive and administrative operations distinct from ordinary work. Empty states explain a real available next action; hide unsupported controls instead of suggesting inactive functionality.

## Forms, layout and accessibility

Group related fields under short headings, with visible labels, useful instructions and clear required/optional treatment. Follow established full-page/detail and focused-dialog patterns. Reuse month-name dates, exact money formatting, status wording and street → city/state/postal address grouping. Distinguish account preparation, contact history, invitation, portal grant and first sign-in in both labels and next actions.

Reuse `FormField`, `FormSection` and `FormActions` from `components/FormFields.tsx`. Keep each visible label, native `required` constraint and help/error association together. Sections use semantic fieldsets/legends and explanatory text where useful. The shared `Form` exposes **In this form** navigation when three or more visible main sections need it; navigation moves focus to the section without submitting, resetting the form or changing retry identity. Keep native validation able to reveal a required field inside a collapsed section.

Declare the form's intent: **query** updates a view, **review** prepares a review, and **write** records a mutation. Query forms must not announce a saved business record; review preparation is not confirmation or a completed write. Use action/busy/success wording that matches the actual outcome. Preserve the existing operation signals and native submission behavior when adopting the shared controls. Mixed-feature pages need operation-specific write guards rather than a blanket route lock.

Keep entered values after validation/server failures. Associate errors with the relevant fields, give a useful form-level explanation, and move focus to the error or first invalid field when appropriate. Success describes the actual saved state and offers the saved record or next action. Never report provider delivery, a signature, settlement or payment from an internal preparation record alone.

Explicit unsaved drafts, acknowledged saved tasks and already-submitted recovery are separate states. Use the existing editor/leave guards. Closing or switching a record must not discard a pending uncertain operation, rotate its retry identity or silently rebase a stale review. Background refresh cannot overwrite an edited form. Recheck current source/version/authority before confirming consequential terms.

A same-authority read-only policy refresh may lock a mounted draft without erasing its fields or original submitted payload/key. New write entry must respect role and feature mode. An actual actor/company/authority change must conceal or clear private work as its established recovery contract requires. A settled durable save releases only its own busy/dirty registration; another unfinished section remains protected. Page editors need accurate task-specific eyebrow/back labels, and concealment must not be treated as user-approved discard.

Use semantic buttons/links, descriptive accessible names, associated labels, visible keyboard focus and status announcements. Focus belongs inside an open dialog and returns to its trigger; Escape follows the supported close/leave behavior. Menus remain reachable and scrollable on small screens. Essential actions cannot depend only on hover or color.

Review changed screens at desktop and narrow mobile widths (including 320px), with long names/addresses and keyboard-only interaction. Avoid page-level horizontal overflow; a labeled scrolling data table is appropriate when its columns genuinely need space. Primary controls follow the existing 44px minimum sizing. Shared CSS changes require checking adjacent screens rather than relying only on the edited page.

## Workflow and authority review

Before coding, write the acceptance path in the implementation notes: role → entry/source → action/review → resulting state/history → return/next step. Identify actual data sources, company/property/lease boundaries, permissions and provider dependencies. Preserve immutable posted/signed history and distinguish correcting a source from deleting its evidence.

For the changed workflow verify the applicable loading, empty, validation, stale-edit, unavailable/denied, safe-retry and success states. Check current role/company/feature revocation while the page is open. Hide private records when authority is lost and recover them only through a fresh authorized read; preserve exact submitted-operation recovery without exposing its private payload in a denied view. Residents, occupants and staff need their real restricted projections; a platform owner does not stand in for their acceptance.

Use meaningful regressions for demonstrated defects and consequential behavior. Disposable fixtures test implementation; actual providers, target database/runtime versions, hosted telemetry and real-role acceptance need their own evidence. Keep unresolved dependencies visible in the release checklist.

For cash entry, keep the source choice explicit: lease rent payments and security deposits go through their source accounts; other income and paid expenses use Cash activity. Linked receipts already appear in cash history. Query filters and complete filtered totals must not imply another payment, settlement or bank reconciliation.

Sales-demo blueprints, presentation source links and lifecycle action plans follow [the demo runbook](sales-demo.md). Reviewed fixture update/fresh rebuild creates a new dedicated generation through retained source/version checks and durable successor reservation. It must not rewrite an old generation's posted history. Keep fixture/version/coverage and walkthrough evidence aligned with represented behavior, and distinguish blueprint inspection from provider/account/business writes.

## Change-to-document map

Update the applicable records in the same change. Read existing contracts before adding another document.

| Change | Documentation and implementation checks |
| --- | --- |
| User-visible behavior, route, status or recovery | Matching workflow contract; `docs/local-feature-release-notes.md`; existing PF entry in `docs/product-roadmap.md`; unfinished acceptance in `docs/product-backlog.md` |
| Task instructions or navigation labels | Relevant guides in `client/src/help-content.ts`; matching workflow walkthrough; navigation/title metadata and browser coverage |
| New capability, release or changed acceptance state | `docs/mvp-status.md`; roadmap; release/role checklist; `README.md` when its summary or entry links change |
| Schema, configuration or provider prerequisite | Workflow deployment/runbook section; migration/activation and rollback/recovery notes; relevant operations/monitoring contract; preserve Start/Stop inventory and cost/data rationale for infrastructure |
| Feature/schema/source relationships represented in the sales demo | Apply the sales-demo maintenance rules in `AGENTS.md`: fixture/version/coverage/runbook and lifecycle regression when behavior or relationships change |
| Visual or shared workflow convention | This document and shared components/styles; inspect adjacent desktop/mobile/keyboard flows |

Keep current summaries accurate: proposed, local/PR, merged, deployed and accepted require different evidence. Replace obsolete current statements instead of leaving two competing claims. Preserve dated logs and their original failures, counts and limitations; label them historical and link them from the current summary. Record the tested source, exact checks and unavailable validation, and avoid copying large historical test matrices into each new feature note.
