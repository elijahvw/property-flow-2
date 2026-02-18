import React from 'react';

const Home: React.FC = () => {
  return (
    <div className="page hero-section">
      <div className="hero-content">
        <h1>Simplify Your Property Management</h1>
        <p className="hero-subtitle">The modern way to track, manage, and flow your properties with ease.</p>
        <div className="hero-actions">
          <button className="btn-primary lg">Get Started</button>
          <button className="btn-secondary lg">Learn More</button>
        </div>
      </div>
      
      <div className="feature-grid">
        <div className="feature-card">
          <div className="feature-icon">🏠</div>
          <h3>Property Tracking</h3>
          <p>Real-time updates on all your property assets.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">📈</div>
          <h3>Analytics</h3>
          <p>Deep insights into your portfolio performance.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon">⚡</div>
          <h3>Fast Sync</h3>
          <p>Seamless synchronization across all your devices.</p>
        </div>
      </div>
    </div>
  );
};

export default Home;
