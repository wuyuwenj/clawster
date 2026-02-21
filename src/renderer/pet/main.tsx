import React from 'react';
import ReactDOM from 'react-dom/client';
import { Pet } from './Pet';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Pet />
  </React.StrictMode>
);
