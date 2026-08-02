import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Ports sind über die Umgebung verschiebbar.
 *
 * Vorgabe bleibt 5173 für die Vorschau und 5174 für die API. Verschieben lassen
 * sie sich, weil hier gelegentlich mehrere Arbeitskopien gleichzeitig laufen –
 * und weil der Parity-Test beide Ports exklusiv verlangt, statt sich an einen
 * fremden Server zu hängen. Ohne diese Möglichkeit blieb nur, den anderen
 * Prozess zu beenden.
 */
const WEB_PORT = Number(process.env['FRANIBOOK_WEB_PORT'] ?? 5173);
const API_PORT = Number(process.env['FRANIBOOK_API_PORT'] ?? 5174);

export default defineConfig({
  plugins: [react()],
  server: {
    port: WEB_PORT,
    // Ausdrücklich IPv4: ohne diese Angabe bindet Vite nur an ::1, und alles,
    // was 127.0.0.1 anspricht – Playwright, curl – läuft ins Leere.
    host: '127.0.0.1',
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${API_PORT}`,
    },
  },
});
