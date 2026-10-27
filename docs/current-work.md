# Current work — October 26, 2026

## Approved increment and baseline

The user approved the platform simplification plan, with reuse first, maintained free/open-source libraries where they reduce complexity, and inexpensive AWS services only where justified. This increment implements compact navigation and a guided move-in journey using existing records, routes and handlers. Branch `codex/simplify-navigation-move-in` starts from merged main `2ff16da` (PR72). No new dependency, service, schema or business API is introduced.

The later API architecture/documentation phase remains explicitly planned in [PF-25](product-backlog.md#pf-25--imports-reconciliation-and-integration-contracts--p2p3): complete endpoint inventory; consistent REST business contracts; auth, roles, company/property scope and support restrictions; request/response/error/retry contracts; integrated access-controlled OpenAPI/Swagger; and route/spec completeness checks. It is not implemented by this increment.

## Connected user workflow

Management sidebar: Today, Properties, Tenants, Leasing, Maintenance and Money. Documents and Settings stay separate from daily work; Platform authority has its own group. Specialist tools remain in the selected workspace and finder. Resident and staff navigation remains permission- and feature-scoped. Direct URLs remain supported.

Today links to Start move-in in the current property and Resume saved work. New lease creation, including a resumed saved task or application conversion, opens Move-in setup on the exact canonical lease. The guide derives saved rental, tenant, dates, terms and status from that lease. It links to household review, existing reviewed activation, rent/billing, deposits and optional portal setup. Each source retains its lease and permitted return context. It introduces no second workflow database, implicit approval or automatic financial/provider action.

A current household count does not count future/former residents; an active lease is not proof of physical move-in; a deposit account is not proof of payment; invitation history is not proof of current portal access. Existing owner/manager, staff, leaseholder/occupant, feature, support and company/property boundaries remain authoritative. Existing version/review/submission recovery continues through the original handlers.

## Measurement and validation

Source comparison at the same representative management permissions with all features available: 22 sidebar links before, 11 after, including account utilities; six daily workspace entries after. All original destinations remain registered and discoverable. This is structural evidence, not measured user task completion or latency. The proposed 90% unassisted completion and 30% time/navigation improvement targets require representative-user baseline and acceptance and remain unmeasured.

Integrated local validation passes: normal client production build, 76 client units, the complete fixed 485/485 browser suite in 7.5 minutes with two workers/zero retries/no source-build drift, and 134 safe server checks with 9 intentional database-gated skips. Fresh disposable users 73, leasing 68, finance 192 and roadmap 40 pass sequentially with no skips; test containers and fixture servers are cleaned up. Independent reviews have no remaining actionable findings. Desktop and 320px mobile screenshots were inspected. [Release notes](local-feature-release-notes.md) retain exact commands, corrections and limitations; final browser log: `/tmp/pf-simplification-browser-final.log`.

The initial online dependency install failed integrity checks; all 454 committed tarballs were independently SHA512-verified and the normal offline npm install passed without changing manifests/lockfiles. The normal server build cannot fetch the Prisma engine checksum from `binaries.prisma.sh` (HTTP403), so there is no successful normal server-build receipt. Official pinned Prisma 7.10.1 WASM tooling generated the real client; full source/generated DMMF matched all 87 models and TypeScript compilation passed before the API suites. This is separate alternate-generation evidence; a normal build in CI or an environment with the required engine remains a release gate. System Chromium 154.0.8037.57 with Playwright 1.58.2 was tested; bundled Chromium was not. Existing fixture helpers now honor the documented explicit browser path without weakening assertions.

## Release boundary

The user approved committing, pushing and opening an open, ready-for-review PR for this validated increment, followed immediately by the API documentation increment in an isolated checkout. Publication is being prepared; the exact remote head and CI/review results must be checked. Merge and deployment remain with the user. No infrastructure change, live user/provider action or paid service is performed. PR72 is merged source, with its deployment/provider acceptance still distinct. Jira remains disabled. Current shared standards and workflow/demo guidance are updated alongside the interface; fictional demo fixture7 source relationships remain unchanged by this presentation refinement.
