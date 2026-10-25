import { useLayoutEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { useAuth } from "./context/AuthContext";
import { tenantEditorScope } from "./tenant-write-access";

type Payload = Record<string, unknown>;
export type AcquisitionRequest = { method: string; path: string; body: Payload; companyId: string };
function retained(key: string, companyId?: string): AcquisitionRequest | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    return value?.companyId === companyId && typeof value.body?.submissionKey === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.body.submissionKey) && ["POST", "PATCH", "PUT"].includes(value.method) && /^\/api\/company\/(?:applications(?:\/|$)|prospects(?:\/|$)|units\/[^/]+\/rental-listing$)/.test(value.path) ? value : null;
  } catch { return null; }
}

// Only an attempted request is persisted. Ordinary editor input stays page-only.
export function useAcquisitionMutation(name: string) {
  const { data, refreshUser } = useAuth();
  const scope = tenantEditorScope(data), companyId = data?.membership?.companyId;
  const opening = useRef({ scope, companyId }), latest = useRef({ scope, companyId });
  latest.current = { scope, companyId };
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && !!opening.current.companyId && opening.current.scope === latest.current.scope && opening.current.companyId === latest.current.companyId;
  const storageKey = `pf:acquisition-request:${data?.user.id}:${companyId}:${name}`;
  const [initial] = useState(() => retained(storageKey, companyId));
  const journal = useRef<AcquisitionRequest | null>(initial);
  const key = useRef(String(initial?.body.submissionKey || crypto.randomUUID()));
  const [pending, setPending] = useState(!!initial), [busy, setBusy] = useState(false), [conflict, setConflict] = useState(false), [denied, setDenied] = useState(false);
  async function run<T>(path: string, method: string, body: Payload): Promise<T> {
    if (!current()) throw new ApiError("Your company or account changed. Reload before continuing this request.", 409, "ACQUISITION_CONTEXT_CHANGED", pending);
    if (data?.impersonation || [data?.companyFeatures?.leasing, data?.companyFeatures?.properties].some(value => value === "read_only" || value === "disabled")) throw new Error("This acquisition workflow is read-only under the current company settings. The original review is kept.");
    const wasRecovering = !!journal.current;
    const request = journal.current || { path, method, body: { ...body, submissionKey: key.current }, companyId: opening.current.companyId! };
    journal.current = request; sessionStorage.setItem(storageKey, JSON.stringify(request));
    setBusy(true); setPending(true); setConflict(false);
    try {
      const result = await api<T>(request.path, { method: request.method, body: request.body, expectedCompanyId: request.companyId, timeoutMs: 60000 });
      if (!current()) throw new ApiError("Your account or company changed before the result was acknowledged. The original request is kept for recovery.", 409, "ACQUISITION_CONTEXT_CHANGED", true);
      sessionStorage.removeItem(storageKey); journal.current = null; setPending(false); key.current = crypto.randomUUID();
      return result;
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409) setConflict(true);
        if (error.status === 401 || error.status === 404 || error.status === 403 && ["ACCESS_DENIED", "COMPANY_ACCESS_DENIED", "FEATURE_DISABLED", "EMAIL_VERIFICATION_REQUIRED", "IMPERSONATION_UNAVAILABLE"].includes(error.code)) { setDenied(true); void refreshUser(); }
        if (!wasRecovering && !error.submissionUncertain && !["IMPERSONATION_CONTEXT_CHANGED", "ACQUISITION_CONTEXT_CHANGED", "SUBMISSION_MISMATCH"].includes(error.code) && [400, 403, 404, 409].includes(error.status)) {
          sessionStorage.removeItem(storageKey); journal.current = null; key.current = crypto.randomUUID(); setPending(false); setConflict(error.status === 409);
        } else error.submissionUncertain = true;
      }
      throw error;
    } finally { if (mounted.current) setBusy(false); }
  }
  const useCurrent = () => {
    if (!current() || busy) return false;
    sessionStorage.removeItem(storageKey); journal.current = null; setPending(false); setConflict(false); key.current = crypto.randomUUID(); return true;
  };
  const readDenied = () => { setDenied(true); void refreshUser(); };
  return { initial, request: journal.current, run, pending, busy, conflict, denied, current, useCurrent, readDenied, companyId: opening.current.companyId };
}

export function hasAcquisitionRecovery(name: string, userId?: string, companyId?: string) {
  return !!retained(`pf:acquisition-request:${userId}:${companyId}:${name}`, companyId);
}
