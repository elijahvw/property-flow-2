-- Demo generations retain their source and audit records when retired.
CREATE TABLE "SalesDemo" (
 id TEXT PRIMARY KEY,
 "companyId" TEXT NOT NULL UNIQUE REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "ownerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,
 "submissionHash" TEXT NOT NULL,
 "seedVersion" INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','retired')),
 version INTEGER NOT NULL DEFAULT 1,
 manifest JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "retiredAt" TIMESTAMP(3),
 UNIQUE ("createdById","submissionKey")
);
CREATE INDEX "SalesDemo_ownerId_status_idx" ON "SalesDemo"("ownerId",status);
CREATE UNIQUE INDEX sales_demo_one_ready_owner ON "SalesDemo"("ownerId") WHERE status='ready';
GRANT SELECT,INSERT ON "SalesDemo" TO propertyflow_runtime;
GRANT UPDATE(status,version,"retiredAt") ON "SalesDemo" TO propertyflow_runtime;
