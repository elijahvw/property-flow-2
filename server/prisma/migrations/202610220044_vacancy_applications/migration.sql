BEGIN;
CREATE TABLE "UnitAvailability" (
 id TEXT PRIMARY KEY,"companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"unitId" TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(status IN ('unreviewed','available','turnover','unavailable')),
 "availableOn" DATE,notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"updatedById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE("companyId","unitId"),
 FOREIGN KEY("unitId","propertyId","companyId") REFERENCES "Unit"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "UnitAvailability_companyId_propertyId_status_idx" ON "UnitAvailability"("companyId","propertyId",status);
CREATE TABLE "LeasingProspect" (
 id TEXT PRIMARY KEY,"companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"unitId" TEXT,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254),phone TEXT CHECK(length(phone)<=40),"desiredMoveIn" DATE,
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=2000),status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,"submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE(id,"propertyId","companyId"),UNIQUE("companyId","createdById","submissionKey"),
 FOREIGN KEY("propertyId","companyId") REFERENCES "Property"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("unitId","propertyId","companyId") REFERENCES "Unit"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "LeasingProspect_companyId_propertyId_status_createdAt_id_idx" ON "LeasingProspect"("companyId","propertyId",status,"createdAt",id);
CREATE TABLE "ProspectFollowUp" (
 id TEXT PRIMARY KEY,"companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"prospectId" TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('tour','task')),title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),"dueOn" DATE NOT NULL,
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=2000),status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','cancelled')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY("prospectId","propertyId","companyId") REFERENCES "LeasingProspect"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "ProspectFollowUp_companyId_prospectId_dueOn_id_idx" ON "ProspectFollowUp"("companyId","prospectId","dueOn",id);
CREATE TABLE "RentalApplication" (
 id TEXT PRIMARY KEY,"companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"unitId" TEXT NOT NULL,"prospectId" TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=2000),status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','in_review','approved','rejected','withdrawn')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"contactId" TEXT,"leaseId" TEXT UNIQUE,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,"submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE(id,"propertyId","companyId"),UNIQUE("companyId","createdById","submissionKey"),
 FOREIGN KEY("prospectId","propertyId","companyId") REFERENCES "LeasingProspect"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("unitId","propertyId","companyId") REFERENCES "Unit"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("contactId","companyId") REFERENCES "ResidentContact"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("leaseId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK(("leaseId" IS NULL AND "contactId" IS NULL) OR ("leaseId" IS NOT NULL AND "contactId" IS NOT NULL AND status='approved'))
);
CREATE INDEX "RentalApplication_companyId_propertyId_status_createdAt_id_idx" ON "RentalApplication"("companyId","propertyId",status,"createdAt",id);
CREATE UNIQUE INDEX "RentalApplication_open_prospect_unit" ON "RentalApplication"("companyId","prospectId","unitId") WHERE "leaseId" IS NULL AND status IN ('draft','submitted','in_review','approved');
CREATE INDEX "RentalApplication_companyId_prospectId_idx" ON "RentalApplication"("companyId","prospectId");
CREATE TABLE "AdmissionsEvent" (
 id TEXT PRIMARY KEY,"companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,
 "entityType" TEXT NOT NULL CHECK("entityType" IN ('availability','prospect','follow_up','application')),"entityId" TEXT NOT NULL,
 action TEXT NOT NULL,"actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 version INTEGER NOT NULL CHECK(version>0),"submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,snapshot JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("companyId","actorId","submissionKey"),
 FOREIGN KEY("propertyId","companyId") REFERENCES "Property"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "AdmissionsEvent_companyId_entityType_entityId_createdAt_id_idx" ON "AdmissionsEvent"("companyId","entityType","entityId","createdAt",id);
DO $$ DECLARE target TEXT; BEGIN
 FOREACH target IN ARRAY ARRAY['UnitAvailability','LeasingProspect','ProspectFollowUp','RentalApplication','AdmissionsEvent'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',target);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',target);
 EXECUTE format('CREATE POLICY admissions_company ON %I TO propertyflow_runtime USING ("companyId"=current_setting(''app.company_id'',true)) WITH CHECK ("companyId"=current_setting(''app.company_id'',true))',target);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON "UnitAvailability","LeasingProspect","ProspectFollowUp","RentalApplication" TO propertyflow_runtime;
GRANT SELECT,INSERT ON "AdmissionsEvent" TO propertyflow_runtime;
CREATE FUNCTION retain_admissions_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Admissions history is immutable'; END $$;
CREATE TRIGGER retain_admissions_history BEFORE UPDATE OR DELETE ON "AdmissionsEvent" FOR EACH ROW EXECUTE FUNCTION retain_admissions_history();
CREATE FUNCTION retain_application_conversion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD."leaseId" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Converted applications retain their linked source records'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retain_application_conversion BEFORE UPDATE ON "RentalApplication" FOR EACH ROW EXECUTE FUNCTION retain_application_conversion();
COMMIT;
