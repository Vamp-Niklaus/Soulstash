import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'spa',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/css': 'http://localhost:3001',
      '/js': 'http://localhost:3001',
      '/images': 'http://localhost:3001',
      '/components': 'http://localhost:3001',
      '/sw.js': 'http://localhost:3001'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
