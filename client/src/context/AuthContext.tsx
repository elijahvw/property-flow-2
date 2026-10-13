import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useAuth0, User } from '@auth0/auth0-react';
import axios from 'axios';
import { loadProfile } from '../auth-profile';
import { startOperation, monitorOperation } from '../operations';

export type UserRole = 'tenant' | 'landlord' | 'admin';
interface AuthContextType {
  user: User | undefined;
  dbUser: any | null;
  role: UserRole | null;
  companyId: string | null;
  loading: boolean;
  error: string | null;
  signOut: () => void;
  signIn: () => void;
  isConfigured: boolean;
  refreshUser: () => Promise<void>;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth0 = useAuth0();
  const isConfigured = !!import.meta.env.VITE_AUTH0_DOMAIN && !!import.meta.env.VITE_AUTH0_CLIENT_ID;
  const [role, setRole] = useState<UserRole | null>(null);
  const [dbUser, setDbUser] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const sessionOperation = useRef<ReturnType<typeof startOperation> | null>(null);
  const sessionTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isConfigured) return;
    sessionOperation.current = startOperation('auth.session.restore', 11000);
    sessionTimer.current = setTimeout(() => {
      sessionOperation.current?.fail(null);
      setError('We could not restore your sign-in promptly. Sign in again or reload to retry.');
      setLoading(false);
    }, 10000);
    return () => {
      clearTimeout(sessionTimer.current);
      sessionOperation.current?.abandon();
    };
  }, [isConfigured]);

  const refreshUser = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!isConfigured || !auth0.isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const profile = await monitorOperation('auth.profile.load', () => loadProfile(
        () => auth0.getAccessTokenSilently({ timeoutInSeconds: 8 }),
        async (token, signal) => (await axios.get('/api/me', {
          headers: { Authorization: `Bearer ${token}` }, timeout: 8000, signal,
        })).data,
      ));
      if (version !== requestVersion.current) return;
      setDbUser(profile);
      setRole(['admin', 'landlord', 'tenant'].includes(profile.role) ? profile.role : null);
    } catch {
      if (version !== requestVersion.current) return;
      setDbUser(null);
      setRole(null);
      setError('We could not load your account. Sign in again or reload to retry.');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [isConfigured, auth0.isAuthenticated, auth0.getAccessTokenSilently]);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }
    if (auth0.isLoading) return;
    clearTimeout(sessionTimer.current);
    if (auth0.error) {
      sessionOperation.current?.fail(null);
      setError('We could not restore your sign-in. Sign in again to continue.');
      setRole(null);
      setDbUser(null);
      setLoading(false);
    } else {
      sessionOperation.current?.succeed();
      if (auth0.isAuthenticated) {
        void refreshUser();
      } else {
        setError(null);
        setRole(null);
        setDbUser(null);
        setLoading(false);
      }
    }
    return () => { ++requestVersion.current; };
  }, [isConfigured, auth0.isLoading, auth0.isAuthenticated, auth0.error, refreshUser]);

  const signIn = () => {
    if (!isConfigured) return;
    setError(null);
    // Interactive redirect can use the Auth0 first-party session when silent
    // restoration is blocked by browser cookie privacy settings.
    void auth0.loginWithRedirect({
      appState: { returnTo: window.location.pathname === '/' ? '/dashboard' : window.location.pathname },
    }).catch(() => setError('Unable to open sign-in. Please try again.'));
  };
  const signOut = () => {
    if (isConfigured) void auth0.logout({ logoutParams: { returnTo: window.location.origin } });
  };
  return (
    <AuthContext.Provider value={{
      user: auth0.user, dbUser, role, companyId: dbUser?.companyId || null,
      loading, error, signOut, signIn, isConfigured, refreshUser,
    }}>{children}</AuthContext.Provider>
  );
};
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
