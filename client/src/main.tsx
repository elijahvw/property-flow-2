import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initDatadogRum } from './datadog';
import './index.css';

// Remove invitation secrets before monitoring or route rendering starts.
if (window.location.pathname === '/invite' && window.location.hash) {
  sessionStorage.setItem('pf-invitation', window.location.hash.slice(1));
  window.history.replaceState(null, '', '/invite');
}
initDatadogRum();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
