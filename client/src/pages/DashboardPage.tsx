import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { PropertyService, CompanyService } from '../services/api';

const DashboardPage: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const { activeCompany, activeCompanyId } = useTenant();
  const [properties, setProperties] = useState<any[]>([]);
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

  const loadProperties = async () => {
    if (activeCompanyId) {
      const props = await PropertyService.list();
      setProperties(props);
    }
  };

  useEffect(() => {
    loadProperties();
  }, [activeCompanyId]);

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    await CompanyService.create(formData.companyName);
    setShowForm(null);
    refreshUser();
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
    loadProperties();
  };

  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPropertyId) return;
    await PropertyService.createUnit(selectedPropertyId, {
      number: formData.unitNumber
    });
    setShowForm(null);
    loadProperties();
  };

  if (!activeCompany) {
    return (
      <div className="dashboard">
        <div className="card">
          <h2>Welcome! Create a company to get started.</h2>
          <form onSubmit={handleCreateCompany}>
            <input placeholder="Company Name" className="full-width mb-1" onChange={e => setFormData({...formData, companyName: e.target.value})} required />
            <button type="submit" className="btn-primary">Create Company</button>
          </form>
        </div>
      </div>
    );
  }

  const role = user?.companies.find(c => c.companyId === activeCompanyId)?.role;

  if (role === 'COMPANY_OWNER' || role === 'PROPERTY_MANAGER') {
    return (
      <div className="dashboard">
        <div className="dashboard-content">
          <header className="dashboard-header">
            <h1>Landlord Portal</h1>
            <p className="text-muted">{activeCompany.name} — Welcome, {user?.name}</p>
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
      </div>
    );
  }

  // Other roles...
  return (
    <div className="dashboard">
      <div className="dashboard-content">
        <header className="dashboard-header">
          <h1>{role?.replace('_', ' ')} Portal</h1>
          <p className="text-muted">Welcome, {user?.name}</p>
        </header>
        <div className="card">
          <p>Your workspace for {activeCompany.name} is being set up.</p>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
