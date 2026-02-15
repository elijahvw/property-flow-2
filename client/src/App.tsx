import { useEffect, useState } from 'react';
import { PropertyService, fetchWithAuth } from './services/api';
import { AuthService } from './services/auth';
import './App.css';

interface Property {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  units?: any[];
}

interface HealthStatus {
  status: string;
  timestamp: string;
}

interface VersionInfo {
  version: string;
  buildId: string;
}

interface UserInfo {
  id: string;
  email: string;
  name: string;
  companies: Array<{
    id: string;
    name: string;
    role: string;
  }>;
}

function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkAuth = async () => {
    try {
      // Check for token in URL hash (from Cognito redirect)
      const hash = window.location.hash;
      if (hash.includes('access_token=')) {
        const params = new URLSearchParams(hash.substring(1));
        const token = params.get('access_token');
        if (token) {
          localStorage.setItem('access_token', token);
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }

      const res = await fetchWithAuth('/api/me');
      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
        const props = await PropertyService.list();
        setProperties(props);
      }
    } catch (err) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch((err) => setError(err.message));

    checkAuth();
  }, []);

  const handleLogin = () => {
    const domain = import.meta.env.VITE_COGNITO_DOMAIN;
    const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
    const redirectUri = window.location.origin;
    window.location.href = `${domain}/login?client_id=${clientId}&response_type=token&scope=email+openid+profile&redirect_uri=${redirectUri}`;
  };

  return (
    <div className="app">
      <nav className="navbar">
        <div className="nav-brand">PropertyFlow</div>
        <div className="nav-user">
          {user ? (
            <div className="user-profile">
              <span>{user.name} ({user.companies[0]?.role || 'No Role'})</span>
              <button className="btn-logout" onClick={() => AuthService.logout()}>Logout</button>
            </div>
          ) : (
            <button className="btn-login" onClick={handleLogin}>Login</button>
          )}
        </div>
      </nav>

      <main className="main">
        {user ? (
          <div className="dashboard">
            <header className="dashboard-header">
              <h1>Dashboard: {user.companies[0]?.name || 'No Company'}</h1>
            </header>
            
            <section className="dashboard-grid">
              <div className="card">
                <div className="card-header">
                  <h3>Properties</h3>
                  <button className="btn-small">+ New</button>
                </div>
                <div className="property-list">
                  {properties.length === 0 ? (
                    <p className="muted">No properties found. Create your first one!</p>
                  ) : (
                    properties.map(p => (
                      <div key={p.id} className="property-item">
                        <div className="p-info">
                          <strong>{p.name}</strong>
                          <span>{p.address}, {p.city}</span>
                        </div>
                        <div className="p-meta">
                          {p.units?.length || 0} units
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              
              <div className="card">
                <h3>System Status</h3>
                <div className="status-row">
                  <span>API:</span>
                  <span className={health?.status === 'ok' ? 'ok' : ''}>{health?.status || 'Offline'}</span>
                </div>
                <div className="status-row">
                  <span>Database:</span>
                  <span>Connected</span>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div className="welcome-hero">
            <h1>Manage your properties with ease.</h1>
            <p>The all-in-one platform for multi-tenant property management.</p>
            <button className="btn-primary" onClick={handleLogin}>Get Started</button>
          </div>
        )}

        <footer className="footer-status">
          <div className="status-indicator">
            <span className={`dot ${health?.status === 'ok' ? 'online' : 'offline'}`}></span>
            API Status: {health?.status || 'Connecting...'}
          </div>
        </footer>
      </main>
    </div>
  );
}

export default App;
