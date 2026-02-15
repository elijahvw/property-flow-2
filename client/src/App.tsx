import { useEffect, useState } from 'react';
import './App.css';

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch((err) => setError(err.message));

    // Attempt to fetch current user (will 401 if not logged in)
    fetch('/api/me')
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('Unauthenticated');
      })
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  return (
    <div className="app">
      <nav className="navbar">
        <div className="nav-brand">PropertyFlow</div>
        <div className="nav-user">
          {user ? (
            <div className="user-profile">
              <span>{user.name} ({user.companies[0]?.role || 'No Role'})</span>
              <button className="btn-logout">Logout</button>
            </div>
          ) : (
            <button className="btn-login">Login with Cognito</button>
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
                <h3>Quick Actions</h3>
                <div className="action-buttons">
                  <button>+ Add Property</button>
                  <button>+ Add Unit</button>
                </div>
              </div>
              
              <div className="card">
                <h3>Recent Activity</h3>
                <p>No recent activity found.</p>
              </div>
            </section>
          </div>
        ) : (
          <div className="welcome-hero">
            <h1>Manage your properties with ease.</h1>
            <p>The all-in-one platform for multi-tenant property management.</p>
            <button className="btn-primary">Get Started</button>
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
