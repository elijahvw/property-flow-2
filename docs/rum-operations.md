# Property Flow RUM operations

The Browser SDK 6.30.x APIs startFeatureOperation / succeedFeatureOperation / failFeatureOperation are enabled with feature_operation_vital. RUM without Limits must be enabled in the Datadog organization; code instrumentation does not purchase or enable a paid plan.

Operations:
- auth.session.restore: Auth0 SDK initialization after a page load. Anonymous initialization can succeed; this is not a completed interactive login.
- auth.profile.load: retrieve an API access token and load /api/me.
- admin.users.load and admin.companies.load: load each Admin list.
- company.create, company.details.load, company.update, company.user.assign: the actual company API workflows.

Operation names stay fixed. Parallel attempts use unique operation keys. Each attempt has one success/failure/abandoned outcome; unfinished attempts fail after 30 seconds. Only numeric HTTP status is included on failure. Tokens, email addresses, company names, form contents, and raw Axios errors are not operation context.

After deploying, reload and use Admin, open an existing company and save an intended change. In Datadog, open RUM > Performance Monitoring > Operations for Property Flow Dev and filter env:dev. Check operation duration, failure rate, the associated RUM session and linked API trace. Catalog visibility and ingestion must be verified after deployment; unit tests do not establish ingestion.

Auth recovery: the app renders public pages immediately. Protected pages wait for session restoration, show recovery after 10 seconds, and use a 12-second total profile deadline. Auth0 silent authorization and HTTP requests are capped at 8 seconds. Failed initialization offers explicit Sign In, Reload and Go Home controls and never grants portal access. Interactive redirect can restore the existing Auth0 session when silent iframe authentication is unavailable. Tokens remain in the SDK's default memory cache.

References:
- https://docs.datadoghq.com/real_user_monitoring/operations_monitoring/
- https://auth0.com/docs/libraries/auth0-single-page-app-sdk
