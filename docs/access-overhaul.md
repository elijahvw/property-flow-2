## Administrator setup workflow correction — 2026-10-14

The directory gap was structural: the deployed People & access page queried only local User rows, so Auth0 imports were invisible until callback-created accounts existed. The revised platform workflow explicitly separates the Auth0 sign-in directory from local application people. It can list/search exact email, import a selected identity or page (50 accounts), create an email/password account with a private random initial password, and select that account for company/role assignment before first login. Identities are keyed by issuer and exact subject, never merged by email; collisions return a reviewable conflict. Local grants/disabled state survive refresh and first callback. Auth0 roles/metadata do not grant company roles or platform privileges.

Company creation now opens a full profile form: required display name and timezone, optional legal name, primary contact, website, mailing address/country and internal notes. These fields are persisted and validated. Creation has durable per-admin UUID/fingerprint replay with atomic audit; profile edits and platform assignment edits check record versions. Company context carries into People & access and its invitation form. The company detail page shows current profile and owner setup. Internal notes and submission identities are never returned through member bootstrap or company-owner profile responses.

Normal operation after deployment:
1. Platform administrator creates/reviews a company profile (FAP is the user's Company A; preserve it).
2. From the company, choose Add existing person. Auth0 accounts load without target-user sign-in. Search an exact email if needed, add the intended identity, then save its company and role. Contact email does not grant access.
3. Alternatively, invite by email. A generated invitation link binds acceptance to that verified email and grants company membership only on acceptance. Links are copied explicitly; the app does not automatically send invitation emails.
4. Admin may explicitly request password setup or email verification from a selected account. Requests have cooldowns. Password setup requires the configured Auth0 database connection, not merely an auth0 subject prefix. Users choose their own passwords; generated initial passwords and provider tokens never reach the browser.
5. Unverified users can sign in, view/edit their profile, request/check verification and sign out. Protected workspaces remain blocked until verification. Refresh verification reads Auth0 and updates the local flag, avoiding a logout/login loop.
6. Owners use Team invitations and ownership transfer for ongoing management. Last-owner, single-company, suspension, revocation and resident-assignment safeguards remain enforced.

Deployment prerequisites: the backend must receive existing AUTH0_MANAGEMENT_CLIENT_ID / AUTH0_MANAGEMENT_CLIENT_SECRET from server-only Terraform variables. This branch adds those ECS environment bindings; use a reviewed Terraform plan/apply during the eventual approved deployment, not run_terraform=never. Verify the M2M application's Auth0 Management API authorization includes read:users, create:users and update:users, the database connection allows the Regular Web Application, and Auth0 verification/password-change email templates are enabled. AUTH0_DATABASE_CONNECTION defaults to Username-Password-Authentication; configure a different connection name server-side if applicable. Missing configuration/outages show an explicit directory error and preserve existing account management. Auth0 list/search is paginated and limited to its first 1,000 matches; exact email lookup is available beyond that listing. No production scopes, accounts or credentials were changed during development.

Sources: [Auth0 user administration/scopes](https://auth0.com/docs/manage-users/user-accounts/manage-users-using-the-management-api), [user search limits](https://auth0.com/docs/manage-users/user-search/user-search-query-syntax), [verification email API](https://auth0.com/docs/api/management/v2/jobs/post-verification-email).

Read-only development configuration audit: the GitHub management client ID matches Auth0's Property Flow 2 application. Its existing Management API client grant contains 251 permissions, including the required user scopes. The application now explicitly requests only read:users, create:users and update:users in each token request. Reducing the client's underlying grant needs a separate dependency review before changing live permissions. Public signup is disabled on Username-Password-Authentication; administrator-created users remain supported, and the Property Flow Overhaul Regular Web Application is enabled for that connection. Verification Email (Link) is enabled. The tenant currently uses Auth0's development/trial email provider, so real delivery still needs acceptance testing and production needs a suitable email provider. A legacy GitHub Actions repository variable named DATABASE_URL contains a plaintext credential; current workflow sources do not reference that variable. Do not copy or reuse its value. Confirm other consumers, coordinate credential rotation, and remove the obsolete variable as a separate configuration cleanup; neither credentials nor live settings were changed in this audit.

Known boundaries: one company membership per person, manual invitation-link sharing, no public signup change, no account linking by email, no platform-owner grant UI and no per-company feature entitlements/billing controls. No dummy feature toggles or inactive controls were added. Existing administrator recovery is an operator procedure for platform owners, not the normal user setup path. Real Auth0 mail delivery and the deployed administrator setup still require acceptance testing after merge and user-run deployment; local provider tests use simulated responses.

Verification: both builds, 48 local browser fixtures, 43 safe Node checks (5 database-suite skips in that pass), 14 new disposable PostgreSQL/API/browser account/company checks, full access lifecycle PostgreSQL suite, maintenance9, units/leases12 and finance8 all pass. Independent Bugbot review found one wrong-connection password setup issue; fixed and narrow re-review confirmed no residual issue. No live database, user, company, Auth0 settings or deployment was modified by this implementation.

# Access and navigation release

The server and CI use Node.js 22, matching the supported cookie/OIDC runtime.

This replaces browser bearer tokens and global Auth0 roles with a server session, a platform-owner role and one company membership per person. Auth0 remains the identity provider. The HTTP API independently authorizes every action; browser navigation uses capabilities returned by `/api/bootstrap`.

## Before release

- Auth0 Regular Web Application in the existing identity tenant. Enable the existing database/social connection used by the current account. Callback: `https://drfbeumseaytt.cloudfront.net/api/auth/callback`. Logout URL: `https://drfbeumseaytt.cloudfront.net`. Token endpoint authentication: client secret POST (Auth0 regular web application default).
- GitHub variable `AUTH0_WEB_CLIENT_ID`; GitHub secret `AUTH0_WEB_CLIENT_SECRET`. The frontend no longer needs Auth0 application credentials. Keep the existing Auth0 role Action active for the initial platform-owner upgrade; it must include the existing `admin` role in the ID token's `https://propertyflow.com/roles` claim.
- Deployment role needs `cloudfront:CreateFunction` on `*` (AWS does not support resource scoping for this creation action), and Describe/Get/Update/Publish/Delete on CloudFront function `arn:aws:cloudfront::800754316001:function/propertyflow-dev-routes`. Existing distribution update permission is also required. The extra function only rewrites frontend routes. API 401/403/404 responses remain JSON with their original status.
- Use the existing manual Deploy Dev workflow with infrastructure enabled and all components included. Do not deploy only the frontend for this cutover. Keep a pre-release RDS snapshot/restore point before applying the migrations.

## Data and transition

Migrations add identity, company membership, invitation, session, login-transaction and audit tables. Existing User, Company and Property records are retained. Legacy `User.role` and `User.companyId` remain as review evidence, not permission grants.

A prior explicit `admin` user becomes a platform owner only on the first successful new sign-in when Auth0 also supplies a freshly verified `admin` claim. A default `tenant` role never grants membership. After initialization, application roles are local and Auth0 claims cannot restore revoked privileges. Identities are matched by issuer and subject, never by email. Linking a second issuer to a stored identity is rejected.

After signing in, open People & access and explicitly review existing company assignments. Assign an initial company owner, manager, staff member or resident. Company owners can invite non-owner roles, update their team's access and transfer their ownership to another active member. Platform owners can invite an initial owner or explicitly transfer a person between companies. Company transfers do not retain the previous company assignment. Removing the last active owner is rejected.

## Sessions and request protection

Authorization Code with PKCE, state, nonce and the maintained OpenID client library validates sign-in. Login transactions are bound to a separate secure HttpOnly SameSite=Lax cookie, expire after ten minutes, and are atomically consumed. OAuth tokens are discarded after identity synchronization; they are never returned to the browser or stored in localStorage.

The application cookie is host-only, Secure, HttpOnly, SameSite=Strict. PostgreSQL stores a hash of the random session ID, not the cookie value. Sessions expire after 12 hours absolutely or two hours idle. Logout deletes the stored session. Mutations require the configured exact Origin and a session-bound CSRF token. Sign-in starts are rate limited per validated CloudFront viewer IP (IPv4 or IPv6) per application instance. CloudFront adds a generated secret origin header; production API requests reject direct ALB callers who could otherwise spoof viewer headers. Health/readiness probes remain accessible to the ALB. The API uses AWS managed CachingDisabled and AllViewerAndCloudFrontHeaders-2022-06 policies. Membership/account/company status is loaded on each protected request; sensitive transactions recheck access before writes.

`APP_ORIGIN` is fixed configuration, not inferred from request headers. Public home and static assets remain independent of profile loading. Direct links use the same route catalog as navigation. Unknown pages show a real not-found screen. Unavailable resident workflows do not show invented lease or payment facts.

## Database boundary

Terraform generates a distinct password for `propertyflow_runtime`. Existing startup migration execution uses the migration owner; the provisioning script activates the restricted runtime login after migrations. The HTTP process uses `RUNTIME_DATABASE_URL` and deletes `DATABASE_URL` from its own environment before loading application code. The runtime login is not a table owner, superuser, role creator, database creator or BYPASSRLS role. It cannot alter schema or delete/update audit events.

Property rows have forced row-level security. Each operation sets company context with transaction-local `set_config`; filters also include companyId. Context resets on commit and rollback, including pooled connections. Membership and invitation records are scoped by application authorization; they are not covered by property RLS. Session/identity lookup and platform administration require cross-company metadata access. This is defense against accidental unscoped property queries, not a claim that database credentials alone encode end-user authority.

Runtime and migration database TLS verify the AWS RDS certificate using the official AWS trust bundle. The container splits the RDS roots into individual OS trust-store certificates for the migration engine; the pg driver accepts the combined bundle. Update that bundle as AWS rotates authorities. CloudFront-to-ALB transport remains HTTP in this development infrastructure; a production release needs an HTTPS origin or an equivalent private encrypted origin connection.

The migration/provisioning process still has elevated credentials in its container environment; further deployment separation into a dedicated migration task is a production hardening item.

## Monitoring

Feature operations cover session restoration, account changes, membership/ownership changes, property creation and invitation workflows. Existing RUM-to-APM linking remains same-origin only. Browser view/resource URLs have query strings/fragments removed. Invitation secrets use a URL fragment, are removed before RUM starts, and live temporarily in tab-scoped sessionStorage until acceptance. Invitation-link inputs are hidden from replay. Server request logs exclude URL queries, cookies and authorization headers. Audit records persist independently of Datadog.

No new paid Auth0 or Datadog plan, Redis service, always-on compute instance, or scheduler is introduced. The existing manual start/stop controls remain. The CloudFront routing function has usage-based AWS charges; review actual usage against the existing budget.

## Verification and release acceptance

CI runs a disposable PostgreSQL 17 service. Tests cover fresh migrations, restricted runtime role privileges, cross-company reads/writes, transaction-pool isolation, suspended company access, ownership transfer, last-owner protection, membership transfer, forged/mismatched/unverified/expired/revoked/replayed invitations, disabled-membership re-invitation, session CSRF and logout, and safe redirects. Browser guard tests check direct URLs against navigation capabilities. Datadog JUnit report upload remains enabled.

After release:
1. Public homepage and direct `/platform/companies` route load. `/api/bootstrap` without a session returns 401 JSON and `/api/not-a-route` returns 404 (automated release smoke test).
2. Sign in with the existing admin. Confirm the platform workspace and audit record `platform.owner.upgraded`.
3. Refresh a protected page; it should restore through one application bootstrap request without an Auth0 iframe.
4. Review legacy assignments, invite a real company owner, and verify with separate test accounts that residents cannot open company properties or platform pages.
5. Inspect new Datadog traces/operations, and verify suspension and logout against live sessions.

Cloud Auth0 callbacks, live AWS IAM permissions, live migration execution and Datadog ingestion still require this deployment acceptance check; local tests do not prove them.

## Recovery

Take a database restore point before the coordinated release. The schema additions preserve old data but property RLS deliberately rejects unscoped queries. Reverting only the application image to the old admin-credential implementation is not a safe automatic rollback. Prefer a forward fix; a full rollback requires the pre-release database restore point and matching prior infrastructure/frontend/backend versions in a maintenance window. Never disable tenant protections as an ad hoc recovery step.

## UI follow-on

This release establishes consistent layouts, forms, visible focus states, semantic links, readable text, mobile navigation and explicit errors. Product-specific visual design, richer property detail/units/leases and resident workflows can now be designed around actual permissions and data. No placeholder financial or rental metrics are presented as real data.
