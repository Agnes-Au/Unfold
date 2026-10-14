import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Unfold server (Express) runs on http://localhost:8787.
// All API calls go through the /api proxy so no key is ever bundled here.
// The production build is served by that server under /worker/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/worker/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
}));
