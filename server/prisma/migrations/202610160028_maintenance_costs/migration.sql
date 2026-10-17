BEGIN;
ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_id_propertyId_companyId_key" UNIQUE(id,"propertyId","companyId");
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_id_propertyId_companyId_key" UNIQUE(id,"propertyId","companyId");
CREATE TABLE "MaintenanceCost" (
 id TEXT PRIMARY KEY,"companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"requestId" TEXT NOT NULL,"entryId" TEXT NOT NULL,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "unlinkedAt" TIMESTAMP(3),"unlinkedById" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,"unlinkReason" TEXT,
 CHECK (("unlinkedAt" IS NULL AND "unlinkedById" IS NULL AND "unlinkReason" IS NULL) OR ("unlinkedAt" IS NOT NULL AND "unlinkedById" IS NOT NULL AND length(btrim("unlinkReason")) BETWEEN 1 AND 300 AND "unlinkReason" IS NOT NULL)),
 FOREIGN KEY("requestId","propertyId","companyId") REFERENCES "MaintenanceRequest"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("entryId","propertyId","companyId") REFERENCES "LedgerEntry"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","createdById","submissionKey")
);
CREATE UNIQUE INDEX maintenance_cost_active_source ON "MaintenanceCost"("companyId","entryId") WHERE "unlinkedAt" IS NULL;
CREATE INDEX "MaintenanceCost_companyId_requestId_id_idx" ON "MaintenanceCost"("companyId","requestId",id);
CREATE INDEX "MaintenanceCost_companyId_entryId_idx" ON "MaintenanceCost"("companyId","entryId");
ALTER TABLE "MaintenanceCost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MaintenanceCost" FORCE ROW LEVEL SECURITY;
CREATE POLICY maintenance_cost_company_boundary ON "MaintenanceCost" FOR ALL TO propertyflow_runtime
 USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT ON "MaintenanceCost" TO propertyflow_runtime;
GRANT UPDATE("unlinkedAt","unlinkedById","unlinkReason",version) ON "MaintenanceCost" TO propertyflow_runtime;
CREATE FUNCTION guard_maintenance_cost() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source RECORD;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT kind,currency,"voidedAt" INTO source FROM "LedgerEntry" WHERE id=NEW."entryId" AND "companyId"=NEW."companyId" AND "propertyId"=NEW."propertyId" FOR UPDATE;
  IF source.kind IS DISTINCT FROM 'expense' OR source.currency IS DISTINCT FROM 'USD' OR source."voidedAt" IS NOT NULL THEN RAISE EXCEPTION 'Link only an unvoided paid expense in this property' USING ERRCODE='23514'; END IF;
  IF NEW."unlinkedAt" IS NOT NULL OR NEW.version<>1 THEN RAISE EXCEPTION 'A cost link starts active at version one' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW."companyId",NEW."propertyId",NEW."requestId",NEW."entryId",NEW."createdById",NEW."submissionKey",NEW."submissionHash",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."companyId",OLD."propertyId",OLD."requestId",OLD."entryId",OLD."createdById",OLD."submissionKey",OLD."submissionHash",OLD."createdAt") OR OLD."unlinkedAt" IS NOT NULL OR NEW."unlinkedAt" IS NULL OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Cost link history is immutable; unlink once with a reason' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER maintenance_cost_guard BEFORE INSERT OR UPDATE ON "MaintenanceCost" FOR EACH ROW EXECUTE FUNCTION guard_maintenance_cost();
COMMIT;
