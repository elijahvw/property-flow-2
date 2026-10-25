-- Company SaaS subscriptions remain separate from tenant rent and cash records.
CREATE TABLE "PlatformPlan" (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  "monthlyPriceCents" INTEGER NOT NULL CHECK ("monthlyPriceCents" BETWEEN 0 AND 100000000),
  features JSONB NOT NULL CHECK (jsonb_typeof(features) = 'array'), "archivedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
  UNIQUE(name, version), UNIQUE("createdById", "submissionKey")
);
CREATE TABLE "CompanySubscription" (
  "companyId" TEXT PRIMARY KEY REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "planId" TEXT REFERENCES "PlatformPlan"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('trial','active','expired','suspended','cancelled')),
  "trialEndsAt" TIMESTAMP(3), "currentPeriodStart" DATE, "currentPeriodEnd" DATE,
  "billingEmail" TEXT, "featureOverrides" JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof("featureOverrides") = 'object'),
  "overrideReason" TEXT, "overrideExpiresAt" TIMESTAMP(3), "updatedById" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
  CHECK (status <> 'trial' OR "trialEndsAt" IS NOT NULL)
);
CREATE TABLE "CompanySubscriptionRevision" (
  id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0), snapshot JSONB NOT NULL, reason TEXT NOT NULL,
  "actorId" TEXT NOT NULL, "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("companyId",version), UNIQUE("companyId","submissionKey")
);
CREATE TABLE "CompanyFeatureUsage" (
  "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  area TEXT NOT NULL CHECK (area IN ('properties','leasing','maintenance','documents','finances','reports','inspections','agreements','notifications','resident_portal')),
  day DATE NOT NULL, "successfulReads" INTEGER NOT NULL DEFAULT 0 CHECK ("successfulReads" >= 0),
  "successfulWrites" INTEGER NOT NULL DEFAULT 0 CHECK ("successfulWrites" >= 0),
  PRIMARY KEY("companyId",area,day)
);
CREATE INDEX "CompanyFeatureUsage_companyId_day_idx" ON "CompanyFeatureUsage"("companyId",day);
CREATE TABLE "SaaSInvoice" (
  id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  number SERIAL NOT NULL UNIQUE, "billingName" TEXT NOT NULL, "billingEmail" TEXT, "billingAddress" JSONB NOT NULL,
  "planName" TEXT NOT NULL, "planVersion" INTEGER NOT NULL CHECK ("planVersion" > 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
  "monthlyPriceCents" INTEGER NOT NULL CHECK ("monthlyPriceCents" BETWEEN 0 AND 100000000),
  "periodStart" DATE NOT NULL, "periodEnd" DATE NOT NULL CHECK ("periodEnd" > "periodStart"),
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "dueOn" DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','void')), version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL, "createdById" TEXT NOT NULL,
  UNIQUE("companyId","submissionKey"), UNIQUE("companyId",id)
);
CREATE UNIQUE INDEX "saas_invoice_active_period" ON "SaaSInvoice"("companyId","periodStart") WHERE status='issued';
CREATE INDEX "SaaSInvoice_companyId_issuedAt_id_idx" ON "SaaSInvoice"("companyId","issuedAt",id);
CREATE TABLE "SaaSPayment" (
  id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "invoiceId" TEXT NOT NULL, "amountCents" INTEGER NOT NULL CHECK ("amountCents" BETWEEN 1 AND 100000000),
  "receivedOn" DATE NOT NULL, "paymentReference" TEXT NOT NULL, "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("companyId","submissionKey"), UNIQUE("companyId",id),
  FOREIGN KEY("companyId","invoiceId") REFERENCES "SaaSInvoice"("companyId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SaaSPayment_companyId_invoiceId_idx" ON "SaaSPayment"("companyId","invoiceId");
CREATE TABLE "SaaSPaymentReversal" (
  id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "paymentId" TEXT NOT NULL UNIQUE, reason TEXT NOT NULL, "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "submissionKey" TEXT NOT NULL, "submissionHash" TEXT NOT NULL,
  UNIQUE("companyId","submissionKey"), UNIQUE("companyId","paymentId"),
  FOREIGN KEY("companyId","paymentId") REFERENCES "SaaSPayment"("companyId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "SaaSInvoiceEvent" (
  id TEXT PRIMARY KEY, "companyId" TEXT NOT NULL REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "invoiceId" TEXT NOT NULL, action TEXT NOT NULL, detail JSONB NOT NULL, "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "submissionKey" TEXT, "submissionHash" TEXT,
  UNIQUE("companyId","submissionKey"),
  FOREIGN KEY("companyId","invoiceId") REFERENCES "SaaSInvoice"("companyId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SaaSInvoiceEvent_companyId_invoiceId_createdAt_idx" ON "SaaSInvoiceEvent"("companyId","invoiceId","createdAt");
-- Cross-company metadata is exposed only through explicit platform/owner checks.
-- Historical prices, invoices, receipts, reversals and revisions cannot be rewritten.
GRANT SELECT,INSERT ON "PlatformPlan","CompanySubscriptionRevision","SaaSInvoice","SaaSPayment","SaaSPaymentReversal","SaaSInvoiceEvent" TO propertyflow_runtime;
GRANT UPDATE("archivedAt") ON "PlatformPlan" TO propertyflow_runtime;
GRANT SELECT,INSERT,UPDATE ON "CompanySubscription","CompanyFeatureUsage" TO propertyflow_runtime;
GRANT UPDATE(status,version) ON "SaaSInvoice" TO propertyflow_runtime;
GRANT USAGE ON SEQUENCE "SaaSInvoice_number_seq" TO propertyflow_runtime;
