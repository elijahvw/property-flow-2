import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

interface Profile {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
}

const AdminDashboard: React.FC = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProfiles();
  }, []);

  const fetchProfiles = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('*');

      if (error) throw error;
      setProfiles(data || []);
    } catch (error) {
      console.error('Error fetching profiles:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateRole = async (userId: string, newRole: string) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', userId);

      if (error) throw error;
      await fetchProfiles();
    } catch (error) {
      console.error('Error updating role:', error);
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
              <button className="btn-secondary" onClick={fetchProfiles}>Refresh</button>
            </div>
            
            {loading ? (
              <p>Loading users...</p>
            ) : (
              <div className="user-table-container">
                <table className="user-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.map((profile) => (
                      <tr key={profile.id}>
                        <td>{profile.email || 'No Email'}</td>
                        <td>
                          <span className={`role-badge ${profile.role}`}>
                            {profile.role}
                          </span>
                        </td>
                        <td>
                          <select 
                            value={profile.role} 
                            onChange={(e) => updateRole(profile.id, e.target.value)}
                            className="role-select"
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
