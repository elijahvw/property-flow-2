# Local product-audit validation — October 21, 2026

This record accompanies the [product experience audit](product-experience-audit-2026-10-21.md), [backend audit](backend-audit-2026-10-21.md) and current feature register. It records local evidence, not hosted deployment or customer acceptance.

## Browser regression execution

The final fixture suite uses the repository's actual React application and intercepted, explicitly fictional API fixtures. The task-local Playwright configuration uses installed Chromium 154.0.8037.57, an isolated Vite server on loopback 5012 and four workers. The application is using the updated Vite 8 and React Router 7 dependencies. A fresh final run follows the source freeze, including the synchronous URL-filter update fix.

The final release-source broad run completed with **248 passed and four failures out of 252 scenarios** in 6.6 minutes, with no skips. Two failures were test assumptions about automatic focus refresh: the verification fixture now changes its provider result only when the explicit check reaches it, and the resident test permits repeated authorized refresh requests while retaining exact money/source and forbidden-company-call assertions. The other two initial page-load cases passed immediately in an isolated Vite optimizer cache with traces and no application changes. The original run did not capture enough console evidence to establish their root cause. **All 39 checks in the four related files then passed** in 1.4 minutes using the isolated Vite cache and traces. Every one of the 252 distinct scenarios therefore has passing evidence on the final application source; the original broad run remains recorded with its four failures rather than being relabeled as a clean 252-pass run.

Earlier runs during active interface edits were diagnostic, including an intentionally interrupted run; those results are not reported as a clean release run. Task-local broad results are in `/tmp/propertyflow-release-audit-results.json`. Focused traces/results are in `/tmp/propertyflow-isolated-audit-results` and `/tmp/propertyflow-isolated-audit-results.json`.

The checked-in onboarding configuration now uses 5012. Previously Vite listened on 5011 while its API proxy also targeted 5011, causing unmocked telemetry requests to recurse until local sockets were exhausted. The different fixture port avoids that loop. Unmocked telemetry during fixture tests can still report connection refusal because no live API runs at that proxy destination; business fixtures intercept their own API calls.

## Full application preview

The existing `scripts/local-preview.mjs` runs the real compiled Fastify/Prisma API and Vite client against its own verified tmpfs PostgreSQL 17 container, loopback-only ports 5090/5091 and restricted runtime database role. It uses fictional accounts and records, real cookies/CSRF/company RLS and a local identity adapter. Cloud credentials, development/customer databases, email delivery and live identity-provider changes are not used. Private local checkpoints continue every 30 seconds and on clean shutdown.

Actual browser checks passed for:

- Owner property directory with distinct search controls and results.
- Property finder empty state and matching results.
- Lease creation as a page, with readable desktop/mobile fields.
- Resident home with the real source-derived balance shown before service links.
- Desktop and 390px mobile layouts without horizontal page overflow; no JavaScript page errors.

Actual API/access checks passed for:

- An owner adds a fictional approved occupant through the real household API. Test-only local setup simulates that account's verified company membership and signed-in session; it does not test Auth0 sign-in or invitation delivery.
- That occupant's rent/deposit directories return no financial accounts. Exact rent, deposit and statement source IDs return 404; no financial balance is exposed.
- Resident calls to management finances, tenant profiles and leases return 403. A forged company header returns 403.
- The existing primary leaseholder retains access to the exact authorized lease financial source.
- The occupant home explains financial access without presenting invented zero balances.

Task-local logs: `/tmp/propertyflow-preview-audit-result.log` and `/tmp/propertyflow-preview-privacy-result.log`. Desktop/mobile screenshots use `/tmp/propertyflow-audit-*.png`, including property search/results, lease setup, resident home and occupant access. These files are transient local inspection evidence, not committed customer data or durable hosted artifacts.

## Limits

These checks establish local workflow behavior and access boundaries for the tested fictional records. Live owner/manager/staff/leaseholder/occupant acceptance, provider delivery, release rollout, alert response and recovery/restore exercises remain separate gates in the roadmap. The main audit documents retain backend, dependency, infrastructure and operational limitations. Local fixture success does not establish market readiness by itself.

## Backend and dependency companion checks

The final dependency installation uses the actual matching Prisma7.10.1 generated client and TypeScript compiler. Server units88pass/5DBskips, client units28pass, operations88pass and Start/Stop inventory checks pass. Fresh disposable PostgreSQL checks pass for access51, users/API/browser45, maintenance122 and leasing30. Financial177 checks also pass on the final run, giving425 disposable PostgreSQL/API/browser checks across those five runners. The financial result/log is `/tmp/propertyflow-audit-finances-final.log`. The resident read-only browser assertion continues to forbid all business mutations while allowing existing telemetry and walkthrough progress. All four workspace/standalone-backend full/production lock audits report zero known vulnerabilities. This is evidence for these sources and scenarios, not a security certification.

The real local charge-recovery diagnostic also verified a committed-response-loss case: dismissing the browser warning correctly cancels reload and preserves the open review; accepting it reloads, exposes Resume review, retains the exact submitted amount/explanation and completes the same pending identity. Only fictional preview records changed.
