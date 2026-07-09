import React from 'react';
import ReactDOM from 'react-dom/client';
// Nunito ships inside the bundle (Tidepool rounded UI face — no runtime font
// fetch). Latin-only subsets: the UI copy never leaves the Latin alphabet.
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '../styles/tidepool.css';
import { PetChat } from './PetChat';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PetChat />
  </React.StrictMode>
);
