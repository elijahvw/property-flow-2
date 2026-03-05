import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initDatadogRum } from './datadog';
import './index.css';

initDatadogRum();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
