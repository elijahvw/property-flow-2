ALTER TABLE "User" ADD COLUMN "verificationSentAt" TIMESTAMP(3), ADD COLUMN "passwordSetupSentAt" TIMESTAMP(3), ADD COLUMN "firstSignedInAt" TIMESTAMP(3);
-- Existing initialized identities have already completed a sign-in; preprovisioned users will not.
UPDATE "User" SET "firstSignedInAt"="accessInitializedAt" WHERE "accessInitializedAt" IS NOT NULL;
CREATE TABLE "UserProvision" (
 "targetId" TEXT,
 "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,
 "submissionHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("actorId","submissionKey")
);
GRANT SELECT,INSERT ON "UserProvision" TO propertyflow_runtime;
GRANT UPDATE ("targetId") ON "UserProvision" TO propertyflow_runtime;
