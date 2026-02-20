import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const Home: React.FC = () => {
  const { user, signIn, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) return null;

  return (
    <div className="page hero-section">
      <div className="hero-content">
        <h1>Simplify Your Property Management</h1>
        <p className="hero-subtitle">The modern way to track, manage, and flow your properties with ease.</p>
        <div className="hero-actions">
          {!user ? (
            <>
              <button className="btn-primary lg" onClick={signIn}>Get Started</button>
              <button className="btn-secondary lg">Learn More</button>
            </>
          ) : (
            <button className="btn-primary lg" onClick={() => navigate('/dashboard')}>
              Go to Your Portal
            </button>
          )}
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
