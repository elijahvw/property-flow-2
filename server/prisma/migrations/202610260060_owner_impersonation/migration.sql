-- Owner views can inspect accounts without a company. Membership context remains
-- either fully pinned or absent; existing company-only contexts remain valid.
ALTER TABLE "Session" DROP CONSTRAINT "Session_impersonation_complete";
ALTER TABLE "Session" ADD CONSTRAINT "Session_impersonation_complete" CHECK (
  ("impersonatedUserId" IS NULL AND "impersonationExpiresAt" IS NULL AND "impersonationReason" IS NULL AND "impersonationCompanyId" IS NULL AND "impersonationMembershipVersion" IS NULL)
  OR
  ("impersonatedUserId" IS NOT NULL AND "impersonationExpiresAt" IS NOT NULL AND "impersonationReason" IS NOT NULL
    AND (("impersonationCompanyId" IS NULL AND "impersonationMembershipVersion" IS NULL)
      OR ("impersonationCompanyId" IS NOT NULL AND "impersonationMembershipVersion" IS NOT NULL)))
);
