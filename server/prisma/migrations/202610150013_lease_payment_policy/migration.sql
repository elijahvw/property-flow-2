-- Preserve historical amounts and due dates; zero grace retains prior behavior.
ALTER TABLE "Lease" ADD COLUMN "rentDueDay" INTEGER NOT NULL DEFAULT 1 CHECK ("rentDueDay" BETWEEN 1 AND 31);
ALTER TABLE "Lease" ADD COLUMN "graceDays" INTEGER NOT NULL DEFAULT 0 CHECK ("graceDays" BETWEEN 0 AND 30);
ALTER TABLE "Lease" ADD COLUMN "paymentInstructions" TEXT CHECK (length("paymentInstructions")<=1000);
ALTER TABLE "RentCharge" ADD COLUMN "graceDays" INTEGER NOT NULL DEFAULT 0 CHECK ("graceDays" BETWEEN 0 AND 30);
-- RentCharge's existing column-level UPDATE grant deliberately excludes graceDays:
-- every posted charge keeps the grace policy reviewed at posting time.
