CREATE TABLE "SalesDemoSetup" (
 id TEXT PRIMARY KEY,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,
 "submissionHash" TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','retiring','retired')),
 "credentialsCipher" TEXT NOT NULL,
 accounts JSONB NOT NULL DEFAULT '{}',
 "salesDemoId" TEXT UNIQUE REFERENCES "SalesDemo"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "leaseToken" TEXT,
 "leaseUntil" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("createdById","submissionKey")
);
GRANT SELECT,INSERT,UPDATE ON "SalesDemoSetup" TO propertyflow_runtime;
