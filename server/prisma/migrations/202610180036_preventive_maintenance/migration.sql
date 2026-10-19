BEGIN;
CREATE TABLE "PreventivePlan" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "propertyId" TEXT NOT NULL, "unitId" TEXT, title TEXT NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
 description TEXT NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 4000),
 category TEXT NOT NULL CHECK(category IN ('plumbing','electrical','hvac','appliance','structural','safety','other')),
 priority TEXT NOT NULL CHECK(priority IN ('low','normal','high')),
 cadence TEXT NOT NULL CHECK(cadence IN ('weekly','monthly','quarterly','yearly')),
 "anchorOn" DATE NOT NULL, "endOn" DATE, "nextOn" DATE, timezone TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE(id,"companyId"), CHECK("endOn" IS NULL OR "endOn">="anchorOn"),
 CHECK("nextOn" IS NULL OR ("nextOn">="anchorOn" AND ("endOn" IS NULL OR "nextOn"<="endOn"))),
 FOREIGN KEY ("propertyId","companyId") REFERENCES "Property"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("unitId","propertyId","companyId") REFERENCES "Unit"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "PreventivePlan_companyId_status_nextOn_id_idx" ON "PreventivePlan"("companyId",status,"nextOn",id);
CREATE TABLE "PreventiveOccurrence" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "planId" TEXT NOT NULL, "dueOn" DATE NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('generated','skipped')),
 reason TEXT CHECK(length(btrim(reason)) BETWEEN 1 AND 1000), "requestId" TEXT UNIQUE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((outcome='generated' AND "requestId" IS NOT NULL AND reason IS NULL) OR (outcome='skipped' AND "requestId" IS NULL AND reason IS NOT NULL)),
 UNIQUE("requestId","companyId"), UNIQUE("planId","dueOn"),
 FOREIGN KEY ("planId","companyId") REFERENCES "PreventivePlan"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("requestId","companyId") REFERENCES "MaintenanceRequest"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "PreventiveOccurrence_companyId_planId_dueOn_idx" ON "PreventiveOccurrence"("companyId","planId","dueOn");
CREATE TABLE "PreventiveAction" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "planId" TEXT NOT NULL, "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('create','edit','generate','skip')), changed BOOLEAN NOT NULL DEFAULT true CHECK(changed OR action='edit'),
 snapshot JSONB NOT NULL, "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL, "requestId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("companyId","actorId","submissionKey"),
 FOREIGN KEY ("planId","companyId") REFERENCES "PreventivePlan"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("requestId","companyId") REFERENCES "MaintenanceRequest"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "PreventiveAction_companyId_planId_createdAt_id_idx" ON "PreventiveAction"("companyId","planId","createdAt",id);
CREATE FUNCTION retain_preventive_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Preventive history is immutable'; END $$;
CREATE TRIGGER retain_preventive_action BEFORE UPDATE OR DELETE ON "PreventiveAction" FOR EACH ROW EXECUTE FUNCTION retain_preventive_history();
CREATE TRIGGER retain_preventive_occurrence BEFORE UPDATE OR DELETE ON "PreventiveOccurrence" FOR EACH ROW EXECUTE FUNCTION retain_preventive_history();
ALTER TABLE "PreventivePlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PreventivePlan" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PreventiveAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PreventiveAction" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PreventiveOccurrence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PreventiveOccurrence" FORCE ROW LEVEL SECURITY;
CREATE POLICY preventive_plan_company ON "PreventivePlan" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY preventive_action_company ON "PreventiveAction" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY preventive_occurrence_company ON "PreventiveOccurrence" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
GRANT SELECT,INSERT,UPDATE ON "PreventivePlan" TO propertyflow_runtime;
GRANT SELECT,INSERT ON "PreventiveAction","PreventiveOccurrence" TO propertyflow_runtime;
COMMIT;
