-- Dedicated runtime login is provisioned after migrations, never table owner.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'propertyflow_runtime') THEN
    CREATE ROLE propertyflow_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO propertyflow_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Company", "User", "Identity", "CompanyMembership", "Invitation", "Session", "LoginTransaction", "Property" TO propertyflow_runtime;
GRANT SELECT, INSERT ON "AuditEvent" TO propertyflow_runtime;
ALTER TABLE "Property" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Property" FORCE ROW LEVEL SECURITY;
CREATE POLICY property_company_boundary ON "Property" FOR ALL TO propertyflow_runtime
  USING ("companyId" = NULLIF(current_setting('app.company_id', true), ''))
  WITH CHECK ("companyId" = NULLIF(current_setting('app.company_id', true), ''));
