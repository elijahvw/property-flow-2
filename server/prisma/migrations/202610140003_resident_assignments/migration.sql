-- Additive only. Apply after independent review with the migration account.
CREATE UNIQUE INDEX "Property_id_companyId_key" ON "Property" ("id", "companyId");
CREATE UNIQUE INDEX "CompanyMembership_userId_companyId_key" ON "CompanyMembership" ("userId", "companyId");
CREATE TABLE "ResidentPropertyAssignment" (
  "companyId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("propertyId", "userId"),
  FOREIGN KEY ("propertyId", "companyId") REFERENCES "Property" ("id", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("userId", "companyId") REFERENCES "CompanyMembership" ("userId", "companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "ResidentPropertyAssignment_companyId_userId_idx" ON "ResidentPropertyAssignment" ("companyId", "userId");
ALTER TABLE "ResidentPropertyAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ResidentPropertyAssignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY resident_assignment_company_boundary ON "ResidentPropertyAssignment" FOR ALL TO propertyflow_runtime
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), ''))
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), ''));
GRANT SELECT, INSERT, UPDATE, DELETE ON "ResidentPropertyAssignment" TO propertyflow_runtime;
