# Platform audit — October 25, 2026

Scope: the merged `47badac` platform and this local refinement. Review covers navigation, shared request recovery, user/access management, forms and connected workflows, feature regressions, documentation and AWS infrastructure. This is a development hardening pass, not a claim that every defect is known or that the hosted platform is production accepted. No shared/customer database, provider account, deployment or live AWS configuration is changed by the local work.

## Findings and fixes

| Area | Finding | Result |
| --- | --- | --- |
| Navigation | Registration order and URL regexes put applications/imports ahead of daily work and billing/unit imports in the wrong group; Prospects overlapped Applications in wording. | Explicit ordered navigation groups, one placement per primary destination, clearer Prospects label. |
| Narrow screens and keyboard | Long breadcrumbs could crowd the top bar; a tall menu could hide its footer; mobile menu lacked Escape dismissal. | Wrapped breadcrumbs, bounded menu scrolling, visible focus, larger toggle and Escape returns focus to the toggle. |
| People and access | Account status alone hid disabled memberships and suspended companies; a platform owner’s company role was obscured. | Separate account/company-access statuses, company/account filters, dual role display. |
| Team edits | A membership conflict left the directory stale, so reopening could submit the same obsolete version. | Refresh on conflict while retaining the original review/draft; explicitly reopen to review the fresh version. |
| Financial context | Cash activity’s property selector could disagree with the URL after Back/Forward. | Route changes synchronize the selector with the applied filter. |
| Maintenance expense links | Expense choice lived outside the protected form and could change during a pending/uncertain submission; retained-read failures left write controls enabled. | Freeze choice/search during pending/uncertain recovery, retain the exact retry key/payload, block new edits on failed/loading reads. |
| Concealed and settled recovery | An access refresh could hide a pending/uncertain dialog and unmount its original retry state; a settled durable draft could leave a stale unload warning. | Conceal dialogs while preserving original recovery; clear only the acknowledged adapter's busy registration and check current unload protection. Independent unfinished forms stay protected. |
| Vendor links | Retained stale reads still allowed choosing/saving a vendor. | Block stale choices and writes, retain selection, offer a fresh-read recovery inside the editor. |
| Request failures | HTML/empty/null HTTP failures could become parsing errors, hiding session expiration or whether a write was rejected. | Preserve HTTP status and session invalidation, show actionable text, keep definite 4xx rejection separate from uncertain 5xx submission. |
| Documentation | Current summaries still called merged PR61 work a draft; older PF03 acceptance allowed account-free new tenants. | Reconcile current source status and account-first acceptance, preserve dated historical evidence, document remaining provider/deployment acceptance. |
| Future delivery | Agent instructions lacked one concrete visual/workflow/doc impact contract. | Canonical `AGENTS.md`, [platform experience contract](platform-experience.md), PR review checklist and [.codex/config.toml](../.codex/config.toml). |

AWS findings and source optimizations are recorded in the [AWS audit](aws-audit-2026-10-25.md). Applying source configuration and measuring actual savings remain separate actions.

## Audit coverage

The existing browser fixture suite spans account/profile/company administration, people and team access, onboarding, property/unit directories and imports, tenant/contact/account/portal distinctions, leasing/households/renewals, prospect/application/availability workflows, rent and deposits, cash/expense imports/statements/reports, maintenance/delegation/costs/vendors/calendar/preventive work, private documents/sharing, notifications, support impersonation and draft/navigation recovery. The pass exercises that suite and adds regressions for the demonstrated defects above. Isolated fixtures validate UI behavior against controlled responses; they do not establish real provider behavior or every role’s live acceptance.

Source review of user-management mutations found existing fresh server authorization, transaction/version checks and separation of account, membership and portal authority. No new privilege, identity-linking rule or financial authority is introduced by these UI refinements. Existing safe server tests cover direct API rejection, scope, CSRF and telemetry contracts. Disposable database runners provide separate evidence for the tested workflows.

## Validation

The completed checks below validate the working changes against merged baseline `47badac`. Initial workspace dependencies were stale and did not match the lockfile; `npm ci --ignore-scripts` restored the locked dependencies. Initial missing-module/compiler failures are environment setup findings, not passing validation.

