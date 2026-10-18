BEGIN;
ALTER TABLE "User" ADD COLUMN "guideState" JSONB,
  ADD COLUMN "guideVersion" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "User_guide_version_valid" CHECK ("guideVersion" > 0);
COMMIT;
