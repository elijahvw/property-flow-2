import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';

export const Navbar: React.FC = () => {
  const { user, login, logout } = useAuth();
  const { activeCompany } = useTenant();

  return (
    <nav className="navbar">
      <div className="nav-brand">PropertyFlow</div>
      <div className="nav-user">
        {user ? (
          <div className="user-profile">
            <span>{user.name} ({user.companies.find(c => c.companyId === activeCompany?.id)?.role?.replace('_', ' ') || 'No Role'})</span>
            <button className="btn-logout" onClick={logout}>Logout</button>
          </div>
        ) : (
          <button className="btn-login" onClick={login}>Login</button>
        )}
      </div>
    </nav>
  );
};

export const BaseLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="app">
      <Navbar />
      <main className="main">
        {children}
      </main>
    </div>
  );
};
