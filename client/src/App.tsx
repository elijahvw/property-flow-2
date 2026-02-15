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

function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch((err) => setError(err.message));

    fetch('/api/version')
      .then((res) => res.json())
      .then(setVersion)
      .catch(() => {});
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>PropertyFlow</h1>
        <p className="subtitle">Property Management Platform</p>
      </header>

      <main className="main">
        <section className="status-card">
          <h2>System Status</h2>
          {error ? (
            <p className="error">API Error: {error}</p>
          ) : health ? (
            <div className="status-details">
              <div className="status-row">
                <span className="label">API Status:</span>
                <span className="value ok">{health.status}</span>
              </div>
              <div className="status-row">
                <span className="label">Timestamp:</span>
                <span className="value">{new Date(health.timestamp).toLocaleString()}</span>
              </div>
              {version && (
                <>
                  <div className="status-row">
                    <span className="label">Version:</span>
                    <span className="value">{version.version}</span>
                  </div>
                  <div className="status-row">
                    <span className="label">Build:</span>
                    <span className="value">{version.buildId}</span>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p>Loading...</p>
          )}
        </section>

        <section className="features">
          <h2>Platform Features</h2>
          <div className="feature-grid">
            <div className="feature-card">
              <h3>Properties & Units</h3>
              <p>Manage your real estate portfolio with full CRUD operations.</p>
            </div>
            <div className="feature-card">
              <h3>Tenant Management</h3>
              <p>Track tenants, leases, and occupancy status.</p>
            </div>
            <div className="feature-card">
              <h3>Rent & Billing</h3>
              <p>Automated charge generation and ledger tracking.</p>
            </div>
            <div className="feature-card">
              <h3>Maintenance</h3>
              <p>Work order management from request to completion.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
