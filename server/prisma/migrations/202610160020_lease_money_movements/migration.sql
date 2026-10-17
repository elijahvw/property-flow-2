BEGIN;
CREATE SEQUENCE lease_movement_reference_seq;
CREATE SEQUENCE lease_movement_reversal_reference_seq;
CREATE TABLE "LeaseMovement" (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE DEFAULT ('LM-'||nextval('lease_movement_reference_seq')::text),
 "companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"leaseId" TEXT NOT NULL,
 "accountId" TEXT,"chargeId" TEXT,"paymentId" TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('deposit_application','deposit_refund','rent_refund')),
 "effectiveOn" DATE NOT NULL,"amountCents" INTEGER NOT NULL CHECK("amountCents" BETWEEN 1 AND 100000000),
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 payee TEXT, method TEXT,"paymentReference" TEXT CHECK(length("paymentReference")<=100),
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((kind='deposit_application' AND "accountId" IS NOT NULL AND "chargeId" IS NOT NULL AND "paymentId" IS NULL AND payee IS NULL AND method IS NULL AND "paymentReference" IS NULL)
 OR (kind IN ('deposit_refund','rent_refund') AND "chargeId" IS NULL AND payee IS NOT NULL AND method IS NOT NULL AND length(btrim(payee)) BETWEEN 1 AND 200 AND method IN ('bank_transfer','cash','check','other') AND ((kind='deposit_refund' AND "accountId" IS NOT NULL AND "paymentId" IS NULL) OR (kind='rent_refund' AND "paymentId" IS NOT NULL AND "accountId" IS NULL)))),
 FOREIGN KEY("leaseId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("accountId","leaseId","propertyId","companyId") REFERENCES "DepositAccount"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("chargeId","leaseId","propertyId","companyId") REFERENCES "RentCharge"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("paymentId","leaseId","propertyId","companyId") REFERENCES "LedgerEntry"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","createdById","submissionKey"),UNIQUE(id,"propertyId","companyId"),UNIQUE(id,"leaseId","propertyId","companyId")
);
CREATE TABLE "LeaseMovementReversal" (
 id TEXT PRIMARY KEY,reference TEXT NOT NULL UNIQUE DEFAULT ('MR-'||nextval('lease_movement_reversal_reference_seq')::text),
 "companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"leaseId" TEXT NOT NULL,"movementId" TEXT NOT NULL UNIQUE,
 "effectiveOn" DATE NOT NULL,reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("movementId","leaseId","propertyId","companyId") REFERENCES "LeaseMovement"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("movementId","leaseId","propertyId","companyId"),UNIQUE("companyId","createdById","submissionKey")
);
CREATE INDEX lease_movement_scope ON "LeaseMovement"("companyId","leaseId");
CREATE INDEX lease_movement_reversal_scope ON "LeaseMovementReversal"("companyId","leaseId");
ALTER TABLE "LeaseMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseMovement" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LeaseMovementReversal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseMovementReversal" FORCE ROW LEVEL SECURITY;
CREATE POLICY lease_movement_boundary ON "LeaseMovement" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
CREATE POLICY lease_movement_reversal_boundary ON "LeaseMovementReversal" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT ON "LeaseMovement","LeaseMovementReversal" TO propertyflow_runtime;
GRANT USAGE ON SEQUENCE lease_movement_reference_seq,lease_movement_reversal_reference_seq TO propertyflow_runtime;
ALTER TABLE "LedgerEntry" ADD COLUMN "movementId" TEXT UNIQUE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT ledger_movement_fk FOREIGN KEY("movementId","propertyId","companyId") REFERENCES "LeaseMovement"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_kind_check",DROP CONSTRAINT "LedgerEntry_category_check";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_kind_check" CHECK(kind IN ('income','expense','deposit','refund'));
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_category_check" CHECK((kind='income' AND category IN ('rent','other')) OR (kind='expense' AND category IN ('repairs','utilities','insurance','property_tax','other')) OR (kind='deposit' AND category='security_deposit') OR (kind='refund' AND category IN ('rent','security_deposit')));
ALTER TABLE "LedgerEntry" ADD CONSTRAINT ledger_refund_source CHECK((kind='refund' AND "movementId" IS NOT NULL AND "leaseId" IS NULL) OR (kind<>'refund' AND "movementId" IS NULL));

