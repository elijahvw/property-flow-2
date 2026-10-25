// Only the disposable local-preview runner imports this helper. It never accepts
// a database URL and must not be used as a hosted migration/repair mechanism.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const table = (name) => ({ relation: `public."${name}"` });
const column = (table, column) => ({ table, column });
const trigger = (table, trigger) => ({ table, trigger });
const constraint = (table, constraint, contains) => ({ table, constraint, contains });
const relation = (name) => ({ relation: `public."${name}"` });

// Dumps made by the local preview predate different batches and may not carry
// Prisma's ledger. Multiple markers reject partial schemas instead of guessing
// that one early-created table proves the whole migration completed.
export const localPreviewUpgrades = [
  ["202610170031_private_documents", [table("PrivateDocument"), table("DocumentVersion"), trigger("DocumentVersion", "preserve_document_version")]],
  ["202610170032_delegated_maintenance", [column("CompanyMembership", "maintenanceExecution"), table("WorkOrderAction"), trigger("WorkOrderAction", "retain_work_order_action")]],
  ["202610180033_invitation_workflows", [column("Invitation", "submissionKey"), column("Invitation", "deliveryStatus"), constraint("Invitation", "Invitation_replacement_company_fkey")]],
  ["202610180034_workspace_guidance", [column("User", "guideState"), column("User", "guideVersion"), constraint("User", "User_guide_version_valid")]],
  ["202610180035_maintenance_vendors", [table("Vendor"), table("VendorAction"), column("MaintenanceRequest", "vendorId")]],
  ["202610180036_preventive_maintenance", [table("PreventivePlan"), table("PreventiveOccurrence"), table("PreventiveAction"), trigger("PreventiveOccurrence", "retain_preventive_occurrence")]],
  ["202610180037_calendar_target_dates", [column("MaintenanceRequest", "targetOn"), relation("calendar_request_targets")]],
  ["202610190038_lease_inspections", [table("LeaseInspection"), table("InspectionRevision"), table("InspectionEvidence"), trigger("InspectionEvidence", "retain_inspection_evidence")]],
  ["202610190039_agreement_preparation", [table("LeaseAgreement"), table("AgreementRevision"), table("AgreementFile"), trigger("AgreementFile", "retain_agreement_file")]],
  ["202610190040_in_app_notifications", [table("NotificationEvent"), table("InboxNotification"), table("NotificationAction"), trigger("InboxNotification", "protect_notification_delivery")]],
  ["202610240041_support_impersonation", [column("Session", "impersonatedUserId"), column("Session", "impersonationMembershipVersion"), constraint("Session", "Session_impersonation_complete"), constraint("User", "User_platformRole_check", "support")]],
  ["202610240042_company_subscriptions", [table("PlatformPlan"), table("CompanySubscription"), table("CompanySubscriptionRevision"), table("CompanyFeatureUsage"), table("SaaSInvoice"), table("SaaSPayment"), table("SaaSPaymentReversal"), table("SaaSInvoiceEvent"), relation("saas_invoice_active_period")]],
  ["202610240043_unit_availability", [table("UnitAvailability"), table("UnitAvailabilityRevision")]],
  ["202610240044_unit_imports", [table("UnitImportBatch"), table("UnitImportAction")]],
  ["202610240045_prospect_pipeline", [table("Prospect"), table("ProspectAction")]],
  ["202610240046_lease_document_sharing", [table("LeaseDocumentShare"), table("LeaseDocumentShareAction")]],
  ["202610240047_expense_imports", [table("ExpenseImportBatch"), table("ExpenseImportAction"), table("ImportedExpenseSource")]],
  ["202610240048_resident_maintenance_replies", [column("MaintenanceUpdate", "authorType"), trigger("MaintenanceRequest", "maintenance_requester_immutable"), trigger("MaintenanceUpdate", "maintenance_update_requester_match")]],
  ["202610240049_notification_preferences", [table("NotificationPreferenceFence"), table("NotificationPreference"), table("NotificationPreferenceAction"), trigger("NotificationPreference", "protect_notification_preference")]],
  ["202610240050_maintenance_directory", [relation("maintenance_directory_order")]],
  ["202610240051_acquisition_consolidation", [table("UnitRentalListing"), table("ProspectFollowUp"), table("RentalApplication"), table("AdmissionsEvent"), relation("Prospect_id_propertyId_companyId_key")]],
  ["202610240052_task_drafts", [table("TaskDraft"), trigger("TaskDraft", "protect_task_draft_identity"), relation("TaskDraft_companyId_userId_expiresAt_updatedAt_id_idx")]],
  ["202610240053_document_acknowledgments", [column("LeaseDocumentShare", "receivedAt"), constraint("LeaseDocumentShareAction", "LeaseDocumentShareAction_action_check", "received"), constraint("LeaseDocumentShareAction", "LeaseDocumentShareAction_action_check", "downloaded")]],
];

