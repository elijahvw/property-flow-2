BEGIN;
-- Replies extend the existing immutable update history, including its scoped
-- request foreign key, forced company RLS and SELECT/INSERT-only runtime grants.
ALTER TABLE "MaintenanceUpdate" ADD COLUMN "authorType" TEXT NOT NULL DEFAULT 'team';
ALTER TABLE "MaintenanceUpdate" ADD CONSTRAINT "maintenance_update_author_type"
 CHECK ("authorType" IN ('team','resident'));
ALTER TABLE "MaintenanceUpdate" ADD CONSTRAINT "maintenance_resident_reply_visibility"
 CHECK ("authorType" <> 'resident' OR visibility='resident');
ALTER TABLE "NotificationEvent" DROP CONSTRAINT "NotificationEvent_kind_check";
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_kind_check"
 CHECK(kind IN ('maintenance.created','maintenance.status','maintenance.update','maintenance.reply','work.assigned','work.reopened','work.approved','work.review','inspection.review','agreement.review','agreement.approved','agreement.changes'));
COMMIT;
