import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import { flushSync } from "react-dom";
import { api, ApiError, setCsrfToken, setImpersonationContext } from "../api";
import { monitorOperation } from "../operations";
import type { Capability } from "../navigation";
import type { CompanyFeatures } from "../company-features";
import { supportSessionSource } from "../impersonation";
export type Bootstrap = {
  user: {
    id: string;
    name: string | null;
    email: string;
    emailVerified: boolean;
    status: string;
    platformRole: string | null;
  };
  membership: null | {
    companyId: string;
    version: number;
    role: string;
    status: string;
    company: { id: string; name: string; status: string };
  };
  permissions: Capability[];
  destination: string;
  csrfToken: string;
  companyFeatures?: CompanyFeatures | null;
  impersonation?: null | {
    actor: { id: string; name: string | null; email: string };
    expiresAt: string;
    readOnly: true;
    contextId: string;
    unavailable?: boolean;
  };
};
type AuthActionError = { action: "sign_out" | "sign_in" | "switch_account"; message: string };
type Auth = {
  user: Bootstrap["user"] | undefined;
  data: Bootstrap | null;
  loading: boolean;
  error: string | null;
  actionError: AuthActionError | null;
  refreshUser: () => Promise<void>;
  signIn: () => void;
  switchAccount: () => void;
  signOut: () => void;
  can: (p: Capability) => boolean;
};
const AuthContext = createContext<Auth | undefined>(undefined);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Bootstrap | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [actionError, setActionError] = useState<AuthActionError | null>(null);
  const version = useRef(0), signingOut = useRef(false);
  const restoredIdentity = useRef<string | null>(null);
  const contextInvalidated = useRef(false);
  const invalidatePrivateContext = useCallback(() => {
    contextInvalidated.current = true;
    ++version.current;
    setCsrfToken("");
    setImpersonationContext("");
    // A native unload warning can cancel navigation. Remove the former
    // workspace first, including its private editors; recovery journals stay.
    flushSync(() => {
      setData(null);
      setActionError(null);
      setLoading(false);
      setError("Your account or support session changed. Reload the workspace to continue.");
    });
  }, []);
  const refreshUser = useCallback(async () => {
    if (contextInvalidated.current) { window.location.reload(); return; }
    const current = ++version.current;
    try {
      const result = await monitorOperation("auth.session.restore", () =>
        api<Bootstrap>("/api/bootstrap"),
      );
      if (current !== version.current) return;
      const identity = `${result.user.id}:${result.impersonation?.contextId || ""}`;
      if (restoredIdentity.current !== null && restoredIdentity.current !== identity) {
        invalidatePrivateContext();
        window.location.assign("/dashboard");
        return;
      }
      restoredIdentity.current = identity;
      setImpersonationContext(result.impersonation?.contextId || "");
      setCsrfToken(result.csrfToken);
      setData(result);
      setError(null);
    } catch (error) {
      if (current !== version.current) return;
      setData(null);
      setActionError(null);
      setCsrfToken("");
      setImpersonationContext("");
      setError(
        error instanceof ApiError && error.status === 401
          ? null
          : "We could not load your account. Try again.",
      );
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, [invalidatePrivateContext]);
  useEffect(() => {
    void refreshUser();
    const expired = () => {
      // A definitive 401 outranks every restore started before it. Otherwise
      // an older successful bootstrap could repopulate a revoked workspace.
      ++version.current;
      setLoading(false);
      setError(null);
      setData(null);
      setActionError(null);
      setCsrfToken("");
      setImpersonationContext("");
    };
    const focus = () => {
      if (!contextInvalidated.current) void refreshUser();
    };
    window.addEventListener("session-expired", expired);
    window.addEventListener("focus", focus);
    let reloading = false;
    const changed = () => {
      if (reloading) return;
      reloading = true;
      invalidatePrivateContext();
      window.location.reload();
    };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("property-flow-support-session");
    if (channel) channel.onmessage = (event) => {
      if (event.data?.source !== supportSessionSource) changed();
    };
    window.addEventListener("impersonation-context-changed", changed);
    return () => {
      ++version.current;
      window.removeEventListener("session-expired", expired);
      window.removeEventListener("focus", focus);
      window.removeEventListener("impersonation-context-changed", changed);
      channel?.close();
    };
  }, [refreshUser, invalidatePrivateContext]);
  const signIn = () => {
    if (data?.impersonation) {
      setActionError({ action: "sign_in", message: "End impersonation before starting another sign-in." });
      return;
    }
    setActionError(null);
    window.location.assign(
      `/api/auth/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`,
    );
  };
  const switchAccount = () => {
    if (data?.impersonation) {
      setActionError({ action: "switch_account", message: "End impersonation before switching accounts." });
      return;
    }
    setActionError(null);
    window.location.assign(`/api/auth/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}&switchAccount=1`);
  };
  const signOut = () => {
    if (signingOut.current || contextInvalidated.current) return;
    const identity = restoredIdentity.current;
    signingOut.current = true;
    setActionError(null);
    void api<{ logoutUrl: string }>("/api/auth/logout", {
      method: "POST",
      body: {},
    })
      .then((result) => {
        if (contextInvalidated.current || restoredIdentity.current !== identity) return;
        ++version.current;
        setData(null);
        setActionError(null);
        setCsrfToken("");
        setImpersonationContext("");
        window.location.assign(result.logoutUrl);
      })
      .catch(() => {
        // A failed account action does not invalidate a restored session. A
        // denied bootstrap/session event still removes the private workspace.
        if (!contextInvalidated.current && restoredIdentity.current === identity)
          setActionError({ action: "sign_out", message: "Unable to sign out. Please try again." });
      })
      .finally(() => { signingOut.current = false; });
  };
  return (
    <AuthContext.Provider
      value={{
        data,
        user: data?.user,
        loading,
        error,
        actionError,
        refreshUser,
        signIn,
        switchAccount,
        signOut,
        can: (p) => !!data?.permissions.includes(p),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is required");
  return value;
}
