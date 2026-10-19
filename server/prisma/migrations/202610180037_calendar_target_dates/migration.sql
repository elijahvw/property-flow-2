BEGIN;
-- Calendar month totals and pages share this unresolved target-date predicate.
-- Keep completed history out of the index; property filters use the same range.
CREATE INDEX "calendar_request_targets" ON "MaintenanceRequest" ("companyId","targetOn","propertyId",id)
 WHERE status <> 'resolved' AND "targetOn" IS NOT NULL;
COMMIT;
