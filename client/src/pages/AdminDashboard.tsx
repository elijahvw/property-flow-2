import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth0 } from '@auth0/auth0-react';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  blocked: boolean;
  company?: { id: string, name: string } | null;
}

interface Company {
  id: string;
  name: string;
  domain: string | null;
  _count?: {
    users: number;
    properties: number;
  };
}

const AdminDashboard: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowLoading, setRowLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCompanyModal, setShowCompanyModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'companies'>('users');
  
  const [formData, setFormData] = useState({ email: '', password: '', name: '', role: 'tenant' });
  const [companyFormData, setCompanyFormData] = useState({ name: '', domain: '' });
  
  const { getAccessTokenSilently } = useAuth0();

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    await Promise.all([fetchUsers(), fetchCompanies()]);
    setLoading(false);
  };

  const fetchUsers = async () => {
    try {
      setError(null);
      const token = await getAccessTokenSilently();
      const response = await axios.get('/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUsers(response.data);
    } catch (err: any) {
      console.error('Error fetching users:', err);
      setError('Failed to fetch users.');
    }
  };

  const fetchCompanies = async () => {
    try {
      const token = await getAccessTokenSilently();
      const response = await axios.get('/api/companies', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCompanies(response.data);
    } catch (err: any) {
      console.error('Error fetching companies:', err);
    }
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const token = await getAccessTokenSilently();
      await axios.post('/api/companies', companyFormData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setShowCompanyModal(false);
      setCompanyFormData({ name: '', domain: '' });
      await fetchCompanies();
    } catch (err: any) {
      setError('Failed to create company');
    } finally {
      setLoading(false);
    }
  };

  const assignCompany = async (userId: string, companyId: string) => {
    try {
      setRowLoading(prev => ({ ...prev, [userId]: true }));
      const token = await getAccessTokenSilently();
      await axios.post(`/api/companies/${companyId}/users/${encodeURIComponent(userId)}`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      await fetchUsers();
    } catch (err: any) {
      setError('Failed to assign company');
    } finally {
      setRowLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);
      const token = await getAccessTokenSilently();
      const response = await axios.post('/api/users', formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Transform Auth0 response to our User interface for optimistic update
      const newUser: User = {
        id: response.data.user_id,
        email: response.data.email,
        name: response.data.name || response.data.email,
        role: formData.role,
        blocked: false
      };
      
      setUsers(prev => [newUser, ...prev]);
      setShowCreateModal(false);
      setFormData({ email: '', password: '', name: '', role: 'tenant' });
      
      // Still fetch to sync everything properly with roles from Auth0
      await delay(2000);
      await fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.details || 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      setLoading(true);
      setError(null);
      const token = await getAccessTokenSilently();
      await axios.patch(`/api/users/${encodeURIComponent(editingUser.id)}`, {
        email: formData.email,
        name: formData.name
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setEditingUser(null);
      setFormData({ email: '', password: '', name: '', role: 'tenant' });
      
      // Wait for Auth0 propagation
      await delay(1000);
      await fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.details || 'Failed to update user');
    } finally {
      setLoading(false);
    }
  };

  const toggleUserStatus = async (user: User) => {
    try {
      setRowLoading(prev => ({ ...prev, [user.id]: true }));
      setError(null);
      
      // Optimistic update
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, blocked: !user.blocked } : u));
      
      const token = await getAccessTokenSilently();
      await axios.post(`/api/users/${encodeURIComponent(user.id)}/status`, {
        blocked: !user.blocked
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Wait for Auth0 eventual consistency (shorter since we updated optimistically)
      await delay(1000);
      await fetchUsers();
    } catch (err: any) {
      setError('Failed to change user status');
      // Revert on error
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, blocked: user.blocked } : u));
    } finally {
      setRowLoading(prev => ({ ...prev, [user.id]: false }));
    }
  };

  const updateRole = async (userId: string, newRole: string) => {
    try {
      setRowLoading(prev => ({ ...prev, [userId]: true }));
      setError(null);
      const token = await getAccessTokenSilently();
      
      await axios.post(`/api/users/${encodeURIComponent(userId)}/role`, {
        role: newRole
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Wait for Auth0 eventual consistency
      await delay(1500);
      await fetchUsers();
    } catch (err: any) {
      setError('Failed to update role');
    } finally {
      setRowLoading(prev => ({ ...prev, [userId]: false }));
    }
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({ email: user.email, password: '', name: user.name, role: user.role });
  };

  return (
    <div className="admin-grid">
      <header className="admin-sidebar-actions">
        <div>
          <h1>System Administration</h1>
          <p className="text-muted">Manage companies, users, and platform-wide settings.</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {activeTab === 'users' ? (
            <button className="btn-primary lg" onClick={() => setShowCreateModal(true)}>
              + Create New User
            </button>
          ) : (
            <button className="btn-primary lg" onClick={() => setShowCompanyModal(true)}>
              + Create New Company
            </button>
          )}
        </div>
      </header>

      <div className="tab-container mb-1" style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
        <button 
          className={`nav-btn ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          Users
        </button>
        <button 
          className={`nav-btn ${activeTab === 'companies' ? 'active' : ''}`}
          onClick={() => setActiveTab('companies')}
        >
          Companies
        </button>
      </div>
      
      <div className="admin-main-content">
        {activeTab === 'users' ? (
          <div className="content-card no-padding">
            <div className="card-header" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total Users: {users.length}</span>
                <button className="btn-secondary" onClick={fetchUsers} disabled={loading} style={{ padding: '0.4rem 1rem', borderRadius: '8px' }}>
                  {loading ? 'Refreshing...' : 'Refresh List'}
                </button>
              </div>
            </div>
            
            {error && <div className="error-message mx-1 mt-1">{error}</div>}
            
            <div className="user-table-container">
              <table className="user-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Company</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className={rowLoading[user.id] ? 'row-loading' : ''}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{user.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {user.id}</div>
                      </td>
                      <td>{user.email}</td>
                      <td>
                        <select 
                          value={user.role} 
                          className="role-select"
                          onChange={(e) => updateRole(user.id, e.target.value)}
                          disabled={rowLoading[user.id]}
                        >
                          <option value="tenant">Tenant</option>
                          <option value="landlord">Landlord</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td>
                        <select
                          className="role-select"
                          value={user.company?.id || ''}
                          onChange={(e) => assignCompany(user.id, e.target.value)}
                          disabled={rowLoading[user.id]}
                        >
                          <option value="">No Company</option>
                          {companies.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span className={`status-badge ${user.blocked ? 'inactive' : 'active'}`}>
                          {rowLoading[user.id] ? 'Updating...' : (user.blocked ? 'Disabled' : 'Enabled')}
                        </span>
                      </td>
                      <td>
                        <div className="action-buttons">
                          <button 
                            className="btn-small" 
                            onClick={() => openEditModal(user)}
                            disabled={rowLoading[user.id]}
                          >
                            Edit
                          </button>
                          <button 
                            className={`btn-small ${user.blocked ? 'btn-success' : 'btn-danger'}`}
                            onClick={() => toggleUserStatus(user)}
                            disabled={rowLoading[user.id]}
                          >
                            {rowLoading[user.id] ? '...' : (user.blocked ? 'Enable' : 'Disable')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="content-card no-padding">
            <div className="card-header" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Total Companies: {companies.length}</span>
                <button className="btn-secondary" onClick={fetchCompanies} disabled={loading} style={{ padding: '0.4rem 1rem', borderRadius: '8px' }}>
                  {loading ? 'Refreshing...' : 'Refresh Companies'}
                </button>
              </div>
            </div>
            
            <div className="user-table-container">
              <table className="user-table">
                <thead>
                  <tr>
                    <th>Company Name</th>
                    <th>Domain</th>
                    <th>Users</th>
                    <th>Properties</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => (
                    <tr key={company.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{company.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID: {company.id}</div>
                      </td>
                      <td>{company.domain || 'N/A'}</td>
                      <td>{company._count?.users || 0}</td>
                      <td>{company._count?.properties || 0}</td>
                      <td>
                        <button className="btn-small">Manage</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showCompanyModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Create New Company</h2>
            <form onSubmit={handleCreateCompany}>
              <div className="form-group">
                <label>Company Name</label>
                <input 
                  type="text" 
                  value={companyFormData.name}
                  onChange={(e) => setCompanyFormData({...companyFormData, name: e.target.value})}
                  placeholder="Enter company name..."
                  required 
                />
              </div>
              <div className="form-group">
                <label>Custom Domain (Optional)</label>
                <input 
                  type="text" 
                  value={companyFormData.domain}
                  onChange={(e) => setCompanyFormData({...companyFormData, domain: e.target.value})}
                  placeholder="e.g. acme-rentals.com"
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowCompanyModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Create Company</button>
              </div>
            </form>
          </div>
        </div>
      )}


      {(showCreateModal || editingUser) && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>{editingUser ? 'Edit User' : 'Create New User'}</h2>
            <form onSubmit={editingUser ? handleUpdateUser : handleCreateUser}>
              <div className="form-group">
                <label>Name</label>
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  required 
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input 
                  type="email" 
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  required 
                />
              </div>
              {!editingUser && (
                <div className="form-group">
                  <label>Password</label>
                  <input 
                    type="password" 
                    value={formData.password}
                    onChange={(e) => setFormData({...formData, password: e.target.value})}
                    required 
                  />
                </div>
              )}
              {!editingUser && (
                <div className="form-group">
                  <label>Initial Role</label>
                  <select 
                    value={formData.role}
                    onChange={(e) => setFormData({...formData, role: e.target.value})}
                  >
                    <option value="tenant">Tenant</option>
                    <option value="landlord">Landlord</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => {
                  setShowCreateModal(false);
                  setEditingUser(null);
                  setFormData({ email: '', password: '', name: '', role: 'tenant' });
                }}>Cancel</button>
                <button type="submit" className="btn-primary">
                  {editingUser ? 'Update User' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
