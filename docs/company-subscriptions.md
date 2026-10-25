# PF-22 · Company features, usage and monthly billing

October 24, 2026: implemented and validated locally; review/release and real-account acceptance remain pending. The user selected monthly plans. This increment is unmerged and undeployed. PF-29 impersonation remains a separate local increment; neither feature changes live company settings or collects money during development.

## Connected workflow

1. A platform owner opens **Monthly plans** and publishes a plan name, USD monthly price and included implemented features. No production plan names, prices or charges are seeded. Publishing another revision retains the previous revision and its company assignments; archiving prevents new assignments while preserving existing subscriptions and history.
2. Open the actual company under **Companies**. Its existing profile editor still controls legal/contact/address details, timezone, suspension and internal notes. The connected plan controls assign a published revision, billing email and subscription state. Changes require the opening version, a reason and a durable submission key.
3. Review the company's effective feature modes. A company override can enable an area, make it read-only or disable it. Overrides require a reason; a supplied expiry makes them stop applying at that instant. The plan's inherited settings remain visible alongside the effective result.
4. Inspect **Usage** for successful feature-area requests over a selected UTC date range and separately labeled current resource counts. These analytics do not determine the flat monthly charge.
5. For an active assigned monthly plan, prepare the selected calendar month's invoice and due date. The review shows the exact plan revision/price, billed company, email and address before issue. First issue checks the reviewed subscription and company-profile versions; a changed source returns a recoverable conflict instead of silently using new terms. Trial and unavailable subscription states cannot be invoiced. Issuing does not send mail or initiate collection.
6. After money is actually received outside the app, record its exact amount, received date and evidence/reference against that invoice. Partial receipts reduce its balance; overpayment and competing stale submissions are rejected. The received date cannot be in the future in the company's timezone.
7. To correct a receipt, record a reasoned reversal. Reverse outstanding receipts before voiding an invoice. Voiding retains the original and allows an explicitly issued replacement for the same month. Neither correction moves money or creates a refund.
8. An active company owner opens **Plan & billing** to review their plan, effective features, usage and invoice/receipt history. Pricing, plan assignment, invoice issue and receipt correction remain platform-owner actions.

## Authority, sources and history

The billing customer is the company, regardless of how many users have the owner role. Sources are `PlatformPlan`, `CompanySubscription`, immutable `CompanySubscriptionRevision`, `CompanyFeatureUsage`, `SaaSInvoice`, `SaaSPayment`, `SaaSPaymentReversal`, `SaaSInvoiceEvent` and the existing company/account/access records. SaaS receivables never post to tenant rent, cash, deposits or lease balances.

Platform owners manage plan and company subscription metadata. Platform usage views expose aggregates without granting access to customer property, contact or financial details. Company owners receive only their own subscription/billing projection through fresh active-account, verification and membership checks. Active owners retain `subscription.read` for billing/usage recovery when the company is suspended; property operations remain blocked. Managers, company staff, residents and support-only platform accounts receive no billing authority. Impersonation remains read-only and does not create customer usage.

Plan prices and included-feature revisions are retained. Issued invoices keep the billing name/address/email, plan name/version, price and calendar-period snapshot even after later settings edits. Exact integer cents, company write fences, reviewed subscription/company versions at first issue, invoice versions, per-company submission receipts, one issued invoice per company/month and atomic audit events protect retries and competing changes. A committed original payload remains replayable after later source changes; stale-review checks do not turn a successful prior issue into an uncertain duplicate. Runtime grants prevent rewriting retained invoice snapshots, receipts, reversals and history. Financial corrections add evidence instead of deleting it.

## Feature and lifecycle behavior

The catalog contains implemented areas only: properties/units, leasing/tenants, maintenance, private documents, rent/finances, reports, inspections, agreement preparation, in-app notifications and the resident portal. A feature does not grant a role, property assignment, lease participation or access to another company.

| Setting | Result |
| --- | --- |
| No subscription or no assigned plan | Existing implemented access remains enabled, subject to normal roles and any explicit company overrides. No invoice is created automatically. |
| Active subscription or unexpired trial | Included plan areas are enabled; omitted areas are disabled. Current valid overrides apply. |
| Read-only area | Authorized history can be read; changes in that area are rejected by the server. |
| Disabled area | The area is unavailable through navigation and direct APIs. Existing source records remain retained. |
| Expired trial, expired/suspended/cancelled subscription | Otherwise enabled areas become read-only; disabled areas remain disabled. Overrides cannot restore lifecycle-blocked writes. |
| Company suspension | Existing company-operation restrictions apply independently of subscription state. The active owner's billing recovery view remains available. |

Each protected operational request loads current company policy. Transactional checks cover consequential changes and nested dependencies, including private-document, inspection and agreement paths. Background recurring rent generation requires enabled leasing and finances; unavailable access does not keep creating hidden rent records. Notification publication is skipped when its feature is unavailable without rolling back an otherwise permitted source change. Disabled financial projections are omitted from mixed operational summaries.

