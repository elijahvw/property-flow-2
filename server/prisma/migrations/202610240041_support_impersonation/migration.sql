-- The authenticated actor never changes. Acting access is bounded and rechecked
-- against the real target account and membership on each request.
ALTER TABLE "User" DROP CONSTRAINT "User_platformRole_check";
ALTER TABLE "User" ADD CONSTRAINT "User_platformRole_check"
  CHECK ("platformRole" IS NULL OR "platformRole" IN ('owner', 'support'));
ALTER TABLE "Session"
  ADD COLUMN "impersonatedUserId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN "impersonationExpiresAt" TIMESTAMP(3),
  ADD COLUMN "impersonationReason" TEXT,
  ADD COLUMN "impersonationCompanyId" TEXT,
  ADD COLUMN "impersonationMembershipVersion" INTEGER;
CREATE INDEX "Session_impersonatedUserId_idx" ON "Session"("impersonatedUserId");
ALTER TABLE "Session" ADD CONSTRAINT "Session_impersonation_complete" CHECK (
  ("impersonatedUserId" IS NULL AND "impersonationExpiresAt" IS NULL AND "impersonationReason" IS NULL AND "impersonationCompanyId" IS NULL AND "impersonationMembershipVersion" IS NULL)
  OR
  ("impersonatedUserId" IS NOT NULL AND "impersonationExpiresAt" IS NOT NULL AND "impersonationReason" IS NOT NULL AND "impersonationCompanyId" IS NOT NULL AND "impersonationMembershipVersion" IS NOT NULL)
);
