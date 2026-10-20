BEGIN;
CREATE TABLE "NotificationEvent" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "eventKey" TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('maintenance.created','maintenance.status','maintenance.update','work.assigned','work.reopened','work.approved','work.review','inspection.review','agreement.review','agreement.approved','agreement.changes')),
 "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "propertyId" TEXT NOT NULL, "sourceType" TEXT NOT NULL,
 "requestId" TEXT, "leaseId" TEXT, "inspectionId" TEXT, "agreementId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("sourceType" IN ('maintenance','work') AND "requestId" IS NOT NULL AND "leaseId" IS NULL AND "inspectionId" IS NULL AND "agreementId" IS NULL)
 OR ("sourceType"='inspections' AND "requestId" IS NULL AND "leaseId" IS NOT NULL AND "inspectionId" IS NOT NULL AND "agreementId" IS NULL)
 OR ("sourceType"='agreements' AND "requestId" IS NULL AND "leaseId" IS NOT NULL AND "inspectionId" IS NULL AND "agreementId" IS NOT NULL)),
 CHECK ((kind LIKE 'maintenance.%' AND "sourceType"='maintenance') OR (kind LIKE 'work.%' AND "sourceType"='work') OR (kind='inspection.review' AND "sourceType"='inspections') OR (kind LIKE 'agreement.%' AND "sourceType"='agreements')),
 FOREIGN KEY ("propertyId","companyId") REFERENCES "Property"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("requestId","propertyId","companyId") REFERENCES "MaintenanceRequest"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("leaseId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("inspectionId","leaseId","companyId") REFERENCES "LeaseInspection"(id,"leaseId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("agreementId","leaseId","companyId") REFERENCES "LeaseAgreement"(id,"leaseId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE(id,"companyId"), UNIQUE("companyId","eventKey")
);
CREATE TABLE "InboxNotification" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "eventId" TEXT NOT NULL, "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 audience TEXT NOT NULL CHECK(audience IN ('management','staff','requester')),
 "readAt" TIMESTAMP(3), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("eventId","companyId") REFERENCES "NotificationEvent"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("eventId","userId"), UNIQUE(id,"companyId","userId")
);
CREATE INDEX "InboxNotification_companyId_userId_createdAt_id_idx" ON "InboxNotification"("companyId","userId","createdAt",id);
CREATE TABLE "NotificationAction" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "notificationId" TEXT NOT NULL,
 "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('read','unread','open')), "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
 "resultVersion" INTEGER NOT NULL CHECK("resultVersion">0), changed BOOLEAN NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("notificationId","companyId","userId") REFERENCES "InboxNotification"(id,"companyId","userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","userId","submissionKey")
);
ALTER TABLE "NotificationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InboxNotification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboxNotification" FORCE ROW LEVEL SECURITY;
ALTER TABLE "NotificationAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_event_select ON "NotificationEvent" FOR SELECT TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true));
CREATE POLICY notification_event_insert ON "NotificationEvent" FOR INSERT TO propertyflow_runtime WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY notification_delivery_select ON "InboxNotification" FOR SELECT TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true) AND "userId"=current_setting('app.notification_user_id',true));
CREATE POLICY notification_delivery_insert ON "InboxNotification" FOR INSERT TO propertyflow_runtime WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY notification_delivery_update ON "InboxNotification" FOR UPDATE TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true) AND "userId"=current_setting('app.notification_user_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true) AND "userId"=current_setting('app.notification_user_id',true));
CREATE POLICY notification_action_select ON "NotificationAction" FOR SELECT TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true) AND "userId"=current_setting('app.notification_user_id',true));
CREATE POLICY notification_action_insert ON "NotificationAction" FOR INSERT TO propertyflow_runtime WITH CHECK ("companyId"=current_setting('app.company_id',true) AND "userId"=current_setting('app.notification_user_id',true));
GRANT SELECT,INSERT ON "NotificationEvent","NotificationAction" TO propertyflow_runtime;
GRANT SELECT,INSERT,UPDATE ON "InboxNotification" TO propertyflow_runtime;
CREATE FUNCTION retain_notification_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Notification history is immutable'; END $$;
CREATE TRIGGER retain_notification_event BEFORE UPDATE OR DELETE ON "NotificationEvent" FOR EACH ROW EXECUTE FUNCTION retain_notification_history();
CREATE TRIGGER retain_notification_action BEFORE UPDATE OR DELETE ON "NotificationAction" FOR EACH ROW EXECUTE FUNCTION retain_notification_history();
CREATE FUNCTION protect_notification_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Notification deliveries are retained'; END IF;
 IF (NEW.id,NEW."companyId",NEW."eventId",NEW."userId",NEW.audience,NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."companyId",OLD."eventId",OLD."userId",OLD.audience,OLD."createdAt") OR NEW.version<>OLD.version+1 OR NEW."readAt" IS NOT DISTINCT FROM OLD."readAt" THEN RAISE EXCEPTION 'Only versioned notification read state may change'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER protect_notification_delivery BEFORE UPDATE OR DELETE ON "InboxNotification" FOR EACH ROW EXECUTE FUNCTION protect_notification_delivery();
COMMIT;
