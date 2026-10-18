BEGIN;
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_id_companyId_key" UNIQUE(id,"companyId");
-- Small private originals stay in the application database: never in the public frontend bucket.
CREATE TABLE "PrivateDocument" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "leaseId" TEXT, "requestId" TEXT,
 title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
 version INTEGER NOT NULL DEFAULT 1, "archivedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("leaseId" IS NOT NULL)::int + ("requestId" IS NOT NULL)::int = 1),
 FOREIGN KEY ("leaseId","companyId") REFERENCES "Lease"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("requestId","companyId") REFERENCES "MaintenanceRequest"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE(id,"companyId")
);
CREATE TABLE "DocumentVersion" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "documentId" TEXT NOT NULL, number INTEGER NOT NULL CHECK(number>0),
 filename TEXT NOT NULL, "mediaType" TEXT NOT NULL, "byteLength" INTEGER NOT NULL CHECK("byteLength" BETWEEN 1 AND 5242880),
 sha256 TEXT NOT NULL, content BYTEA NOT NULL CHECK(octet_length(content)="byteLength"),
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
 "scanStatus" TEXT NOT NULL DEFAULT 'pending' CHECK("scanStatus" IN ('pending','clean','rejected')),
 "scannedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("documentId","companyId") REFERENCES "PrivateDocument"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("documentId",number), UNIQUE("companyId","createdById","submissionKey")
);
CREATE INDEX "PrivateDocument_companyId_leaseId_requestId_idx" ON "PrivateDocument"("companyId","leaseId","requestId");
CREATE INDEX "DocumentVersion_companyId_documentId_idx" ON "DocumentVersion"("companyId","documentId");
ALTER TABLE "PrivateDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PrivateDocument" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DocumentVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY private_document_company ON "PrivateDocument" TO propertyflow_runtime
 USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY document_version_company ON "DocumentVersion" TO propertyflow_runtime
 USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
GRANT SELECT,INSERT ON "PrivateDocument","DocumentVersion" TO propertyflow_runtime;
GRANT UPDATE(version,"archivedAt") ON "PrivateDocument" TO propertyflow_runtime;
GRANT UPDATE("scanStatus","scannedAt") ON "DocumentVersion" TO propertyflow_runtime;
-- Originals remain immutable even for privileged application connections.
CREATE FUNCTION preserve_document_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Document originals are retained'; END IF;
 IF (to_jsonb(NEW)-'scanStatus'-'scannedAt') IS DISTINCT FROM (to_jsonb(OLD)-'scanStatus'-'scannedAt') OR OLD."scanStatus"<>'pending' OR NEW."scanStatus" NOT IN ('clean','rejected') OR NEW."scannedAt" IS NULL
 THEN RAISE EXCEPTION 'Document originals and scan verdicts are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_document_version BEFORE UPDATE OR DELETE ON "DocumentVersion" FOR EACH ROW EXECUTE FUNCTION preserve_document_version();
COMMIT;
