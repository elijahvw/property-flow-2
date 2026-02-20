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
import Properties from './pages/Properties';
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
  const { user, signOut, signIn, loading } = useAuth();

  // If user is logged in and not on public pages, we don't show the public navbar
  // instead they get the PortalLayout.
  const isPublicPage = location.pathname === '/' || location.pathname === '/about';
  if (user && !isPublicPage) return null;

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

        {!user ? (
          <button className="nav-btn active" onClick={signIn}>
            Sign In
          </button>
        ) : (
          <button className="nav-btn active" onClick={() => {
            // Redirect based on role if they are on home page
            window.location.href = '/dashboard';
          }}>
            Go to Portal
          </button>
        )}
      </div>
    </nav>
  );
};

const PortalLayout = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role, signOut } = useAuth();

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: '📊', roles: ['tenant', 'landlord', 'admin'] },
    { name: 'Properties', path: '/properties', icon: '🏠', roles: ['tenant', 'landlord', 'admin'] },
    { name: 'Messages', path: '/messages', icon: '💬', roles: ['tenant', 'landlord', 'admin'] },
    { name: 'Admin', path: '/admin', icon: '⚙️', roles: ['admin'] },
  ];

  const filteredNavItems = navItems.filter(item => 
    role === 'admin' || item.roles.includes(role || '')
  );

  return (
    <div className="portal-container">
      <aside className="portal-sidebar">
        <div className="portal-logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
          <span className="portal-logo-text">PropertyFlow</span>
        </div>
        
        <nav className="portal-nav">
          {filteredNavItems.map(item => (
            <button
              key={item.path}
              className={`portal-nav-item ${location.pathname === item.path ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
            >
              <span className="portal-nav-icon">{item.icon}</span>
              <span className="portal-nav-text">{item.name}</span>
            </button>
          ))}
        </nav>

        <div className="portal-user">
          <div className="portal-user-info">
            <span className="portal-user-name">{user?.name}</span>
            <span className="portal-user-role">{role}</span>
          </div>
          <button className="btn-secondary" onClick={signOut} style={{ padding: '0.5rem' }}>
            Sign Out
          </button>
        </div>
      </aside>

      <main className="portal-main">
        <div className="portal-content">
          {children}
        </div>
      </main>
    </div>
  );
};

function AppRoutes() {
  const { user, role, loading } = useAuth();

  if (loading) return <div>Loading...</div>;

  return (
    <Routes>
      <Route 
        path="/" 
        element={
          <>
            <Navbar />
            <main className="main">
              <Home />
            </main>
          </>
        } 
      />
      <Route 
        path="/about" 
        element={
          <>
            <Navbar />
            <main className="main">
              <About />
            </main>
          </>
        } 
      />
      
      <Route 
        path="/dashboard" 
        element={
          <ProtectedRoute allowedRoles={['tenant', 'landlord', 'admin']}>
            <PortalLayout>
              {role === 'tenant' ? <TenantPortal /> : <LandlordDashboard />}
            </PortalLayout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/properties" 
        element={
          <ProtectedRoute allowedRoles={['tenant', 'landlord', 'admin']}>
            <PortalLayout>
              <Properties />
            </PortalLayout>
          </ProtectedRoute>
        } 
      />

      <Route 
        path="/messages" 
        element={
          <ProtectedRoute allowedRoles={['tenant', 'landlord', 'admin']}>
            <PortalLayout>
              <div className="page dashboard">
                <h1>Messages</h1>
                <p>Messaging system coming soon.</p>
              </div>
            </PortalLayout>
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/admin" 
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <PortalLayout>
              <AdminDashboard />
            </PortalLayout>
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
  const navigate = useNavigate();

  if (!auth0Domain || !auth0ClientId) {
    return <AuthProvider>{children}</AuthProvider>;
  }

  const onRedirectCallback = (appState: any) => {
    navigate(appState?.returnTo || '/dashboard');
  };

  return (
    <Auth0Provider
      domain={auth0Domain}
      clientId={auth0ClientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: auth0Audience,
      }}
      onRedirectCallback={onRedirectCallback}
    >
      <AuthProvider>{children}</AuthProvider>
    </Auth0Provider>
  );
};

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <OptionalAuth0Provider>
          <div className="app">
            <AppRoutes />
          </div>
        </OptionalAuth0Provider>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
