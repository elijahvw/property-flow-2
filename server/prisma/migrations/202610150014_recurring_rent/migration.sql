CREATE TABLE "RentSchedule" (
 id TEXT PRIMARY KEY,
 "companyId" TEXT NOT NULL,
 "propertyId" TEXT NOT NULL,
 "leaseId" TEXT NOT NULL,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,
 "submissionHash" TEXT NOT NULL,
 "firstPeriodOn" DATE NOT NULL CHECK(EXTRACT(DAY FROM "firstPeriodOn")=1),
 "lastPeriodOn" DATE CHECK(EXTRACT(DAY FROM "lastPeriodOn")=1),
 "nextPeriodOn" DATE NOT NULL CHECK(EXTRACT(DAY FROM "nextPeriodOn")=1),
 "amountCents" INTEGER NOT NULL CHECK("amountCents" BETWEEN 1 AND 100000000),
 "firstAmountCents" INTEGER CHECK("firstAmountCents" BETWEEN 1 AND 100000000),
 "lastAmountCents" INTEGER CHECK("lastAmountCents" BETWEEN 1 AND 100000000),
 "firstDueOn" DATE,
 "dueDay" INTEGER NOT NULL CHECK("dueDay" BETWEEN 1 AND 31),
 "graceDays" INTEGER NOT NULL CHECK("graceDays" BETWEEN 0 AND 30),
 "leadDays" INTEGER NOT NULL CHECK("leadDays" BETWEEN 0 AND 28),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','stopped','completed')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "lastCheckedAt" TIMESTAMP(3),
 "lastErrorCode" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("nextPeriodOn">="firstPeriodOn"),
 CHECK("lastPeriodOn" IS NULL OR "lastPeriodOn">="firstPeriodOn"),
 CHECK("lastAmountCents" IS NULL OR "lastPeriodOn" IS NOT NULL),
 FOREIGN KEY("leaseId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","createdById","submissionKey"),
 UNIQUE(id,"leaseId","propertyId","companyId")
);
CREATE UNIQUE INDEX "RentSchedule_one_open" ON "RentSchedule"("companyId","leaseId") WHERE status IN ('active','paused');
CREATE INDEX "RentSchedule_company_cursor" ON "RentSchedule"("companyId",id);
ALTER TABLE "RentCharge" ADD COLUMN "scheduleId" TEXT;
ALTER TABLE "RentCharge" ADD CONSTRAINT "RentCharge_schedule_fkey" FOREIGN KEY("scheduleId","leaseId","propertyId","companyId") REFERENCES "RentSchedule"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE "RentScheduleOccurrence" (
 id TEXT PRIMARY KEY,
 "companyId" TEXT NOT NULL,
 "propertyId" TEXT NOT NULL,
 "leaseId" TEXT NOT NULL,
 "scheduleId" TEXT NOT NULL,
 "periodOn" DATE NOT NULL CHECK(EXTRACT(DAY FROM "periodOn")=1),
 "chargeId" TEXT,
 outcome TEXT NOT NULL CHECK(outcome IN ('posted','existing','suppressed')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("scheduleId","leaseId","propertyId","companyId") REFERENCES "RentSchedule"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("chargeId","leaseId","propertyId","companyId") REFERENCES "RentCharge"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK((outcome='suppressed') OR "chargeId" IS NOT NULL),
 UNIQUE("companyId","leaseId","periodOn")
);
CREATE INDEX "RentScheduleOccurrence_history" ON "RentScheduleOccurrence"("companyId","leaseId",id);
ALTER TABLE "RentSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RentSchedule" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RentScheduleOccurrence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RentScheduleOccurrence" FORCE ROW LEVEL SECURITY;
CREATE POLICY rent_schedule_boundary ON "RentSchedule" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
CREATE POLICY rent_schedule_occurrence_boundary ON "RentScheduleOccurrence" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT ON "RentSchedule","RentScheduleOccurrence" TO propertyflow_runtime;
GRANT UPDATE(status,version,"nextPeriodOn","lastCheckedAt","lastErrorCode") ON "RentSchedule" TO propertyflow_runtime;
