import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { setRuntimeConfig } from './runtimeConfig';
import './styles.css';

setRuntimeConfig({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787',
  brandName: import.meta.env.VITE_BRAND_NAME || 'Clawster',
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
