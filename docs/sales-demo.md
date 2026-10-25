# Repeatable sales demo

PF-30, PR #61 follow-up. Additive migration `202610250054_sales_demo` follows the existing 041–053 chain. No infrastructure, activation variable, new secret or live provider operation is added. Merge/deployment and actual Auth0 acceptance remain user-controlled.

## Use

1. In platform **Users**, create or import a dedicated Auth0 account. Complete email verification. It must be active and have neither company membership nor platform authority. Existing customer assignments are rejected, never transferred.
2. Open platform **Companies → Manage sales demos**, choose that account and **Build sales demo**. Setup is atomic; a failed step or audit leaves no partial company, users or business records. If the response is lost, retry the unchanged form. Its durable submission key returns the existing generation.
3. Sign in as the selected sales account. **Oak & Elm · SALES DEMO** uses the normal owner workspace, company authorization and linked source/detail/history views. All fixtures are fictional. Supporting demo people have non-login identities and no passwords or sessions; the existing configured Auth0 issuer cannot authenticate them. No identity provisioning, email, bank, signature or screening provider is contacted during setup.
4. Return as platform owner and select **Tear down demo**, then **Confirm teardown**. This suspends that generation's company, revokes its members' sessions, disables supporting memberships and releases the presenter's membership. The Auth0 account is preserved for reuse. Rebuild by choosing it in a new setup. Replaying an old create cannot resurrect a retired generation, and replaying its teardown cannot affect a newer one.

Teardown is retirement, not physical erasure: immutable cash, documents, task drafts, source links and audit history remain in the suspended demo company. Suspended companies stop rent billing through the normal company-state fence. Platform company administration can still inspect retained history. The demo list shows the latest 50 generations, each fixture version and rebuild guidance when it is behind the current fixture.

## Fixture coverage (version 1)

| Area | Connected examples |
| --- | --- |
| Portfolio | Two properties, six detailed units, four tenants and active leases; two unoccupied units with separately reviewed ready/turnover states; explicit owner listing intent |
| Rent and cash | Three months of charges and manual receipts per active lease, current/partial/unpaid balances, parking charge, four refundable deposit accounts and linked cash receipts, future rent terms, upcoming recurring schedule and linked draft renewal |
| Maintenance | Three property work orders, a plumbing vendor linked to a request, paid repair expense reused by its cost link, selected-property technician, accepted/submitted/approved completion and immutable action history |
| Calendar and notices | Due preventive safety plan, dated work orders, real notification events/deliveries from the source actions, manager-submitted inspection review notification for the presenter |
| Leasing pipeline | Prospect attached to the ready unit, dated tour follow-up, manual application and a private saved lease task owned by the presenter |
| Documents and review | Move-in inspection and its submitted revision; unsigned agreement preparation linked to recorded leaseholder/company signers; actual private sample original in quarantine |
| Reports | Normal dashboards, statements, historical cash and usage derive from the same scoped source records |

Documents stay quarantined until the real scanner clears them. The agreement has no cleared file attached and cannot be submitted until management scans and selects the original; no signature is claimed. Supporting residents are fictional and cannot use the resident portal. Real portal delivery, electronic signatures, online payments, external notifications, provider integrations and platform pricing/billing are not fabricated. Import workflows are available against the dedicated company and do not need precommitted fake batches.

The factory uses an unbound internal Fastify application and an adapter bound to the outer Prisma transaction. There is no HTTP listener or authentication bypass in the served application. It runs the existing handlers and their validation, RLS and audits; only the fixture's supporting identity adapter is simulated. The provider cannot read or create arbitrary identities. Setup is bounded by a 60-second transaction and serializes with current administrator/account fences. A competing mutation may return 409; retry the same details.

## Maintenance and recovery

Every feature/schema/workflow change must review the fixture and this matrix, bump its version when content changes, and keep the lifecycle regression passing. Do not edit previously seeded history to upgrade a demo. Retire and create a fresh generation. Add representative linked records for newly delivered features; unavailable providers must remain honestly unavailable.

Setup/teardown emit fixed `sales_demo.create` / `sales_demo.teardown` browser outcomes and durations, standard bounded HTTP signals, and atomic `sales_demo.created` / `sales_demo.retired` audit events. No private contacts or fixture contents are metric labels. On failure, inspect the request ID and safe error code, fix the underlying schema/validation/permissions, then retry the original submission. Never grant runtime delete privileges or disable immutable-history triggers to reset fixtures.

Validation: both builds, the disposable lifecycle runner and focused draft-save/browser regression results are recorded in the PR follow-up release notes. These checks do not establish live provider, deployment or user acceptance.
