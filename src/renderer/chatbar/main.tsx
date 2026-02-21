import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatBar } from './ChatBar';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChatBar />
  </React.StrictMode>
);
