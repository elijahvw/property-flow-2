# Personal profiles, company details and role clarity

Implemented in the local PF-07 review batch on October 16, 2026. The user confirmed on October 16, 2026 that Staff keeps read-only property access; no broader operational permissions are authorized.

## Personal profile

Every signed-in user has a personal profile. Short section forms separate personal names, phone/contact preference, mailing address, emergency contact and read-only access context. The review lists only changed fields. Other sections are retained when saving one section, and interrupted reviewed saves keep their durable UUID for retry. Email verification changes invalidate cached profile resources even if other grants remain unchanged.

Account display-name changes from My profile and platform Users first update the exact Auth0 subject, then the local mirror under fresh authorization/version checks. Provider rejection cannot report local success. Later callbacks refresh the account name from Auth0. Display/preferred name is personal account information. Current tenant-name edits also update that person’s Auth0 account when it is unassigned or an active resident of the same company; transferred/historical records and platform administrator accounts confer no account-edit authority. Management names and contact emails remain distinct business records, and self edits do not rewrite legal/lease snapshots. Sign-in email stays with the identity provider. Mailing details never become a unit assignment.

An active, verified resident with an active company membership and linked active tenant contact shares safe contact, mailing and emergency fields with that contact. Updates preserve the tenant name, management notes, company, status, assigned property/unit, lease terms and access. The compatibility membership fields are updated under the same user/contact fences, without overwriting curated legal/contact identity. Concurrent owner contact edits invalidate a stale self edit. Unverified, inactive, unlinked or archived contact contexts do not gain business-record editing authority through the profile.

The API strictly rejects assignment, household approval, company, role, status, email, user-selector and internal-note fields. Resident current/upcoming homes are read-only, scoped to current property assignment and an unremoved, unexpired household relationship. The owner profile uses **Company & access**, identifies **Company owner**, and links to company/team administration. Resident **Home & access** guidance is not shown to owners.

`202610160022_account_profiles` adds versioned personal details and immutable private revisions. Forced RLS uses the transaction-local authenticated `app.user_id`, independently of company RLS. Profile versions and the user display-name timestamp fence stale edits; current company/contact versions fence sharing. A matching immutable revision is required at commit. Display-name snapshots are retained with the safe personal details. Profile and linked management-contact audits roll back with failed writes. The previous name-only request remains compatible and cannot expand its allowed fields.

## Company settings

Company owners can maintain company/legal business names, primary business contact, email, phone, website, a grouped mailing address and company timezone. Section navigation separates Business, Contacts, Address, Preferences, History and Roles. Edit forms and reviews show the current section and changed fields instead of one long form. Addresses display street lines above city/state/postal code.

Company status, domain, platform notes and membership controls are excluded from the company-owner profile write surface. Country codes, contact email, website protocols and IANA timezones are validated by the existing company profile parser. A timezone change is called out at review because it changes the current company business date. Saved source dates do not change.

Company version checks cover both owner and platform edits. Durable retries return the committed version without overwriting subsequent changes. `202610160023_company_profile_history` stores immutable, company-scoped before/after snapshots and actor identities for full profile saves through the owner settings workflow. History excludes platform notes and is paged. Existing platform-administration changes continue to have their own audits; this does not fabricate retroactive profile-history entries.

## Roles and permissions

The Roles screen is generated from the server grants used by permission checks. The company owner can also reach it from Team and their personal access section. Company and platform ownership are distinct.

- **Platform owner:** company/user administration. Platform authority alone grants no customer operating-data access.
- **Company owner:** company settings, team/company access, resident approvals and operating records in their company.
- **Manager:** properties/units, tenant contact profiles and property assignments, leases/renewals, maintenance, rent/deposits/reports/settlements. Company settings, team role/membership changes and resident approval/invitation management remain owner-only.
- **Staff:** read-only property access, explicitly confirmed by the user. No property editing, maintenance operations, financial records, lease management or company/access administration.
- **Resident:** personal self-service and authorized rental information. Approved leaseholders can see shared lease finances and request resident invitations for owner approval. Occupants receive no financial authority. All additions/removals/approvals stay under management controls.

Protected company operations require current active/verified account and active company membership/company status. Resident financial views additionally require current property assignment and the effective approved leaseholder relationship. Every role can maintain its own safe personal details; no role is granted a new unit-assignment control through the profile endpoint.

Validation includes forged resident assignment/role/email/note fields, stale contact/profile/company contexts, RLS and immutable revisions, private-note omission, unchanged recorded tenant identity and lease unit, audit rollback, company-owner-only editing, attributed company history, durable retry after response loss, role-specific wording and desktop/mobile layout.
