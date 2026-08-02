import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
// Die Buchschrift. Ohne sie setzt die Vorschau eine andere Schrift als das PDF.
import './fonts.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root nicht gefunden');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
