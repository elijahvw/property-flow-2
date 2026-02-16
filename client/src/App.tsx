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

    fetchWithAuth('/api/health')
      .then(async res => {
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await res.text();
          throw new Error(`Expected JSON but got ${contentType || 'nothing'} (first 50 chars: ${text.substring(0, 50)})`);
        }
        return res.json();
      })
      .then(setHealth)
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

  return (
    <div className="app">
      <nav className="navbar">
        <div className="nav-brand">PropertyFlow</div>
        <div className="nav-user">
          {user ? (
            <div className="user-profile">
              <span>{user.name} ({activeCompany?.role || 'No Role'})</span>
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
                  <input placeholder="Company Name" onChange={e => setFormData({...formData, companyName: e.target.value})} required />
                  <button type="submit" className="btn-primary">Create Company</button>
                </form>
              </div>
            ) : (
              <div className="dashboard-content">
                <header className="dashboard-header">
                  <h1>{activeCompany.company.name} Dashboard</h1>
                </header>

                <div className="dashboard-grid">
                  <div className="card">
                    <div className="card-header">
                      <h3>Properties</h3>
                      <button className="btn-small" onClick={() => setShowForm('property')}>+ New</button>
                    </div>
                    
                    {showForm === 'property' && (
                      <form onSubmit={handleCreateProperty} className="inline-form">
                        <input placeholder="Name" onChange={e => setFormData({...formData, propertyName: e.target.value})} required />
                        <input placeholder="Address" onChange={e => setFormData({...formData, address: e.target.value})} required />
                        <button type="submit">Create</button>
                        <button type="button" onClick={() => setShowForm(null)}>Cancel</button>
                      </form>
                    )}

                    <div className="property-list">
                      {properties.map(p => (
                        <div key={p.id} className="property-item">
                          <div className="p-info">
                            <strong>{p.name}</strong>
                            <span>{p.address}</span>
                          </div>
                          <div className="p-actions">
                            <button className="btn-small" onClick={() => { setShowForm('unit'); setSelectedPropertyId(p.id); }}>+ Unit</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {showForm === 'unit' && (
                    <div className="card modal">
                      <h3>Add Unit to {properties.find(p => p.id === selectedPropertyId)?.name}</h3>
                      <form onSubmit={handleCreateUnit}>
                        <input placeholder="Unit Number (e.g. 101)" onChange={e => setFormData({...formData, unitNumber: e.target.value})} required />
                        <button type="submit">Add Unit</button>
                        <button type="button" onClick={() => setShowForm(null)}>Cancel</button>
                      </form>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="welcome-hero">
            <h1>Property Management Simplified.</h1>
            <button className="btn-primary" onClick={handleLogin}>Get Started</button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
