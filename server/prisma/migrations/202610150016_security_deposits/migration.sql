-- Refundable security deposits are obligations/held funds, not rent income.
CREATE SEQUENCE deposit_account_reference_seq;
CREATE SEQUENCE deposit_receipt_reference_seq;
CREATE TABLE "DepositAccount" (
 id TEXT PRIMARY KEY,
 reference TEXT NOT NULL UNIQUE DEFAULT ('DA-' || nextval('deposit_account_reference_seq')::text),
 "companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"leaseId" TEXT NOT NULL,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,
 "requiredCents" INTEGER NOT NULL CHECK("requiredCents" BETWEEN 0 AND 100000000),
 "dueOn" DATE NOT NULL,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("leaseId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","leaseId"),UNIQUE("companyId","createdById","submissionKey"),UNIQUE(id,"companyId"),UNIQUE(id,"leaseId","propertyId","companyId")
);
CREATE INDEX "DepositAccount_companyId_propertyId_id_idx" ON "DepositAccount"("companyId","propertyId",id);
CREATE TABLE "DepositRevision" (
 id TEXT PRIMARY KEY,"companyId" TEXT NOT NULL,"accountId" TEXT NOT NULL,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),
 "requiredCents" INTEGER NOT NULL CHECK("requiredCents" BETWEEN 0 AND 100000000),"dueOn" DATE NOT NULL,
 reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("accountId","companyId") REFERENCES "DepositAccount"(id,"companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","createdById","submissionKey"),UNIQUE("accountId",version)
);
CREATE INDEX "DepositRevision_companyId_accountId_version_idx" ON "DepositRevision"("companyId","accountId",version);
CREATE TABLE "DepositReceipt" (
 id TEXT PRIMARY KEY,
 reference TEXT NOT NULL UNIQUE DEFAULT ('DR-' || nextval('deposit_receipt_reference_seq')::text),
 "companyId" TEXT NOT NULL,"propertyId" TEXT NOT NULL,"leaseId" TEXT NOT NULL,"accountId" TEXT NOT NULL,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,"submissionHash" TEXT NOT NULL,
 "occurredOn" DATE NOT NULL,"amountCents" INTEGER NOT NULL CHECK("amountCents" BETWEEN 1 AND 100000000),
 method TEXT NOT NULL CHECK(method IN ('bank_transfer','cash','check','other')),
 "paymentReference" TEXT CHECK(length("paymentReference")<=100),memo TEXT CHECK(length(memo)<=500),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("accountId","leaseId","propertyId","companyId") REFERENCES "DepositAccount"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE("companyId","createdById","submissionKey"),UNIQUE(id,"propertyId","companyId")
);
CREATE INDEX "DepositReceipt_companyId_accountId_id_idx" ON "DepositReceipt"("companyId","accountId",id);
ALTER TABLE "DepositAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DepositAccount" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DepositRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DepositRevision" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DepositReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DepositReceipt" FORCE ROW LEVEL SECURITY;
CREATE POLICY deposit_account_company ON "DepositAccount" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
CREATE POLICY deposit_revision_company ON "DepositRevision" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
CREATE POLICY deposit_receipt_company ON "DepositReceipt" FOR ALL TO propertyflow_runtime USING("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT ON "DepositAccount","DepositRevision","DepositReceipt" TO propertyflow_runtime;
GRANT UPDATE("requiredCents","dueOn",version) ON "DepositAccount" TO propertyflow_runtime;
GRANT USAGE ON SEQUENCE deposit_account_reference_seq,deposit_receipt_reference_seq TO propertyflow_runtime;
-- No UPDATE/DELETE grant on receipt identities or requirement history.
ALTER TABLE "LedgerEntry" ADD COLUMN "depositReceiptId" TEXT UNIQUE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_depositReceipt_fkey" FOREIGN KEY("depositReceiptId","propertyId","companyId") REFERENCES "DepositReceipt"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_kind_check", DROP CONSTRAINT "LedgerEntry_check";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_kind_check" CHECK(kind IN ('income','expense','deposit'));
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_category_check" CHECK((kind='income' AND category IN ('rent','other')) OR (kind='expense' AND category IN ('repairs','utilities','insurance','property_tax','other')) OR (kind='deposit' AND category='security_deposit'));
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_deposit_source_check" CHECK((kind='deposit' AND "depositReceiptId" IS NOT NULL AND "leaseId" IS NULL) OR (kind<>'deposit' AND "depositReceiptId" IS NULL));
-- One cash source must match each immutable receipt, including direct runtime SQL.
CREATE FUNCTION check_deposit_cash_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt "DepositReceipt"%ROWTYPE;
BEGIN
 IF NEW."depositReceiptId" IS NOT NULL THEN
  SELECT * INTO receipt FROM "DepositReceipt" WHERE id=NEW."depositReceiptId" AND "companyId"=NEW."companyId";
  IF receipt.id IS NULL OR receipt."amountCents"<>NEW."amountCents" OR receipt."occurredOn"<>NEW."occurredOn" OR receipt."createdById"<>NEW."createdById" THEN
   RAISE EXCEPTION 'Deposit cash source must match its receipt' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deposit_cash_source_check BEFORE INSERT ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION check_deposit_cash_source();
CREATE FUNCTION require_deposit_cash_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "LedgerEntry" WHERE "depositReceiptId"=NEW.id AND "companyId"=NEW."companyId") THEN
  RAISE EXCEPTION 'Deposit receipt requires one linked cash source' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER deposit_receipt_cash_required AFTER INSERT ON "DepositReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_deposit_cash_source();
CREATE FUNCTION require_deposit_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Deposit change requires next version' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "DepositRevision" WHERE "accountId"=NEW.id AND "companyId"=NEW."companyId" AND version=NEW.version AND "requiredCents"=NEW."requiredCents" AND "dueOn"=NEW."dueOn") THEN
  RAISE EXCEPTION 'Deposit terms require an immutable revision' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER deposit_account_revision_required AFTER INSERT OR UPDATE ON "DepositAccount" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_deposit_revision();
CREATE FUNCTION check_deposit_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "DepositAccount" WHERE id=NEW."accountId" AND "companyId"=NEW."companyId" AND version=NEW.version AND "requiredCents"=NEW."requiredCents" AND "dueOn"=NEW."dueOn") THEN RAISE EXCEPTION 'Deposit revision must snapshot current terms' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deposit_revision_terms_check BEFORE INSERT ON "DepositRevision" FOR EACH ROW EXECUTE FUNCTION check_deposit_revision();
