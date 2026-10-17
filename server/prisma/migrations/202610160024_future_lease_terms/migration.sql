BEGIN;
CREATE SEQUENCE lease_term_reference_seq;
CREATE TABLE "LeaseTermChange" (
 id TEXT PRIMARY KEY,reference TEXT NOT NULL UNIQUE DEFAULT('LT-'||nextval('lease_term_reference_seq')::text),
 "companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"leaseId" TEXT NOT NULL,
 "effectiveOn" DATE NOT NULL CHECK(EXTRACT(DAY FROM "effectiveOn")=1),
 "rentCents" INTEGER NOT NULL CHECK("rentCents" BETWEEN 1 AND 100000000),
 "rentDueDay" INTEGER NOT NULL CHECK("rentDueDay" BETWEEN 1 AND 31),"graceDays" INTEGER NOT NULL CHECK("graceDays" BETWEEN 0 AND 30),
 "paymentInstructions" TEXT CHECK(length("paymentInstructions")<=1000),
 "before" JSONB NOT NULL CHECK(jsonb_typeof("before")='object'),reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("leaseId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE(id,"leaseId","propertyId","companyId"),UNIQUE("companyId","createdById","submissionKey")
);
CREATE INDEX lease_term_scope ON "LeaseTermChange"("companyId","leaseId","effectiveOn");
CREATE TABLE "LeaseTermCancellation" (
 id TEXT PRIMARY KEY,"companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"leaseId" TEXT NOT NULL,"changeId" TEXT NOT NULL UNIQUE,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("changeId","leaseId","propertyId","companyId") REFERENCES "LeaseTermChange"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","createdById","submissionKey"),UNIQUE("changeId","leaseId","propertyId","companyId")
);
ALTER TABLE "LeaseTermChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseTermChange" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LeaseTermCancellation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseTermCancellation" FORCE ROW LEVEL SECURITY;
CREATE POLICY lease_term_boundary ON "LeaseTermChange" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
CREATE POLICY lease_term_cancel_boundary ON "LeaseTermCancellation" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT ON "LeaseTermChange","LeaseTermCancellation" TO propertyflow_runtime;
GRANT USAGE ON SEQUENCE lease_term_reference_seq TO propertyflow_runtime;
CREATE FUNCTION guard_lease_term_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lid TEXT; cid TEXT; effective DATE; business_day DATE;
BEGIN
 lid:=NEW."leaseId"; cid:=NEW."companyId";
 UPDATE "Lease" SET version=version+1 WHERE id=lid AND "companyId"=cid;
 SELECT (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date INTO business_day FROM "Company" WHERE id=cid;
 IF TG_TABLE_NAME='LeaseTermChange' THEN
  effective:=NEW."effectiveOn";
  IF EXISTS(SELECT 1 FROM "LeaseTermChange" t WHERE t."leaseId"=lid AND t."companyId"=cid AND t."effectiveOn">business_day AND NOT EXISTS(SELECT 1 FROM "LeaseTermCancellation" x WHERE x."changeId"=t.id AND x."companyId"=cid)) THEN RAISE EXCEPTION 'Review or cancel the existing future term change' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM "Lease" WHERE id=lid AND "companyId"=cid AND status='active' AND "startsOn"<=effective AND ("endsOn" IS NULL OR "endsOn">=effective)) THEN RAISE EXCEPTION 'Future terms require an active lease and a date inside its term' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT "effectiveOn" INTO effective FROM "LeaseTermChange" WHERE id=NEW."changeId" AND "companyId"=cid AND "leaseId"=lid;
 END IF;
 IF effective IS NULL OR effective<=business_day THEN RAISE EXCEPTION 'Term events must be strictly future effective' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "RentCharge" WHERE "leaseId"=lid AND "companyId"=cid AND kind='rent' AND "periodOn">=effective) THEN RAISE EXCEPTION 'Recorded rent months are immutable; review a charge or credit difference separately' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lease_term_event_guard BEFORE INSERT ON "LeaseTermChange" FOR EACH ROW EXECUTE FUNCTION guard_lease_term_event();
CREATE TRIGGER lease_term_cancel_guard BEFORE INSERT ON "LeaseTermCancellation" FOR EACH ROW EXECUTE FUNCTION guard_lease_term_event();
CREATE FUNCTION retain_lease_term_baseline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "LeaseTermChange" WHERE "leaseId"=NEW.id AND "companyId"=NEW."companyId") THEN
  IF (NEW."rentCents",NEW."rentDueDay",NEW."graceDays",NEW."paymentInstructions") IS DISTINCT FROM (OLD."rentCents",OLD."rentDueDay",OLD."graceDays",OLD."paymentInstructions") THEN RAISE EXCEPTION 'Use reviewed future terms; the original lease baseline is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status='draft' OR EXISTS(SELECT 1 FROM "LeaseTermChange" t WHERE t."leaseId"=NEW.id AND t."companyId"=NEW."companyId" AND NOT EXISTS(SELECT 1 FROM "LeaseTermCancellation" x WHERE x."changeId"=t.id AND x."companyId"=NEW."companyId") AND (t."effectiveOn"<NEW."startsOn" OR (NEW."endsOn" IS NOT NULL AND t."effectiveOn">NEW."endsOn"))) THEN RAISE EXCEPTION 'Lease dates conflict with retained term changes' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retain_lease_term_baseline BEFORE UPDATE ON "Lease" FOR EACH ROW EXECUTE FUNCTION retain_lease_term_baseline();
ALTER TABLE "RentCharge" ADD COLUMN "termChangeId" TEXT,ADD COLUMN "termsSnapshot" JSONB;
ALTER TABLE "RentCharge" ADD FOREIGN KEY("termChangeId","leaseId","propertyId","companyId") REFERENCES "LeaseTermChange"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE FUNCTION snapshot_rent_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE term RECORD; base RECORD;
BEGIN
 IF NEW.kind<>'rent' THEN RETURN NEW; END IF;
 UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=NEW."leaseId" AND "companyId"=NEW."companyId";
 SELECT t.* INTO term FROM "LeaseTermChange" t WHERE t."leaseId"=NEW."leaseId" AND t."companyId"=NEW."companyId" AND t."effectiveOn"<=NEW."periodOn" AND NOT EXISTS(SELECT 1 FROM "LeaseTermCancellation" x WHERE x."changeId"=t.id AND x."companyId"=NEW."companyId") ORDER BY t."effectiveOn" DESC,t.id DESC LIMIT 1;
 SELECT * INTO base FROM "Lease" WHERE id=NEW."leaseId" AND "companyId"=NEW."companyId";
 NEW."termChangeId":=term.id;
 NEW."termsSnapshot":=jsonb_build_object('termChangeId',term.id,'effectiveOn',term."effectiveOn",'rentCents',COALESCE(term."rentCents",base."rentCents"),'rentDueDay',COALESCE(term."rentDueDay",base."rentDueDay"),'graceDays',NEW."graceDays",'paymentInstructions',CASE WHEN term.id IS NULL THEN base."paymentInstructions" ELSE term."paymentInstructions" END,'chargedCents',NEW."amountCents",'dueOn',NEW."dueOn");
 IF term.id IS NOT NULL AND NEW."graceDays"<>term."graceDays" THEN RAISE EXCEPTION 'Charge grace must match the reviewed effective terms' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER snapshot_rent_terms BEFORE INSERT ON "RentCharge" FOR EACH ROW EXECUTE FUNCTION snapshot_rent_terms();
COMMIT;
