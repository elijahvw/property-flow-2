# PR #60 comparison and release decision — October 24, 2026

## Current consolidation authorization

At **October 24, 23:16 UTC**, the user superseded the alternative-only plan: “Yeah let’s get rid of 60, include the unique features not already in 61 in 61”. The authorized scope is now to consolidate all useful unique PR #60 work into the current draft candidate, reconcile collisions/migrations, fix the saved-renewal P2, and validate the combined result. Unrelated roadmap development remains paused.

**Consolidation is in progress; no unique port is claimed complete here.** The destination is `codex/platform-controls-landlord-workflows`; record its actual published draft URL/current head after remote verification rather than assuming a PR number. The successful `b68416d` 320/320 browser and 56/56 privacy checks below are the pre-consolidation baseline, not evidence for the combined ports.

PR #60 may be closed with a concise linking preservation comment **only after every useful unique item is preserved on the verified remote destination and combined checks/reviews are complete**. Until then keep it open. Preserve its branch and commits. This authorization does not permit merge, deployment, live migrations, customer actions or unrelated new features. No PR #60 closure is claimed by this document.

| Useful unique work / required adaptation | Consolidation status |
| --- | --- |
| Private 30-day lease-create, renewal and inspection task drafts; allowed fields, source freshness, stable final submission identity and resume after sign-in | Pending port and combined validation |
| Fix the stale-renewal P2 so one invalid source does not break the whole draft list; retain useful detail/delete/recovery behavior and fresh access checks | Pending fix and regression proof |
| Separate manual rental applications and tour/task follow-up records, decisions/history and reviewed conversion into a linked draft lease | Pending adaptation to the canonical prospect/source contracts |
| Owner-controlled rental listing intent, default unlisted; listing/readiness remain distinct with explicit owner action | Pending adaptation and access/concurrency tests |
| Shared-file receipt acknowledgments adapted to the canonical explicit sharing, eligibility, expiry/revocation and exact-version rules | Pending adaptation and privacy/retry tests |
| Property finder/search, contextual lease/navigation/help and resident rent-summary improvements, source/return context and mobile layout | Pending selected ports and browser verification |
| Page-leave/history/programmatic navigation guards and unsent-work protection without discarding exact uncertain submissions or leaking private state after revocation | Pending adaptation and interrupted-navigation tests |
| Aligned dependency/toolchain updates, root and standalone backend lock trees, stricter dev-host defaults and fresh audits | Pending port, build and audit proof |
| Useful audit/contracts/acceptance documentation and current-handoff privacy cleanup from PR #60, with historical evidence kept dated | Pending reconciliation into final inventory/checklist |
| One collision-safe schema/migration/API/UI contract for overlapping replies, availability, sharing and prospects; original support/billing/usage and tenant privacy/recovery retained | Pending integration and final combined validation |

The final inventory must link implementation and test evidence for each row before remote preservation or closure is marked complete. Copying an old migration chain or pointing to a similarly named baseline feature is insufficient.

## Historical recommendation before the consolidation request

The following recommendation was made before the 23:16 UTC instruction and is **superseded by the consolidation scope above**. The collision evidence and exact snapshots remain useful; the earlier recommendation to defer unique work does not limit the newly authorized ports.

