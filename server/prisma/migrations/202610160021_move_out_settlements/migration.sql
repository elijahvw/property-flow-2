BEGIN;
CREATE SEQUENCE lease_settlement_reference_seq;
CREATE TABLE "LeaseSettlement" (
 id TEXT PRIMARY KEY,"companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"leaseId" TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('finalized','open')),version INTEGER NOT NULL CHECK(version>0),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("leaseId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","leaseId"),UNIQUE("leaseId","propertyId","companyId"),UNIQUE(id,"leaseId","propertyId","companyId")
);
CREATE TABLE "LeaseSettlementRevision" (
 id TEXT PRIMARY KEY,reference TEXT NOT NULL UNIQUE DEFAULT ('ST-'||nextval('lease_settlement_reference_seq')::text),
 "companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"leaseId" TEXT NOT NULL,"settlementId" TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),action TEXT NOT NULL CHECK(action IN ('finalized','reopened')),
 "movedOutOn" DATE NOT NULL,reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 forwarding JSONB NOT NULL CHECK(jsonb_typeof(forwarding)='object'),snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object'),"sourceHash" TEXT NOT NULL CHECK(length("sourceHash")=64),
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("settlementId","leaseId","propertyId","companyId") REFERENCES "LeaseSettlement"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("settlementId",version),UNIQUE("companyId","createdById","submissionKey")
);
CREATE INDEX settlement_revision_scope ON "LeaseSettlementRevision"("companyId","leaseId");
ALTER TABLE "LeaseSettlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseSettlement" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LeaseSettlementRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseSettlementRevision" FORCE ROW LEVEL SECURITY;
CREATE POLICY settlement_boundary ON "LeaseSettlement" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
CREATE POLICY settlement_revision_boundary ON "LeaseSettlementRevision" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT ON "LeaseSettlement","LeaseSettlementRevision" TO propertyflow_runtime;
GRANT UPDATE(status,version) ON "LeaseSettlement" TO propertyflow_runtime;
GRANT USAGE ON SEQUENCE lease_settlement_reference_seq TO propertyflow_runtime;
CREATE FUNCTION require_settlement_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Settlement change requires next version' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "LeaseSettlementRevision" r WHERE r."settlementId"=NEW.id AND r."companyId"=NEW."companyId" AND r.version=NEW.version AND r.action=CASE WHEN NEW.status='open' THEN 'reopened' ELSE 'finalized' END) THEN RAISE EXCEPTION 'Settlement state requires immutable revision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER settlement_revision_required AFTER INSERT OR UPDATE ON "LeaseSettlement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_settlement_revision();
CREATE FUNCTION check_settlement_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=NEW."leaseId" AND "companyId"=NEW."companyId";
 IF NOT EXISTS(SELECT 1 FROM "LeaseSettlement" s WHERE s.id=NEW."settlementId" AND s."companyId"=NEW."companyId" AND s.version=NEW.version AND s.status=CASE WHEN NEW.action='reopened' THEN 'open' ELSE 'finalized' END) THEN RAISE EXCEPTION 'Settlement revision must match current state' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER settlement_revision_check BEFORE INSERT ON "LeaseSettlementRevision" FOR EACH ROW EXECUTE FUNCTION check_settlement_revision();
COMMIT;
