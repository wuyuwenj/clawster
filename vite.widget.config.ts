import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/widget'),
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/web/widget-entry.tsx'),
      name: 'ClawsterMascotWidget',
      formats: ['iife'],
      fileName: () => 'clawster-widget.js',
    },
  },
});
