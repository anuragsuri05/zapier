import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': api, '/hooks': api, '/mcp': api, '/health': api },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
