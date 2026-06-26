import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'spa',
  base: process.env.GITHUB_ACTIONS ? '/Soulstash/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
