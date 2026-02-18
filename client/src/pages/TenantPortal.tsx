import React from 'react';

const TenantPortal: React.FC = () => {
  return (
    <div className="page dashboard">
      <header className="dashboard-header">
        <h1>Tenant Portal</h1>
        <p className="text-muted">Welcome home! Manage your lease and requests here.</p>
      </header>
      
      <div className="feature-grid">
        <div className="feature-card">
          <div className="feature-icon">📄</div>
          <h3>My Lease</h3>
          <p>Active until Oct 2026</p>
          <button className="btn-secondary lg mt-1 full-width">View Lease</button>
        </div>
        <div className="feature-card">
          <div className="feature-icon">💳</div>
          <h3>Rent Payment</h3>
          <p>Next due: Mar 1st</p>
          <button className="btn-primary lg mt-1 full-width">Pay Now</button>
        </div>
        <div className="feature-card">
          <div className="feature-icon">🛠️</div>
          <h3>Support</h3>
          <p>Request maintenance</p>
          <button className="btn-secondary lg mt-1 full-width">New Ticket</button>
        </div>
      </div>
    </div>
  );
};

export default TenantPortal;
