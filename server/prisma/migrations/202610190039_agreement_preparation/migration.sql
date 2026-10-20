BEGIN;
CREATE TABLE "LeaseAgreement" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "leaseId" TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
 kind TEXT NOT NULL CHECK(kind IN ('lease','renewal','addendum','other')),
 status TEXT NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','awaiting_review','reviewed','cancelled')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), package JSONB NOT NULL, source JSONB NOT NULL, "sourceHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("leaseId","companyId") REFERENCES "Lease"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE(id,"leaseId","companyId")
);
CREATE INDEX "LeaseAgreement_companyId_leaseId_createdAt_id_idx" ON "LeaseAgreement"("companyId","leaseId","createdAt",id);
CREATE TABLE "AgreementRevision" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "leaseId" TEXT NOT NULL, "agreementId" TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), action TEXT NOT NULL CHECK(action IN ('create','edit','submit','approve','request_changes','reopen','cancel')),
 reason TEXT CHECK(length(btrim(reason)) BETWEEN 1 AND 1000), snapshot JSONB NOT NULL,
 "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(action NOT IN ('approve','request_changes','reopen','cancel') OR reason IS NOT NULL),
 FOREIGN KEY ("agreementId","leaseId","companyId") REFERENCES "LeaseAgreement"(id,"leaseId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE(id,"companyId"), UNIQUE("agreementId",version), UNIQUE("companyId","actorId","submissionKey")
);
CREATE INDEX "AgreementRevision_companyId_agreementId_version_idx" ON "AgreementRevision"("companyId","agreementId",version);
CREATE TABLE "AgreementFile" (
 "revisionId" TEXT NOT NULL, "companyId" TEXT NOT NULL, "versionId" TEXT NOT NULL,
 PRIMARY KEY("revisionId","versionId"),
 FOREIGN KEY ("revisionId","companyId") REFERENCES "AgreementRevision"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("versionId","companyId") REFERENCES "DocumentVersion"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "AgreementFile_companyId_versionId_idx" ON "AgreementFile"("companyId","versionId");
ALTER TABLE "LeaseAgreement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseAgreement" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AgreementRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgreementRevision" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AgreementFile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgreementFile" FORCE ROW LEVEL SECURITY;
CREATE POLICY agreement_company ON "LeaseAgreement" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY agreement_revision_company ON "AgreementRevision" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY agreement_file_company ON "AgreementFile" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
GRANT SELECT,INSERT,UPDATE ON "LeaseAgreement" TO propertyflow_runtime;
GRANT SELECT,INSERT ON "AgreementRevision","AgreementFile" TO propertyflow_runtime;
CREATE FUNCTION retain_agreement_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Agreement revisions and originals are immutable'; END $$;
CREATE TRIGGER retain_agreement_revision BEFORE UPDATE OR DELETE ON "AgreementRevision" FOR EACH ROW EXECUTE FUNCTION retain_agreement_history();
CREATE TRIGGER retain_agreement_file BEFORE UPDATE OR DELETE ON "AgreementFile" FOR EACH ROW EXECUTE FUNCTION retain_agreement_history();
COMMIT;
