import React, { createContext, useContext, useState, useEffect } from 'react';

interface UserInfo {
  id: string;
  email: string;
  name: string;
  companies: Array<{
    id: string;
    companyId: string;
    role: string;
    company: {
      id: string;
      name: string;
    };
  }>;
}

interface AuthContextType {
  user: UserInfo | null;
  loading: boolean;
  login: () => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }

      const res = await fetch('/api/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
      } else {
        setUser(null);
        if (res.status === 401) {
          localStorage.removeItem('access_token');
        }
      }
    } catch (err) {
      console.error('Failed to refresh user:', err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('id_token=') || hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get('id_token') || params.get('access_token');
      if (token) {
        localStorage.setItem('access_token', token);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
    refreshUser();
  }, []);

  const login = () => {
    const domain = import.meta.env.VITE_COGNITO_DOMAIN;
    const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
    const redirectUri = window.location.origin;
    window.location.href = `${domain}/login?client_id=${clientId}&response_type=token&scope=email+openid+profile&redirect_uri=${redirectUri}`;
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('active_company_id');
    setUser(null);
    window.location.href = '/';
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
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
