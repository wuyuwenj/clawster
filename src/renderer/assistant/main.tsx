import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/theme.css';
import { initTheme } from '../theme';
import { Assistant } from './Assistant';
import './styles.css';

// Apply the persisted theme (dark default / Tidepool light) before first paint.
initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Assistant />
  </React.StrictMode>
);
