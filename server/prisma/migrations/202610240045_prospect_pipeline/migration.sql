BEGIN;
CREATE TABLE "Prospect" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
 "propertyId" TEXT NOT NULL, "unitId" TEXT,
 name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200), email TEXT CHECK(length(email)<=254),
 phone TEXT CHECK(length(phone)<=40), source TEXT NOT NULL CHECK(source IN ('phone','email','walk_in','referral','other')),
 "desiredMoveIn" DATE, "followUpOn" DATE, notes TEXT CHECK(length(notes)<=2000),
 stage TEXT NOT NULL DEFAULT 'inquiry' CHECK(stage IN ('inquiry','tour','application','review','approved','declined','withdrawn','converted')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), "contactId" TEXT, "leaseId" TEXT,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY("propertyId","companyId") REFERENCES "Property"(id,"companyId") ON DELETE RESTRICT,
 FOREIGN KEY("unitId","propertyId","companyId") REFERENCES "Unit"(id,"propertyId","companyId") ON DELETE RESTRICT,
 FOREIGN KEY("contactId","companyId") REFERENCES "ResidentContact"(id,"companyId") ON DELETE RESTRICT,
 FOREIGN KEY("leaseId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT,
 UNIQUE(id,"companyId"), UNIQUE("companyId","leaseId"), CHECK(NULLIF(btrim(email),'') IS NOT NULL OR NULLIF(btrim(phone),'') IS NOT NULL),
 CHECK((stage='converted' AND "contactId" IS NOT NULL AND "leaseId" IS NOT NULL) OR (stage<>'converted' AND "contactId" IS NULL AND "leaseId" IS NULL))
);
CREATE INDEX "Prospect_companyId_propertyId_stage_id_idx" ON "Prospect"("companyId","propertyId",stage,id);
CREATE INDEX "Prospect_companyId_followUpOn_id_idx" ON "Prospect"("companyId","followUpOn",id);
CREATE TABLE "ProspectAction" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
 "prospectId" TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 action TEXT NOT NULL CHECK(action IN ('created','updated','stage.changed','converted','conversion.reopened')),
 snapshot JSONB NOT NULL, reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("prospectId","companyId") REFERENCES "Prospect"(id,"companyId") ON DELETE RESTRICT,
 UNIQUE("companyId","submissionKey"), UNIQUE("prospectId",version)
);
CREATE INDEX "ProspectAction_companyId_prospectId_createdAt_idx" ON "ProspectAction"("companyId","prospectId","createdAt");
ALTER TABLE "Prospect" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Prospect" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProspectAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProspectAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY prospect_company ON "Prospect" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY prospect_action_company ON "ProspectAction" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
GRANT SELECT,INSERT ON "Prospect","ProspectAction" TO propertyflow_runtime;
GRANT UPDATE("unitId",name,email,phone,source,"desiredMoveIn","followUpOn",notes,stage,version,"contactId","leaseId","updatedAt") ON "Prospect" TO propertyflow_runtime;
COMMIT;
