BEGIN;

-- PF-03a: additive contact identity bridge. Existing source IDs and portal
-- authorization remain unchanged. Nullable bridge columns let the previous
-- application continue running during rollout; new application writes fill them.
CREATE TABLE "ResidentContact" (
 "id" TEXT PRIMARY KEY,
 "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "userId" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "name" TEXT NOT NULL CHECK(length(btrim("name")) BETWEEN 1 AND 200),
 "email" TEXT CHECK("email" IS NULL OR length("email") BETWEEN 1 AND 254),
 "phone" TEXT CHECK("phone" IS NULL OR length("phone") BETWEEN 1 AND 40),
 "emergencyContactName" TEXT,
 "emergencyContactPhone" TEXT,
 "managementNotes" TEXT,
 "version" INTEGER NOT NULL DEFAULT 1 CHECK("version">0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE("id","companyId"),
 UNIQUE("companyId","userId")
);
CREATE INDEX "ResidentContact_companyId_name_id_idx" ON "ResidentContact"("companyId","name","id");
ALTER TABLE "Lease" ADD COLUMN "residentContactId" TEXT;
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_residentContactId_companyId_fkey"
 FOREIGN KEY("residentContactId","companyId") REFERENCES "ResidentContact"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "Lease_companyId_residentContactId_idx" ON "Lease"("companyId","residentContactId");
ALTER TABLE "LeaseParticipant" ADD COLUMN "contactId" TEXT;
ALTER TABLE "LeaseParticipant" ADD CONSTRAINT "LeaseParticipant_contactId_companyId_fkey"
 FOREIGN KEY("contactId","companyId") REFERENCES "ResidentContact"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "LeaseParticipant_companyId_contactId_idx" ON "LeaseParticipant"("companyId","contactId");

-- Map by exact company and stored User ID only, including former residents.
-- Contact details from a membership now in another company must never leak back
-- into a historical lease's company. Equal emails/names never merge contacts.
WITH people AS (
 SELECT "companyId","userId" FROM "CompanyMembership" WHERE role='resident'
 UNION SELECT "companyId","residentId" FROM "Lease"
 UNION SELECT "companyId","userId" FROM "LeaseParticipant" WHERE "userId" IS NOT NULL
)
INSERT INTO "ResidentContact"(id,"companyId","userId",name,email,phone,"emergencyContactName","emergencyContactPhone","managementNotes","createdAt","updatedAt")
 SELECT 'rc-'||md5(json_build_array(p."companyId",p."userId")::text),p."companyId",p."userId",
 LEFT(COALESCE(NULLIF(btrim(m."contactName"),''),NULLIF(btrim(u.name),''),NULLIF(btrim(u.email),''),'Resident'),200),
 CASE WHEN length(u.email) BETWEEN 1 AND 254 THEN u.email ELSE NULL END,
 m."contactPhone",m."emergencyContactName",m."emergencyContactPhone",m."managementNotes",COALESCE(m."createdAt",u."createdAt"),CURRENT_TIMESTAMP
 FROM people p JOIN "User" u ON u.id=p."userId"
 LEFT JOIN "CompanyMembership" m ON m."companyId"=p."companyId" AND m."userId"=p."userId" AND m.role='resident';

-- Record-only household entries have no identity to deduplicate by. Keep each
-- one distinct rather than guessing that a matching name/email is one person.
INSERT INTO "ResidentContact"(id,"companyId",name,email,phone,"createdAt","updatedAt")
 SELECT 'rcp-'||md5(id),"companyId",name,email,phone,"createdAt",CURRENT_TIMESTAMP
 FROM "LeaseParticipant" WHERE "userId" IS NULL;
UPDATE "Lease" l SET "residentContactId"=c.id FROM "ResidentContact" c
 WHERE c."companyId"=l."companyId" AND c."userId"=l."residentId";
UPDATE "LeaseParticipant" p SET "contactId"=c.id FROM "ResidentContact" c
 WHERE c."companyId"=p."companyId" AND c."userId"=p."userId";
UPDATE "LeaseParticipant" SET "contactId"='rcp-'||md5(id) WHERE "userId" IS NULL;

ALTER TABLE "ResidentContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ResidentContact" FORCE ROW LEVEL SECURITY;
CREATE POLICY resident_contact_company_boundary ON "ResidentContact" FOR ALL TO propertyflow_runtime
 USING("companyId"=NULLIF(current_setting('app.company_id',true),''))
 WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT ON "ResidentContact" TO propertyflow_runtime;
GRANT UPDATE("name","email","phone","emergencyContactName","emergencyContactPhone","managementNotes","version","updatedAt") ON "ResidentContact" TO propertyflow_runtime;
GRANT UPDATE("residentContactId") ON "Lease" TO propertyflow_runtime;
GRANT UPDATE("contactId") ON "LeaseParticipant" TO propertyflow_runtime;

COMMIT;