**Recommendation: keep [PR #60](https://github.com/elijahvw/property-flow-2/pull/60) open as a draft; do not merge it first or merge both branches unchanged.** Use the current tested batch as the candidate canonical implementation for their overlapping areas. Preserve PR #60's unique work for selective follow-up integration after the feature-development pause. PR #60 is not wholly superseded, and no integration, merge, closure, head replacement or live migration was performed for this review.

The current branch is an **alternative review candidate**, not a stack on PR #60. It includes no PR #60 commits or automatic copy of its unique work. Before either release, select one schema/API contract for each overlapping area and review any retained behavior and data migration explicitly. A normal rebase or migration-folder renumbering cannot resolve these conflicts.

## Pre-consolidation snapshots and ancestry

| Snapshot | Branch / commit |
| --- | --- |
| Common base | `main` · `75d5342732ab8fc1e67deb3de9d045855eb20dc6` |
| Current tested implementation | `codex/platform-controls-landlord-workflows` · `b68416de649a775756ef24c19ccbcdf51d36b8e9` |
| PR #60 latest head | `codex/platform-audit-resident-leasing` · `f5f1a2394e7eeae33ce063bfdadadb8171f9c35d` |
| PR #60 implementation parent | `90471a3b0821aee32638c9070406e13b08260125`; latest `f5f1a23` changes documentation only |

The branches diverge from the same base: one current implementation commit versus PR #60's two commits. Neither head contains the other. Comparing those exact snapshots finds **202 versus 139 changed paths, 42 shared paths, and no identical shared file blobs**. A non-checkout `git merge-tree --write-tree` simulation exits with conflicts in **25 paths**, including two PNGs, schema, form, routing, maintenance and notification files. The working checkout was not merged or modified by that simulation. Its local diagnostic is `/tmp/propertyflow-pr60-merge-simulation.txt`.

## Confirmed contract and migration collisions

| Area | PR #60 | Current batch | Required reconciliation |
| --- | --- | --- | --- |
| Maintenance replies | `202610220041_maintenance_conversations` adds `MaintenanceUpdate.authorType` with `team` / `resident` | `202610240048_resident_maintenance_replies` adds the same column with `team` / `requester`, immutable requester checks and different replay fingerprints | Keep one provenance and retry contract; adding both columns fails, and relabeling retained authors or hashes is not a safe substitute |
| Availability | `202610220044_vacancy_applications` creates `UnitAvailability` with an `id` primary key, `status` and `notes`; `202610220045_rental_listing_intent` adds listing intent | `202610240043_unit_availability` creates the same table with a `unitId` primary key, `condition`, required reason and immutable revisions | Keep one model and deliberate listing semantics; both `CREATE TABLE` statements cannot apply |
| Shared documents | `DocumentShare` / actions, named participant sharing and receipt acknowledgment | `LeaseDocumentShare` / actions, owner-granted verified leaseholder sharing with expiry, reasons and archive revocation | Distinct tables still register overlapping company share/revoke and resident list/download routes; choose explicit role, recipient, receipt, expiry and revocation rules |
| Prospects and applications | `LeasingProspect`, separate follow-ups and `RentalApplication`; status/page-25 contracts | `Prospect`, stage/cursor-50/reason/version contracts and reviewed existing tenant/lease conversion | Both register prospect list/create/detail/history/edit/convert route families; do not retain two incompatible handlers |
| Shared UI and events | App/forms/lease workspaces/maintenance and notification changes | The same foundations plus platform feature policies and current tenant privacy/recovery | Resolve behavior and authorization together, then repeat combined regression validation |

The similarly numbered folders have different full timestamps and meanings. Both chains would be discovered as pending, with the October 22 folders preceding October 24. **Renumbering alone does not fix duplicate SQL objects, author semantics, route registration or source/retry contracts.**

Sources: PR #60's [reply migration](https://github.com/elijahvw/property-flow-2/blob/f5f1a2394e7eeae33ce063bfdadadb8171f9c35d/server/prisma/migrations/202610220041_maintenance_conversations/migration.sql), [availability/application migration](https://github.com/elijahvw/property-flow-2/blob/f5f1a2394e7eeae33ce063bfdadadb8171f9c35d/server/prisma/migrations/202610220044_vacancy_applications/migration.sql), and [batch contract](https://github.com/elijahvw/property-flow-2/blob/f5f1a2394e7eeae33ce063bfdadadb8171f9c35d/docs/feature-batch-2026-10-22.md); current [availability migration](../server/prisma/migrations/202610240043_unit_availability/migration.sql), [reply migration](../server/prisma/migrations/202610240048_resident_maintenance_replies/migration.sql) and [continuation evidence](roadmap-continuation-2026-10-24.md).

## Unique work identified before consolidation

- Private, account-backed 30-day lease-create, renewal and inspection task drafts, plus navigation protection. These differ from the current batch's page-only drafts and submitted-request journals.
- Separate manual rental applications and tour/task follow-up records, including reviewed conversion to a linked draft lease.
- Explicit owner-controlled `forRent` / `listedAt` intent. Current readiness does not automatically list a unit and does not implement PR #60's listing workflow.
- Shared-file receipt acknowledgments, property finder/navigation/rent-summary refinements, dependency/toolchain updates and stricter development-host defaults.

These capabilities are not included merely because the current batch has a similarly named area. Preserve their original sources and tests when selecting future ports; do not close PR #60 as fully replaced or silently bundle its 97 unique changed paths into this release.

PR #60's dependency work is a material release consideration. Its [dated dependency audit](https://github.com/elijahvw/property-flow-2/blob/f5f1a2394e7eeae33ce063bfdadadb8171f9c35d/docs/dependency-audit-2026-10-21.md) reported 22 affected production-dependency entries at the starting baseline (13 high, nine moderate, zero critical), with reachability qualifications and many entries associated with Prisma CLI tooling. It records aligned Prisma 7.10.1, Router 7.18.4, Vite 8.3.4, React plugin 5.2 and tsx updates across the root and standalone backend lock trees, followed by a dated zero-entry audit. The current implementation leaves those manifests/locks unchanged from `75d5342`, so those remediations are **not carried over**. Re-scan and remediate both lock trees before production; preserve PR #60's patch work rather than discarding it. No fresh registry audit was run for this comparison, and these dated counts do not establish current counts or an exploitable HTTP path.

## Checks and review findings on PR #60

The latest exact head `f5f1a23` has a successful [CI run 39725298907](https://github.com/elijahvw/property-flow-2/actions/runs/39725298907). Both `lint-and-test` (job `119647864712`) and `terraform-validate` (job `119647864962`) completed successfully. This validates that branch on its own, not a combination with the current batch.

All conversation comments, review submissions and inline threads were inspected. There is one unresolved [Codex P2 finding](https://github.com/elijahvw/property-flow-2/pull/60#discussion_r4344738526): a saved renewal whose source lease later loses its end date makes `sources()` throw HTTP 400, while the draft-directory loop catches only 403/404. One stale renewal can therefore break the whole personal draft list. This remains in the latest [source at line 66](https://github.com/elijahvw/property-flow-2/blob/f5f1a2394e7eeae33ce063bfdadadb8171f9c35d/server/src/task-drafts.ts#L66) and [directory loop at line 110](https://github.com/elijahvw/property-flow-2/blob/f5f1a2394e7eeae33ce063bfdadadb8171f9c35d/server/src/task-drafts.ts#L110); the final documentation-only commit did not fix it. The same source validation is used by detail/delete. The review is `COMMENTED` against `90471a3`, with no approval review.

CodeRabbit's successful status corresponds to its comment that automatic review was **skipped** because the repository has fewer than ten stars. It is not a clean code-review approval. No review was triggered and no PR #60 comment, thread, label or branch was altered in this task.

## Required consolidation and deployment gates

1. Consolidate the inventory above into one canonical schema/API/UI on the verified destination. Keep PR #60 open until every useful unique item is remotely preserved and combined checks/reviews are complete; then close it with a concise preservation link, retaining its branch and commits. No merge or routine blind head replacement is authorized.
2. Inspect the target's **full migration names and actual schema before backend startup**, which automatically runs migrations. If any PR #60 `202610220041_maintenance_conversations` through `202610220045_rental_listing_intent` migration or corresponding schema has been applied, **stop before applying the current October 24 chain**. A reviewed reconciliation is required; no combined upgrade path was implemented or tested here.
3. Preserve PR #60's private preview and its data. Neither its preview nor a hosted database was restarted, migrated, reset or inspected for this comparison. Do not point the current branch at that database to discover compatibility.
4. Resolve the saved-renewal P2 while porting saved tasks; preserve per-draft availability, access boundaries, final submission identity and useful cleanup/recovery. Validate the unified schema/API/UI and migration path, browser/mobile/retry/revocation flows, both dependency lock trees, CI and all review findings before declaring the consolidation complete.

The pre-consolidation `b68416d` implementation separately passes **320/320 browser scenarios**, **56/56 real tenant recovery/privacy checks**, its client build/client 13 and recorded integration matrix. Those results do not validate PR #60's unique work or the in-progress consolidated branch. See the [role/workflow acceptance and release checklist](feature-acceptance-checklist-2026-10-24.md) for current evidence, configuration, remaining issues and required user acceptance. Only the requested consolidation is active; unrelated roadmap development remains paused. Neither draft publication nor later PR #60 closure authorizes merge, deployment, live migrations or customer actions.
