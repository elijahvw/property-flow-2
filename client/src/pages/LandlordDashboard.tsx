import React from 'react';

const LandlordDashboard: React.FC = () => {
  return (
    <div className="page dashboard">
      <header className="dashboard-header">
        <h1>Landlord Dashboard</h1>
        <p className="text-muted">Manage your properties and oversee your portfolio.</p>
      </header>
      
      <div className="feature-grid">
        <div className="feature-card">
          <div className="feature-icon">🏠</div>
          <h3>Properties</h3>
          <p>4 Active listings</p>
          <button className="btn-secondary lg mt-1 full-width">View All</button>
        </div>
        <div className="feature-card">
          <div className="feature-icon">💰</div>
          <h3>Revenue</h3>
          <p>$12,450 this month</p>
          <button className="btn-secondary lg mt-1 full-width">Reports</button>
        </div>
        <div className="feature-card">
          <div className="feature-icon">🔧</div>
          <h3>Maintenance</h3>
          <p>2 Pending requests</p>
          <button className="btn-secondary lg mt-1 full-width">Manage</button>
        </div>
      </div>
    </div>
  );
};

export default LandlordDashboard;
