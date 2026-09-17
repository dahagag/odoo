import react from '@vitejs/plugin-react';
// From 'vitest/config', not 'vite' - this is the same `defineConfig` vite's own CLI reads (`vite
// build`/`vite dev` never see the extra `test` key at all), it just also types/validates it, so
// one config file serves both without a separate vitest.config.ts to keep in sync.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Local dev only: apps/api runs on its own port, and VITE_API_BASE_URL defaults to
    // same-origin `/api` (`lib/apiClient.ts`) - this proxy is what makes that default work
    // without every dev needing to set the env var just to run the app.
    proxy: { '/api': { target: 'http://localhost:3000', rewrite: (path) => path.replace(/^\/api/, '') } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    css: false,
  },
});
