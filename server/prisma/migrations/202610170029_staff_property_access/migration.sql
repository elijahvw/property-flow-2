BEGIN;
ALTER TABLE "CompanyMembership" ADD COLUMN "staffPropertyScope" TEXT NOT NULL DEFAULT 'all'
  CHECK ("staffPropertyScope" IN ('all', 'selected'));
CREATE TABLE "StaffPropertyAccess" (
  "companyId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  PRIMARY KEY ("propertyId", "userId"),
  FOREIGN KEY ("propertyId", "companyId") REFERENCES "Property"(id, "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("userId", "companyId") REFERENCES "CompanyMembership"("userId", "companyId") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE INDEX "StaffPropertyAccess_companyId_userId_idx" ON "StaffPropertyAccess"("companyId", "userId");
ALTER TABLE "StaffPropertyAccess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffPropertyAccess" FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_property_company ON "StaffPropertyAccess"
  USING ("companyId" = current_setting('app.company_id', true))
  WITH CHECK ("companyId" = current_setting('app.company_id', true));
GRANT SELECT, INSERT, DELETE ON "StaffPropertyAccess" TO propertyflow_runtime;
COMMIT;
