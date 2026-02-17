import { useEffect, useState } from 'react';
import { PropertyService, CompanyService, fetchWithAuth } from './services/api';
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

interface UserInfo {
  id: string;
  email: string;
  name: string;
  companies: Array<{
    id: string;
    companyId: string;
    role: string;
    company: {
      id: string;
      name: string;
    };
  }>;
}

function App() {
  const [health, setHealth] = useState<any>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState<'property' | 'unit' | 'company' | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    propertyName: '',
    address: '',
    city: '',
    state: '',
    unitNumber: '',
    companyName: ''
  });

  const checkAuth = async () => {
    try {
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
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const userData = await res.json();
          setUser(userData);
          if (userData.companies.length > 0) {
            const currentActive = localStorage.getItem('active_company_id');
            if (!currentActive || !userData.companies.find((c: any) => c.companyId === currentActive)) {
              localStorage.setItem('active_company_id', userData.companies[0].companyId);
            }
            const props = await PropertyService.list();
            setProperties(props);
          }
        } else {
          const text = await res.text();
          console.error('Expected JSON for /api/me but got:', contentType, text.substring(0, 100));
        }
      } else {
        setUser(null);
      }
    } catch (err) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const missing = [];
    if (!import.meta.env.VITE_COGNITO_USER_POOL_ID) missing.push('USER_POOL_ID');
    if (!import.meta.env.VITE_COGNITO_CLIENT_ID) missing.push('CLIENT_ID');
    if (!import.meta.env.VITE_COGNITO_DOMAIN) missing.push('COGNITO_DOMAIN');
    
    if (missing.length > 0) {
      setError(`Missing environment variables: ${missing.join(', ')}`);
      setLoading(false);
      return;
    }

    console.log('Fetching health check...');
    fetch('/api/health')
      .then(async res => {
        console.log('Health check response status:', res.status);
        const contentType = res.headers.get('content-type');
        console.log('Health check content-type:', contentType);
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        if (!contentType || !contentType.includes('application/json')) {
          const text = await res.text();
          console.error('Health check returned non-JSON:', text.substring(0, 200));
          throw new Error(`Expected JSON but got ${contentType || 'nothing'} (first 50 chars: ${text.substring(0, 50)})`);
        }
        return res.json();
      })
      .then(data => {
        console.log('Health check success:', data);
        setHealth(data);
      })
      .catch(err => {
        console.error('Health check failed:', err);
        setError(err.message);
      });
    checkAuth();
  }, []);

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    await CompanyService.create(formData.companyName);
    setShowForm(null);
    checkAuth();
  };

  const handleCreateProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    await PropertyService.create({
      name: formData.propertyName,
      address: formData.address,
      city: formData.city,
      state: formData.state
    });
    setShowForm(null);
    const props = await PropertyService.list();
    setProperties(props);
  };

  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPropertyId) return;
    await PropertyService.createUnit(selectedPropertyId, {
      number: formData.unitNumber
    });
    setShowForm(null);
    const props = await PropertyService.list();
    setProperties(props);
  };

  const handleLogin = () => {
    const domain = import.meta.env.VITE_COGNITO_DOMAIN;
    const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
    const redirectUri = window.location.origin;
    window.location.href = `${domain}/login?client_id=${clientId}&response_type=token&scope=email+openid+profile&redirect_uri=${redirectUri}`;
  };

  const activeCompany = user?.companies[0];

  const RoleDashboard = () => {
    const role = activeCompany?.role;

    if (role === 'COMPANY_OWNER' || role === 'PROPERTY_MANAGER') {
      return (
        <div className="dashboard-content">
          <header className="dashboard-header">
            <h1>Landlord Portal</h1>
            <p className="text-muted">{activeCompany.company.name} — Welcome, {user?.name}</p>
          </header>
          
          <div className="dashboard-grid">
            <div className="card">
              <div className="card-header">
                <h3>Properties</h3>
                <button className="btn-small" onClick={() => setShowForm('property')}>+ New Property</button>
              </div>
              
              {showForm === 'property' && (
                <form onSubmit={handleCreateProperty} className="inline-form">
                  <div className="form-group">
                    <input placeholder="Property Name" onChange={e => setFormData({...formData, propertyName: e.target.value})} required />
                    <input placeholder="Address" onChange={e => setFormData({...formData, address: e.target.value})} required />
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn-primary">Create</button>
                    <button type="button" className="btn-secondary" onClick={() => setShowForm(null)}>Cancel</button>
                  </div>
                </form>
              )}

              <div className="property-list">
                {properties.length === 0 ? (
                  <p className="muted">No properties found. Add one to get started.</p>
                ) : (
                  properties.map(p => (
                    <div key={p.id} className="property-item">
                      <div className="p-info">
                        <strong>{p.name}</strong>
                        <span>{p.address}</span>
                      </div>
                      <div className="p-actions">
                        <button className="btn-small secondary" onClick={() => { setShowForm('unit'); setSelectedPropertyId(p.id); }}>+ Unit</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="card">
              <h3>Overview</h3>
              <div className="stats-list">
                <div className="stat-item">
                  <span className="stat-label">Total Properties</span>
                  <span className="stat-value">{properties.length}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Active Leases</span>
                  <span className="stat-value">0</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Pending Maintenance</span>
                  <span className="stat-value">0</span>
                </div>
              </div>
              <div className="quick-links">
                <button className="btn-link">Manage Tenants</button>
                <button className="btn-link">Financial Reports</button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (role === 'TENANT') {
      return (
        <div className="dashboard-content">
          <header className="dashboard-header">
            <h1>Tenant Portal</h1>
            <p className="text-muted">Welcome home, {user?.name}</p>
          </header>
          <div className="dashboard-grid">
            <div className="card">
              <h3>My Residence</h3>
              <p className="muted">Details for your unit at {activeCompany.company.name} will appear here.</p>
            </div>
            <div className="card">
              <h3>Actions</h3>
              <button className="btn-primary full-width mb-1">Pay Rent</button>
              <button className="btn-secondary full-width">Request Maintenance</button>
            </div>
          </div>
        </div>
      );
    }

    if (role === 'MAINTENANCE') {
      return (
        <div className="dashboard-content">
          <header className="dashboard-header">
            <h1>Maintenance Portal</h1>
            <p className="text-muted">Welcome, {user?.name}</p>
          </header>
          <div className="card">
            <h3>Assigned Work Orders</h3>
            <p className="muted">You have no active work orders assigned.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="dashboard-content">
        <header className="dashboard-header">
          <h1>{role?.replace('_', ' ')} Dashboard</h1>
          <p className="text-muted">Welcome to PropertyFlow, {user?.name}</p>
        </header>
        <div className="card">
          <p>Your workspace for {activeCompany?.company.name} is being set up. Please check back soon for updates.</p>
        </div>
      </div>
    );
  };

  return (
    <div className="app">
      <nav className="navbar">
        <div className="nav-brand">PropertyFlow</div>
        <div className="nav-user">
          {user ? (
            <div className="user-profile">
              <span>{user.name} ({activeCompany?.role?.replace('_', ' ') || 'No Role'})</span>
              <button className="btn-logout" onClick={() => AuthService.logout()}>Logout</button>
            </div>
          ) : (
            <button className="btn-login" onClick={handleLogin}>Login</button>
          )}
        </div>
      </nav>

      <main className="main">
        {loading ? (
          <div className="loading-container"><p>Loading...</p></div>
        ) : error && !health ? (
          <div className="error-container">
            <h1>Config Error</h1>
            <pre>{error}</pre>
          </div>
        ) : user ? (
          <div className="dashboard">
            {!activeCompany ? (
              <div className="card">
                <h2>Welcome! Create a company to get started.</h2>
                <form onSubmit={handleCreateCompany}>
                  <input placeholder="Company Name" className="full-width mb-1" onChange={e => setFormData({...formData, companyName: e.target.value})} required />
                  <button type="submit" className="btn-primary">Create Company</button>
                </form>
              </div>
            ) : (
              <>
                <RoleDashboard />
                {showForm === 'unit' && (
                  <div className="modal-overlay">
                    <div className="card modal">
                      <h3>Add Unit to {properties.find(p => p.id === selectedPropertyId)?.name}</h3>
                      <form onSubmit={handleCreateUnit}>
                        <input placeholder="Unit Number (e.g. 101)" className="full-width mb-1" onChange={e => setFormData({...formData, unitNumber: e.target.value})} required />
                        <div className="form-actions">
                          <button type="submit" className="btn-primary">Add Unit</button>
                          <button type="button" className="btn-secondary" onClick={() => setShowForm(null)}>Cancel</button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="welcome-hero">
            <h1>Property Management Simplified.</h1>
            <p className="text-muted mb-2">The all-in-one platform for landlords and tenants.</p>
            <button className="btn-primary lg" onClick={handleLogin}>Get Started</button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
