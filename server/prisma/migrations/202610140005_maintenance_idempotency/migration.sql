-- Nullable columns preserve historical requests; all new API submissions require a key.
ALTER TABLE "MaintenanceRequest" ADD COLUMN "submissionKey" TEXT, ADD COLUMN "submissionHash" TEXT;
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT maintenance_submission_pair CHECK (("submissionKey" IS NULL) = ("submissionHash" IS NULL));
CREATE UNIQUE INDEX "MaintenanceRequest_companyId_requesterId_submissionKey_key" ON "MaintenanceRequest"("companyId", "requesterId", "submissionKey");
