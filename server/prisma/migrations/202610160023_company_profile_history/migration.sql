BEGIN;
CREATE TABLE "CompanyProfileRevision" (
 id TEXT PRIMARY KEY,"companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 version INTEGER NOT NULL CHECK(version>0),"before" JSONB NOT NULL,"after" JSONB NOT NULL,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("companyId",version),UNIQUE("companyId","createdById","submissionKey")
);
ALTER TABLE "CompanyProfileRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyProfileRevision" FORCE ROW LEVEL SECURITY;
CREATE POLICY company_profile_boundary ON "CompanyProfileRevision" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT ON "CompanyProfileRevision" TO propertyflow_runtime;
COMMIT;
