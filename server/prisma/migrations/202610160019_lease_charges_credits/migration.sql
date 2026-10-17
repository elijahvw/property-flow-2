BEGIN;
-- Preserve source IDs and monthly rent uniqueness; manual one-time charges use
-- the same obligation/allocation ledger, with an independent effective date.
ALTER TABLE "RentCharge" ADD COLUMN kind TEXT NOT NULL DEFAULT 'rent',
 ADD COLUMN category TEXT NOT NULL DEFAULT 'rent', ADD COLUMN "effectiveOn" DATE;
ALTER TABLE "RentCharge" ADD CONSTRAINT lease_charge_kind CHECK (
 (kind='rent' AND category='rent' AND "effectiveOn" IS NULL) OR
 (kind='one_time' AND category IN ('utilities','parking','pet','damage','other') AND "effectiveOn" IS NOT NULL AND "scheduleId" IS NULL AND "graceDays"=0 AND memo IS NOT NULL AND length(btrim(memo)) BETWEEN 1 AND 500));
DROP INDEX "RentCharge_one_active_period";
CREATE UNIQUE INDEX "RentCharge_one_active_period" ON "RentCharge"("companyId","leaseId","periodOn") WHERE "voidedAt" IS NULL AND kind='rent';
CREATE SEQUENCE lease_credit_reference_seq;
CREATE SEQUENCE lease_credit_reversal_reference_seq;
CREATE TABLE "LeaseCredit" (
 id TEXT PRIMARY KEY,
 reference TEXT NOT NULL UNIQUE DEFAULT ('CN-'||nextval('lease_credit_reference_seq')::text),
 "companyId" TEXT NOT NULL, "propertyId" TEXT NOT NULL, "leaseId" TEXT NOT NULL, "chargeId" TEXT NOT NULL,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('credit_note','concession')),
 "effectiveOn" DATE NOT NULL,
 "amountCents" INTEGER NOT NULL CHECK("amountCents" BETWEEN 1 AND 100000000),
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("chargeId","leaseId","propertyId","companyId") REFERENCES "RentCharge"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE(id,"leaseId","propertyId","companyId"), UNIQUE("companyId","createdById","submissionKey")
);
CREATE TABLE "LeaseCreditReversal" (
 id TEXT PRIMARY KEY,
 reference TEXT NOT NULL UNIQUE DEFAULT ('CR-'||nextval('lease_credit_reversal_reference_seq')::text),
 "companyId" TEXT NOT NULL, "propertyId" TEXT NOT NULL, "leaseId" TEXT NOT NULL,
 "creditId" TEXT NOT NULL UNIQUE,
 UNIQUE("creditId","leaseId","propertyId","companyId"),
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
 "effectiveOn" DATE NOT NULL,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("creditId","leaseId","propertyId","companyId") REFERENCES "LeaseCredit"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","createdById","submissionKey")
);
CREATE INDEX lease_credit_scope ON "LeaseCredit"("companyId","leaseId");
CREATE INDEX lease_credit_reversal_scope ON "LeaseCreditReversal"("companyId","leaseId");
ALTER TABLE "LeaseCredit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseCredit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LeaseCreditReversal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseCreditReversal" FORCE ROW LEVEL SECURITY;
CREATE POLICY lease_credit_boundary ON "LeaseCredit" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
CREATE POLICY lease_credit_reversal_boundary ON "LeaseCreditReversal" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT ON "LeaseCredit","LeaseCreditReversal" TO propertyflow_runtime;
GRANT USAGE ON SEQUENCE lease_credit_reference_seq,lease_credit_reversal_reference_seq TO propertyflow_runtime;

