BEGIN;
ALTER TABLE "MaintenanceRequest"
 ADD COLUMN "unitId" TEXT,
 ADD COLUMN category TEXT NOT NULL DEFAULT 'other',
 ADD COLUMN "targetOn" DATE,
 ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
 ADD CONSTRAINT maintenance_category CHECK (category IN ('plumbing','electrical','hvac','appliance','structural','safety','other')),
 ADD CONSTRAINT maintenance_unit_scope FOREIGN KEY ("unitId","propertyId","companyId") REFERENCES "Unit"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX maintenance_unit_lookup ON "MaintenanceRequest"("companyId","unitId");
COMMIT;
