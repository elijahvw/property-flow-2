import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { useAuth } from "./context/AuthContext";
import { featureKeysForPage } from "./company-features";
import { tenantEditorScope } from "./tenant-write-access";

export type FinanceCreateBody = {
  propertyId: string; occurredOn: string; amount: string; kind: "income" | "expense";
  category: string; memo: string | null; submissionKey: string;
};
export type FinanceCreateAttempt = { actorId: string; companyId: string; body: FinanceCreateBody };
export const financeCreateStorageKey = (actorId?: string, companyId?: string) => `pf:finance-create:${actorId}:${companyId}`;

export function parseFinanceCreateAttempt(raw: string | null, actorId?: string, companyId?: string): FinanceCreateAttempt | null {
  try {
    if (!raw || raw.length > 6000) return null;
    const value = JSON.parse(raw || "null"), b = value?.body;
    if (!actorId || !companyId || value?.actorId !== actorId || value?.companyId !== companyId || !b ||
      Object.keys(value).sort().join(",") !== "actorId,body,companyId" ||
      Object.keys(b).sort().join(",") !== "amount,category,kind,memo,occurredOn,propertyId,submissionKey" ||
      typeof b.propertyId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_|:@.\-]{0,199}$/.test(b.propertyId) ||
      typeof b.submissionKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.submissionKey) ||
      typeof b.occurredOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.occurredOn) ||
      typeof b.amount !== "string" || b.amount.length > 40 || !["income", "expense"].includes(b.kind) ||
      typeof b.category !== "string" || b.category.length > 40 || b.memo !== null && (typeof b.memo !== "string" || b.memo.length > 500)) return null;
    return value;
  } catch { return null; }
}

// This journal is only for manual cash creation after Submit. Unsent drafts
// stay in React memory. It never authorizes a write or substitutes a new key.
export function useFinanceCreateRecovery() {
  const { data: auth, refreshUser } = useAuth();
  const scope = tenantEditorScope(auth), actorId = auth?.user.id, companyId = auth?.membership?.companyId;
  const storageKey = financeCreateStorageKey(actorId, companyId);
  const opening = useRef({ scope, actorId, companyId, storageKey }), latest = useRef(scope), mounted = useRef(true);
  latest.current = scope;
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && !!opening.current.companyId && opening.current.scope === latest.current;
  const features = featureKeysForPage("/company/finances", auth?.membership?.role);
  const canRead = !!companyId && !!actorId && auth?.user.status === "active" && auth?.user.emailVerified !== false &&
    auth?.membership?.status === "active" && auth?.membership?.company.status === "active" && !auth?.impersonation &&
    auth?.permissions.includes("finance.manage") && features.every(feature => auth?.companyFeatures?.[feature] !== "disabled");
  const canWrite = canRead && features.every(feature => (auth?.companyFeatures?.[feature] || "enabled") === "enabled");
  const writePolicy = useRef(canWrite);
  writePolicy.current = canWrite;
  const policy = JSON.stringify(features.map(feature => auth?.companyFeatures?.[feature] || "enabled"));
  const [initial] = useState(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return { request: parseFinanceCreateAttempt(raw, actorId, companyId), blocked: !!raw };
    } catch { return { request: null, blocked: true }; }
  });
  const journal = useRef(initial.request);
  const [pending, setPending] = useState(initial.blocked), [authorized, setAuthorized] = useState(""), [denied, setDenied] = useState(false),
    [checking, setChecking] = useState(initial.blocked), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  const authorizationKey = `${scope}:${policy}:${revision}`;
  useEffect(() => {
    if (!pending || denied || authorized === authorizationKey) return;
    setAuthorized("");
    if (!current() || !canRead) { setChecking(false); return; }
    if (!journal.current) { setChecking(false); setError("The interrupted cash request cannot be read safely. Keep this tab’s recovery data and contact your administrator before recording another transaction."); return; }
    const controller = new AbortController();
    setChecking(true); setError("");
    void api<{ items: unknown[]; summary: unknown }>(`/api/company/finances?${new URLSearchParams({ propertyId: journal.current.body.propertyId })}`,
      { expectedCompanyId: opening.current.companyId, signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted && current()) {
          if (!Array.isArray(result.items) || !result.summary) throw new Error("The current cash workspace could not be verified.");
          setChecking(false);
          setAuthorized(authorizationKey);
        }
      }).catch(failure => {
        if (!controller.signal.aborted && current()) setError(failure instanceof Error ? failure.message : "Unable to verify current cash access.");
      }).finally(() => { if (!controller.signal.aborted && current()) setChecking(false); });
    return () => controller.abort();
  }, [pending, authorizationKey, canRead, authorized, denied]);
  const visible = current() && canRead && !denied && authorized === authorizationKey;
  const currentRead = useRef(visible);
  currentRead.current = visible;
  async function run<T>(body: FinanceCreateBody): Promise<T> {
    if (!current() || !writePolicy.current) throw new Error("Cash activity is read-only or your account changed. The original request is kept.");
    const recovering = !!journal.current;
    if (pending && !journal.current || recovering && !currentRead.current) throw new Error("Verify current cash access before recovering this request.");
    const request = journal.current || { actorId: opening.current.actorId!, companyId: opening.current.companyId!, body };
    // A storage failure prevents the request rather than submitting without a
    // durable retry identity. Persist exact strings before crossing the network.
    sessionStorage.setItem(opening.current.storageKey, JSON.stringify(request));
    journal.current = request; setPending(true);
    // The normal editor already loaded its authorized workspace. Recovery on a
    // new mount still requires the fresh original-property read above.
    if (!recovering) setAuthorized(authorizationKey);
    try {
      const result = await api<T>("/api/company/finances", { method: "POST", body: request.body, expectedCompanyId: request.companyId });
      if (!current()) throw new ApiError("Your workspace changed before the result was acknowledged. The original request is retained.", 409, "FINANCE_CONTEXT_CHANGED", true);
      sessionStorage.removeItem(opening.current.storageKey); journal.current = null; setPending(false); setAuthorized("");
      return result;
    } catch (failure) {
      if (failure instanceof ApiError) {
        if (!recovering && failure.status === 400 && !failure.submissionUncertain) {
          sessionStorage.removeItem(opening.current.storageKey); journal.current = null; setPending(false);
        } else {
          failure.submissionUncertain = true;
          if ([401, 403, 404].includes(failure.status)) { setAuthorized(""); setDenied(true); setChecking(false); setError("Current access must be checked again before this transaction can be reviewed."); }
        }
      }
      throw failure;
    }
  }
  return { pending, request: visible ? journal.current : null, checking, error: current() && canRead ? error : "", canRead, canWrite,
    readDenied: () => { setAuthorized(""); setDenied(true); setChecking(false); setError("Current cash access is unavailable. The submitted request remains retained."); },
    run, retryRead: async () => { await refreshUser(); if (current()) { setDenied(false); setRevision(value => value + 1); } } };
}
