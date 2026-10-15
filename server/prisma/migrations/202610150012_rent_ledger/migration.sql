-- Additive rent subledger. Existing manual cash entries remain unlinked.
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_id_propertyId_companyId_key" UNIQUE (id,"propertyId","companyId");
ALTER TABLE "LedgerEntry" ADD COLUMN "leaseId" TEXT;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_lease_fkey" FOREIGN KEY ("leaseId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_rent_payment_check" CHECK ("leaseId" IS NULL OR (kind='income' AND category='rent'));
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_rent_identity_key" UNIQUE (id,"leaseId","propertyId","companyId");
CREATE TABLE "RentCharge" (
 id TEXT PRIMARY KEY,
 "companyId" TEXT NOT NULL,
 "propertyId" TEXT NOT NULL,
 "leaseId" TEXT NOT NULL,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,
 "submissionHash" TEXT NOT NULL,
 "periodOn" DATE NOT NULL CHECK (EXTRACT(DAY FROM "periodOn")=1),
 "dueOn" DATE NOT NULL,
 "amountCents" INTEGER NOT NULL CHECK ("amountCents" BETWEEN 1 AND 100000000),
 memo TEXT CHECK (length(memo)<=500),
 version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
 "voidedAt" TIMESTAMP(3),
 "voidReason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (date_trunc('month',"dueOn")::date="periodOn"),
 CHECK (("voidedAt" IS NULL AND "voidReason" IS NULL) OR ("voidedAt" IS NOT NULL AND "voidReason" IS NOT NULL AND length(btrim("voidReason")) BETWEEN 1 AND 300)),
 FOREIGN KEY ("leaseId","propertyId","companyId") REFERENCES "Lease"(id,"propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE ("companyId","createdById","submissionKey"),
 UNIQUE (id,"leaseId","propertyId","companyId")
);
CREATE UNIQUE INDEX "RentCharge_one_active_period" ON "RentCharge"("companyId","leaseId","periodOn") WHERE "voidedAt" IS NULL;
CREATE INDEX "RentCharge_companyId_leaseId_dueOn_id_idx" ON "RentCharge"("companyId","leaseId","dueOn",id);
CREATE TABLE "RentAllocation" (
 id TEXT PRIMARY KEY,
 "companyId" TEXT NOT NULL,
 "propertyId" TEXT NOT NULL,
 "leaseId" TEXT NOT NULL,
 "chargeId" TEXT NOT NULL,
 "entryId" TEXT NOT NULL,
 "amountCents" INTEGER NOT NULL CHECK ("amountCents" BETWEEN 1 AND 100000000),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("chargeId","leaseId","propertyId","companyId") REFERENCES "RentCharge"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("entryId","leaseId","propertyId","companyId") REFERENCES "LedgerEntry"(id,"leaseId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "RentAllocation_companyId_leaseId_idx" ON "RentAllocation"("companyId","leaseId");
ALTER TABLE "RentCharge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RentCharge" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RentAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RentAllocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY rent_charge_company_boundary ON "RentCharge" FOR ALL TO propertyflow_runtime USING ("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK ("companyId"=NULLIF(current_setting('app.company_id',true),''));
CREATE POLICY rent_allocation_company_boundary ON "RentAllocation" FOR ALL TO propertyflow_runtime USING ("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK ("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT ON "RentCharge","RentAllocation" TO propertyflow_runtime;
GRANT UPDATE (version,"voidedAt","voidReason") ON "RentCharge" TO propertyflow_runtime;

CREATE INDEX "LedgerEntry_companyId_leaseId_idx" ON "LedgerEntry"("companyId","leaseId");
-- Guard allocation sums and concurrent writers in the database too. The
-- restricted runtime cannot update/delete allocations or monetary source fields.
CREATE FUNCTION enforce_rent_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE charge_amount bigint; payment_amount bigint; allocated bigint;
BEGIN
 UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=NEW."leaseId" AND "companyId"=NEW."companyId";
 SELECT "amountCents" INTO charge_amount FROM "RentCharge" WHERE id=NEW."chargeId" AND "companyId"=NEW."companyId" AND "voidedAt" IS NULL;
 SELECT "amountCents" INTO payment_amount FROM "LedgerEntry" WHERE id=NEW."entryId" AND "companyId"=NEW."companyId" AND "voidedAt" IS NULL AND "leaseId"=NEW."leaseId";
 IF charge_amount IS NULL OR payment_amount IS NULL THEN RAISE EXCEPTION 'Allocation requires active rent sources' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(SUM(a."amountCents"),0) INTO allocated FROM "RentAllocation" a JOIN "LedgerEntry" p ON p.id=a."entryId" WHERE a."chargeId"=NEW."chargeId" AND p."voidedAt" IS NULL;
 IF allocated+NEW."amountCents">charge_amount THEN RAISE EXCEPTION 'Charge overallocated' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(SUM(a."amountCents"),0) INTO allocated FROM "RentAllocation" a JOIN "RentCharge" c ON c.id=a."chargeId" WHERE a."entryId"=NEW."entryId" AND c."voidedAt" IS NULL;
 IF allocated+NEW."amountCents">payment_amount THEN RAISE EXCEPTION 'Payment overallocated' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rent_allocation_check BEFORE INSERT ON "RentAllocation" FOR EACH ROW EXECUTE FUNCTION enforce_rent_allocation();
