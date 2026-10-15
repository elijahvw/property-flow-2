-- Stable display references are separate from immutable internal/API identities.
CREATE SEQUENCE rent_charge_reference_seq;
CREATE SEQUENCE ledger_entry_reference_seq;
ALTER TABLE "RentCharge" ADD COLUMN reference TEXT NOT NULL DEFAULT ('RC-' || nextval('rent_charge_reference_seq')::text);
ALTER TABLE "LedgerEntry" ADD COLUMN reference TEXT NOT NULL DEFAULT ('TX-' || nextval('ledger_entry_reference_seq')::text);
ALTER TABLE "RentCharge" ADD CONSTRAINT "RentCharge_reference_key" UNIQUE(reference);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reference_key" UNIQUE(reference);
GRANT USAGE ON SEQUENCE rent_charge_reference_seq,ledger_entry_reference_seq TO propertyflow_runtime;
-- Column-level runtime UPDATE grants intentionally exclude references.
ALTER TABLE "Lease" ADD COLUMN "previousLeaseId" TEXT;
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_renewal_identity" UNIQUE(id,"unitId","propertyId","companyId");
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_previous_lease_fkey" FOREIGN KEY("previousLeaseId","unitId","propertyId","companyId") REFERENCES "Lease"(id,"unitId","propertyId","companyId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_not_own_renewal" CHECK("previousLeaseId" IS NULL OR "previousLeaseId"<>id);
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_companyId_previousLeaseId_key" UNIQUE("companyId","previousLeaseId");
CREATE FUNCTION preserve_lease_renewal_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."previousLeaseId" IS DISTINCT FROM OLD."previousLeaseId" THEN RAISE EXCEPTION 'Renewal link is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lease_renewal_identity_guard BEFORE UPDATE ON "Lease" FOR EACH ROW EXECUTE FUNCTION preserve_lease_renewal_link();
