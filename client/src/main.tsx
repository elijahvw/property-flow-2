import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerBrowserErrors } from './browser-telemetry';
import './index.css';

// Remove invitation secrets before monitoring or route rendering starts.
if (window.location.pathname === '/invite' && window.location.hash) {
  sessionStorage.setItem('pf-invitation', window.location.hash.slice(1));
  if(new URLSearchParams(window.location.search).get('lease')==='1')sessionStorage.setItem('pf-lease-invitation','true');
  else sessionStorage.removeItem('pf-lease-invitation');
  if(new URLSearchParams(window.location.search).get('contact')==='1')sessionStorage.setItem('pf-contact-invitation','true');
  else sessionStorage.removeItem('pf-contact-invitation');
  window.history.replaceState(null, '', '/invite');
}

registerBrowserErrors();

// Keep monitoring off the rendering path and out of local preview/fixture data.
if (import.meta.env.VITE_RUM_ENABLED === 'true') {
  void import('./rum').then(({ startRum }) => startRum()).catch(() => {});
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
