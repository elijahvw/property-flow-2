BEGIN;
ALTER TABLE "CompanyMembership" ADD COLUMN "maintenanceExecution" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MaintenanceRequest" ADD COLUMN "assigneeId" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD COLUMN "executionStatus" TEXT NOT NULL DEFAULT 'unassigned' CHECK("executionStatus" IN ('unassigned','assigned','accepted','pending_review','complete'));
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT maintenance_assignment_state CHECK(("assigneeId" IS NULL AND "executionStatus"='unassigned') OR ("assigneeId" IS NOT NULL AND "executionStatus"<>'unassigned'));
CREATE INDEX "MaintenanceRequest_companyId_assigneeId_executionStatus_idx" ON "MaintenanceRequest"("companyId","assigneeId","executionStatus");
CREATE TABLE "WorkOrderAction" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('assign','accept','progress','submit','approve','reopen')),
 note TEXT NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 4000),
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("requestId","companyId") REFERENCES "MaintenanceRequest"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","actorId","submissionKey")
);
CREATE INDEX "WorkOrderAction_companyId_requestId_createdAt_id_idx" ON "WorkOrderAction"("companyId","requestId","createdAt",id);
ALTER TABLE "WorkOrderAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkOrderAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_company ON "WorkOrderAction" TO propertyflow_runtime
 USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
GRANT SELECT,INSERT ON "WorkOrderAction" TO propertyflow_runtime;
CREATE FUNCTION retain_work_order_action() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Work order history is immutable'; END $$;
CREATE TRIGGER retain_work_order_action BEFORE UPDATE OR DELETE ON "WorkOrderAction" FOR EACH ROW EXECUTE FUNCTION retain_work_order_action();
COMMIT;
