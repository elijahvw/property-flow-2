-- Deletion removes company access while retaining financial/source/audit history.
ALTER TABLE "Company" DROP CONSTRAINT "Company_status_check";
ALTER TABLE "Company" ADD CONSTRAINT "Company_status_check" CHECK (status IN ('active','suspended','deleted'));
ALTER TABLE "Company" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT,
  ADD COLUMN "deletionSubmissionKey" TEXT, ADD COLUMN "deletionSubmissionHash" TEXT;
ALTER TABLE "Company" ADD CONSTRAINT "Company_deletion_check" CHECK (
  (status = 'deleted' AND "deletedAt" IS NOT NULL AND "deletedById" IS NOT NULL AND "deletionSubmissionKey" IS NOT NULL AND "deletionSubmissionHash" IS NOT NULL)
  OR (status <> 'deleted' AND "deletedAt" IS NULL AND "deletedById" IS NULL AND "deletionSubmissionKey" IS NULL AND "deletionSubmissionHash" IS NULL));
