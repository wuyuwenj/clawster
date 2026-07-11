import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/theme.css';
import { initTheme } from '../theme';
import { ScreenshotQuestion } from './ScreenshotQuestion';
import './styles.css';

// Apply the persisted theme (dark default / Tidepool light) before first paint.
initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ScreenshotQuestion />
  </React.StrictMode>
);
