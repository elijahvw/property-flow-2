import React, { Component, ErrorInfo, ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import About from './pages/About';
import LandlordDashboard from './pages/LandlordDashboard';
import TenantPortal from './pages/TenantPortal';
import AdminDashboard from './pages/AdminDashboard';
import Auth from './pages/Auth';
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
          <p>{this.state.error?.message}</p>
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
  const { user, role, signOut, loading } = useAuth();

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
          location.pathname !== '/auth' && (
            <button className="nav-btn active" onClick={() => navigate('/auth')}>
              Sign In
            </button>
          )
        ) : (
          <button className="nav-btn" onClick={signOut}>
            Sign Out
          </button>
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
      <Route path="/auth" element={<Auth />} />
      
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

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <div className="app">
            <Navbar />
            <main className="main">
              <AppRoutes />
            </main>
          </div>
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
