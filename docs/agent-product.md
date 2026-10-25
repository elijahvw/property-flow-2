# Product and interface guidance

Read when changing a user workflow.

Use [the platform experience contract](platform-experience.md) for the canonical adopted tokens, shell, forms and directory patterns. Keep the matching user Help and workflow contract current with behavior changes; `AGENTS.md` is the governing delivery contract.

- Properties, units, tenants, leases and maintenance form connected workflows. Preserve context and offer clear next actions from actual record state.
- Show setup prompts only for missing setup. Portal activation is distinct from account creation. Every new tenant and lease participant has an Auth0 account; recording their lease does not require first sign-in or grant portal authority.
- Make directories useful for daily work: meaningful labels, property/unit context, search, clear status and direct detail links. Keep secondary and archival actions unobtrusive.
- Forms must be readable and easy to navigate, with grouped fields, useful detail, clear required/optional labels, validation and preserved input after errors.
- Draft saving is an explicit user action. Explicitly saved drafts live only in memory while their page stays open; do not store unfinished input in local/session storage or the database. Do not silently retain or persist an unfinished form when it is closed. Closing a changed editor must offer Keep editing, Close without saving, and Save draft & close where drafts are supported. Preserve input while the editor remains open after validation/network errors. Keep already-submitted request recovery distinct from an unsubmitted draft; discarding a draft does not undo a completed business write or justify duplicating an uncertain financial submission.
- Display dates with the month name, day and year. Group postal addresses as street, then city/state/postal code. Keep dates, currency and status wording consistent.
- Use responsive layouts, semantic controls, visible focus, accessible labels and explicit loading, empty, error and success states.

- For each increment record the user outcome, real data/source records, role/property boundaries, next complete workflow, dependencies, validation and evidence. Distinguish proposed, in progress, local/PR, merged, deployed and user-accepted; unknown remains unverified. Never equate a passing test, navigation item or deployed release with acceptance.

- Build production-grade operating workflows: connected source/detail/history, correct complete totals, recoverable failures and drafts, concurrency/retry protection, useful audit history and measurable operations. No dummy features, invented production data, inactive controls or unsupported success claims. Clearly labeled fictional fixtures belong only in isolated preview/tests.

- A feature is complete when authorized users can finish its real job, follow sources and return with context, correct/reopen where appropriate, and understand the resulting state. Include owner/manager/resident projections and staff boundaries that apply; keep the UI clean and reveal richer details when useful.
