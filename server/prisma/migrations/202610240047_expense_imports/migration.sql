BEGIN;
CREATE TABLE "ExpenseImportBatch" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
 "sourceNamespace" TEXT NOT NULL CHECK("sourceNamespace" ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
 status TEXT NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','committed','cancelled')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), "fileName" TEXT NOT NULL,
 "sourceHash" TEXT NOT NULL, "sourceRows" JSONB NOT NULL, preview JSONB NOT NULL,
 "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT, "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
 "committedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3), result JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE("companyId","submissionKey"), UNIQUE("companyId",id),
 CHECK((status='preview' AND "committedAt" IS NULL AND "cancelledAt" IS NULL AND result IS NULL) OR (status='committed' AND "committedAt" IS NOT NULL AND "cancelledAt" IS NULL AND result IS NOT NULL) OR (status='cancelled' AND "cancelledAt" IS NOT NULL AND "committedAt" IS NULL))
);
CREATE INDEX "ExpenseImportBatch_companyId_createdAt_id_idx" ON "ExpenseImportBatch"("companyId","createdAt",id);
CREATE TABLE "ExpenseImportAction" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
 "batchId" TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('preview','commit','cancel')),
 detail JSONB NOT NULL, "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("companyId","batchId") REFERENCES "ExpenseImportBatch"("companyId",id) ON DELETE RESTRICT,
 UNIQUE("companyId","submissionKey")
);
CREATE INDEX "ExpenseImportAction_companyId_batchId_createdAt_idx" ON "ExpenseImportAction"("companyId","batchId","createdAt");
CREATE TABLE "ImportedExpenseSource" (
 id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT,
 "propertyId" TEXT NOT NULL, "sourceNamespace" TEXT NOT NULL CHECK("sourceNamespace" ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
 "sourceId" TEXT NOT NULL CHECK(length("sourceId") BETWEEN 1 AND 200 AND "sourceId"=btrim("sourceId")),
 "sourceHash" TEXT NOT NULL, "ledgerEntryId" TEXT NOT NULL UNIQUE, "batchId" TEXT NOT NULL,
 "sourceRow" INTEGER NOT NULL CHECK("sourceRow">0), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("ledgerEntryId","propertyId","companyId") REFERENCES "LedgerEntry"(id,"propertyId","companyId") ON DELETE RESTRICT,
 FOREIGN KEY("companyId","batchId") REFERENCES "ExpenseImportBatch"("companyId",id) ON DELETE RESTRICT,
 UNIQUE("companyId","sourceNamespace","sourceId"), UNIQUE("ledgerEntryId","propertyId","companyId"), UNIQUE("companyId",id)
);
CREATE INDEX "ImportedExpenseSource_companyId_batchId_sourceRow_idx" ON "ImportedExpenseSource"("companyId","batchId","sourceRow");
ALTER TABLE "ExpenseImportBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseImportBatch" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseImportAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseImportAction" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ImportedExpenseSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportedExpenseSource" FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_import_company ON "ExpenseImportBatch" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY expense_import_action_company ON "ExpenseImportAction" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
CREATE POLICY imported_expense_company ON "ImportedExpenseSource" TO propertyflow_runtime USING ("companyId"=current_setting('app.company_id',true)) WITH CHECK ("companyId"=current_setting('app.company_id',true));
GRANT SELECT,INSERT ON "ExpenseImportBatch","ExpenseImportAction","ImportedExpenseSource" TO propertyflow_runtime;
GRANT UPDATE(status,version,"committedAt","cancelledAt",result,"updatedAt") ON "ExpenseImportBatch" TO propertyflow_runtime;
COMMIT;
