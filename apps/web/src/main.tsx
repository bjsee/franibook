import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { Cover } from './Cover.js';
// Die Buchschrift. Ohne sie setzt die Vorschau eine andere Schrift als das PDF.
import './fonts.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root nicht gefunden');

/**
 * `?cover` zeigt die Coveransicht.
 *
 * Vorläufig über die Adresse und nicht als Reiter in `App.tsx`: So ist der
 * Umschlag erreichbar, ohne die Hauptansicht anzufassen. Dieselbe Konvention
 * nutzt schon `?bare` für den Parity-Test.
 */
const zeigeCover = new URLSearchParams(location.search).has('cover');
const useOriginal = new URLSearchParams(location.search).has('original');
const imageSrc = (photoId: string) =>
  useOriginal ? `/api/photos/${photoId}/original` : `/api/photos/${photoId}/preview`;

createRoot(root).render(
  <StrictMode>
    {zeigeCover ? (
      <main
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '1.5rem 2rem 4rem',
          maxWidth: '1500px',
          margin: '0 auto',
          color: '#111827',
        }}
      >
        <Cover imageSrc={imageSrc} />
      </main>
    ) : (
      <App />
    )}
  </StrictMode>,
);
