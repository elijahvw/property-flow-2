BEGIN;
CREATE TABLE "UnitImportBatch" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
 status TEXT NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','committed','cancelled')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), "fileName" TEXT NOT NULL,
 "sourceHash" TEXT NOT NULL, "sourceRows" JSONB NOT NULL, preview JSONB NOT NULL,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT, "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
 "committedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3), result JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE("companyId","submissionKey"), UNIQUE("companyId",id),
 CHECK((status='preview' AND "committedAt" IS NULL AND "cancelledAt" IS NULL AND result IS NULL) OR (status='committed' AND "committedAt" IS NOT NULL AND "cancelledAt" IS NULL AND result IS NOT NULL) OR (status='cancelled' AND "cancelledAt" IS NOT NULL AND "committedAt" IS NULL))
);
CREATE INDEX "UnitImportBatch_companyId_createdAt_id_idx" ON "UnitImportBatch"("companyId","createdAt",id);
CREATE TABLE "UnitImportAction" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
 "batchId" TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('preview','commit','cancel')),
 detail JSONB NOT NULL, "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("companyId","batchId") REFERENCES "UnitImportBatch"("companyId",id) ON DELETE RESTRICT,
 UNIQUE("companyId","submissionKey")
);
CREATE INDEX "UnitImportAction_companyId_batchId_createdAt_idx" ON "UnitImportAction"("companyId","batchId","createdAt");
ALTER TABLE "UnitImportBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UnitImportBatch" FORCE ROW LEVEL SECURITY;
ALTER TABLE "UnitImportAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UnitImportAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY unit_import_company ON "UnitImportBatch" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY unit_import_action_company ON "UnitImportAction" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
GRANT SELECT,INSERT ON "UnitImportBatch","UnitImportAction" TO propertyflow_runtime;
GRANT UPDATE(status,version,"committedAt","cancelledAt",result,"updatedAt") ON "UnitImportBatch" TO propertyflow_runtime;
COMMIT;
