BEGIN;
CREATE TABLE "UnitAvailability" (
 "unitId" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
 "propertyId" TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 condition TEXT NOT NULL CHECK(condition IN ('ready','turnover','unavailable','unconfirmed')),
 "availableOn" DATE, reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 "updatedById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY("unitId","propertyId","companyId") REFERENCES "Unit"(id,"propertyId","companyId") ON DELETE RESTRICT,
 UNIQUE("unitId","propertyId","companyId")
);
CREATE INDEX "UnitAvailability_companyId_propertyId_idx" ON "UnitAvailability"("companyId","propertyId");
CREATE TABLE "UnitAvailabilityRevision" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
 "unitId" TEXT NOT NULL, "propertyId" TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 snapshot JSONB NOT NULL, reason TEXT NOT NULL, "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("unitId","propertyId","companyId") REFERENCES "Unit"(id,"propertyId","companyId") ON DELETE RESTRICT,
 UNIQUE("unitId",version), UNIQUE("companyId","submissionKey")
);
CREATE INDEX "UnitAvailabilityRevision_companyId_unitId_createdAt_idx" ON "UnitAvailabilityRevision"("companyId","unitId","createdAt");
ALTER TABLE "UnitAvailability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UnitAvailability" FORCE ROW LEVEL SECURITY;
ALTER TABLE "UnitAvailabilityRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UnitAvailabilityRevision" FORCE ROW LEVEL SECURITY;
CREATE POLICY unit_availability_company ON "UnitAvailability" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY unit_availability_revision_company ON "UnitAvailabilityRevision" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
GRANT SELECT,INSERT ON "UnitAvailability","UnitAvailabilityRevision" TO propertyflow_runtime;
GRANT UPDATE(version,condition,"availableOn",reason,"updatedById","updatedAt") ON "UnitAvailability" TO propertyflow_runtime;
COMMIT;
