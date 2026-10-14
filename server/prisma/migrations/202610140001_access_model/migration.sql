-- Additive upgrade: retain legacy identities, assignments and property records.
-- Legacy role/companyId fields are review evidence only, never new grants.
ALTER TABLE "Company" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "Company" ADD CONSTRAINT "Company_status_check" CHECK ("status" IN ('active','suspended'));
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'unassigned';
ALTER TABLE "User" ADD COLUMN "platformRole" TEXT, ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active', ADD COLUMN "accessInitializedAt" TIMESTAMP(3), ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD CONSTRAINT "User_status_check" CHECK ("status" IN ('active','disabled'));
ALTER TABLE "User" ADD CONSTRAINT "User_platformRole_check" CHECK ("platformRole" IS NULL OR "platformRole" = 'owner');
CREATE TABLE "Identity" ("id" TEXT PRIMARY KEY, "issuer" TEXT NOT NULL, "subject" TEXT NOT NULL, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE);
CREATE UNIQUE INDEX "Identity_issuer_subject_key" ON "Identity"("issuer","subject");
CREATE TABLE "CompanyMembership" ("userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE, "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE, "role" TEXT NOT NULL CHECK ("role" IN ('owner','manager','staff','resident')), "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active','disabled')), "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "CompanyMembership_companyId_idx" ON "CompanyMembership"("companyId");
CREATE TABLE "Invitation" ("id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE, "email" TEXT NOT NULL, "role" TEXT NOT NULL CHECK ("role" IN ('owner','manager','staff','resident')), "tokenHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "acceptedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");
CREATE INDEX "Invitation_companyId_idx" ON "Invitation"("companyId");
CREATE TABLE "Session" ("tokenHash" TEXT PRIMARY KEY, "csrfToken" TEXT NOT NULL, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE, "expiresAt" TIMESTAMP(3) NOT NULL, "idleExpiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE TABLE "LoginTransaction" ("stateHash" TEXT PRIMARY KEY, "bindingHash" TEXT NOT NULL, "verifier" TEXT NOT NULL, "nonce" TEXT NOT NULL, "returnTo" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "LoginTransaction_expiresAt_idx" ON "LoginTransaction"("expiresAt");
CREATE TABLE "AuditEvent" ("id" TEXT PRIMARY KEY, "actorId" TEXT NOT NULL, "companyId" TEXT, "action" TEXT NOT NULL, "targetId" TEXT, "detail" JSONB, "requestId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "AuditEvent_companyId_createdAt_idx" ON "AuditEvent"("companyId","createdAt");
