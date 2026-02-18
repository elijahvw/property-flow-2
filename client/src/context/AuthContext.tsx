import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth0, User } from '@auth0/auth0-react';

export type UserRole = 'tenant' | 'landlord' | 'admin';

interface AuthContextType {
  user: User | undefined;
  role: UserRole | null;
  loading: boolean;
  signOut: () => void;
  signIn: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Key for custom roles claim in Auth0 token
const ROLES_CLAIM = 'https://propertyflow.com/roles';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { 
    user, 
    isAuthenticated, 
    isLoading: auth0Loading, 
    logout, 
    loginWithRedirect 
  } = useAuth0();
  
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth0Loading) {
      if (isAuthenticated && user) {
        // Extract role from custom claim
        const userRoles = user[ROLES_CLAIM] || [];
        if (userRoles.includes('admin')) setRole('admin');
        else if (userRoles.includes('landlord')) setRole('landlord');
        else if (userRoles.includes('tenant')) setRole('tenant');
        else setRole(null);
      } else {
        setRole(null);
      }
      setLoading(false);
    }
  }, [auth0Loading, isAuthenticated, user]);

  const signOut = () => {
    logout({ logoutParams: { returnTo: window.location.origin } });
  };

  const signIn = () => {
    loginWithRedirect();
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      role, 
      loading: auth0Loading || loading, 
      signOut, 
      signIn 
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