-- Shared sums are used by every writer, including direct runtime SQL. All
-- financial operations fence the Lease before inspecting available sources.
CREATE FUNCTION active_charge_settlements(cid text, co text) RETURNS bigint LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT SUM(a."amountCents") FROM "RentAllocation" a JOIN "LedgerEntry" p ON p.id=a."entryId" AND p."companyId"=a."companyId" WHERE a."chargeId"=cid AND a."companyId"=co AND p."voidedAt" IS NULL),0)
 + COALESCE((SELECT SUM(c."amountCents") FROM "LeaseCredit" c WHERE c."chargeId"=cid AND c."companyId"=co AND NOT EXISTS(SELECT 1 FROM "LeaseCreditReversal" r WHERE r."creditId"=c.id AND r."companyId"=co)),0)
 + COALESCE((SELECT SUM(m."amountCents") FROM "LeaseMovement" m WHERE m."chargeId"=cid AND m."companyId"=co AND NOT EXISTS(SELECT 1 FROM "LeaseMovementReversal" r WHERE r."movementId"=m.id AND r."companyId"=co)),0)
$$;
CREATE FUNCTION available_payment(pid text, co text) RETURNS bigint LANGUAGE sql STABLE AS $$
 SELECT p."amountCents"-COALESCE((SELECT SUM(a."amountCents") FROM "RentAllocation" a JOIN "RentCharge" c ON c.id=a."chargeId" AND c."companyId"=co WHERE a."entryId"=pid AND a."companyId"=co AND c."voidedAt" IS NULL),0)
 -COALESCE((SELECT SUM(m."amountCents") FROM "LeaseMovement" m WHERE m."paymentId"=pid AND m."companyId"=co AND NOT EXISTS(SELECT 1 FROM "LeaseMovementReversal" r WHERE r."movementId"=m.id AND r."companyId"=co)),0)
 FROM "LedgerEntry" p WHERE p.id=pid AND p."companyId"=co AND p."voidedAt" IS NULL AND p."leaseId" IS NOT NULL
$$;
CREATE FUNCTION available_deposit(aid text, co text) RETURNS bigint LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT SUM(d."amountCents") FROM "DepositReceipt" d JOIN "LedgerEntry" p ON p."depositReceiptId"=d.id AND p."companyId"=co WHERE d."accountId"=aid AND d."companyId"=co AND p."voidedAt" IS NULL),0)
 -COALESCE((SELECT SUM(m."amountCents") FROM "LeaseMovement" m WHERE m."accountId"=aid AND m."companyId"=co AND NOT EXISTS(SELECT 1 FROM "LeaseMovementReversal" r WHERE r."movementId"=m.id AND r."companyId"=co)),0)
$$;
CREATE FUNCTION enforce_lease_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE amount bigint;
BEGIN
 UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=NEW."leaseId" AND "companyId"=NEW."companyId";
 IF NEW.kind='rent_refund' THEN
  amount:=available_payment(NEW."paymentId",NEW."companyId");
 ELSE amount:=available_deposit(NEW."accountId",NEW."companyId"); END IF;
 IF amount IS NULL OR NEW."amountCents">amount THEN RAISE EXCEPTION 'Movement exceeds available funds' USING ERRCODE='23514'; END IF;
 IF NEW.kind='deposit_application' AND NOT EXISTS(SELECT 1 FROM "RentCharge" c WHERE c.id=NEW."chargeId" AND c."companyId"=NEW."companyId" AND c."voidedAt" IS NULL AND c."amountCents"-active_charge_settlements(c.id,c."companyId")>=NEW."amountCents") THEN RAISE EXCEPTION 'Application exceeds unpaid charge' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lease_movement_check BEFORE INSERT ON "LeaseMovement" FOR EACH ROW EXECUTE FUNCTION enforce_lease_movement();
CREATE FUNCTION enforce_movement_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=NEW."leaseId" AND "companyId"=NEW."companyId";
 IF NEW."effectiveOn"<(SELECT "effectiveOn" FROM "LeaseMovement" WHERE id=NEW."movementId" AND "companyId"=NEW."companyId") THEN RAISE EXCEPTION 'Correction precedes movement' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lease_movement_reversal_check BEFORE INSERT ON "LeaseMovementReversal" FOR EACH ROW EXECUTE FUNCTION enforce_movement_reversal();
