BEGIN;
CREATE TABLE "LeaseInspection" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "leaseId" TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('move_in','move_out')),
 "inspectedOn" DATE NOT NULL,
 status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','awaiting_review','completed')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 items JSONB NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 100),
 "baselineRevisionId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("leaseId","companyId") REFERENCES "Lease"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK(kind='move_out' OR "baselineRevisionId" IS NULL), UNIQUE(id,"leaseId","companyId")
);
CREATE INDEX "LeaseInspection_companyId_leaseId_createdAt_id_idx" ON "LeaseInspection"("companyId","leaseId","createdAt",id);
CREATE TABLE "InspectionRevision" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "leaseId" TEXT NOT NULL, "inspectionId" TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0), action TEXT NOT NULL CHECK(action IN ('create','edit','submit','complete','reopen')),
 reason TEXT CHECK(length(reason) BETWEEN 1 AND 1000), snapshot JSONB NOT NULL,
 "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("inspectionId","leaseId","companyId") REFERENCES "LeaseInspection"(id,"leaseId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK(action NOT IN ('complete','reopen') OR reason IS NOT NULL),
 UNIQUE(id,"companyId"), UNIQUE(id,"leaseId","companyId"), UNIQUE("inspectionId",version), UNIQUE("companyId","actorId","submissionKey")
);
CREATE INDEX "InspectionRevision_companyId_inspectionId_version_idx" ON "InspectionRevision"("companyId","inspectionId",version);
ALTER TABLE "LeaseInspection" ADD CONSTRAINT "inspection_baseline_scope" FOREIGN KEY ("baselineRevisionId","leaseId","companyId") REFERENCES "InspectionRevision"(id,"leaseId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_id_companyId_key" UNIQUE(id,"companyId");
CREATE TABLE "InspectionEvidence" (
 "revisionId" TEXT NOT NULL, "companyId" TEXT NOT NULL, "itemKey" TEXT NOT NULL, "versionId" TEXT NOT NULL,
 PRIMARY KEY("revisionId","itemKey","versionId"),
 FOREIGN KEY ("revisionId","companyId") REFERENCES "InspectionRevision"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("versionId","companyId") REFERENCES "DocumentVersion"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "InspectionEvidence_companyId_versionId_idx" ON "InspectionEvidence"("companyId","versionId");
ALTER TABLE "LeaseInspection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseInspection" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InspectionRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InspectionRevision" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InspectionEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InspectionEvidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY inspection_company ON "LeaseInspection" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY inspection_revision_company ON "InspectionRevision" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY inspection_evidence_company ON "InspectionEvidence" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
GRANT SELECT,INSERT,UPDATE ON "LeaseInspection" TO propertyflow_runtime;
GRANT SELECT,INSERT ON "InspectionRevision","InspectionEvidence" TO propertyflow_runtime;
CREATE FUNCTION retain_inspection_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Inspection history and evidence are immutable'; END $$;
CREATE TRIGGER retain_inspection_revision BEFORE UPDATE OR DELETE ON "InspectionRevision" FOR EACH ROW EXECUTE FUNCTION retain_inspection_history();
CREATE TRIGGER retain_inspection_evidence BEFORE UPDATE OR DELETE ON "InspectionEvidence" FOR EACH ROW EXECUTE FUNCTION retain_inspection_history();
COMMIT;
