# Property Flow project guidance

Applies to this repository. Read relevant implementation and product documentation before changing a workflow; keep existing behavior unless the task explicitly changes it.

## Development and delivery

- Build and validate locally first. Keep the local preview browser open when the user wants to follow along; preserve their preview data when restarting services.
- Batch related feature, usability and performance work when requested. Do not merge, deploy, apply Terraform or change live configuration without authorization for that action.
- Keep changes focused and practical. Reuse established components and source records; avoid speculative abstractions, placeholder controls and invented data.
- Explain the result, validation and material limitations. Do not claim a local check proves cloud deployment or external email delivery.
- Keep work focused to control usage: read targeted files/diffs, batch independent checks, summarize browser state, and reuse valid test evidence. Repeat checks when changes or unresolved failures justify them. Do not silently widen a bounded increment into a redesign or another epic.

## Living feature register and completion

- Keep progress and validation notes local. Jira tracking is disabled by user preference; do not read, create, update or synchronize Jira unless explicitly requested. Existing issue keys/links are historical references only.
- `docs/product-roadmap.md` is the running feature/status register; `docs/product-backlog.md` holds detailed acceptance. Preserve stable PF IDs, completed capabilities and outstanding scope. Add an ID for genuinely new work; update the existing item for refinements.
- For each increment record the user outcome, real data/source records, role/property boundaries, next complete workflow, dependencies, validation and evidence. Distinguish proposed, in progress, local/PR, merged, deployed and user-accepted; unknown remains unverified. Never equate a passing test, navigation item or deployed release with acceptance.
- Build production-grade operating workflows: connected source/detail/history, correct complete totals, recoverable failures and drafts, concurrency/retry protection, useful audit history and measurable operations. No dummy features, invented production data, inactive controls or unsupported success claims. Clearly labeled fictional fixtures belong only in isolated preview/tests.
- A feature is complete when authorized users can finish its real job, follow sources and return with context, correct/reopen where appropriate, and understand the resulting state. Include owner/manager/resident projections and staff boundaries that apply; keep the UI clean and reveal richer details when useful.
- Keep release notes and the feature register current in each PR. Record migrations, activation variables/provider setup and remaining acceptance work; the user handles merge/deployment unless explicitly delegated.

## Product and interface

- Properties, units, tenants, leases and maintenance form connected workflows. Preserve context and offer clear next actions from actual record state.
- Show setup prompts only for missing setup. Account creation happens before new tenant/lease participation; portal activation and first sign-in remain separate.
- Make directories useful for daily work: meaningful labels, property/unit context, search, clear status and direct detail links. Keep secondary and archival actions unobtrusive.
- Forms must be readable and easy to navigate, with grouped fields, useful detail, clear required/optional labels, validation and preserved input after errors.
- Display dates with the month name, day and year. Group postal addresses as street, then city/state/postal code. Keep dates, currency and status wording consistent.
- Use responsive layouts, semantic controls, visible focus, accessible labels and explicit loading, empty, error and success states.

## Identity, authorization and history

- Auth0 is the account authority. New tenants and every new leaseholder/occupant require an existing or precreated account. Use the existing User + exact Identity mapping; contacts and invitations reference that account. Account existence, contact email, a profile or a lease record never grants portal access by itself.
- Keep profile, platform authority, company membership, property access and lease participation distinct. Identity is keyed by issuer/subject, never automatically linked by email.
- Leaseholders may see authorized shared lease finances; occupants have no financial access. Owners approve resident additions/removals. Emergency contacts are separate from household members.
- Staff retain read-only property access. Residents may edit permitted personal details, never their own company role, property/unit assignment, lease terms or access grants.
- Authorize each API operation from fresh server-side membership and permissions. Treat route IDs and `X-Company-ID` as untrusted input.
- Property data operations use transaction-local company context, explicit company filters and existing row-level security. Platform authority does not bypass company boundaries.
- Preserve financial source IDs, signed/posted history and immutable audit events. Record consequential changes atomically; use version checks and durable submission keys where retries or concurrent edits could duplicate or overwrite work.
- Browser calls use `client/src/api.ts` and server-managed cookies/CSRF. Never request OAuth tokens in page components or expose secrets in logs, responses or artifacts.
- Read `docs/access-overhaul.md` for access/deployment boundaries and `docs/open-observability.md` for current Grafana monitoring; historical Datadog instructions are superseded.

## Stack and validation

- Client: React/Vite/TypeScript. Server: Fastify/Prisma/PostgreSQL. Identity: Auth0 OIDC. Follow adjacent conventions and keep database migrations additive where practical.
- Client build: `npm run build --workspace=@property-flow/client`.
- Server build: `DATABASE_URL=postgresql://build:build@127.0.0.1:1/propertyflow_access_test npm run build --workspace=server` (compile only).
- Safe units after building: `node --test server/tests/*.test.mjs` and `node --test client/tests/*.test.cjs`, with integration database variables unset.
- Operations checks: `python3 -m unittest discover -s tests/operations -p 'test_*.py'`.
- Use existing disposable database runners for integration tests (`scripts/test-maintenance.mjs`, `scripts/test-finances.mjs` and related runners). Never point tests at development/customer data.
- Use the existing browser fixture suite for UI regressions and verify changed flows in the local preview. Run checks appropriate to the change; add meaningful coverage for authorization, data integrity and consequential behavior.
- Monitoring must accompany shipped workflows: bounded outcome/duration/failure signals, safe logs/traces and an actionable alert/runbook when needed. Preserve RUM privacy; never capture private form/contact/financial data or enable replay implicitly. See `docs/monitoring-coverage.md` for remaining coverage and activation evidence.
