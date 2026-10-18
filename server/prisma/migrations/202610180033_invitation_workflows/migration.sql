BEGIN;
ALTER TABLE "Invitation"
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "submissionKey" TEXT,
  ADD COLUMN "submissionHash" TEXT,
  ADD COLUMN "replacesId" TEXT,
  ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN "deliveryRequestedAt" TIMESTAMP(3),
  ADD COLUMN "deliveryUpdatedAt" TIMESTAMP(3),
  ADD CONSTRAINT "Invitation_version_valid" CHECK (version > 0),
  ADD CONSTRAINT "Invitation_submission_pair" CHECK (("submissionKey" IS NULL) = ("submissionHash" IS NULL)),
  ADD CONSTRAINT "Invitation_delivery_valid" CHECK ("deliveryStatus" IN ('not_requested','requesting','accepted','failed','unknown'));
CREATE UNIQUE INDEX "Invitation_id_companyId_key" ON "Invitation"(id,"companyId");
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_replacement_company_fkey" FOREIGN KEY("replacesId","companyId") REFERENCES "Invitation"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "Invitation_companyId_createdBy_submissionKey_key" ON "Invitation"("companyId","createdBy","submissionKey");
CREATE INDEX "Invitation_companyId_createdAt_id_idx" ON "Invitation"("companyId","createdAt",id);
COMMIT;
