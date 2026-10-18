import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import { api, ApiError, setCsrfToken } from "../api";
import { monitorOperation } from "../operations";
import type { Capability } from "../navigation";
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
};
type Auth = {
  user: Bootstrap["user"] | undefined;
  data: Bootstrap | null;
  loading: boolean;
  error: string | null;
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
    [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const refreshUser = useCallback(async () => {
    const current = ++version.current;
    try {
      const result = await monitorOperation("auth.session.restore", () =>
        api<Bootstrap>("/api/bootstrap"),
      );
      if (current !== version.current) return;
      setCsrfToken(result.csrfToken);
      setData(result);
      setError(null);
    } catch (error) {
      if (current !== version.current) return;
      setData(null);
      setCsrfToken("");
      setError(
        error instanceof ApiError && error.status === 401
          ? null
          : "We could not load your account. Try again.",
      );
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refreshUser();
    const expired = () => {
      setData(null);
      setCsrfToken("");
    };
    const focus = () => {
      void refreshUser();
    };
    window.addEventListener("session-expired", expired);
    window.addEventListener("focus", focus);
    return () => {
      ++version.current;
      window.removeEventListener("session-expired", expired);
      window.removeEventListener("focus", focus);
    };
  }, [refreshUser]);
  const signIn = () => {
    window.location.assign(
      `/api/auth/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`,
    );
  };
  const switchAccount = () => window.location.assign(`/api/auth/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}&switchAccount=1`);
  const signOut = () => {
    void api<{ logoutUrl: string }>("/api/auth/logout", {
      method: "POST",
      body: {},
    })
      .then((result) => {
        ++version.current;
        setData(null);
        setCsrfToken("");
        window.location.assign(result.logoutUrl);
      })
      .catch(() => setError("Unable to sign out. Please try again."));
  };
  return (
    <AuthContext.Provider
      value={{
        data,
        user: data?.user,
        loading,
        error,
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
