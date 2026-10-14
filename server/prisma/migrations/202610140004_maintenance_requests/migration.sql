-- Additive migration; no existing rows are changed.
CREATE TABLE "MaintenanceRequest" (
 "id" TEXT PRIMARY KEY,
 "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "propertyId" TEXT NOT NULL,
 "requesterId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "title" TEXT NOT NULL CHECK (length(btrim("title")) BETWEEN 1 AND 160),
 "description" TEXT NOT NULL CHECK (length(btrim("description")) BETWEEN 1 AND 4000),
 "priority" TEXT NOT NULL DEFAULT 'normal' CHECK ("priority" IN ('low','normal','high')),
 "status" TEXT NOT NULL DEFAULT 'open' CHECK ("status" IN ('open','in_progress','resolved')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("propertyId","companyId") REFERENCES "Property"("id","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "MaintenanceRequest_companyId_status_propertyId_idx" ON "MaintenanceRequest"("companyId","status","propertyId");
CREATE INDEX "MaintenanceRequest_companyId_requesterId_idx" ON "MaintenanceRequest"("companyId","requesterId");
ALTER TABLE "MaintenanceRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaintenanceRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY maintenance_company_boundary ON "MaintenanceRequest" FOR ALL TO propertyflow_runtime
 USING ("companyId" = NULLIF(current_setting('app.company_id', true), ''))
 WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), ''));
GRANT SELECT, INSERT, UPDATE, DELETE ON "MaintenanceRequest" TO propertyflow_runtime;
