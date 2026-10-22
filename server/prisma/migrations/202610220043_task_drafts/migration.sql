BEGIN;
CREATE TABLE "TaskDraft" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "propertyId" TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('lease_create','lease_renewal','inspection')),
 "sourceId" TEXT, "sourceVersions" JSONB NOT NULL, values JSONB NOT NULL, context JSONB NOT NULL,
 title TEXT NOT NULL CHECK(length(title)<=240), "actionKey" TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL, "lastMutationKey" TEXT, "lastMutationHash" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY("propertyId","companyId") REFERENCES "Property"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","userId","submissionKey"),
 CHECK(jsonb_typeof(values)='object' AND octet_length(values::text)<=65536),
 CHECK(jsonb_typeof(context)='object' AND octet_length(context::text)<=2048),
 CHECK(jsonb_typeof("sourceVersions")='object'), CHECK("expiresAt">"createdAt")
);
CREATE INDEX "TaskDraft_companyId_userId_expiresAt_updatedAt_id_idx" ON "TaskDraft"("companyId","userId","expiresAt","updatedAt",id);
ALTER TABLE "TaskDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskDraft" FORCE ROW LEVEL SECURITY;
CREATE POLICY task_draft_scope ON "TaskDraft" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true) AND "userId"=current_setting('app.task_draft_user_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true) AND "userId"=current_setting('app.task_draft_user_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON "TaskDraft" TO propertyflow_runtime;
CREATE FUNCTION protect_task_draft_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW."companyId",NEW."userId",NEW."propertyId",NEW.kind,NEW."sourceId",NEW."actionKey",NEW."submissionKey",NEW."submissionHash",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."companyId",OLD."userId",OLD."propertyId",OLD.kind,OLD."sourceId",OLD."actionKey",OLD."submissionKey",OLD."submissionHash",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Task identity and version must be preserved'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER protect_task_draft_identity BEFORE UPDATE ON "TaskDraft" FOR EACH ROW EXECUTE FUNCTION protect_task_draft_identity();
COMMIT;
