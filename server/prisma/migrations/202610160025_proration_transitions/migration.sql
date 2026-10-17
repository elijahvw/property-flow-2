BEGIN;
CREATE SEQUENCE proration_reference_seq;
CREATE TABLE "LeaseProration" (
 id TEXT PRIMARY KEY,reference TEXT NOT NULL UNIQUE DEFAULT('PR-'||nextval('proration_reference_seq')::text),
 "companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"leaseId" TEXT NOT NULL,"chargeId" TEXT NOT NULL UNIQUE,
 snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("chargeId","leaseId","propertyId","companyId") REFERENCES "RentCharge"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("leaseId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","createdById","submissionKey"),UNIQUE("chargeId","leaseId","propertyId","companyId")
);
CREATE INDEX proration_lease_scope ON "LeaseProration"("companyId","leaseId",id);
CREATE SEQUENCE lease_transition_reference_seq;
CREATE TABLE "LeaseTransition" (
 id TEXT PRIMARY KEY,reference TEXT NOT NULL UNIQUE DEFAULT('LH-'||nextval('lease_transition_reference_seq')::text),
 "companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"leaseId" TEXT NOT NULL,"successorId" TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('plan_end','end','renew')),"endsOn" DATE NOT NULL,
 snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object'),reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("leaseId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("successorId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","createdById","submissionKey")
);
CREATE INDEX transition_lease_scope ON "LeaseTransition"("companyId","leaseId",id);
ALTER TABLE "LeaseProration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseProration" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LeaseTransition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseTransition" FORCE ROW LEVEL SECURITY;
CREATE POLICY proration_boundary ON "LeaseProration" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
CREATE POLICY transition_boundary ON "LeaseTransition" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT ON "LeaseProration","LeaseTransition" TO propertyflow_runtime;
GRANT USAGE ON SEQUENCE proration_reference_seq,lease_transition_reference_seq TO propertyflow_runtime;
COMMIT;
