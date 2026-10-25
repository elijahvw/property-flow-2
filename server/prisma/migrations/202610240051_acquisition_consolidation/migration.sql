BEGIN;
-- Current readiness/prospect sources remain canonical. Listing intent is a
-- separate explicit owner record; no backfill can advertise an existing unit.
CREATE UNIQUE INDEX "Prospect_id_propertyId_companyId_key" ON "Prospect"(id,"propertyId","companyId");
CREATE TABLE "UnitRentalListing" (
 "unitId" TEXT PRIMARY KEY,"companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,
 "forRent" BOOLEAN NOT NULL DEFAULT false,"listedAt" TIMESTAMP(3),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "updatedById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE("unitId","propertyId","companyId"),
 CHECK(("forRent" AND "listedAt" IS NOT NULL) OR (NOT "forRent" AND "listedAt" IS NULL)),
 FOREIGN KEY("unitId","propertyId","companyId") REFERENCES "Unit"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "UnitRentalListing_companyId_propertyId_forRent_idx" ON "UnitRentalListing"("companyId","propertyId","forRent");
CREATE TABLE "ProspectFollowUp" (
 id TEXT PRIMARY KEY,"companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"prospectId" TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('tour','task')),title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),"dueOn" DATE NOT NULL,
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=2000),status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','cancelled')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY("prospectId","propertyId","companyId") REFERENCES "Prospect"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "ProspectFollowUp_companyId_prospectId_dueOn_id_idx" ON "ProspectFollowUp"("companyId","prospectId","dueOn",id);
CREATE TABLE "RentalApplication" (
 id TEXT PRIMARY KEY,"companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"unitId" TEXT NOT NULL,"prospectId" TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=2000),status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','in_review','approved','rejected','withdrawn')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),"contactId" TEXT,"leaseId" TEXT UNIQUE,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,"submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE(id,"propertyId","companyId"),UNIQUE("companyId","createdById","submissionKey"),
 FOREIGN KEY("prospectId","propertyId","companyId") REFERENCES "Prospect"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
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
 "entityType" TEXT NOT NULL CHECK("entityType" IN ('unit_listing','follow_up','application')),"entityId" TEXT NOT NULL,
 action TEXT NOT NULL,"actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 version INTEGER NOT NULL CHECK(version>0),"submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,snapshot JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("companyId","actorId","submissionKey"),
 FOREIGN KEY("propertyId","companyId") REFERENCES "Property"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "AdmissionsEvent_companyId_entityType_entityId_createdAt_id_idx" ON "AdmissionsEvent"("companyId","entityType","entityId","createdAt",id);
DO $$ DECLARE target TEXT; BEGIN
 FOREACH target IN ARRAY ARRAY['UnitRentalListing','ProspectFollowUp','RentalApplication','AdmissionsEvent'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',target);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',target);
 EXECUTE format('CREATE POLICY admissions_company ON %I TO propertyflow_runtime USING ("companyId"=current_setting(''app.company_id'',true)) WITH CHECK ("companyId"=current_setting(''app.company_id'',true))',target);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON "UnitRentalListing","ProspectFollowUp","RentalApplication" TO propertyflow_runtime;
GRANT SELECT,INSERT ON "AdmissionsEvent" TO propertyflow_runtime;
CREATE FUNCTION retain_admissions_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Admissions history is immutable'; END $$;
CREATE TRIGGER retain_admissions_history BEFORE UPDATE OR DELETE ON "AdmissionsEvent" FOR EACH ROW EXECUTE FUNCTION retain_admissions_history();
CREATE FUNCTION retain_acquisition_sources() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (to_jsonb(NEW) - ARRAY['forRent','listedAt','version','updatedById','updatedAt','kind','title','dueOn','notes','status']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['forRent','listedAt','version','updatedById','updatedAt','kind','title','dueOn','notes','status']) THEN RAISE EXCEPTION 'Acquisition source identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retain_listing_source BEFORE UPDATE ON "UnitRentalListing" FOR EACH ROW EXECUTE FUNCTION retain_acquisition_sources();
CREATE TRIGGER retain_followup_source BEFORE UPDATE ON "ProspectFollowUp" FOR EACH ROW EXECUTE FUNCTION retain_acquisition_sources();
CREATE FUNCTION retain_application_conversion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW."companyId",NEW."propertyId",NEW."unitId",NEW."prospectId",NEW."createdById",NEW."submissionKey",NEW."submissionHash",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."companyId",OLD."propertyId",OLD."unitId",OLD."prospectId",OLD."createdById",OLD."submissionKey",OLD."submissionHash",OLD."createdAt") THEN RAISE EXCEPTION 'Application source identity is immutable'; END IF;
 IF OLD."leaseId" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Converted applications retain their linked source records'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retain_application_conversion BEFORE UPDATE ON "RentalApplication" FOR EACH ROW EXECUTE FUNCTION retain_application_conversion();
COMMIT;
