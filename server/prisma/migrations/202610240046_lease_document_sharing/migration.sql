BEGIN;
ALTER TABLE "PrivateDocument" ADD CONSTRAINT "PrivateDocument_share_source" UNIQUE(id,"leaseId","companyId");
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_share_source" UNIQUE(id,"documentId","companyId");
CREATE TABLE "LeaseDocumentShare" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
 "leaseId" TEXT NOT NULL, "documentId" TEXT NOT NULL, "documentVersionId" TEXT NOT NULL,
 "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), "expiresOn" DATE NOT NULL,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500), "revokedAt" TIMESTAMP(3),
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY("leaseId","companyId") REFERENCES "Lease"(id,"companyId") ON DELETE RESTRICT,
 FOREIGN KEY("documentId","leaseId","companyId") REFERENCES "PrivateDocument"(id,"leaseId","companyId") ON DELETE RESTRICT,
 FOREIGN KEY("documentVersionId","documentId","companyId") REFERENCES "DocumentVersion"(id,"documentId","companyId") ON DELETE RESTRICT,
 UNIQUE("companyId","documentVersionId","userId"), UNIQUE(id,"companyId")
);
CREATE INDEX "LeaseDocumentShare_companyId_userId_id_idx" ON "LeaseDocumentShare"("companyId","userId",id);
CREATE INDEX "LeaseDocumentShare_companyId_documentId_revokedAt_idx" ON "LeaseDocumentShare"("companyId","documentId","revokedAt");
CREATE TABLE "LeaseDocumentShareAction" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
 "shareId" TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('grant','revoke','source_archived')),
 detail JSONB NOT NULL, "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("shareId","companyId") REFERENCES "LeaseDocumentShare"(id,"companyId") ON DELETE RESTRICT,
 UNIQUE("companyId","submissionKey")
);
CREATE INDEX "LeaseDocumentShareAction_companyId_shareId_createdAt_idx" ON "LeaseDocumentShareAction"("companyId","shareId","createdAt");
ALTER TABLE "LeaseDocumentShare" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseDocumentShare" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LeaseDocumentShareAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseDocumentShareAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY lease_document_share_company ON "LeaseDocumentShare" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY lease_document_share_action_company ON "LeaseDocumentShareAction" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
GRANT SELECT,INSERT ON "LeaseDocumentShare","LeaseDocumentShareAction" TO propertyflow_runtime;
GRANT UPDATE(version,"expiresOn",reason,"revokedAt","updatedAt") ON "LeaseDocumentShare" TO propertyflow_runtime;
COMMIT;
