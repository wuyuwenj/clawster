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
        'pet-context-menu': resolve(__dirname, 'src/renderer/pet-context-menu.html'),
        'pet-chat': resolve(__dirname, 'src/renderer/pet-chat.html'),
        assistant: resolve(__dirname, 'src/renderer/assistant.html'),
        chatbar: resolve(__dirname, 'src/renderer/chatbar.html'),
        'screenshot-question': resolve(__dirname, 'src/renderer/screenshot-question.html'),
        'workspace-browser': resolve(__dirname, 'src/renderer/workspace-browser.html'),
        game: resolve(__dirname, 'src/renderer/game.html'),
        onboarding: resolve(__dirname, 'src/renderer/onboarding.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
