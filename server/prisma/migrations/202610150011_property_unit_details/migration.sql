ALTER TABLE "Property" ADD COLUMN "propertyType" TEXT CHECK ("propertyType" IN ('single_family','multi_family','condo','townhouse','commercial','mixed_use','other')),
 ADD COLUMN "yearBuilt" INTEGER CHECK ("yearBuilt" BETWEEN 1000 AND 2100), ADD COLUMN "parcelId" TEXT,
 ADD COLUMN "countryCode" TEXT, ADD COLUMN "notes" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0),
 ADD COLUMN "createdById" TEXT REFERENCES "User"(id) ON DELETE RESTRICT,
 ADD COLUMN "submissionKey" TEXT, ADD COLUMN "submissionHash" TEXT;
CREATE UNIQUE INDEX "Property_companyId_createdById_submissionKey_key" ON "Property"("companyId","createdById","submissionKey");
ALTER TABLE "Property" ADD CONSTRAINT "Property_submission_complete" CHECK (
 ("createdById" IS NULL AND "submissionKey" IS NULL AND "submissionHash" IS NULL) OR
 ("createdById" IS NOT NULL AND "submissionKey" IS NOT NULL AND "submissionHash" IS NOT NULL));
-- Keep the original creation identity after an edit and retain retry records.
REVOKE UPDATE, DELETE ON "Property" FROM propertyflow_runtime;
GRANT UPDATE (name,address,city,state,zip,"propertyType","yearBuilt","parcelId","countryCode",notes,version,"updatedAt") ON "Property" TO propertyflow_runtime;
ALTER TABLE "Unit" ADD COLUMN "bedrooms" INTEGER CHECK ("bedrooms" BETWEEN 0 AND 100),
 ADD COLUMN "bathroomsHundredths" INTEGER CHECK ("bathroomsHundredths" BETWEEN 0 AND 10000 AND "bathroomsHundredths"%25=0),
 ADD COLUMN "squareFeet" INTEGER CHECK ("squareFeet" BETWEEN 1 AND 10000000),
 ADD COLUMN "marketRentCents" INTEGER CHECK ("marketRentCents" BETWEEN 0 AND 100000000),
 ADD COLUMN "floor" TEXT, ADD COLUMN "notes" TEXT;
