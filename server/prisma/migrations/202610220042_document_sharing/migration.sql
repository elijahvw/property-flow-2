BEGIN;
ALTER TABLE "PrivateDocument" ADD CONSTRAINT "PrivateDocument_id_leaseId_companyId_key" UNIQUE(id,"leaseId","companyId");
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_id_documentId_companyId_key" UNIQUE(id,"documentId","companyId");
ALTER TABLE "LeaseParticipant" ADD CONSTRAINT "LeaseParticipant_id_leaseId_companyId_key" UNIQUE(id,"leaseId","companyId");
CREATE TABLE "DocumentShare" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "leaseId" TEXT NOT NULL, "documentId" TEXT NOT NULL,
 "documentVersionId" TEXT NOT NULL, "participantId" TEXT NOT NULL,
 "recipientId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "revokedAt" TIMESTAMP(3), "receivedAt" TIMESTAMP(3),
 FOREIGN KEY("leaseId","companyId") REFERENCES "Lease"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("documentId","leaseId","companyId") REFERENCES "PrivateDocument"(id,"leaseId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("documentVersionId","documentId","companyId") REFERENCES "DocumentVersion"(id,"documentId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("participantId","leaseId","companyId") REFERENCES "LeaseParticipant"(id,"leaseId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE(id,"companyId"), UNIQUE("companyId","createdById","submissionKey")
);
CREATE UNIQUE INDEX "document_share_active_recipient_version" ON "DocumentShare"("companyId","participantId","documentVersionId") WHERE "revokedAt" IS NULL;
CREATE INDEX "DocumentShare_companyId_leaseId_documentId_sharedAt_id_idx" ON "DocumentShare"("companyId","leaseId","documentId","sharedAt",id);
CREATE INDEX "DocumentShare_companyId_recipientId_sharedAt_id_idx" ON "DocumentShare"("companyId","recipientId","sharedAt",id);
CREATE TABLE "DocumentShareAction" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "shareId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('revoked','received','downloaded')),
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("shareId","companyId") REFERENCES "DocumentShare"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","actorId","submissionKey")
);
CREATE INDEX "DocumentShareAction_companyId_shareId_createdAt_id_idx" ON "DocumentShareAction"("companyId","shareId","createdAt",id);
ALTER TABLE "DocumentShare" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentShare" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DocumentShareAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentShareAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY document_share_company ON "DocumentShare" TO propertyflow_runtime USING("companyId"=current_setting('app.company_id',true)) WITH CHECK("companyId"=current_setting('app.company_id',true));
CREATE POLICY document_share_action_company ON "DocumentShareAction" TO propertyflow_runtime USING("companyId"=current_setting('app.company_id',true)) WITH CHECK("companyId"=current_setting('app.company_id',true));
GRANT SELECT,INSERT ON "DocumentShare" TO propertyflow_runtime;
GRANT UPDATE(version,"revokedAt","receivedAt") ON "DocumentShare" TO propertyflow_runtime;
GRANT SELECT,INSERT ON "DocumentShareAction" TO propertyflow_runtime;
CREATE FUNCTION retain_document_share_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Document sharing history is retained'; END IF;
 IF ROW(NEW.id,NEW."companyId",NEW."leaseId",NEW."documentId",NEW."documentVersionId",NEW."participantId",NEW."recipientId",NEW."createdById",NEW."submissionKey",NEW."submissionHash",NEW."sharedAt") IS DISTINCT FROM ROW(OLD.id,OLD."companyId",OLD."leaseId",OLD."documentId",OLD."documentVersionId",OLD."participantId",OLD."recipientId",OLD."createdById",OLD."submissionKey",OLD."submissionHash",OLD."sharedAt") THEN RAISE EXCEPTION 'Document share identity is immutable'; END IF;
 IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN RAISE EXCEPTION 'Revoked sharing cannot be restored'; END IF;
 IF OLD."receivedAt" IS NOT NULL AND NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt" THEN RAISE EXCEPTION 'Document receipt is immutable'; END IF;
 IF NEW.version<>OLD.version+1 OR ((NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt")::int+(NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt")::int)<>1 OR OLD."revokedAt" IS NOT NULL THEN RAISE EXCEPTION 'Use one reviewed document sharing transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retain_document_share BEFORE UPDATE OR DELETE ON "DocumentShare" FOR EACH ROW EXECUTE FUNCTION retain_document_share_identity();
CREATE FUNCTION retain_document_share_action() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Document sharing history is immutable'; END $$;
CREATE TRIGGER retain_document_share_action BEFORE UPDATE OR DELETE ON "DocumentShareAction" FOR EACH ROW EXECUTE FUNCTION retain_document_share_action();
COMMIT;
