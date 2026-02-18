import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

interface TenantContextType {
  activeCompanyId: string | null;
  setActiveCompanyId: (id: string) => void;
  activeCompany: any | null;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [activeCompanyId, setActiveCompanyIdState] = useState<string | null>(null);

  useEffect(() => {
    if (user && user.companies.length > 0) {
      const saved = localStorage.getItem('active_company_id');
      const isValid = user.companies.find(c => c.companyId === saved);
      
      if (saved && isValid) {
        setActiveCompanyIdState(saved);
      } else {
        const defaultId = user.companies[0].companyId;
        setActiveCompanyIdState(defaultId);
        localStorage.setItem('active_company_id', defaultId);
      }
    } else {
      setActiveCompanyIdState(null);
    }
  }, [user]);

  const setActiveCompanyId = (id: string) => {
    setActiveCompanyIdState(id);
    localStorage.setItem('active_company_id', id);
  };

  const activeCompany = user?.companies.find(c => c.companyId === activeCompanyId)?.company || null;

  return (
    <TenantContext.Provider value={{ activeCompanyId, setActiveCompanyId, activeCompany }}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};
