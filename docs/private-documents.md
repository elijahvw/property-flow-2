# Private documents — local foundation (PF-15)

Foundation merged in [PR #46](https://github.com/elijahvw/property-flow-2/pull/46). Deployment, scanner activation and real-role acceptance require separate evidence.

October 18, 2026: the foundation is merged; scanner configuration visibility, automatic post-upload scans and collapsed version history are local refinements. The user selected private uploads and deferred deployment. No live storage, scanner or provider configuration was changed.

Owners/managers upload PDF, PNG, JPEG and UTF-8 text originals to an exact lease or maintenance request. Lease workspace → Documents and maintenance detail → Private documents provide upload, versions, scan, download and archive/restore. Upload never shares a document. Residents and staff have no document authority in this increment, including assigned maintenance staff. Explicit recipient sharing and resident uploads remain future work.

## Storage and retention

Migration031 stores originals in private PostgreSQL `DocumentVersion.content` with company RLS, composite source foreign keys, SHA-256, immutable version metadata/content and atomic audit records. It does not use the public frontend bucket or public object URLs. This intentionally bounds the initial storage adapter to small originals; a future private object-store adapter requires its own migration, retention/backups and authorization review.

Limits: 5 MiB per original, 200 documents per source, 50 retained versions per document, 100 MiB retained originals per source and 1 GiB per company. Archived/rejected originals count toward limits. A full source fails explicitly rather than silently truncating the directory. Physical deletion and automatic retention cleanup are unavailable. Database backup/restore must include private originals; no existing financial/source history is removed.

## Quarantine and retrieval

Uploads validate exact source access, strict fields, bounded canonical base64, safe filenames, allowed extension/media type and content signatures (or UTF-8 validity for text). File signatures are not a malware verdict. New versions start `pending` and cannot be downloaded. The page reports scanner configuration before upload. When configured, the UI automatically requests scanning after saving the original; a failed scan leaves that original saved and quarantined, with a scan-only retry under retained versions. Executable availability is configuration evidence, not proof of current definitions. Earlier cleared versions remain separately accessible and are not presented as the latest upload.

The development task includes an official, digest-pinned ClamAV sidecar with automatic signature updates. `DOCUMENT_SCANNER_PORT=3310` connects through task loopback only; no scanner port is exposed. The adapter streams bounded originals using INSTREAM and accepts only an exact clean verdict. It checks the loaded signature timestamp (maximum72hours), limits concurrent scans to2 and enforces a30second deadline. Missing/stale definitions, busy/unavailable scanners, malformed replies and errors preserve quarantine. ClamAV rejects files exceeding configured scan limits. Its loaded database is checked for changes every60seconds, including recovery from an initial signature-update/startup race.

The task uses0.5vCPU/4GB: app1GB and scanner3GB, with concurrent database reload disabled to bound memory. App/scanner stop and start together through the [development power controls](dev-power.md). `DOCUMENT_SCANNER_BIN` remains a CLI fallback for maintained local installations: absolute executable, no shell, private0600 temporary originals, exit0 clean/exit1 rejected; other results retain quarantine.

The release adapter was checked against real ClamAV with current definitions: small and5MB clean text cleared, and the standard harmless EICAR antivirus test was rejected. Cloud rollout and real-account upload/download remain separate acceptance checks; this evidence does not establish detection of every threat.

Scanning releases database locks before provider work, then rechecks fresh access/company/source authority before publishing a verdict. Every download reauthorizes the exact document/version/source and audits retrieval atomically. Downloads use same-origin authenticated JSON through the shared API client, no-store caching, a local attachment Blob and no reusable public link or inline content preview. Archive/restore retains originals and uses optimistic version checks. Archived originals remain retrievable by authorized management; archive does not revoke management retention access.

## Recovery and operations

A durable upload key binds source, filename, type, content hash, title, target document and opening version. Concurrent/lost-response retries create one version/audit; a mismatched retry fails. Failed uploads retain the selected File, title and key while the editor stays open. Closing changed uploads asks whether to keep editing, discard or explicitly save a page-only draft; only explicit saving retains that form after close. Navigation or browser restart requires reselecting the file; content is never saved to browser storage. A single atomic database write creates metadata and bytes, so interrupted requests leave either a complete quarantined original or no row, without separate orphan objects.

Safe signals: `document.upload`, `.scan`, `.download`, `.archive` browser outcomes/durations and existing server route status/duration metrics; no filename, bytes, hash, source ID or private text enters telemetry. Diagnose scanner503 errors using the bounded route/error code; keep files quarantined, restore definitions/executable availability, then retry. Never manually mark a file clean or expose database bytes to bypass scanning.
