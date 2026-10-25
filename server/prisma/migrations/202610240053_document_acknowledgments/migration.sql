BEGIN;
ALTER TABLE "LeaseDocumentShare" ADD COLUMN "receivedAt" TIMESTAMP(3);
ALTER TABLE "LeaseDocumentShareAction" DROP CONSTRAINT "LeaseDocumentShareAction_action_check";
ALTER TABLE "LeaseDocumentShareAction" ADD CONSTRAINT "LeaseDocumentShareAction_action_check" CHECK(action IN ('grant','revoke','source_archived','received','downloaded'));
GRANT UPDATE("receivedAt") ON "LeaseDocumentShare" TO propertyflow_runtime;
COMMIT;
