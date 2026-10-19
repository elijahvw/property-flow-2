BEGIN;
CREATE TABLE "Vendor" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160), "nameKey" TEXT NOT NULL,
 service TEXT CHECK(length(service)<=120), "contactName" TEXT CHECK(length("contactName")<=160),
 email TEXT CHECK(length(email)<=254), phone TEXT CHECK(length(phone)<=50), notes TEXT CHECK(length(notes)<=2000),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE(id,"companyId"), UNIQUE("companyId","nameKey")
);
CREATE INDEX "Vendor_companyId_status_name_id_idx" ON "Vendor"("companyId",status,name,id);
ALTER TABLE "MaintenanceRequest" ADD COLUMN "vendorId" TEXT,
 ADD CONSTRAINT maintenance_vendor_scope FOREIGN KEY ("vendorId","companyId") REFERENCES "Vendor"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "MaintenanceRequest_companyId_vendorId_createdAt_id_idx" ON "MaintenanceRequest"("companyId","vendorId","createdAt",id);
CREATE TABLE "VendorAction" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "vendorId" TEXT, "requestId" TEXT,
 "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('create','edit','archive','restore','link')),
 changed BOOLEAN NOT NULL DEFAULT true CHECK(changed OR action IN ('link','edit')),
 snapshot JSONB NOT NULL, "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("vendorId","companyId") REFERENCES "Vendor"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("requestId","companyId") REFERENCES "MaintenanceRequest"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK((action='link' AND "requestId" IS NOT NULL) OR (action<>'link' AND "vendorId" IS NOT NULL AND "requestId" IS NULL)),
 UNIQUE("companyId","actorId","submissionKey")
);
CREATE INDEX "VendorAction_companyId_vendorId_createdAt_id_idx" ON "VendorAction"("companyId","vendorId","createdAt",id);
CREATE INDEX "VendorAction_companyId_requestId_createdAt_id_idx" ON "VendorAction"("companyId","requestId","createdAt",id);
ALTER TABLE "Vendor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vendor" FORCE ROW LEVEL SECURITY;
ALTER TABLE "VendorAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VendorAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY vendor_company ON "Vendor" TO propertyflow_runtime
 USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY vendor_action_company ON "VendorAction" TO propertyflow_runtime
 USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
GRANT SELECT,INSERT,UPDATE ON "Vendor" TO propertyflow_runtime;
GRANT SELECT,INSERT ON "VendorAction" TO propertyflow_runtime;
CREATE FUNCTION retain_vendor_action() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Vendor history is immutable'; END $$;
CREATE TRIGGER retain_vendor_action BEFORE UPDATE OR DELETE ON "VendorAction" FOR EACH ROW EXECUTE FUNCTION retain_vendor_action();
COMMIT;
