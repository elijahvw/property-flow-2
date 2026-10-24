-- The recorded disposable baseline sorts the unfiltered company history and
-- spills to disk. This index supports the bounded newest/older/newer traversal.
-- Existing property/status and requester indexes remain unchanged; measured
-- filtered plans did not justify additional ordering variants.
CREATE INDEX "maintenance_directory_order" ON "MaintenanceRequest"("companyId","createdAt" DESC,id DESC);
