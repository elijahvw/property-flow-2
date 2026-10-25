-- Existing demo generations and posted history remain unchanged. New setups
-- capture their reviewed template/context and may replace one marked generation.
ALTER TABLE "SalesDemoSetup"
 ADD COLUMN "sourceDemoId" TEXT REFERENCES "SalesDemo"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD COLUMN "sourceVersion" INTEGER,
 ADD COLUMN blueprint JSONB,
 ADD CONSTRAINT sales_demo_rebuild_source_version CHECK (
   ("sourceDemoId" IS NULL AND "sourceVersion" IS NULL)
   OR ("sourceDemoId" IS NOT NULL AND "sourceVersion" IS NOT NULL AND "sourceVersion" > 0 AND blueprint IS NOT NULL AND jsonb_typeof(blueprint)='object')
 );
CREATE INDEX "SalesDemoSetup_sourceDemoId_status_idx" ON "SalesDemoSetup"("sourceDemoId",status);
-- Abandoned or retired successors retain their provenance; only one live
-- replacement may reserve or build from a generation at a time.
CREATE UNIQUE INDEX sales_demo_one_active_replacement ON "SalesDemoSetup"("sourceDemoId")
 WHERE "sourceDemoId" IS NOT NULL AND status <> 'retired';
