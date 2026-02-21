import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  root: 'src/renderer',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        pet: resolve(__dirname, 'src/renderer/pet.html'),
        assistant: resolve(__dirname, 'src/renderer/assistant.html'),
        chatbar: resolve(__dirname, 'src/renderer/chatbar.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
