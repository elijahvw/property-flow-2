# Browser operation monitoring

The browser reports fixed product-operation names, duration and success/error/abandoned outcomes to authenticated same-origin `/api/telemetry`. The existing server session, exact Origin and CSRF validation apply. Intake has a closed vocabulary, an eight-request/minute limit and at most 16 events per batch. The client queue is bounded, cleared on sign-out, and drops failures without retrying a business action. Browser errors report only a fixed category; no exception messages, URLs, form values, identities or financial details are exported. There is no session replay.

The server exports operation metrics and safe error logs through OpenTelemetry. Monitoring must be validated at the chosen destination after manual deployment; local unit tests do not prove hosted ingestion. The hosting/destination decision is still being reviewed with the user.

Operation lifecycle tests preserve parallel attempt separation, exactly-once completion, timeout, abandonment and failure isolation. Telemetry is best effort and is never the accounting/audit system of record.