Subscription states are explicit operator settings. There is no automatic delinquency suspension, deletion, calendar renewal, invoice cron, price migration or payment collection in this increment. Restoring access requires an authorized reviewed change; source records and prior invoices survive it.

## Usage definitions

Activity is the count of successful authenticated operational API requests by the route's primary feature area and UTC day. Reads and writes are separate; nested dependencies do not multiply a request across areas. Failed requests, administration, billing/usage views, bootstrap, telemetry and impersonated sessions are excluded. Repeated reads and retries count again. Counters are best-effort product analytics: a counter failure cannot turn a completed business action into a failure or trigger a retry. Activity begins after activation with no historical backfill; the first recorded daily bucket is not an exact deployment timestamp.

Date filtering applies to request activity. Resource figures are a current snapshot: all retained properties; currently active units; currently active leases, excluding drafts/ended leases; active memberships with active accounts; and every retained document version and its stored bytes, including quarantined versions and versions of archived documents. These aggregates use explicit company context under existing RLS. They are not historical portfolio snapshots or metered invoice quantities. The monthly invoice uses only the assigned plan's flat price.

## Operating and recovery notes

| Situation | Action |
| --- | --- |
| No plans or no assigned plan | Publish the intended price/features, then assign a revision. Empty setup does not imply a free paid plan or a customer charge. |
| Feature unavailable or read-only | Review plan inclusion, current overrides, their deadline, subscription/trial state and company suspension separately. Role/property/lease restrictions still apply after restoration. |
| Settings or invoice changed during review | Keep the failed draft, load the current version and explicitly reopen/review before submitting again. First invoice issue checks both the reviewed subscription and company-profile versions and returns 409 if either changed. |
| A response is lost after issue/payment/correction | Retry the original durable submission and payload or reload the source/history to reconcile. Do not create another receipt merely because its response was interrupted. |
| Month already invoiced | Review that issued invoice. Correct receipts and void it before issuing a replacement; retain the original evidence. |
| Outstanding amount differs from a bank statement | Inspect original receipts and reversals. Recording is manual evidence, not bank reconciliation or confirmed provider settlement. |
| Usage is empty | Check the selected UTC period and whether real operational activity has occurred since activation. Do not infer zero historical usage. |
| Usage counter fails | Check the bounded `COMPANY_USAGE_RECORD_FAILED` log and existing API/database signals; business records remain authoritative. |

Bounded browser operations cover plan publication, subscription updates, invoice issue/void and receipt record/reversal. Request counters, operational telemetry and immutable business audit serve different purposes. Plan reasons, billing/contact fields and payment references do not become telemetry labels.

## Release, validation and remaining scope

Release requires additive migration `202610240042_company_subscriptions` after migration041 and matching server/client versions. It adds the subscription/plan, usage and separate SaaS invoice/receipt/history tables with scoped relations, constraints and immutable runtime grants. No cloud resource, always-on job, activation variable, Auth0 setting or payment-provider configuration is added. Preserve development Start/Stop controls and data/restore points. Review/merge, cloud migration/deployment and real-account acceptance remain separate user-controlled steps.

Local validation on October 24, 2026:

- The full server build and subsequent TypeScript check pass; the latest client production build passes.
- The final safe server unit run reports 101 tests: 94 pass and seven database suites are intentionally skipped without integration database variables. All 11 client unit test files pass.
- The dedicated `node scripts/test-company-billing.mjs` runner passes 15/15 checks against fresh migrations through042 and the restricted runtime role. Existing impersonation regression coverage passes 14/14.
- Two review findings were corrected and narrowly re-reviewed without residual findings. First-issue preparation shows the intended price and recipient, rejects stale subscription/company versions and retains committed original-submission replay.
- All six focused browser scenarios pass using the latest stable source and system Chromium: plan publication/archive and draft preservation; interrupted receipt response with exact retry/reversal/void and scoped private printing; company-owner mobile usage/invoices; stale-price conflict and discard/reprepare; tenant history with finances disabled; and disabled lease panels without invented financial states.

Tests use isolated fixtures and newly created disposable databases, not preview/customer data. These checks do not establish deployment, email delivery, collection or real-account acceptance.

After authorized release, accept the actual owner/admin workflow end to end: publish/assign a plan, review existing company settings, test role/area and nested direct-route boundaries, observe real usage, expire/restore access, issue/retry an invoice, record/correct a received payment, void/reissue and confirm the company's own recovery/history views. Verify mobile/keyboard operation and monitoring with the real release.

Remaining PF-22 scope includes explicitly designed quotas/limits and downgrade handling, automated renewal/invoice generation, self-service plan changes, billing exports/retention policy and complete operational acceptance. Tax calculation, proration, discounts and metered charging are not implemented. Hosted collection, payment methods/consent, provider settlement/refunds/disputes, signed deduplicated webhooks and reconciliation remain PF-26; tenant rent/deposit collection is a separate workflow. No provider action or actual charge is implied by monthly-plan setup.
