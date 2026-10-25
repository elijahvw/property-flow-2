# Document scanner retirement

October 25, 2026 local follow-up to the Alloy collector PR. The user explicitly
requested removal of ClamAV and automatic malware scanning. This change is
prepared for review; it is not a deployment or a malware-detection result.

## Resulting document workflow

Supported PDF, PNG, JPEG and UTF-8 text uploads remain limited to 5 MiB and retain
filename, extension/content checks, private storage, source/company authorization,
CSRF, durable upload identity, immutable originals and atomic audit history.
Malware scanning is no longer performed. Those checks do not replace antivirus.

New versions record `scanStatus=unscanned` and a null `scannedAt`. Management,
leaseholder sharing, inspection evidence and agreement preparation all use the
same explicit availability policy. New files and historical pending versions
are labeled **Not scanned** and can be used/downloaded by otherwise authorized
users. Legacy pending means no recorded verdict; no historical row is rewritten.
Previously clean versions display **Previously cleared by scanning**. Previously
rejected versions remain blocked, as do unknown states. The retained rejection
belongs to that exact version; this is not a new hash-based malware service.

Uploading never grants resident/staff access. Owner-reviewed exact-version grants,
eligible verified leaseholder membership/property scope, expiry, revocation and
archive behavior remain mandatory. Resident responses include the original's file
status, and owner sharing reviews display it before confirmation. File bytes are
downloaded as attachments; no public URL or inline preview is added.

The old scan endpoint and daemon/CLI adapter are removed. There are no automatic
scan requests, scanner setup prompts or scan retry controls. An old browser build
must be refreshed after release to use unscanned versions correctly. Document
uploads/downloads and sharing keep their existing bounded operation telemetry.

## Schema and demo

Additive migration `202610250057_retire_document_scanning` follows the immutable
`202610250056_demo_rebuild_plans` migration and admits the new status,
sets the default and requires null scan timestamps for unscanned files. Existing
verdicts, timestamps, RLS and immutable-original triggers are retained. Apply the
migration before the updated application, using the existing reviewed deployment
and restore-point sequence. Do not backfill files as clean or rewrite prior
audit/scan history. A rollback to an older app may hide unscanned files; roll
forward rather than inventing clearance.

Sales demo fixture version 6 uses the ordinary unscanned upload path instead of
its special bundled-text clearance adapter. It still exercises document sharing,
resident download/receipt, inspection evidence and reviewed unsigned preparation.
It retains fixture5's presentation anchor, source walkthrough and planned future
move-out. Existing demos use the reviewed fixture-update/rebuild workflow; their
retained history is never rewritten. Older unfinished blueprints must be retired
before reviewing the new fixture.

## Infrastructure and lifecycle

Terraform removes the scanner image/container, environment variable, health check
and signature-update process. There is no replacement scanner, worker or paid
service. The existing ECS service retains its Start/Stop controls and the daily
3 a.m. Eastern shutdown; starts remain manual.

| Configuration | Task CPU | Task memory | Container hard limits |
| --- | --- | --- | --- |
| App only | 0.5 vCPU | 1 GiB | App 1,024 MiB |
| App and Alloy | 0.5 vCPU | 2 GiB | App 1,024 MiB, Alloy 512 MiB, 512 MiB task headroom |

The API's existing 1-GiB container ceiling and 0.5-vCPU task capacity are retained.
Deployment refuses legacy task definitions containing the scanner so infrastructure
must be applied before backend rollout. The Alloy readiness and secret-injection
checks remain intact.

At the previously checked N. Virginia Linux/x86 public prices and 176 running
hours/month, app-plus-Alloy task compute is about $5.13, compared with $11.04 for
the earlier 1-vCPU/5-GiB proposal or $6.69 for the current scanner-bearing task.
These are task-compute estimates, excluding RDS, retained infrastructure,
telemetry, transfer and tax; no whole-account budget cap is implied.

## Verification and acceptance

Use fresh disposable PostgreSQL runners for document integrity, access boundaries,
legacy states, sharing, inspections, agreements and demo lifecycle. Browser checks
must cover upload recovery without a scan request, explicit status labels,
historical rejection blocking, source returns and resident grants/receipts.
Terraform tests verify both smaller task sizes and absence of the scanner.

This is a separate PR stacked on the Alloy collector PR so its resource changes
cannot accidentally reintroduce the scanner. Merge/rebase in that order, then use
the normal reviewed plan/deploy procedure. Live migration, reduced-task startup,
real-account document acceptance and cloud cost verification remain separate gates.

The original scanner-only branch verification passed both builds, 118 safe server units with
nine expected database-suite skips, 53 client units, 94 operations tests, 148 real
maintenance/document API/browser checks, 39 roadmap checks, 12 demo lifecycle
checks, 18 focused UI cases and four mocked Terraform runs. Terraform root
validation, formatting, workflow linting and the power inventory also pass.
Browser runs used Playwright with the installed system Chromium 154; bundled
browser downloads were denied by the managed network policy. Server client generation
used Prisma's bundled WASM path, and the disposable runners applied all actual
SQL migrations on fresh PostgreSQL 17. These checks do not establish live
deployment, capacity at production load or malware detection.

The consolidated deployment prerequisites and exact Actions UI inputs are in
[the October25 batch checklist](deploy-october-25-batch.md).

## Integration with the merged platform/demo batch

PR68 now incorporates main `44747bd` and the resolved PR64 head `aaebc15`.
The new provider reservations/deadlines, reviewed rebuilds, future-move-out guard,
source walkthrough, navigation/forms and RDS/ECR protection changes are retained.
All 59 existing migration files are unchanged; only scanner migration057 is added.
The final integrated validation and publication state are recorded in
`acceptance-evidence/pr68-main-reconciliation-2026-10-25.json`.

The integrated checkout passes both builds (with the recorded Prisma generation
limitation), 128 safe server checks with nine expected DB-suite skips, 70 client
checks, 100 operations checks, fresh demo22/maintenance148/roadmap39 and the
complete fixed production browser suite459/459 with two workers and zero retries.
Four mocked Terraform runs, root validation/formatting, both rendered Alloy modes,
actionlint and the power inventory pass. Published-head CI and cloud acceptance
remain separate gates.
