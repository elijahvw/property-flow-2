import React from 'react';
import { Link } from 'react-router-dom';

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
          <p>View and manage your company’s properties.</p>
          <Link className="btn-secondary lg mt-1 full-width" to="/properties">View Properties</Link>
        </div>
        <div className="feature-card">
          <div className="feature-icon">💰</div>
          <h3>Revenue</h3>
          <p>Revenue reporting is coming soon.</p>
          <button className="btn-secondary lg mt-1 full-width" disabled>Coming Soon</button>
        </div>
        <div className="feature-card">
          <div className="feature-icon">🔧</div>
          <h3>Maintenance</h3>
          <p>Maintenance tracking is coming soon.</p>
          <button className="btn-secondary lg mt-1 full-width" disabled>Coming Soon</button>
        </div>
      </div>
    </div>
  );
};

export default LandlordDashboard;