async function present(db, marker) {
  if (marker.relation) return (await db.query("SELECT to_regclass($1) IS NOT NULL AS present", [marker.relation])).rows[0].present;
  if (marker.column) return (await db.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS present", [marker.table, marker.column])).rows[0].present;
  if (marker.trigger) return (await db.query("SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass($1) AND tgname=$2 AND NOT tgisinternal) AS present", [`public."${marker.table}"`, marker.trigger])).rows[0].present;
  return (await db.query("SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass($1) AND conname=$2 AND ($3::text IS NULL OR strpos(pg_get_constraintdef(oid),$3)>0)) AS present", [`public."${marker.table}"`, marker.constraint, marker.contains ?? null])).rows[0].present;
}

export async function assertCanonicalLocalPreview(db) {
  const incompatible = (await db.query(`SELECT
    to_regclass('public."LeasingProspect"') IS NOT NULL OR
    to_regclass('public."DocumentShare"') IS NOT NULL OR
    (to_regclass('public."UnitAvailability"') IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='UnitAvailability' AND column_name='condition')) OR
    (EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='MaintenanceUpdate' AND column_name='authorType') AND NOT EXISTS
      (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public."MaintenanceUpdate"') AND conname='MaintenanceUpdate_authorType_check' AND strpos(pg_get_constraintdef(oid),'requester')>0))
    AS incompatible`)).rows[0].incompatible;
  assert.equal(incompatible, false, "This preview contains the incompatible PR #60 schema. Keep its backup and use a reviewed data reconciliation; automatic upgrade was refused.");
  const ledger = (await db.query("SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present")).rows[0].present;
  if (ledger) {
    const old = await db.query("SELECT 1 FROM _prisma_migrations WHERE migration_name LIKE '20261022004%' LIMIT 1");
    assert.equal(old.rowCount, 0, "This preview records PR #60 migrations. Keep its backup; automatic upgrade was refused.");
  }
}

function transactionBody(sql) {
  const opening = /^(\s*(?:--[^\n]*(?:\n|$)\s*)*)BEGIN\s*;/i;
  const closing = /COMMIT\s*;\s*$/i;
  assert.equal(opening.test(sql), closing.test(sql), "Preview migration has unmatched transaction wrappers");
  return sql.replace(opening, "$1").replace(closing, "");
}

export async function upgradeLocalPreview(pool) {
  await assertCanonicalLocalPreview(pool);
  const states = [];
  let missing = false;
  for (const [name, markers] of localPreviewUpgrades) {
    const observations = await Promise.all(markers.map(marker => present(pool, marker)));
    const complete = observations.every(Boolean), absent = observations.every(value => !value);
    assert.ok(complete || absent, `Preview migration ${name} is partial. Keep its backup; automatic upgrade was refused.`);
    assert.ok(!(missing && complete), `Preview migration ${name} is out of order. Keep its backup; automatic upgrade was refused.`);
    missing ||= absent;
    states.push({ name, markers, complete });
  }
  const applied = [];
  for (const { name, markers, complete } of states) {
    if (complete) continue;
    const sql = transactionBody(await readFile(new URL(`../server/prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8"));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      assert.ok((await Promise.all(markers.map(marker => present(client, marker)))).every(Boolean), `Preview migration ${name} did not complete`);
      await client.query("COMMIT");
      applied.push(name);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  return applied;
}
