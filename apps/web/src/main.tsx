import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
/*
 * Die Schriften der Oberfläche, als Pakete und nicht von einem Fremdserver: Der
 * Server bindet nur an 127.0.0.1 und soll auch beim Arbeiten ohne Netz dieselbe
 * Oberfläche zeigen. Vite bündelt die WOFF2-Dateien mit, geladen wird je nach
 * Zeichensatz nur die nötige Untermenge.
 */
import '@fontsource-variable/outfit';
import '@fontsource-variable/mulish';
import '@fontsource-variable/jetbrains-mono';
// Farben, Schriftfamilien und Grundstile der Oberfläche.
import './theme.css';
// Die Buchschrift. Ohne sie setzt die Vorschau eine andere Schrift als das PDF.
import './fonts.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root nicht gefunden');

/*
 * Der Umschlag ist ein Reiter, kein Sonderweg mehr – `?cover` wählt ihn nur noch
 * aus (siehe `App.tsx`). Übrig bleibt hier eine Zeile, weil es nichts mehr zu
 * entscheiden gibt.
 */
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
