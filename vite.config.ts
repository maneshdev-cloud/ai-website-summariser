import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The frontend talks to the API exclusively through relative /api paths.
// In production (Vercel) those are served by the serverless handlers in /api.
// In development, Vite proxies them to the local API server
// (scripts/dev-server.mjs, started together with Vite via `npm run dev`).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
