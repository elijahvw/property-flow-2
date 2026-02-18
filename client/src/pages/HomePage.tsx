import React from 'react';
import { useAuth } from '../contexts/AuthContext';

const HomePage: React.FC = () => {
  const { login } = useAuth();

  return (
    <div className="welcome-hero">
      <h1>Property Management Simplified.</h1>
      <p className="text-muted mb-2">The all-in-one platform for landlords and tenants.</p>
      <button className="btn-primary lg" onClick={login}>Get Started</button>
    </div>
  );
};

export default HomePage;
