-- Additional household members share one lease and its existing money sources.
-- The existing Lease.residentId remains the primary contact; no money is moved.
CREATE TABLE "LeaseParticipant" (
 "id" TEXT PRIMARY KEY,
 "companyId" TEXT NOT NULL,
 "propertyId" TEXT NOT NULL,
 "leaseId" TEXT NOT NULL,
 "userId" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "name" TEXT NOT NULL CHECK(length(btrim("name")) BETWEEN 1 AND 200),
 "email" TEXT CHECK("email" IS NULL OR length("email") BETWEEN 1 AND 254),
 "phone" TEXT CHECK("phone" IS NULL OR length("phone") BETWEEN 1 AND 40),
 "role" TEXT NOT NULL CHECK("role" IN ('leaseholder','occupant')),
 "startsOn" DATE NOT NULL,
 "endsOn" DATE CHECK("endsOn" IS NULL OR "endsOn">="startsOn"),
 "removedAt" TIMESTAMP(3),
 "version" INTEGER NOT NULL DEFAULT 1 CHECK("version">0),
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,
 "submissionHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY("leaseId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("leaseId","userId"),
 UNIQUE("companyId","createdById","submissionKey")
);
CREATE INDEX "LeaseParticipant_companyId_leaseId_idx" ON "LeaseParticipant"("companyId","leaseId");
CREATE INDEX "LeaseParticipant_companyId_userId_idx" ON "LeaseParticipant"("companyId","userId");
ALTER TABLE "LeaseParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseParticipant" FORCE ROW LEVEL SECURITY;
CREATE POLICY lease_participant_company_boundary ON "LeaseParticipant" FOR ALL TO propertyflow_runtime
 USING("companyId"=NULLIF(current_setting('app.company_id',true),''))
 WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT ON "LeaseParticipant" TO propertyflow_runtime;
GRANT UPDATE("name","email","phone","role","startsOn","endsOn","removedAt","version","updatedAt") ON "LeaseParticipant" TO propertyflow_runtime;
-- Retain the exact existing lease/User identities and financial rows. A roster
-- entry records each original primary resident; it never creates another lease.
INSERT INTO "LeaseParticipant"(id,"companyId","propertyId","leaseId","userId",name,email,role,"startsOn","createdById","submissionKey","submissionHash","updatedAt")
 SELECT 'lp-'||md5(l.id),l."companyId",l."propertyId",l.id,l."residentId",LEFT(COALESCE(NULLIF(btrim(u.name),''),u.email),200),CASE WHEN length(u.email)<=254 THEN u.email ELSE NULL END,'leaseholder',l."startsOn",l."createdById",'backfill:'||l.id,l."submissionHash",CURRENT_TIMESTAMP
 FROM "Lease" l JOIN "User" u ON u.id=l."residentId";

ALTER TABLE "Invitation" ADD COLUMN "leaseId" TEXT,
 ADD COLUMN "propertyId" TEXT,
 ADD COLUMN "participantRole" TEXT,
 ADD COLUMN "participantName" TEXT,
 ADD COLUMN "participantStartsOn" DATE,
 ADD COLUMN "approvedAt" TIMESTAMP(3),
 ADD COLUMN "approvedBy" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_lease_fkey" FOREIGN KEY("leaseId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_household_shape" CHECK(
 ("leaseId" IS NULL AND "propertyId" IS NULL AND "participantRole" IS NULL AND "participantName" IS NULL AND "participantStartsOn" IS NULL AND "approvedAt" IS NULL AND "approvedBy" IS NULL)
 OR ("leaseId" IS NOT NULL AND "propertyId" IS NOT NULL AND "participantRole" IS NOT NULL AND "participantRole" IN ('leaseholder','occupant') AND "participantName" IS NOT NULL AND length(btrim("participantName")) BETWEEN 1 AND 200 AND "participantStartsOn" IS NOT NULL AND role='resident' AND (("approvedAt" IS NULL AND "approvedBy" IS NULL) OR ("approvedAt" IS NOT NULL AND "approvedBy" IS NOT NULL)))
);
CREATE INDEX "Invitation_companyId_leaseId_idx" ON "Invitation"("companyId","leaseId");
