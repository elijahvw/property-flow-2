# TenantCloud workflow research

Reviewed 2026-10-15 using official product/support material. These are design references, not claims that Property Flow already supports those features. The current implementation remains owner/manager-first and does not copy TenantCloud's interface.

## Lease setup is an operating workflow

TenantCloud connects property/term, tenants, recurring rent, deposits/other transactions, payment setup and review before agreements. Property Flow currently has a simpler lease record and separate manual rent posting. Adopt a guided setup with an explicit review step and distinct billing schedule dates; preserve historical transactions when terms change. Do not introduce signatures or multi-party billing until their data/authorization models exist. [Create a lease](https://support.tenantcloud.com/en/articles/11942612-how-do-i-create-a-lease), [recurring charges](https://support.tenantcloud.com/en/articles/12313860-how-do-i-create-recurring-charges-to-my-tenants).

## Collections need visible terms and invoice history

TenantCloud separates grace settings from late-fee configuration and exposes lease terms to residents. Property Flow now adds explicit per-lease grace and charge snapshots, with current unpaid aging and follow-up links. Zero days preserves existing behavior; do not assume TenantCloud's product defaults are appropriate lease/legal terms. Automatic monetary penalties remain a separate future decision. [Grace periods](https://support.tenantcloud.com/en/articles/11908570-how-do-i-set-up-a-grace-period), [late fees](https://support.tenantcloud.com/en/articles/11909096-how-do-i-set-up-late-fees), [resident lease information](https://support.tenantcloud.com/en/articles/11932079-how-do-i-view-lease-information), [resident balances](https://support.tenantcloud.com/en/articles/11931729-how-much-do-i-owe-my-landlord).

## Property context should connect work

TenantCloud groups property information with tenants, accounting and maintenance. Its maintenance/calendar workflows add scheduling, tasks and follow-up. Property Flow already has property tabs; extend that context through billing, maintenance assignment, documents and inspections instead of introducing disconnected modules. A task must link to its source record and actual required action. [Getting started](https://support.tenantcloud.com/en/articles/11897075-let-s-get-started), [calendar items](https://support.tenantcloud.com/en/articles/11957847-how-do-i-view-calendar-items), [timeline](https://support.tenantcloud.com/en/articles/12891118-how-do-i-edit-the-timeline).

## Money categories and integrations need explicit semantics

TenantCloud treats deposits, credits, refunds and reconciliation as distinct accounting workflows. Its QuickBooks integration documents authorization, mapping and synchronization direction. Property Flow should establish these same kinds of controls before connecting providers. Start with reliable internal records and exports; define ownership, stable source IDs, error recovery and reconciliation for each integration. Stripe remains last. [Accounting workflows](https://support.tenantcloud.com/en/collections/14352971-accounting), [QuickBooks synchronization](https://support.tenantcloud.com/en/articles/11908588-how-do-i-synchronize-my-data-into-quickbooks), [product feature overview](https://www.tenantcloud.com/).

## Resulting priorities

The revised [product roadmap](product-roadmap.md) prioritizes recurring lease billing, deposits/move-out, maintenance operations, private documents, resident communications/tasks, deeper reporting, vacancy workflows and finally integrations/payment processing. Broad owner-investor accounting and marketplace functionality are deferred for this customer model. No provider was connected, no message sent and no live data changed for this research.
