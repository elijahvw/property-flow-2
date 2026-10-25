BEGIN;
-- This small synchronization row is separate from account/company authority.
-- Publishers share it; a settings save changes its tuple before preferences.
CREATE TABLE "NotificationPreferenceFence" (
 "companyId" TEXT PRIMARY KEY REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 generation BIGINT NOT NULL DEFAULT 0 CHECK(generation>=0)
);
INSERT INTO "NotificationPreferenceFence"("companyId") SELECT id FROM "Company";
CREATE TABLE "NotificationPreference" (
 "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "maintenanceEnabled" BOOLEAN NOT NULL DEFAULT true,
 "workEnabled" BOOLEAN NOT NULL DEFAULT true,
 "inspectionsEnabled" BOOLEAN NOT NULL DEFAULT true,
 "agreementsEnabled" BOOLEAN NOT NULL DEFAULT true,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY("companyId","userId")
);
CREATE TABLE "NotificationPreferenceAction" (
 id TEXT PRIMARY KEY,
 "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
 "maintenanceEnabled" BOOLEAN NOT NULL,
 "workEnabled" BOOLEAN NOT NULL,
 "inspectionsEnabled" BOOLEAN NOT NULL,
 "agreementsEnabled" BOOLEAN NOT NULL,
 "appliedVersion" INTEGER NOT NULL CHECK("appliedVersion">0),
 changed BOOLEAN NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("companyId","userId") REFERENCES "NotificationPreference"("companyId","userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","userId","submissionKey")
);
CREATE INDEX "NotificationPreferenceAction_companyId_userId_createdAt_id_idx" ON "NotificationPreferenceAction"("companyId","userId","createdAt",id);
ALTER TABLE "NotificationPreferenceFence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreferenceFence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreference" FORCE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreferenceAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreferenceAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_preference_fence_select ON "NotificationPreferenceFence" FOR SELECT TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true));
CREATE POLICY notification_preference_fence_insert ON "NotificationPreferenceFence" FOR INSERT TO propertyflow_runtime WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY notification_preference_fence_update ON "NotificationPreferenceFence" FOR UPDATE TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY notification_preference_select ON "NotificationPreference" FOR SELECT TO propertyflow_runtime USING (
 "companyId"=current_setting('app.company_id',true) AND (
 "userId"=current_setting('app.notification_user_id',true) OR
 COALESCE(NULLIF(current_setting('app.notification_preference_recipients',true),''),'[]')::jsonb ? "userId"
 ));
CREATE POLICY notification_preference_insert ON "NotificationPreference" FOR INSERT TO propertyflow_runtime WITH CHECK ("companyId"=current_setting('app.company_id',true) AND "userId"=current_setting('app.notification_user_id',true));
CREATE POLICY notification_preference_update ON "NotificationPreference" FOR UPDATE TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true) AND "userId"=current_setting('app.notification_user_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true) AND "userId"=current_setting('app.notification_user_id',true));
CREATE POLICY notification_preference_action_select ON "NotificationPreferenceAction" FOR SELECT TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true) AND "userId"=current_setting('app.notification_user_id',true));
CREATE POLICY notification_preference_action_insert ON "NotificationPreferenceAction" FOR INSERT TO propertyflow_runtime WITH CHECK ("companyId"=current_setting('app.company_id',true) AND "userId"=current_setting('app.notification_user_id',true));
GRANT SELECT,INSERT ON "NotificationPreferenceFence","NotificationPreference","NotificationPreferenceAction" TO propertyflow_runtime;
GRANT UPDATE(generation) ON "NotificationPreferenceFence" TO propertyflow_runtime;
GRANT UPDATE("maintenanceEnabled","workEnabled","inspectionsEnabled","agreementsEnabled",version,"updatedAt") ON "NotificationPreference" TO propertyflow_runtime;
CREATE FUNCTION protect_notification_preference_fence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Notification preference fences are retained'; END IF;
 IF NEW."companyId" IS DISTINCT FROM OLD."companyId" OR NEW.generation<>OLD.generation+1 THEN
  RAISE EXCEPTION 'Only the notification preference fence generation may advance';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_notification_preference_fence BEFORE UPDATE OR DELETE ON "NotificationPreferenceFence" FOR EACH ROW EXECUTE FUNCTION protect_notification_preference_fence();
CREATE FUNCTION protect_notification_preference() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Notification preferences are retained'; END IF;
 IF (NEW."companyId",NEW."userId",NEW."createdAt") IS DISTINCT FROM (OLD."companyId",OLD."userId",OLD."createdAt")
 OR NEW.version<>OLD.version+1
 OR (NEW."maintenanceEnabled",NEW."workEnabled",NEW."inspectionsEnabled",NEW."agreementsEnabled") IS NOT DISTINCT FROM (OLD."maintenanceEnabled",OLD."workEnabled",OLD."inspectionsEnabled",OLD."agreementsEnabled") THEN
  RAISE EXCEPTION 'Only versioned notification preference choices may change';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_notification_preference BEFORE UPDATE OR DELETE ON "NotificationPreference" FOR EACH ROW EXECUTE FUNCTION protect_notification_preference();
CREATE TRIGGER retain_notification_preference_action BEFORE UPDATE OR DELETE ON "NotificationPreferenceAction" FOR EACH ROW EXECUTE FUNCTION retain_notification_history();
COMMIT;
