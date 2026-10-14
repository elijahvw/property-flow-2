-- Add empty record tables; do not backfill or infer tenancy from assignments.
CREATE TABLE "Unit" (
 "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,
 "submissionHash" TEXT NOT NULL,
 UNIQUE ("companyId","createdById","submissionKey"),
 "id" TEXT PRIMARY KEY,
 "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "propertyId" TEXT NOT NULL,
 "label" TEXT NOT NULL CHECK (length(btrim("label")) BETWEEN 1 AND 80),
 "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active','archived')),
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("propertyId","companyId") REFERENCES "Property"("id","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE ("id","propertyId","companyId"),
 UNIQUE ("companyId","propertyId","label")
);
CREATE INDEX "Unit_companyId_propertyId_id_idx" ON "Unit"("companyId","propertyId","id");
CREATE TABLE "Lease" (
 "id" TEXT PRIMARY KEY,
 "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "propertyId" TEXT NOT NULL,
 "unitId" TEXT NOT NULL,
 "residentId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,
 "submissionHash" TEXT NOT NULL,
 "startsOn" DATE NOT NULL,
 "endsOn" DATE,
 "rentCents" INTEGER NOT NULL CHECK ("rentCents" BETWEEN 0 AND 100000000),
 "currency" TEXT NOT NULL DEFAULT 'USD' CHECK ("currency"='USD'),
 "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft','active','ended')),
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK ("endsOn" IS NULL OR "endsOn">="startsOn"),
 CHECK ("status"!='ended' OR "endsOn" IS NOT NULL),
 FOREIGN KEY ("propertyId","companyId") REFERENCES "Property"("id","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("unitId","propertyId","companyId") REFERENCES "Unit"("id","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE ("companyId","createdById","submissionKey")
);
-- One manually active lease per unit; drafts and ended history remain available.
CREATE UNIQUE INDEX "Lease_one_active_unit_idx" ON "Lease"("companyId","unitId") WHERE "status"='active';
CREATE INDEX "Lease_companyId_propertyId_id_idx" ON "Lease"("companyId","propertyId","id");
CREATE INDEX "Lease_companyId_unitId_idx" ON "Lease"("companyId","unitId");
ALTER TABLE "Unit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Unit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Lease" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lease" FORCE ROW LEVEL SECURITY;
CREATE POLICY unit_company_boundary ON "Unit" FOR ALL TO propertyflow_runtime USING ("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK ("companyId"=NULLIF(current_setting('app.company_id',true),''));
CREATE POLICY lease_company_boundary ON "Lease" FOR ALL TO propertyflow_runtime USING ("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK ("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT,UPDATE ON "Unit","Lease" TO propertyflow_runtime;
