import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/web'),
  publicDir: resolve(__dirname, 'assets'),
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
