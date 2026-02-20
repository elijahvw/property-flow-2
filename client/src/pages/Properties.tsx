import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth0 } from '@auth0/auth0-react';
import { useAuth } from '../context/AuthContext';

interface Property {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

const Properties: React.FC = () => {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({ 
    name: '', 
    address: '', 
    city: '', 
    state: '', 
    zip: '' 
  });

  const { getAccessTokenSilently } = useAuth0();
  const { companyId, role } = useAuth();

  useEffect(() => {
    if (companyId) {
      fetchProperties();
    } else if (role !== 'admin') {
      setLoading(false);
    }
  }, [companyId]);

  const fetchProperties = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = await getAccessTokenSilently();
      const response = await axios.get('/api/properties', {
        headers: { 
          Authorization: `Bearer ${token}`,
          'X-Company-ID': companyId
        }
      });
      setProperties(response.data);
    } catch (err: any) {
      console.error('Error fetching properties:', err);
      setError('Failed to fetch properties.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProperty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId) {
      setError('You must be assigned to a company to create properties.');
      return;
    }

    try {
      setLoading(true);
      const token = await getAccessTokenSilently();
      await axios.post('/api/properties', formData, {
        headers: { 
          Authorization: `Bearer ${token}`,
          'X-Company-ID': companyId
        }
      });
      setShowCreateModal(false);
      setFormData({ name: '', address: '', city: '', state: '', zip: '' });
      await fetchProperties();
    } catch (err: any) {
      setError('Failed to create property.');
    } finally {
      setLoading(false);
    }
  };

  if (!companyId && role !== 'admin') {
    return (
      <div className="page dashboard">
        <div className="content-card">
          <h1>Setup Required</h1>
          <p>You need to be assigned to a company by an administrator before you can manage properties.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-grid">
      <header className="admin-sidebar-actions">
        <div>
          <h1>Properties</h1>
          <p className="text-muted">Manage your real estate assets and units.</p>
        </div>
        <button className="btn-primary lg" onClick={() => setShowCreateModal(true)}>
          + Add Property
        </button>
      </header>

      <div className="admin-main-content">
        <div className="content-card no-padding">
          <div className="card-header" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Total Properties: {properties.length}</span>
              <button className="btn-secondary" onClick={fetchProperties} disabled={loading} style={{ padding: '0.4rem 1rem', borderRadius: '8px' }}>
                {loading ? 'Refreshing...' : 'Refresh List'}
              </button>
            </div>
          </div>

          {error && <div className="error-message mx-1 mt-1">{error}</div>}

          <div className="user-table-container">
            <table className="user-table">
              <thead>
                <tr>
                  <th>Property Name</th>
                  <th>Address</th>
                  <th>Location</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {properties.map((property) => (
                  <tr key={property.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{property.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {property.id}</div>
                    </td>
                    <td>{property.address}</td>
                    <td>{property.city}, {property.state} {property.zip}</td>
                    <td>
                      <button className="btn-small">Manage Units</button>
                    </td>
                  </tr>
                ))}
                {properties.length === 0 && !loading && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                      No properties found. Click "Add Property" to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Add New Property</h2>
            <form onSubmit={handleCreateProperty}>
              <div className="form-group">
                <label>Property Name</label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  required 
                  placeholder="e.g. Sunset Apartments"
                />
              </div>
              <div className="form-group">
                <label>Street Address</label>
                <input 
                  type="text" 
                  value={formData.address}
                  onChange={(e) => setFormData({...formData, address: e.target.value})}
                  required 
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>City</label>
                  <input 
                    type="text" 
                    value={formData.city}
                    onChange={(e) => setFormData({...formData, city: e.target.value})}
                    required 
                  />
                </div>
                <div className="form-group">
                  <label>State</label>
                  <input 
                    type="text" 
                    value={formData.state}
                    onChange={(e) => setFormData({...formData, state: e.target.value})}
                    required 
                  />
                </div>
              </div>
              <div className="form-group">
                <label>ZIP Code</label>
                <input 
                  type="text" 
                  value={formData.zip}
                  onChange={(e) => setFormData({...formData, zip: e.target.value})}
                  required 
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Creating...' : 'Create Property'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Properties;
