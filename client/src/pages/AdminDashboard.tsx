import React, { useState, useEffect } from 'react';
import axios from 'axios';

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

const AdminDashboard: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      // Backend is expected to be running on 5011
      const response = await axios.get('http://localhost:5011/users');
      setUsers(response.data);
    } catch (err: any) {
      console.error('Error fetching users:', err);
      setError('Failed to fetch users. Make sure the backend server is running.');
    } finally {
      setLoading(false);
    }
  };

  const updateRole = async (userId: string, newRole: string) => {
    try {
      setError(null);
      await axios.post(`http://localhost:5011/users/${userId}/role`, {
        role: newRole
      });
      // Refresh user list to see updated role
      await fetchUsers();
    } catch (err: any) {
      console.error('Error updating role:', err);
      setError('Failed to update role. Please try again.');
    }
  };

  return (
    <div className="page dashboard">
      <header className="dashboard-header">
        <h1>System Admin</h1>
        <p className="text-muted">Configure platform settings and monitor system health.</p>
      </header>
      
      <div className="admin-grid">
        <div className="admin-sidebar">
          <div className="feature-card">
            <div className="feature-icon">⚙️</div>
            <h3>System Config</h3>
            <p>All services operational</p>
            <button className="btn-secondary lg mt-1 full-width">Settings</button>
          </div>
          <div className="feature-card mt-1">
            <div className="feature-icon">🛡️</div>
            <h3>Security</h3>
            <p>No active threats</p>
            <button className="btn-secondary lg mt-1 full-width">Audit Logs</button>
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
            
            {error && <div className="error-message">{error}</div>}
            
            <div className="user-table-container">
              <table className="user-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 && !loading && (
                    <tr>
                      <td colSpan={4} className="text-muted" style={{ textAlign: 'center' }}>
                        No users found.
                      </td>
                    </tr>
                  )}
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.name}</td>
                      <td>{user.email}</td>
                      <td>
                        <span className={`role-badge ${user.role}`}>
                          {user.role}
                        </span>
                      </td>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
