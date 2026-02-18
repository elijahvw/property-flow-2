import React from 'react';

const AdminDashboard: React.FC = () => {
  return (
    <div className="page dashboard">
      <header className="dashboard-header">
        <h1>System Admin</h1>
        <p className="text-muted">Configure platform settings and monitor system health.</p>
      </header>
      
      <div className="feature-grid">
        <div className="feature-card">
          <div className="feature-icon">👥</div>
          <h3>User Management</h3>
          <p>1,240 Total users</p>
          <button className="btn-secondary lg mt-1 full-width">Manage Users</button>
        </div>
        <div className="feature-card">
          <div className="feature-icon">⚙️</div>
          <h3>System Config</h3>
          <p>All services operational</p>
          <button className="btn-secondary lg mt-1 full-width">Settings</button>
        </div>
        <div className="feature-card">
          <div className="feature-icon">🛡️</div>
          <h3>Security</h3>
          <p>No active threats</p>
          <button className="btn-secondary lg mt-1 full-width">Audit Logs</button>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
