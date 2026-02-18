import React, { Component, ErrorInfo, ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Auth0Provider } from '@auth0/auth0-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import About from './pages/About';
import LandlordDashboard from './pages/LandlordDashboard';
import TenantPortal from './pages/TenantPortal';
import AdminDashboard from './pages/AdminDashboard';
import './App.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-container">
          <h1>Something went wrong.</h1>
          <pre>{this.state.error?.message}</pre>
          <button className="btn-primary" onClick={() => window.location.reload()}>Reload Page</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const Navbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role, signOut, signIn, loading } = useAuth();

  if (loading) return (
    <nav className="navbar">
      <div className="nav-brand">PropertyFlow</div>
    </nav>
  );

  return (
    <nav className="navbar">
      <div className="nav-brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>PropertyFlow</div>
      <div className="nav-actions">
        <button 
          className={`nav-btn ${location.pathname === '/' ? 'active' : ''}`}
          onClick={() => navigate('/')}
        >
          Home
        </button>
        <button 
          className={`nav-btn ${location.pathname === '/about' ? 'active' : ''}`}
          onClick={() => navigate('/about')}
        >
          About
        </button>
        
        {user && (role === 'landlord' || role === 'admin') && (
          <button 
            className={`nav-btn ${location.pathname === '/landlord' ? 'active' : ''}`}
            onClick={() => navigate('/landlord')}
          >
            Landlord
          </button>
        )}
        
        {user && (role === 'tenant' || role === 'admin') && (
          <button 
            className={`nav-btn ${location.pathname === '/tenant' ? 'active' : ''}`}
            onClick={() => navigate('/tenant')}
          >
            Tenant
          </button>
        )}
        
        {user && role === 'admin' && (
          <button 
            className={`nav-btn ${location.pathname === '/admin' ? 'active' : ''}`}
            onClick={() => navigate('/admin')}
          >
            Admin
          </button>
        )}

        {!user ? (
          <button className="nav-btn active" onClick={signIn}>
            Sign In
          </button>
        ) : (
          <div className="user-profile">
            <span className="user-name">{user.name}</span>
            <button className="nav-btn" onClick={signOut}>
              Sign Out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
};

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
      
      <Route 
        path="/landlord" 
        element={
          <ProtectedRoute allowedRoles={['landlord', 'admin']}>
            <LandlordDashboard />
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/tenant" 
        element={
          <ProtectedRoute allowedRoles={['tenant', 'admin']}>
            <TenantPortal />
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/admin" 
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminDashboard />
          </ProtectedRoute>
        } 
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

const auth0Domain = import.meta.env.VITE_AUTH0_DOMAIN;
const auth0ClientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const auth0Audience = import.meta.env.VITE_AUTH0_AUDIENCE;

const OptionalAuth0Provider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (!auth0Domain || !auth0ClientId) {
    return <AuthProvider>{children}</AuthProvider>;
  }

  return (
    <Auth0Provider
      domain={auth0Domain}
      clientId={auth0ClientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: auth0Audience,
      }}
    >
      <AuthProvider>{children}</AuthProvider>
    </Auth0Provider>
  );
};

function App() {
  return (
    <ErrorBoundary>
      <OptionalAuth0Provider>
        <Router>
          <div className="app">
            <Navbar />
            <main className="main">
              <AppRoutes />
            </main>
          </div>
        </Router>
      </OptionalAuth0Provider>
    </ErrorBoundary>
  );
}

export default App;