- Client production build: passed after dependency restoration.
- Server TypeScript compile: passed with the matching official Prisma 7.10.1 generated client. The normal Prisma CLI download is blocked by the environment (`binaries.prisma.sh` HTTP 403); matching official WASM/internal generator tooling with `skipDownload:true` generated the real client locally. The normal CLI build remains a release CI gate.
- Client unit suite: 15 test files passed, including navigation placement and HTTP recovery regressions.
- Safe server suite: 120 passed, nine database suites intentionally skipped, zero failures (129 total).
- Operations: 92 passed after infrastructure refinements, including image-retention and database-protection safety guards; power-inventory validation passed.
- Terraform 1.12.1: recursive formatting, backend-free initialization and AWS provider configuration validation passed. No state backend, plan or apply was used.
- Disposable PostgreSQL 17/API/browser suites: maintenance 148/148, finances 192/192, leasing 66/66, company billing 15/15, roadmap 39/39 and users/accounts 56/56; zero skips/failures in these completed runs. Each runner used a fresh temporary database and removed its container afterward. These checks include scope/RLS, concurrency, atomic audits, source navigation and replay. An earlier users run lost a recovery control after a DOM detach while the development source was changing; the stable-source rerun passed all 56.
- Initial full browser run: 394 passed, eight failed out of 402 under concurrent development-server/database load. Existing affected areas passed a subsequent 31/31 run; updated user-management coverage passed 17/17. New test selectors were corrected to match actual labels and scope options to their form. The initial failures remain part of this evidence.
- First production-build run: 405/406 passed. The failed durable lease-draft close test revealed the stale unload/busy-registration race described above; implementation was corrected without weakening that test.
- **Final rebuilt production-client browser suite: 406/406 passed in 6.7 minutes, zero failures/skips.** Command: `npx playwright test -c /tmp/pf-production-ui.config.mjs`, with all `tests/ui` specs, two workers, the production preview at `127.0.0.1:5019` and system Chromium. This includes every added regression and the unchanged draft-close acceptance test.
- Desktop lease workspace and 320px property rent/navigation screenshots were inspected: readable loaded content, clear hierarchy, visible focus and no horizontal overflow. Geometry/keyboard regressions also cover changed menus/forms. All relative links in changed Markdown resolve; Codex TOML and sanitized AWS evidence JSON parse, and final whitespace checks pass.

Chromium uses the installed `/usr/bin/chromium` because the managed workspace has no Playwright-downloaded browser. Local socket permission is needed for browser/database execution; initial default-sandbox launch failures occurred before pages were exercised. Temporary tooling, browser configuration and logs stay outside Git.

The final fixture run serves the actual production client build through an isolated preview port, avoiding development HMR and shared dependency-cache interference. Fixture/API responses remain fictional and isolated; this is not a hosted acceptance test. Presentation, access-status and retry guards do not change the demo's feature catalog, schema, source relationships or fixture data, so no demo version bump is needed; its current fixture/runbook status is preserved.

Help already names Prospects and the separate Applications destination; existing guides remain applicable. New filter and recovery behavior is explained by the controls/inline errors and the matching account/company, maintenance and experience contracts. Generated historical notification screenshots and tracked last-run metadata were restored rather than overwriting dated evidence.

## Remaining release and acceptance gates

- Run normal locked dependency installation, Prisma generation/build and the complete CI matrix on the final source.
- Review infrastructure changes with a credentialed Terraform plan, preserve Start/Stop and confirm changes are in-place before any apply. Do not infer live spend or resource utilization from Terraform defaults.
- Validate the hosted release and actual owner/manager/staff/resident/occupant projections with authorized test accounts. Confirm Auth0 provisioning/recovery, scanner currency, invitation delivery and hosted observability where applicable.
- Provider-dependent signatures, external notification delivery and payment collection retain their existing separate scope/activation gates. No local green test activates them.
- Further findings go into the existing PF feature entry/backlog with a reproducible trigger and acceptance evidence. Keep historical documents as evidence and update the current summaries instead of creating competing status claims.
