BEGIN;
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_id_companyId_key" UNIQUE (id,"companyId");
CREATE TABLE "MaintenanceUpdate" (
 id TEXT PRIMARY KEY,
 "companyId" TEXT NOT NULL,
 "requestId" TEXT NOT NULL,
 content TEXT NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 4000),
 visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','resident')),
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,
 "submissionHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("requestId","companyId") REFERENCES "MaintenanceRequest"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE ("companyId","createdById","submissionKey")
);
CREATE INDEX "MaintenanceUpdate_companyId_requestId_createdAt_id_idx" ON "MaintenanceUpdate"("companyId","requestId","createdAt",id);
ALTER TABLE "MaintenanceUpdate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaintenanceUpdate" FORCE ROW LEVEL SECURITY;
CREATE POLICY maintenance_update_company_boundary ON "MaintenanceUpdate" FOR ALL TO propertyflow_runtime
 USING ("companyId"=NULLIF(current_setting('app.company_id',true),''))
 WITH CHECK ("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT ON "MaintenanceUpdate" TO propertyflow_runtime;
COMMIT;
