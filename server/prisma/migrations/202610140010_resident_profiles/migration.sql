-- Contact records belong to the company membership, never to the sign-in identity.
ALTER TABLE "CompanyMembership" ADD COLUMN "contactName" TEXT,
 ADD COLUMN "contactPhone" TEXT, ADD COLUMN "emergencyContactName" TEXT,
 ADD COLUMN "emergencyContactPhone" TEXT, ADD COLUMN "managementNotes" TEXT;

-- Account activity filters before limiting; support both subject and actor lookups.
CREATE INDEX "AuditEvent_targetId_createdAt_idx" ON "AuditEvent"("targetId","createdAt");
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId","createdAt");
