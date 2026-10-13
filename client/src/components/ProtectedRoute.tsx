import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, UserRole } from '../context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { user, role, loading, error, signIn, isConfigured } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loader" role="status">Restoring your sign-in…</div>
      </div>
    );
  }

  if (!isConfigured) {
    return (
      <div className="error-container">
        <h1>Authentication Not Configured</h1>
        <p>This page is protected but Auth0 is not configured in the environment variables.</p>
        <button className="btn-primary" onClick={() => window.location.href = '/'}>Go Home</button>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="error-container">
        <h1>{error ? 'Unable to load your account' : 'Sign in to continue'}</h1>
        {error && <p role="alert">{error}</p>}
        <button className="btn-primary" onClick={signIn}>Sign In</button>
        <button className="btn-secondary" onClick={() => window.location.reload()}>Reload</button>
        <button className="btn-secondary" onClick={() => window.location.href = '/'}>Go Home</button>
      </div>
    );
  }

  if (allowedRoles && !role) {
    return (
      <div className="error-container">
        <h1>Account access pending</h1>
        <p>Your account needs a role before you can open this page. Contact your administrator, then sign out and sign in again after access is assigned.</p>
        <button className="btn-secondary" onClick={() => window.location.href = '/'}>Go Home</button>
      </div>
    );
  }

  if (allowedRoles && !allowedRoles.includes(role!)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
