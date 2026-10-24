BEGIN;
-- Existing updates were management-authored. Do not infer authorship from a
-- user's current role or fabricate resident authorship for older records.
ALTER TABLE "MaintenanceUpdate" ADD COLUMN "authorType" TEXT NOT NULL DEFAULT 'team';
ALTER TABLE "MaintenanceUpdate" ADD CONSTRAINT "MaintenanceUpdate_authorType_check"
  CHECK ("authorType" IN ('team','requester') AND ("authorType" <> 'requester' OR visibility='resident'));
-- Request ownership has no supported reassignment workflow. Retaining the
-- original requester prevents a later write bug from moving reply authority.
CREATE FUNCTION retain_maintenance_requester() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."requesterId" IS DISTINCT FROM OLD."requesterId" THEN
    RAISE EXCEPTION 'The original maintenance requester is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER maintenance_requester_immutable BEFORE UPDATE OF "requesterId" ON "MaintenanceRequest"
  FOR EACH ROW EXECUTE FUNCTION retain_maintenance_requester();
CREATE FUNCTION check_requester_maintenance_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."authorType"='requester' AND NOT EXISTS (
    SELECT 1 FROM "MaintenanceRequest" r
    WHERE r.id=NEW."requestId" AND r."companyId"=NEW."companyId" AND r."requesterId"=NEW."createdById"
  ) THEN
    RAISE EXCEPTION 'A requester reply must belong to the original request author' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER maintenance_update_requester_match BEFORE INSERT ON "MaintenanceUpdate"
  FOR EACH ROW EXECUTE FUNCTION check_requester_maintenance_update();
-- MaintenanceUpdate retains its existing SELECT/INSERT-only runtime grants.
ALTER TABLE "NotificationEvent" DROP CONSTRAINT "NotificationEvent_kind_check";
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_kind_check"
  CHECK (kind IN ('maintenance.created','maintenance.status','maintenance.update','maintenance.reply','work.assigned','work.reopened','work.approved','work.review','inspection.review','agreement.review','agreement.approved','agreement.changes'));
COMMIT;
