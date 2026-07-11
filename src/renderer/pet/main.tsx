import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/theme.css';
import { initTheme } from '../theme';
import { Pet } from './Pet';
import './styles.css';

// Apply the persisted theme (dark default / Tidepool light) before first paint.
initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Pet />
  </React.StrictMode>
);
