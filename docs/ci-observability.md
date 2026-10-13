# CI and test visibility

Test frameworks: JavaScript uses node:test; Python development power controls use unittest. In Datadog's Test Optimization setup select JUnit XML / Other.

CI exports JUnit XML reports from both runners and keeps them as seven-day GitHub artifacts. On same-repository PRs, reports upload to Datadog US1 using the existing DATADOG_API_KEY secret, service propertyflow-tests, env ci. The key is exposed only to the upload step; forks do not receive it. Upload runs even after failed tests so failures are visible, but telemetry upload errors do not turn successful tests into failed builds. Reports contain isolated test fixtures; no production database is used.

This provides test pass/fail and duration visibility. It does not enable native test tracing, coverage, intelligent test skipping, or automatic test retries.

Pipeline visibility is a separate Datadog GitHub integration setting. Enable CI Visibility specifically for elijahvw/property-flow-2 under CI/CD Optimization > Settings > GitHub Actions. The previously connected app already has Actions access; do not create a second app or expand repository scope. Job log storage is billed separately and is not enabled by this code.

The code does not activate a paid Datadog subscription. The organization must have the relevant trial/product entitlement for events to appear. Verify actual ingestion after a PR CI run: service:propertyflow-tests, env:ci, and the PR commit.

References:
- https://docs.datadoghq.com/tests/setup/junit_xml/
- https://docs.datadoghq.com/continuous_integration/pipelines/github/
