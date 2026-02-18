import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { TenantProvider } from './contexts/TenantContext';
import { BaseLayout } from './layouts/BaseLayout';
import HomePage from './pages/HomePage';
import DashboardPage from './pages/DashboardPage';
import './App.css';

const AppRoutes = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading-container"><p>Loading...</p></div>;
  }

  return (
    <BaseLayout>
      <Routes>
        <Route path="/" element={user ? <Navigate to="/dashboard" /> : <HomePage />} />
        <Route path="/dashboard" element={user ? <DashboardPage /> : <Navigate to="/" />} />
      </Routes>
    </BaseLayout>
  );
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <TenantProvider>
          <AppRoutes />
        </TenantProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