CREATE FUNCTION require_movement_cash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind<>'deposit_application' AND NOT EXISTS(SELECT 1 FROM "LedgerEntry" WHERE "movementId"=NEW.id AND "companyId"=NEW."companyId") THEN RAISE EXCEPTION 'Refund requires linked cash outflow' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER movement_cash_required AFTER INSERT ON "LeaseMovement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_movement_cash();
CREATE FUNCTION check_movement_cash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."movementId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "LeaseMovement" m WHERE m.id=NEW."movementId" AND m."companyId"=NEW."companyId" AND m.kind IN ('deposit_refund','rent_refund') AND NEW.category=CASE WHEN m.kind='deposit_refund' THEN 'security_deposit' ELSE 'rent' END AND m."amountCents"=NEW."amountCents" AND m."effectiveOn"=NEW."occurredOn" AND m."createdById"=NEW."createdById") THEN RAISE EXCEPTION 'Refund cash source must match movement' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER movement_cash_match BEFORE INSERT ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION check_movement_cash();
CREATE FUNCTION require_refund_correction_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mid text; reversal_exists boolean; cash_voided boolean;
BEGIN
 mid:=CASE WHEN TG_TABLE_NAME='LedgerEntry' THEN NEW."movementId" ELSE NEW."movementId" END;
 IF mid IS NULL THEN RETURN NEW; END IF;
 IF (SELECT kind FROM "LeaseMovement" WHERE id=mid AND "companyId"=NEW."companyId")='deposit_application' THEN RETURN NEW; END IF;
 SELECT EXISTS(SELECT 1 FROM "LeaseMovementReversal" WHERE "movementId"=mid AND "companyId"=NEW."companyId") INTO reversal_exists;
 SELECT "voidedAt" IS NOT NULL INTO cash_voided FROM "LedgerEntry" WHERE "movementId"=mid AND "companyId"=NEW."companyId";
 IF cash_voided IS DISTINCT FROM reversal_exists THEN RAISE EXCEPTION 'Refund correction requires linked reversal and cash void' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER refund_cash_correction_pair AFTER INSERT OR UPDATE ON "LedgerEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_refund_correction_pair();
CREATE CONSTRAINT TRIGGER refund_reversal_cash_pair AFTER INSERT ON "LeaseMovementReversal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_refund_correction_pair();
CREATE OR REPLACE FUNCTION enforce_rent_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ca bigint; pa bigint;
BEGIN
 UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=NEW."leaseId" AND "companyId"=NEW."companyId";
 SELECT "amountCents"-active_charge_settlements(id,"companyId") INTO ca FROM "RentCharge" WHERE id=NEW."chargeId" AND "companyId"=NEW."companyId" AND "voidedAt" IS NULL;
 pa:=available_payment(NEW."entryId",NEW."companyId");
 IF ca IS NULL OR pa IS NULL OR NEW."amountCents">ca OR NEW."amountCents">pa THEN RAISE EXCEPTION 'Charge or payment overallocated: exceeds unpaid charge or available receipt' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION enforce_lease_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=NEW."leaseId" AND "companyId"=NEW."companyId";
 IF NOT EXISTS(SELECT 1 FROM "RentCharge" WHERE id=NEW."chargeId" AND "companyId"=NEW."companyId" AND "voidedAt" IS NULL AND "amountCents"-active_charge_settlements(id,"companyId")>=NEW."amountCents") THEN RAISE EXCEPTION 'Credit exceeds unpaid charge' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION guard_movement_source_correction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lid text;
BEGIN
 IF NEW."voidedAt" IS NULL OR OLD."voidedAt" IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='RentCharge' THEN
  lid:=NEW."leaseId";
 ELSE
  lid:=NEW."leaseId";
  IF NEW."depositReceiptId" IS NOT NULL THEN SELECT "leaseId" INTO lid FROM "DepositReceipt" WHERE id=NEW."depositReceiptId" AND "companyId"=NEW."companyId"; END IF;
 END IF;
 IF lid IS NOT NULL THEN UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=lid AND "companyId"=NEW."companyId"; END IF;
 IF TG_TABLE_NAME='RentCharge' THEN
  IF EXISTS(SELECT 1 FROM "LeaseMovement" m WHERE m."chargeId"=NEW.id AND m."companyId"=NEW."companyId" AND NOT EXISTS(SELECT 1 FROM "LeaseMovementReversal" r WHERE r."movementId"=m.id AND r."companyId"=NEW."companyId")) THEN RAISE EXCEPTION 'Reverse deposit applications before correcting charge' USING ERRCODE='23514'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM "LeaseMovement" m WHERE m."paymentId"=NEW.id AND m."companyId"=NEW."companyId" AND NOT EXISTS(SELECT 1 FROM "LeaseMovementReversal" r WHERE r."movementId"=m.id AND r."companyId"=NEW."companyId")) THEN RAISE EXCEPTION 'Correct refunds before correcting receipt' USING ERRCODE='23514'; END IF;
  IF NEW."depositReceiptId" IS NOT NULL AND EXISTS(SELECT 1 FROM "DepositReceipt" d WHERE d.id=NEW."depositReceiptId" AND d."companyId"=NEW."companyId" AND available_deposit(d."accountId",d."companyId")<d."amountCents") THEN RAISE EXCEPTION 'Reverse deposit movements before reducing held funds' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER movement_charge_correction_guard BEFORE UPDATE ON "RentCharge" FOR EACH ROW EXECUTE FUNCTION guard_movement_source_correction();
CREATE TRIGGER movement_receipt_correction_guard BEFORE UPDATE ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION guard_movement_source_correction();
COMMIT;
