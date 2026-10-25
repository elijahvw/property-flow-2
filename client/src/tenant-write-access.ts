import { useLayoutEffect, useRef } from "react";
import type { Bootstrap } from "./context/AuthContext";
import type { CompanyFeatures } from "./company-features";

export function tenantLeasingWriteBlock(features?: CompanyFeatures | null) {
  if (features?.leasing === "read_only") return "Tenant records are read-only under your company’s current leasing settings. Your draft and any interrupted save are kept.";
  if (features?.leasing === "disabled") return "Leasing is disabled for this company. Interrupted saves are kept for recovery.";
  return null;
}

export function tenantPortalAvailabilityNote(features?: CompanyFeatures | null) {
  if (features?.resident_portal === "disabled") return "The resident portal is currently disabled for this company. Saving an account or preparing an invitation does not enable the resident workspace.";
  if (features?.resident_portal === "read_only") return "The resident portal is currently read-only. Tenant records and invitation setup are separate from the resident workspace’s access settings.";
  return null;
}

// Policy refreshes may retain a same-authority editor. Changes to identity,
// company or authority must start a new private editor scope instead.
export function tenantEditorScope(auth: Bootstrap | null) {
  return JSON.stringify([auth?.user.id, auth?.user.email, auth?.user.status, auth?.user.emailVerified,
    auth?.membership?.companyId, auth?.membership?.version, auth?.membership?.role, auth?.membership?.status,
    auth?.membership?.company.status, auth?.permissions, auth?.impersonation?.contextId]);
}

export function tenantSaveStorageKey(auth: Bootstrap | null, contactId = "new") {
  return `pf:tenant-draft:${auth?.user.id}:${auth?.membership?.companyId}:${contactId}`;
}

export function hasTenantSaveRecovery(auth: Bootstrap | null, contactId = "new") {
  try { return JSON.parse(sessionStorage.getItem(tenantSaveStorageKey(auth, contactId)) || "null")?.pending === true; }
  catch { return false; }
}

export function useTenantAttemptContext(auth: Bootstrap | null, expectedCompanyId?: string) {
  const scope = tenantEditorScope(auth);
  const opening = useRef({ scope, companyId: expectedCompanyId ?? auth?.membership?.companyId });
  const latest = useRef({ scope, companyId: auth?.membership?.companyId });
  latest.current = { scope, companyId: auth?.membership?.companyId };
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return { companyId: opening.current.companyId,
    current: () => mounted.current && !!opening.current.companyId && latest.current.scope === opening.current.scope && latest.current.companyId === opening.current.companyId };
}

export function useTenantEditorRecord<T>(resource: { data?: T; loading: boolean; errorStatus?: number }, scope: string) {
  const retained = useRef<{ scope: string; data: T } | null>(null);
  if ([401, 403, 404].includes(resource.errorStatus || 0)) { retained.current = null; return undefined; }
  if (retained.current?.scope !== scope) retained.current = null;
  if (resource.data !== undefined) retained.current = { scope, data: resource.data };
  return resource.data ?? (resource.loading ? retained.current?.data : undefined);
}
