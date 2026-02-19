import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth0 } from '@auth0/auth0-react';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  blocked: boolean;
}

const AdminDashboard: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({ email: '', password: '', name: '', role: 'tenant' });
  const { getAccessTokenSilently } = useAuth0();

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = await getAccessTokenSilently();
      const response = await axios.get('/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUsers(response.data);
    } catch (err: any) {
      console.error('Error fetching users:', err);
      setError('Failed to fetch users. Make sure the backend server is running.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);
      const token = await getAccessTokenSilently();
      await axios.post('/api/users', formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setShowCreateModal(false);
      setFormData({ email: '', password: '', name: '', role: 'tenant' });
      
      // Fetch fresh data from Auth0
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
      
      // Fetch fresh data from Auth0
      await fetchUsers();
    } catch (err: any) {
      setError(err.response?.data?.details || 'Failed to update user');
    } finally {
      setLoading(false);
    }
  };

  const toggleUserStatus = async (user: User) => {
    try {
      setLoading(true);
      setError(null);
      const token = await getAccessTokenSilently();
      
      await axios.post(`/api/users/${encodeURIComponent(user.id)}/status`, {
        blocked: !user.blocked
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Fetch fresh data from Auth0
      await fetchUsers();
    } catch (err: any) {
      setError('Failed to change user status');
    } finally {
      setLoading(false);
    }
  };

  const updateRole = async (userId: string, newRole: string) => {
    try {
      setLoading(true);
      setError(null);
      const token = await getAccessTokenSilently();
      
      await axios.post(`/api/users/${encodeURIComponent(userId)}/role`, {
        role: newRole
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      // Fetch fresh data from Auth0
      await fetchUsers();
    } catch (err: any) {
      setError('Failed to update role');
    } finally {
      setLoading(false);
    }
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({ email: user.email, password: '', name: user.name, role: user.role });
  };

  return (
    <div className="page dashboard">
      <header className="dashboard-header">
        <h1>System Admin</h1>
        <p className="text-muted">Configure platform settings and monitor system health.</p>
      </header>
      
      <div className="admin-grid">
        <div className="admin-sidebar">
          <button className="btn-primary full-width lg" onClick={() => setShowCreateModal(true)}>
            + Create New User
          </button>
          <div className="feature-card mt-1">
            <div className="feature-icon">⚙️</div>
            <h3>System Config</h3>
            <p>All services operational</p>
          </div>
        </div>

        <div className="admin-main">
          <div className="content-card">
            <div className="card-header">
              <h2>User Management</h2>
              <button className="btn-secondary" onClick={fetchUsers} disabled={loading}>
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            
            {error && <div className="error-message mb-1">{error}</div>}
            
            <div className="user-table-container">
              <table className="user-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.name}</td>
                      <td>{user.email}</td>
                      <td>
                        <select 
                          value={user.role} 
                          className="role-select"
                          onChange={(e) => updateRole(user.id, e.target.value)}
                        >
                          <option value="tenant">Tenant</option>
                          <option value="landlord">Landlord</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td>
                        <span className={`status-badge ${user.blocked ? 'inactive' : 'active'}`}>
                          {user.blocked ? 'Disabled' : 'Enabled'}
                        </span>
                      </td>
                      <td>
                        <div className="action-buttons">
                          <button className="btn-small" onClick={() => openEditModal(user)}>Edit</button>
                          <button 
                            className={`btn-small ${user.blocked ? 'btn-success' : 'btn-danger'}`}
                            onClick={() => toggleUserStatus(user)}
                          >
                            {user.blocked ? 'Enable' : 'Disable'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

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
