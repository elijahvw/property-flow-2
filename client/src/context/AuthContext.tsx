import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth0, User } from '@auth0/auth0-react';

import axios from 'axios';

export type UserRole = 'tenant' | 'landlord' | 'admin';

interface AuthContextType {
  user: User | undefined;
  dbUser: any | null;
  role: UserRole | null;
  companyId: string | null;
  loading: boolean;
  signOut: () => void;
  signIn: () => void;
  isConfigured: boolean;
  refreshUser: () => Promise<void>;
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
  const [dbUser, setDbUser] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const isConfigured = !!auth0;

  const refreshUser = async () => {
    if (auth0?.isAuthenticated) {
      try {
        const token = await auth0.getAccessTokenSilently();
        const response = await axios.get('/api/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setDbUser(response.data);
      } catch (err) {
        console.error('Error fetching db user:', err);
      }
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      if (auth0 && !auth0.isLoading) {
        if (auth0.isAuthenticated && auth0.user) {
          // Extract role from custom claim
          const userRoles = auth0.user[ROLES_CLAIM] || [];
          if (userRoles.includes('admin')) setRole('admin');
          else if (userRoles.includes('landlord')) setRole('landlord');
          else if (userRoles.includes('tenant')) setRole('tenant');
          else setRole(null);

          // Fetch DB user record
          await refreshUser();
        } else {
          setRole(null);
          setDbUser(null);
        }
        setLoading(false);
      } else if (!auth0) {
        setRole(null);
        setLoading(false);
      }
    };

    initAuth();
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
      dbUser,
      role,
      companyId: dbUser?.companyId || null,
      loading: (auth0?.isLoading || false) || loading, 
      signOut, 
      signIn,
      isConfigured,
      refreshUser
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
