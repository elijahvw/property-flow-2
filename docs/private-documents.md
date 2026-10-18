# Private documents — local foundation (PF-15)

October 17, 2026: implemented locally; not merged, deployed or user-accepted. The user selected private uploads and deferred deployment. No live storage, scanner or provider configuration was changed.

Owners/managers upload PDF, PNG, JPEG and UTF-8 text originals to an exact lease or maintenance request. Lease workspace → Documents and maintenance detail → Private documents provide upload, versions, scan, download and archive/restore. Upload never shares a document. Residents and staff have no document authority in this increment, including assigned maintenance staff. Explicit recipient sharing and resident uploads remain future work.

## Storage and retention

Migration031 stores originals in private PostgreSQL `DocumentVersion.content` with company RLS, composite source foreign keys, SHA-256, immutable version metadata/content and atomic audit records. It does not use the public frontend bucket or public object URLs. This intentionally bounds the initial storage adapter to small originals; a future private object-store adapter requires its own migration, retention/backups and authorization review.

Limits: 5 MiB per original, 200 documents per source, 50 retained versions per document, 100 MiB retained originals per source and 1 GiB per company. Archived/rejected originals count toward limits. A full source fails explicitly rather than silently truncating the directory. Physical deletion and automatic retention cleanup are unavailable. Database backup/restore must include private originals; no existing financial/source history is removed.

## Quarantine and retrieval

Uploads validate exact source access, strict fields, bounded canonical base64, safe filenames, allowed extension/media type and content signatures (or UTF-8 validity for text). File signatures are not a malware verdict. New versions remain `pending` and cannot be downloaded. Earlier cleared versions remain separately accessible and are not presented as the latest upload.

`DOCUMENT_SCANNER_BIN` must be the absolute executable path to a maintained ClamAV `clamscan` installation with current definitions in the backend runtime. The server invokes it without a shell, in a private temporary directory with mode0600 originals. Exit0 clears, exit1 rejects; absent configuration, scanner errors/timeouts and invalid results keep quarantine. No scanner is installed/activated by this change. The runtime currently has no verified scanner: upload/retention work locally, but real-file clearance/download activation is deferred. Test process/scanner fixtures verify the protocol and denial paths; they do not establish real malware coverage.

Scanning releases database locks before provider work, then rechecks fresh access/company/source authority before publishing a verdict. Every download reauthorizes the exact document/version/source and audits retrieval atomically. Downloads use same-origin authenticated JSON through the shared API client, no-store caching, a local attachment Blob and no reusable public link or inline content preview. Archive/restore retains originals and uses optimistic version checks. Archived originals remain retrievable by authorized management; archive does not revoke management retention access.

## Recovery and operations

A durable upload key binds source, filename, type, content hash, title, target document and opening version. Concurrent/lost-response retries create one version/audit; a mismatched retry fails. Failed upload drafts retain the selected File, title and key while the editor remains on the page. Discard/reload is explicit. Navigation or browser restart requires reselecting the file; content is never saved to browser storage. A single atomic database write creates metadata and bytes, so interrupted requests leave either a complete quarantined original or no row, without separate orphan objects.

Safe signals: `document.upload`, `.scan`, `.download`, `.archive` browser outcomes/durations and existing server route status/duration metrics; no filename, bytes, hash, source ID or private text enters telemetry. Diagnose scanner503 errors using the bounded route/error code; keep files quarantined, restore definitions/executable availability, then retry. Never manually mark a file clean or expose database bytes to bypass scanning.
