ALTER TABLE "User" ADD COLUMN "credentialChangedAt" TIMESTAMP(3);
CREATE TABLE "ManualPasswordOperation" (
  id TEXT PRIMARY KEY,
  "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "companyId" TEXT REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  "submissionKey" TEXT NOT NULL,
  "submissionHash" TEXT NOT NULL,
  "contextHash" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','failed','uncertain','abandoned')),
  "leaseUntil" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("actorId","submissionKey")
);
CREATE INDEX "ManualPasswordOperation_userId_status_idx" ON "ManualPasswordOperation"("userId",status);
CREATE UNIQUE INDEX "ManualPasswordOperation_active_user" ON "ManualPasswordOperation"("userId") WHERE status IN ('pending','uncertain');
GRANT SELECT,INSERT,UPDATE ON "ManualPasswordOperation" TO propertyflow_runtime;
