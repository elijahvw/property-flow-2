-- Optional profile fields preserve existing companies without inventing details.
ALTER TABLE "Company" ADD COLUMN "legalName" TEXT, ADD COLUMN "contactName" TEXT,
 ADD COLUMN "contactEmail" TEXT, ADD COLUMN "contactPhone" TEXT, ADD COLUMN "website" TEXT,
 ADD COLUMN "addressLine1" TEXT, ADD COLUMN "addressLine2" TEXT, ADD COLUMN "city" TEXT,
 ADD COLUMN "region" TEXT, ADD COLUMN "postalCode" TEXT, ADD COLUMN "country" TEXT,
 ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/New_York', ADD COLUMN "adminNotes" TEXT,
 ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0),
 ADD COLUMN "createdById" TEXT REFERENCES "User"(id) ON DELETE RESTRICT,
 ADD COLUMN "submissionKey" TEXT, ADD COLUMN "submissionHash" TEXT;
CREATE UNIQUE INDEX "Company_createdById_submissionKey_key" ON "Company"("createdById","submissionKey");
