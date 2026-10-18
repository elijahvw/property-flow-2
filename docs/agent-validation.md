# Validation and operations guidance

Read only the checks relevant to the changed area; reuse valid results until code or evidence changes.

- Client: React/Vite/TypeScript. Server: Fastify/Prisma/PostgreSQL. Identity: Auth0 OIDC. Follow adjacent conventions and keep database migrations additive where practical.
- Client build: `npm run build --workspace=@property-flow/client`.
- Server build: `DATABASE_URL=postgresql://build:build@127.0.0.1:1/propertyflow_access_test npm run build --workspace=server` (compile only).
- Safe units after building: `node --test server/tests/*.test.mjs` and `node --test client/tests/*.test.cjs`, with integration database variables unset.
- Operations checks: `python3 -m unittest discover -s tests/operations -p 'test_*.py'`.
- Use existing disposable database runners for integration tests (`scripts/test-maintenance.mjs`, `scripts/test-finances.mjs` and related runners). Never point tests at development/customer data.
- Use the existing browser fixture suite for UI regressions and verify changed flows in the local preview. Run checks appropriate to the change; add meaningful coverage for authorization, data integrity and consequential behavior.
- Monitoring must accompany shipped workflows: bounded outcome/duration/failure signals, safe logs/traces and an actionable alert/runbook when needed. Preserve RUM privacy; never capture private form/contact/financial data or enable replay implicitly. See `docs/monitoring-coverage.md` for remaining coverage and activation evidence.

For agent-usage diagnosis, read numeric usage/config fields only. Do not re-ingest the current chat transcript, Grafana tool-result bodies or full browser trees: they recursively copy existing context. Compare per-request input before/after compaction; cumulative input grows across calls and cannot prove the current context size.
