> Status reconciled October 20, 2026: use [current platform status](mvp-status.md) and [the roadmap](product-roadmap.md) for delivery and remaining scope. Dated branch/release/test/limitation statements below are historical checkpoints, not the current deployment or acceptance state. No historical pass is promoted to real-account acceptance.

# Workflow research and Property Flow gaps

Reviewed 2026-10-15 against main `e94fe86`. Deliverables: [roadmap](product-roadmap.md), [implementation backlog](product-backlog.md).

## Evidence and boundary

The previous chat inspected visible TenantCloud trial screens and saved a labeled sample property and offline tenant contact with the user's permission. It inspected lease steps without finalizing a lease. These observations were partial, not an end-to-end or role-by-role trial audit.

Further trial automation stopped after reviewing TenantCloud's [terms](https://www.tenantcloud.com/terms), which restrict automated retrieval and deriving service specifications for competitive purposes. This continuation used public product/help material and our repository only. It did not inspect competitor source code or resume trial automation. Requirements below are our recommendations, not copies of UI layouts, text, provider contracts or backend mechanisms.

App findings were checked against source on main. The prior chat inspected live Property Flow pages; this continuation did not repeat authenticated acceptance. “Implemented” means in the repository, not accepted by real users. No new account/provider/shared-database/deployment changes occurred in this review.

## People and portal access

TenantCloud's public guide distinguishes manually recorded contacts from online connections and links profiles to leases/transactions. This supports treating the contact book and portal access as separate customer needs. [Getting started](https://support.tenantcloud.com/en/articles/11897075-let-s-get-started).

Property Flow stores resident contact fields on CompanyMembership and requires Lease.residentId to reference User. The directory asks the owner to invite a tenant and wait for acceptance. The editor shows contact/access/assignments/activity rather than connected lease/financial work. Evidence: [schema](../server/prisma/schema.prisma), [profile API](../server/src/resident-profiles.ts), [tenant page](../client/src/pages/ResidentProfiles.tsx).

Recommendation: PF-01/PF-03, a company-owned contact with optional verified portal link and stable detail workspace. Preserve source IDs/history, explicitly handle current single-company membership constraints, and avoid requiring login provisioning to record offline business history.

## Leasing and households

