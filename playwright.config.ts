import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    trace: 'on-first-retry',
  },
  // The Electron windows load their renderer from the Vite dev server in
  // unpackaged (test) runs. Start it automatically, or reuse one already
  // running via `npm run dev`.
  webServer: {
    command: 'npm run dev:renderer',
    url: 'http://localhost:5173/onboarding.html',
    reuseExistingServer: true,
    timeout: 120000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
