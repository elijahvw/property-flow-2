> Historical PR #60 source evidence, preserved from [`f5f1a2394e7eeae33ce063bfdadadb8171f9c35d`](https://github.com/elijahvw/property-flow-2/blob/f5f1a2394e7eeae33ce063bfdadadb8171f9c35d/docs/forms-audit-2026-10-21.md). This document's feature, test, dependency, preview and deployment claims describe its original dated branch; they are **not current PR #61 consolidation results**. Relative source links below point to that immutable source snapshot. Use the [current inventory](../PR60-consolidation-inventory-2026-10-24.md) and [consolidation/release gate](../PR60-integration-review-2026-10-24.md) for current status.

# Form and editor audit — October 21, 2026

Status: local implementation; review, deployment and real-account acceptance remain separate. This audit covers the shared form/editor infrastructure, tenant details and lease setup. It does not certify every remaining editor as production-ready.

## Findings and changes

| Priority | Evidence and user impact | Local result |
| --- | --- | --- |
| P2 | Lease creation used a directory modal containing property/unit/tenant selection, terms, payment instructions, review and another tenant modal. The amount of work exceeded a short contextual edit. | Lease setup now has a full main-page editor at the existing lease directory URL with `new=lease`. The directory is hidden during setup; a named heading and Back to leases action provide one task focus. A short tenant addition remains a separate accessible dialog. |
| P2 | Search/filter context was not represented in modal opening state; browser Back could not close lease setup as an ordinary page task. | Opening setup updates the URL while keeping the directory's property, unit, search and status parameters. Browser Back returns to the directory and retains unfinished form values in memory; reopening resumes them. The explicit close control retains the existing discard/draft/recovery choices. |
| P2 | Shared `Form` rendered API errors after all fields and actions, leaving errors below the viewport in long forms. | An alert summary appears before fields and receives focus after a failed submission. Input, reviewed payloads and submission identities remain intact. |
| P2 | The shared editor's native-input dirty state was sticky. Reverting every field to its original value still triggered a discard warning. | Native field changes are compared with the baseline. Structural changes and submitted reviews still require protection; reverting a plain field edit no longer produces a false warning. |
| P2 | Emergency contact fields occupied space for every new tenant even when no such information was available. | Mailing address and emergency contact sections use progressive disclosure, open automatically when existing details are present, and preserve all fields in the submitted form. Full name and contact-email requirements are explained. |
| P2 | Collapsed optional sections can contain conditionally required fields, such as an emergency-contact name after entering a phone number. Native validation cannot focus a hidden invalid field. | Shared forms reveal enclosing details sections during native validation so the field needing correction is visible and focusable. |
| P2 | A retained dialog draft stopped warning about refresh when the editor was closed. | Unfinished retained drafts keep the browser's refresh/tab-close warning until completed or discarded. The interface still explains that drafts are kept only on the current page. |
| P1 | Moving a long form into the workspace exposes ordinary navigation that can unmount a page-only draft. | The page editor guards sidebar and prerequisite links, including a same-path property-context change. Cancel preserves input; an explicit leave confirms discarding page-only changes. Navigation waits while a request is being submitted. Already-submitted recovery gets distinct wording. |
| P2 | A page's close confirmation needs its own keyboard/modal boundary rather than an inline alert section. | The short discard/draft/recovery confirmation uses a native modal with focus containment. The main lease form remains a page. Page action footers follow the fields instead of floating over them. |

## Form-surface standard

- Use a main-page editor for creating a connected record, a long multi-section form, or a task with a distinct review and completion step. Keep a readable summary and a clear route back to its source directory.
- Use a dialog for a bounded contextual edit, focused record selection, or a short secondary action. Preserve accessible naming, keyboard focus, busy-state blocking, errors and the initiating record context.
- Use explicit confirmation/review for financial corrections and other consequential changes. Moving a form to a page must preserve its retry key, version check, source record and audit behavior.
- Keep optional information collapsed when empty. Requiredness, source of defaults, resulting state and next step should be visible without exposing implementation vocabulary.

## Data and authority

The forms continue using existing company-scoped property/unit choices, exact tenant-account mappings, `ResidentContact` and lease records through `client/src/api.ts`. No account requirement, approval, role/property boundary, financial source, version check or submission identity was removed. Owner/manager lease permissions and the existing denied staff/resident/platform routes remain unchanged. Successful creation still opens the permanent lease workspace's household/onboarding section.

No migration, runtime variable, cloud resource or external provider activation is required.

The dependency update to React Router 7 exposed a compatibility issue in existing controlled search fields: URL updates run inside a transition by default, allowing rapid typing to outpace the displayed input value. The app's `BrowserRouter` explicitly uses `useTransitions={false}` so URL-backed controls update immediately, while the existing API-search debounce still limits requests. This preserves the current directory/filter design without creating competing local and URL input states.

## Remaining production work

1. Extend page-editor link protection to other draftable surfaces and review browser-history transitions across different routes and programmatic navigation. Ordinary links, native refresh and same-directory lease Back are covered here; this is not a global router blocker. Avoid claiming a page-only in-memory draft survives route unmounts or a new session.
2. Evaluate full-page surfaces for lease renewals, move-out settlement, lease adjustments and long inspections against actual task completion. Preserve short corrections and confirmations as focused dialogs. A blanket conversion would lose useful context and is not required by this standard.
3. Define explicitly authorized server-side draft retention before introducing durable drafts across sessions/devices. Include company and property boundaries, privacy, expiry, stale-version handling and recovery of already-submitted requests.
4. Conduct owner/manager/resident keyboard and mobile acceptance with real account permissions and representative records. Fictional browser fixtures verify behavior, not customer acceptance.
5. Carry a directory's explicit unit context into lease setup's selected unit, with current availability validation. Today the directory's `unitId` filter scopes its records, but creation starts with the first active unit option; the review shows that selection before saving. This is a PF-02 context-handoff refinement rather than a new feature.

## Validation

The client production build passed locally after the shared editor/page changes. `tests/ui/forms-audit.spec.ts` adds browser regressions for lease page navigation/filter/draft retention/mobile layout, visible focused API errors, conditionally required collapsed fields and reverted native edits. The final focused run passed all four tests, including a modal/focus boundary check for the short close confirmation and an assertion that the page submit action follows the fields instead of covering them. The existing leasing, lease-recovery and offline-tenant suites passed all 28 checks in the preceding targeted run. Their source/recovery and role-boundary behavior remains covered.

Existing lease creation/recovery assertions were updated only where presentation or route behavior intentionally changed. The connected-workspace footer check now scrolls to the page action before asserting visibility; always-visible sticky behavior remains appropriate inside bounded dialogs, while the new page footer follows the form. Broader final-suite evidence is recorded in the overall audit rather than inferred from these local fixtures.

After the router compatibility setting and footer-test adjustment, the complete leasing and connected-workspace suites passed all 27 browser checks on the updated dependencies. This includes rapid sequential search input, one debounced API search, refresh-restored filters, property-scoped browser history, page setup, ambiguous-save recovery, role denial and both desktop/mobile action visibility.
