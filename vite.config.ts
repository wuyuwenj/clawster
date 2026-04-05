import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const host = process.env.TAURI_DEV_HOST;

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
        'pet-context-menu': resolve(__dirname, 'src/renderer/pet-context-menu.html'),
        'pet-chat': resolve(__dirname, 'src/renderer/pet-chat.html'),
        assistant: resolve(__dirname, 'src/renderer/assistant.html'),
        chatbar: resolve(__dirname, 'src/renderer/chatbar.html'),
        'screenshot-question': resolve(__dirname, 'src/renderer/screenshot-question.html'),
        'workspace-browser': resolve(__dirname, 'src/renderer/workspace-browser.html'),
        onboarding: resolve(__dirname, 'src/renderer/onboarding.html'),
      },
    },
  },
  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      // Tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
  // Environment variables starting with TAURI_ are exposed to the client
  envPrefix: ['VITE_', 'TAURI_'],
});
