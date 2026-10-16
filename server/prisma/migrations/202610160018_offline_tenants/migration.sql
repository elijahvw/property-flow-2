BEGIN;
ALTER TABLE "ResidentContact"
 ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
 ADD COLUMN "preferredName" TEXT, ADD COLUMN "alternatePhone" TEXT,
 ADD COLUMN "preferredContact" TEXT CHECK("preferredContact" IS NULL OR "preferredContact" IN ('email','phone')),
 ADD COLUMN "addressLine1" TEXT, ADD COLUMN "addressLine2" TEXT,
 ADD COLUMN city TEXT, ADD COLUMN region TEXT, ADD COLUMN "postalCode" TEXT, ADD COLUMN country TEXT,
 ADD COLUMN "emergencyRelationship" TEXT,
 ADD COLUMN "createdById" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD COLUMN "submissionKey" TEXT, ADD COLUMN "submissionHash" TEXT,
 ADD CONSTRAINT "ResidentContact_companyId_createdById_submissionKey_key" UNIQUE("companyId","createdById","submissionKey");
GRANT UPDATE(status,"preferredName","alternatePhone","preferredContact","addressLine1","addressLine2",city,region,"postalCode",country,"emergencyRelationship") ON "ResidentContact" TO propertyflow_runtime;

-- Catch up rows written by the previous application during the PF-03a rollout.
-- No existing person/source identity is replaced. Membership fields are copied
-- only from this company's membership, regardless of its now-current role.
WITH people AS (
 SELECT "companyId","userId" FROM "CompanyMembership" WHERE role='resident'
 UNION SELECT "companyId","residentId" FROM "Lease" WHERE "residentId" IS NOT NULL
 UNION SELECT "companyId","userId" FROM "LeaseParticipant" WHERE "userId" IS NOT NULL
)
INSERT INTO "ResidentContact"(id,"companyId","userId",name,email,phone,"emergencyContactName","emergencyContactPhone","managementNotes","compatibilityProfile","updatedAt")
 SELECT 'rc-'||md5(json_build_array(p."companyId",p."userId")::text),p."companyId",p."userId",
 LEFT(COALESCE(NULLIF(btrim(m."contactName"),''),NULLIF(btrim(u.name),''),NULLIF(btrim(u.email),''),'Resident'),200),
 CASE WHEN length(u.email) BETWEEN 1 AND 254 THEN u.email ELSE NULL END,
 m."contactPhone",m."emergencyContactName",m."emergencyContactPhone",m."managementNotes",
 CASE WHEN m."userId" IS NOT NULL THEN jsonb_build_object('contactName',m."contactName",'contactPhone',m."contactPhone",'emergencyContactName',m."emergencyContactName",'emergencyContactPhone',m."emergencyContactPhone",'managementNotes',m."managementNotes") ELSE NULL END,CURRENT_TIMESTAMP
 FROM people p JOIN "User" u ON u.id=p."userId"
 LEFT JOIN "CompanyMembership" m ON m."companyId"=p."companyId" AND m."userId"=p."userId"
 ON CONFLICT("companyId","userId") DO NOTHING;
INSERT INTO "ResidentContact"(id,"companyId",name,email,phone,"updatedAt")
 SELECT 'rcp-'||md5(id),"companyId",name,email,phone,CURRENT_TIMESTAMP FROM "LeaseParticipant"
 WHERE "userId" IS NULL AND "contactId" IS NULL ON CONFLICT(id) DO NOTHING;
UPDATE "Lease" l SET "residentContactId"=c.id FROM "ResidentContact" c WHERE l."residentContactId" IS NULL AND c."companyId"=l."companyId" AND c."userId"=l."residentId";
UPDATE "LeaseParticipant" p SET "contactId"=c.id FROM "ResidentContact" c WHERE p."contactId" IS NULL AND c."companyId"=p."companyId" AND c."userId"=p."userId";
UPDATE "LeaseParticipant" SET "contactId"='rcp-'||md5(id) WHERE "contactId" IS NULL AND "userId" IS NULL;
ALTER TABLE "Lease" ALTER COLUMN "residentId" DROP NOT NULL;
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_primary_identity_required" CHECK("residentId" IS NOT NULL OR "residentContactId" IS NOT NULL);
ALTER TABLE "Invitation" ADD COLUMN "contactId" TEXT, ADD COLUMN "contactLeaseApprovals" JSONB;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_contactId_companyId_fkey" FOREIGN KEY("contactId","companyId") REFERENCES "ResidentContact"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "Invitation_companyId_contactId_idx" ON "Invitation"("companyId","contactId");
GRANT UPDATE("userId") ON "LeaseParticipant" TO propertyflow_runtime;
GRANT UPDATE("userId") ON "ResidentContact" TO propertyflow_runtime;
-- Linking is permitted only from an unlinked contact to one exact account.
CREATE FUNCTION preserve_contact_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."companyId"<>OLD."companyId" OR (OLD."userId" IS NOT NULL AND NEW."userId" IS DISTINCT FROM OLD."userId") THEN RAISE EXCEPTION 'Contact identity mapping is retained' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER resident_contact_identity_guard BEFORE UPDATE ON "ResidentContact" FOR EACH ROW EXECUTE FUNCTION preserve_contact_identity();
CREATE TRIGGER lease_participant_identity_guard BEFORE UPDATE ON "LeaseParticipant" FOR EACH ROW EXECUTE FUNCTION preserve_contact_identity();
COMMIT;
