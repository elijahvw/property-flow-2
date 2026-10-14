CREATE TABLE "LedgerEntry" (
 "id" TEXT PRIMARY KEY,
 "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "propertyId" TEXT NOT NULL,
 "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "submissionKey" TEXT NOT NULL,
 "submissionHash" TEXT NOT NULL,
 "occurredOn" DATE NOT NULL,
 "amountCents" INTEGER NOT NULL CHECK ("amountCents" BETWEEN 1 AND 100000000),
 "currency" TEXT NOT NULL DEFAULT 'USD' CHECK ("currency"='USD'),
 "kind" TEXT NOT NULL CHECK ("kind" IN ('income','expense')),
 "category" TEXT NOT NULL,
 "memo" TEXT CHECK (length("memo") <= 500),
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0),
 "voidedAt" TIMESTAMP(3),
 "voidReason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("kind"='income' AND "category" IN ('rent','other')) OR ("kind"='expense' AND "category" IN ('repairs','utilities','insurance','property_tax','other'))),
 CHECK (("voidedAt" IS NULL AND "voidReason" IS NULL) OR ("voidedAt" IS NOT NULL AND "voidReason" IS NOT NULL AND length(btrim("voidReason")) BETWEEN 1 AND 300)),
 FOREIGN KEY ("propertyId","companyId") REFERENCES "Property"("id","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 UNIQUE ("companyId","createdById","submissionKey")
);
CREATE INDEX "LedgerEntry_companyId_propertyId_occurredOn_id_idx" ON "LedgerEntry"("companyId","propertyId","occurredOn","id");
ALTER TABLE "LedgerEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY ledger_company_boundary ON "LedgerEntry" FOR ALL TO propertyflow_runtime USING ("companyId"=NULLIF(current_setting('app.company_id',true),'')) WITH CHECK ("companyId"=NULLIF(current_setting('app.company_id',true),''));
GRANT SELECT,INSERT ON "LedgerEntry" TO propertyflow_runtime;
-- Monetary details and retry identity are immutable even for the runtime role.
GRANT UPDATE ("version","voidedAt","voidReason") ON "LedgerEntry" TO propertyflow_runtime;
