# Auth0 sign-in and account setup

Prepared locally October 17, 2026. The user chose the existing Auth0-hosted Universal Login features and declined a paid Auth0 custom login domain. These are proposed provider settings; no live setting is applied by the app deployment or by this document.

## Existing-feature login settings

Use New Universal Login with the existing Auth0 tenant hostname. Keep Classic custom HTML, embedded credential forms and custom page templates disabled. Passwords remain entirely with Auth0. The versioned design values are in `config/auth0/sign-in.json`; that file is a review/configuration reference, not an automatically applied provider resource.

In **Branding → Universal Login**, use the Property Flow name, primary color `#176e59` and page background `#f5f7f8`. The repository includes `/property-flow-mark.svg`; deploy and verify that public asset before setting its HTTPS URL as the company logo. Use **Edit text and translations** for the login and password-reset text from the configuration reference. Keep other languages/screens intact. This needs no custom Auth0 domain.

For database sign-in, **Authentication → Authentication Profile → Identifier + Password** shows email and password together. Review current enterprise discovery and biometric/passkey usage before changing this tenant-wide setting. Do not turn off MFA, passkeys, enabled identity providers, attack protection or verification to remove steps. Existing SSO is already reused by the application; it does not force a fresh password prompt on every navigation.

In the web application's settings, **Application Login URI** must point to the server's `/api/auth/login` route. That route starts the normal OIDC state/nonce/PKCE transaction and redirects to the configured Auth0 `/authorize` endpoint. It is different from the callback URI.

On October 17, read-only checks found correct DNS and an issued/attached ACM certificate, but CloudFront distribution E3S4MA6ULWWKE6 had no alternate domain name. The user added the hostname. Fresh AWS/public verification confirmed Deployed, one alias and a valid HTTPS homepage (HTTP 200). The login route returns 302, but the deployed backend still uses the old CloudFront callback. Keep this temporary Application Login URI until the backend APP_ORIGIN and Auth0 callback allowlist are aligned:

```text
https://drfbeumseaytt.cloudfront.net/api/auth/login
```

That route returned HTTP 302 to the existing Auth0 tenant with the CloudFront callback. When custom-domain HTTPS is working and its backend origin/callback allowlist is deployed together, switch the setting to:

```text
https://propertyflow.saasapps.cloud/api/auth/login
```

An application website hostname does not require a paid Auth0 login hostname. Keep callback/logout/origin values aligned with the deployed backend; see [the domain procedure in PR #43](https://github.com/elijahvw/property-flow-2/pull/43). Do not replace the callback with the login URI. This application's invitations use its own stored token and approval workflow, not Auth0 Organizations invitations.

## Shorter onboarding and password recovery

An authorized manager/owner creates or reuses the person's Auth0 identity before saving a new tenant or lease participant. The recipient never creates a second account during setup. The private onboarding page sends one password setup email for database accounts. Auth0 password completion also verifies the email, avoiding a second verification email. The recipient then signs in and reviews the owner-approved access. Existing social/enterprise users keep their existing provider; Property Flow does not manufacture a database identity for them.

Company owners can request a reset from tenant details and platform owners from Users. Only a reset email is requested; administrators never see or choose a password. The target is the exact stored identity's current provider email. Normal account display-name changes in platform Users, My profile and the current tenant editor update Auth0 first and refresh the local mirror; transferred/historical contacts do not confer account-edit authority and business tenant names and lease snapshots remain separate records.

## Activation evidence

After an authorized configuration change, check the real login screen at desktop/mobile widths, combined database login where compatible, existing social/SSO/MFA paths, expired/used reset links, one delivered setup email, return-to-login after reset, verified first callback using the existing account, and the original invitation returning for acceptance. Keep credentials, reset links and private invitation tokens out of screenshots/logs. Local tests simulate provider requests; they cannot prove live email delivery or the provider dashboard's current settings.

References: [default login routes](https://auth0.com/docs/authenticate/login/auth0-universal-login/configure-default-login-routes), [authentication profiles](https://auth0.com/docs/authenticate/login/auth0-universal-login/identifier-first), [Universal Login](https://auth0.com/docs/authenticate/login/auth0-universal-login/universal-login-vs-classic-login/universal-experience), [text customization](https://auth0.com/docs/customize/login-pages/universal-login/customize-text-elements), [password reset verifies email](https://support.auth0.com/center/s/article/auth0-password-reset-sets-email-verified-to-true-but-does-not-send-a-welcome-email).

## Local release evidence

The account-management change is prepared for PR review, not merged/deployed. It requires additive migration 030 and the existing server-side Auth0 user-management credentials/scopes (`read:users create:users update:users`). No new domain, paid plan, secret or browser credential handling is introduced. Existing legacy contacts remain preserved; they are prepared through the next authorized workflow rather than bulk linked by email.

Both production builds, 29 account lifecycle checks, 176 finance/contact/profile/household checks, 40 access/session/concurrency checks, 21 leasing/renewal checks, 172 UI fixtures, 82 safe Node checks (five database suites intentionally skipped there and exercised by disposable runners), and 67 operations checks pass locally. Provider units include eight cases for exact-ID updates, duplicate ambiguity, single federated-account reuse and case-preserved upstream emails. Local tests use fictional providers and isolated PostgreSQL. Live email delivery, provider settings and real-user acceptance remain unverified.
