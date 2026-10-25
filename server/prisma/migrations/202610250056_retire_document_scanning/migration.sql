BEGIN;
-- Retain originals, prior verdicts, timestamps, RLS and immutable history.
-- New originals explicitly record that no malware scan was performed.
ALTER TABLE "DocumentVersion" DROP CONSTRAINT "DocumentVersion_scanStatus_check";
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_scanStatus_check"
 CHECK ("scanStatus" IN ('unscanned','pending','clean','rejected'));
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_unscanned_timestamp_check"
 CHECK ("scanStatus" <> 'unscanned' OR "scannedAt" IS NULL);
ALTER TABLE "DocumentVersion" ALTER COLUMN "scanStatus" SET DEFAULT 'unscanned';
COMMIT;
