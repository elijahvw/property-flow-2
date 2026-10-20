> Status reconciled October 20, 2026: use [current platform status](mvp-status.md) and [the roadmap](product-roadmap.md) for delivery and remaining scope. Dated branch/release/test/limitation statements below are historical checkpoints, not the current deployment or acceptance state. No historical pass is promoted to real-account acceptance.

# Connected workspace — development UX overhaul

The user confirmed PR22/dev main9922af3 works but described the app as disconnected and clunky. Their concrete example was a prominent “Start a new lease” reset action above the save button. They requested modern workflows, easier navigation and a real dashboard. The implementation stays in dev; user approval is required before merge, and the user runs deployments.

## Research and decisions

Primary references reviewed October15,2026:

- [DoorLoop navigation, dashboard and drilldown guidance](https://support.doorloop.com/en/collections/3396106-how-to-use-doorloop): related tools grouped in navigation; portfolio/property filtering; overview widgets lead to underlying records. Applied as grouped navigation, property-context links and filtered dashboard destinations.
- [DoorLoop lease management](https://support.doorloop.com/en/collections/3376049-manage-your-leases): lease lifecycle and expiring-lease review are distinct workflows. Applied as clear draft/active/ended views and ending-soon/past-end review views, rather than an undifferentiated list.
- [Rentvine dashboards](https://www.rentvine.com/dashboards): daily operational overview and detailed reports serve different purposes; use drilldown to investigate. Applied as portfolio counts, attention queues, month-to-date recorded cash and source links. This app does not invent delinquency, payment collection or accounting widgets that its data model cannot support.
- [AppFolio owner portal guidance](https://www.appfolio.com/help/owner) and [owner experience](https://www.appfolio.com/articles/owner-experience): an owner needs connected property visibility and action items. Applied to our owner-operated-company direction; this does not introduce third-party-owner accounting.
- [Carbon form guidance](https://preview.carbondesignsystem.com/building-blocks/core/patterns/forms) and [modal guidelines](https://www.carbondesignsystem.com/building-blocks/core/components/modal/guidelines): distinguish the main completion action from secondary actions, put actions at the end, preserve keyboard/focus behavior, and keep long dialogs usable. Applied as a visible save footer, quiet confirmed draft discard, and focused native dialogs.

This adapts useful workflows to the functionality that exists. It does not copy another vendor's layout or claim feature parity, nor add decorative data, dead controls, fake charts, payment processing or trust accounting.

## Behavior

Owners/managers now land on Overview. Staff get a limited overview with only property/unit information; residents and platform-only users retain their own destinations. Sidebar links are grouped into Workspace, Operations, Money, Administration and Account. Mobile navigation is an explicit expandable Menu. Property search opens a focused dialog; Ctrl/Cmd+K supports keyboard access, and only authorized company properties are returned.

The overview endpoint computes full-company or selected-property counts under tenant RLS in one protected transaction. It returns property count, active-unit count, current active lease count, active units without a current lease, month-to-date recorded received/paid cash, open/in-progress maintenance and lease review counts. Current lease dates are inclusive in the company timezone. Cash uses exact PostgreSQL bigint sums, excludes voids and future received/paid dates, and links to the same dates/property in transaction history. Totals do not use a paginated list. The screen labels basis and generation time and refreshes on focus/visible timer. Errors remain unknown rather than turning into zeros.

Management capabilities are read again inside the protected database snapshot. A manager queued behind a downgrade to staff receives only staff-safe fields. The staff endpoint does not query or return management widgets. Platform authority alone does not grant company access.

Property tabs connect Property details, Units, Residents, Leases, Maintenance, Finances and Reports. Leases filter by property/status/attention **before pagination**, with foreign property validation. “In effect today”, “Ending within 30 days” and “Past end, still active” use the same company business-date rules as the dashboard. Maintenance supports an unresolved view including open and in-progress records. A property Residents page links assignments to actual contact profiles and reuses the existing audited assignment editor. Financial/report filters and transaction creation preserve the selected property. Context navigation browses records; only an explicit create action opens a new form.

The primary save/create action sits in a footer, with a quieter “Clear draft” action alongside it. Clearing requires an explicit discard choice and explains how to check a potentially interrupted save. No default reset action competes with saving. Busy dialogs disable all their form controls, including the property chooser. Existing submission identities remain stable through failure/dismissal. Switching between properties inside lease creation retains each visited draft/key until successful save or deliberate clear. Company/access changes discard stale drafts through scoped component identity.

No schema, Terraform or Auth0 configuration changes are needed. All existing authorization, optimistic editing, durable submission identity and audit protections remain.

## Acceptance in dev after an approved merge/deployment

1. Owner/manager lands on Overview; counts match source records, filters affect counts and links, unknown/error states are explicit. Staff cannot see finance, lease or resident-management widgets.
2. Open a property → Units → Residents → Leases → Finances → Reports; confirm property context and list filters stay aligned. Leases tab must browse, not automatically open creation.
3. Record a lease: the save action is prominent and fully visible on desktop/mobile. Clear draft is smaller, secondary and confirmed. A failed response can be retried after closing/reopening or browsing unit/property choices without duplicating a committed record.
4. Follow draft/ending-soon/past-end and unresolved maintenance actions; confirm the destination matches the dashboard question.
5. Try property search by name/address and keyboard; try mobile menu, dialog keyboard focus, pending-save controls and company/access changes.
6. Recheck owner/manager/resident end-to-end invitations, assignments and maintenance. Browser fixtures and disposable PostgreSQL provide automated evidence; real-account acceptance is still user-operated.

The deployed PR22/main9922af3 release was verified via Deploy Dev38699167822: backend/frontend/release-state jobs passed, Terraform apply skipped, and read-only public homepage/readiness/auth rejection/deep-link checks passed. No deployed records were changed while inspecting the lease UI.

## Local verification

Both builds passed. Browser fixtures: **67 passed**; safe Node checks: **46 passed** (34 server/12 client, five isolated DB suites skipped in that invocation). Disposable PostgreSQL/API/browser checks: overview/report/finance/property **19**, leasing **13**, maintenance **9**, identity/admin **21**, full authorization/migration **40**. This includes a deterministic queued manager-to-staff downgrade, full counts beyond a display page, cash/source reconciliation, before-pagination lease filtering and existing durable submission tests. Dashboard/lease forms were visually checked at desktop and390px mobile, and the primary save button is tested fully inside the viewport. Screenshots use isolated fixture records; the shipped screen reads real company data.
