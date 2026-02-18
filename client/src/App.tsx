import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import About from './pages/About';
import LandlordDashboard from './pages/LandlordDashboard';
import TenantPortal from './pages/TenantPortal';
import AdminDashboard from './pages/AdminDashboard';
import './App.css';

const Navbar = () => {
  const navigate = useNavigate();
  const location = useLocation();

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
          className={`nav-btn ${location.pathname === '/landlord' ? 'active' : ''}`}
          onClick={() => navigate('/landlord')}
        >
          Landlord
        </button>
        <button 
          className={`nav-btn ${location.pathname === '/tenant' ? 'active' : ''}`}
          onClick={() => navigate('/tenant')}
        >
          Tenant
        </button>
        <button 
          className={`nav-btn ${location.pathname === '/admin' ? 'active' : ''}`}
          onClick={() => navigate('/admin')}
        >
          Admin
        </button>
      </div>
    </nav>
  );
};

function App() {
  return (
    <Router>
      <div className="app">
        <Navbar />
        <main className="main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/landlord" element={<LandlordDashboard />} />
            <Route path="/tenant" element={<TenantPortal />} />
            <Route path="/admin" element={<AdminDashboard />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
