import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Ausdrücklich IPv4: ohne diese Angabe bindet Vite nur an ::1, und alles,
    // was 127.0.0.1 anspricht – Playwright, curl – läuft ins Leere.
    host: '127.0.0.1',
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:5174',
    },
  },
});
