# Workflow batch validation — October 22, 2026

This records local integration evidence for resident maintenance conversations, named resident document sharing, personal saved drafts, and vacancy/application workflows. It supplements the [previous audit validation](production-audit-validation-2026-10-21.md); local checks do not establish hosted rollout or user acceptance.

## Real database and browser integration

The repository's disposable runners use fresh PostgreSQL 17 containers with tmpfs storage, loopback-only database ports, the actual generated Prisma client and compiled Fastify application. Browser cases use the real React application and system Chromium 154.0.8037.57. Tests never connect to the persistent preview, development or customer databases. Each runner now owns a separate temporary Vite dependency cache so concurrent previews cannot rewrite its optimized dependencies.

| Runner | Final result | Relevant coverage | Local log |
| --- | --- | --- | --- |
| Maintenance | 140 passed, zero skipped | Eight conversation cases, eight named-share cases, existing work orders/calendar/documents/inspections/agreements/notifications, and real browser recovery/source navigation | `/tmp/propertyflow-next-batch-maintenance-quiet.log` |
| Leasing | 51 passed, zero skipped | Twelve vacancy/application cases, seven draft cases, lease/renewal authorization and real browser committed-response-loss recovery | `/tmp/propertyflow-oct22-leasing-release-payload.log` |
| Finances | 177 passed, zero skipped | Existing rent, deposit, retained source, concurrency/retry and browser financial workflows | `/tmp/propertyflow-next-batch-finances-final.log` |

The maintenance run completed in 80.46 seconds with no other heavy runners active. Leasing passed again in 21.38 seconds after the final TypeScript emit, including TaskDraft company/user/version filters, safe admission-history type and aggregate UTF-8 validation before storage. These three runners provide 368 passing PostgreSQL/API/browser checks with no skips. Maintenance verifies requester-visible versus internal replies, current source and company access, immutable history, idempotent submissions and notification rollback. Named sharing verifies explicit approved recipients, clean pinned versions, durable receipt/revoke behavior, RLS and an actual PostgreSQL lock race where roster approval is revoked before a pending download can complete.

Earlier diagnostic runs remain failures in their original logs. Fixture corrections replaced illegal direct version/identity edits with supported actions and isolated source records; they did not weaken database integrity rules. A lease browser regression was corrected so a successful recovered save reaches its permanent lease URL. An agreement-original popup timed out during concurrent heavy workloads; the complete quiet maintenance run passes that same case. A prior leasing run passed all 51 checks before the final TaskDraft filter hardening and safe history-label DTO addition; the table above records the final rerun separately.

## Complete client validation

The final settled-client run passed **277/277 browser scenarios**, zero skips, in 5.0 minutes across 40 files. It uses an isolated Vite cache and installed Chromium. Evidence: `/tmp/propertyflow-oct22-ui-release.log`, JSON `/tmp/propertyflow-oct22-ui-release-results.json` and retained artifacts `/tmp/propertyflow-oct22-ui-release-results/`. The production client build passes. Client units 28/28, operations 88/88 and the development power inventory guard pass.

Diagnostic broad runs remain recorded as interrupted/failed, including an intermediate 268/276 result. Targeted rechecks and the complete final run validate the subsequent source/fixture fixes: successful expense/lease result navigation, keyboard focus after finder closure, compact mobile confirmation, durable draft close, truthful recovery controls, and updated Help relevance/count expectations. A trace established that one earlier initial-load failure involved `ERR_NETWORK_CHANGED` before any React or API execution. No timeout was merely increased to hide that failure.

Final server compilation and safe units also pass: 91 passed, 5 intentionally skipped integration entry points, zero failures. These include multibyte aggregate-size checks. The client production build passes at the final client source. Unit evidence: `/tmp/propertyflow-oct22-server-release-final-unit.log`, `/tmp/propertyflow-oct22-client-release-unit.log`; build evidence: `/tmp/propertyflow-oct22-client-release-build.log`.

## Preserved local preview

The existing fictional preview was checkpointed before shutdown. Its private local dump was restored into a new isolated preview container, and additive schema migrations 031–044 are applied only when their schema markers are absent. Before any new sample records were added, all 55 original business tables matched their pre-restart row counts and full-value fingerprints. Original source IDs, lease/household records, financial amounts and audit history were retained. Session transport records are excluded from that business-data comparison.

The preview remains available at `http://127.0.0.1:5090/api/local-preview`, with the API on loopback 5091. Its existing private checkpoint continues every 30 seconds and during clean shutdown. Checkpoint SQL is private, transient local state and is not included in repository evidence. Preservation verification is recorded in `/tmp/propertyflow-preview-preservation-verified.log`.

After the preservation check, the preview received clearly labeled fictional additions through the real APIs: a new available unit, prospect/tour/application, private saved draft, and a resident request with a public team response and resident reply. No previous business record was edited and no provider delivery, document upload or money/lease mutation was used. Eight desktop/mobile inspection captures and their readiness/URL checks are recorded in `/tmp/propertyflow-oct22-screenshots/metadata.json`; selected fictional screenshots are in `docs/acceptance-evidence/`.

A final checkpoint/restart loaded the frozen compiled API after those additions. All 63 business tables then matched their complete pre-restart row counts and full-value fingerprints, including the new sample history and draft. Read-only owner/resident API smoke checks confirmed the retained availability, saved draft, typed inquiry history and resident conversation; resident requests to management applications and saved drafts returned 403. Evidence: `/tmp/propertyflow-preview-release-preservation-verified.log` and `/tmp/propertyflow-preview-frozen-api-smoke.log`. Resident shared-document screenshots remain unverified because the preview has no scanner-cleared original; no clearance was fabricated.

## Limits

Provider delivery and identity provisioning use deterministic local adapters where needed; live Auth0, email, hosted file storage/scanning, deployment, operational alert activation and customer acceptance remain unverified. No push, merge, deployment or hosted resource change was performed. The roadmap and feature documents retain activation and acceptance work.