-- Credits are fully applied to a named unpaid charge. No floating noncash
-- credit is created, and existing cash allocations are never rearranged.
CREATE FUNCTION enforce_lease_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE charge_amount bigint; applied bigint; credited bigint;
BEGIN
 UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=NEW."leaseId" AND "companyId"=NEW."companyId";
 SELECT "amountCents" INTO charge_amount FROM "RentCharge" WHERE id=NEW."chargeId" AND "companyId"=NEW."companyId" AND "voidedAt" IS NULL;
 SELECT COALESCE(SUM(a."amountCents"),0) INTO applied FROM "RentAllocation" a JOIN "LedgerEntry" p ON p.id=a."entryId" AND p."companyId"=a."companyId" WHERE a."chargeId"=NEW."chargeId" AND a."companyId"=NEW."companyId" AND p."voidedAt" IS NULL;
 SELECT COALESCE(SUM(c."amountCents"),0) INTO credited FROM "LeaseCredit" c WHERE c."chargeId"=NEW."chargeId" AND c."companyId"=NEW."companyId" AND NOT EXISTS(SELECT 1 FROM "LeaseCreditReversal" r WHERE r."creditId"=c.id AND r."companyId"=c."companyId");
 IF charge_amount IS NULL OR applied+credited+NEW."amountCents">charge_amount THEN RAISE EXCEPTION 'Credit exceeds unpaid charge' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lease_credit_check BEFORE INSERT ON "LeaseCredit" FOR EACH ROW EXECUTE FUNCTION enforce_lease_credit();
CREATE FUNCTION fence_credit_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=NEW."leaseId" AND "companyId"=NEW."companyId";
 IF NEW."effectiveOn"<(SELECT "effectiveOn" FROM "LeaseCredit" WHERE id=NEW."creditId" AND "companyId"=NEW."companyId") THEN RAISE EXCEPTION 'Reversal precedes credit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lease_credit_reversal_fence BEFORE INSERT ON "LeaseCreditReversal" FOR EACH ROW EXECUTE FUNCTION fence_credit_reversal();
CREATE FUNCTION guard_credited_charge_void() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=NEW."leaseId" AND "companyId"=NEW."companyId";
 IF NEW."voidedAt" IS NOT NULL AND OLD."voidedAt" IS NULL AND EXISTS(SELECT 1 FROM "LeaseCredit" c WHERE c."chargeId"=NEW.id AND c."companyId"=NEW."companyId" AND NOT EXISTS(SELECT 1 FROM "LeaseCreditReversal" r WHERE r."creditId"=c.id AND r."companyId"=c."companyId")) THEN RAISE EXCEPTION 'Reverse active credits before voiding charge' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credited_charge_void_guard BEFORE UPDATE ON "RentCharge" FOR EACH ROW EXECUTE FUNCTION guard_credited_charge_void();
CREATE OR REPLACE FUNCTION enforce_rent_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE charge_amount bigint; payment_amount bigint; allocated bigint; credited bigint;
BEGIN
 UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=NEW."leaseId" AND "companyId"=NEW."companyId";
 SELECT "amountCents" INTO charge_amount FROM "RentCharge" WHERE id=NEW."chargeId" AND "companyId"=NEW."companyId" AND "voidedAt" IS NULL;
 SELECT "amountCents" INTO payment_amount FROM "LedgerEntry" WHERE id=NEW."entryId" AND "companyId"=NEW."companyId" AND "voidedAt" IS NULL AND "leaseId"=NEW."leaseId";
 IF charge_amount IS NULL OR payment_amount IS NULL THEN RAISE EXCEPTION 'Allocation requires active lease sources' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(SUM(c."amountCents"),0) INTO credited FROM "LeaseCredit" c WHERE c."chargeId"=NEW."chargeId" AND c."companyId"=NEW."companyId" AND NOT EXISTS(SELECT 1 FROM "LeaseCreditReversal" r WHERE r."creditId"=c.id AND r."companyId"=c."companyId");
 SELECT COALESCE(SUM(a."amountCents"),0) INTO allocated FROM "RentAllocation" a JOIN "LedgerEntry" p ON p.id=a."entryId" AND p."companyId"=a."companyId" WHERE a."chargeId"=NEW."chargeId" AND a."companyId"=NEW."companyId" AND p."voidedAt" IS NULL;
 IF allocated+credited+NEW."amountCents">charge_amount THEN RAISE EXCEPTION 'Charge overallocated' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(SUM(a."amountCents"),0) INTO allocated FROM "RentAllocation" a JOIN "RentCharge" c ON c.id=a."chargeId" AND c."companyId"=a."companyId" WHERE a."entryId"=NEW."entryId" AND a."companyId"=NEW."companyId" AND c."voidedAt" IS NULL;
 IF allocated+NEW."amountCents">payment_amount THEN RAISE EXCEPTION 'Payment overallocated' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
COMMIT;