TenantCloud documents setup connecting property/term, participants, recurring rent, deposits/other transactions and review. It also describes joint versus individually billed participants. A multi-person lease requires responsibility rules, not just another contact picker. [Lease setup](https://support.tenantcloud.com/en/articles/11942612-how-do-i-create-a-lease).

Property Flow has reviewed setup, linked renewal drafts, grace terms, recurring schedules/recovery and one required resident per lease. There is no individual lease detail route: Rent's “Lease details” link resolves to a property lease directory. Evidence: [lease UI](../client/src/pages/Leasing.tsx), [rent UI](../client/src/pages/Rent.tsx), [lease API](../server/src/leasing.ts), [routes](../client/src/App.tsx).

Recommendation: PF-02/PF-08–PF-11. Connect existing records, then add future-effective terms, reviewed proration/transition and household responsibility. Preserve historical charges and overlap protections. Do not use deletion/recreation as a financial correction path.

## Collections and statements

TenantCloud documents grace independently of late fees and a filtered/exportable tenant statement combining obligations and money activity. [Grace](https://support.tenantcloud.com/en/articles/11908570-how-do-i-set-up-a-grace-period), [late fees](https://support.tenantcloud.com/en/articles/11909096-how-do-i-set-up-late-fees), [tenant statement](https://support.tenantcloud.com/en/articles/11957930-tenant-statement).

Property Flow already has due/grace, current unpaid aging, paid-late history and opt-in recurring posting. Receipts/allocations/unapplied receipt credit exist. A complete statement and general non-rent charge/noncash concession/refund lifecycle remain gaps. Evidence: [rent](../server/src/rent.ts), [collections](../server/src/rent-collections.ts), [schedules](../server/src/rent-schedules.ts), [reports](../server/src/reports.ts).

Recommendation: PF-04/PF-05/PF-20. Make recorded money understandable before expanding automation. Distinguish paid-late history, present debt, received cash and noncash credit. Add manual categories/reversal contracts before automatic penalties or collection providers. This establishes no legal/default fee policy.

## Deposits and move-out

TenantCloud documents partial/full deposit returns, separates recording a return from initiating payment, and connects disposition to lease ending. The customer needs are a traceable remaining-held amount and reviewable closeout. [Deposit return](https://support.tenantcloud.com/en/articles/11955779-how-do-i-return-a-deposit), [lease ending](https://support.tenantcloud.com/en/articles/11942679-how-do-i-end-a-lease).

Property Flow now has refundable requirements/revisions/receipts, held/uncollected/excess balances, linked deposit cash sources and correction voids. The old roadmap understated completed scope. Actual return/application/itemized settlement remain absent. Evidence: [deposit contract](security-deposits.md), [deposit API](../server/src/deposits.ts), [cash report](../server/src/reports.ts).

Recommendation: PF-06/PF-07/PF-10. A return records outflow; application reduces liability and named debt without inventing cash. A correction is neither. Retain unpaid debt after lease ending and link every settlement amount to its source.

## Maintenance and delegated work

TenantCloud describes assignment/reassignment, recurring requests, calendar follow-up and separate functional/property team authority. [Maintenance](https://support.tenantcloud.com/en/collections/14353031-maintenance-requests), [reassignment](https://support.tenantcloud.com/en/articles/11957905-can-i-re-assign-the-maintenance-request-to-another-servicepro), [team property access](https://support.tenantcloud.com/en/articles/11909040-how-do-i-assign-unassign-a-team-member-to-from-the-property), [calendar](https://support.tenantcloud.com/en/articles/11957847-how-do-i-view-calendar-items).

Property Flow currently supports tenant submission with priority and owner/manager status updates. MaintenanceRequest lacks assignee/vendor/target-date/history relations; staff only have property.read. Managers have company-wide authority rather than configurable assigned-property scope. Evidence: [grants](../server/src/access.ts), [maintenance](../server/src/maintenance.ts), [schema](../server/prisma/schema.prisma).

Recommendation: PF-12–PF-14. Add enforced delegation and work-order details together. Staff perform assigned work without financial/team authority; vendor contacts precede vendor portals. Link costs to existing expenses once. Separate internal notes from tenant-visible updates. Staff need useful assignment/scope capabilities in shared workflows, not a duplicate product.

## Documents, inspections and tenant service

TenantCloud's inspection workflow links dated condition evidence and move-in/out comparison. Its catalogue includes signatures/documents, tenant service, communications, applications and availability. This identifies product families, not proof of every advertised workflow in the trial. [Inspections](https://support.tenantcloud.com/en/articles/11934038-move-in-move-out-inspections), [catalogue](https://www.tenantcloud.com/pricing), [tenant lease view](https://support.tenantcloud.com/en/articles/11932079-how-do-i-view-lease-information).

Property Flow has rent/deposit/maintenance self-service but lacks a private document/inspection/signature system, conversation/outbox system and application/prospect pipeline in the current schema/routes. Recommendation: PF-15–PF-19/PF-21. Ship tenant changes with their source features. Private storage precedes shared attachments/signing; reviewed delivery precedes external reminders. Manually entered evidence never masquerades as provider verification.

## Platform plans and integrations

TenantCloud publishes tiers, feature/usage limits and subscription-management workflows. These suggest visible entitlements, usage and lifecycle controls. Its landlord/property-manager model is not our platform-owner role. Public pages contain differing price/discount presentations; this review does not choose our prices from them. [Plans/features](https://www.tenantcloud.com/pricing), [plan management](https://support.tenantcloud.com/en/articles/11901594-how-do-i-upgrade-my-plan), [pause/cancel](https://support.tenantcloud.com/en/articles/11901338-how-do-i-cancel-or-pause-my-subscription-plan).

Our company administration manages profile/access/status but has no subscription/plan models. Recommendation: PF-22 manual versioned plans/entitlements first; collection later. Define expiry/downgrade/automation/data-retention behavior ourselves. Platform owner is the SaaS operator; company owner is the customer; tenant owes the company under a lease. Do not inherit competitor cancellation or background-billing behavior.

TenantCloud describes QuickBooks authorization, mapping and one-way sync. That reinforces explicit ownership/recovery rather than adding switches. [QuickBooks](https://support.tenantcloud.com/en/articles/11908588-how-do-i-synchronize-my-data-into-quickbooks). PF-25/PF-26 begin with source identity/reconciliation and sandbox behavior. Subscription charges and tenant rent collection are separate last-stage scopes.

## Original UI and performance recommendations

These derive from our source and previously observed workflow friction, not copied screen designs:

- Stable tenant/lease/work-order pages, focused editing dialogs, property context and return paths: PF-01/PF-02/PF-13/PF-23.
- Connected money summaries with named obligations, credit, deposits and source drilldowns: PF-04–PF-07.
- Consistent primary/next action, review/save feedback, safe draft recovery and mobile accessibility, reusing existing dialogs/workspaces: PF-23.
- Pagination/server filtering for resident/maintenance directories, with complete totals independent of displayed pages: PF-24. Their current list APIs fetch every matching row; reports/deposits already enforce explicit completeness bounds.
- Investigate duplicate property/context loads across components without weakening identity/authority-scoped invalidation: [resource hook](../client/src/useResource.ts), [property navigation](../client/src/components/PropertyNavigation.tsx). This is a candidate optimization, not a measured performance diagnosis.

The first two increments improve connected work using existing data. Contact migration, financial movement types and team scope each require bounded designs/regressions. Feature coverage, usability and correctness advance together; a full-app rewrite is not required to start.
