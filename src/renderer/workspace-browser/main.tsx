import '../tauri-bridge';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { WorkspaceBrowser } from './WorkspaceBrowser';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WorkspaceBrowser />
  </React.StrictMode>
);
