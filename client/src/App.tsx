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

const Navbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role, signOut } = useAuth();

  return (
    <nav className="navbar">
      <div className="nav-brand">PropertyFlow</div>
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
          <button className="nav-btn active" onClick={() => navigate('/auth')}>
            Sign In
          </button>
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
  );
}

export default App;
