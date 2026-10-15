# CI and test visibility

CI keeps every existing JavaScript, Python, browser and disposable PostgreSQL regression suite. JUnit XML reports and failure details remain available in GitHub Actions as seven-day artifacts. Superseded CI runs are cancelled. No test results, source maps or CI credentials are uploaded to Datadog by the current workflow.

Application OpenTelemetry is independent of CI reporting. GitHub remains the source for check status, logs and test artifacts. No tests are skipped or removed to replace the monitoring vendor.
