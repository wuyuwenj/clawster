import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/theme.css';
import './onboarding-theme.css';
import { initTheme } from '../theme';
import { Onboarding } from './Onboarding';

// Apply the persisted theme (dark default / Tidepool light) before first paint.
initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Onboarding />
  </React.StrictMode>
);
