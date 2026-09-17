import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Local dev only: apps/api runs on its own port, and VITE_API_BASE_URL defaults to
    // same-origin `/api` (`lib/apiClient.ts`) - this proxy is what makes that default work
    // without every dev needing to set the env var just to run the app.
    proxy: { '/api': { target: 'http://localhost:3000', rewrite: (path) => path.replace(/^\/api/, '') } },
  },
});
