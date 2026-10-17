# Jira work tracking

Established October 17, 2026. Jira is the actionable development/status tracker; the repository roadmap remains the product/evidence register. The Atlassian connector can now read and update the dedicated project.

## Start here

- [Development overview — PF-43](https://property-flow-dev.atlassian.net/browse/PF-43): dated current position, live issue views, current release, next work and evidence links.
- [Kanban board](https://property-flow-dev.atlassian.net/jira/software/projects/PF/boards/3), [timeline](https://property-flow-dev.atlassian.net/jira/software/projects/PF/boards/3/timeline), [list](https://property-flow-dev.atlassian.net/jira/software/projects/PF/list) and [summary](https://property-flow-dev.atlassian.net/jira/software/projects/PF/summary).
- Project **Property Flow**, key **PF**, ID `10002`, board `3`, site `property-flow-dev.atlassian.net`.
- [Issue identity map](jira-issue-map.json) preserves all 27 roadmap epics and the focused work tickets. Padded roadmap IDs such as **PF-01** are planning references; **PF-1** is the actual Jira key. Never assume a new planning ID equals a Jira key.

## Current records

The initial backfill contains 43 issues: 27 epics, four stories, one bug and eleven tasks. Epics retain implemented baseline, remaining scope, source documentation and role/workflow acceptance criteria. No historical acceptance, dates, estimates or assignees were invented.

- [PF-30](https://property-flow-dev.atlassian.net/browse/PF-30) tracks [PR #40](https://github.com/elijahvw/property-flow-2/pull/40), exact-head review/CI, migrations 026–028, user-controlled release and subsequent acceptance. [PF-28](https://property-flow-dev.atlassian.net/browse/PF-28) and [PF-29](https://property-flow-dev.atlassian.net/browse/PF-29) cover directory and maintenance review/acceptance. [PF-42](https://property-flow-dev.atlassian.net/browse/PF-42) records the property-scoped maintenance review fix.
- Unreleased version `10000`, **Core workflows and safe RUM — PR 40**, groups PF-28/29/30/31/42. It has a native GitHub PR related-work link. An unreleased version records scope; it authorizes no deployment.
- [PF-31–37](https://property-flow-dev.atlassian.net/browse/PF-27) break out actual RUM ingestion, AWS coverage, synthetics, runtime/pool pressure, durable business/dependency failures, recovery/alert acceptance and telemetry health/cost. Existing dashboard/alerts/email test evidence remains distinct from these gaps.
- [PF-38](https://property-flow-dev.atlassian.net/browse/PF-38) property capabilities blocks [PF-39](https://property-flow-dev.atlassian.net/browse/PF-39) delegated maintenance. PF-15 private documents blocks PF-16 inspections and PF-17 agreements. PR review/acceptance work blocks the PF-30 release gate; PF-30 blocks actual RUM ingestion acceptance.
- [PF-40](https://property-flow-dev.atlassian.net/browse/PF-40) records outstanding real-account acceptance of merged PF-01–10. [PF-41](https://property-flow-dev.atlassian.net/browse/PF-41) records this tracking setup.

## Workflow

Use **To Do → In Progress → In Review → Done**. To Do means planned/not begun. In Progress means active implementation, partially implemented epic scope or an explicitly continuous standard. In Review means implementation review or outstanding acceptance; the labels and description identify which. Done means the specific ticket's acceptance is evidenced, never automatically merged/deployed/accepted application scope.

Use labels such as `implementation-merged`, `implementation-pr`, `acceptance-pending`, `release-pending`, `pr-40`, `monitoring`, `next-product` and stable roadmap references. Prioritize actual blockers/current work. Keep future work unassigned until ownership is decided; do not invent deadlines or story points. Use native **Blocks** for real prerequisites and **Relates** for contextual relationships; hierarchy belongs in the parent field.

The project provides Kanban, timeline, list, summary and reports. PF-43 has live JQL links for active work, roadmap, open bugs, PR scope, acceptance, monitoring and next product work. These use actual Jira status rather than copied percentage-complete claims. Native web links connect Jira to PRs, CI, contracts, release evidence and Grafana.

## GitHub and milestone updates

Native GitHub app setup was in progress in the user's Jira browser during setup; its completed authorization and repository sync are not yet verified. Direct native web links work independently. Until integration is verified, zero PR/deployment counts in Jira's Development panel are not evidence of no work. No unattended/background synchronization is promised.

1. At the start of a bounded increment, resolve its existing issue/epic and search for duplicates. Add a Story, Task or Bug only for distinct actionable work, with outcome, source, role/privacy boundaries, acceptance and dependencies.
2. Move only active implementation into In Progress. Include its Jira key in the branch where practical and in commits/PR title or body. Keep the original roadmap ID in the issue.
3. At implementation/review milestones, record what changed, exact commit/PR, meaningful checks, migration/activation requirements, material limitations and next action. Link actual evidence with native web links, checking for an existing URL first.
4. Keep review/merge, deployment and real workflow acceptance separately evidenced. Update the unreleased version only after verified release; preserve deployment/environment/commit evidence. Never mark all feature scope Done from a passing test.
5. Update PF-43 when current release, blockers or next workflow changes. Update the roadmap and identity map for new outcomes/keys. Batch concise updates at meaningful milestones instead of rereading/rewriting the whole backlog each turn.
6. Record newly discovered bugs and operational gaps, linking their source and blocking relation when relevant. Report any failed remote update honestly and retain a concrete next action.

Never store credentials, tokens, private preview dumps or customer records in Jira. Preserve preview data and the open browser. The user handles merge/deploy; no Terraform apply, provider activation or paid upgrade follows from tracking setup.
