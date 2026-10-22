BEGIN;
-- Readiness and missing lease coverage never imply an owner's listing decision.
-- Every existing row remains unlisted; no availability status is backfilled true.
ALTER TABLE "UnitAvailability"
 ADD COLUMN "forRent" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "listedAt" TIMESTAMP(3),
 ADD CONSTRAINT "UnitAvailability_listing_timestamp_check"
 CHECK (("forRent" AND "listedAt" IS NOT NULL) OR (NOT "forRent" AND "listedAt" IS NULL));
COMMIT;
