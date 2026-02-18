import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth0, User } from '@auth0/auth0-react';

export type UserRole = 'tenant' | 'landlord' | 'admin';

interface AuthContextType {
  user: User | undefined;
  role: UserRole | null;
  loading: boolean;
  signOut: () => void;
  signIn: () => void;
  isConfigured: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Key for custom roles claim in Auth0 token
const ROLES_CLAIM = 'https://propertyflow.com/roles';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth0 = (() => {
    try {
      return useAuth0();
    } catch (e) {
      return null;
    }
  })();
  
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  const isConfigured = !!auth0;

  useEffect(() => {
    if (auth0 && !auth0.isLoading) {
      if (auth0.isAuthenticated && auth0.user) {
        // Extract role from custom claim
        const userRoles = auth0.user[ROLES_CLAIM] || [];
        if (userRoles.includes('admin')) setRole('admin');
        else if (userRoles.includes('landlord')) setRole('landlord');
        else if (userRoles.includes('tenant')) setRole('tenant');
        else setRole(null);
      } else {
        setRole(null);
      }
      setLoading(false);
    } else if (!auth0) {
      setRole(null);
      setLoading(false);
    }
  }, [auth0?.isLoading, auth0?.isAuthenticated, auth0?.user]);

  const signOut = () => {
    if (auth0) {
      auth0.logout({ logoutParams: { returnTo: window.location.origin } });
    }
  };

  const signIn = () => {
    if (auth0) {
      auth0.loginWithRedirect();
    } else {
      alert('Auth0 is not configured. Please check your .env file.');
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user: auth0?.user, 
      role, 
      loading: (auth0?.isLoading || false) || loading, 
      signOut, 
      signIn,
      isConfigured
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
