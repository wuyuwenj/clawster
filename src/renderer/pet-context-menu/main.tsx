import '../tauri-bridge';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { PetContextMenu } from './PetContextMenu';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PetContextMenu />
  </React.StrictMode>
);
