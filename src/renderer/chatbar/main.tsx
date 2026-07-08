import React from 'react';
import ReactDOM from 'react-dom/client';
// Nunito ships inside the bundle (Tidepool rounded UI face — no runtime font fetch)
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '../styles/tidepool.css';
import { ChatBar } from './ChatBar';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChatBar />
  </React.StrictMode>
);
