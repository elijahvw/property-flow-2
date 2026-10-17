BEGIN;
CREATE TABLE "AccountProfile" (
 "userId" TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 version INTEGER NOT NULL CHECK(version>0),details JSONB NOT NULL CHECK(jsonb_typeof(details)='object'),"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "AccountProfileRevision" (
 id TEXT PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES "AccountProfile"("userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 version INTEGER NOT NULL CHECK(version>0),details JSONB NOT NULL CHECK(jsonb_typeof(details)='object'),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,UNIQUE("userId",version),UNIQUE("userId","submissionKey")
);
ALTER TABLE "AccountProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountProfile" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AccountProfileRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountProfileRevision" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_profile ON "AccountProfile" FOR ALL TO propertyflow_runtime USING("userId"=NULLIF(current_setting('app.user_id',true),'')) WITH CHECK("userId"=NULLIF(current_setting('app.user_id',true),''));
CREATE POLICY own_profile_history ON "AccountProfileRevision" FOR ALL TO propertyflow_runtime USING("userId"=NULLIF(current_setting('app.user_id',true),'')) WITH CHECK("userId"=NULLIF(current_setting('app.user_id',true),''));
GRANT SELECT,INSERT ON "AccountProfile","AccountProfileRevision" TO propertyflow_runtime;
GRANT UPDATE(version,details,"updatedAt") ON "AccountProfile" TO propertyflow_runtime;
CREATE FUNCTION require_account_profile_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Profile change requires next version' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "AccountProfileRevision" r WHERE r."userId"=NEW."userId" AND r.version=NEW.version AND (r.details-'name')=NEW.details) THEN RAISE EXCEPTION 'Profile change requires immutable revision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER account_profile_revision_required AFTER INSERT OR UPDATE ON "AccountProfile" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_account_profile_revision();
COMMIT;
