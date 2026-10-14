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

The application cookie is host-only, Secure, HttpOnly, SameSite=Strict. PostgreSQL stores a hash of the random session ID, not the cookie value. Sessions expire after 12 hours absolutely or two hours idle. Logout deletes the stored session. Mutations require the configured exact Origin and a session-bound CSRF token. Sign-in starts are rate limited per application instance. Membership/account/company status is loaded on each protected request; sensitive transactions recheck access before writes.

`APP_ORIGIN` is fixed configuration, not inferred from request headers. Public home and static assets remain independent of profile loading. Direct links use the same route catalog as navigation. Unknown pages show a real not-found screen. Unavailable resident workflows do not show invented lease or payment facts.

## Database boundary

Terraform generates a distinct password for `propertyflow_runtime`. Existing startup migration execution uses the migration owner; the provisioning script activates the restricted runtime login after migrations. The HTTP process uses `RUNTIME_DATABASE_URL` and deletes `DATABASE_URL` from its own environment before loading application code. The runtime login is not a table owner, superuser, role creator, database creator or BYPASSRLS role. It cannot alter schema or delete/update audit events.

Property rows have forced row-level security. Each operation sets company context with transaction-local `set_config`; filters also include companyId. Context resets on commit and rollback, including pooled connections. Membership and invitation records are scoped by application authorization; they are not covered by property RLS. Session/identity lookup and platform administration require cross-company metadata access. This is defense against accidental unscoped property queries, not a claim that database credentials alone encode end-user authority.

Runtime and migration database TLS verify the AWS RDS certificate using the bundled official AWS trust bundle. Update that bundle as AWS rotates authorities. The migration/provisioning process still has elevated credentials in its container environment; further deployment separation into a dedicated migration task is a production hardening item.

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
